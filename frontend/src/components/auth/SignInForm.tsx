"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import React, { useState } from "react";

import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import Button from "@/components/ui/button/Button";
import { useAuth } from "@/context/AuthContext";
import { safeNext } from "@/lib/safeNext";
import { validateEmail } from "@/lib/validate";
import { ChevronLeftIcon, EyeCloseIcon, EyeIcon } from "@/icons";
import { login, AuthError } from "@/lib/auth";

export default function SignInForm() {
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Sign-in checks the SHAPE of the email and nothing else. It must never say
  // anything about the password: a rule here would tell somebody trying
  // addresses which ones exist, and a password that no longer meets today's
  // rule still belongs to a real account that has to be able to get in.
  const [emailTouched, setEmailTouched] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const emailProblem = email ? validateEmail(email) : null;
  const passwordProblem = password ? null : "Enter your password";
  // Only a REJECTED sign-in gets the extra links. A network failure or a
  // server error is not a reason to suggest making a second account.
  const [credentialsRejected, setCredentialsRejected] = useState(false);

  const router = useRouter();
  const searchParams = useSearchParams();
  const { refresh } = useAuth();

  // Where to land after signing in. `next` is set by the route guard when it
  // bounces someone here, so they resume where they were headed.
  const next = searchParams.get("next");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    // Without this the browser does a native GET submit and simply reloads the
    // page, which looks exactly like "nothing happened".
    event.preventDefault();
    setError(null);

    // Caught here rather than after a round trip that comes back "wrong email
    // or password" and leaves somebody hunting for a typo in the password.
    //
    // The message goes under the FIELD and nowhere else. Setting the banner as
    // well printed "An email address needs an @" twice on one screen — once
    // at the top, where it does not say which box it means, and once under the
    // box, which is the only one that helps. The banner is for what the server
    // says, which belongs to no single field.
    if (validateEmail(email)) {
      setEmailTouched(true);
      return;
    }
    if (!password) {
      setPasswordTouched(true);
      return;
    }

    setSubmitting(true);

    try {
      await login(email, password);
      // Refresh so the session is populated before the workspace loads, and
      // so the role is known here — where they should land depends on it.
      const signedIn = await refresh();
      // Only same-origin paths are honoured, so `next` cannot be used to
      // hand somebody off to another site after they sign in. The rule
      // lives in `lib/safeNext` because RedirectIfSignedIn needs it too.
      const resuming = safeNext(next, "") || null;
      // WHERE THEY LAND DEPENDS ON WHY THEY SIGNED IN.
      //
      // A STUDENT goes back to the site. Signing in is something they do in
      // the middle of reading — looking at a course, checking a price — and
      // being thrown into a workspace loses whatever they were doing. The
      // header carries a Dashboard link from the moment they are signed in.
      //
      // AN ADMIN goes to the dashboard, because that is the whole reason they
      // signed in. Staff do not browse the marketing site; landing them on it
      // and making them find the way in was one click on every single login.
      // `/dashboard` rather than `/admin`: it renders the admin view by role
      // and is the one URL that works for every kind of staff.
      //
      // `next` still wins over both: somebody bounced here from a protected
      // page is finishing a redirect, and that page is where they were going.
      const isStaff =
        signedIn?.role === "admin" || signedIn?.role === "super_admin";
      const target = resuming ?? (isStaff ? "/dashboard" : "/");

      // No new tab either. That existed to keep the public page alive behind
      // the workspace; now that signing in RETURNS you to the public site,
      // opening a second copy of it would just be a duplicate tab.
      router.push(target);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not sign in");
      setCredentialsRejected(
        caught instanceof AuthError && caught.status === 400,
      );
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col flex-1 w-full lg:w-1/2">
      <div className="w-full max-w-md mx-auto mb-5 sm:pt-10">
        <Link
          href="/"
          className="inline-flex items-center text-sm text-[var(--mk-muted)] transition-colors hover:text-[var(--mk-text)]"
        >
          <ChevronLeftIcon />
          Back to home
        </Link>
      </div>
      <div className="flex flex-col justify-center flex-1 w-full max-w-md mx-auto">
        <div className="mb-5 sm:mb-8">
          <h1 className="mb-2 font-semibold text-[var(--mk-text)] text-title-sm sm:text-title-md">
            Sign In
          </h1>
          <p className="text-sm text-[var(--mk-muted)]">
            Enter your email and password to sign in.
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="space-y-6">
            {error ? (
              <div
                role="alert"
                className="rounded-lg border border-error-500 bg-error-50 px-4 py-3 text-sm text-error-400"
              >
                {error}
                {/* THE WAY OUT for somebody who never had an account.
                    "Incorrect email or password" on its own is a dead end for
                    them: they read it as "I typed something wrong" and try the
                    same details again. This does not say whether the address
                    is registered — it cannot, or the form becomes a way to
                    test which emails exist here — it just offers the other
                    door. */}
                {credentialsRejected ? (
                  <p className="mt-1.5">
                    New here?{" "}
                    <Link
                      href="/signup"
                      className="font-medium underline underline-offset-2 hover:no-underline"
                    >
                      Create an account
                    </Link>
                  </p>
                ) : null}
              </div>
            ) : null}

            <div>
              {/* `htmlFor` + `id`. Without the pair the label is only text sitting
                  above a box: a screen reader announced every field on this form
                  as "edit text, blank", and clicking the label focused nothing.
                  Both components already took these props; neither form passed
                  them. */}
              <Label htmlFor="signin-email">
                Email{" "}
                <span className="text-error-400">*</span>
              </Label>
              <Input
                id="signin-email"
                type="email"
                name="email"
                placeholder="you@example.com"
                autoComplete="email"
                required
                defaultValue={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => setEmailTouched(true)}
              />
              {emailTouched && emailProblem ? (
                <p className="mt-1.5 text-sm text-error-400">
                  {emailProblem}
                </p>
              ) : null}
            </div>

            <div>
              <Label htmlFor="signin-password">
                Password{" "}
                <span className="text-error-400">*</span>
              </Label>
              <div className="relative">
                <Input
                  id="signin-password"
                  type={showPassword ? "text" : "password"}
                  name="password"
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  required
                  defaultValue={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onBlur={() => setPasswordTouched(true)}
                />
                <span
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute z-30 -translate-y-1/2 cursor-pointer right-4 top-1/2"
                >
                  {showPassword ? (
                    <EyeIcon className="fill-gray-500" />
                  ) : (
                    <EyeCloseIcon className="fill-gray-500" />
                  )}
                </span>
              </div>
              {passwordTouched && passwordProblem ? (
                <p className="mt-1.5 text-sm text-error-400">
                  {passwordProblem}
                </p>
              ) : null}
            </div>

            {/* A "Keep me logged in" checkbox used to sit here. It was never
                read — the session cookie's lifetime is fixed server-side for
                everyone, so ticking it changed nothing. Stating the actual
                behaviour beats offering a choice that does not exist. */}
            <p className="text-theme-sm font-normal text-[var(--mk-muted)]">
              You will stay signed in on this device for 24 hours.
            </p>

            <Button
              className="w-full"
              size="sm"
              type="submit"
              disabled={submitting}
            >
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </div>
        </form>

        <div className="mt-5">
          <p className="text-sm font-normal text-center text-[var(--mk-text)] sm:text-start">
            Don&apos;t have an account?{" "}
            <Link
              href="/signup"
              className="text-[var(--mk-brand-lit)] hover:text-[var(--mk-brand-lit)]"
            >
              Sign Up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
