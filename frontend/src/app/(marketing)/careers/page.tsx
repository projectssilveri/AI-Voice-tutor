import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader, PageSection } from "@/components/marketing/PageShell";

export const metadata: Metadata = {
  title: "Careers",
  description: "Working with us.",
};

/**
 * Careers.
 *
 * WHAT THIS PAGE USED TO BE. Two `Placeholder` boxes reading "Content to be
 * added" — an editor's note left facing the public. Somebody who clicked
 * Careers was told the page was unfinished, which is worse than saying nothing.
 *
 * It now says the true thing plainly: there is no vacancy open, and here is
 * what to do if you want to be considered anyway. No invented openings — a
 * careers page listing roles that do not exist wastes an applicant's time and
 * is exactly the sort of thing people remember about a company.
 */
export default function Page() {
  return (
    <>
      <PageHeader
        eyebrow="Careers"
        title="Careers"
        intro="We are a small team building a tutor that teaches out loud. Open roles are listed here as they come up."
      />

      <PageSection title="Open roles">
        <div className="rounded-xl border border-[var(--mk-line)] bg-[var(--mk-raised)] p-8 text-center">
          <p className="mb-2 text-xl font-semibold text-[var(--mk-text)]">
            No open positions
          </p>
          <p className="mx-auto max-w-lg text-base text-[var(--mk-muted)]">
            {/* The convention every careers page settles on: state it plainly,
                then give the reader somewhere to go. The earlier draft
                ("we are not hiring, but that changes... keep it on file")
                explained the obvious and sounded apologetic. */}
            We are not hiring at the moment. New roles are posted here first.
          </p>
        </div>
      </PageSection>

      <PageSection title="Interested anyway?" tinted>
        <div className="mx-auto max-w-2xl text-center">
          <p className="mb-6 text-base text-[var(--mk-muted)]">
            We are always glad to hear from good people. Tell us what you do and
            what you would want to work on, and we will get in touch when
            something suitable opens up.
          </p>
          <Link
            href="/contact?subject=Careers"
            className="inline-flex items-center justify-center rounded-xl bg-[var(--mk-brand)] px-8 py-3 text-base font-semibold text-white transition duration-300 hover:bg-[var(--mk-brand)]/90"
          >
            Send us your details
          </Link>
        </div>
      </PageSection>
    </>
  );
}
