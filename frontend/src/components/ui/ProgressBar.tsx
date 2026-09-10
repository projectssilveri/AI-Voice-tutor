import { cn } from "@/lib/cn";

const FILL = {
  brand: "bg-brand-500",
  success: "bg-success-500",
  warning: "bg-warning-500",
} as const;

/**
 * A progress bar whose width is never animated.
 *
 * Third attempt, and the first correct one. Version 1 held the width in state
 * and applied the real value on a `requestAnimationFrame` tick; rAF is
 * suspended in a hidden tab, so a bar opened in the background sat at 0% while
 * reporting a student who had finished everything. Version 2 moved the growth
 * into a `from { width: 0 }` keyframe with no fill-mode, on the reasoning that
 * the resting state would then be the true value.
 *
 * IT WAS STILL WRONG, and measuring it is what showed that: `aria-valuenow`
 * 100, inline width 100%, computed width **0px**. `animation-fill-mode: none`
 * governs what happens outside the animation's duration — but a frozen clock
 * means the animation never leaves its duration, so the `from` state is simply
 * what you see, indefinitely.
 *
 * The rule that survives: nothing that carries information may be animated at
 * all. The width is now a plain inline style, correct on the server, correct
 * on first paint, correct in a background tab, correct with JavaScript
 * disabled. Only opacity animates, and its worst frozen state is a bar at 35%
 * opacity showing the right number.
 *
 * No state and no effect, so this renders on the server like the markup it
 * replaced.
 */
export default function ProgressBar({
  value,
  tone = "brand",
  className,
  label,
}: {
  /** 0–100. Clamped, because a percentage from live data can exceed it. */
  value: number;
  tone?: keyof typeof FILL;
  className?: string;
  /** Screen-reader description; without it the bar is decorative. */
  label?: string;
}) {
  const target = Math.max(0, Math.min(100, Math.round(value)));

  return (
    <div
      role="progressbar"
      aria-valuenow={target}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn(
        "h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800",
        className,
      )}
    >
      <div
        className={cn("animate-grow-x h-full rounded-full", FILL[tone])}
        style={{ width: `${target}%` }}
      />
    </div>
  );
}
