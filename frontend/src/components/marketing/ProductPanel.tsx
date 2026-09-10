import Panel from "@/components/marketing/ui/Panel";

/**
 * A still of a real lesson, for the hero.
 *
 * Someone can read the whole old home page without ever seeing what a lesson
 * looks like. This is the fix, and it is the one thing on the page doing the
 * work that a product screenshot does on every good software site.
 *
 * IT IS DELIBERATELY NOT INTERACTIVE. There was an interactive demo here
 * before and it was removed at the user's request: it asked the reader to
 * perform a trick ("cut it off mid-sentence, go on") before it would show them
 * anything, which is a toll booth in front of your own pitch. A still shows
 * the same idea in the time it takes to glance at it.
 *
 * Everything here mirrors the real session UI so it reads as the product
 * rather than an artist's impression of it — brand blue for the tutor and
 * success green for the student, the same pairing `TranscriptFeed` uses, and
 * the same "cut off" badge in error red. If those colours change there, change
 * them here.
 *
 * A server component. No state, no hooks, no JavaScript shipped.
 */

/** One transcript turn. `cut` renders the interruption badge. */
const TURNS: {
  who: "Tutor" | "You";
  text: string;
  cut?: boolean;
}[] = [
  {
    who: "Tutor",
    text: "An array is an ordered list of values. The order is the point: each value sits at a position, and that position is how you get it back out again. So if we have a list of three course names…",
    cut: true,
  },
  { who: "You", text: "sorry, what do you mean by position?" },
  {
    who: "Tutor",
    text: "Good question. Position means the slot a value sits in, counted from zero. The first name is at position 0, the second at 1. Programmers call that the index.",
  },
  { who: "You", text: "got it, keep going" },
];

/** Bar heights and animation offsets for the waveform under the avatar. */
const BARS = [
  { h: "34%", delay: "0ms" },
  { h: "62%", delay: "120ms" },
  { h: "88%", delay: "60ms" },
  { h: "48%", delay: "220ms" },
  { h: "72%", delay: "160ms" },
  { h: "40%", delay: "300ms" },
  { h: "56%", delay: "90ms" },
];

export default function ProductPanel() {
  return (
    <Panel className="relative overflow-hidden border-white/10 bg-[var(--mk-raised)]/80 shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
      {/* Window bar. The module name is here rather than in the transcript
          because "which module am I in" is the question the real header
          answers, and it is what proves the tutor is scoped to one topic. */}
      <div className="flex items-center gap-3 border-b border-white/5 bg-white/[0.02] px-4 py-3 sm:px-5">
        <span className="flex gap-2" aria-hidden="true">
          <span className="size-2.5 rounded-full bg-rose-500/80 shadow-[0_0_8px_rgba(244,63,94,0.4)]" />
          <span className="size-2.5 rounded-full bg-amber-500/80 shadow-[0_0_8px_rgba(245,158,11,0.4)]" />
          <span className="size-2.5 rounded-full bg-emerald-500/80 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
        </span>
        <p className="truncate text-[13px] text-slate-400">
          JavaScript Foundations
          <span aria-hidden="true" className="mx-2 text-white/20">
            /
          </span>
          <span className="font-medium text-slate-200">
            Module 2: Arrays and objects
          </span>
        </p>
        <span className="ml-auto flex shrink-0 items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1">
          <span className="size-1.5 rounded-full bg-indigo-400 animate-pulse" />
          <span className="text-[11px] font-semibold text-indigo-300">
            18:24
          </span>
        </span>
      </div>

      <div className="grid gap-6 p-5 sm:p-7 md:grid-cols-[220px_1fr] md:gap-8">
        {/* --- the tutor tile --- */}
        <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-white/5 bg-white/[0.01] p-4">
          <div className="relative grid size-[132px] place-items-center">
            {/* The halo the real avatar draws while audio is flowing. */}
            <span
              aria-hidden="true"
              className="animate-pulse-ring absolute inset-0 rounded-full border border-indigo-500/40"
            />
            <span className="relative grid size-[108px] place-items-center rounded-full border border-indigo-500/50 bg-gradient-to-tr from-indigo-950/60 to-purple-900/40 shadow-[0_0_40px_rgba(99,102,241,0.35)]">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
                className="size-11 text-indigo-300"
              >
                <path
                  d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
                <path
                  d="M5 11a7 7 0 0 0 14 0M12 18v3"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </span>
          </div>

          {/* Amplitude bars. Decoration here, driven by real audio in the
              product. They animate height from a visible resting value, so a
              backgrounded tab shows a still waveform rather than a flat line. */}
          <div
            aria-hidden="true"
            className="flex h-8 items-center justify-center gap-[3px]"
          >
            {BARS.map((bar, index) => (
              <span
                key={index}
                className="animate-wave w-[3px] rounded-full bg-gradient-to-t from-indigo-500 to-violet-400"
                style={{ height: bar.h, animationDelay: bar.delay }}
              />
            ))}
          </div>

          <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-indigo-300">
            <span className="size-1.5 rounded-full bg-indigo-400 animate-ping" />
            Tutor speaking
          </p>
        </div>

        {/* --- the transcript --- */}
        <div className="space-y-3">
          {TURNS.map((turn, index) => {
            const isTutor = turn.who === "Tutor";
            return (
              <div
                key={index}
                className={`rounded-xl border p-3.5 text-[13.5px] leading-relaxed transition-all ${
                  isTutor
                    ? "border-indigo-500/20 bg-indigo-950/20 shadow-[inset_0_1px_0_0_rgba(99,102,241,0.15)]"
                    : "border-emerald-500/30 bg-emerald-950/20 shadow-[0_0_15px_rgba(16,185,129,0.06)]"
                }`}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span
                    className={`text-[11px] font-bold uppercase tracking-wide ${
                      isTutor ? "text-indigo-300" : "text-emerald-300"
                    }`}
                  >
                    {turn.who}
                  </span>
                  {turn.cut && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold text-rose-300">
                      <span className="size-1 rounded-full bg-rose-400 animate-ping" />
                      cut off
                    </span>
                  )}
                </div>
                <p className={isTutor ? "text-slate-200" : "font-medium text-emerald-100"}>
                  {turn.text}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}
