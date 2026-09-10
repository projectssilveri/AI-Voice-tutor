"use client";

/**
 * Drives one Gemini Live session from the browser.
 *
 * The interrupt path is the reason this hook exists as its own unit: when the
 * server says `interrupted`, playback must be flushed synchronously, before
 * React re-renders anything. Anything slower and the tutor keeps talking over
 * the student.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  MicCapture,
  PcmPlayer,
  readAmplitude,
} from "@/components/voice-session/audio";
import { env } from "@/lib/env";

export type VoiceState =
  | "idle"
  | "connecting"
  | "speaking"
  | "listening"
  | "thinking"
  | "interrupted"
  | "superseded"
  | "error";

/**
 * Live analyser nodes for whatever is currently making sound.
 *
 * Handed out through a getter rather than as state, because both sides can be
 * replaced mid-session: the player is rebuilt if the server reports a
 * different sample rate, and the microphone only exists once permission has
 * been granted. A component that captured either node once would go on reading
 * a detached node and show a flat line while audio was plainly playing.
 *
 * Either side is null when that device is not open.
 */
export interface VoiceAnalysers {
  /** The tutor's output. */
  ai: AnalyserNode | null;
  /** The student's microphone. */
  mic: AnalyserNode | null;
}

export interface TranscriptLine {
  id: number;
  role: "user" | "model";
  text: string;
  final: boolean;
  interruption?: boolean;
}

interface ServerControlMessage {
  type: string;
  role?: "user" | "model";
  text?: string;
  final?: boolean;
  message?: string;
  output_sample_rate?: number;
}

/** How long the "interrupted" flash shows before switching to listening. */
const INTERRUPT_FLASH_MS = 400;

/**
 * How far ahead of the voice a caption appears, in seconds.
 *
 * Subtitles that trail the audio read as lag; a small lead reads as in-sync.
 */
const CAPTION_LEAD_S = 0.4;

export interface VoiceSessionOptions {
  /**
   * Module to be taught. Omitted for the step-3 harness, which runs against a
   * hardcoded lesson with no auth and no persistence.
   */
  moduleId?: string;
}

/**
 * Smallest level change worth re-rendering the whole page for.
 *
 * The animation loop runs at the display's refresh rate and used to call
 * `setAiLevel` and `setMicLevel` unconditionally on every frame — two state
 * updates about 120 times a second, each one re-rendering the lesson page and
 * everything under it, for a number that mostly wobbles in the third decimal
 * place. The visualiser now reads the analysers directly and never re-renders
 * at all, so these two values exist only for callers without a canvas; a
 * coarse quantisation is plenty for them and takes the render load with it.
 */
const LEVEL_STEP = 0.04;

/** Push a level into React state only when it has visibly moved. */
function publishLevel(
  level: number,
  last: { current: number },
  set: (value: number) => void,
): void {
  // Silence is published exactly, so a meter parks at zero rather than at
  // whatever was under the threshold when the sound stopped.
  const next = level < LEVEL_STEP / 2 ? 0 : level;
  if (Math.abs(next - last.current) < LEVEL_STEP && next !== 0) return;
  if (next === last.current) return;
  last.current = next;
  set(next);
}

export function useVoiceSession({ moduleId }: VoiceSessionOptions = {}) {
  const [state, setState] = useState<VoiceState>("idle");
  const [error, setError] = useState<string | null>(null);
  // Why this tab stood down. Separate from `error` because nothing failed —
  // the screen says so in different words and offers a different way out.
  const [supersededMessage, setSupersededMessage] = useState<string | null>(
    null,
  );
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [aiLevel, setAiLevel] = useState(0);
  const [micLevel, setMicLevel] = useState(0);
  const [interruptCount, setInterruptCount] = useState(0);
  // Whether the browser confirmed it is filtering background noise on the
  // student's microphone. False until a session is running and the track
  // has actually said so.
  const [noiseSuppressed, setNoiseSuppressed] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const playerRef = useRef<PcmPlayer | null>(null);
  const micRef = useRef<MicCapture | null>(null);
  const rafRef = useRef<number | null>(null);
  // Reused by `getAnalysers` so the visualiser's per-frame call allocates
  // nothing. Mutated in place; never handed out as a snapshot.
  const analysersRef = useRef<VoiceAnalysers>({ ai: null, mic: null });
  // The last level actually pushed into React state — see the note where the
  // levels are set in the animation loop.
  const publishedAiRef = useRef(0);
  const publishedMicRef = useRef(0);
  const lineIdRef = useRef(0);
  const interruptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read inside the animation loop, which must not re-subscribe every render.
  const stateRef = useRef<VoiceState>("idle");
  stateRef.current = state;
  // The server reports the root cause (a missing API key, say) as soon as the
  // socket opens. A mic failure a moment later must not overwrite it — the
  // first error is the one worth showing.
  const errorRef = useRef<string | null>(null);
  errorRef.current = error;

  const reportError = useCallback((message: string) => {
    if (errorRef.current) return;
    errorRef.current = message;
    setError(message);
    setState("error");
  }, []);

  /**
   * The analyser nodes, read fresh on every call.
   *
   * Stable identity (no dependencies), so a component can put it in an effect's
   * dependency array without restarting its animation loop every render — and
   * it reads the refs at call time, so a player replaced mid-session is picked
   * up on the next frame with no re-subscription.
   */
  const getAnalysers = useCallback((): VoiceAnalysers => {
    const nodes = analysersRef.current;
    nodes.ai = playerRef.current?.analyserNode ?? null;
    nodes.mic = micRef.current?.analyserNode ?? null;
    return nodes;
  }, []);

  /**
   * Tutor captions waiting for the voice to catch up.
   *
   * Gemini generates a turn's audio roughly twice as fast as it plays, so
   * transcript fragments arrive far ahead of the speech. Appending them on
   * arrival made the caption feed race to the end of the turn and then sit
   * frozen while the tutor was still talking. Each fragment is instead stamped
   * with the playback position it belongs to and released by the animation
   * loop below. Student captions are not queued — there is no audio of theirs
   * to stay in step with.
   */
  const pendingCaptionsRef = useRef<{ text: string; playAt: number }[]>([]);
  /** Set by turn_complete; acted on once the queued captions have drained. */
  const closeLineWhenDrainedRef = useRef(false);

  const finaliseOpenLine = useCallback(() => {
    setTranscript((lines) => {
      const last = lines[lines.length - 1];
      if (!last || last.final) return lines;
      const amended = [...lines];
      amended[amended.length - 1] = { ...last, final: true };
      return amended;
    });
  }, []);

  const appendTranscript = useCallback(
    (role: "user" | "model", text: string, final: boolean) => {
      setTranscript((lines) => {
        const last = lines[lines.length - 1];
        // Gemini streams partial transcripts; keep amending the open line for
        // this speaker instead of emitting one line per fragment.
        if (last && last.role === role && !last.final) {
          const amended = [...lines];
          amended[amended.length - 1] = {
            ...last,
            text: last.text + text,
            final,
          };
          return amended;
        }
        return [...lines, { id: lineIdRef.current++, role, text, final }];
      });
    },
    [],
  );

  /**
   * Give back the microphone, the speaker and the animation loop.
   *
   * Separate from `stop()` because the session can also end from the far side
   * — the lesson's own time allowance runs out, or the backend or the network
   * drops. (Gemini's ten-minute connection cap used to end it here too; the
   * backend now replaces its own connection behind this socket, so that one no
   * longer reaches the page.) `onclose` only set the state to idle, so
   * everything below stayed live: the browser kept RECORDING, with its
   * recording indicator lit, an AudioContext stayed open, and a
   * requestAnimationFrame loop ran for as long as the tab did. The student saw
   * "Idle" while their microphone was still on.
   *
   * Deliberately touches no state except the levels, so the caller decides
   * what the screen should say.
   *
   * MUST be safe to call twice at once. Pressing Stop does exactly that:
   * `stop()` calls this AND closes the socket, whose `onclose` calls it again a
   * moment later. Both used to read `micRef.current` before either had nulled
   * it, so both closed the same AudioContext — and closing one twice throws
   * `InvalidStateError`. The refs are therefore claimed synchronously, before
   * the first await, so whichever call arrives second sees null and does
   * nothing.
   */
  const releaseDevices = useCallback(async () => {
    if (interruptTimerRef.current) clearTimeout(interruptTimerRef.current);
    interruptTimerRef.current = null;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    // Anything still queued is audio that will never play now.
    pendingCaptionsRef.current = [];
    closeLineWhenDrainedRef.current = false;

    const mic = micRef.current;
    micRef.current = null;
    const player = playerRef.current;
    playerRef.current = null;

    // Both the state and the "last published" marks, or the first frame of the
    // next session would be compared against a stale value and skipped.
    publishedAiRef.current = 0;
    publishedMicRef.current = 0;
    setAiLevel(0);
    setMicLevel(0);
    setNoiseSuppressed(false);
    analysersRef.current.ai = null;
    analysersRef.current.mic = null;

    await mic?.stop();
    await player?.close();
  }, []);

  const stop = useCallback(async () => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "stop" }));
      socketRef.current.close();
    }
    socketRef.current = null;

    await releaseDevices();
    setState("idle");
  }, [releaseDevices]);

  const start = useCallback(async () => {
    setError(null);
    setSupersededMessage(null);
    errorRef.current = null;
    setTranscript([]);
    pendingCaptionsRef.current = [];
    closeLineWhenDrainedRef.current = false;
    setInterruptCount(0);
    setState("connecting");

    try {
      const player = new PcmPlayer();
      await player.resume();
      playerRef.current = player;

      // The module endpoint authenticates via the session cookie, loads the
      // module's content as the tutor's grounding, and persists the transcript.
      const path = moduleId
        ? `/api/v1/voice/ws/module/${moduleId}`
        : "/api/v1/voice/ws/test";
      const socket = new WebSocket(`${env.wsBaseUrl}${path}`);
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;

      socket.onmessage = (event) => {
        // Binary frames are tutor audio.
        if (event.data instanceof ArrayBuffer) {
          playerRef.current?.enqueue(event.data);
          return;
        }

        let message: ServerControlMessage;
        try {
          message = JSON.parse(event.data as string);
        } catch {
          return;
        }

        switch (message.type) {
          case "ready": {
            // The server reports the rate its model actually returns. This was
            // ignored, with 24 kHz hardcoded on this side — and the API docs
            // warning about Gemini Live being preview ("do not hardcode
            // assumptions") is exactly this case: a model whose output rate
            // differed would have played back at the wrong speed, sounding
            // chipmunked or slowed, with nothing in the logs to say why.
            //
            // An AudioContext's rate is fixed once constructed, so honouring a
            // different one means building a new player. Safe here: `ready`
            // arrives before the first audio frame.
            const reported = message.output_sample_rate;
            if (
              typeof reported === "number" &&
              reported > 0 &&
              playerRef.current &&
              reported !== playerRef.current.sampleRate
            ) {
              void playerRef.current.close();
              const replacement = new PcmPlayer(reported);
              void replacement.resume();
              playerRef.current = replacement;
            }
            setState("thinking");
            socket.send(JSON.stringify({ type: "start" }));
            break;
          }

          case "interrupted": {
            // THE critical path. Drop every queued chunk before doing anything
            // else — no awaits, no state updates first.
            playerRef.current?.flush();
            // Captions still waiting describe audio that was just cancelled and
            // will never be heard. Showing them would put words in the tutor's
            // mouth that it never said.
            pendingCaptionsRef.current = [];
            closeLineWhenDrainedRef.current = false;
            setInterruptCount((n) => n + 1);
            setTranscript((lines) => {
              const last = lines[lines.length - 1];
              if (last && last.role === "model") {
                const amended = [...lines];
                amended[amended.length - 1] = {
                  ...last,
                  final: true,
                  interruption: true,
                };
                return amended;
              }
              return lines;
            });
            setState("interrupted");
            if (interruptTimerRef.current)
              clearTimeout(interruptTimerRef.current);
            interruptTimerRef.current = setTimeout(
              () => setState("listening"),
              INTERRUPT_FLASH_MS,
            );
            break;
          }

          case "transcript":
            if (message.role && typeof message.text === "string") {
              if (message.role === "user") {
                // Nothing to synchronise against — show it as it arrives.
                appendTranscript("user", message.text, Boolean(message.final));
              } else {
                // `queuedUntil` is where the audio for this fragment ends, so
                // subtracting its own duration is not possible here; releasing
                // on the queue position is close enough to read as in-sync,
                // and never runs ahead of the voice.
                pendingCaptionsRef.current.push({
                  text: message.text,
                  playAt: playerRef.current?.queuedUntil ?? 0,
                });
              }
            }
            break;

          case "turn_complete":
            // Close the open caption line so the next turn starts its own.
            // Gemini does not set `final` on output transcriptions — measured
            // against the live API — so without this the whole session would
            // accumulate into one block, exactly as it did server-side.
            //
            // Deferred rather than immediate: generation finishes well before
            // playback does, so there are usually captions still queued. The
            // line is closed once they have been released.
            closeLineWhenDrainedRef.current = true;
            setState("listening");
            break;

          case "superseded":
            // NOT an error. The student opened this lesson in another tab, so
            // this one stood down — see `services/live_sessions` for why the
            // newest tab wins. Handing the microphone back immediately matters
            // more than the message: two tabs both holding the mic is what the
            // recording indicator would show otherwise.
            setSupersededMessage(
              message.message ??
                "This lesson was opened in another tab, so this one stopped.",
            );
            setState("superseded");
            void releaseDevices();
            break;

          // THE LESSON IS OVER, AND NOTHING IS BROKEN. Two endings arrive
          // here, and both are ordinary:
          //
          //   * the time ran out — the lecture happened, the transcript is
          //     saved, and the only thing that changed is the clock
          //   * the tutor could not get its connection back after several
          //     tries, so the backend stopped rather than leaving this page
          //     silent forever
          //
          // Its own message type for exactly that reason: routing either
          // through `error` would put a red banner on a lesson that worked.
          // The server writes the sentence, because only it knows which of
          // the two happened.
          case "session_limit":
            setSupersededMessage(
              message.message ??
                "That is all the time this session allows. The transcript is saved.",
            );
            setState("superseded");
            void releaseDevices();
            break;

          case "error":
            reportError(message.message ?? "Unknown error");
            break;
        }
      };

      socket.onerror = () => {
        // Same split as `lib/auth.ts`: the address and the cause go to the
        // console, the student gets a sentence about their lesson.
        console.error(`[voice] websocket failed (${env.wsBaseUrl})`);
        reportError(
          "The tutor could not be reached. Check your connection and start the lesson again.",
        );
      };

      socket.onclose = () => {
        socketRef.current = null;
        // The far side hung up. Hand the microphone back before anything else.
        //
        // This used to fire on Gemini's ~10 minute connection cap, and the
        // note here called that "the ordinary end of a long lesson". It is
        // not any more: the backend now replaces its own connection to Gemini
        // behind this socket, so a lesson runs its full allowance and THIS
        // socket closing means the lesson is genuinely over — the student
        // stopped it, the time ran out, or the page is going away.
        void releaseDevices();
        // "superseded" is preserved for the same reason "error" is: the
        // socket closing is the CONSEQUENCE of it, and resetting to idle here
        // would wipe the explanation a moment after showing it.
        if (stateRef.current !== "error" && stateRef.current !== "superseded") {
          setState("idle");
        }
      };

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Timed out connecting")),
          10_000,
        );
        socket.onopen = () => {
          clearTimeout(timer);
          resolve();
        };
      });

      // If the server already rejected the session, do not prompt for the
      // microphone — the permission dialog would be noise on top of a failure
      // the student can do nothing about.
      if (errorRef.current) {
        await stop();
        return;
      }

      const mic = new MicCapture();
      micRef.current = mic;
      await mic.start((pcm) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(pcm);
      });
      // Read back rather than assumed — the constraint we asked for is not
      // necessarily the one the device gave us.
      setNoiseSuppressed(mic.noiseSuppressed === true);

      // Drive the avatar from real amplitude rather than a decorative loop.
      const tick = () => {
        const player = playerRef.current;
        const micCapture = micRef.current;

        if (player) {
          const level = readAmplitude(player.analyserNode);
          publishLevel(level, publishedAiRef, setAiLevel);
          // Playing audio means the tutor is talking; the server's
          // turn_complete is too coarse to drive the avatar on its own.
          if (player.isPlaying && stateRef.current !== "interrupted") {
            setState("speaking");
          }

          // Release captions the voice has now reached. CAPTION_LEAD_S puts
          // the words on screen a beat before they are heard, which is how
          // subtitles are normally timed — trailing the audio reads as lag.
          const due = player.currentTime + CAPTION_LEAD_S;
          const pending = pendingCaptionsRef.current;
          let released = "";
          while (pending.length > 0 && pending[0].playAt <= due) {
            released += pending.shift()!.text;
          }
          if (released) appendTranscript("model", released, false);

          if (closeLineWhenDrainedRef.current && pending.length === 0) {
            closeLineWhenDrainedRef.current = false;
            finaliseOpenLine();
          }
        }
        if (micCapture?.analyserNode) {
          publishLevel(
            readAmplitude(micCapture.analyserNode),
            publishedMicRef,
            setMicLevel,
          );
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (caught) {
      reportError(
        caught instanceof Error
          ? caught.message
          : "Failed to start the session",
      );
      await stop();
      // stop() resets to idle; the error state is what the user needs to see.
      setState("error");
    }
  }, [
    appendTranscript,
    finaliseOpenLine,
    moduleId,
    releaseDevices,
    reportError,
    stop,
  ]);

  useEffect(() => {
    return () => {
      // Release the mic and socket if the page unmounts mid-session.
      void stop();
    };
  }, [stop]);

  return {
    state,
    error,
    supersededMessage,
    transcript,
    aiLevel,
    micLevel,
    /** For the visualiser, which reads the audio itself rather than via React. */
    getAnalysers,
    noiseSuppressed,
    interruptCount,
    start,
    stop,
  };
}
