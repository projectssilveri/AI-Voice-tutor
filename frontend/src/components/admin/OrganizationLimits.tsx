"use client";

import { useCallback, useEffect, useState } from "react";

import { SkeletonRows } from "@/components/ui/Skeleton";
import { ApiError } from "@/lib/api";
import {
  type OrganizationUsage,
  getOrganizationLimits,
  setOrganizationLimits,
} from "@/lib/organizations";

/**
 * What a customer is allowed, and what they have used.
 *
 * These columns have existed and been ENFORCED since migration 0013 — a seat
 * limit refuses the next member, an AI budget refuses the next voice session,
 * a module cap refuses the eleventh module. Nothing could set them, so every
 * one was permanently null and the enforcement never fired. This screen is what
 * makes them real.
 *
 * BLANK MEANS UNLIMITED, and the fields say so rather than leaving the reader
 * to guess. Zero is a different thing entirely: a real limit meaning "none
 * allowed", which is why the empty box cannot quietly become a zero.
 */

const FIELD =
  "w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

/** A used/allowed pair, with a bar when there is a ceiling to draw one against. */
function Meter({
  label,
  used,
  allowed,
  unit,
}: {
  label: string;
  used: number;
  allowed: number | null;
  unit: string;
}) {
  const percent =
    allowed && allowed > 0
      ? Math.min(100, Math.round((used / allowed) * 100))
      : 0;
  // Amber from four fifths: enough warning to do something about it before the
  // customer's next hire or their busiest week of training.
  const tight = allowed !== null && percent >= 80;

  return (
    <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
      <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p className="mt-1 text-xl font-bold text-gray-800 dark:text-white/90">
        {used.toLocaleString()}
        <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
          {allowed === null
            ? ` ${unit} · no limit`
            : ` of ${allowed.toLocaleString()} ${unit}`}
        </span>
      </p>
      {allowed !== null ? (
        <>
          {/* Width is a plain inline style, never animated: decision 212 —
              nothing carrying information may be animated at all. */}
          <span className="mt-2 block h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
            <span
              className={`block h-full rounded-full ${
                tight ? "bg-warning-500" : "bg-brand-500"
              }`}
              style={{ width: `${percent}%` }}
            />
          </span>
          <p
            className={`mt-1 text-xs ${
              tight
                ? "font-medium text-warning-900 dark:text-warning-300"
                : "text-gray-500 dark:text-gray-400"
            }`}
          >
            {Math.max(0, allowed - used).toLocaleString()} left
          </p>
        </>
      ) : null}
    </div>
  );
}

/** "" means unlimited on the way out; the API wants null for that. */
function toValue(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
}

export default function OrganizationLimits({
  organizationId,
}: {
  organizationId: string;
}) {
  const [usage, setUsage] = useState<OrganizationUsage | null>(null);
  const [members, setMembers] = useState("");
  const [minutes, setMinutes] = useState("");
  const [modules, setModules] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const found = await getOrganizationLimits(organizationId);
      setUsage(found);
      setMembers(found.members_allowed?.toString() ?? "");
      setMinutes(found.ai_minutes_allowed?.toString() ?? "");
      setModules(found.max_modules_per_course.toString());
      setNote(found.plan_note ?? "");
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not load the plan.",
      );
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setBusy(true);
    setSaved(false);
    try {
      const found = await setOrganizationLimits(organizationId, {
        max_members: toValue(members),
        max_ai_minutes_per_month: toValue(minutes),
        max_modules_per_course: toValue(modules),
        plan_note: note.trim() || null,
      });
      setUsage(found);
      setSaved(true);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not save the plan.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!usage) {
    return error ? (
      <p
        role="alert"
        className="rounded-lg border border-error-500 bg-error-50 px-4 py-2.5 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400"
      >
        {error}
      </p>
    ) : (
      <SkeletonRows rows={3} />
    );
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-raised dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="mb-1 flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">
          Plan and limits
        </h2>
        {saved ? (
          <span
            role="status"
            className="text-sm text-success-800 dark:text-success-400"
          >
            Saved
          </span>
        ) : null}
      </div>
      <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
        What this customer is allowed, and what they have used. Leave a box
        empty for no limit.
      </p>

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <Meter
          label="Seats used"
          used={usage.members_used}
          allowed={usage.members_allowed}
          unit="people"
        />
        <Meter
          label="AI tutor this month"
          used={usage.ai_minutes_used}
          allowed={usage.ai_minutes_allowed}
          unit="minutes"
        />
      </div>

      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-error-500 bg-error-50 px-4 py-2.5 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400"
        >
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label
            htmlFor="limit-members"
            className="mb-1.5 block text-sm font-medium text-gray-800 dark:text-white/90"
          >
            Seats
          </label>
          <input
            id="limit-members"
            type="number"
            min={0}
            value={members}
            onChange={(event) => setMembers(event.target.value)}
            placeholder="No limit"
            className={FIELD}
          />
        </div>
        <div>
          <label
            htmlFor="limit-minutes"
            className="mb-1.5 block text-sm font-medium text-gray-800 dark:text-white/90"
          >
            AI minutes a month
          </label>
          <input
            id="limit-minutes"
            type="number"
            min={0}
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
            placeholder="No limit"
            className={FIELD}
          />
        </div>
        <div>
          <label
            htmlFor="limit-modules"
            className="mb-1.5 block text-sm font-medium text-gray-800 dark:text-white/90"
          >
            Modules per course
          </label>
          <input
            id="limit-modules"
            type="number"
            min={1}
            value={modules}
            onChange={(event) => setModules(event.target.value)}
            className={FIELD}
          />
        </div>
      </div>

      <div className="mt-4">
        <label
          htmlFor="limit-note"
          className="mb-1.5 block text-sm font-medium text-gray-800 dark:text-white/90"
        >
          What was agreed{" "}
          <span className="font-normal text-gray-500 dark:text-gray-400">
            (internal note)
          </span>
        </label>
        <input
          id="limit-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={500}
          placeholder="Anything about this customer's terms worth writing down"
          className={FIELD}
        />
      </div>

      {/* Said plainly, because an admin about to lower a seat count needs to
          know it will not throw anybody out. */}
      <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
        A limit below current use is allowed and takes nobody&apos;s account
        away. It simply refuses the next addition, which is what a customer
        renewing on a smaller plan actually needs.
      </p>

      <button
        type="button"
        disabled={busy}
        onClick={() => void save()}
        className="mt-5 rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save plan"}
      </button>
    </section>
  );
}
