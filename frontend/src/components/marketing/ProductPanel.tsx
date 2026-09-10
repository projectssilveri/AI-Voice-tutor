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
    <Panel className="overflow-hidden">
      {/* Window bar. The module name is here rather than in the transcript
          because "which module am I in" is the question the real header
          answers, and it is what proves the tutor is scoped to one topic. */}
      <div className="flex items-center gap-3 border-b border-[var(--mk-line)] px-4 py-3 sm:px-5">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="size-2.5 rounded-full bg-white/15" />
          <span className="size-2.5 rounded-full bg-white/15" />
          <span className="size-2.5 rounded-full bg-white/15" />
        </span>
        <p className="truncate text-[13px] text-[var(--mk-muted)]">
          JavaScript Foundations
          {/* Decorative separator, so it is marked as one. At 20% white it
              measures 1.85:1, which is right for a divider and wrong for
              anything a screen reader should read out. */}
          <span aria-hidden="true" className="mx-2 text-white/25">
            /
          </span>
          <span className="text-[var(--mk-text)]">
            Module 2, arrays and objects
          </span>
        </p>
        <span className="ml-auto flex shrink-0 items-center gap-2 rounded-full border border-[var(--mk-line)] px-2.5 py-1">
          <span className="size-1.5 rounded-full bg-[var(--mk-brand-lit)]" />
          <span className="text-[11px] font-medium text-[var(--mk-muted)]">
            18:24
          </span>
        </span>
      </div>

      <div className="grid gap-6 p-4 sm:p-6 md:grid-cols-[220px_1fr] md:gap-8">
        {/* --- the tutor tile --- */}
        <div className="flex flex-col items-center gap-4">
          <div className="relative grid size-[132px] place-items-center">
            {/* The halo the real avatar draws while audio is flowing. */}
            <span
              aria-hidden="true"
              className="animate-pulse-ring absolute inset-0 rounded-full border border-[var(--mk-brand)]"
            />
            <span className="grid size-[108px] place-items-center rounded-full border border-[var(--mk-brand)] bg-[var(--mk-brand)]/10 shadow-[0_0_60px_-12px_var(--mk-brand)]">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
                className="size-11 text-[var(--mk-brand-lit)]"
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
                className="animate-wave w-[3px] rounded-full bg-[var(--mk-brand-lit)]/70"
                style={{ height: bar.h, animationDelay: bar.delay }}
              />
            ))}
          </div>

          <p className="text-[13px] font-medium text-[var(--mk-brand-lit)]">
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
                className={`rounded-lg border-l-2 p-3 text-[13.5px] leading-relaxed ${
                  isTutor
                    ? "border-[var(--mk-brand)] bg-white/[0.03]"
                    : "border-success-500 bg-success-500/10"
                }`}
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--mk-muted)]">
                    {turn.who}
                  </span>
                  {turn.cut && (
                    <span className="rounded-full bg-error-500/20 px-2 py-0.5 text-[10px] font-medium text-error-400">
                      cut off
                    </span>
                  )}
                </div>
                <p className="text-[var(--mk-text)]/90">{turn.text}</p>
              </div>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}
