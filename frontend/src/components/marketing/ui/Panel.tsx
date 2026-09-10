import { cn } from "@/lib/cn";

import type { ElementType, ReactNode } from "react";

/**
 * The card surface for the dark site: a hairline border with a brighter top
 * edge.
 *
 * On a near-black canvas a plain 1px grey border reads as a drawn rectangle.
 * Lightening only the TOP edge implies a light source above the page, which is
 * what makes a flat panel read as a raised one. It is an inset box-shadow
 * rather than a ::before so it survives `overflow-hidden` and can never sit
 * above the content. Drop shadows are close to invisible on this background,
 * so this does the job they would.
 *
 * Colours are arbitrary-value classes rather than inline styles because
 * `interactive` needs a hover border, and inline styles have no variants.
 *
 * `interactive` is separate from `as="a"` on purpose: a whole card is often a
 * link, but a card that merely contains a link should not lift under the
 * cursor.
 */
export default function Panel({
  children,
  className,
  as: Component = "div",
  inset = false,
  interactive = false,
  spotlight = false,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  as?: ElementType;
  /** A panel sitting inside another panel, one step lighter. */
  inset?: boolean;
  /** Lifts and brightens its border on hover. */
  interactive?: boolean;
  /**
   * Take part in a `SpotlightGroup`'s cursor highlight. Only does anything
   * inside one; on its own it is inert, which is deliberate so a panel can be
   * moved between pages without carrying a broken effect.
   */
  spotlight?: boolean;
} & Record<string, unknown>) {
  return (
    <Component
      data-spotlight={spotlight ? "" : undefined}
      className={cn(
        "relative isolate rounded-2xl border border-[var(--mk-line)]",
        "shadow-[inset_0_1px_0_0_var(--mk-line-lift)]",
        inset ? "bg-[var(--mk-inset)]" : "bg-[var(--mk-raised)]",
        interactive && [
          "transition-[transform,border-color,background-color]",
          "duration-200 ease-[var(--ease-out-soft)]",
          "hover:-translate-y-0.5 hover:border-[var(--mk-line-lift)]",
          "hover:bg-[var(--mk-inset)]",
          "motion-reduce:hover:translate-y-0",
        ],
        className,
      )}
      {...rest}
    >
      {spotlight && (
        // Behind the content and above the background. `aria-hidden` because
        // it is a light, not information.
        <span
          aria-hidden="true"
          className="spotlight-layer -z-10 group-hover/spot:opacity-100"
        />
      )}
      {children}
    </Component>
  );
}
