import Link from "next/link";

import { REFUND_BANDS, REFUND_MEASURE } from "@/lib/refundPolicy";

/**
 * The refund policy in short, for the pages where money is being decided.
 *
 * A COMPONENT RATHER THAN A THIRD COPY OF THE MARKUP. The bands already come
 * from one module, which stops the numbers drifting; this stops the wording
 * and the layout drifting too. It appears on /pricing and on /courses, and
 * "Bundles are not covered" needs to read identically on both — the moment one
 * page phrases the exclusion differently from the other, a customer has two
 * statements to choose between.
 *
 * /terms deliberately does NOT use this. It carries the full policy: the table
 * with its reasons, what counts as a completed module, how to ask, and the
 * three cases the bands do not cover. This is the summary that points there.
 */
export default function RefundPolicyNote({
  /** Sits inside an existing section when false; brings its own when true. */
  standalone = true,
}: {
  standalone?: boolean;
}) {
  const card = (
    <div className="mx-auto max-w-3xl rounded-2xl border border-[var(--mk-line)] bg-[var(--mk-raised)] p-8 md:p-10">
      <h2 className="mb-2 text-2xl font-semibold text-[var(--mk-text)]">
        Changed your mind?
      </h2>
      <p className="mb-8 text-base text-[var(--mk-muted)]">
        What comes back on a single course depends on how much of it you have
        done. Nothing else changes it.
      </p>

      <ul className="mb-8 grid gap-4 sm:grid-cols-3">
        {REFUND_BANDS.map((band) => (
          <li
            key={band.progress}
            className="rounded-xl border border-[var(--mk-line)] p-5"
          >
            <span className="mb-1 block text-sm text-[var(--mk-muted)]">
              {band.progress} done
            </span>
            <span className="block text-lg font-semibold text-[var(--mk-text)]">
              {band.refund}
            </span>
          </li>
        ))}
      </ul>

      <p className="text-base text-[var(--mk-muted)]">
        {REFUND_MEASURE} Bundles and All Access are not covered by these bands,
        write to us and we will sort it out.{" "}
        <Link
          href="/terms"
          className="font-medium text-[var(--mk-brand-lit)] hover:underline"
        >
          Read the full policy
        </Link>
        .
      </p>
    </div>
  );

  if (!standalone) return card;

  return (
    <section className="pb-16 md:pb-20">
      <div className="container">{card}</div>
    </section>
  );
}
