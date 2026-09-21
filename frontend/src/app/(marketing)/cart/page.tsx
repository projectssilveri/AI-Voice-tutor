import type { Metadata } from "next";

import CartView from "@/components/cart/CartView";
import Breadcrumb from "@/components/marketing/common/Breadcrumb";
import RefundPolicyNote from "@/components/marketing/RefundPolicyNote";

export const metadata: Metadata = {
  title: "Your cart",
  description: "The courses you have picked, ready to buy together.",
};

/**
 * The cart lives on the marketing site, not in the dashboard.
 *
 * It is where the prices are, where a signed-out visitor can reach it, and
 * where somebody arrives from after browsing the catalogue. The dashboard
 * header links here rather than growing a second cart of its own — one cart,
 * one page, whichever side you came from.
 */
export default function CartPage() {
  return (
    <>
      <Breadcrumb
        pageName="Your cart"
        description="Everything you have picked, bought in one payment. Each course keeps its own access window and its own refund terms."
      />
      <CartView />
      {/* Every line on this page has a price on it, so the refund terms belong
          here for the same reason they are on /courses and /pricing. */}
      <RefundPolicyNote />
    </>
  );
}
