"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import BuyCourseButton from "@/components/dashboard/BuyCourseButton";
import { useAuth } from "@/context/AuthContext";
import { accessLabel } from "@/lib/catalogue";
import { type Entitlements, getEntitlements } from "@/lib/payments";

function money(minor: number, currency: string): string {
  const symbol = currency === "INR" ? "₹" : `${currency} `;
  return `${symbol}${(minor / 100).toLocaleString("en-IN")}`;
}

const PRIMARY =
  "inline-flex items-center justify-center rounded-lg bg-[var(--mk-brand)] px-8 py-4 text-base font-semibold text-white transition-[background-color,box-shadow,transform] duration-200 ease-[var(--ease-out-soft)] hover:bg-[var(--mk-brand)]/90 active:scale-[0.98] motion-reduce:active:scale-100";

const SECONDARY =
  "inline-flex items-center justify-center rounded-lg bg-white/[0.06] px-8 py-4 text-base font-semibold text-[var(--mk-text)] transition-colors duration-200 hover:bg-white/10";

/**
 * Price and the buy decision, on the public course page.
 *
 * This page previously showed neither. A visitor arrived from the catalogue
 * having just read "₹1,499 · pay once, keep it" on the card, and found a page
 * with no price on it and a "Start learning" button that went to signup — so
 * the one place where someone decides to buy a course was the one place that
 * did not mention money.
 *
 * `BuyCourseButton` was already written, already wired to Razorpay, and
 * imported by nothing. The same shape of defect as decision 52's decorative
 * paywall and decision 86's unattached `redact`: a working component with no
 * caller, which neither the type checker nor the tests can notice.
 *
 * Four states, because a course page is read by four different people:
 *
 *   free           → start, no money involved
 *   signed out     → price, then signup (you cannot pay for something before
 *                    there is an account to attach it to)
 *   owns it        → go to the course
 *   signed in      → the real checkout
 *
 * Entitlements are only fetched when there is someone to fetch them for, so a
 * signed-out visitor costs no extra request.
 */
export default function CoursePurchase({
  courseId,
  priceMinor,
  listPriceMinor,
  accessDays,
  currency,
  id,
}: {
  courseId: string;
  priceMinor: number;
  /** A price the course genuinely carried before. Null for almost all of them. */
  listPriceMinor?: number | null;
  /** How long a purchase lasts. Null means it never expires. */
  accessDays?: number | null;
  currency: string;
  /** Anchor target, so the second CTA lower down can scroll here. */
  id?: string;
}) {
  const { user, loading: authLoading } = useAuth();
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [checked, setChecked] = useState(false);

  const free = priceMinor === 0;

  useEffect(() => {
    if (authLoading) return;
    // Signed out: nothing to look up, and no request to waste.
    if (!user) {
      setChecked(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const found = await getEntitlements();
        if (!cancelled) setEntitlements(found);
      } catch {
        // Treat "cannot tell" as "does not own it": offering to sell something
        // they already have is recoverable; hiding the course behind a Buy
        // button they cannot use is not — and the backend refuses a duplicate
        // purchase anyway.
      } finally {
        if (!cancelled) setChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  // `course_ids` already folds in purchases, subscriptions and free courses
  // server-side (services/access.accessible_course_ids), so there is nothing
  // to recombine here. `unrestricted` is staff, who should never see a lock.
  const owned =
    entitlements?.unrestricted === true ||
    entitlements?.course_ids?.includes(courseId) === true;

  return (
    <div id={id} className="scroll-mt-28">
      {/* The price leads. It is the fact the visitor came to this page for. */}
      <div className="mb-6 flex flex-wrap items-baseline gap-3">
        <span className="text-4xl font-semibold text-[var(--mk-text)]">
          {free ? "Free" : money(priceMinor, currency)}
        </span>
        {/* Only a genuinely HIGHER earlier price is shown struck through. */}
        {!free && listPriceMinor !== null && listPriceMinor !== undefined
        && listPriceMinor > priceMinor ? (
          <span className="text-xl text-[var(--mk-muted)] line-through">
            {money(listPriceMinor, currency)}
          </span>
        ) : null}
        <span className="text-base text-[var(--mk-muted)]">
          {/* "Pay once. It is yours to keep." was true until a purchase
              started expiring. Saying it now would be a promise the product
              does not keep — and this panel is the last thing read before
              somebody pays. */}
          {free ? "no card needed" : (accessLabel(accessDays ?? null) ?? "yours to keep")}
        </span>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        {!checked || authLoading ? (
          // A disabled placeholder of the same size, so the row does not
          // reflow underneath the cursor once we know who is reading.
          <span
            className={`${PRIMARY} pointer-events-none opacity-60`}
            aria-hidden="true"
          >
            Buy this course
          </span>
        ) : owned ? (
          // Covers a bought course, a subscription, staff, and every free
          // course — the backend folds all four into `course_ids`.
          <Link href={`/learn/${courseId}`} className={PRIMARY}>
            Go to your course
          </Link>
        ) : free ? (
          <Link href={user ? `/learn/${courseId}` : "/signup"} className={PRIMARY}>
            Start free
          </Link>
        ) : user ? (
          <BuyCourseButton
            courseId={courseId}
            priceMinor={priceMinor}
            currency={currency}
            onPaid={() => window.location.assign(`/learn/${courseId}`)}
            className="sm:w-auto"
            // Matches the button beside it. Without this the checkout button
            // rendered at px-6/py-3/text-sm next to a px-8/py-4/text-base one,
            // so the pair sat at visibly different heights and weights.
            buttonClassName={PRIMARY}
            // The line below already says this; twice in four lines is noise.
            showPaymentNote={false}
          />
        ) : (
          /* Signed out. The account has to exist before the purchase can be
             attached to anyone, so this goes to signup and comes back — the
             same order Udemy and Coursera use. */
          <Link
            href={`/signup?next=${encodeURIComponent(`/courses/${courseId}`)}`}
            className={PRIMARY}
          >
            Buy for {money(priceMinor, currency)}
          </Link>
        )}

        <Link href="/courses" className={SECONDARY}>
          All courses
        </Link>
      </div>

      {!free && !owned ? (
        <p className="mt-4 text-sm text-[var(--mk-muted)]">
          Or get this and everything else on a{" "}
          <Link href="/pricing" className="text-[var(--mk-brand-lit)] hover:underline">
            subscription
          </Link>
          . Razorpay handles the payment, so we never see your card details.
        </p>
      ) : null}
    </div>
  );
}
