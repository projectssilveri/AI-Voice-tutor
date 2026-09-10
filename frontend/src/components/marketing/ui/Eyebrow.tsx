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
    <div className={cn("mb-4 inline-flex items-center", className)}>
      <span className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-300 shadow-[0_0_12px_rgba(99,102,241,0.15)] backdrop-blur-sm">
        <span className="inline-block size-1.5 rounded-full bg-indigo-400 shadow-[0_0_8px_currentColor] animate-pulse" />
        {children}
      </span>
    </div>
  );
}
