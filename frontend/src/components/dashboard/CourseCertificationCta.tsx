"use client";

import { useEffect, useState } from "react";

import { CertificationBadge } from "@/components/assessments/AssessmentBadge";
import { type CertExam, listCourseExams } from "@/lib/assessments";
import type { ModuleSummary } from "@/lib/student";
import { counted } from "@/lib/plural";
import ProgressBar from "@/components/ui/ProgressBar";

/**
 * The certification exam, at the foot of the course.
 *
 * Deliberately gated on finishing every module rather than merely warned
 * about. Certification is the only capped assessment in the product — three
 * attempts, each consumed on submit — so a student who wanders in after
 * module one and fails has burned a third of their allowance on material
 * nobody taught them yet. Quizzes stay open precisely because they cost
 * nothing.
 *
 * The gate is presentation, not security: `require_access_to_exam` and the
 * attempt allowance are both enforced server-side, and always were.
 */
export default function CourseCertificationCta({
  courseId,
  modules,
  enrolled,
  hasAccess,
}: {
  courseId: string;
  modules: ModuleSummary[];
  enrolled: boolean;
  hasAccess: boolean;
}) {
  const [exams, setExams] = useState<CertExam[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const found = await listCourseExams(courseId);
        if (!cancelled) setExams(found);
      } catch {
        // A course with no exam is the ordinary case, and a locked course
        // answers 402 here. Neither is worth a red box at the foot of the
        // page — the section simply does not render.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  if (loading || exams.length === 0) return null;

  const exam = exams[0];
  const total = modules.length;
  const done = modules.filter((module) => module.status === "completed").length;
  const remaining = total - done;
  const ready = enrolled && hasAccess && total > 0 && remaining === 0;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div
      className={`rounded-2xl border p-6 ${
        ready
          ? "border-warning-300 bg-gradient-to-br from-warning-50 to-white dark:border-warning-500/40 dark:from-warning-500/10 dark:to-transparent"
          : "border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <span aria-hidden="true" className="text-2xl">
              🎓
            </span>
            <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">
              {exam.title}
            </h2>
          </div>

          <div className="mb-3">
            <CertificationBadge allowed={exam.default_max_attempts} />
          </div>

          <p className="text-sm text-gray-600 dark:text-gray-400">
            {!hasAccess
              ? "Buy this course to sit its certification exam."
              : !enrolled
                ? "Enrol in this course to sit its certification exam."
                : ready
                  ? "Every module is complete. Pass this and your certificate is issued straight away, with a link anyone can use to check it."
                  : `Finish the remaining ${counted(remaining, "module")} to earn it. Every submitted attempt counts, so the exam opens once you have been through the material.`}
          </p>
        </div>

        <div className="w-full shrink-0 sm:w-auto">
          {ready ? (
            /* A real link with target=_blank, not an onClick: the exam takes
               over the whole viewport once started, and a tab of its own
               leaves the course material where the student left it.
               Middle-click and the keyboard keep working. */
            <a
              href={`/certification/${exam.id}`}
              target="_blank"
              rel="noopener noreferrer"
              // warning-500 with white measures 2.35:1. Decision 231 concluded that amber
              // cannot carry white "at any shade", but that was about the BADGE, which
              // needs a pale fill; a solid CTA can go darker, and warning-700 measures
              // 5.43:1 while still reading as amber rather than brown.
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-warning-700 px-6 py-3 text-sm font-semibold text-white transition hover:bg-warning-800 sm:w-auto"
            >
              Take the certification exam
              <span aria-hidden="true">↗</span>
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          ) : (
            <button
              type="button"
              disabled
              title={
                !hasAccess
                  ? "Buy this course first"
                  : !enrolled
                    ? "Enrol first"
                    : `${counted(remaining, "module")} left to complete`
              }
              className="flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-lg bg-gray-200 px-6 py-3 text-sm font-semibold text-gray-500 sm:w-auto dark:bg-gray-800 dark:text-gray-400"
            >
              <span aria-hidden="true">🔒</span>
              Certification exam locked
            </button>
          )}
        </div>
      </div>

      {enrolled && hasAccess && total > 0 && !ready ? (
        <div className="mt-5 border-t border-gray-200 pt-4 dark:border-gray-800">
          <div className="mb-1.5 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
            <span>
              {done} of {total} modules complete
            </span>
            <span className="font-medium text-gray-700 dark:text-gray-300">
              {percent}%
            </span>
          </div>
          <ProgressBar
            value={percent}
            label={`${done} of ${total} modules complete`}
          />
        </div>
      ) : null}
    </div>
  );
}
