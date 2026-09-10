"""Gemini Live voice sessions — the highest-risk part of the product.

Two endpoints:

  /voice/ws/test              step-3 harness, hardcoded lesson, no auth, no DB
  /voice/ws/module/{id}       the real thing: authenticated, grounded in
                              `modules.content`, transcripts persisted

Wire protocol, browser <-> here:

    client -> server
        binary frame   raw PCM16 mono 16 kHz microphone audio
        {"type": "start"}   begin the lecture
        {"type": "stop"}    end the session

    server -> client
        {"type": "ready", "output_sample_rate": 24000, "module": {...}}
        binary frame        raw PCM16 mono 24 kHz tutor audio
        {"type": "interrupted"}        <- flush the playback queue NOW
        {"type": "transcript", "role": "user"|"model", "text": ..., "final": bool}
        {"type": "turn_complete"}
        {"type": "error", "message": ...}

Audio rides as binary frames rather than base64 JSON: a third less bandwidth,
and no encode/decode cost on a latency-critical path.

The resumption handle is never forwarded to the browser — it is a credential
for reconnecting, and it is stored on `voice_sessions` instead.

ONE LESSON, SEVERAL CONNECTIONS. Gemini closes a Live connection after about
ten minutes; a paid course allows ninety, so a full lesson takes nine of them.
`_run_bridge` opens a fresh connection with the saved handle each time one
ends, so the browser's socket — and the student's conversation — carry on
unbroken. The page is told nothing, because nothing happened as far as it is
concerned.

When the allowance itself runs out the session ends ITSELF, tells the student
in as many words, and closes. That is the `wait_for` at the bottom of this
file, and it is now the only thing deciding how long a lesson lasts.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import func, select
from starlette.websockets import WebSocketState

from app.core.config import settings
from app.core.users import get_jwt_strategy, get_user_db, get_user_manager
from app.db.session import SessionLocal
from app.models.course import Module
from app.models.user import UserRole
from app.models.voice import TranscriptRole
from app.services import access, gemini_live, limits, live_sessions, voice_sessions
from app.services import courses as course_service
from app.services import enrollments as enrollment_service
from app.services.gemini_live import GeminiNotConfiguredError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/voice", tags=["voice"])

SESSION_COOKIE = "vtlms_session"

# How long one connection to Gemini must last to count as having worked.
#
# Gemini's own cap ends a healthy leg after about ten minutes, so anything in
# seconds means something went wrong — most likely a resumption handle it
# accepted and then rejected. Without this the reconnect loop treated "opened"
# as "worked" and would reopen a dying connection as fast as Gemini allowed —
# for the whole ninety minutes a paid lesson now runs, every attempt billed.
MIN_HEALTHY_LEG_SECONDS = 5

# Stand-in module content for the step-3 harness only.
_TEST_MODULE_TITLE = "React State: useState"
_TEST_MODULE_CONTENT = """
useState is the React hook for adding state to a function component.

Calling useState with an initial value returns a pair: the current value, and a
function that updates it. For example, const [count, setCount] = useState(0)
gives you count, which starts at 0, and setCount, which changes it.

Calling the setter tells React the component needs to re-render. React then
calls your component function again, and this time useState hands back the new
value instead of the initial one.

The initial value is only used on the very first render. On later renders React
ignores it and returns whatever the current state is.

State updates are not applied instantly. If you need the previous value to
compute the next one, pass a function to the setter: setCount(c => c + 1). That
is the reliable way to do it when several updates happen close together.
"""


async def _send_json_safe(websocket: WebSocket, payload: dict) -> bool:
    """Send unless the socket is already gone. Returns False once closed."""
    if websocket.client_state is not WebSocketState.CONNECTED:
        return False
    try:
        await websocket.send_json(payload)
        return True
    except (WebSocketDisconnect, RuntimeError):
        return False


async def _authenticate(websocket: WebSocket):
    """Resolve the user from the session cookie.

    WebSockets carry cookies but not FastAPI's dependency-injected auth, so the
    JWT is verified by hand here using the same strategy the HTTP routes use.
    Returns None when the caller is not signed in.
    """
    token = websocket.cookies.get(SESSION_COOKIE)
    if not token:
        return None

    strategy = get_jwt_strategy()
    async for user_db in get_user_db(websocket.state.db_session):
        async for manager in get_user_manager(user_db):
            return await strategy.read_token(token, manager)
    return None


class _BridgeState:
    """What survives across one lesson, however many Gemini legs it takes.

    A lesson is one WebSocket to the browser and one row in `voice_sessions`,
    but SEVERAL connections to Gemini: each lasts about ten minutes and a paid
    lesson allows ninety minutes. Everything the swap must not forget lives
    here.
    """

    def __init__(self) -> None:
        #: Newest resumption handle Gemini has issued. Kept in memory as well
        #: as on the row so a reconnect needs no database round trip in the
        #: middle of a call. A credential — never logged, never sent onward.
        self.handle: str | None = None
        #: The student pressed stop, as opposed to the connection ending.
        self.student_stopped = False
        #: The tutor has been asked to begin. Only ever once per lesson: a
        #: resumed leg already knows where it got to, and nudging it again
        #: would restart the opening lecture and bill for it a second time.
        self.lecture_started = False
        #: The browser has asked for the lecture. Held separately from
        #: `lecture_started` so a request that lands before the first leg is
        #: open is honoured when it opens rather than lost.
        self.start_requested = False
        #: Reconnects that failed back to back. Reset by any leg that runs.
        self.failures = 0
        #: Why the lesson ended, when it was not the student's doing.
        self.ended_because: str = ""


async def _run_bridge(
    websocket: WebSocket,
    config_for,
    *,
    on_transcript=None,
    on_interrupted=None,
    on_turn_complete=None,
    on_resumption_handle=None,
    ready_payload: dict | None = None,
) -> None:
    """Bridge the browser to Gemini for a whole lesson, across reconnects.

    TWO CONNECTIONS, NOT ONE:

        browser  <-- A -->  here  <-- B -->  Gemini

    A has no time limit. B is closed by Gemini after about ten minutes, every
    time, and used to end the lesson with it — a paid course promising ninety
    minutes delivered ten, and the student saw the page fall silent with no
    explanation. Only B is replaced here, so the browser never finds out: it
    keeps receiving audio while the pipe behind it is swapped.

    `config_for` is a CALLABLE taking the resumption handle, not a finished
    config, because each leg needs its own with the newest handle baked in.

    What survives a swap and what does not is the whole design:

      * `read_from_browser` is created ONCE. It owns `websocket.receive()`, and
        restarting it would drop microphone frames and race the socket.
      * `mic_queue` is created ONCE, so audio spoken during the handover waits
        rather than being thrown away.
      * The two pumps that talk to Gemini are rebuilt per leg, because they
        hold a session that no longer exists.
    """
    state = _BridgeState()
    mic_queue: asyncio.Queue[bytes | None] = asyncio.Queue(maxsize=256)
    #: The leg currently in use. A one-element box rather than a closure
    #: variable so `read_from_browser`, created before the first leg exists,
    #: can still reach whichever session is live when a `start` arrives.
    current: list[object] = [None]

    async def next_mic_chunk() -> bytes | None:
        return await mic_queue.get()

    async def read_from_browser() -> None:
        """The browser side. Runs for the whole lesson, across every leg."""
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                break

            if (data := message.get("bytes")) is not None:
                await mic_queue.put(data)
                continue

            if (text := message.get("text")) is None:
                continue
            try:
                control = json.loads(text)
            except ValueError:
                continue

            action = control.get("type")
            if action == "start":
                # REMEMBERED, NOT DROPPED. The browser sends this on `ready`,
                # which only goes out once a leg is open — but a `start` that
                # arrived a moment early used to vanish, and a lesson whose
                # opening nudge was silently discarded is a tutor that never
                # speaks. The leg fires it instead when it opens.
                state.start_requested = True
                session = current[0]
                if session is not None and not state.lecture_started:
                    state.lecture_started = True
                    await gemini_live.start_lecture(session)
            elif action == "stop":
                state.student_stopped = True
                break

        await mic_queue.put(None)

    browser_task = asyncio.create_task(read_from_browser())
    announced = False

    try:
        while True:
            try:
                async with gemini_live.open_session(
                    config_for(state.handle)
                ) as session:
                    current[0] = session
                    leg_started = asyncio.get_running_loop().time()

                    if state.start_requested and not state.lecture_started:
                        # A `start` that arrived before this leg existed. Never
                        # on a RESUMED leg: `lecture_started` stays true for
                        # the whole lesson, so the opening lecture is nudged
                        # exactly once however many connections it takes.
                        state.lecture_started = True
                        await gemini_live.start_lecture(session)

                    if not announced:
                        # ONCE PER LESSON. The browser was told the sample
                        # rates and the module when the call began and is still
                        # connected; a second `ready` would look to the page
                        # like a brand new session starting.
                        announced = True
                        await _send_json_safe(
                            websocket,
                            {
                                "type": "ready",
                                "output_sample_rate": gemini_live.OUTPUT_SAMPLE_RATE,
                                "input_sample_rate": gemini_live.INPUT_SAMPLE_RATE,
                                "model": settings.gemini_model,
                                **(ready_payload or {}),
                            },
                        )

                    async def pump_mic() -> None:
                        await gemini_live.pump_to_gemini(session, next_mic_chunk)

                    async def write_to_browser() -> None:
                        async for event in gemini_live.stream_from_gemini(session):
                            if websocket.client_state is not WebSocketState.CONNECTED:
                                break

                            if event.type == "audio" and event.audio:
                                try:
                                    await websocket.send_bytes(event.audio)
                                except (WebSocketDisconnect, RuntimeError):
                                    break
                                continue

                            if event.type == "interrupted" and on_interrupted is not None:
                                await on_interrupted()

                            if event.type == "transcript" and on_transcript is not None:
                                await on_transcript(event.payload)

                            if event.type == "turn_complete" and on_turn_complete is not None:
                                await on_turn_complete()

                            if event.type == "resumption_handle":
                                # A credential, not content: kept, never
                                # forwarded. This is the ticket the next leg
                                # is opened with.
                                state.handle = str(event.payload["handle"])
                                if on_resumption_handle is not None:
                                    await on_resumption_handle(state.handle)
                                continue

                            if event.type == "go_away":
                                # Gemini's one-minute warning before it closes
                                # this leg. OUR business, not the student's —
                                # forwarding it only gave the page a message it
                                # ignored. Logged, because a lesson that never
                                # sees one is a lesson that will end abruptly.
                                logger.info(
                                    "Gemini leg closing in %s; will resume",
                                    event.payload.get("time_left"),
                                )
                                continue

                            sent = await _send_json_safe(
                                websocket, {"type": event.type, **event.payload}
                            )
                            if not sent:
                                break

                    tasks = [
                        asyncio.create_task(pump_mic()),
                        asyncio.create_task(write_to_browser()),
                    ]
                    try:
                        done, _ = await asyncio.wait(
                            [*tasks, browser_task],
                            return_when=asyncio.FIRST_COMPLETED,
                        )
                    finally:
                        # CANCELLED HOWEVER WE LEAVE, and cancelled
                        # SYNCHRONOUSLY before anything is awaited.
                        #
                        # `asyncio.wait` does not touch the tasks it was
                        # watching when the coroutine awaiting it is cancelled
                        # — and the session's time cap is exactly that: a
                        # `wait_for` around this whole bridge. So a lesson that
                        # ran its full ninety minutes told the student the time
                        # was up, closed their socket, and left these two
                        # running against a Gemini connection that was still
                        # open and still billing. Nothing stopped them but the
                        # process ending.
                        #
                        # Cancelling inside `finally`, with a plain `.cancel()`
                        # first, is what makes that impossible: a second
                        # cancellation arriving mid-cleanup can interrupt the
                        # await below, but never the cancel above it.
                        for task in tasks:
                            task.cancel()
                        for task in tasks:
                            # ONE CHUNK MAY BE LOST HERE — the frame `pump_mic`
                            # had already taken from the queue and was sending
                            # when it was cancelled. Gemini's own guidance is
                            # that partial audio around a resume point is not
                            # needed; a fraction of a second at the handover is
                            # the price of not holding a dead session open.
                            await gemini_live.drain_with_timeout(task)
                    # The browser side is checked FIRST and on its own. Its
                    # failures are not Gemini's: letting one fall through to
                    # the handler below would log "Gemini leg failed" for a
                    # dropped browser and count it against the reconnect
                    # budget, which is a misleading log and a wrong number.
                    if browser_task in done and not browser_task.cancelled():
                        if (error := browser_task.exception()) is not None:
                            raise error

                    for task in tasks:
                        if task in done and not task.cancelled():
                            if (error := task.exception()) is not None:
                                raise error

                    # A LEG IS ONLY HEALTHY IF IT LASTED. Reaching here means
                    # it ended without raising, which is what Gemini's own
                    # ten-minute cap looks like — and also what a handle it
                    # accepts and then drops looks like, one second in.
                    #
                    # Unless the student ended it. Someone who starts a lesson
                    # and closes the tab four seconds later has not caused a
                    # fault, and logging one every time they do buries the real
                    # ones.
                    if state.student_stopped or browser_task.done():
                        pass
                    elif (
                        asyncio.get_running_loop().time() - leg_started
                        >= MIN_HEALTHY_LEG_SECONDS
                    ):
                        state.failures = 0
                    else:
                        state.failures += 1
                        logger.warning(
                            "Gemini leg ended after under %ds (%d in a row)",
                            MIN_HEALTHY_LEG_SECONDS,
                            state.failures,
                        )
            except (GeminiNotConfiguredError, WebSocketDisconnect):
                raise
            except Exception:
                # A leg that would not open, or died mid-flight. Counted, not
                # fatal: the next pass through `should_resume` decides whether
                # to try again or to stop and say so.
                state.failures += 1
                logger.warning(
                    "Gemini leg failed (%d in a row)", state.failures, exc_info=True
                )
            finally:
                current[0] = None

            decision = gemini_live.should_resume(
                handle=state.handle,
                student_stopped=state.student_stopped,
                browser_connected=(
                    websocket.client_state is WebSocketState.CONNECTED
                    and not browser_task.done()
                ),
                consecutive_failures=state.failures,
            )
            if not decision.should_resume:
                state.ended_because = decision.reason
                break

            logger.info("Resuming the lesson on a fresh Gemini connection")

        if state.ended_because:
            # Said plainly rather than left as silence. Reuses the type the
            # page already treats as "this ended and nothing is broken",
            # because from the student's side that is exactly what happened.
            await _send_json_safe(
                websocket, {"type": "session_limit", "message": state.ended_because}
            )
    finally:
        if not browser_task.done():
            await gemini_live.drain_with_timeout(browser_task)
        elif (error := browser_task.exception()) is not None:
            raise error


@router.websocket("/ws/test")
async def voice_test_session(websocket: WebSocket) -> None:
    """Step-3 harness: a hardcoded lesson, nothing persisted.

    Admin-only, and refused outright in production.

    It used to be open to anyone. That made it a way for a stranger to open
    paid Gemini sessions on our key, without an account, as often as they
    liked — the client-side route guard on /voice-test is presentation, not
    authorisation, and the socket could be dialled directly. It stays because
    proving the voice loop against a known lesson, with no module or enrolment
    in the way, is genuinely useful when something breaks.
    """
    await websocket.accept()

    if settings.is_production:
        await _send_json_safe(
            websocket,
            {"type": "error", "message": "The test harness is disabled here."},
        )
        await websocket.close(code=1008)
        return

    if SessionLocal is None:
        await _send_json_safe(
            websocket,
            {"type": "error", "message": "Database is not configured."},
        )
        await websocket.close(code=1011)
        return

    async with SessionLocal() as db:
        websocket.state.db_session = db
        user = await _authenticate(websocket)

    if user is None or user.role is not UserRole.ADMIN:
        await _send_json_safe(
            websocket,
            {
                "type": "error",
                "message": "Sign in as an admin to use the test harness.",
            },
        )
        await websocket.close(code=1008)
        return

    if not settings.gemini_api_key:
        await _send_json_safe(
            websocket,
            {
                "type": "error",
                "message": (
                    "GEMINI_API_KEY is not set on the backend. Add it to "
                    "backend/.env and restart the service."
                ),
            },
        )
        await websocket.close(code=1011)
        return

    # A factory, not a config: each leg of the lesson needs its own, built
    # with the newest resumption handle. See `_run_bridge`.
    instruction = gemini_live.module_system_instruction(
        _TEST_MODULE_TITLE, _TEST_MODULE_CONTENT
    )

    def config(handle: str | None):
        return gemini_live.build_config(instruction, resumption_handle=handle)

    try:
        await _run_bridge(websocket, config)
    except GeminiNotConfiguredError as exc:
        await _send_json_safe(websocket, {"type": "error", "message": str(exc)})
    except WebSocketDisconnect:
        logger.info("Voice test client disconnected")
    except Exception:
        logger.exception("Voice test session failed")
        await _send_json_safe(
            websocket,
            {
                "type": "error",
                "message": "The voice session ended unexpectedly. Check backend logs.",
            },
        )
    finally:
        if websocket.client_state is WebSocketState.CONNECTED:
            await websocket.close()


@router.websocket("/ws/module/{module_id}")
async def voice_module_session(websocket: WebSocket, module_id: uuid.UUID) -> None:
    """The real tutoring session: grounded in one module, transcripts saved."""
    await websocket.accept()

    if SessionLocal is None:
        await _send_json_safe(
            websocket,
            {"type": "error", "message": "Database is not configured."},
        )
        await websocket.close(code=1011)
        return

    async with SessionLocal() as db:
        websocket.state.db_session = db

        user = await _authenticate(websocket)
        if user is None:
            await _send_json_safe(
                websocket,
                {"type": "error", "message": "Please sign in to start a session."},
            )
            await websocket.close(code=1008)
            return

        try:
            module = await course_service.get_module(db, module_id)
        except course_service.ModuleNotFoundError:
            await _send_json_safe(
                websocket, {"type": "error", "message": "Module not found."}
            )
            await websocket.close(code=1008)
            return

        # Checked again here, not just at enrolment. Enrolment happened once,
        # possibly before a refund; this endpoint spends real AI budget on
        # every session, so it re-derives the right to be here each time.
        course_for_access = await course_service.get_course(db, module.course_id)
        decision = await access.can_access_course(db, user, course_for_access)
        if not decision.allowed:
            await _send_json_safe(
                websocket,
                {
                    "type": "error",
                    "message": "Buy this course, or subscribe, to use the tutor.",
                },
            )
            await websocket.close(code=1008)
            return

        # Enrolment governs the tutor, not reading. A student who is not
        # enrolled can still read the module; they just cannot spend AI budget
        # on it.
        if not await enrollment_service.is_enrolled(db, user.id, module.course_id):
            await _send_json_safe(
                websocket,
                {
                    "type": "error",
                    "message": "Enrol in this course to use the AI tutor.",
                },
            )
            await websocket.close(code=1008)
            return

        # THE ORGANIZATION'S AI BUDGET. Last of the gates, and deliberately
        # checked when the session OPENS rather than while it runs: a lesson
        # that cuts out mid-sentence because a counter ticked over is worse
        # than one that will not start, and the overshoot is bounded by
        # Gemini's own ~10-minute connection cap.
        #
        # A public B2C user has no organization and no cap — what they may use
        # is decided by what they bought.
        try:
            await limits.assert_ai_available(db, user)
        except limits.LimitReached as exc:
            await _send_json_safe(websocket, {"type": "error", "message": str(exc)})
            await websocket.close(code=1008)
            return

        # HOW MANY TIMES THIS MODULE MAY BE PLAYED, and for how long.
        #
        # Free courses get fewer plays than paid ones, and a super admin can
        # set either per course; `limits.tutor_allowance_for` is where that is
        # decided. Before this there was no cap of any kind on a public
        # learner: the free course — the one given away — had unmetered access
        # to the most expensive thing the product does.
        #
        # Checked here, alongside the organization's budget, for the same
        # reason: refusing to start is kinder than cutting out mid-lecture.
        try:
            # `course_for_access`, loaded above for the paywall check — the
            # `course` further down is the same row fetched a second time.
            allowance = await limits.assert_tutor_play_available(
                db, user, course_for_access, module.id
            )
        except limits.LimitReached as exc:
            await _send_json_safe(websocket, {"type": "error", "message": str(exc)})
            await websocket.close(code=1008)
            return

        if not module.content or not module.content.strip():
            await _send_json_safe(
                websocket,
                {
                    "type": "error",
                    "message": (
                        "This module has no content yet, so the tutor has "
                        "nothing to teach from."
                    ),
                },
            )
            await websocket.close(code=1008)
            return

        if not settings.gemini_api_key:
            await _send_json_safe(
                websocket,
                {
                    "type": "error",
                    "message": (
                        "GEMINI_API_KEY is not set on the backend. Add it to "
                        "backend/.env and restart the service."
                    ),
                },
            )
            await websocket.close(code=1011)
            return

        course = await course_service.get_course(db, module.course_id)

        # WHERE THIS LESSON SITS, so the tutor can open by saying so. "Module
        # three of eight" is the most orienting sentence a student hears all
        # lesson, and without it the tutor could only begin mid-topic.
        #
        # `order` is zero-based in the database and one-based out loud — the
        # difference between "module zero" and a sentence a person would say.
        module_count = await db.scalar(
            select(func.count())
            .select_from(Module)
            .where(Module.course_id == module.course_id)
        )
        instruction = gemini_live.module_system_instruction(
            module.title,
            module.content,
            course.title,
            # Greeting somebody by name is most of what makes a greeting warm,
            # and it costs one column we already have.
            student_name=user.name,
            course_description=course.description,
            module_number=module.order + 1,
            module_count=module_count,
        )

        def config(handle: str | None):
            """One config per leg, carrying the newest handle.

            The instruction is rebuilt identically each time on purpose: Gemini
            pins it ahead of the compression window, so it is what stops a long
            lesson forgetting which module it is teaching.

            The voice is repeated for the same reason. A resumed leg is a new
            connection, and one that did not name it would finish the lesson in
            a different voice from the one it started in.
            """
            return gemini_live.build_config(
                instruction,
                resumption_handle=handle,
                voice=user.tutor_voice,
            )

        # ONE LIVE SESSION PER STUDENT, and the newest tab wins.
        #
        # Five tabs on the same module used to open five Gemini sessions, each
        # billed by the minute against our key. Taking over rather than
        # refusing, because the realistic cause is a stale tab and refusing
        # would lock somebody out of their own lesson until Gemini's ~10-minute
        # connection cap expired. See `services/live_sessions`.
        #
        # Claimed BEFORE the row is written and before Gemini is dialled, so
        # the displaced session stops spending at the earliest possible moment.
        await live_sessions.claim(user.id, websocket)

        # And close the rows those sessions left open, so the AI-minute
        # accounting does not quietly under-report. Also sweeps rows orphaned
        # by a restart.
        await voice_sessions.close_open_sessions_for(db, user.id)

        record = await voice_sessions.start_session(
            db,
            user_id=user.id,
            module_id=module.id,
            model_name=settings.gemini_model,
        )
        await enrollment_service.mark_module_started(db, user.id, module.id)

        buffer = voice_sessions.TranscriptBuffer()

        async def flush() -> None:
            for turn in buffer.take_all():
                await voice_sessions.append_turn(
                    db,
                    voice_session_id=record.id,
                    role=turn.role,
                    text=turn.text,
                    is_interruption=turn.is_interruption,
                )

        async def on_transcript(payload: dict) -> None:
            role = (
                TranscriptRole.USER
                if payload.get("role") == "user"
                else TranscriptRole.MODEL
            )
            buffer.add(role, str(payload.get("text", "")))
            # `final` is honoured when Gemini sends it, but it cannot be relied
            # on: measured against the live API, output transcriptions arrive
            # with `finished` unset for the whole session. Flushing only on it
            # merged the lecture and the answer to the interrupting question
            # into a single row, and applied the lecture's `is_interruption`
            # flag to both. `turn_complete` below is the boundary that is
            # actually delivered.
            if payload.get("final"):
                turn = buffer.take(role)
                if turn is not None:
                    await voice_sessions.append_turn(
                        db,
                        voice_session_id=record.id,
                        role=turn.role,
                        text=turn.text,
                        is_interruption=turn.is_interruption,
                    )

        # Counts a turn only once the tutor has actually finished one, so a
        # session that never produced a lecture cannot complete the module.
        tutor_turns = 0

        async def on_turn_complete() -> None:
            """One row per turn, with its own interruption flag."""
            nonlocal tutor_turns
            tutor_turns += 1
            await flush()

        async def on_interrupted() -> None:
            buffer.mark_interrupted()

        async def on_handle(handle: str) -> None:
            await voice_sessions.save_resumption_handle(db, record.id, handle)

        started_at = asyncio.get_running_loop().time()

        try:
            # THE TIME CAP, and now the only one that decides how long a
            # lesson lasts. Gemini's ten-minute connection limit used to end
            # sessions early; `_run_bridge` resumes past it, so this allowance
            # — thirty minutes free, ninety paid, or whatever a super admin
            # set on the course — is what a student actually gets, and when it
            # runs out the session ends itself rather than running forever.
            #
            # `wait_for` rather than a counter inside the loop: the bridge is
            # two long-lived pumps, and a timeout imposed from outside cancels
            # both without either having to check a clock between frames.
            await asyncio.wait_for(
                _run_bridge(
                    websocket,
                    config,
                    on_transcript=on_transcript,
                    on_interrupted=on_interrupted,
                    on_turn_complete=on_turn_complete,
                    on_resumption_handle=on_handle,
                    ready_payload={
                        "module": {
                            "id": str(module.id),
                            "title": module.title,
                            "course_title": course.title,
                        },
                        "voice_session_id": str(record.id),
                        # So the student can see what they have, rather than
                        # discovering the cap when the lesson stops.
                        "limits": {
                            "minutes_per_session": allowance.minutes_per_session,
                            "sessions_per_module": allowance.sessions_per_module,
                            "sessions_used": await limits.tutor_plays_used(
                                db, user.id, module.id
                            ),
                        },
                    },
                ),
                timeout=allowance.minutes_per_session * 60,
            )
        except TimeoutError:
            # Not an error, and it must not read as one. The lesson ran its
            # full length; saying so is the difference between "your time is
            # up" and "something broke".
            logger.info(
                "Voice session hit its %d minute cap (session=%s)",
                allowance.minutes_per_session,
                record.id,
            )
            await _send_json_safe(
                websocket,
                {
                    "type": "session_limit",
                    "message": (
                        f"That is the {allowance.minutes_per_session} minutes "
                        f"this session allows. The transcript is saved below."
                    ),
                },
            )
        except WebSocketDisconnect:
            logger.info("Voice client disconnected (session=%s)", record.id)
        except Exception:
            logger.exception("Voice session failed (session=%s)", record.id)
            await _send_json_safe(
                websocket,
                {
                    "type": "error",
                    "message": "The voice session ended unexpectedly.",
                },
            )
        finally:
            # Released before anything else in teardown: whatever happens
            # below, this student must not be left holding a slot. `release`
            # checks identity, so a tab that was already displaced does not
            # remove the claim belonging to the tab that displaced it.
            await live_sessions.release(user.id, websocket)

            # Flush whatever was mid-turn when the call dropped, so an
            # interrupted lecture still leaves a record.
            await flush()
            await voice_sessions.end_session(db, record.id)

            # Nothing used to move a module past "in progress", so every module
            # a student ever opened stayed there and course percentages never
            # advanced. A session that ran long enough and produced at least
            # one finished tutor turn now completes it.
            seconds = asyncio.get_running_loop().time() - started_at
            try:
                if await enrollment_service.complete_module_if_earned(
                    db,
                    user.id,
                    module.id,
                    seconds_listened=seconds,
                    tutor_turns=tutor_turns,
                ):
                    logger.info(
                        "Module completed (user=%s module=%s after %.0fs, %d turns)",
                        user.id,
                        module.id,
                        seconds,
                        tutor_turns,
                    )
            except Exception:
                # Progress bookkeeping must never take the session down with it.
                logger.exception("Could not update progress (session=%s)", record.id)
            if websocket.client_state is WebSocketState.CONNECTED:
                await websocket.close()
