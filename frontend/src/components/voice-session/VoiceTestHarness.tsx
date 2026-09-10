"use client";

import { useEffect, useRef } from "react";

import VoiceAvatar from "@/components/voice-session/VoiceAvatar";
import { useVoiceSession } from "@/components/voice-session/useVoiceSession";

/**
 * The step 3 harness.
 *
 * Success criteria, straight from the brief:
 *   1. the tutor starts speaking on its own, unprompted
 *   2. you can talk over it mid-sentence
 *   3. it stops immediately and answers what you asked
 *
 * The interrupt counter exists so (2) and (3) are measurable rather than a
 * matter of opinion.
 */
export default function VoiceTestHarness() {
  const {
    state,
    error,
    transcript,
    aiLevel,
    micLevel,
    getAnalysers,
    noiseSuppressed,
    interruptCount,
    start,
    stop,
  } = useVoiceSession();

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-start gap-8 bg-white p-8 text-gray-900 dark:bg-gray-950 dark:text-white">
      <h1 className="text-2xl font-semibold tracking-tight">
        Voice tutor test page
      </h1>

      <VoiceAvatar
        state={state}
        aiLevel={aiLevel}
        micLevel={micLevel}
        getAnalysers={getAnalysers}
        noiseSuppressed={noiseSuppressed}
      />

      <div className="flex gap-4">
        <button
          onClick={start}
          disabled={state !== "idle"}
          className="rounded-lg bg-indigo-600 px-6 py-2 text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Start
        </button>
        <button
          onClick={stop}
          disabled={state === "idle"}
          className="rounded-lg bg-red-700 px-6 py-2 text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Stop
        </button>
      </div>

      {interruptCount > 0 && (
        <p className="text-sm text-brand-600 dark:text-brand-400">
          Interruptions registered: <strong>{interruptCount}</strong>
        </p>
      )}

      {error && (
        <p className="text-sm text-red-400 bg-red-950 px-4 py-2 rounded-lg max-w-lg text-center">
          {error}
        </p>
      )}

      {/* Live transcript */}
      <div className="flex h-72 w-full max-w-2xl flex-col gap-2 overflow-y-auto rounded-xl bg-gray-50 p-4 dark:bg-gray-900">
        {transcript.length === 0 ? (
          <p className="mt-4 text-center text-sm text-gray-500 dark:text-gray-400">
            Transcript will appear here once the session starts.
          </p>
        ) : (
          transcript.map((turn, i) => (
            <div
              key={i}
              className={`text-sm px-3 py-1.5 rounded-lg max-w-[85%] ${
                turn.role === "model"
                  ? "self-start bg-brand-50 text-gray-900 dark:bg-indigo-900/60 dark:text-white"
                  : "self-end bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-white"
              } ${turn.interruption ? "opacity-60 line-through" : ""}`}
            >
              <span className="mr-1 text-xs font-medium text-gray-600 dark:text-gray-400">
                {turn.role === "model" ? "Tutor" : "You"}
              </span>
              {turn.text}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <p className="max-w-lg text-center text-xs text-gray-600 dark:text-gray-400">
        Hardcoded lesson · no auth · no module lookup · no persistence. This
        page exists only to prove barge-in works in isolation.
      </p>
    </div>
  );
}
