"use client";

import type { CSSProperties, ElementType, ReactNode } from "react";

import { useReveal } from "@/hooks/useReveal";
import { cn } from "@/lib/cn";

/**
 * Fades and lifts its children into place the first time they scroll into view.
 *
 * `delay` staggers siblings. Keep it small — a list where the last card arrives
 * a second after the first reads as a slow page, not a considered one. Nothing
 * here should delay past ~300ms.
 *
 * TRANSFORM ONLY, NEVER OPACITY. This used to lift AND fade, which meant the
 * unrevealed state was `opacity: 0` -- and `IntersectionObserver` delivers
 * nothing while `document.visibilityState === "hidden"`. Measured on the home
 * page in a background tab: 44 headings and paragraphs sat at opacity 0 after
 * the whole page had been scrolled, including everything under "What the tutor
 * does". The docstring here claimed "a JavaScript failure leaves a visible page
 * rather than a blank one", which was not true: JavaScript ran, applied
 * `opacity-0`, and then nothing ever removed it.
 *
 * This is the same rule decisions 116, 212 and 213 each had to establish
 * separately -- an animation may change how information ARRIVES, never whether
 * it is there. The page is now readable at every point of the animation, and
 * completely readable if the animation never runs at all.
 */
export default function Reveal({
  children,
  className,
  as: Component = "div",
  delay = 0,
  style,
}: {
  children: ReactNode;
  className?: string;
  as?: ElementType;
  /** Milliseconds. Used to stagger a row of siblings. */
  delay?: number;
  /** Merged with the transition delay rather than replacing it. */
  style?: CSSProperties;
}) {
  const { ref, revealed, instant } = useReveal<HTMLDivElement>();

  return (
    <Component
      ref={ref}
      style={
        delay && !instant ? { ...style, transitionDelay: `${delay}ms` } : style
      }
      className={cn(
        // No transition when it arrived instantly — see `instant` in
        // useReveal. Animating something the reader is already looking at is
        // pointless, and a transition cannot complete in a hidden tab.
        instant
          ? "translate-y-0"
          : [
              // `transform` alone. Adding opacity here is what made the page
              // blank in a hidden tab; the worst frozen state now is a
              // paragraph sitting 16px lower than its final position, fully
              // legible.
              "transition-transform duration-[600ms] ease-[var(--ease-out-soft)] motion-reduce:transition-none",
              revealed ? "translate-y-0" : "translate-y-4",
            ],
        className,
      )}
    >
      {children}
    </Component>
  );
}
