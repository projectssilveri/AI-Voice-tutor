import type { Metadata } from "next";
import { Suspense } from "react";

import ResetPasswordForm from "@/components/auth/ResetPasswordForm";

export const metadata: Metadata = {
  title: "Reset password",
  description: "Choose a new password for your Voice Tutor LMS account.",
};

export default function ResetPasswordPage() {
  // ResetPasswordForm reads `?token=` via useSearchParams, which opts the
  // subtree into client-side rendering. Without a Suspense boundary Next
  // cannot prerender this page at build time and the build fails, the same as
  // sign-in and verify-email.
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center lg:w-1/2">
          <p className="text-sm text-[var(--mk-muted)]">Loading…</p>
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
