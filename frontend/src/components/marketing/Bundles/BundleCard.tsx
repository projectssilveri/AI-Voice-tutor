import PlanPurchase from "@/components/marketing/PlanPurchase";
import { type PublicPlan, intervalLabel } from "@/lib/catalogue";
import { counted } from "@/lib/plural";

/**
 * One stack bundle.
 *
 * The card answers three questions in the order somebody asks what stack
 * is this, what does it cost, and exactly which courses do I get. That last
 * one is why the courses are listed in full rather than summarised as "4
 * courses" — the whole reason to buy a bundle instead of picking courses is to
 * be told which ones go together, and hiding the list behind a count throws
 * that away.
 *
 * ON THE COMPARISON PRICE. The muted line says what these courses cost bought
 * one at a time, and stops there. No percentage, no "SAVE 84%", no struck-out
 * total dressed as a former a monthly subscription and a set of
 * outright purchases are different things, and a saving computed across them
 * would be a number that means nothing. The reader gets both figures and can
 * judge. Same reasoning as migration 0016, which deliberately left every
 * course's "was" price empty rather than inventing one.
 */
export default function BundleCard({
  plan,
  featured = false,
}: {
  plan: PublicPlan;
  /** The one card the page leads with. Styling only; it buys the same thing. */
  featured?: boolean;
}) {
  const money = (minor: number) => {
    const symbol = plan.currency === "INR" ? "₹" : `${plan.currency} `;
    return `${symbol}${(minor / 100).toLocaleString("en-IN")}`;
  };

  return (
    <div
      className={`relative flex h-full flex-col rounded-2xl bg-[var(--mk-raised)] p-8 ${
 featured ? "ring-2 ring-[var(--mk-brand)]" : ""
      }`}
    >
      {featured ? (
        <span className="absolute right-6 top-6 rounded-full bg-[var(--mk-brand)] px-3 py-1 text-xs font-semibold text-white">
          Most complete
        </span>
      ) : null}

      <span className="mb-3 inline-flex w-fit rounded-full bg-[var(--mk-brand)]/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--mk-brand-lit)]">
        {counted(plan.course_count, "course")}
      </span>

      <h3 className="mb-2 pr-20 text-xl font-semibold text-[var(--mk-text)]">
        {plan.name}
      </h3>
      <p className="mb-6 text-base text-[var(--mk-muted)]">
        {plan.description}
      </p>

      <div className="mb-1 flex items-end gap-1">
        <span className="text-4xl font-semibold text-[var(--mk-text)]">
          {money(plan.price_minor)}
        </span>
        <span className="pb-1 text-base text-[var(--mk-muted)]">
          /{intervalLabel(plan.billing_interval)}
        </span>
      </div>
      {plan.separate_total_minor > 0 ? (
        <p className="mb-6 text-sm text-[var(--mk-muted)]">
          {money(plan.separate_total_minor)} to buy these courses separately
        </p>
      ) : (
        <div className="mb-6" />
      )}

      <div className="mb-8 border-t border-[var(--mk-line)] pt-6">
        <h4 className="mb-3 text-sm font-semibold text-[var(--mk-text)]">
          The stack
        </h4>
        <ul className="space-y-2.5">
          {plan.course_titles.map((title, index) => (
            <li
              key={title}
              className="flex items-start gap-3 text-base text-[var(--mk-muted)]"
            >
              <span
                aria-hidden="true"
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--mk-brand)]/10 text-xs font-semibold text-[var(--mk-brand-lit)]"
              >
                {index + 1}
              </span>
              <span>{title}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-[var(--mk-muted)]">
          Voice tutor, quizzes, assignments and a certification exam on every
          one.
        </p>
      </div>

      <PlanPurchase
        planId={plan.id}
        priceMinor={plan.price_minor}
        currency={plan.currency}
        courseIds={plan.course_ids}
        highlighted={featured}
      />
    </div>
  );
}
