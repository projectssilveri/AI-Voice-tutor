"use client";

import { useState } from "react";

import { useAuth } from "@/context/AuthContext";
import { formatMoney } from "@/lib/money";
import {
  CHECKOUT_FAILED,
  payWithRazorpay,
  startCourseCheckout,
} from "@/lib/payments";
import { errorText } from "@/lib/api";

/**
 * Buy a course.
 *
 * The flow: ask our backend for an order, open Razorpay with it, and let the
 * backend verify the signature before anything is unlocked. `onPaid` fires only
 * after that verification — the widget saying "success" is not enough.
 */
export default function BuyCourseButton({
  courseId,
  priceMinor,
  currency = "INR",
  onPaid,
  className = "",
  buttonClassName,
  showPaymentNote = true,
}: {
  courseId: string;
  priceMinor: number;
  currency?: string;
  onPaid: () => void;
  className?: string;
  /** Lets a caller match the buttons beside it. Sizing lives with layout. */
  buttonClassName?: string;
  /** Off when the surrounding page already says it — see CoursePurchase. */
  showPaymentNote?: boolean;
}) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleBuy() {
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const session = await startCourseCheckout(courseId);
      await payWithRazorpay({
        session,
        customerName: user?.name,
        customerEmail: user?.email,
        onSuccess: () => {
          setBusy(false);
          setNotice("Payment confirmed. The course is yours.");
          onPaid();
        },
        onFailure: (message) => {
          setBusy(false);
          setError(message);
        },
        onDismiss: () => {
          setBusy(false);
          // Closing the window is not an error — say nothing.
        },
      });
    } catch (caught) {
      setBusy(false);
      setError(errorText(caught, CHECKOUT_FAILED));
    }
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={handleBuy}
        disabled={busy}
        className={
          buttonClassName ??
          "w-full rounded-lg bg-brand-500 px-6 py-3 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-50"
        }
      >
        {busy
          ? "Opening checkout…"
          : `Buy for ${formatMoney(priceMinor, currency)}`}
      </button>

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-error-500 bg-error-50 px-4 py-2.5 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-3 rounded-lg border border-success-500 bg-success-50 px-4 py-2.5 text-sm text-success-700 dark:bg-success-500/10 dark:text-success-400">
          {notice}
        </p>
      ) : null}
      {showPaymentNote ? (
        <p className="mt-3 text-center text-xs text-gray-500 dark:text-gray-400">
          Razorpay handles the payment. We never see your card details.
        </p>
      ) : null}
    </div>
  );
}
