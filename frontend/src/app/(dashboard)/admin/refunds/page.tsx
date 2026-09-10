"use client";

import { useCallback, useEffect, useState } from "react";

import RequireAuth from "@/components/auth/RequireAuth";
import {
  DashboardHeader,
  ErrorBanner,
  Panel,
} from "@/components/dashboard/Tiles";
import ProgressBar from "@/components/ui/ProgressBar";
import { formatMoney } from "@/lib/analytics";
import { counted } from "@/lib/plural";
import {
  type RefundQuote,
  type RefundTier,
  lookUpRefunds,
  recordRefund,
} from "@/lib/refunds";

/**
 * The refund desk.
 *
 * A ticket arrives saying "I want my money back for the Java course". This
 * screen answers the three questions that follow — did they pay, how far
 * through are they, and what does the policy give back — and then lets support
 * write down what was paid, which is what actually takes the course away.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not move money. Razorpay's refund
 * API is never called; support pays in the Razorpay dashboard and records it
 * here. The button says "Record" for that reason, and the page says so in
 * words — a button labelled "Refund" that only writes a row is the kind of
 * thing somebody presses twice.
 *
 * The tiers are printed from what the SERVER sent rather than restated in this
 * file. `services/refunds.py` computes the money; a second copy of the rule in
 * the browser is a second thing to forget to update, and the two disagreeing
 * would be the difference between what a customer was promised and what they
 * were paid.
 */
function RefundsAdmin() {
  const [search, setSearch] = useState("");
  const [tiers, setTiers] = useState<RefundTier[]>([]);
  const [quotes, setQuotes] = useState<RefundQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // The order currently being recorded, and the figure in its box.
  const [openOrder, setOpenOrder] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (term: string) => {
    setLoading(true);
    try {
      const result = await lookUpRefunds(term);
      setTiers(result.policy.tiers);
      setQuotes(result.quotes);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not load orders.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load("");
  }, [load]);

  function openFor(quote: RefundQuote) {
    setOpenOrder(quote.order_id);
    // Pre-filled with the policy amount in MAJOR units, because that is what
    // support types into Razorpay. It stays editable: a goodwill refund is a
    // real thing, and a box that refused to differ from the policy would send
    // people to the database to do it by hand.
    setAmount((quote.refund_minor / 100).toString());
    setNote("");
    setNotice(null);
    setError(null);
  }

  async function submit(quote: RefundQuote) {
    const major = Number(amount);
    if (!Number.isFinite(major) || major < 0) {
      setError("Enter the amount that was refunded.");
      return;
    }
    const minor = Math.round(major * 100);
    if (minor > quote.amount_minor) {
      setError("That is more than they paid.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await recordRefund(quote.order_id, {
        amount_minor: minor,
        note: note.trim() || undefined,
      });
      setNotice(
        `Recorded ${formatMoney(minor, quote.currency)} for ${quote.user_email}. Their access to ${quote.course_title} has been withdrawn.`,
      );
      setOpenOrder(null);
      await load(search);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not record the refund.",
      );
    } finally {
      setSaving(false);
    }
  }

  const toneFor = (key: string) =>
    key === "full"
      ? "bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-400"
      : key === "half"
        ? "bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-orange-400"
        : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";

  return (
    <div className="space-y-6">
      <DashboardHeader
        title="Refunds"
        subtitle="How far through a course somebody is, and what the policy gives back."
      />

      {error ? <ErrorBanner message={error} /> : null}
      {notice ? (
        <div
          role="status"
          className="rounded-2xl border border-success-500 bg-success-50 p-4 text-sm text-success-700 dark:bg-success-500/10 dark:text-success-400"
        >
          {notice}
        </div>
      ) : null}

      <Panel
        title="The policy"
        subtitle="Published on the terms page. These are the bands the amounts below come from."
      >
        <ul className="flex flex-wrap gap-3">
          {tiers.map((tier, index) => {
            const lower =
              index === 0 ? 0 : (tiers[index - 1].below_percent ?? 0);
            const range =
              tier.below_percent === null
                ? `${lower}% and above`
                : index === 0
                  ? `under ${tier.below_percent}%`
                  : `${lower}% up to ${tier.below_percent}%`;
            return (
              <li
                key={tier.key}
                className="rounded-xl border border-gray-200 px-4 py-3 dark:border-gray-800"
              >
                <span className="block text-sm font-medium text-gray-800 dark:text-white/90">
                  {tier.label}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {range} complete
                </span>
              </li>
            );
          })}
        </ul>
        <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
          Recording a refund here does not send any money. Pay it in Razorpay
          first, then record it so the course is taken back.
        </p>
      </Panel>

      <Panel
        title="Orders"
        subtitle="Search by email or name. Empty shows the most recent."
      >
        <form
          className="mb-5 flex flex-wrap gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void load(search);
          }}
        >
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Email or name"
            aria-label="Search by email or name"
            className="h-11 w-full max-w-sm rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
          />
          <button
            type="submit"
            className="h-11 rounded-lg bg-brand-500 px-5 text-sm font-medium text-white transition hover:bg-brand-600"
          >
            Search
          </button>
        </form>

        {loading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
        ) : quotes.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No paid orders match that.
          </p>
        ) : (
          <ul className="space-y-4">
            {quotes.map((quote) => {
              const refunded = quote.refunded_amount_minor !== null;
              return (
                <li
                  key={quote.order_id}
                  className="rounded-xl border border-gray-200 p-5 dark:border-gray-800"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-800 dark:text-white/90">
                        {quote.course_title}
                      </p>
                      <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                        {quote.user_name} · {quote.user_email}
                      </p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        Paid {formatMoney(quote.amount_minor, quote.currency)}
                        {quote.paid_at
                          ? ` on ${new Date(quote.paid_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`
                          : ""}
                      </p>
                    </div>

                    <div className="shrink-0 text-right">
                      {refunded ? (
                        <>
                          <span className="inline-flex rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                            Refunded
                          </span>
                          <p className="mt-1 text-sm font-semibold text-gray-800 dark:text-white/90">
                            {formatMoney(
                              quote.refunded_amount_minor ?? 0,
                              quote.currency,
                            )}{" "}
                            returned
                          </p>
                        </>
                      ) : quote.covered_by_policy ? (
                        <>
                          <span
                            className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${toneFor(quote.tier.key)}`}
                          >
                            {quote.tier.label}
                          </span>
                          <p className="mt-1 text-sm font-semibold text-gray-800 dark:text-white/90">
                            {formatMoney(quote.refund_minor, quote.currency)}
                          </p>
                        </>
                      ) : (
                        <span className="inline-flex rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                          Policy does not cover this
                        </span>
                      )}
                    </div>
                  </div>

                  {/* HOW FAR THROUGH — the figure everything else turns on, so
                      it is shown as the parts and the bar, not just a percent
                      the operator has to take on trust. */}
                  {quote.covered_by_policy ? (
                    <div className="mt-4">
                      <div className="mb-1.5 flex items-center justify-between gap-3 text-xs text-gray-500 dark:text-gray-400">
                        <span>
                          {quote.total_modules === 0
                            ? "This course has no modules yet"
                            : `${quote.completed_modules} of ${counted(quote.total_modules, "module")} finished`}
                        </span>
                        <span className="font-medium text-gray-700 dark:text-gray-300">
                          {quote.percent_complete}% through
                        </span>
                      </div>
                      <ProgressBar
                        value={quote.percent_complete}
                        tone={
                          quote.tier.key === "full"
                            ? "success"
                            : quote.tier.key === "half"
                              ? "warning"
                              : "brand"
                        }
                        label={`${quote.user_email} is ${quote.percent_complete}% through ${quote.course_title}`}
                      />
                    </div>
                  ) : (
                    <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
                      This order is a bundle or All Access subscription. It
                      opens several courses at once, so there is no single
                      &ldquo;how far through&rdquo; figure and the published
                      tiers do not apply. Decide this one by hand.
                    </p>
                  )}

                  {!refunded ? (
                    <div className="mt-4 border-t border-gray-100 pt-4 dark:border-gray-800">
                      {openOrder === quote.order_id ? (
                        <div className="flex flex-wrap items-end gap-3">
                          <label className="block">
                            <span className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300">
                              Amount refunded ({quote.currency})
                            </span>
                            <input
                              type="number"
                              min={0}
                              max={quote.amount_minor / 100}
                              step="0.01"
                              value={amount}
                              onChange={(event) =>
                                setAmount(event.target.value)
                              }
                              className="h-10 w-36 rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                            />
                          </label>
                          <label className="block flex-1 min-w-[200px]">
                            <span className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300">
                              Note (optional)
                            </span>
                            <input
                              type="text"
                              value={note}
                              maxLength={500}
                              onChange={(event) => setNote(event.target.value)}
                              placeholder="Razorpay refund id, or why it differs from the policy"
                              className="h-10 w-full rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                            />
                          </label>
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void submit(quote)}
                            className="h-10 rounded-lg bg-error-700 px-4 text-sm font-medium text-white transition hover:bg-error-800 disabled:opacity-40"
                          >
                            {saving
                              ? "Recording…"
                              : "Record and withdraw access"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setOpenOrder(null)}
                            className="h-10 rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03]"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openFor(quote)}
                          className="text-sm font-medium text-error-600 transition hover:text-error-700 dark:text-error-400"
                        >
                          Record a refund
                        </button>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}

export default function RefundsPage() {
  // Guard matched to the API this page calls: admin_refunds.py is RequireAdmin.
  //
  // Every other screen under /admin names its roles; this one did not,
  // so anyone signed in who typed the URL got an admin screen full of
  // failed requests instead of being turned away. The data was never at
  // risk — the API refuses them — but a student has no business looking
  // at the shape of the money screens.
  return (
    <RequireAuth roles={["admin"]}>
      <RefundsAdmin />
    </RequireAuth>
  );
}
