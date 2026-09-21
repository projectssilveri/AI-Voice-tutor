import type { Metadata } from "next";
import { Suspense } from "react";

import RedirectIfSignedIn from "@/components/auth/RedirectIfSignedIn";
import SignUpForm from "@/components/auth/SignUpForm";

export const metadata: Metadata = {
  title: "Sign up",
  description: "Create a Voice Tutor LMS account.",
};

export default function SignUpPage() {
  return (
    <>
      {/* Filling this in with a live session either creates a second
          account or fails with "that email is taken", which confirms to
          whoever is at the keyboard that the address is registered.

          `Suspense` because both of these read `?next=`, and
          `useSearchParams` opts its subtree into client rendering. The FORM is
          inside it now as well — it reads `next` so that signing up from a
          plan returns to that plan, and without the boundary the build cannot
          prerender this page at all. */}
      <Suspense fallback={null}>
        <RedirectIfSignedIn />
        <SignUpForm />
      </Suspense>
    </>
  );
}
