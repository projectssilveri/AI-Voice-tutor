"use client";

import Link from "next/link";

import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";

/**
 * The cart icon, with how many things are in it.
 *
 * NOTHING IS DRAWN WHILE THE COUNT IS UNKNOWN. The first render has no answer
 * yet — the session check and the cart read both have to come back — and a
 * badge that appears as 0 and corrects itself to 3 a moment later is worse
 * than one that arrives late. Once there has been an answer the icon stays,
 * empty or not, because a cart you cannot find when it is empty is a cart you
 * cannot check.
 *
 * `aria-label` carries the number, not just the word. A screen reader reading
 * "Cart" gets none of the information the badge exists to give.
 */
export default function CartLink({
  className = "",
  tone = "marketing",
}: {
  className?: string;
  /** The two surfaces have different palettes; the markup is the same. */
  tone?: "marketing" | "dashboard";
}) {
  const { count, loading } = useCart();
  const { user } = useAuth();

  // An organisation member is not a customer of the marketplace — their
  // employer bought the training, and `services/access.py` refuses them every
  // public course. A cart icon would be an invitation to a shop they cannot
  // buy from. Checked here rather than at each call site so the dashboard
  // header and the marketing header cannot disagree.
  if (loading || user?.organization_id != null) return null;

  const skin =
    tone === "marketing"
      ? "border-[var(--mk-line)] text-[var(--mk-text)] hover:border-[var(--mk-line-lift)] hover:bg-white/5"
      : "border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-white/5";

  return (
    <Link
      href="/cart"
      aria-label={
        count === 0
          ? "Cart, empty"
          : `Cart, ${count} ${count === 1 ? "course" : "courses"}`
      }
      className={`relative grid size-10 place-items-center rounded-lg border transition-colors ${skin} ${className}`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-5"
      >
        <circle cx="9" cy="20" r="1.2" />
        <circle cx="18" cy="20" r="1.2" />
        <path d="M2 3h2.2l2.3 12.2a1.6 1.6 0 0 0 1.6 1.3h8.7a1.6 1.6 0 0 0 1.6-1.3L21 7H5.1" />
      </svg>

      {count > 0 ? (
        <span
          aria-hidden="true"
          className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-brand-500 px-1 text-[11px] font-bold leading-5 text-white"
        >
          {count > 9 ? "9+" : count}
        </span>
      ) : null}
    </Link>
  );
}
