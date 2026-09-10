import type { Metadata } from "next";
import { Suspense } from "react";

import RedirectIfSignedIn from "@/components/auth/RedirectIfSignedIn";
import SignUpForm from "@/components/auth/SignUpForm";

export const metadata: Metadata = {
  title: "Sign up",
  description: "Create a Voice Tutor LMS account.",
};

// The form is presentational for now; it is wired to the FastAPI auth routes
// in build-order step 4.
export default function SignUpPage() {
  return (
    <>
      {/* Filling this in with a live session either creates a second
          account or fails with "that email is taken", which confirms to
          whoever is at the keyboard that the address is registered.

          `Suspense` because RedirectIfSignedIn reads `?next=`, and
          `useSearchParams` opts its subtree into client rendering. */}
      <Suspense fallback={null}>
        <RedirectIfSignedIn />
      </Suspense>
      <SignUpForm />
    </>
  );
}
