"use client";

import Link from "next/link";
import { useState } from "react";

import { counted } from "@/lib/plural";
import type { ModuleSummary, ProgressStatus } from "@/lib/student";
import Collapse from "@/components/ui/Collapse";

const STATUS: Record<
  ProgressStatus,
  { label: string; dot: string; pill: string }
> = {
  not_started: {
    label: "Not started",
    dot: "bg-gray-300 dark:bg-gray-600",
    pill: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  },
  in_progress: {
    label: "In progress",
    dot: "bg-warning-500",
    pill: "bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-400",
  },
  completed: {
    label: "Completed",
    dot: "bg-success-500",
    pill: "bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-400",
  },
};

/**
 * The curriculum inside an enrolled course.
 *
 * Collapsed rows summarise what is in the module; expanding gives a direct
 * link to each part, so reaching a quiz no longer means opening the module and
 * hunting for the button.
 *
 * The voice lecture is deliberately the loudest row. It is the whole product,
 * and rendering it as one more grey item beside "Quiz" would bury the single
 * thing that makes this different from a page of text.
 */
export default function ModuleAccordion({
  courseId,
  modules,
  enrolled,
}: {
  courseId: string;
  modules: ModuleSummary[];
  enrolled: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);

  if (modules.length === 0) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        No modules in this course yet.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-gray-100 dark:divide-gray-800">
      {modules.map((module, index) => {
        const expanded = open === module.id;
        const status = STATUS[module.status];
        const base = `/learn/${courseId}/${module.id}`;

        const summary = [
          module.has_content ? "Voice lecture" : null,
          module.quiz_questions > 0
            ? counted(module.quiz_questions, "quiz question")
            : null,
          module.assignments > 0
            ? counted(module.assignments, "assignment")
            : null,
          module.materials > 0 ? counted(module.materials, "PDF") : null,
        ]
          .filter(Boolean)
          .join(" · ");

        return (
          <li key={module.id}>
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={`mod-${module.id}`}
              onClick={() => setOpen(expanded ? null : module.id)}
              className="flex w-full items-center gap-3 px-1 py-4 text-left transition hover:bg-gray-50 dark:hover:bg-white/[0.03]"
            >
              <span
                aria-hidden="true"
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${status.dot}`}
              />
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-sm font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                {index + 1}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block font-medium text-gray-800 dark:text-white/90">
                  {module.title}
                </span>
                <span className="block text-xs text-gray-500 dark:text-gray-400">
                  {summary || "Being written"}
                </span>
              </span>

              <span
                className={`hidden shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium sm:block ${status.pill}`}
              >
                {status.label}
              </span>
              <span
                aria-hidden="true"
                className={`shrink-0 text-gray-500 dark:text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`}
              >
                ▾
              </span>
            </button>

            <Collapse open={expanded} id={`mod-${module.id}`}>
              <div className="space-y-2 pb-4 pl-[76px] pr-1">
                {/* Opens in its own tab: a live voice session is lost the
                    moment the page unmounts, so navigating away mid-lecture
                    would drop the call. */}
                <button
                  type="button"
                  disabled={!enrolled || !module.has_content}
                  onClick={() =>
                    window.open(base, "_blank", "noopener,noreferrer")
                  }
                  title={
                    !enrolled
                      ? "Enrol to use the tutor"
                      : !module.has_content
                        ? "This module has no material yet"
                        : "Opens in a new tab"
                  }
                  className="flex w-full items-center gap-3 rounded-xl border border-brand-300 bg-brand-25 px-4 py-3 text-left transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-brand-700 dark:bg-brand-500/10 dark:hover:bg-brand-500/20"
                >
                  <span aria-hidden="true" className="text-lg">
                    🎙️
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-brand-600 dark:text-brand-400">
                      Voice lecture with the AI tutor
                    </span>
                    <span className="block text-xs text-gray-500 dark:text-gray-400">
                      {module.estimated_minutes > 0
                        ? `About ${module.estimated_minutes} min. `
                        : ""}
                      Interrupt any time to ask a question.
                    </span>
                  </span>
                  <span
                    aria-hidden="true"
                    className="text-brand-500 dark:text-brand-400"
                  >
                    ↗
                  </span>
                </button>

                {module.quiz_questions > 0 ? (
                  <Link
                    href={`${base}/quiz`}
                    className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 transition-[transform,box-shadow,border-color,background-color] duration-200 ease-[var(--ease-out-soft)] hover:-translate-y-0.5 hover:border-brand-300 hover:bg-gray-50 hover:shadow-raised dark:border-gray-800 dark:hover:bg-white/[0.03]"
                  >
                    <span aria-hidden="true">✅</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-gray-800 dark:text-white/90">
                        Practice quiz
                      </span>
                      <span className="block text-xs text-success-600 dark:text-success-400">
                        {counted(module.quiz_questions, "question")} · unlimited
                        attempts
                      </span>
                    </span>
                  </Link>
                ) : null}

                {module.assignments > 0 ? (
                  <Link
                    href={`${base}/assignment`}
                    className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 transition-[transform,box-shadow,border-color,background-color] duration-200 ease-[var(--ease-out-soft)] hover:-translate-y-0.5 hover:border-brand-300 hover:bg-gray-50 hover:shadow-raised dark:border-gray-800 dark:hover:bg-white/[0.03]"
                  >
                    <span aria-hidden="true">✍️</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-gray-800 dark:text-white/90">
                        {counted(module.assignments, "Assignment")}
                      </span>
                      <span className="block text-xs text-gray-500 dark:text-gray-400">
                        Marked the moment you submit
                      </span>
                    </span>
                  </Link>
                ) : null}

                <Link
                  href={base}
                  className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 transition-[transform,box-shadow,border-color,background-color] duration-200 ease-[var(--ease-out-soft)] hover:-translate-y-0.5 hover:border-brand-300 hover:bg-gray-50 hover:shadow-raised dark:border-gray-800 dark:hover:bg-white/[0.03]"
                >
                  <span aria-hidden="true">📄</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-gray-800 dark:text-white/90">
                      Module material
                    </span>
                    <span className="block text-xs text-gray-500 dark:text-gray-400">
                      {module.materials > 0
                        ? `${counted(module.materials, "PDF")} and the written material`
                        : "The written material"}
                    </span>
                  </span>
                </Link>
              </div>
            </Collapse>
          </li>
        );
      })}
    </ul>
  );
}
