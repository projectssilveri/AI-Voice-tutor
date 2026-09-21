"use client";

import Link from "next/link";
import { useState } from "react";

import ExamBadge from "@/components/admin/ExamBadge";
import ReviewBadge from "@/components/admin/ReviewBadge";
import { formatMoney } from "@/lib/money";
import { type CourseRow, type ModuleRow, listModules } from "@/lib/authoring";
import { accessLabel } from "@/lib/catalogue";
import { counted } from "@/lib/plural";

/**
 * One course on the Website screen, with everything about it on screen.
 *
 * WHAT THIS REPLACED. A small preview card showing a title, a truncated
 * description, a price and a module count — and then two buttons, one of which
 * went to the course LIST rather than to the course. Deciding whether to put
 * something on sale needs more than that: what it costs and what it used to,
 * how long access lasts, how much tutor time a student gets, how many modules
 * there are and whether any of them are empty, who submitted it and what was
 * said about it last time.
 *
 * All of that is already on the row the list endpoint returns, so showing it
 * costs nothing. The modules are the exception — they are a second request, so
 * they load only when somebody asks to see them.
 */
export default function CourseAdminRow({
  course,
  busy,
  onTogglePublished,
}: {
  course: CourseRow;
  busy: boolean;
  onTogglePublished: (course: CourseRow) => void;
}) {
  const [modules, setModules] = useState<ModuleRow[] | null>(null);
  const [loadingModules, setLoadingModules] = useState(false);

  async function toggleModules() {
    if (modules !== null) {
      setModules(null);
      return;
    }
    setLoadingModules(true);
    try {
      setModules(await listModules(course.id));
    } catch {
      // The row is still useful without them; an error banner on one card
      // would read as the whole screen having failed.
      setModules([]);
    } finally {
      setLoadingModules(false);
    }
  }

  const window = accessLabel(course.access_days);
  const wasMore =
    course.list_price_minor !== null &&
    course.list_price_minor > course.price_minor;

  // An empty module is a course that cannot be taught: the tutor is grounded
  // in `content`, so a module without it produces silence.
  const emptyModules = modules?.filter((m) => !m.content?.trim()).length ?? 0;

  const facts = [
    {
      label: "Price",
      value:
        course.price_minor > 0
          ? formatMoney(course.price_minor, course.currency)
          : "Free",
      hint: wasMore
        ? `was ${formatMoney(course.list_price_minor ?? 0, course.currency)}`
        : undefined,
    },
    {
      label: "Access",
      value: window ?? "Never expires",
      hint: course.access_days ? `${course.access_days} days` : undefined,
    },
    {
      label: "Modules",
      value: String(course.module_count ?? 0),
      hint: (course.module_count ?? 0) === 0 ? "cannot be sold" : undefined,
    },
    {
      label: "AI tutor",
      value: `${course.effective_ai_sessions_per_module} × ${course.effective_ai_session_minutes} min`,
      hint: `per module, ${course.ai_limit_basis} default`,
    },
  ];

  return (
    <li className="rounded-2xl border border-gray-200 bg-white p-5 shadow-raised dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">
              {course.title}
            </h3>
            <ReviewBadge course={course} />
            <ExamBadge course={course} />
          </div>
          <p className="mt-1 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
            {course.description ||
              "No description. Visitors will see nothing here."}
          </p>

          {/* The owner's own last note, on the course it was written about. */}
          {course.review_status === "rejected" && course.review_note ? (
            <p className="mt-2 text-xs text-error-600 dark:text-error-400">
              Sent back: {course.review_note}
            </p>
          ) : null}
        </div>

        {/* `shrink-0` ONLY FROM sm UP. On a phone it stopped this button group
        narrowing at all, so three buttons held the row at their own
        width and pushed the whole page 121px wider than the screen —
        `flex-wrap` could not help, because nothing was allowed to
        shrink enough to wrap. Full width below sm, so the buttons
        wrap onto their own line instead. */}
        <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:shrink-0">
          {course.is_published ? (
            <Link
              href={`/courses/${course.id}`}
              target="_blank"
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03]"
            >
              View as a visitor ↗
            </Link>
          ) : null}
          {/* To the COURSE, not the course list. The old button went to the
              index and left the owner to find the row again. */}
          <Link
            href={`/admin/courses/${course.id}`}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03]"
          >
            Edit course and modules
          </Link>
          <button
            type="button"
            disabled={busy || (!course.is_published && !course.module_count)}
            onClick={() => onTogglePublished(course)}
            title={
              !course.is_published && !course.module_count
                ? "Add at least one module before putting it on sale"
                : undefined
            }
            className={
              course.is_published
                ? "rounded-lg border border-warning-500 px-4 py-2 text-sm font-medium text-warning-700 transition hover:bg-warning-50 disabled:opacity-40 dark:text-orange-400 dark:hover:bg-warning-500/10"
                : "rounded-lg bg-success-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-success-800 disabled:opacity-40"
            }
          >
            {busy
              ? "Working…"
              : course.is_published
                ? "Take off sale"
                : "Publish"}
          </button>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {facts.map((fact) => (
          <div
            key={fact.label}
            className="rounded-xl border border-gray-200 px-4 py-3 dark:border-gray-800"
          >
            <dt className="text-xs text-gray-500 dark:text-gray-400">
              {fact.label}
            </dt>
            <dd className="mt-0.5 text-sm font-semibold text-gray-800 dark:text-white/90">
              {fact.value}
            </dd>
            {fact.hint ? (
              <dd className="text-xs text-gray-500 dark:text-gray-400">
                {fact.hint}
              </dd>
            ) : null}
          </div>
        ))}
      </dl>

      <div className="mt-4 border-t border-gray-100 pt-4 dark:border-gray-800">
        <button
          type="button"
          onClick={() => void toggleModules()}
          aria-expanded={modules !== null}
          className="text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400"
        >
          {loadingModules
            ? "Loading…"
            : modules !== null
              ? "Hide the modules"
              : `Show the ${counted(course.module_count ?? 0, "module")}`}
        </button>

        {modules !== null ? (
          modules.length === 0 ? (
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
              No modules yet. The tutor teaches from a module&rsquo;s text, so a
              course without one cannot be taught or sold.
            </p>
          ) : (
            <>
              {emptyModules > 0 ? (
                <p className="mt-3 text-sm text-warning-700 dark:text-orange-400">
                  {counted(emptyModules, "module")} with no content. The tutor
                  has nothing to say on {emptyModules === 1 ? "it" : "those"}.
                </p>
              ) : null}
              <ol className="mt-3 space-y-2">
                {modules.map((module, index) => {
                  const words = (module.content || "")
                    .trim()
                    .split(/\s+/)
                    .filter(Boolean).length;
                  return (
                    <li
                      key={module.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 px-4 py-2.5 dark:border-gray-800"
                    >
                      <span className="min-w-0 text-sm text-gray-700 dark:text-gray-300">
                        <span className="mr-2 text-gray-400 dark:text-gray-500">
                          {index + 1}.
                        </span>
                        {module.title}
                      </span>
                      <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
                        {words === 0
                          ? "No content"
                          : `${words.toLocaleString()} words · ~${Math.max(1, Math.round(words / 140))} min`}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </>
          )
        ) : null}
      </div>
    </li>
  );
}
