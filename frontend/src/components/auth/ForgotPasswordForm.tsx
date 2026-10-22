"use client";

import Link from "next/link";
import React, { useState } from "react";

import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import Button from "@/components/ui/button/Button";
import { forgotPassword } from "@/lib/auth";
import { validateEmail } from "@/lib/validate";
import { ChevronLeftIcon } from "@/icons";

/**
 * Asks for the email, then always says the same thing: the server answers 202
 * whether or not an account exists, and the message here must not reveal which,
 * or the form becomes a way to discover who has an account.
 */
export default function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const emailError = validateEmail(email);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (emailError) return;
    setSubmitting(true);
    try {
      await forgotPassword(email);
    } catch {
      // Deliberately ignored: a transport error must not tell the visitor
      // whether the address exists either. They see the same next screen.
    }
    setSent(true);
    setSubmitting(false);
  }

  return (
    <div className="flex flex-col flex-1 w-full overflow-y-auto lg:w-1/2 no-scrollbar">
      <div className="w-full max-w-md mx-auto mb-5 sm:pt-10">
        <Link
          href="/signin"
          className="inline-flex items-center text-sm text-[var(--mk-muted)] transition-colors hover:text-[var(--mk-text)]"
        >
          <ChevronLeftIcon />
          Back to sign in
        </Link>
      </div>
      <div className="flex flex-col justify-center flex-1 w-full max-w-md mx-auto">
        {sent ? (
          <>
            <h1 className="mb-2 font-semibold text-[var(--mk-text)] text-title-sm sm:text-title-md">
              Check your email
            </h1>
            <p className="text-sm text-[var(--mk-muted)]">
              If an account exists for{" "}
              <span className="font-medium text-[var(--mk-text)]">{email}</span>
              , we sent a link to reset the password. It works for about an
              hour.
            </p>
            <p className="mt-4 text-sm text-[var(--mk-muted)]">
              No email after a minute? Check your spam folder.
            </p>
            <div className="mt-5">
              <Link
                href="/signin"
                className="text-sm text-[var(--mk-brand-lit)] hover:text-[var(--mk-brand-lit)]"
              >
                Back to sign in
              </Link>
            </div>
          </>
        ) : (
          <>
            <div className="mb-5 sm:mb-8">
              <h1 className="mb-2 font-semibold text-[var(--mk-text)] text-title-sm sm:text-title-md">
                Forgot your password?
              </h1>
              <p className="text-sm text-[var(--mk-muted)]">
                Enter your email and we will send a link to set a new one.
              </p>
            </div>
            <form onSubmit={handleSubmit} noValidate>
              <div className="space-y-5">
                <div>
                  <Label htmlFor="forgot-email">
                    Email <span className="text-error-400">*</span>
                  </Label>
                  <Input
                    id="forgot-email"
                    type="email"
                    name="email"
                    placeholder="you@example.com"
                    autoComplete="email"
                    required
                    defaultValue={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onBlur={() => setTouched(true)}
                  />
                  {touched && emailError ? (
                    <p className="mt-1.5 text-sm text-error-400">{emailError}</p>
                  ) : null}
                </div>
                <Button
                  className="w-full"
                  size="sm"
                  type="submit"
                  disabled={submitting}
                >
                  {submitting ? "Sending…" : "Send reset link"}
                </Button>
              </div>
            </form>
            <div className="mt-5">
              <p className="text-sm text-center text-[var(--mk-text)] sm:text-start">
                Remembered it?{" "}
                <Link
                  href="/signin"
                  className="text-[var(--mk-brand-lit)] hover:text-[var(--mk-brand-lit)]"
                >
                  Sign in
                </Link>
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
