import Link from "next/link";

import { type PublicPlan, listPublicPlans, splitPlans } from "@/lib/catalogue";
import { formatMoney } from "@/lib/money";
import { counted } from "@/lib/plural";

/**
 * A row on the catalogue page saying that stacks exist.
 *
 * Somebody browsing courses one at a time is exactly the person a bundle is
 * for, and they had no way to find out from here that bundles existed — the
 * only route to them was a nav link they would have to already know to look
 * at. This is the cheapest honest name three real stacks, say what the
 * cheapest costs, link to the page that prices them.
 *
 * NO PRICES PER BUNDLE HERE, deliberately. Repeating each bundle's price on
 * the catalogue page would put the same number on two surfaces, which is the
 * duplication the pricing page was split up to stop. One "from" figure is a
 * signpost, not a second price list.
 *
 * Renders nothing when there are no bundles, or when the catalogue is
 * unreachable. A banner advertising an empty page is worse than no banner.
 */
export default async function BundleStrip() {
  let bundles: PublicPlan[] = [];
  try {
    bundles = splitPlans(await listPublicPlans()).bundles;
  } catch {
    return null;
  }

  if (bundles.length === 0) return null;

  const cheapest = Math.min(...bundles.map((plan) => plan.price_minor));
  const from = formatMoney(cheapest, bundles[0].currency);

  // The names alone tell somebody whether their stack is here. Three, so the
  // row stays a signpost rather than becoming a second listing.
  const named = bundles.slice(0, 3).map((plan) => plan.name);

  return (
    <section className="pt-16 md:pt-20">
      <div className="container">
        <div className="flex flex-wrap items-center justify-between gap-6 rounded-2xl border border-[var(--mk-brand)]/20 bg-[var(--mk-brand)]/[0.04] p-6 md:p-8">
          <div className="min-w-0 max-w-2xl">
            <h2 className="mb-2 text-xl font-semibold text-[var(--mk-text)]">
              Learning a whole stack?
            </h2>
            <p className="text-base text-[var(--mk-muted)]">
              {counted(bundles.length, "bundle")} group the courses that are
              used together. {named.join(", ")} and more, on one subscription
              from {from} a month.
            </p>
          </div>
          <Link
            href="/bundles"
            className="w-full rounded-lg bg-[var(--mk-brand)] px-6 py-3 text-center text-base font-semibold text-white transition hover:bg-[var(--mk-brand)]/90 sm:w-auto sm:shrink-0"
          >
            See the bundles
          </Link>
        </div>
      </div>
    </section>
  );
}
