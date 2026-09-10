import type { ElementType, ReactNode } from "react";

import { cn } from "@/lib/cn";

type Elevation = "flat" | "raised" | "lifted";

const ELEVATION: Record<Elevation, string> = {
  flat: "",
  raised: "shadow-raised",
  lifted: "shadow-lifted",
};

/**
 * The panel primitive.
 *
 * Every card in the dashboard was a bare `rounded-2xl border` with
 * `box-shadow: none` — seventeen of them on /dashboard alone, all sitting on
 * exactly the same visual plane. Nothing said which of them you could click,
 * and nothing said which mattered more than the rest.
 *
 * `interactive` is the important prop: it is the difference between a panel
 * that displays something and a panel that *is* a control. It lifts on hover
 * and brightens its border, so the affordance is felt rather than guessed.
 */
export default function Card({
  children,
  className,
  as: Component = "div",
  elevation = "raised",
  interactive = false,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  as?: ElementType;
  elevation?: Elevation;
  interactive?: boolean;
} & Record<string, unknown>) {
  return (
    <Component
      className={cn(
        "rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]",
        ELEVATION[elevation],
        interactive &&
          // -translate-y-0.5 rather than scale: scaling a card resamples its
          // text every frame, which shimmers on a non-retina display. Moving
          // it does not.
          "transition-[transform,box-shadow,border-color] duration-200 ease-[var(--ease-out-soft)] hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lifted dark:hover:border-brand-700",
        className,
      )}
      {...rest}
    >
      {children}
    </Component>
  );
}
