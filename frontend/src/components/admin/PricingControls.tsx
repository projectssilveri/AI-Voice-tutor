"use client";

import { useState } from "react";

import { useAuth } from "@/context/AuthContext";
import { formatMoney } from "@/lib/analytics";
import {
  type CourseRow,
  updateCoursePricing,
  type CoursePricingInput,
} from "@/lib/authoring";

const FIELD =
  "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

/**
 * Price and availability. Super admin only.
 *
 * An ordinary admin does not see this block, and could not use it anyway —
 * `PATCH /courses/{id}/pricing` 403s them, and the ordinary course-update
 * schema has no price field to smuggle one through.
 *
 * Prices are entered in rupees and stored in paise. Money is never a float;
 * the conversion happens once, here, on a value that is already whole.
 */
export default function PricingControls({
  course,
  onChanged,
}: {
  course: CourseRow;
  onChanged: (updated: CourseRow) => void;
}) {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";

  const [rupees, setRupees] = useState(String(course.price_minor / 100));
  // Blank rather than "0" when unset: an empty box reads as "no previous
  // price", where a zero reads as "it used to be free".
  const [wasRupees, setWasRupees] = useState(
    course.list_price_minor === null
      ? ""
      : String(course.list_price_minor / 100),
  );
  const [days, setDays] = useState(
    course.access_days === null ? "" : String(course.access_days),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!isSuperAdmin) {
    return (
      <div className="rounded-xl border border-gray-200 p-5 dark:border-gray-800">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-white/90">
          Price and availability
        </h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {course.price_minor === 0
            ? "This course is free."
            : `Priced at ${formatMoney(course.price_minor, course.currency)}.`}{" "}
          {course.is_published ? "Published." : "Not published."} Only a super
          admin can change this.
        </p>
      </div>
    );
  }

  async function save(changes: CoursePricingInput) {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await updateCoursePricing(course.id, changes);
      onChanged(updated);
      setNotice(
        changes.is_published !== undefined
          ? changes.is_published
            ? "Course published. It is now on sale."
            : "Course unpublished. It is hidden from the catalogue."
          : `Price set to ${formatMoney(updated.price_minor, updated.currency)}.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  async function savePrice(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = Number(rupees);
    if (!Number.isFinite(value) || value < 0) {
      setError("Enter a price of zero or more.");
      return;
    }
    // Blank clears the previous price; blank days clears the window. Both
    // are sent as null explicitly rather than omitted, or `exclude_unset` on
    // the backend would read "cleared" as "unchanged".
    const wasTrimmed = wasRupees.trim();
    const daysTrimmed = days.trim();
    await save({
      price_minor: Math.round(value * 100),
      list_price_minor:
        wasTrimmed === "" ? null : Math.round(Number(wasTrimmed) * 100),
      access_days: daysTrimmed === "" ? null : Math.round(Number(daysTrimmed)),
    });
  }

  const currentWas =
    course.list_price_minor === null
      ? ""
      : String(course.list_price_minor / 100);
  const currentDays =
    course.access_days === null ? "" : String(course.access_days);
  const dirty =
    Math.round(Number(rupees) * 100) !== course.price_minor ||
    wasRupees.trim() !== currentWas ||
    days.trim() !== currentDays;

  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-5 dark:border-brand-800 dark:bg-brand-500/5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-800 dark:text-white/90">
            Price and availability
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Super admin only. Changing the price never alters what someone
            already paid.
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            course.is_published
              ? "bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-400"
              : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
          }`}
        >
          {course.is_published ? "Published" : "Unpublished"}
        </span>
      </div>

      {error ? (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-error-500 bg-error-50 px-4 py-3 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400"
        >
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="mb-4 rounded-lg border border-success-500 bg-success-50 px-4 py-3 text-sm text-success-700 dark:bg-success-500/10 dark:text-success-400">
          {notice}
        </div>
      ) : null}

      <form onSubmit={savePrice} className="flex flex-wrap items-end gap-3">
        <div className="w-40">
          <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
            Price (₹)
          </label>
          <input
            type="number"
            min={0}
            step={1}
            value={rupees}
            onChange={(e) => setRupees(e.target.value)}
            className={FIELD}
          />
        </div>

        <div className="w-44">
          <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
            Was (₹)
          </label>
          <input
            type="number"
            min={0}
            step={1}
            value={wasRupees}
            onChange={(e) => setWasRupees(e.target.value)}
            placeholder="none"
            className={FIELD}
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Only a price it really carried. Leave blank for none.
          </p>
        </div>

        <div className="w-44">
          <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
            Access (days)
          </label>
          <input
            type="number"
            min={0}
            step={1}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            placeholder="never expires"
            className={FIELD}
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {course.suggested_access_days
              ? `${course.module_count} modules suggests ${course.suggested_access_days}.`
              : "Blank never expires."}
          </p>
        </div>

        <button
          type="submit"
          disabled={saving || !dirty}
          className="h-11 rounded-lg bg-brand-500 px-5 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Update pricing"}
        </button>

        {/* Quick nudges — the common case is a small adjustment, not typing a
            whole new number.

            `flex-wrap` because five buttons in a row are 322px wide and do not
            fit a 375px phone once the page padding is taken off: the row ran
            past the edge and took the whole admin course page with it, so the
            screen scrolled sideways. */}
        <div className="flex flex-wrap items-center gap-2">
          {[-500, -100, +100, +500].map((delta) => (
            <button
              key={delta}
              type="button"
              onClick={() =>
                setRupees(String(Math.max(0, Number(rupees || 0) + delta)))
              }
              className="h-11 rounded-lg border border-gray-300 px-3 text-sm font-medium text-gray-700 transition hover:bg-white dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03]"
            >
              {delta > 0 ? `+${delta}` : delta}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setRupees("0")}
            className="h-11 rounded-lg border border-gray-300 px-3 text-sm font-medium text-gray-700 transition hover:bg-white dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03]"
          >
            Make free
          </button>
        </div>

        <button
          type="button"
          onClick={() => save({ is_published: !course.is_published })}
          disabled={saving}
          className={`ml-auto h-11 rounded-lg px-5 text-sm font-medium transition disabled:opacity-50 ${
            course.is_published
              ? "border border-gray-300 text-gray-700 hover:bg-white dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03]"
              : "bg-success-700 text-white hover:bg-success-800"
          }`}
        >
          {course.is_published ? "Unpublish" : "Publish"}
        </button>
      </form>

      <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
        Currently{" "}
        <strong className="text-gray-700 dark:text-gray-300">
          {course.price_minor === 0
            ? "free"
            : formatMoney(course.price_minor, course.currency)}
        </strong>
        . Unpublishing hides it from the catalogue and stops new purchases;
        anyone who already bought it keeps access.
      </p>
    </div>
  );
}
