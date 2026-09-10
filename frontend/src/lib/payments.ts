/**
 * Checkout.
 *
 * The browser never says "this is paid". It asks to buy, hands the returned
 * order to Razorpay's widget, and passes the signature back for the server to
 * verify. Access follows from the verified order, not from anything here.
 */

import { apiFetch } from "@/lib/api";

const authed = { withCredentials: true, cache: "no-store" } as const;

export interface CheckoutSession {
  order_id: string;
  provider_order_id: string;
  amount_minor: number;
  currency: string;
  /** Publishable. The key SECRET never reaches the browser. */
  key_id: string;
  item_name: string;
}

export interface OrderRead {
  id: string;
  status: string;
  amount_minor: number;
  currency: string;
  course_id: string | null;
  plan_id: string | null;
}

export interface Entitlements {
  course_ids: string[];
  /** Staff see everything, so the UI should draw no locks at all. */
  unrestricted: boolean;
}

export function getEntitlements(): Promise<Entitlements> {
  return apiFetch<Entitlements>("/payments/entitlements", authed);
}

export function startCourseCheckout(
  courseId: string,
): Promise<CheckoutSession> {
  return apiFetch<CheckoutSession>(`/payments/courses/${courseId}/checkout`, {
    ...authed,
    method: "POST",
  });
}

export function startPlanCheckout(planId: string): Promise<CheckoutSession> {
  return apiFetch<CheckoutSession>(`/payments/plans/${planId}/checkout`, {
    ...authed,
    method: "POST",
  });
}

export function confirmPayment(result: {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}): Promise<OrderRead> {
  return apiFetch<OrderRead>("/payments/confirm", {
    ...authed,
    method: "POST",
    body: result,
  });
}

// --- Razorpay checkout widget ---------------------------------------------

interface RazorpayResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayConstructor {
  new (options: Record<string, unknown>): { open: () => void };
}

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

const SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

/** Give up waiting for the script. Long enough for a slow connection, short
 * enough that the button comes back rather than spinning indefinitely. */
const SCRIPT_TIMEOUT_MS = 15_000;

/**
 * Load Razorpay's checkout script once.
 *
 * Injected on demand rather than in the app shell: it is a third-party script
 * on every page load otherwise, and most visits never reach checkout.
 */
export function loadRazorpay(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };

    // A tag that already loaded is covered by the `window.Razorpay` check
    // above, so reaching here with one present means it is either still in
    // flight or it FAILED. Attaching a listener to a failed tag waits for an
    // event that has already fired: the promise never settles and the Buy
    // button spins forever, with nothing in any log. An ad blocker refusing
    // checkout.js is the ordinary way to get there, so this is not rare.
    // Remove the dead tag and try once more.
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${SCRIPT_SRC}"]`,
    );
    existing?.remove();

    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => finish(Boolean(window.Razorpay));
    script.onerror = () => {
      // Left in place, a failed tag would send the next attempt down the same
      // path. The caller gets false and shows a real message.
      script.remove();
      finish(false);
    };
    document.body.appendChild(script);

    // Neither event fires if the request simply hangs. A promise that never
    // settles is a button that never comes back.
    window.setTimeout(
      () => finish(Boolean(window.Razorpay)),
      SCRIPT_TIMEOUT_MS,
    );
  });
}

export interface PayOptions {
  session: CheckoutSession;
  customerName?: string;
  customerEmail?: string;
  onSuccess: (order: OrderRead) => void;
  onFailure: (message: string) => void;
  onDismiss?: () => void;
}

/**
 * Open Razorpay and confirm the result server-side.
 *
 * `onSuccess` fires only after our own backend has verified the signature —
 * the widget's callback alone is not proof of payment.
 */
export async function payWithRazorpay({
  session,
  customerName,
  customerEmail,
  onSuccess,
  onFailure,
  onDismiss,
}: PayOptions): Promise<void> {
  const ready = await loadRazorpay();
  if (!ready || !window.Razorpay) {
    onFailure(
      "Could not load the payment window. Check your connection and try again.",
    );
    return;
  }

  const checkout = new window.Razorpay({
    key: session.key_id,
    amount: session.amount_minor,
    currency: session.currency,
    name: "Voice Tutor LMS",
    description: session.item_name,
    order_id: session.provider_order_id,
    prefill: { name: customerName ?? "", email: customerEmail ?? "" },
    theme: { color: "#465FFF" },
    handler: async (response: RazorpayResponse) => {
      try {
        const order = await confirmPayment({
          razorpay_order_id: response.razorpay_order_id,
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_signature: response.razorpay_signature,
        });
        if (order.status === "paid") {
          onSuccess(order);
        } else {
          onFailure(
            "Payment could not be verified. You have not been charged.",
          );
        }
      } catch (caught) {
        onFailure(
          caught instanceof Error
            ? caught.message
            : "Payment could not be verified.",
        );
      }
    },
    modal: { ondismiss: () => onDismiss?.() },
  });

  checkout.open();
}
