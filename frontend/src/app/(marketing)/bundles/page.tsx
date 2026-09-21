import type { Metadata } from "next";
import Link from "next/link";

import BundleCard from "@/components/marketing/Bundles/BundleCard";
import Breadcrumb from "@/components/marketing/common/Breadcrumb";
import OrgRedirectNotice from "@/components/org/OrgRedirectNotice";
import { type PublicPlan, listPublicPlans, splitPlans } from "@/lib/catalogue";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = {
  title: "Full-stack bundles",
  description:
    "Subscribe to a whole stack at once. A language, a database and a framework that are actually used together.",
};

/**
 * Full-stack bundles.
 *
 * WHY A PAGE OF ITS OWN. Bundle prices used to sit on /pricing beside the
 * all-access plans, in one grid, which asked the reader to work out from the
 * course list which cards were stacks and which were the whole catalogue. They
 * are different purchases and they are compared against different things: a
 * bundle against buying its courses one at a time, all-access against the
 * bundles. Splitting them means each page compares like with like, and each
 * price still appears on exactly one surface.
 *
 * Read from the database, so a price change by a super admin shows here
 * without a deploy — same as /pricing.
 */
export default async function BundlesPage() {
  let bundles: PublicPlan[] = [];
  let allAccessFrom: number | null = null;
  let currency = "INR";
  let failed = false;

  try {
    const plans = await listPublicPlans();
    const split = splitPlans(plans);
    bundles = split.bundles;
    currency = plans[0]?.currency ?? "INR";
    // The cheapest way to get everything, quoted at the bottom so somebody
    // weighing two bundles can see that three of them costs more than the lot.
    allAccessFrom = split.allAccess.length
      ? Math.min(...split.allAccess.map((plan) => plan.price_minor))
      : null;
  } catch {
    // The page still renders. A pricing page that 500s is worse than one that
    // says it cannot reach the catalogue.
    failed = true;
  }

  // The biggest stack leads — but ONLY if there genuinely is a biggest.
  //
  // A plain `reduce` for the maximum picked the first card whenever every
  // bundle held four courses, which is exactly what the seeded catalogue has.
  // "Most complete" then sat on Frontend Track for no reason a reader could
  // check, which is a badge that says something untrue about a price. When
  // nothing stands out, nothing is highlighted.
  const widest = Math.max(0, ...bundles.map((plan) => plan.course_count));
  const atWidest = bundles.filter((plan) => plan.course_count === widest);
  const featured = atWidest.length === 1 ? atWidest[0] : null;

  return (
    <>
      <Breadcrumb
        pageName="Full-stack bundles"
        description="Learn a whole stack rather than one piece of it. Each bundle is a language, a database and the framework they are used with, subscribed to together, at less than the courses cost separately."
      />
      <OrgRedirectNotice context="pricing" />

      <section className="pb-12 pt-16 md:pb-16 md:pt-20">
        <div className="container">
          <div className="mx-auto mb-12 max-w-[620px] text-center">
            <h2 className="mb-4 text-3xl font-semibold text-[var(--mk-text)] sm:text-4xl">
              Pick the stack you are learning
            </h2>
            <p className="text-base text-[var(--mk-muted)]">
              Every bundle opens all of its courses straight away. Your
              subscription runs until you cancel, and everything inside stays
              open while it does.
            </p>
          </div>

          {failed || bundles.length === 0 ? (
            <p className="text-center text-base text-[var(--mk-muted)]">
              {failed
                ? "We could not load the bundles. That is our end, not yours. Reload in a moment."
                : "Bundles are on the way."}
            </p>
          ) : (
            <div className="grid items-stretch gap-8 md:grid-cols-2 lg:grid-cols-3">
              {bundles.map((plan) => (
                <BundleCard
                  key={plan.id}
                  plan={plan}
                  featured={plan.id === featured?.id}
                />
              ))}
            </div>
          )}

          <div className="mx-auto mt-14 max-w-[620px] rounded-2xl border border-[var(--mk-line)] p-8 text-center">
            <h3 className="mb-2 text-xl font-semibold text-[var(--mk-text)]">
              Want more than one stack?
            </h3>
            <p className="mb-6 text-base text-[var(--mk-muted)]">
              {allAccessFrom !== null
                ? `All Access opens every course on the platform, including ones added later, from ${formatMoney(allAccessFrom, currency)} a month.`
                : "All Access opens every course on the platform, including ones added later."}
            </p>
            <Link
              href="/pricing"
              className="inline-flex rounded-lg bg-[var(--mk-brand)] px-6 py-3 text-base font-semibold text-white transition hover:bg-[var(--mk-brand)]/90"
            >
              See All Access
            </Link>
          </div>

          <p className="mt-10 text-center text-sm text-[var(--mk-muted)]">
            Prices in Indian rupees, inclusive of taxes. Razorpay handles the
            payment, so we never see your card details. Prefer one course?{" "}
            <Link
              href="/courses"
              className="font-medium text-[var(--mk-brand-lit)] hover:underline"
            >
              Browse the catalogue
            </Link>
            .
          </p>
        </div>
      </section>
    </>
  );
}
