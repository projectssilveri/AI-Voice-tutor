"use client";

import { memo, useEffect, useRef } from "react";

import type { TranscriptLine } from "@/components/voice-session/useVoiceSession";

/**
 * The live caption feed beside the avatar.
 *
 * MEMOISED, and that is the whole point of it being its own component. The
 * voice hook publishes `aiLevel` and `micLevel` from a requestAnimationFrame
 * loop, so the page re-renders roughly sixty times a second for as long as a
 * session is open — that is what drives the avatar from real amplitude rather
 * than a decorative loop, and it is worth the cost for the avatar itself.
 *
 * It is not worth it here. This list grows for the length of a lecture, and
 * rebuilding every line sixty times a second to animate a circle elsewhere on
 * the screen is work with no visible result. `memo` bounds the re-render to
 * the turns actually changing: the array identity only changes when a caption
 * is appended or a line is finalised.
 */
function TranscriptFeedInner({ transcript }: { transcript: TranscriptLine[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Follow the conversation. Lives here rather than in the page so it fires on
  // the same renders that actually change the list.
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [transcript]);

  return (
    <div
      ref={scrollRef}
      className="custom-scrollbar h-[26rem] space-y-3 overflow-y-auto pr-2"
      aria-live="polite"
      aria-label="Live transcript"
    >
      {transcript.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          The transcript appears here as both sides speak.
        </p>
      ) : (
        transcript.map((line) => (
          <div
            key={line.id}
            /* animate-fade-up on the turn itself, not on the list: a
               caption arrives mid-sentence and re-renders as it is
               transcribed, so animating the container would restart the
               animation on every fragment. Keyed by line id, which is stable
               for the life of a turn. */
            className={`animate-fade-up rounded-lg p-3 text-sm ${
              line.role === "user"
                ? "border-l-2 border-success-400 bg-success-50 text-gray-800 dark:bg-success-500/10 dark:text-white/90"
                : "border-l-2 border-brand-400 bg-gray-50 text-gray-800 dark:bg-white/[0.04] dark:text-white/90"
            }`}
          >
            <div className="mb-1 flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {line.role === "user" ? "You" : "Tutor"}
              </span>
              {line.interruption ? (
                <span className="rounded-full bg-error-100 px-2 py-0.5 text-[10px] font-medium text-error-700 dark:bg-error-500/20 dark:text-error-400">
                  cut off
                </span>
              ) : null}
            </div>
            {line.text}
          </div>
        ))
      )}
    </div>
  );
}

const TranscriptFeed = memo(TranscriptFeedInner);
export default TranscriptFeed;
