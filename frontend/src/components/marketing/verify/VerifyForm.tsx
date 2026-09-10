"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const match = UUID.exec(value.trim());
    if (!match) {
      setError(
        "That does not look like a certificate ID. It is 36 characters with four hyphens, printed at the foot of the certificate.",
      );
      return;
    }
    router.push(`/verify/${match[0].toLowerCase()}`);
  }

  return (
    <section className="pb-20 pt-4">
        <div className="container">
          <div className="mx-auto max-w-[620px] rounded-xl bg-[var(--mk-raised)] p-8 sm:p-11">
            <form onSubmit={handleSubmit}>
              <label
                htmlFor="certificate-id"
                className="mb-3 block text-sm font-medium text-[var(--mk-text)]"
              >
                Certificate ID
              </label>
              <input
                id="certificate-id"
                type="text"
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                  setError(null);
                }}
                placeholder="00000000-0000-0000-0000-000000000000"
                className="mb-1 font-mono w-full rounded-xl border border-[var(--mk-line)] bg-[var(--mk-inset)] px-4 py-3 text-base text-[var(--mk-text)] outline-none transition-[border-color,box-shadow] focus:border-[var(--mk-brand)] focus:ring-3 focus:ring-[var(--mk-brand)]/25"
              />
              <p className="mb-5 text-sm text-[var(--mk-muted)]">
                You can paste the whole verification link instead and we will pull the ID out of it.
              </p>

              {error ? (
                <p
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
