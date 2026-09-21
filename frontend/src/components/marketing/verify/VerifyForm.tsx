"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

// Accepts a bare UUID or the whole verification URL pasted in, because that is
// what someone holding a certificate actually has to hand.
const UUID =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * The certificate-ID form.
 *
 * SPLIT OUT OF THE ROUTE FILE so the route can be a server component. The
 * whole page was `"use client"`, and a client component cannot export
 * `metadata` — so /verify was the one public page on the site with no title
 * and no description of its own, falling back to the root layout's. That page
 * is where an EMPLOYER lands from a certificate, which makes it the worst one
 * to leave untitled in a browser tab or a search result.
 *
 * The deep link `/verify/{id}` already existed — it is the id printed on every
 * PDF — but nothing led to it, so an employer holding a certificate had no way
 * in without knowing the URL scheme. No account required, deliberately: a
 * verification that costs the checker a signup is a verification nobody
 * performs.
 */
export default function VerifyForm() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);

  /**
   * THE ONLY THING THIS FORM CAN HONESTLY REFUSE IS AN EMPTY BOX.
   *
   * It used to refuse anything that was not shaped like a UUID, with "That
   * does not look like a certificate ID. It is 36 characters with four
   * hyphens…". Somebody checking a certificate that turns out not to exist got
   * a lecture about formatting instead of an answer — and the form is not the
   * thing that knows whether a certificate is real. The lookup is.
   *
   * So anything typed goes through, and `/verify/{id}` gives the real answer:
   * "No certificate with this ID". The format is still explained under the
   * box, as a hint, which is what it always should have been.
   *
   * The UUID is still EXTRACTED when one is there, so pasting a whole
   * verification link keeps working — that is the common case, and it is the
   * one thing the form genuinely can do for the reader.
   */
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const typed = value.trim();

    if (!typed) {
      setError("The box is empty. Paste the certificate ID in first.");
      field.current?.focus();
      return;
    }

    const match = UUID.exec(typed);
    // Trimmed hard and length-capped: whatever this is, it becomes one path
    // segment, and an unbounded string in a URL is somebody else's bug later.
    const target = match
      ? match[0].toLowerCase()
      : encodeURIComponent(typed.slice(0, 120));

    router.push(`/verify/${target}`);
  }

  return (
    <section className="pb-20 pt-4">
        <div className="container">
          <div className="mx-auto max-w-[620px] rounded-xl bg-[var(--mk-raised)] p-8 sm:p-11">
            <form onSubmit={handleSubmit} noValidate>
              <label
                htmlFor="certificate-id"
                className="mb-3 block text-sm font-medium text-[var(--mk-text)]"
              >
                Certificate ID
              </label>
              {/* `aria-invalid` and `aria-describedby` so a screen reader
                  announces the box as wrong AND reads why. Without the second
                  one the message is on screen and simply not connected to the
                  field it is about. `noValidate` on the form keeps the browser
                  from firing its own bubble first and hiding ours. */}
              <input
                ref={field}
                id="certificate-id"
                type="text"
                required
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                  setError(null);
                }}
                aria-invalid={error ? true : undefined}
                aria-describedby={
                  error ? "certificate-id-error" : "certificate-id-hint"
                }
                placeholder="00000000-0000-0000-0000-000000000000"
                className={`mb-1 font-mono w-full rounded-xl border bg-[var(--mk-inset)] px-4 py-3 text-base text-[var(--mk-text)] outline-none transition-[border-color,box-shadow] focus:ring-3 ${
                  error
                    ? "border-error-500 focus:border-error-500 focus:ring-error-500/25"
                    : "border-[var(--mk-line)] focus:border-[var(--mk-brand)] focus:ring-[var(--mk-brand)]/25"
                }`}
              />
              <p
                id="certificate-id-hint"
                className="mb-5 text-sm text-[var(--mk-muted)]"
              >
                You can paste the whole verification link instead and we will pull the ID out of it.
              </p>

              {error ? (
                <p
                  id="certificate-id-error"
                  role="alert"
                  className="mb-5 rounded-xl bg-error-500/10 px-4 py-3 text-sm text-error-400"
                >
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                className="w-full rounded-xl bg-[var(--mk-brand)] px-9 py-4 text-base font-medium text-white duration-300 hover:bg-[var(--mk-brand)]/90"
              >
                Check this certificate
              </button>
            </form>
          </div>

          <p className="mx-auto mt-8 max-w-[620px] text-center text-base text-[var(--mk-muted)]">
            A certificate is issued only after passing that course&apos;s
            certification exam, which is capped at three attempts. We show the
            holder&apos;s name, the course and the date, and nothing about their account or their scores.
          </p>
        </div>
    </section>
  );
}
