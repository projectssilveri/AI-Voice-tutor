"use client";

import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/cn";

import MarketingButton, { buttonClasses } from "./MarketingButton";

/**
 * The main call to action, aware of whether anyone is signed in.
 *
 * THE BUG THIS FIXES: every hero button on the site was a hardcoded
 * `<Link href="/signup">Get started</Link>` — in `Hero.tsx`, on `how-it-works`
 * and on `business`. A signed-in student reading the home page was invited to
 * create a second account, and following it landed them on a sign-up form for
 * an account they already had. The header got this right through `useAuth`;
 * the three biggest buttons on the site did not.
 *
 * `loading` is held rather than guessed. Rendering "Start free" and swapping
 * it to "Go to dashboard" a moment later is the flicker `AccountMenu` already
 * avoids, and it is worse on a button someone is moving their mouse toward.
 */
export default function PrimaryCta({
  className,
  size = "large",
  /** Shown when signed out. The signed-in label is always "Go to dashboard". */
  label = "Start free",
}: {
  className?: string;
  size?: "default" | "large";
  label?: string;
}) {
  const { user, loading } = useAuth();

  if (loading) {
    // Same box, no label. The row keeps its height and nothing below it moves
    // when the session resolves.
    return (
      <span
        aria-hidden="true"
        className={cn(
          buttonClasses({ variant: "primary", size }),
          "pointer-events-none opacity-0",
          className,
        )}
      >
        {label}
      </span>
    );
  }

  return (
    <MarketingButton
      href={user ? "/dashboard" : "/signup"}
      variant="primary"
      size={size}
      className={className}
    >
      {user ? "Go to dashboard" : label}
    </MarketingButton>
  );
}
