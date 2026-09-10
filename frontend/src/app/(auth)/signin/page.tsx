import type { Metadata } from "next";
import { Suspense } from "react";

import RedirectIfSignedIn from "@/components/auth/RedirectIfSignedIn";
import SignInForm from "@/components/auth/SignInForm";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Voice Tutor LMS account.",
};

export default function SignInPage() {
  // SignInForm reads `?next=` via useSearchParams, which opts the subtree into
  // client-side rendering. Without a Suspense boundary Next cannot prerender
  // this page at build time and the build fails.
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center lg:w-1/2">
          <p className="text-sm text-[var(--mk-muted)]">Loading…</p>
        </div>
      }
    >
      {/* Somebody who already has a session should not be asked to prove
          who they are. Inside the same boundary because it reads
          `?next=` too. */}
      <RedirectIfSignedIn />
      <SignInForm />
    </Suspense>
  );
}
