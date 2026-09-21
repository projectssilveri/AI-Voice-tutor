"use client";

import Link from "next/link";
import { useState } from "react";

import { useCart } from "@/context/CartContext";
import { errorText } from "@/lib/api";

/**
 * Put a course in the basket, from wherever the course is shown.
 *
 * ONCE IT IS IN, THE BUTTON STOPS BEING A BUTTON. It becomes "Go to cart",
 * which is the only thing left to do with a course you have already added. A
 * second "Add to cart" that silently does nothing is the version people click
 * twice and then go looking for the two copies.
 *
 * IT WORKS SIGNED OUT. The id goes in the browser and moves to the account at
 * sign-in, so somebody browsing at midnight can fill a basket and make an
 * account when they are ready. Making them sign in first is where the sale
 * goes; it is also the moment they leave.
 *
 * THE REFUSALS COME FROM THE SERVER and are printed as they arrive. It knows
 * things this button cannot — that a subscription already covers the course,
 * that it was unpublished this morning — and every one of those messages is
 * written to be read by the person who clicked.
 */
export default function AddToCartButton({
  courseId,
  className = "",
  variant = "solid",
  label = "Add to cart",
}: {
  courseId: string;
  className?: string;
  /** `solid` leads a page, `outline` sits beside a Buy button, and `icon`
      is the square one in the corner of a catalogue card. */
  variant?: "solid" | "outline" | "icon";
  label?: string;
}) {
  const { ids, add, loading } = useCart();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inCart = ids.has(courseId);

  const icon = variant === "icon";

  const base = icon
    ? // `relative z-10` is load-bearing on a catalogue card: the card's title
      // link is stretched over the whole panel with `absolute inset-0`, so
      // anything drawn underneath it is unclickable. This has to sit above.
      "relative z-10 grid size-10 shrink-0 place-items-center rounded-lg border transition disabled:opacity-60"
    : "inline-flex w-full items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold transition disabled:opacity-60";

  const skin = icon
    ? inCart
      ? "border-brand-500 bg-brand-500 text-white"
      : "border-white/15 text-white/80 hover:border-[var(--mk-brand)] hover:text-white"
    : variant === "solid"
      ? "bg-brand-500 text-white hover:bg-brand-600"
      : "border border-[var(--mk-line)] text-[var(--mk-text)] hover:border-[var(--mk-brand)] hover:text-white";

  if (inCart) {
    return (
      <Link
        href="/cart"
        aria-label={icon ? "Go to cart" : undefined}
        title={icon ? "In your cart" : undefined}
        className={`${base} ${skin} ${className}`}
      >
        <CartGlyph />
        {icon ? null : "Go to cart"}
      </Link>
    );
  }

  if (icon) {
    return (
      <button
        type="button"
        disabled={busy || loading}
        aria-label={busy ? "Adding to cart" : label}
        title={label}
        onClick={async (event) => {
          // The card is one big link. Without this, adding to the cart also
          // navigates to the course.
          event.preventDefault();
          event.stopPropagation();
          setBusy(true);
          setError(null);
          try {
            await add(courseId);
          } catch {
            // No room for a message on a card in a grid. The cart page and the
            // course page both say why; this just does not change state.
          } finally {
            setBusy(false);
          }
        }}
        className={`${base} ${skin} ${className}`}
      >
        <CartGlyph />
      </button>
    );
  }

  return (
    <div className={className}>
      <button
        type="button"
        disabled={busy || loading}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await add(courseId);
          } catch (caught) {
            setError(errorText(caught, "Could not add that to your cart."));
          } finally {
            setBusy(false);
          }
        }}
        className={`${base} ${skin}`}
      >
        <CartGlyph />
        {busy ? "Adding…" : label}
      </button>

      {error ? (
        <p role="alert" className="mt-2 text-sm text-error-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function CartGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4 shrink-0"
    >
      <circle cx="9" cy="20" r="1.2" />
      <circle cx="18" cy="20" r="1.2" />
      <path d="M2 3h2.2l2.3 12.2a1.6 1.6 0 0 0 1.6 1.3h8.7a1.6 1.6 0 0 0 1.6-1.3L21 7H5.1" />
    </svg>
  );
}
