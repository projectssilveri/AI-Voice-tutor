import { cn } from "@/lib/cn";

import type { ReactNode } from "react";

/**
 * The horizontal measure for every marketing section.
 *
 * The ported template used `.container` with an inner `-mx-4 flex flex-wrap`
 * and `px-4` on each child — Bootstrap's grid, reimplemented in Tailwind. It
 * meant the real gutter was set in two places that had to agree, and sections
 * written by different hands did not line up with each other down the page.
 *
 * One component owns it now. `size` is deliberately a small closed set rather
 * than a maxWidth prop: three measures is a design decision, twelve is drift.
 */
export default function Container({
  children,
  className,
  size = "default",
}: {
  children: ReactNode;
  className?: string;
  /**
   * `narrow` is a reading measure for legal and editorial pages. `wide` is
   * for the hero product panel, which is meant to feel larger than the text
   * above it.
   */
  size?: "narrow" | "default" | "wide";
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-5 sm:px-8",
        size === "narrow" && "max-w-[720px]",
        size === "default" && "max-w-[1200px]",
        size === "wide" && "max-w-[1400px]",
        className,
      )}
    >
      {children}
    </div>
  );
}
