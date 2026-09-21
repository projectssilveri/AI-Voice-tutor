/**
 * The cart, from the browser's side.
 *
 * TWO CARTS, ON PURPOSE.
 *
 *   Signed in  — the server's, in `cart_items`. It follows the person to their
 *                phone and survives clearing the browser.
 *   Signed out — a list of course ids in `localStorage`. A holding pen, not a
 *                cart: it has no prices, no checks and no checkout.
 *
 * The browser one exists because "sign in to add to cart" loses the sale. Its
 * whole job is to survive the trip through the sign-up form, and the moment a
 * session appears `CartContext` posts it to `/cart/merge` and empties it.
 *
 * Nothing here trusts the local list for anything but "what did they click".
 * The server re-checks every id: still published, still theirs to buy, not
 * already owned. A tampered list gets refusals, not free courses.
 */

import { apiFetch } from "@/lib/api";

const authed = { withCredentials: true, cache: "no-store" } as const;

export interface CartLine {
  course_id: string;
  title: string;
  description: string | null;
  module_count: number;
  price_minor: number;
  list_price_minor: number | null;
  currency: string;
  access_days: number | null;
  /** Null when it can be bought. A sentence to show when it cannot. */
  problem: string | null;
}

export interface Cart {
  items: CartLine[];
  /** The total of the lines that can actually be paid for. */
  total_minor: number;
  currency: string;
  /** True when checkout will not refuse. */
  ready: boolean;
}

export const EMPTY_CART: Cart = {
  items: [],
  total_minor: 0,
  currency: "INR",
  ready: false,
};

export function getCart(): Promise<Cart> {
  return apiFetch<Cart>("/cart", authed);
}

export function addToCart(courseId: string): Promise<Cart> {
  return apiFetch<Cart>("/cart/items", {
    ...authed,
    method: "POST",
    body: { course_id: courseId },
  });
}

export function removeFromCart(courseId: string): Promise<Cart> {
  return apiFetch<Cart>(`/cart/items/${courseId}`, {
    ...authed,
    method: "DELETE",
  });
}

export function emptyCart(): Promise<Cart> {
  return apiFetch<Cart>("/cart", { ...authed, method: "DELETE" });
}

export function mergeCart(courseIds: string[]): Promise<Cart> {
  return apiFetch<Cart>("/cart/merge", {
    ...authed,
    method: "POST",
    body: { course_ids: courseIds },
  });
}

// --- the signed-out holding pen -------------------------------------------

const GUEST_KEY = "vtlms.cart";
/** The server takes 50. Refusing beyond that here keeps the two agreed. */
const GUEST_LIMIT = 50;

/**
 * Every read and write is wrapped.
 *
 * `localStorage` throws rather than returning null in a private window with
 * site data blocked, and it is absent entirely during server rendering. A cart
 * that cannot be stored is a smaller problem than a homepage that will not
 * render, so every failure here is silent and the feature simply degrades to
 * "sign in first".
 */
export function readGuestCart(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(GUEST_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Ids only, deduplicated, bounded. Whatever else is in there was not put
    // there by this code.
    return [...new Set(parsed.filter((v): v is string => typeof v === "string"))].slice(
      0,
      GUEST_LIMIT,
    );
  } catch {
    return [];
  }
}

function writeGuestCart(ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      GUEST_KEY,
      JSON.stringify(ids.slice(0, GUEST_LIMIT)),
    );
  } catch {
    // Storage full, or blocked. Nothing to do and nothing worth saying.
  }
}

export function addToGuestCart(courseId: string): string[] {
  const next = [...new Set([...readGuestCart(), courseId])];
  writeGuestCart(next);
  return next;
}

export function removeFromGuestCart(courseId: string): string[] {
  const next = readGuestCart().filter((id) => id !== courseId);
  writeGuestCart(next);
  return next;
}

export function clearGuestCart(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(GUEST_KEY);
  } catch {
    // See above.
  }
}
