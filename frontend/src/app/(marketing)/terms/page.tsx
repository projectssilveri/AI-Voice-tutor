import type { Metadata } from "next";
import Link from "next/link";

import ReadingProgress from "@/components/marketing/ui/ReadingProgress";
import {
  PageHeader,
  PageSection,
  Placeholder,
} from "@/components/marketing/PageShell";
import { REFUND_BANDS } from "@/lib/refundPolicy";

export const metadata: Metadata = {
  title: "Terms and conditions",
  description:
    "The refund policy in full, how progress is measured, and how to ask.",
};

/**
 * Terms and conditions.
 *
 * MOST OF THIS IS NOT WRITTEN, and says so. Acceptable use, liability and
 * governing law need a lawyer, and placeholder legal text that reads like real
 * legal text is worse than an empty page: a customer may rely on it and it
 * would not hold.
 *
 * The refund policy IS here in full, because it is the one term money is taken
 * against and a customer has to be able to read it before paying. It renders
 * from `lib/refundPolicy.ts` rather than restating the bands, so this page and
 * the summaries on /pricing and /courses cannot drift apart.
 * `backend/tests/test_refund_policy.py` reads this file and fails if it starts
 * hand-writing a band.
 */
export default function Page() {
  return (
    <>
      <ReadingProgress />
      <PageHeader
        eyebrow="Legal"
        title="Terms and conditions"
        intro="The refund policy is settled and written out below. The rest of these terms has not been drafted yet, and this page says so rather than pretending otherwise."
      />

      <PageSection title="Refunds on a single course">
        <p>
          What comes back depends on how far through the course you are, and
          nothing else. No form to argue your case, no discretion, no different
          answer depending on who replies to you.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-left text-[15px]">
            <thead>
              <tr className="border-b border-[var(--mk-line)]">
                <th className="py-3 pr-4 font-semibold text-[var(--mk-text)]">
                  Progress
                </th>
                <th className="py-3 pr-4 font-semibold text-[var(--mk-text)]">
                  You get
                </th>
                <th className="py-3 font-semibold text-[var(--mk-text)]">Why</th>
              </tr>
            </thead>
            <tbody>
              {REFUND_BANDS.map((band) => (
                <tr
                  key={band.progress}
                  className="border-b border-[var(--mk-line)] align-top"
                >
                  <td className="py-3 pr-4 text-[var(--mk-text)]">
                    {band.progress}
                  </td>
                  <td className="py-3 pr-4 font-medium text-[var(--mk-brand-lit)]">
                    {band.refund}
                  </td>
                  <td className="py-3 text-[var(--mk-muted)]">{band.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PageSection>

      <PageSection title="How progress is measured" tinted>
        <p>
          Progress is the number of modules you have marked complete, divided by
          the number of modules in that course. It is the same figure your
          dashboard shows, so if you want to know where you stand before asking,
          go and look. There is no separate figure kept behind the scenes.
        </p>
        <p>
          Opening a module does not count. Listening to part of a lecture does
          not count. Only marking a module complete does, which means the number
          only moves when you move it.
        </p>
      </PageSection>

      <PageSection title="How to ask for one">
        <p>
          Write to us through the{" "}
          <Link
            href="/contact"
            className="font-medium text-[var(--mk-brand-lit)] hover:underline"
          >
            contact form
          </Link>{" "}
          and say which course. We check the progress figure on your account,
          apply the band above, and reply.
        </p>
        <p>
          Money goes back to the card or account it came from, through Razorpay,
          because that is the only route we have. It usually lands within five
          to seven working days once we send it, and that part is the bank&apos;s
          timing rather than ours.
        </p>
      </PageSection>

      <PageSection title="What the bands do not cover" tinted>
        <p>
          Bundles and All Access subscriptions are not covered by these bands.
          They open several courses at once, so a single progress figure would
          not mean anything. Write to us and we will sort it out case by case.
        </p>
        <p>
          Subscriptions do not auto-cancel. To stop one, write to us, because
          there is no cancel button yet. Your plan then runs to the end of the
          period you have already paid for and does not renew.
        </p>
        <p>
          Organisation accounts are billed to the organisation, not to the
          learner, so an employee cannot request a refund on training their
          employer bought.
        </p>
      </PageSection>

      <PageSection title="Everything else">
        <Placeholder
          label="Acceptable use, liability, governing law, and how these terms change"
          hint="These have not been drafted. This is a legal document and it has deliberately been left empty rather than filled with sample text. Placeholder terms that read like real terms are worse than none: someone may rely on them, and they would not hold. Have these drafted before taking payments at scale."
        />
      </PageSection>
    </>
  );
}
