"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import { errorText } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { accessLabel, listPublicCourses } from "@/lib/catalogue";
import {
  CHECKOUT_FAILED,
  payWithRazorpay,
  startCartCheckout,
} from "@/lib/payments";
import { counted } from "@/lib/plural";

/**
 * The cart page.
 *
 * TWO SOURCES OF TRUTH, DELIBERATELY DIFFERENT.
 *
 *   Signed in — the server's cart. Every line is priced now and carries a
 *   verdict: the course may have been unpublished, or a subscription taken out
 *   last week may already include it. Those lines stay visible and say why
 *   rather than disappearing, because a course that vanishes from a basket
 *   without explanation is the thing people write in about.
 *
 *   Signed out — ids the browser kept, priced from the PUBLIC catalogue. Good
 *   enough to show what it will cost; not good enough to charge, which is why
 *   the button is "Sign in to check out" rather than "Pay". Nothing about
 *   ownership can be known without a session, so nothing about it is claimed.
 *
 * A BLOCKED LINE BLOCKS THE WHOLE CHECKOUT. It would be easy to charge for the
 * rest and tell them afterwards, and that is how somebody ends up paying for
 * two courses when they meant three and only notices a month later.
 */
export default function CartView() {
  const { user, loading: authLoading } = useAuth();
  const { cart, ids, remove, empty, refresh, guest, loading } = useCart();

  return authLoading || loading ? (
    <Shell>
      <p className="text-[var(--mk-muted)]">Loading your cart…</p>
    </Shell>
  ) : guest ? (
    <GuestCart ids={ids} onRemove={remove} />
  ) : (
    <SignedInCart
      cart={cart}
      onRemove={remove}
      onEmpty={empty}
      onPaid={refresh}
      name={user?.name}
      email={user?.email}
    />
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    // NO HEADING HERE. `Breadcrumb` above already prints "Your cart" as the
    // page's h1, and this printed it again a few pixels below — the same title
    // twice, and two h1s on one document.
    <section className="pb-16 pt-10">
      <div className="container">{children}</div>
    </section>
  );
}

function Empty() {
  return (
    <Shell>
      <p className="mb-6 text-base text-[var(--mk-muted)]">
        Nothing in it yet. Courses you add will wait here until you are ready.
      </p>
      <Link
        href="/courses"
        className="inline-flex rounded-lg bg-[var(--mk-brand)] px-6 py-3 text-base font-semibold text-white transition hover:bg-[var(--mk-brand)]/90"
      >
        Browse the catalogue
      </Link>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Signed in
// ---------------------------------------------------------------------------

function SignedInCart({
  cart,
  onRemove,
  onEmpty,
  onPaid,
  name,
  email,
}: {
  cart: ReturnType<typeof useCart>["cart"];
  onRemove: (id: string) => Promise<void>;
  onEmpty: () => Promise<void>;
  onPaid: () => Promise<void>;
  name?: string | null;
  email?: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (cart.items.length === 0 && !notice) return <Empty />;

  const blocked = cart.items.filter((item) => item.problem !== null);

  async function checkout() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const session = await startCartCheckout();
      await payWithRazorpay({
        session,
        customerName: name ?? undefined,
        customerEmail: email ?? undefined,
        onSuccess: (orders) => {
          setBusy(false);
          setNotice(
            `Payment confirmed. ${counted(orders.length, "course")} added to your account.`,
          );
          void onPaid();
        },
        onFailure: (message) => {
          setBusy(false);
          setError(message);
        },
        // Closing the payment window is not an error. Say nothing.
        onDismiss: () => setBusy(false),
      });
    } catch (caught) {
      setBusy(false);
      setError(errorText(caught, CHECKOUT_FAILED));
    }
  }

  return (
    <Shell>
      <p className="mb-8 text-base text-[var(--mk-muted)]">
        {counted(cart.items.length, "course")} ready to buy. Each one comes with
        the voice tutor, quizzes, assignments and a certificate.
      </p>

      {notice ? (
        <p className="mb-6 rounded-xl border border-success-500/40 bg-success-500/10 px-4 py-3 text-sm text-success-400">
          {notice}{" "}
          <Link href="/learn" className="font-semibold underline">
            Start learning
          </Link>
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="mb-6 rounded-xl border border-error-500/40 bg-error-500/10 px-4 py-3 text-sm text-error-400"
        >
          {error}
        </p>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <ul className="space-y-4">
          {cart.items.map((item) => (
            <li
              key={item.course_id}
              className={`rounded-2xl border p-5 ${
                item.problem
                  ? "border-warning-500/40 bg-warning-500/[0.06]"
                  : "border-[var(--mk-line)] bg-[var(--mk-raised)]/60"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/courses/${item.course_id}`}
                    className="text-lg font-semibold text-[var(--mk-text)] hover:underline"
                  >
                    {item.title}
                  </Link>
                  <p className="mt-1 text-sm text-[var(--mk-muted)]">
                    {counted(item.module_count, "module")}
                    {/* `accessLabel` already ends in "of access" — appending it
                        here read "2 months of access of access". */}
                    {accessLabel(item.access_days)
                      ? ` · ${accessLabel(item.access_days)}`
                      : ""}
                  </p>
                  {item.problem ? (
                    <p className="mt-3 text-sm font-medium text-warning-400">
                      {item.problem}
                    </p>
                  ) : null}
                </div>

                <div className="text-right">
                  <p
                    className={`text-lg font-semibold ${
                      item.problem
                        ? "text-[var(--mk-muted)] line-through"
                        : "text-[var(--mk-text)]"
                    }`}
                  >
                    {formatMoney(item.price_minor, item.currency)}
                  </p>
                  <button
                    type="button"
                    onClick={() => void onRemove(item.course_id)}
                    className="mt-2 text-sm text-[var(--mk-muted)] underline transition hover:text-error-400"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>

        <aside className="h-fit rounded-2xl border border-[var(--mk-line)] bg-[var(--mk-raised)]/60 p-6">
          <h2 className="mb-4 text-lg font-semibold text-[var(--mk-text)]">
            Total
          </h2>
          <p className="mb-1 text-3xl font-bold text-[var(--mk-text)]">
            {formatMoney(cart.total_minor, cart.currency)}
          </p>
          <p className="mb-6 text-sm text-[var(--mk-muted)]">
            Inclusive of taxes. Razorpay handles the payment, so we never see
            your card details.
          </p>

          {blocked.length > 0 ? (
            <p className="mb-4 rounded-lg border border-warning-500/40 bg-warning-500/10 px-3 py-2 text-sm text-warning-400">
              {blocked.length === 1
                ? "One course above cannot be bought right now. Remove it to check out."
                : `${blocked.length} courses above cannot be bought right now. Remove them to check out.`}
            </p>
          ) : null}

          <button
            type="button"
            onClick={checkout}
            disabled={busy || !cart.ready}
            className="w-full rounded-lg bg-[var(--mk-brand)] px-6 py-3 text-base font-semibold text-white transition hover:bg-[var(--mk-brand)]/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Opening checkout…" : "Check out"}
          </button>

          <button
            type="button"
            onClick={() => void onEmpty()}
            className="mt-3 w-full rounded-lg px-6 py-2 text-sm text-[var(--mk-muted)] underline transition hover:text-error-400"
          >
            Empty the cart
          </button>
        </aside>
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Signed out
// ---------------------------------------------------------------------------

interface GuestLine {
  id: string;
  title: string;
  priceMinor: number;
  currency: string;
  moduleCount: number;
}

function GuestCart({
  ids,
  onRemove,
}: {
  ids: Set<string>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [lines, setLines] = useState<GuestLine[] | null>(null);
  const [failed, setFailed] = useState(false);
  const key = [...ids].sort().join(",");

  useEffect(() => {
    if (ids.size === 0) {
      setLines([]);
      return;
    }
    let cancelled = false;
    listPublicCourses()
      .then((courses) => {
        if (cancelled) return;
        setLines(
          courses
            .filter((course) => ids.has(course.id))
            .map((course) => ({
              id: course.id,
              title: course.title,
              priceMinor: course.priceMinor,
              currency: course.currency,
              moduleCount: course.moduleCount,
            })),
        );
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // `key` rather than the Set: a new Set with the same ids is a new object
    // every render, and this effect would never stop refetching.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (ids.size === 0) return <Empty />;

  if (failed) {
    return (
      <Shell>
        <p className="text-[var(--mk-muted)]">
          The catalogue is unavailable right now, so your cart cannot be priced.
          Nothing has been lost. Try again in a moment.
        </p>
      </Shell>
    );
  }

  if (lines === null) {
    return (
      <Shell>
        <p className="text-[var(--mk-muted)]">Pricing your cart…</p>
      </Shell>
    );
  }

  const total = lines.reduce((sum, line) => sum + line.priceMinor, 0);
  const currency = lines[0]?.currency ?? "INR";
  const next = encodeURIComponent("/cart");

  return (
    <Shell>
      <p className="mb-8 text-base text-[var(--mk-muted)]">
        {counted(lines.length, "course")} waiting. Sign in and they move to your
        account. Nothing here is lost when you do.
      </p>

      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <ul className="space-y-4">
          {lines.map((line) => (
            <li
              key={line.id}
              className="rounded-2xl border border-[var(--mk-line)] bg-[var(--mk-raised)]/60 p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/courses/${line.id}`}
                    className="text-lg font-semibold text-[var(--mk-text)] hover:underline"
                  >
                    {line.title}
                  </Link>
                  <p className="mt-1 text-sm text-[var(--mk-muted)]">
                    {counted(line.moduleCount, "module")}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold text-[var(--mk-text)]">
                    {formatMoney(line.priceMinor, line.currency)}
                  </p>
                  <button
                    type="button"
                    onClick={() => void onRemove(line.id)}
                    className="mt-2 text-sm text-[var(--mk-muted)] underline transition hover:text-error-400"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>

        <aside className="h-fit rounded-2xl border border-[var(--mk-line)] bg-[var(--mk-raised)]/60 p-6">
          <h2 className="mb-4 text-lg font-semibold text-[var(--mk-text)]">
            Total
          </h2>
          <p className="mb-1 text-3xl font-bold text-[var(--mk-text)]">
            {formatMoney(total, currency)}
          </p>
          {/* Said plainly rather than left for checkout to reveal: these are
              today's catalogue prices, and what anybody is charged is settled
              by the server when they actually pay. */}
          <p className="mb-6 text-sm text-[var(--mk-muted)]">
            Today&rsquo;s prices. Sign in to check out. We will confirm the
            total before anything is charged.
          </p>

          <Link
            href={`/signin?next=${next}`}
            className="block w-full rounded-lg bg-[var(--mk-brand)] px-6 py-3 text-center text-base font-semibold text-white transition hover:bg-[var(--mk-brand)]/90"
          >
            Sign in to check out
          </Link>
          <Link
            href={`/signup?next=${next}`}
            className="mt-3 block w-full rounded-lg border border-[var(--mk-line)] px-6 py-3 text-center text-base font-semibold text-[var(--mk-text)] transition hover:border-[var(--mk-brand)]"
          >
            Create an account
          </Link>
        </aside>
      </div>
    </Shell>
  );
}
