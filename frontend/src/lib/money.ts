/**
 * Money, written the one way.
 *
 * SEVEN COPIES OF THIS EXISTED. One exported from `lib/analytics`, which the
 * whole dashboard used, and six hand-written in marketing components — and
 * they had already drifted: the shared one prints ₹1,000.50, the copies
 * printed ₹1,000.5, and both appeared on the pricing page at once, because the
 * headline price used a local copy while the Subscribe button under it used
 * the shared one. Nobody noticed because every seeded price is a round number.
 *
 * It lives here rather than in `lib/analytics` because a marketing page that
 * only wants to print a price should not have to import the analytics module
 * to do it.
 *
 * MINOR UNITS IN, STRING OUT. Prices are integers of paise everywhere — in the
 * database, in the API and in `orders.amount_minor` — for the reason
 * `services/refunds.py` sets out at length: a float is the wrong tool for
 * deciding what somebody is owed.
 */

/** Minor units to a readable amount: 149900 -> "₹1,499". */
export function formatMoney(minor: number, currency = "INR"): string {
  const symbol = currency === "INR" ? "₹" : `${currency} `;
  const major = minor / 100;
  // No decimals when the amount is whole — "₹1,499" reads better than
  // "₹1,499.00" on a tile — and always two when it is not, because "₹1,000.5"
  // is fifty paise written as five.
  return `${symbol}${major.toLocaleString("en-IN", {
    minimumFractionDigits: Number.isInteger(major) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * A price as a shopper reads it, where zero means free.
 *
 * "Free" rather than "₹0". Nobody reads ₹0 as an invitation — it reads as a
 * price that failed to load. Three screens had their own ternary for this; one
 * of them did not, and printed ₹0.
 */
export function priceLabel(minor: number, currency = "INR"): string {
  return minor === 0 ? "Free" : formatMoney(minor, currency);
}
