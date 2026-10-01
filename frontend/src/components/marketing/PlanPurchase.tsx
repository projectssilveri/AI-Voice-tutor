"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useAuth } from "@/context/AuthContext";
import { listMyBundles } from "@/lib/bundles";
import { formatMoney } from "@/lib/money";
import { errorText } from "@/lib/api";
import {
  CHECKOUT_FAILED,
  claimFreePlan,
  getEntitlements,
  payWithRazorpay,
  startPlanCheckout,
} from "@/lib/payments";

/**
 * Subscribe to a plan.
 *
 * THE BUG THIS FIXES. The pricing page's call to action was
 * `href="/signup?plan={id}"` and NOTHING anywhere read `?plan=`. A visitor
 * picked a plan, signed up, and landed on the dashboard with no subscription
 * and no record of what they had chosen. Meanwhile `startPlanCheckout` was
 * fully written, wired to Razorpay on the backend, and called by nothing — so
 * subscriptions could not be bought at all, on a page whose entire job is
 * selling them.
 *
 * That is the fourth time this codebase has shipped a component that is
 * complete, correctly typed, passing lint and tests, and reachable from
 * nowhere: decision 52's paywall, decision 86's `redact`, decision 129's
 * BuyCourseButton, and this. None of them is visible to a type checker.
 *
 * Four states, because a visitor arrives in one of four situations and showing
 * the wrong one is how decision 130 sent an enrolled student to the signup
 * page. Ownership is asked FIRST, for the same reason.
 */
export default function PlanPurchase({
  planId,
  priceMinor,
  currency,
  highlighted,
}: {
  planId: string;
  priceMinor: number;
  currency: string;
  highlighted: boolean;
}) {
  const { user, loading: authLoading } = useAuth();
  const [owned, setOwned] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !user) {
      setOwned(false);
      return;
    }
    let cancelled = false;
    Promise.all([getEntitlements(), listMyBundles()])
      .then(([entitlements, held]) => {
        if (cancelled) return;
        // THEY HOLD THIS PLAN if they hold this plan, or they are staff and
        // reach everything anyway. It used to be "can they already open every
        // course in it", which a bundle of free courses answered yes for every
        // signed-in student: "You have this" on a bundle nobody had bought,
        // read by the tester as the price not being enforced.
        setOwned(
          entitlements.unrestricted ||
            held.some((plan) => plan.plan_id === planId),
        );
      })
      .catch(() => {
        // Not knowing must not hide the Buy button — the worst outcome here is
        // offering a plan to someone who already has it, and the backend
        // refuses a duplicate anyway. Silently showing nothing would be worse.
        if (!cancelled) setOwned(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, authLoading, planId]);

  const base =
    "mt-auto flex w-full items-center justify-center rounded-lg px-6 py-3 text-base font-semibold transition-[background-color,transform] duration-200 active:scale-[0.98] motion-reduce:active:scale-100";
  const style = highlighted
    ? "bg-[var(--mk-brand)] text-white hover:bg-[var(--mk-brand)]/90"
    : "bg-primary/10 text-[var(--mk-brand-lit)] hover:bg-[var(--mk-brand)] hover:text-white";

  async function subscribe() {
    setBusy(true);
    setError(null);
    setNotice(null);
    // A FREE PLAN IS CLAIMED, not checked out. Checkout answered "Payments are
    // not configured" for a bundle priced at nothing, so it could not be had.
    if (priceMinor === 0) {
      try {
        await claimFreePlan(planId);
        setNotice("It is yours. Every course in it is on your list.");
        window.location.assign("/learn");
      } catch (caught) {
        setBusy(false);
        setError(errorText(caught, "Could not add it to your account."));
      }
      return;
    }
    try {
      const session = await startPlanCheckout(planId);
      await payWithRazorpay({
        session,
        customerName: user?.name,
        customerEmail: user?.email,
        onSuccess: () => {
          setBusy(false);
          setNotice("You are subscribed. Every course in the plan is open.");
          // A full navigation, not a router push: the entitlement changed
          // server-side and every cached page needs to know.
          window.location.assign("/learn");
        },
        onFailure: (message) => {
          setBusy(false);
          setError(message);
        },
        onDismiss: () => setBusy(false),
      });
    } catch (caught) {
      setBusy(false);
      setError(errorText(caught, CHECKOUT_FAILED));
    }
  }

  if (authLoading || owned === null) {
    return <span className={`${base} ${style} opacity-60`}>Loading…</span>;
  }

  if (owned) {
    return (
      <Link href="/learn" className={`${base} ${style}`}>
        You have this. Start learning
      </Link>
    );
  }

  if (!user) {
    // Comes BACK to pricing rather than dumping them on the dashboard, so the
    // plan they picked is still in front of them when they return. `?plan=`
    // used to be sent here and read by nobody; this one is real.
    return (
      <Link
        href={`/signup?next=${encodeURIComponent(`/pricing?plan=${planId}`)}`}
        className={`${base} ${style}`}
      >
        Create an account to subscribe
      </Link>
    );
  }

  return (
    <div className="mt-auto w-full">
      <button
        type="button"
        onClick={() => void subscribe()}
        disabled={busy}
        className={`${base} ${style} disabled:opacity-50`}
      >
        {priceMinor === 0
          ? busy
            ? "Adding it…"
            : "Get it free"
          : busy
            ? "Opening checkout…"
            : `Subscribe for ${formatMoney(priceMinor, currency)}`}
      </button>
      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-error-500 bg-error-500/10 px-3 py-2 text-sm text-error-400"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-3 rounded-lg border border-success-500/40 bg-success-500/10 px-3 py-2 text-sm text-success-400">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
