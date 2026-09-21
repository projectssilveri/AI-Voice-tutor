import type { Metadata } from "next";
import Link from "next/link";

import Breadcrumb from "@/components/marketing/common/Breadcrumb";
import {
  type PublicPlan,
  intervalLabel,
  listPublicPlans,
  splitPlans,
} from "@/lib/catalogue";
import { formatMoney as money } from "@/lib/money";
import OrgRedirectNotice from "@/components/org/OrgRedirectNotice";
import PlanPurchase from "@/components/marketing/PlanPurchase";
import RefundPolicyNote from "@/components/marketing/RefundPolicyNote";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "One subscription for every course on the platform, including the ones added while it runs.",
};

// `money` and `interval` used to be written out here. Both already existed —
// one in `lib/money`, one in `lib/catalogue` — and the local copies rounded
// differently from the Subscribe button rendered inside these very cards.

/**
 * What a plan works out at per month, whatever it is billed in.
 *
 * "Best value" used to be whichever card sat last in the grid, i.e. the
 * dearest one. That happened to land on the yearly plan, so it happened to be
 * right, and it would have gone on being printed on whatever became most
 * expensive. A badge on a price has to be a claim the reader can check, and
 * the only comparable figure between a ₹1,499 month and a ₹14,999 year is what
 * each costs per month.
 */
function perMonthMinor(plan: PublicPlan): number {
  if (plan.billing_interval !== "yearly") return plan.price_minor;
  // To the whole rupee, not the paisa. A twelfth of 14,999 is 1,249.92, and
  // "works out at Rs 1,249.92 a month" is a number nobody asked for on a
  // price they will never be charged. Hence "About" in the line that shows it.
  return Math.round(plan.price_minor / 12 / 100) * 100;
}

/**
 * Pricing — All Access only.
 *
 * ONE PLAN, ONE PAGE. Two things used to be listed here that are priced
 * elsewhere, and both were removed for the same reason: a price that appears
 * on two surfaces is a price that can disagree with itself.
 *
 *   Single-course prices went to the course card in `/courses`.
 *
 *   Stack bundles went to `/bundles` — except the filter that was supposed to
 *   leave them out of this page was never added, so for a while every bundle
 *   was priced twice, and the copy here was the poorer of the two: a course
 *   COUNT where the bundle card lists the actual stack. `splitPlans` is the
 *   same call `/bundles` makes, from the other side, so neither page can pick
 *   up a plan the other one is showing.
 *
 * What is left is the whole catalogue on one subscription, which is what the
 * heading below has always said this page was for.
 *
 * Plans are read from the database, so a price change by a super admin shows
 * up here without a deploy. The catalogue is no longer fetched at all — one
 * fewer request on every load of this page.
 */
export default async function PricingPage() {
  let plans: PublicPlan[] = [];
  let bundleCount = 0;
  let bundlesFrom: number | null = null;
  let currency = "INR";
  let failed = false;

  try {
    const split = splitPlans(await listPublicPlans());
    plans = split.allAccess;
    // Quoted at the foot, so somebody who only wants one stack is not left
    // choosing between All Access and nothing. The mirror of the "See All
    // Access" card on /bundles.
    bundleCount = split.bundles.length;
    bundlesFrom = split.bundles.length
      ? Math.min(...split.bundles.map((plan) => plan.price_minor))
      : null;
    currency = plans[0]?.currency ?? split.bundles[0]?.currency ?? "INR";
  } catch {
    // The page still renders; a pricing page that 500s is worse than one that
    // says it cannot reach the catalogue.
    failed = true;
  }

  // Only when one plan is genuinely cheaper per month than the rest. Two plans
  // at the same monthly rate and the badge says nothing true about either, so
  // it is not printed — same rule as "Most complete" on /bundles.
  const cheapestPerMonth = plans.length
    ? Math.min(...plans.map(perMonthMinor))
    : 0;
  const atCheapest = plans.filter(
    (plan) => perMonthMinor(plan) === cheapestPerMonth,
  );
  const bestValue =
    plans.length > 1 && atCheapest.length === 1 ? atCheapest[0].id : null;

  return (
    <>
      {/* It said "Buy a single course, or subscribe and get the lot" —
          offering, at the top of the page, the one thing that is priced on
          /courses. The sentence outlived both the single-course prices and the
          bundles it used to sit above. */}
      <Breadcrumb
        pageName="Pricing"
        description="One subscription, every course on the platform. Each one includes the voice tutor, quizzes, assignments and a certification exam."
      />
      <OrgRedirectNotice context="pricing" />

      {/* Subscriptions */}
      <section className="pb-12 pt-16 md:pb-16 md:pt-20">
        <div className="container">
          <div className="mx-auto mb-12 max-w-[620px] text-center">
            <h2 className="mb-4 text-3xl font-semibold text-[var(--mk-text)] sm:text-4xl">
              Subscribe to everything
            </h2>
            <p className="text-base text-[var(--mk-muted)]">
              One price, every course, including the ones added while your plan
              is running.
            </p>
          </div>

          {failed || plans.length === 0 ? (
            <p className="text-center text-base text-[var(--mk-muted)]">
              {failed
                ? "We could not load the prices. That is our end, not yours. Reload in a moment."
                : "All Access is on the way."}
            </p>
          ) : (
            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
              {plans.map((plan) => {
                const highlighted = plan.id === bestValue;
                return (
                  <div
                    key={plan.id}
                    className={`relative flex flex-col rounded-2xl p-8 sm:p-9 transition-all duration-300 backdrop-blur-xl ${
                      highlighted
                        ? "border-2 border-indigo-500/60 bg-gradient-to-b from-indigo-950/40 via-[var(--mk-raised)]/90 to-[var(--mk-raised)] shadow-[0_0_40px_rgba(99,102,241,0.25)] -translate-y-1"
                        : "border border-white/10 bg-[var(--mk-raised)]/70 hover:border-indigo-500/30 hover:-translate-y-0.5 hover:shadow-[0_12px_32px_-8px_rgba(99,102,241,0.15)]"
                    }`}
                  >
                    {highlighted ? (
                      <span className="absolute -top-3.5 right-6 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-indigo-600 px-3.5 py-1 text-xs font-bold text-white shadow-[0_0_15px_rgba(99,102,241,0.5)]">
                        <span className="size-1.5 rounded-full bg-white animate-pulse" />
                        Best value
                      </span>
                    ) : null}

                    <h3 className="mb-2 text-xl font-bold text-white">
                      {plan.name}
                    </h3>
                    <p className="mb-6 text-[14.5px] leading-relaxed text-[var(--mk-muted)]">
                      {plan.description}
                    </p>

                    <div className="mb-1 flex items-baseline gap-1.5">
                      <span className="text-4xl font-bold tracking-tight text-white">
                        {money(plan.price_minor, plan.currency)}
                      </span>
                      <span className="text-sm font-medium text-slate-400">
                        /{intervalLabel(plan.billing_interval)}
                      </span>
                    </div>
                    {/* The figure the "Best value" badge is claiming, printed
                        where it can be read, rather than asserted and left for
                        the reader to divide by twelve. */}
                    {plan.billing_interval === "yearly" ? (
                      <p className="mb-6 text-[13px] text-slate-400">
                        About {money(perMonthMinor(plan), plan.currency)} a
                        month, billed once a year.
                      </p>
                    ) : (
                      <div className="mb-6" />
                    )}

                    <ul className="mb-8 space-y-3 border-t border-white/5 pt-6 text-[14.5px] text-slate-300">
                      {[
                        `Every course on the platform, all ${plan.course_titles.length} of them`,
                        "Voice tutor on every module",
                        "Quizzes and assignments, marked instantly",
                        "Certification exam and certificate",
                        "Unlimited re-reads and retakes",
                      ].map((feature, i) => (
                        <li key={i} className="flex items-center gap-2.5">
                          <svg
                            className="size-4 shrink-0 text-emerald-400"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                          >
                            <path
                              fillRule="evenodd"
                              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                              clipRule="evenodd"
                            />
                          </svg>
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>

                    <div className="mt-auto">
                      <PlanPurchase
                        planId={plan.id}
                        priceMinor={plan.price_minor}
                        currency={plan.currency}
                        courseIds={plan.course_ids}
                        highlighted={highlighted}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* The other direction of the /bundles signpost. Somebody who
              only wants the stack they are learning should not have to guess
              that a cheaper page exists. No per-bundle price here — one "from"
              figure is a signpost, not a second price list. */}
          {bundleCount > 0 ? (
            <div className="mx-auto mt-14 max-w-[620px] rounded-2xl border border-[var(--mk-line)] p-8 text-center">
              <h3 className="mb-2 text-xl font-semibold text-[var(--mk-text)]">
                Only learning one stack?
              </h3>
              <p className="mb-6 text-base text-[var(--mk-muted)]">
                {bundlesFrom !== null
                  ? `Full-stack bundles group the courses that get used together: a language, a database and the framework they run on. From ${money(bundlesFrom, currency)} a month.`
                  : "Full-stack bundles group the courses that get used together: a language, a database and the framework they run on."}
              </p>
              <Link
                href="/bundles"
                className="inline-flex rounded-lg bg-[var(--mk-brand)] px-6 py-3 text-base font-semibold text-white transition hover:bg-[var(--mk-brand)]/90"
              >
                See the bundles
              </Link>
            </div>
          ) : null}

          <p className="mt-12 text-center text-sm text-[var(--mk-muted)]">
            Prices in Indian rupees, inclusive of taxes. Razorpay handles the
            payment, so we never see your card details.
          </p>
        </div>
      </section>

      {/* Somebody deciding to pay should be able to read what happens if they
          change their mind, without leaving the page they are deciding on. */}
      <RefundPolicyNote />
    </>
  );
}
