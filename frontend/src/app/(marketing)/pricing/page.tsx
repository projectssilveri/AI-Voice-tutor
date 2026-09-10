import type { Metadata } from "next";

import Breadcrumb from "@/components/marketing/common/Breadcrumb";
import { type PublicPlan, listPublicPlans } from "@/lib/catalogue";
import OrgRedirectNotice from "@/components/org/OrgRedirectNotice";
import PlanPurchase from "@/components/marketing/PlanPurchase";
import RefundPolicyNote from "@/components/marketing/RefundPolicyNote";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Buy a course outright, or subscribe for access to everything. One free course to start with.",
};

function money(minor: number, currency = "INR"): string {
  const symbol = currency === "INR" ? "₹" : `${currency} `;
  return `${symbol}${(minor / 100).toLocaleString("en-IN")}`;
}

function interval(value: string): string {
  return value === "yearly" ? "year" : "month";
}

/**
 * Pricing — subscription plans only.
 *
 * Single-course prices live on the course card in `/courses`, which is the one
 * surface a course price appears on. Listing them here as well meant two
 * places to read a price from and two places for it to go stale, and it
 * duplicated a catalogue the visitor already has a nav link to.
 *
 * Plans are read from the database, so a price change by a super admin shows
 * up here without a deploy. The catalogue is no longer fetched at all — one
 * fewer request on every load of this page.
 */
export default async function PricingPage() {
  let plans: PublicPlan[] = [];
  let failed = false;

  try {
    plans = await listPublicPlans();
  } catch {
    // The page still renders; a pricing page that 500s is worse than one that
    // says it cannot reach the catalogue.
    failed = true;
  }

  const bestValue = plans.length > 1 ? plans[plans.length - 1].id : null;

  return (
    <>
      <Breadcrumb
        pageName="Pricing"
        description="Buy a single course, or subscribe and get the lot. Every course includes the voice tutor, quizzes, assignments and a certification exam."
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
                ? "Pricing is unavailable right now. Please try again shortly."
                : "Subscription plans are on the way."}
            </p>
          ) : (
            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
              {plans.map((plan) => {
                const highlighted = plan.id === bestValue;
                return (
                  <div
                    key={plan.id}
                    className={`relative flex flex-col rounded-xl bg-[var(--mk-raised)] p-8 sm:p-10 ${
 highlighted ?"ring-2 ring-[var(--mk-brand)]" : ""
                    }`}
                  >
                    {highlighted ? (
                      <span className="absolute right-6 top-6 rounded-full bg-[var(--mk-brand)] px-3 py-1 text-xs font-semibold text-white">
                        Best value
                      </span>
                    ) : null}

                    <h3 className="mb-2 text-xl font-semibold text-[var(--mk-text)]">
                      {plan.name}
                    </h3>
                    <p className="mb-6 text-base text-[var(--mk-muted)]">
                      {plan.description}
                    </p>

                    <div className="mb-6 flex items-end gap-1">
                      <span className="text-4xl font-semibold text-[var(--mk-text)]">
                        {money(plan.price_minor, plan.currency)}
                      </span>
                      <span className="pb-1 text-base text-[var(--mk-muted)]">
                        /{interval(plan.billing_interval)}
                      </span>
                    </div>

                    <ul className="mb-8 space-y-3 border-t border-[var(--mk-line)] pt-6 text-base text-[var(--mk-muted)]">
                      <li>{plan.course_titles.length} courses included</li>
                      <li>Voice tutor on every module</li>
                      <li>Quizzes and assignments, marked instantly</li>
                      <li>Certification exam and certificate</li>
                      <li>Unlimited re-reads and retakes</li>
                    </ul>

                    {/* Was `/signup?plan={id}`, and NOTHING read `?plan=` —
                        so picking a plan, signing up and arriving at the
                        dashboard left the visitor with no subscription and no
                        record of what they chose. `startPlanCheckout` existed,
                        wired to Razorpay, called by nobody. */}
                    <PlanPurchase
                      planId={plan.id}
                      priceMinor={plan.price_minor}
                      currency={plan.currency}
                      courseIds={plan.course_ids}
                      highlighted={highlighted}
                    />
                  </div>
                );
              })}
            </div>
          )}

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
