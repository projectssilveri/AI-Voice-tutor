import type { Metadata } from "next";
import { Suspense } from "react";

import VerifyEmailForm from "@/components/auth/VerifyEmailForm";

export const metadata: Metadata = {
  title: "Confirm your email",
  description: "Confirm your email address for Voice Tutor LMS.",
};

export default function VerifyEmailPage() {
  // VerifyEmailForm reads `?token=` via useSearchParams, which opts the subtree
  // into client-side rendering. Without a Suspense boundary Next cannot
  // prerender this page at build time and the build fails, the same as the
  // sign-in page.
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center lg:w-1/2">
          <p className="text-sm text-[var(--mk-muted)]">Loading…</p>
        </div>
      }
    >
      <VerifyEmailForm />
    </Suspense>
  );
}
