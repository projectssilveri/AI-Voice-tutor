"use client";

/**
 * The cart, shared by every screen that shows or changes it.
 *
 * WHY A CONTEXT AND NOT A FETCH PER COMPONENT. The count is in two headers, the
 * button is on every course card, and the page lists the whole thing. Without
 * one shared copy, adding a course on the catalogue leaves the header badge
 * saying 2 until a reload — and a badge that lies about a cart is the kind of
 * small wrongness that makes people distrust the checkout behind it.
 *
 * SIGNED OUT, IT KEEPS A LIST OF IDS IN THE BROWSER. No prices, no totals, no
 * checks: those are the server's and there is no session to ask with. The count
 * still works, which is the part a visitor can see, and the cart page tells
 * them plainly that signing in is what turns the list into a basket.
 *
 * THE MERGE RUNS ONCE, on the first render where a session exists and there is
 * something local to hand over. It is deliberately quiet — see
 * `services/cart.merge` on the backend for why this is the wrong moment to
 * interrupt somebody with what could not be added.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useAuth } from "@/context/AuthContext";
import {
  type Cart,
  EMPTY_CART,
  addToCart,
  addToGuestCart,
  clearGuestCart,
  emptyCart,
  getCart,
  mergeCart,
  readGuestCart,
  removeFromCart,
  removeFromGuestCart,
} from "@/lib/cart";

interface CartContextValue {
  cart: Cart;
  /** Ids in the basket — the cheap check an Add button needs. */
  ids: Set<string>;
  count: number;
  /** True until the first read settles, so a badge does not flash 0 then 3. */
  loading: boolean;
  /** True while the visitor has no session and the list is browser-side. */
  guest: boolean;
  add: (courseId: string) => Promise<void>;
  remove: (courseId: string) => Promise<void>;
  empty: () => Promise<void>;
  refresh: () => Promise<void>;
}

const CartContext = createContext<CartContextValue | undefined>(undefined);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [cart, setCart] = useState<Cart>(EMPTY_CART);
  const [guestIds, setGuestIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  /** So the handover happens once per session, not on every render. */
  const merged = useRef(false);

  const signedIn = user !== null;

  const refresh = useCallback(async () => {
    if (!signedIn) {
      setCart(EMPTY_CART);
      setGuestIds(readGuestCart());
      setLoading(false);
      return;
    }
    try {
      setCart(await getCart());
    } catch {
      // A cart that cannot be read is not worth an error on a page somebody
      // asked for something else from. It shows as empty and the next action
      // says what went wrong.
      setCart(EMPTY_CART);
    }
    setLoading(false);
  }, [signedIn]);

  useEffect(() => {
    if (authLoading) return;

    if (!signedIn) {
      merged.current = false;
      setGuestIds(readGuestCart());
      setCart(EMPTY_CART);
      setLoading(false);
      return;
    }

    if (merged.current) {
      void refresh();
      return;
    }
    merged.current = true;

    const pending = readGuestCart();
    if (pending.length === 0) {
      void refresh();
      return;
    }

    void (async () => {
      try {
        setCart(await mergeCart(pending));
        // Only cleared once the server has it. A failed merge that emptied the
        // browser first would lose the basket outright.
        clearGuestCart();
        setGuestIds([]);
      } catch {
        // Kept for the next attempt rather than dropped.
        void refresh();
      }
      setLoading(false);
    })();
  }, [authLoading, signedIn, refresh]);

  const add = useCallback(
    async (courseId: string) => {
      if (!signedIn) {
        setGuestIds(addToGuestCart(courseId));
        return;
      }
      setCart(await addToCart(courseId));
    },
    [signedIn],
  );

  const remove = useCallback(
    async (courseId: string) => {
      if (!signedIn) {
        setGuestIds(removeFromGuestCart(courseId));
        return;
      }
      setCart(await removeFromCart(courseId));
    },
    [signedIn],
  );

  const empty = useCallback(async () => {
    if (!signedIn) {
      clearGuestCart();
      setGuestIds([]);
      return;
    }
    setCart(await emptyCart());
  }, [signedIn]);

  const value = useMemo<CartContextValue>(() => {
    const ids = signedIn
      ? new Set(cart.items.map((item) => item.course_id))
      : new Set(guestIds);
    return {
      cart,
      ids,
      count: ids.size,
      loading,
      guest: !signedIn,
      add,
      remove,
      empty,
      refresh,
    };
  }, [cart, guestIds, signedIn, loading, add, remove, empty, refresh]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const found = useContext(CartContext);
  if (found === undefined) {
    throw new Error("useCart must be used inside a CartProvider");
  }
  return found;
}
