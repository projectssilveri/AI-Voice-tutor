import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * What a screen says when there is nothing on it yet.
 *
 * Sixteen screens had an empty state and thirteen of them were a grey sentence
 * in a box. That is the screen a brand-new account sees first, on nearly every
 * page, for their entire first session — so it is the one place in the product
 * most likely to be someone's first impression and least likely to have been
 * looked at twice.
 *
 * The `action` is the part that matters. "No assignments yet" is a dead end;
 * "No assignments yet — browse your courses" is a next step. An empty state
 * with nowhere to go is a smaller version of a 404.
 */
export default function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  /** An emoji or small glyph. Decorative — the title carries the meaning. */
  icon?: ReactNode;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // Dashed rather than solid: a dashed edge reads as "a space waiting to
        // be filled", where a solid card reads as a thing that is finished and
        // happens to be blank.
        "flex flex-col items-center rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center dark:border-gray-700 dark:bg-white/[0.02]",
        className,
      )}
    >
      {icon ? (
        <span
          aria-hidden="true"
          className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-50 text-2xl dark:bg-white/[0.04]"
        >
          {icon}
        </span>
      ) : null}

      <p className="mb-1.5 text-base font-semibold text-gray-800 dark:text-white/90">
        {title}
      </p>

      {body ? (
        <p className="max-w-sm text-sm leading-relaxed text-gray-500 dark:text-gray-400">
          {body}
        </p>
      ) : null}

      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
