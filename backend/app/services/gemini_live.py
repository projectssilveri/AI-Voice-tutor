"""Bridge between a browser WebSocket and a Gemini Live session.

The whole product rests on one behaviour: the student can talk over the tutor
and the tutor stops *immediately*. Gemini cancels its in-flight audio
server-side when its VAD hears speech and emits `server_content.interrupted`.
Our job is to relay that signal to the browser before anything else, because
the browser still holds queued audio that has to be thrown away.

Audio formats are fixed by the Live API:
  input  16-bit PCM, 16 kHz, mono, little-endian
  output 16-bit PCM, 24 kHz, mono, little-endian

The API key stays in this process. The browser never sees it.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass, field

from google import genai
from google.genai import types

from app.core.config import settings

logger = logging.getLogger(__name__)

INPUT_SAMPLE_RATE = 16_000
OUTPUT_SAMPLE_RATE = 24_000
INPUT_MIME_TYPE = f"audio/pcm;rate={INPUT_SAMPLE_RATE}"

# Sent as a user turn at session start so the tutor speaks first rather than
# waiting to be asked. This is the "AI speaks first" pattern from the brief.
#
# "UNDER TWO MINUTES" IS GONE. It produced a tutor that said its piece and then
# had nothing left to do but ask permission to carry on — and a session is now
# up to ninety minutes, so two minutes of lecture meant eighty-eight minutes
# of "shall we move on?". The material decides the length, not a stopwatch.
LECTURE_TRIGGER = (
    "Begin the lesson now. Open the way the instructions describe. Greet me, "
    "say which course and which module this is and what we are about to cover "
    "and then teach the whole of the material. Start speaking immediately "
    "without waiting for me, and do not ask me whether to begin or continue."
)

#: Said at the end of the last turn, so the bridge knows to stop nudging.
#:
#: A SPOKEN SENTENCE RATHER THAN A TOKEN. Whatever goes here is read out loud —
#: there is no channel to the model that the student cannot hear — so it has to
#: be something a teacher would actually say at the end of a lesson. This one
#: doubles as the closing line.
LESSON_COMPLETE_PHRASE = "that is the whole of this module"

# Sent when the tutor finishes a turn and the student has not spoken. Gemini
# ends a turn when it has said a paragraph, the same as any chat model; without
# this the lecture stopped there and waited to be asked to carry on.
#
# WRITTEN SO IT IS NOT AUDIBLE IN THE ANSWER. The model is told to continue
# mid-thought, not to acknowledge being prompted — otherwise every turn began
# "Sure! Continuing where we left off", which is its own kind of stopping.
LECTURE_CONTINUE = (
    "Keep teaching. Carry straight on from the sentence you stopped on, as if "
    "you had never paused. Do not greet me again, do not recap what you just "
    "said, do not acknowledge this message, and do not ask me anything.\n\n"
    "If you have already taught the whole of the module material, do not pad "
    "it out or repeat yourself. Instead say, in one or two sentences, that "
    f"{LESSON_COMPLETE_PHRASE}, tell me what to do next: the practice quiz "
    "and the assignment. Then stop."
)


@dataclass(frozen=True)
class TutorVoice:
    """One voice a student may choose."""

    #: Gemini's own name for it. Sent as-is; never shown to a student, because
    #: "Kore" tells nobody anything.
    name: str
    #: What the screen calls it.
    label: str
    #: How it reads to most listeners. Gemini does not label these itself, so
    #: this is our description of a voice we have listened to — which is why it
    #: says "sounds", not "is".
    sounds: str
    #: One line under the name, so somebody choosing has something to go on
    #: besides a first name they have never heard.
    hint: str


#: The voices offered, in the order the screen shows them.
#:
#: A CURATED FEW, not everything Gemini has. Thirty names in a dropdown is not
#: a choice, it is a puzzle — and most of the difference between them does not
#: survive being described in text. Four covers the ask ("a man or a woman")
#: with a warmer and a crisper option on each side.
#:
#: Gemini's set changes without telling us, so an account holding a name that
#: is no longer offered falls back to the default rather than failing a lesson.
TUTOR_VOICES: tuple[TutorVoice, ...] = (
    TutorVoice("Puck", "Puck", "male", "Bright and quick. The current default."),
    TutorVoice("Charon", "Charon", "male", "Lower and steadier, less hurried."),
    TutorVoice("Kore", "Kore", "female", "Clear and even, easy to follow."),
    TutorVoice("Aoede", "Aoede", "female", "Warmer, a little more expressive."),
)

#: What a student who has never chosen gets. Gemini's own default is Puck, so
#: naming it here changes nothing today and makes the choice ours tomorrow.
DEFAULT_TUTOR_VOICE = "Puck"


def resolve_voice(chosen: str | None) -> str:
    """The voice to actually use.

    Anything unknown becomes the default. A student whose saved voice Gemini
    has since retired should hear a lesson, not an error — and the value comes
    from a column, so it can be anything at all after a bad import.
    """
    if chosen and any(voice.name == chosen for voice in TUTOR_VOICES):
        return chosen
    return DEFAULT_TUTOR_VOICE


class GeminiNotConfiguredError(RuntimeError):
    """GEMINI_API_KEY is missing."""


@dataclass
class LiveEvent:
    """One thing that happened in the session, normalised for the client.

    `audio` carries raw PCM; everything else is a small JSON-able control
    message. Keeping them in one stream preserves ordering, which is what makes
    the interrupt reliable.
    """

    type: str
    audio: bytes | None = None
    payload: dict[str, object] = field(default_factory=dict)


def build_client() -> genai.Client:
    if not settings.gemini_api_key:
        raise GeminiNotConfiguredError(
            "GEMINI_API_KEY is not set. Add it to backend/.env, and see .env.example."
        )
    return genai.Client(api_key=settings.gemini_api_key)


def build_config(
    system_instruction: str,
    *,
    resumption_handle: str | None = None,
    voice: str | None = None,
) -> types.LiveConnectConfig:
    """Config for one leg of a tutoring session.

    `system_instruction` is the only thing scoping what the tutor may teach, so
    callers pass the module's content and nothing else.

    ONE LEG, not one lesson. A connection lasts about ten minutes; a paid
    lesson is ninety, so a full one takes nine of these. `resumption_handle` is
    what makes every leg after the first a continuation rather than a fresh
    start — pass the newest handle Gemini gave us and the tutor picks up
    mid-sentence with its memory intact. Pass None for the first leg, which
    also asks Gemini to start issuing them.
    """
    return types.LiveConnectConfig(
        response_modalities=[types.Modality.AUDIO],
        system_instruction=system_instruction,
        # WHOSE VOICE. Nothing used to set this, so Gemini fell back to its own
        # default and every student on the platform heard the same man. The
        # student's choice arrives here; `resolve_voice` turns an unset or
        # unknown one into the default rather than letting it fail a lesson.
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(
                    voice_name=resolve_voice(voice)
                )
            )
        ),
        # Automatic VAD is what makes barge-in work; it is on by default and is
        # deliberately not disabled here.
        realtime_input_config=types.RealtimeInputConfig(
            automatic_activity_detection=types.AutomaticActivityDetection(
                disabled=False,
            ),
        ),
        # A connection lasts ~10 minutes. Passing a handle (or an empty config
        # to request one) is what makes a reconnect invisible to the student.
        session_resumption=types.SessionResumptionConfig(handle=resumption_handle),
        # THE OTHER CEILING. The context window holds 128k tokens and audio
        # spends about 25 a second, so an uncompressed call stops responding
        # after roughly fifteen minutes of talking — a sixth of the ninety a
        # paid course promises, and resuming the connection does nothing about
        # it because the conversation is what filled up, not the socket.
        #
        # Ninety minutes of two-way audio is far past 128k, so on a long lesson
        # this runs several times. That is the intended behaviour, not a
        # fallback.
        #
        # A sliding window cuts at the start of a user turn, and Gemini pins
        # the system instruction ahead of the window. So what is dropped is the
        # oldest exchanges; what survives is the module material and everything
        # recent. The tutor forgets the small talk from twenty minutes ago, not
        # what it is teaching.
        context_window_compression=types.ContextWindowCompressionConfig(
            trigger_tokens=settings.gemini_context_trigger_tokens,
            sliding_window=types.SlidingWindow(
                target_tokens=settings.gemini_context_target_tokens
            ),
        ),
        # Both sides transcribed so the text backup beside the avatar is real,
        # and so transcripts can be persisted.
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
    )


def module_system_instruction(
    module_title: str,
    module_content: str,
    course_title: str | None = None,
    *,
    student_name: str | None = None,
    course_description: str | None = None,
    module_number: int | None = None,
    module_count: int | None = None,
) -> str:
    """Ground the tutor in one module, and get it to actually lecture.

    Also gives the lesson an OPENING. The tutor used to begin mid-topic — the
    first thing a student heard was a sentence about arrays, with no greeting,
    no course named and no idea which module had started or how long it was.
    A person teaching out loud does not do that, and the whole product rests on
    this sounding like a person.

    THE PRODUCT IS A LECTURE YOU CAN INTERRUPT, and this instruction used to
    describe something else. One line — "check they followed before moving on"
    — was written for the interruption case and the model applied it to every
    turn. The result, in a real transcript:

        Tutor: ...Does that make sense before we move on?
        You:   Yes.
        Tutor: ...Ready to see how that works?
        You:   Yes.
        Tutor: ...Did that feel straightforward?
        You:   Yes.

    Two sentences of teaching, then a request for permission, forty times over.
    The student's only job became saying yes. The rules below are written to
    stop exactly that: keep going by default, and let the student be the one
    who decides when to stop you — which is the whole point of a tutor you can
    talk over.
    """
    course_line = f"It belongs to the course '{course_title}'. " if course_title else ""

    # WHERE THIS LESSON SITS. A tutor that knows it is the third of eight can
    # say so, and "the third of eight" is the single most orienting sentence a
    # student can hear at the start — it tells them how far in they are and
    # how much is left, which no amount of warmth substitutes for.
    if module_number is not None and module_count is not None:
        place = (
            f"This is module {module_number} of {module_count} in the course. "
        )
        first = module_number == 1
    else:
        place = ""
        first = False

    who = f"The student's name is {student_name}. " if student_name else ""
    about = (
        f"The course as a whole is described this way: {course_description}\n\n"
        if course_description
        else ""
    )

    # A first module carries the course; a later one carries only itself. Being
    # welcomed to the whole course at module six is the kind of small wrongness
    # that tells a student nobody is really there.
    if first:
        opening = (
            "This is the student's FIRST module in this course, so welcome "
            "them to the course itself as well as to this lesson, and say in "
            "a sentence what the course as a whole is for."
        )
    elif module_number is not None:
        opening = (
            "This is NOT the first module, so welcome them back rather than "
            "welcoming them to the course. Do not re-explain the whole course."
        )
    else:
        opening = "Welcome them to the lesson."

    return (
        f"You are a warm, knowledgeable voice tutor teaching the module "
        f"'{module_title}'. {course_line}{place}{who}"
        f"\n\n{about}"
        f"HOW TO OPEN\n"
        f"Begin every lesson by speaking to the person, not by starting "
        f"mid-topic. In your own words, and in about three or four sentences:"
        f"\n  - greet them warmly, by name if you have been given one\n"
        f"  - say which course this is and name this module out loud\n"
        f"  - say in one sentence what they will be able to do by the end\n"
        f"  - then move straight into teaching it\n\n"
        f"{opening}\n\n"
        f"Say the opening differently every time. Do not use a set formula, "
        f"do not read the module title as a heading, and never say anything "
        f"like 'Module 3, colon, Arrays and Objects'. Say it the way a person "
        f"introducing a lesson out loud would. Keep it short: they came to "
        f"learn, and a two-minute welcome is a two-minute delay.\n\n"
        f"Do not ask whether they are ready. Greet them and begin.\n\n"
        f"HOW TO TEACH\n"
        f"Deliver the material as a continuous spoken lecture. Move from one "
        f"idea to the next by yourself, in your own time, until the module is "
        f"covered. The student can hear you and can interrupt you whenever "
        f"they want, so you never need their permission to continue.\n\n"
        f"NEVER ASK TO CONTINUE. Do not end your turns with 'Does that make "
        f"sense?', 'Ready to move on?', 'Shall we?', 'Want to try?', 'Any "
        f"questions?' or anything else that hands the decision back to the "
        f"student. Do not offer to teach a later topic and wait to be told "
        f"yes. Just teach the next part.\n\n"
        f"HOW TO FINISH\n"
        f"When you have taught the whole of the material below and there is "
        f"genuinely nothing left to cover, do not start again and do not "
        f"stretch it out. Say in a sentence or two that "
        f"{LESSON_COMPLETE_PHRASE}, point them at the practice quiz and the "
        f"assignment, and stop there. Say those words plainly, because they are how "
        f"the lesson knows it has ended.\n\n"
        f"Ask a question only when it is a real teaching question, one where "
        f"working out the answer is how the student learns the point, and "
        f"then only occasionally. A question you already know they will "
        f"answer 'yes' to is not a teaching question.\n\n"
        f"WHEN THE STUDENT SPEAKS\n"
        f"Stop immediately and deal with what they actually said. Answer a "
        f"question directly; a hint first is good, the full answer if they "
        f"are stuck. Then go straight back to the lecture from where you were "
        f"cut off, without announcing that you are doing so and without "
        f"asking whether you may.\n\n"
        f"If what they said is not a question ('yes', 'okay', 'go on', a "
        f"noise, or something the transcription clearly garbled), do not treat "
        f"it as a conversation. Simply carry on teaching.\n\n"
        f"SCOPE\n"
        f"Teach ONLY from the material below. If the student asks about "
        f"something outside it, say in one sentence that it is outside this "
        f"module, then return to the lecture. Never offer to teach something "
        f"outside the material. You cannot, and offering it then refusing it "
        f"a moment later is worse than not offering.\n\n"
        f"VOICE\n"
        f"You are speaking aloud. Use plain conversational sentences. No "
        f"markdown, no bullet points, no headings, no code blocks, no emoji, "
        f"and never read out punctuation or formatting.\n\n"
        f"--- MODULE MATERIAL ---\n{module_content}\n--- END MODULE MATERIAL ---"
    )


@asynccontextmanager
async def open_session(
    config: types.LiveConnectConfig,
    *,
    model: str | None = None,
) -> AsyncIterator[genai.live.AsyncSession]:
    """Open one Live session. Model name comes from config, never a literal."""
    client = build_client()
    model_name = model or settings.gemini_model
    logger.info("Opening Gemini Live session (model=%s)", model_name)
    async with client.aio.live.connect(model=model_name, config=config) as session:
        yield session


async def pump_to_gemini(
    session: genai.live.AsyncSession,
    audio_source: Callable[[], Awaitable[bytes | None]],
) -> None:
    """Forward microphone audio until the source signals end (None)."""
    while True:
        chunk = await audio_source()
        if chunk is None:
            break
        if not chunk:
            continue
        await session.send_realtime_input(
            audio=types.Blob(data=chunk, mime_type=INPUT_MIME_TYPE)
        )


async def start_lecture(session: genai.live.AsyncSession) -> None:
    """Nudge the tutor into speaking without any student input."""
    await session.send_client_content(
        turns=types.Content(role="user", parts=[types.Part(text=LECTURE_TRIGGER)]),
        turn_complete=True,
    )


async def continue_lecture(session: genai.live.AsyncSession) -> None:
    """Send the tutor onward after it has finished a turn.

    The same mechanism as `start_lecture`, and for the same reason: a text turn
    is the only way to make the model speak without the student having to. It
    produces no input transcription, so nothing here reaches the stored
    transcript as words the student said.
    """
    await session.send_client_content(
        turns=types.Content(role="user", parts=[types.Part(text=LECTURE_CONTINUE)]),
        turn_complete=True,
    )


def sounds_finished(spoken: str) -> bool:
    """Whether the tutor just said the lesson is over.

    Matched loosely on purpose. The model is asked to say a sentence, not to
    emit a token, and it will punctuate and inflect it however it likes — "and
    that is the whole of this module", "so, that's the whole of this module!".
    Apostrophes and spacing are flattened before comparing.

    A miss costs one more nudge, and the model then says it again. A false
    positive ends the nudging early and the student can still speak. Neither is
    worth a stricter rule that breaks on a contraction.
    """
    flattened = " ".join(spoken.lower().replace("\u2019", "'").split())
    return LESSON_COMPLETE_PHRASE in flattened or "that's the whole of this module" in flattened


async def stream_from_gemini(
    session: genai.live.AsyncSession,
) -> AsyncIterator[LiveEvent]:
    """Normalise Gemini's message stream into LiveEvents, across every turn.

    Order is load-bearing: `interrupted` is yielded before anything else in the
    same message so the client can flush its audio queue at the earliest
    possible moment.

    The outer loop is NOT redundant. `session.receive()` is a *per-turn*
    generator — google-genai breaks out of it as soon as a message carries
    `turn_complete`. Iterating it once therefore ends the stream after the
    tutor's opening lecture: the bridge would tear down, nothing would drain
    the microphone queue, and the student's first question would hang the
    session. Re-entering it is what makes the conversation continue.

    An iteration that yields nothing means the underlying connection is gone
    (`_receive()` returned falsy), which is the signal to stop for real.
    """
    while True:
        received_anything = False

        async for message in session.receive():
            received_anything = True
            async for event in _events_from(message):
                yield event

        if not received_anything:
            break


async def _events_from(
    message: types.LiveServerMessage,
) -> AsyncIterator[LiveEvent]:
    """Fan one Gemini message out into zero or more LiveEvents."""
    server_content = message.server_content

    if server_content is not None and server_content.interrupted:
        # The student spoke over the tutor. Gemini has already cancelled its
        # own generation; the browser still has buffered audio.
        yield LiveEvent(type="interrupted")

    if message.data:
        yield LiveEvent(type="audio", audio=message.data)

    if server_content is not None:
        if server_content.input_transcription is not None:
            transcription = server_content.input_transcription
            if transcription.text:
                yield LiveEvent(
                    type="transcript",
                    payload={
                        "role": "user",
                        "text": transcription.text,
                        "final": bool(transcription.finished),
                    },
                )

        if server_content.output_transcription is not None:
            transcription = server_content.output_transcription
            if transcription.text:
                yield LiveEvent(
                    type="transcript",
                    payload={
                        "role": "model",
                        "text": transcription.text,
                        "final": bool(transcription.finished),
                    },
                )

        if server_content.turn_complete:
            yield LiveEvent(type="turn_complete")

    if message.session_resumption_update is not None:
        update = message.session_resumption_update
        if update.resumable and update.new_handle:
            # Persisted on voice_sessions so a dropped connection can be
            # resumed without the student noticing.
            yield LiveEvent(
                type="resumption_handle",
                payload={"handle": update.new_handle},
            )

    if message.go_away is not None:
        # Gemini is about to close this connection. Reconnect using the most
        # recent resumption handle.
        yield LiveEvent(
            type="go_away",
            payload={"time_left": str(message.go_away.time_left)},
        )


@dataclass(frozen=True)
class ResumeDecision:
    """Whether to open another leg, and why not when the answer is no."""

    should_resume: bool
    #: Empty when resuming. Otherwise a sentence fit to show a student, or ""
    #: when the ending needs no explanation because they caused it.
    reason: str = ""


def should_resume(
    *,
    handle: str | None,
    student_stopped: bool,
    browser_connected: bool,
    consecutive_failures: int,
    max_failures: int | None = None,
) -> ResumeDecision:
    """Should the bridge dial Gemini again after a leg ended?

    Pulled out of the bridge deliberately: it is the whole of the reconnect
    policy, it depends on nothing but four facts, and a rule with no
    dependencies can be pinned by a test that needs neither a database nor a
    live connection. `tests/test_live_resume.py` does exactly that.

    The order matters. The student's own decision to stop is checked before
    anything else, so pressing stop never produces a message explaining why the
    lesson could not continue — they know why.
    """
    limit = settings.gemini_max_resume_failures if max_failures is None else max_failures

    if student_stopped:
        return ResumeDecision(False)

    if not browser_connected:
        # Nobody is listening. Dialling Gemini again would bill for an empty
        # room, which is the cost `services/live_sessions` exists to control.
        return ResumeDecision(False)

    if not handle:
        # NO TICKET, NO RESUME. Reconnecting without one is not a resume at
        # all — it is a brand new session that would deliver the opening
        # lecture a second time and bill for it. Ending is the honest outcome.
        return ResumeDecision(
            False,
            "The tutor could not carry on from where it left off. "
            "Your transcript is saved. Start the module again to carry on.",
        )

    if consecutive_failures >= limit:
        # One failure is a blip. Two in a row means the handle is stale or
        # Gemini is refusing us, and retrying forever leaves somebody watching
        # a page that will never speak again.
        return ResumeDecision(
            False,
            "The tutor lost its connection and could not get it back. "
            "Your transcript is saved. Start the module again to carry on.",
        )

    return ResumeDecision(True)


async def drain_with_timeout(task: asyncio.Task[None], timeout: float = 2.0) -> None:
    """Cancel a pump task without letting shutdown hang on it."""
    task.cancel()
    try:
        await asyncio.wait_for(task, timeout=timeout)
    except (asyncio.CancelledError, TimeoutError):
        pass
