"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import React, { useState } from "react";

import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import Button from "@/components/ui/button/Button";
import { resetPassword } from "@/lib/auth";
import { passwordChecks, validateNewPassword } from "@/lib/validate";
import { EyeCloseIcon, EyeIcon } from "@/icons";

/**
 * The page the link in the reset email opens. It takes the token from the
 * query and a new password, then sends the person to sign in. The password
 * rules are shown and ticked as they are met, the same as sign-up, because the
 * server enforces the same rules and a silent rejection here is worse.
 */
export default function ResetPasswordForm() {
  const token = useSearchParams().get("token");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checks = passwordChecks(password);
  const passwordError = validateNewPassword(password);
  const mismatch = confirm.length > 0 && password !== confirm;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    setError(null);
    if (!token || passwordError || password !== confirm) return;
    setSubmitting(true);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not reset your password.",
      );
      setSubmitting(false);
    }
  }

  const header = (title: string) => (
    <h1 className="mb-2 font-semibold text-[var(--mk-text)] text-title-sm sm:text-title-md">
      {title}
    </h1>
  );

  return (
    <div className="flex flex-col flex-1 w-full overflow-y-auto lg:w-1/2 no-scrollbar">
      <div className="flex flex-col justify-center flex-1 w-full max-w-md mx-auto">
        {!token ? (
          <>
            {header("Nothing to reset")}
            <p className="text-sm text-[var(--mk-muted)]">
              This page opens from the link in your reset email. Open that link,
              or ask for a new one.
            </p>
            <div className="mt-5">
              <Link
                href="/forgot-password"
                className="text-sm text-[var(--mk-brand-lit)] hover:text-[var(--mk-brand-lit)]"
              >
                Request a reset link
              </Link>
            </div>
          </>
        ) : done ? (
          <>
            {header("Password changed")}
            <p className="text-sm text-[var(--mk-muted)]">
              You can sign in with your new password now.
            </p>
            <div className="mt-5">
              <Link href="/signin">
                <Button size="sm">Go to sign in</Button>
              </Link>
            </div>
          </>
        ) : (
          <>
            <div className="mb-5 sm:mb-8">
              {header("Set a new password")}
              <p className="text-sm text-[var(--mk-muted)]">
                Choose a password you have not used here before.
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
                  <Label htmlFor="reset-password">
                    New password <span className="text-error-400">*</span>
                  </Label>
                  <div className="relative">
                    <Input
                      id="reset-password"
                      type={show ? "text" : "password"}
                      name="password"
                      placeholder="At least 8 characters"
                      autoComplete="new-password"
                      required
                      defaultValue={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onBlur={() => setTouched(true)}
                    />
                    <span
                      onClick={() => setShow(!show)}
                      className="absolute z-30 -translate-y-1/2 cursor-pointer right-4 top-1/2"
                    >
                      {show ? (
                        <EyeIcon className="fill-gray-500" />
                      ) : (
                        <EyeCloseIcon className="fill-gray-500" />
                      )}
                    </span>
                  </div>
                  <ul className="mt-3 space-y-1">
                    {checks.map((check) => (
                      <li
                        key={check.label}
                        className={`flex items-center gap-2 text-xs transition-colors ${
                          check.met
                            ? "text-success-700"
                            : "text-[var(--mk-muted)]"
                        }`}
                      >
                        <span aria-hidden="true">{check.met ? "✓" : "-"}</span>
                        {check.label}
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <Label htmlFor="reset-confirm">
                    Confirm password <span className="text-error-400">*</span>
                  </Label>
                  <Input
                    id="reset-confirm"
                    type={show ? "text" : "password"}
                    name="confirm"
                    placeholder="Type it again"
                    autoComplete="new-password"
                    required
                    defaultValue={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                  {mismatch ? (
                    <p className="mt-1.5 text-sm text-error-400">
                      The two passwords do not match
                    </p>
                  ) : null}
                  {touched && passwordError && !mismatch ? (
                    <p className="mt-1.5 text-sm text-error-400">
                      {passwordError}
                    </p>
                  ) : null}
                </div>

                <Button
                  className="w-full"
                  size="sm"
                  type="submit"
                  disabled={submitting}
                >
                  {submitting ? "Saving…" : "Set new password"}
                </Button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
