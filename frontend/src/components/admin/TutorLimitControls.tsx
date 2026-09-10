"use client";

import { useState } from "react";

import { useAuth } from "@/context/AuthContext";
import { type CourseRow, updateCourseLimits } from "@/lib/authoring";
import { counted } from "@/lib/plural";

const FIELD =
  "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

/**
 * What the AI tutor may do on this course. Super admin only.
 *
 * Two numbers: how many times a student may play the tutor on ONE module, and
 * how long each play runs. Both apply to every module in the course.
 *
 * BLANK MEANS "USE THE DEFAULT", and that is the whole reason the boxes start
 * empty rather than pre-filled with the current figure. A form that seeded
 * itself with "3" would turn every save into an explicit override, and the
 * course would then stop following the platform default the day it changed —
 * silently, with the screen still showing 3. The resolved figure is shown
 * beside the box instead, so the operator can see what is in force without the
 * form claiming it.
 *
 * Mirrors `PricingControls`: an ordinary admin sees the settings read-only,
 * because they author content and do not set the AI budget. The server agrees
 * — `PATCH /courses/{id}/limits` is behind `RequireSuperAdmin`.
 */
export default function TutorLimitControls({
  course,
  onChanged,
}: {
  course: CourseRow;
  onChanged: (updated: CourseRow) => void;
}) {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";

  const [plays, setPlays] = useState(
    course.ai_sessions_per_module === null
      ? ""
      : String(course.ai_sessions_per_module),
  );
  const [minutes, setMinutes] = useState(
    course.ai_session_minutes === null ? "" : String(course.ai_session_minutes),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const inForce = `${counted(
    course.effective_ai_sessions_per_module,
    "play",
  )} per module, ${course.effective_ai_session_minutes} minutes each`;

  const basisNote =
    course.ai_sessions_per_module === null && course.ai_session_minutes === null
      ? `Using the ${course.ai_limit_basis} course default.`
      : "Set for this course.";

  if (!isSuperAdmin) {
    return (
      <div className="rounded-xl border border-gray-200 p-5 dark:border-gray-800">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-white/90">
          AI tutor limits
        </h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {inForce}. {basisNote} Only a super admin can change this.
        </p>
      </div>
    );
  }

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      // An empty box sends null, which CLEARS the override rather than being
      // dropped. Without that there would be no way back to the default short
      // of guessing today's number and typing it in — which would then stop
      // tracking it.
      const updated = await updateCourseLimits(course.id, {
        ai_sessions_per_module: plays.trim() === "" ? null : Number(plays),
        ai_session_minutes: minutes.trim() === "" ? null : Number(minutes),
      });
      onChanged(updated);
      setNotice(
        `Saved. Students get ${counted(
          updated.effective_ai_sessions_per_module,
          "play",
        )} per module, ${updated.effective_ai_session_minutes} minutes each.`,
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not save the limits.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 p-5 dark:border-gray-800">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-white/90">
          AI tutor limits
        </h3>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {basisNote}
        </span>
      </div>
      <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
        In force now: <strong className="font-medium">{inForce}</strong>. Leave
        a box empty to follow the {course.ai_limit_basis} course default.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
            Plays per module
          </span>
          <input
            type="number"
            min={0}
            max={100}
            value={plays}
            onChange={(event) => setPlays(event.target.value)}
            placeholder={`Default: ${course.effective_ai_sessions_per_module}`}
            className={FIELD}
          />
          <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
            How many times one student can play the tutor on the same module. 0
            switches the tutor off for this course.
          </span>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
            Minutes per play
          </span>
          <input
            type="number"
            min={1}
            max={600}
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
            placeholder={`Default: ${course.effective_ai_session_minutes}`}
            className={FIELD}
          />
          <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
            The session ends when the time is up. The transcript is kept.
          </span>
        </label>
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

      <button
        type="button"
        onClick={() => void save()}
        disabled={saving}
        className="mt-5 rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-40"
      >
        {saving ? "Saving…" : "Save limits"}
      </button>
    </div>
  );
}
