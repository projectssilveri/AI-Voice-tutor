import Link from "next/link";

import { cn } from "@/lib/cn";

import type { ComponentProps, ReactNode } from "react";

/**
 * One button style for the whole marketing site.
 *
 * The template had four: `bg-primary rounded-lg px-8 py-4 shadow-raised` in
 * the hero, `bg-primary rounded-sm px-8 py-3 shadow-btn` in the header,
 * `rounded-md px-9 py-4` on the business page, and a bare `bg-black` variant
 * next to the first. Same job, four sizes and three corner radii, so no two
 * calls to action on the site looked like they came from the same product.
 *
 * `variant` is the closed set. `primary` fills, `secondary` is the hairline
 * panel style, `ghost` is a text link with an arrow.
 */
export const buttonClasses = ({
  variant = "primary",
  size = "default",
}: {
  variant?: "primary" | "secondary" | "ghost";
  size?: "default" | "large";
} = {}) =>
  cn(
    "inline-flex items-center justify-center gap-2 rounded-xl font-semibold",
    "transition-[background-color,border-color,transform,color] duration-200",
    "ease-[var(--ease-out-soft)] active:scale-[0.98]",
    "motion-reduce:active:scale-100 whitespace-nowrap",
    size === "default" && "px-5 py-3 text-[15px]",
    size === "large" && "px-7 py-4 text-base",
    variant === "primary" && [
      "bg-gradient-to-r from-indigo-500 via-indigo-600 to-purple-600",
      "hover:from-indigo-400 hover:via-indigo-500 hover:to-purple-500",
      "text-white shadow-[0_4px_20px_rgba(99,102,241,0.4)]",
      "hover:shadow-[0_6px_28px_rgba(99,102,241,0.6)]",
      "border border-indigo-400/30",
    ],
    variant === "secondary" && [
      "border border-white/10 bg-white/[0.04] backdrop-blur-md",
      "text-[var(--mk-text)] hover:border-white/20",
      "hover:bg-white/[0.08] hover:text-white",
      "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)]",
    ],
    variant === "ghost" && [
      "px-0 text-[var(--mk-brand-lit)] hover:text-white",
      "active:scale-100",
    ],
  );

export default function MarketingButton({
  children,
  className,
  variant,
  size,
  ...rest
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  size?: "default" | "large";
} & ComponentProps<typeof Link>) {
  return (
    <Link className={cn(buttonClasses({ variant, size }), className)} {...rest}>
      {children}
    </Link>
  );
}
