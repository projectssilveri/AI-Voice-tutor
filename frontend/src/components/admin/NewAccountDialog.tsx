"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The password, shown once, after an account is created.
 *
 * THIS IS THE ONLY TIME IT CAN BE SHOWN. The server stores an argon2 hash and
 * nothing else, so there is no "resend the password" later — the alternative to
 * this dialog is an admin who created an account nobody can sign in to.
 *
 * A dialog rather than a line on the form, because the form is about to be
 * cleared and reused for the next person. A password sitting in a field that is
 * about to be overwritten is a password lost.
 *
 * Uses the native `<dialog>`: it gets focus trapping, Escape-to-close and the
 * top layer from the browser, none of which is worth reimplementing.
 */
export default function NewAccountDialog({
  name,
  email,
  password,
  onClose,
}: {
  name: string;
  email: string;
  password: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    // `showModal`, not the `open` attribute: only the former puts the dialog in
    // the top layer and traps focus.
    dialog.current?.showModal();
  }, []);

  async function copy(what: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard access can be refused, and over plain HTTP it simply does not
      // exist. The value is on screen either way, so this is a convenience
      // failing rather than the dialog failing.
      setCopied("failed");
    }
  }

  const both = `Email: ${email}\nPassword: ${password}`;

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      className="max-w-lg rounded-2xl border border-gray-200 bg-white p-0 text-gray-800 backdrop:bg-black/40 dark:border-gray-800 dark:bg-gray-900 dark:text-white/90"
    >
      <div className="p-6">
        <h2 className="mb-1 text-lg font-semibold">Account created</h2>
        <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
          {name} can sign in with these. Give them to {name.split(" ")[0]} now,
          we store the password only as a hash, so this cannot be shown again.
        </p>

        <dl className="mb-5 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
          <div className="flex items-center justify-between gap-4 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
            <div className="min-w-0">
              <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Email
              </dt>
              <dd className="truncate font-mono text-sm">{email}</dd>
            </div>
            <button
              type="button"
              onClick={() => void copy("email", email)}
              className="shrink-0 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium transition hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-white/5"
            >
              {copied === "email" ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0">
              <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Password
              </dt>
              {/* Shown, not dotted. Hiding it would mean the admin has to
                  reveal it anyway to read it out, and the whole purpose of this
                  dialog is that it is read. */}
              <dd className="truncate font-mono text-sm">{password}</dd>
            </div>
            <button
              type="button"
              onClick={() => void copy("password", password)}
              className="shrink-0 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium transition hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-white/5"
            >
              {copied === "password" ? "Copied" : "Copy"}
            </button>
          </div>
        </dl>

        {copied === "failed" ? (
          <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
            Copying is not available here. Select the text above instead.
          </p>
        ) : null}

        <p className="mb-5 rounded-lg bg-warning-50 px-4 py-3 text-sm text-warning-900 dark:bg-warning-500/15 dark:text-warning-300">
          No email is sent. There is no mail provider wired up, so passing this
          on is your job. Once you close this, it is gone.
        </p>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void copy("both", both)}
            className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600"
          >
            {copied === "both" ? "Copied both" : "Copy both"}
          </button>
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium transition hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-white/5"
          >
            I have saved these
          </button>
        </div>
      </div>
    </dialog>
  );
}

/**
 * A password worth handing over.
 *
 * Generated in the browser from `crypto.getRandomValues`, never `Math.random`,
 * which is not a source anybody should take a credential from. The alphabet
 * omits the characters people misread when a password is read down a phone:
 * no 0/O, no 1/l/I.
 */
export function generatePassword(length = 16): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => alphabet[n % alphabet.length]).join("");
}
