"use client";

import { useState } from "react";

import {
  type Bundle,
  type BundleHolder,
  listBundleHolders,
  updateBundle,
} from "@/lib/adminBundles";
import { formatMoney } from "@/lib/analytics";
import { type CourseRow } from "@/lib/authoring";
import { counted } from "@/lib/plural";

const FIELD =
  "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

/**
 * One bundle: what it costs, what is in it, and who bought it.
 *
 * THE ONE THING THIS SCREEN HAS TO BE HONEST ABOUT is that the two edits it
 * offers have completely different blast radii.
 *
 *   PRICE affects the next person to buy. Nobody's existing order moves —
 *   `orders.amount_minor` is copied at purchase time exactly so that a price
 *   change cannot rewrite what somebody already paid.
 *
 *   COURSES affect everybody holding it, the moment it saves. Access is a live
 *   join through `plan_courses`, so removing a course closes it for every
 *   current subscriber. That is correct for a subscription and still worth
 *   knowing before pressing the button, so the warning appears when the
 *   selection has actually changed rather than sitting there permanently and
 *   being ignored.
 *
 * The holder list is loaded on demand. A page with six bundles would otherwise
 * fetch six subscriber lists nobody asked to see.
 */
export default function BundleEditor({
  bundle,
  courses,
  onChanged,
}: {
  bundle: Bundle;
  courses: CourseRow[];
  onChanged: (updated: Bundle) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(bundle.name);
  const [description, setDescription] = useState(bundle.description ?? "");
  const [rupees, setRupees] = useState(String(bundle.price_minor / 100));
  const [interval, setInterval] = useState(bundle.billing_interval);
  const [active, setActive] = useState(bundle.is_active);
  const [picked, setPicked] = useState<string[]>(
    bundle.courses.map((course) => course.id),
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [holders, setHolders] = useState<BundleHolder[] | null>(null);
  const [loadingHolders, setLoadingHolders] = useState(false);

  const original = new Set(bundle.courses.map((course) => course.id));
  const coursesChanged =
    picked.length !== original.size || picked.some((id) => !original.has(id));
  const dropped = bundle.courses.filter(
    (course) => !picked.includes(course.id),
  );

  async function showHolders() {
    if (holders !== null) {
      setHolders(null);
      return;
    }
    setLoadingHolders(true);
    try {
      setHolders(await listBundleHolders(bundle.id));
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not load the buyers.",
      );
    } finally {
      setLoadingHolders(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await updateBundle(bundle.id, {
        name: name.trim(),
        description: description.trim() || null,
        price_minor: Math.round(Number(rupees) * 100),
        billing_interval: interval,
        is_active: active,
        // Only sent when it actually changed. Sending the same list every time
        // would be harmless but would put "course_ids" in the audit record of
        // every price edit, which makes the trail useless for answering "when
        // did this bundle's contents change".
        ...(coursesChanged ? { course_ids: picked } : {}),
      });
      onChanged(updated);
      setNotice("Saved.");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not save the bundle.",
      );
    } finally {
      setSaving(false);
    }
  }

  const money = (minor: number) => formatMoney(minor, bundle.currency);

  return (
    <li className="rounded-2xl border border-gray-200 p-5 dark:border-gray-800">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">
              {bundle.name}
            </h3>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                bundle.covers_everything
                  ? "bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400"
                  : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
              }`}
            >
              {bundle.covers_everything ? "All Access" : "Bundle"}
            </span>
            {!bundle.is_active ? (
              <span className="rounded-full bg-warning-50 px-2.5 py-0.5 text-xs font-medium text-warning-700 dark:bg-warning-500/15 dark:text-orange-400">
                Retired
              </span>
            ) : null}
          </div>
          <p className="mt-1 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
            {bundle.description ?? "No description."}
          </p>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            {bundle.courses.map((course) => course.title).join(" · ") ||
              "No courses in this bundle yet."}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-lg font-bold text-gray-800 dark:text-white/90">
            {money(bundle.price_minor)}
            <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
              /{bundle.billing_interval === "yearly" ? "year" : "month"}
            </span>
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {counted(bundle.course_count, "course")} ·{" "}
            {money(bundle.separate_total_minor)} separately
          </p>
        </div>
      </div>

      {/* WHO BOUGHT IT, in numbers. Net rather than gross alone, because a
          bundle with refunds against it is a different story from one
          without. */}
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          {
            label: "Subscribers now",
            value: String(bundle.active_subscribers),
          },
          { label: "Ever", value: String(bundle.total_subscribers) },
          { label: "Paid orders", value: String(bundle.paid_orders) },
          { label: "Net taken", value: money(bundle.net_minor) },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-gray-200 px-4 py-3 dark:border-gray-800"
          >
            <dt className="text-xs text-gray-500 dark:text-gray-400">
              {stat.label}
            </dt>
            <dd className="mt-0.5 text-sm font-semibold text-gray-800 dark:text-white/90">
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 flex flex-wrap gap-4">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400"
        >
          {open ? "Close" : "Edit bundle"}
        </button>
        <button
          type="button"
          onClick={() => void showHolders()}
          className="text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400"
        >
          {loadingHolders
            ? "Loading…"
            : holders !== null
              ? "Hide buyers"
              : "Who bought it"}
        </button>
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-error-500 bg-error-50 px-4 py-2.5 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="mt-4 rounded-lg border border-success-500 bg-success-50 px-4 py-2.5 text-sm text-success-700 dark:bg-success-500/10 dark:text-success-400"
        >
          {notice}
        </p>
      ) : null}

      {holders !== null ? (
        <div className="mt-4 border-t border-gray-100 pt-4 dark:border-gray-800">
          {holders.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Nobody has bought this bundle yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {holders.map((holder) => (
                <li
                  key={holder.user_id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 px-4 py-3 dark:border-gray-800"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-gray-800 dark:text-white/90">
                      {holder.name}
                    </span>
                    <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                      {holder.email}
                      {holder.period_end
                        ? ` · ${holder.cancelled ? "ends" : "renews"} ${new Date(
                            holder.period_end,
                          ).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}`
                        : ""}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      {formatMoney(holder.paid_minor, bundle.currency)}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        holder.status === "paid_not_granted"
                          ? "bg-error-50 text-error-700 dark:bg-error-500/15 dark:text-error-400"
                          : holder.live
                            ? "bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-400"
                            : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                      }`}
                    >
                      {/* Named in words. "paid_not_granted" is a real state
                          and the one an owner most needs to notice: money
                          taken and nothing given. */}
                      {holder.status === "paid_not_granted"
                        ? "Paid, nothing granted"
                        : holder.live
                          ? "Active"
                          : holder.status}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {open ? (
        <div className="mt-4 space-y-4 border-t border-gray-100 pt-4 dark:border-gray-800">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Name
              </span>
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className={FIELD}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Price ({bundle.currency})
              </span>
              <input
                type="number"
                min={0}
                step="1"
                value={rupees}
                onChange={(event) => setRupees(event.target.value)}
                className={FIELD}
              />
              <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
                Applies to the next person who buys. Existing orders are not
                changed.
              </span>
            </label>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Description
            </span>
            <textarea
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
            />
          </label>

          <div className="flex flex-wrap items-end gap-4">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Billed
              </span>
              <select
                value={interval}
                onChange={(event) => setInterval(event.target.value)}
                className={FIELD}
              >
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </label>
            <label className="flex items-center gap-2 pb-3">
              <input
                type="checkbox"
                checked={active}
                onChange={(event) => setActive(event.target.checked)}
                className="h-4 w-4 rounded border-gray-300 dark:border-gray-700"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                On sale
              </span>
            </label>
          </div>

          <div>
            <span className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Courses in this bundle
            </span>
            <div className="grid gap-2 sm:grid-cols-2">
              {courses.map((course) => (
                <label
                  key={course.id}
                  className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-800"
                >
                  <input
                    type="checkbox"
                    checked={picked.includes(course.id)}
                    onChange={(event) =>
                      setPicked((current) =>
                        event.target.checked
                          ? [...current, course.id]
                          : current.filter((id) => id !== course.id),
                      )
                    }
                    className="h-4 w-4 rounded border-gray-300 dark:border-gray-700"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-700 dark:text-gray-300">
                    {course.title}
                  </span>
                  <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
                    {formatMoney(course.price_minor, course.currency)}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Only while the selection has actually changed. A warning that is
              always on screen is a warning nobody reads. */}
          {dropped.length > 0 ? (
            <p className="rounded-lg border border-warning-500 bg-warning-50 px-4 py-2.5 text-sm text-warning-700 dark:bg-warning-500/10 dark:text-orange-400">
              Saving will close{" "}
              {dropped.map((course) => course.title).join(", ")} for all{" "}
              {counted(bundle.active_subscribers, "current subscriber")} of this
              bundle, straight away.
            </p>
          ) : null}

          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save bundle"}
          </button>
        </div>
      ) : null}
    </li>
  );
}
