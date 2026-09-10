"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useState } from "react";

import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import Button from "@/components/ui/button/Button";
import { useAuth } from "@/context/AuthContext";
import {
  passwordChecks,
  validateEmail,
  validateName,
  validateNewPassword,
} from "@/lib/validate";
import { ChevronLeftIcon, EyeCloseIcon, EyeIcon } from "@/icons";
import { login, register } from "@/lib/auth";

// fastapi-users rejects anything shorter than 8, but failing here avoids a
// pointless round trip. Server-side validation remains the real gate.
const MIN_PASSWORD_LENGTH = 8;

/** The message under a field, once that field has been touched. */
function FieldError({
  show,
  message,
}: {
  show: boolean;
  message: string | null;
}) {
  if (!show || !message) return null;
  return (
    <p className="mt-1.5 text-sm text-error-400">
      {message}
    </p>
  );
}

export default function SignUpForm() {
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Which fields the person has finished with. An error shown before somebody
  // has left the box is a form arguing with them mid-word.
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const touch = (field: string) =>
    setTouched((current) => ({ ...current, [field]: true }));

  // Recomputed every render rather than stored: derived state that can fall
  // out of step with what it was derived from is a whole category of bug.
  const fieldErrors = {
    name: validateName(name),
    email: validateEmail(email),
    password: validateNewPassword(password),
    confirmPassword:
      confirmPassword && password !== confirmPassword
        ? "The two passwords do not match"
        : null,
  };
  const checks = passwordChecks(password);

  const router = useRouter();
  const { refresh } = useAuth();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    // Everything gets marked touched, so a submit reveals every problem at
    // once rather than one per attempt.
    setTouched({
      name: true,
      email: true,
      password: true,
      confirmPassword: true,
    });

    // The message goes under the field and NOWHERE ELSE. Putting it in the
    // banner as well printed "An email address needs an @" twice on one
    // screen — once at the top with no indication of which box it meant, and
    // once under the box, which is the only one that helps. The banner is kept
    // for what the server says, which belongs to no single field.
    const blocked =
      fieldErrors.name ||
      fieldErrors.email ||
      fieldErrors.password ||
      password !== confirmPassword;
    if (blocked) return;

    setSubmitting(true);
    try {
      await register(name.trim(), email, password);
      // Registering does not sign you in, so log in immediately afterwards —
      // otherwise a new account lands on the sign-in page.
      await login(email, password);
      await refresh();
      // The site, not the dashboard — same reasoning as sign-in. Somebody who
      // has just created an account is still deciding, and the catalogue is a
      // better place to keep deciding than an empty workspace.
      router.push("/");
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not create the account",
      );
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col flex-1 w-full overflow-y-auto lg:w-1/2 no-scrollbar">
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
            Sign Up
          </h1>
          <p className="text-sm text-[var(--mk-muted)]">
            Create an account to start learning by voice.
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="space-y-5">
            {error ? (
              <div
                role="alert"
                className="rounded-lg border border-error-500 bg-error-50 px-4 py-3 text-sm text-error-400"
              >
                {error}
              </div>
            ) : null}

            <div>
              {/* `htmlFor` + `id`. Without the pair the label is only text sitting
                  above a box: a screen reader announced every field on this form
                  as "edit text, blank", and clicking the label focused nothing.
                  Both components already took these props; neither form passed
                  them. */}
              <Label htmlFor="signup-name">
                Name{" "}
                <span className="text-error-400">*</span>
              </Label>
              <Input
                id="signup-name"
                type="text"
                name="name"
                placeholder="Your name"
                autoComplete="name"
                required
                defaultValue={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => touch("name")}
              />
              <FieldError show={touched.name} message={fieldErrors.name} />
            </div>

            <div>
              <Label htmlFor="signup-email">
                Email{" "}
                <span className="text-error-400">*</span>
              </Label>
              <Input
                id="signup-email"
                type="email"
                name="email"
                placeholder="you@example.com"
                autoComplete="email"
                required
                defaultValue={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => touch("email")}
              />
              <FieldError show={touched.email} message={fieldErrors.email} />
            </div>

            <div>
              <Label htmlFor="signup-password">
                Password{" "}
                <span className="text-error-400">*</span>
              </Label>
              <div className="relative">
                <Input
                  id="signup-password"
                  type={showPassword ? "text" : "password"}
                  name="password"
                  placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                  autoComplete="new-password"
                  required
                  defaultValue={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onBlur={() => touch("password")}
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

              {/* THE RULES, VISIBLE BEFORE ANYONE TYPES, ticking green as each
                  one is met. This is the pattern sign-up research keeps
                  landing on: someone who has to guess the rule, submit, and be
                  told no is the someone who gives up. Rendered from
                  `passwordChecks`, which mirrors the server's list exactly — a
                  checklist that goes all green while the submit still fails is
                  worse than showing nothing.

                  The strength bar that used to sit here is gone. "Weak" tells
                  you where you stand; it never tells you what to type next. */}
              {/* MARKS, NOT BUTTONS. The first version put each tick in a
                  filled circle with a border, which is the shape of a control
                  — people read a small round filled thing next to text as
                  something to press. These are a plain glyph at the size of
                  the text beside them: a hairline dash while a rule is unmet,
                  a check once it is. Nothing to click, nothing that looks
                  clickable.

                  Rendered from `passwordChecks`, which mirrors the server, so
                  the list can never go all-green while the submit still
                  fails. */}
              <ul className="mt-3 space-y-1">
                {checks.map((check) => (
                  <li
                    key={check.label}
                    className={`flex items-center gap-2 text-xs transition-colors ${
 check.met
 ?"text-success-700"
                        : "text-[var(--mk-muted)]"
                    }`}
                  >
                    {check.met ? (
                      <svg
                        aria-hidden="true"
                        width="13"
                        height="13"
                        viewBox="0 0 14 14"
                        fill="none"
                        className="shrink-0"
                      >
                        <path
                          d="M2.6 7.4 5.5 10.3 11.4 4.4"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : (
                      <svg
                        aria-hidden="true"
                        width="13"
                        height="13"
                        viewBox="0 0 14 14"
                        fill="none"
                        className="shrink-0 opacity-50"
                      >
                        <path
                          d="M3 7h8"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                        />
                      </svg>
                    )}
                    {check.label}
                  </li>
                ))}
              </ul>
              {/* The count for a screen reader, which cannot see the marks. */}
              <p className="sr-only" aria-live="polite">
                {checks.filter((check) => check.met).length} of {checks.length}{" "}
                password requirements met.
              </p>

              <FieldError
                show={touched.password}
                message={fieldErrors.password}
              />
            </div>

            <div>
              <Label htmlFor="signup-confirm">
                Confirm password{" "}
                <span className="text-error-400">*</span>
              </Label>
              <div className="relative">
                <Input
                  id="signup-confirm"
                  type={showConfirm ? "text" : "password"}
                  name="confirmPassword"
                  placeholder="Type it again"
                  autoComplete="new-password"
                  required
                  defaultValue={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onBlur={() => touch("confirmPassword")}
                />
                <span
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute z-30 -translate-y-1/2 cursor-pointer right-4 top-1/2"
                >
                  {showConfirm ? (
                    <EyeIcon className="fill-gray-500" />
                  ) : (
                    <EyeCloseIcon className="fill-gray-500" />
                  )}
                </span>
              </div>
              <FieldError
                show={touched.confirmPassword || confirmPassword.length > 0}
                message={fieldErrors.confirmPassword}
              />
            </div>

            {/* An "I agree to the Terms and Conditions and Privacy Policy"
                checkbox used to gate this button. Neither document exists and
                neither was linked, so signup blocked until you consented to
                something you could not read — which is not consent. Restore it
                when the documents are published, with links to them. */}

            <Button
              className="w-full"
              size="sm"
              type="submit"
              disabled={submitting}
            >
              {submitting ? "Creating account…" : "Sign Up"}
            </Button>
          </div>
        </form>

        <div className="mt-5">
          <p className="text-sm font-normal text-center text-[var(--mk-text)] sm:text-start">
            Already have an account?{" "}
            <Link
              href="/signin"
              className="text-[var(--mk-brand-lit)] hover:text-[var(--mk-brand-lit)]"
            >
              Sign In
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
