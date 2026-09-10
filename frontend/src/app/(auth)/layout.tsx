import Link from "next/link";
import React from "react";

import GlowBackdrop from "@/components/marketing/ui/GlowBackdrop";
import Logo from "@/components/marketing/ui/Logo";

/**
 * Split-screen auth shell, originally TailAdmin's.
 *
 * It carries `data-surface="marketing"` because it is the next click after
 * every call to action on the public site. Landing on a white form straight
 * after a dark page reads as two different products, and the sign-up form is
 * the worst possible place to make somebody wonder whether they are still on
 * the same site.
 *
 * The theme toggle is gone with it. There is nothing to toggle: this surface
 * is dark, the same as the marketing pages it follows. The dashboard behind
 * the form keeps its own toggle and is untouched.
 *
 * Its own ThemeProvider was dropped earlier for a related reason — the root
 * layout already provides one, and nesting a second gave the auth pages a
 * theme that drifted from the rest of the app.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      data-surface="marketing"
      className="relative z-1 bg-[var(--mk-canvas)] p-6 text-[var(--mk-text)] sm:p-0"
    >
      <div className="relative flex h-screen w-full flex-col justify-center lg:flex-row">
        {children}

        {/* The panel beside the form. It used to be a navy block with a grid
            pattern and the template's own logo file; it is the same glow the
            rest of the site uses now, so the two surfaces match. */}
        <div className="relative hidden h-full w-full items-center overflow-hidden border-l border-[var(--mk-line)] lg:grid lg:w-1/2">
          <GlowBackdrop placement="center" />
          <div className="relative z-1 flex flex-col items-center justify-center">
            <Link href="/" className="mb-6 block" aria-label="Voice Tutor, home">
              <Logo />
            </Link>
            <p className="max-w-xs text-center text-[15px] leading-relaxed text-[var(--mk-muted)]">
              An AI tutor that lectures out loud, and stops the moment you
              speak.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
