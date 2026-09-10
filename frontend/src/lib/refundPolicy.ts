/**
 * The refund policy, as the customer reads it.
 *
 * ONE COPY IN THE FRONTEND. It is stated in full on /terms and summarised on
 * /pricing, and those two pages must not be able to disagree — a pricing page
 * promising a full refund where the terms give half is the kind of difference
 * somebody quotes back at you.
 *
 * There is a SECOND copy, in `backend/app/services/refunds.py`, and that one is
 * unavoidable: it computes what support actually pays, and it is Python, so it
 * cannot import this. `backend/tests/test_refund_policy.py` reads this file and
 * asserts the two agree — the bands, the labels and the order.
 *
 * So: change a band here and the backend test fails until the Python matches.
 * That is the point of it.
 */

export interface RefundBand {
  /** How far through the course, written the way a reader says it. */
  progress: string;
  /** What they get. Matches `Tier.label` in the Python. */
  refund: string;
  /** One line of why, for the full table on /terms. */
  detail: string;
}

/** Least progress first, which is the order both pages list them in. */
export const REFUND_BANDS: RefundBand[] = [
  {
    progress: "Under 25%",
    refund: "Full refund",
    detail: "You have barely started, so you get everything back.",
  },
  {
    progress: "25% up to 50%",
    refund: "Half back",
    detail: "Half of what you paid for that course is returned.",
  },
  {
    progress: "50% or more",
    refund: "No refund",
    detail: "At the halfway mark the course counts as used.",
  },
];

/**
 * How progress is measured, in one sentence.
 *
 * The short form, for the pricing page. /terms says the same thing at length
 * and adds what does not count towards it.
 */
export const REFUND_MEASURE =
  "Progress is the modules you have finished out of the modules in that course. It is the same figure your dashboard shows.";
