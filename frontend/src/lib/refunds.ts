/**
 * Refunds, for the support desk.
 *
 * The tiers are NOT restated here. They come back from the server with every
 * lookup, because `backend/app/services/refunds.py` is what computes the money
 * and a second copy in the browser is a second thing to forget to change. The
 * screen prints the rule it was handed.
 */

import { apiFetch } from "@/lib/api";

export interface RefundTier {
  key: "full" | "half" | "none" | string;
  label: string;
  /** Exclusive upper bound in percent. Null on the top band. */
  below_percent: number | null;
}

export interface RefundQuote {
  order_id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  course_id: string | null;
  course_title: string;
  amount_minor: number;
  currency: string;
  paid_at: string | null;
  status: string;

  /** The parts as well as the percentage, so support can see why it is 33%. */
  completed_modules: number;
  total_modules: number;
  percent_complete: number;

  tier: RefundTier;
  refund_minor: number;
  /** False on a bundle order, where the published policy says nothing. */
  covered_by_policy: boolean;

  refunded_amount_minor: number | null;
  refunded_at: string | null;
}

export interface RefundLookup {
  policy: { tiers: RefundTier[] };
  quotes: RefundQuote[];
}

const authed = { withCredentials: true, cache: "no-store" } as const;

export function lookUpRefunds(search?: string): Promise<RefundLookup> {
  const query = search?.trim() ? `?q=${encodeURIComponent(search.trim())}` : "";
  return apiFetch<RefundLookup>(`/admin/refunds${query}`, authed);
}

/**
 * Write down a refund that has been paid, and withdraw the course.
 *
 * Records; does not pay. The money moves in the Razorpay dashboard — no refund
 * is ever wired out of the account by a button in this product.
 */
export function recordRefund(
  orderId: string,
  payload: { amount_minor: number; note?: string },
): Promise<RefundQuote> {
  return apiFetch<RefundQuote>(`/admin/refunds/${orderId}`, {
    ...authed,
    method: "POST",
    body: payload,
  });
}
