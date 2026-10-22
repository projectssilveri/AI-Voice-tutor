"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import Button from "@/components/ui/button/Button";
import { ChevronLeftIcon } from "@/icons";
import { verifyEmail } from "@/lib/auth";

type Status = "verifying" | "done" | "error" | "missing";

/**
 * The page the link in the verification email opens. It reads the token from
 * the query, confirms it with the backend, and tells the person where to go
 * next. Runs the confirm exactly once: React Strict Mode mounts effects twice
 * in development, and a verify token is single-use, so the second call would
 * always "fail" and flash an error on a success.
 */
export default function VerifyEmailForm() {
  const token = useSearchParams().get("token");
  const [status, setStatus] = useState<Status>(token ? "verifying" : "missing");
  const [message, setMessage] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (!token || ran.current) return;
    ran.current = true;
    verifyEmail(token)
      .then(() => setStatus("done"))
      .catch((caught) => {
        setStatus("error");
        setMessage(
          caught instanceof Error
            ? caught.message
            : "This confirmation link is invalid or has expired.",
        );
      });
  }, [token]);

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
        {status === "verifying" ? (
          <>
            <h1 className="mb-2 font-semibold text-[var(--mk-text)] text-title-sm sm:text-title-md">
              Confirming your email…
            </h1>
            <p className="text-sm text-[var(--mk-muted)]">One moment.</p>
          </>
        ) : null}

        {status === "done" ? (
          <>
            <h1 className="mb-2 font-semibold text-[var(--mk-text)] text-title-sm sm:text-title-md">
              Email confirmed
            </h1>
            <p className="text-sm text-[var(--mk-muted)]">
              Your account is ready. You can sign in now.
            </p>
            <div className="mt-5">
              <Link href="/signin">
                <Button size="sm">Go to sign in</Button>
              </Link>
            </div>
          </>
        ) : null}

        {status === "missing" ? (
          <>
            <h1 className="mb-2 font-semibold text-[var(--mk-text)] text-title-sm sm:text-title-md">
              Nothing to confirm
            </h1>
            <p className="text-sm text-[var(--mk-muted)]">
              This page opens from the link in your confirmation email. Open
              that link, or sign in if your email is already confirmed.
            </p>
            <div className="mt-5">
              <Link
                href="/signin"
                className="text-sm text-[var(--mk-brand-lit)] hover:text-[var(--mk-brand-lit)]"
              >
                Go to sign in
              </Link>
            </div>
          </>
        ) : null}

        {status === "error" ? (
          <>
            <h1 className="mb-2 font-semibold text-[var(--mk-text)] text-title-sm sm:text-title-md">
              This link did not work
            </h1>
            <p className="text-sm text-[var(--mk-muted)]">
              {message ??
                "This confirmation link is invalid or has expired."}{" "}
              Sign in and we can send you a fresh one.
            </p>
            <div className="mt-5">
              <Link
                href="/signin"
                className="text-sm text-[var(--mk-brand-lit)] hover:text-[var(--mk-brand-lit)]"
              >
                Go to sign in
              </Link>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
