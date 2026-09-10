import { cn } from "@/lib/cn";

import type { ReactNode } from "react";

/**
 * The small label above a section heading.
 *
 * It replaces `SectionTitle`'s gradient bar, which was a 48px rule that said
 * nothing. An eyebrow does the same job of separating the heading from what is
 * above it AND tells you which part of the page you are in, which matters more
 * on a long scrolling page than a decorative dash does.
 *
 * Uppercase with wide tracking, so it reads as a label rather than as a very
 * short sentence.
 */
export default function Eyebrow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "mb-4 text-xs font-semibold uppercase tracking-[0.16em]",
        "text-[var(--mk-brand-lit)]",
        className,
      )}
    >
      {children}
    </p>
  );
}
