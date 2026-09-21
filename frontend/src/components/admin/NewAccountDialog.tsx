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
 *
 * IT MUST SATISFY THE SERVER, and it did not. `backend/app/core/passwords.py`
 * requires a digit and a special character; this generator produced letters and
 * digits only, so the password it pre-filled was refused every single time and
 * "Create user" answered "Add at least one special character" on a field the
 * admin had not typed. Creating an account from this console could not be done
 * without first noticing that and editing the password by hand.
 *
 * So the classes are not left to chance. Sixteen random characters from a
 * mixed alphabet will almost always contain a digit and a symbol, and "almost
 * always" is the wrong guarantee for a form that refuses the remainder: one of
 * each is placed deliberately, then the result is shuffled so their positions
 * carry no information.
 */

/** No 0/O and no 1/l/I: this gets read down a phone. */
const LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
const DIGITS = "23456789";
//: Deliberately small and deliberately boring. Every one of these survives a
//: shell, a spreadsheet and a chat window unescaped, and is unambiguous when
//: spoken aloud.
const SYMBOLS = "!@#$%*?-+=";

/** A uniform pick, rejecting the biased tail rather than taking `% n`. */
function pick(alphabet: string): string {
  const limit = Math.floor(0x100000000 / alphabet.length) * alphabet.length;
  const one = new Uint32Array(1);
  let n = 0;
  do {
    crypto.getRandomValues(one);
    n = one[0];
  } while (n >= limit);
  return alphabet[n % alphabet.length];
}

export function generatePassword(length = 16): string {
  const all = LETTERS + DIGITS + SYMBOLS;
  const chars = [pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < length) chars.push(pick(all));

  // Fisher-Yates, so the guaranteed digit and symbol are not always first.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const one = new Uint32Array(1);
    crypto.getRandomValues(one);
    const j = one[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
