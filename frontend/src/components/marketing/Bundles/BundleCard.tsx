import PlanPurchase from "@/components/marketing/PlanPurchase";
import { type PublicPlan, intervalLabel } from "@/lib/catalogue";
import { formatMoney } from "@/lib/money";
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
  const money = (minor: number) => formatMoney(minor, plan.currency);

  return (
    <div
      className={`relative flex h-full flex-col rounded-2xl p-8 sm:p-9 backdrop-blur-xl transition-all duration-300 ${
        featured
          ? "border-2 border-indigo-500/60 bg-gradient-to-b from-indigo-950/40 via-[var(--mk-raised)]/90 to-[var(--mk-raised)] shadow-[0_0_40px_rgba(99,102,241,0.25)] -translate-y-1"
          : "border border-white/10 bg-[var(--mk-raised)]/70 hover:border-indigo-500/30 hover:-translate-y-0.5 hover:shadow-[0_12px_32px_-8px_rgba(99,102,241,0.15)]"
      }`}
    >
      {featured ? (
        <span className="absolute -top-3.5 right-6 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-indigo-600 px-3.5 py-1 text-xs font-bold text-white shadow-[0_0_15px_rgba(99,102,241,0.5)]">
          <span className="size-1.5 rounded-full bg-white animate-pulse" />
          Most complete
        </span>
      ) : null}

      <span className="mb-3 inline-flex w-fit items-center gap-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-indigo-300">
        <span className="size-1 rounded-full bg-indigo-400" />
        {counted(plan.course_count, "course")}
      </span>

      <h3 className="mb-2 pr-12 text-xl font-bold text-white">
        {plan.name}
      </h3>
      <p className="mb-6 text-[14.5px] leading-relaxed text-[var(--mk-muted)]">
        {plan.description}
      </p>

      <div className="mb-1 flex items-baseline gap-1.5">
        <span className="text-4xl font-bold tracking-tight text-white">
          {money(plan.price_minor)}
        </span>
        <span className="text-sm font-medium text-slate-400">
          /{intervalLabel(plan.billing_interval)}
        </span>
      </div>
      {plan.separate_total_minor > 0 ? (
        <p className="mb-6 text-[13px] text-slate-400">
          <span className="line-through">{money(plan.separate_total_minor)}</span> if bought separately
        </p>
      ) : (
        <div className="mb-6" />
      )}

      <div className="mb-8 border-t border-white/5 pt-6">
        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-300">
          The stack
        </h4>
        <ul className="space-y-2.5">
          {plan.course_titles.map((title, index) => (
            <li
              key={title}
              className="flex items-center gap-3 text-[14.5px] text-slate-200"
            >
              <span
                aria-hidden="true"
                className="flex size-5 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-[11px] font-bold text-indigo-300 shadow-[0_0_8px_rgba(99,102,241,0.2)]"
              >
                {index + 1}
              </span>
              <span>{title}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[12.5px] text-[var(--mk-muted)]">
          Voice tutor, quizzes, assignments and certificate on every course.
        </p>
      </div>

      <div className="mt-auto">
        <PlanPurchase
          planId={plan.id}
          priceMinor={plan.price_minor}
          currency={plan.currency}
          courseIds={plan.course_ids}
          highlighted={featured}
        />
      </div>
    </div>
  );
}
