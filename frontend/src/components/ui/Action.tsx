"use client";

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-brand-500 text-white shadow-raised hover:bg-brand-600 hover:shadow-lifted",
  secondary:
    "border border-gray-300 bg-white text-gray-700 hover:border-gray-400 hover:bg-gray-50 dark:border-gray-700 dark:bg-transparent dark:text-gray-300 dark:hover:bg-white/[0.04]",
  ghost:
    "text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.06]",
  // MEASURED, NOT PICKED. White on error-500 is 3.76:1 and on success-500
  // 2.62:1 — both below the 4.5 AA needs for normal text. The 700 shades
  // are 6.57:1 and 5.41:1. A destructive button nobody can read is worse
  // than a slightly darker one.
  danger: "bg-error-700 text-white shadow-raised hover:bg-error-800",
  success: "bg-success-700 text-white shadow-raised hover:bg-success-800",
};

const SIZE: Record<Size, string> = {
  sm: "px-4 py-2 text-sm gap-1.5",
  md: "px-5 py-2.5 text-sm gap-2",
  lg: "px-7 py-3.5 text-base gap-2",
};

// active:scale-[0.98] is the whole point of having one of these: a button that
// depresses under the cursor feels connected to the click. It is 2%, which
// registers without being a bounce.
const BASE =
  "inline-flex items-center justify-center rounded-lg font-medium " +
  "transition-[background-color,box-shadow,transform,border-color] duration-150 " +
  "ease-[var(--ease-out-soft)] active:scale-[0.98] motion-reduce:active:scale-100 " +
  "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50";

function Spinner() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-4 w-4 animate-spin"
      fill="none"
    >
      <circle
        cx="8"
        cy="8"
        r="6.5"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.25"
      />
      <path
        d="M14.5 8A6.5 6.5 0 0 0 8 1.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

interface Common {
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
}

/**
 * The button.
 *
 * There were 59 distinct primary-button class strings in the app (35 written
 * against `bg-brand-500`, 24 against `bg-primary`) and the vendored TailAdmin
 * `Button` was imported by two files. Nothing was wrong with any single one of
 * them; the problem is that changing how a button feels meant editing 59
 * places, so nobody ever did, and none of them had a press state.
 *
 * Named `Action` rather than `Button` so it can be adopted gradually without
 * colliding with the vendored `components/ui/button/Button.tsx` still in use.
 *
 * `loading` keeps the button mounted and its width stable — swapping the label
 * for a spinner would reflow the row underneath it every time someone saves.
 */
export function Action({
  variant = "primary",
  size = "md",
  className,
  children,
  loading = false,
  disabled,
  type = "button",
  ...rest
}: Common &
  Omit<ComponentProps<"button">, "children" | "className"> & {
    loading?: boolean;
  }) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(BASE, VARIANT[variant], SIZE[size], className)}
      {...rest}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}

/**
 * The same thing, as a link.
 *
 * A navigation is an anchor, not a button with an onClick — middle-click,
 * ctrl-click, "open in new tab" and the keyboard all depend on it being a real
 * href. Sharing the styling here is what stops that correctness costing
 * anything visually.
 */
export function ActionLink({
  variant = "primary",
  size = "md",
  className,
  children,
  ...rest
}: Common & Omit<ComponentProps<typeof Link>, "children" | "className">) {
  return (
    <Link
      className={cn(BASE, VARIANT[variant], SIZE[size], className)}
      {...rest}
    >
      {children}
    </Link>
  );
}
