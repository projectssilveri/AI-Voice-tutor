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

                    <div className="mb-6 flex items-baseline gap-1.5">
                      <span className="text-4xl font-bold tracking-tight text-white">
                        {money(plan.price_minor, plan.currency)}
                      </span>
                      <span className="text-sm font-medium text-slate-400">
                        /{interval(plan.billing_interval)}
                      </span>
                    </div>

                    <ul className="mb-8 space-y-3 border-t border-white/5 pt-6 text-[14.5px] text-slate-300">
                      {[
                        `${plan.course_titles.length} courses included`,
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
