"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

import { useAuth } from "@/context/AuthContext";
import { safeNext } from "@/lib/safeNext";

/**
 * Sends an ALREADY signed-in visitor away from the sign-in and sign-up pages.
 *
 * WHY THIS IS NOT COSMETIC. Without it, somebody with a live session who
 * reaches `/signin` (a bookmark, the browser's back button, an old link in an
 * email) is shown a password field and asked to prove who they already are.
 * On `/signup` it is worse: filling the form registers a second account, or
 * fails with "that email is taken", which tells whoever is at the keyboard
 * that the address is registered.
 *
 * "ALREADY" IS THE WHOLE WORD. The first version of this fired on any signed-in
 * state, which included the state that exists one tick AFTER the form on the
 * same page succeeds — so it raced `SignInForm`'s own redirect and won, and
 * whoever signed in landed somewhere the form had not chosen. Caught by signing
 * in as a real student and watching them land in the wrong place.
 *
 * So the decision is made once, on the FIRST settled answer from the session
 * check. Signed in then: redirect. Signed out then: this component is finished,
 * and whatever happens next on the page belongs to the form.
 *
 * IT IS A CONVENIENCE, NOT A SECURITY BOUNDARY, exactly like `RequireAuth`.
 * Anyone can bypass a client-side redirect. What actually matters is that the
 * backend rejects a duplicate registration, and it does.
 */
export default function RedirectIfSignedIn() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  /** null until the session check first settles; then true or false forever. */
  const hadSessionOnArrival = useRef<boolean | null>(null);

  useEffect(() => {
    if (loading) return;
    if (hadSessionOnArrival.current === null) {
      hadSessionOnArrival.current = user !== null;
    }
    if (!hadSessionOnArrival.current) return;

    // Same-origin paths only. See `lib/safeNext` for what is rejected; the
    // rule is shared with SignInForm so the two cannot drift — and so is the
    // destination: the website, signed in, unless `next` names somewhere.
    router.replace(safeNext(params.get("next"), "/"));
  }, [loading, user, params, router]);

  return null;
}
