/**
 * Loading placeholders.
 *
 * Every screen used to render the word "Loading…" and then swap it for a full
 * page of content. That reads as a stall and then a jolt: nothing tells you how
 * much is coming, and the layout jumps the moment it lands. A placeholder in
 * the shape of the real thing keeps the page still and sets the expectation.
 *
 * The blocks shimmer rather than pulse. A pulsing block reads as something
 * blinking at you; a highlight sweeping left to right reads as something
 * arriving, which is what is actually happening. The global
 * `prefers-reduced-motion` rule in globals.css switches it off.
 */

function Block({ className = "" }: { className?: string }) {
  return (
    <div
      className={`skeleton-shimmer rounded-md bg-gray-200 dark:bg-gray-800 ${className}`}
    />
  );
}

/** A single placeholder bar. `w`/`h` are Tailwind classes. */
export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return <Block className={className} />;
}

/** Stacked lines of text. The last is short, as a real paragraph ends. */
export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, index) => (
        <Block
          key={index}
          className={`h-3.5 ${index === lines - 1 ? "w-2/3" : "w-full"}`}
        />
      ))}
    </div>
  );
}

/** The KPI strip at the top of the dashboards. */
export function SkeletonTiles({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="rounded-2xl border border-gray-200 bg-white p-4 shadow-raised dark:border-gray-800 dark:bg-white/[0.03]"
        >
          <Block className="h-3 w-20" />
          <Block className="mt-3 h-7 w-12" />
        </div>
      ))}
    </div>
  );
}

/** A grid of course/exam cards. */
export function SkeletonCards({
  count = 4,
  columns = 2,
}: {
  count?: number;
  columns?: 2 | 3;
}) {
  return (
    <div
      className={`grid gap-4 ${columns === 3 ? "md:grid-cols-3" : "md:grid-cols-2"}`}
    >
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="rounded-2xl border border-gray-200 bg-white p-5 shadow-raised dark:border-gray-800 dark:bg-white/[0.03]"
        >
          <Block className="h-3 w-24" />
          <Block className="mt-3 h-5 w-3/4" />
          <div className="mt-4 space-y-2">
            <Block className="h-3.5 w-full" />
            <Block className="h-3.5 w-5/6" />
          </div>
          <Block className="mt-5 h-8 w-28 rounded-lg" />
        </div>
      ))}
    </div>
  );
}

/** Rows inside an existing table or list panel. */
export function SkeletonRows({
  rows = 5,
  columns = 4,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <div className="divide-y divide-gray-100 dark:divide-gray-800">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex items-center gap-4 px-6 py-4">
          {Array.from({ length: columns }).map((_, colIndex) => (
            <Block
              key={colIndex}
              className={`h-3.5 ${colIndex === 0 ? "w-1/3" : "flex-1"}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** A full panel: heading, subtitle, body. */
export function SkeletonPanel({ lines = 3 }: { lines?: number }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-raised dark:border-gray-800 dark:bg-white/[0.03]">
      <Block className="h-4 w-40" />
      <Block className="mt-2 h-3 w-56" />
      <div className="mt-5">
        <SkeletonText lines={lines} />
      </div>
    </div>
  );
}
