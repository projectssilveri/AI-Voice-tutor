import { cn } from "@/lib/cn";

/**
 * The one piece of decoration on a marketing page.
 *
 * It replaces the template's hero art: two inline SVGs of overlapping blue
 * circles and a bundle of wavy lines, together about 240 of `Hero.tsx`'s 292
 * lines. They were the most recognisable thing about the page and what they
 * were recognisable AS was a free template.
 *
 * Rules this keeps to:
 *   - One per page. Two glows is a lava lamp.
 *   - `aria-hidden` and `pointer-events-none`. It is never content and must
 *     never eat a click meant for what is under it.
 *   - Negative z-index against the section's own stacking context, so it sits
 *     behind text without needing a z-index on the text.
 *
 * The drift animation starts from its resting position, so a hidden tab shows
 * the same picture standing still rather than nothing at all.
 */
export default function GlowBackdrop({
  className,
  placement = "top",
}: {
  className?: string;
  /** Where the light comes from. `top` for heroes, `center` for CTA blocks. */
  placement?: "top" | "center";
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 -z-10 overflow-hidden",
        className,
      )}
    >
      {/* Two elements: the outer one is positioned, the inner one animates.
          The keyframe writes `transform`, so putting both on one element
          would have the animation fight Tailwind's centring translate. */}
      <div
        className={cn(
          "absolute left-1/2 aspect-square w-[min(1100px,140vw)] -translate-x-1/2",
          placement === "top" ? "-top-1/3" : "top-1/2 -translate-y-1/2",
        )}
      >
        <div
          className="animate-glow-drift size-full rounded-full will-change-transform"
          style={{
            background:
              "radial-gradient(circle at center, var(--mk-glow) 0%, transparent 62%)",
          }}
        />
      </div>
    </div>
  );
}
