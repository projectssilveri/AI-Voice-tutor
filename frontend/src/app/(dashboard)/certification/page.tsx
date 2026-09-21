"use client";

import { useEffect, useState } from "react";

import {
  type CertExam,
  type EarnedCertificate,
  certificateDownloadUrl,
  listCourseExams,
  listMyCertificates,
} from "@/lib/assessments";
import { type EnrolledCourse, listMyCourses } from "@/lib/student";
import { SkeletonCards } from "@/components/ui/Skeleton";
import { CertificationBadge } from "@/components/assessments/AssessmentBadge";
import EmptyState from "@/components/ui/EmptyState";
import { errorText } from "@/lib/api";

interface ExamRow extends CertExam {
  course_title: string;
}

/**
 * Certificates: what you have earned, and what you can still sit.
 *
 * Earned goes first. A certificate is the thing a student came for and the
 * thing they come back to find later — burying it under a list of exams they
 * have already passed puts the reward behind the work.
 */
export default function CertificatesPage() {
  const [exams, setExams] = useState<ExamRow[]>([]);
  const [earned, setEarned] = useState<EarnedCertificate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [courses, certificates] = await Promise.all([
          listMyCourses(),
          listMyCertificates(),
        ]);
        const perCourse = await Promise.all(
          courses.map(async (course: EnrolledCourse) => {
            // One course refusing must not blank the whole page. An
            // entitlement that lapsed since enrolment answers 402 here, and a
            // student with five courses would otherwise lose the list of
            // certificates they have already earned because of one of them.
            try {
              const found = await listCourseExams(course.id);
              return found.map((exam) => ({
                ...exam,
                course_title: course.title,
              }));
            } catch {
              return [];
            }
          }),
        );
        if (!cancelled) {
          setExams(perCourse.flat());
          setEarned(certificates);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(
            errorText(caught, "Could not load your certificates."),
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // An exam already passed is not something to sit again; it is listed as a
  // certificate above instead.
  const passed = new Set(earned.map((certificate) => certificate.cert_exam_id));
  const openExams = exams.filter((exam) => !passed.has(exam.id));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="mb-1 text-title-sm font-bold text-gray-800 dark:text-white/90">
          Certificates
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          What you have earned, and the exams you can still sit.
        </p>
      </div>

      {error ? (
        <div className="rounded-2xl border border-error-500 bg-error-50 p-4 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400">
          {error}
        </div>
      ) : null}

      {loading ? (
        <SkeletonCards count={2} />
      ) : (
        <>
          <section>
            <h2 className="mb-3 text-base font-semibold text-gray-800 dark:text-white/90">
              Your certificates
            </h2>
            {earned.length === 0 ? (
              <EmptyState
                icon="🎓"
                title="No certificates yet"
                body="Finish a course and pass its exam, and your certificate shows up here. It comes with a link an employer can open to check it is real, without signing in."
              />
            ) : (
              <ul className="grid gap-4 md:grid-cols-2">
                {earned.map((certificate) => (
                  <li
                    key={certificate.id}
                    className="rounded-2xl border border-success-300 bg-gradient-to-br from-success-50 to-white p-5 dark:border-success-500/40 dark:from-success-500/10 dark:to-transparent"
                  >
                    <div className="mb-3 flex items-start gap-3">
                      <span aria-hidden="true" className="text-2xl">
                        🎓
                      </span>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-gray-800 dark:text-white/90">
                          {certificate.course_title}
                        </h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {certificate.exam_title} · issued{" "}
                          {new Date(certificate.issued_at).toLocaleDateString()}
                          {certificate.score !== null
                            ? ` · ${certificate.score}%`
                            : ""}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {/* A plain anchor, not a fetch: the session cookie rides
                          the navigation and the PDF goes straight to the
                          browser's viewer without being buffered in memory. */}
                      <a
                        href={certificateDownloadUrl(certificate.cert_exam_id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg bg-success-700 px-4 py-2 text-sm font-medium text-white hover:bg-success-800"
                      >
                        View PDF
                      </a>
                      <a
                        href={`/verify/${certificate.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03]"
                      >
                        Verification link
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold text-gray-800 dark:text-white/90">
              Certification exams
            </h2>
            {/* LOCKED ONES ARE SHOWN, NOT HIDDEN. A student who cannot yet sit
                an exam still needs to know it exists and what is left before
                it opens. Hiding it makes the course look like it has no
                certificate at all. */}
            {openExams.length === 0 ? (
              <div className="rounded-2xl border border-gray-200 bg-white shadow-raised p-6 dark:border-gray-800 dark:bg-white/[0.03]">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {exams.length === 0
                    ? "None of your courses has an exam yet. Enrol in one that does and it will show up here."
                    : "You have passed every exam in the courses you are enrolled in."}
                </p>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {openExams.map((exam) =>
                  exam.unlocked ? (
                    /* A real link with target=_blank rather than an onClick: it
                       still opens its own tab, but middle-click, ctrl-click and
                       the keyboard keep working. The exam takes over the whole
                       viewport once started, so giving it a tab of its own
                       leaves the course material where the student left it. */
                    <a
                      key={exam.id}
                      href={`/certification/${exam.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex flex-col rounded-2xl border border-gray-200 bg-white p-5 transition-[transform,box-shadow,border-color] duration-200 ease-[var(--ease-out-soft)] hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lifted dark:border-gray-800 dark:bg-white/[0.03] dark:hover:border-brand-800"
                    >
                      <p className="mb-1 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        {exam.course_title}
                      </p>
                      <h3 className="font-semibold text-gray-800 group-hover:text-brand-600 dark:text-white/90 dark:group-hover:text-brand-400">
                        {exam.title}
                      </h3>
                      <span className="mt-3 flex flex-wrap items-center gap-2">
                        <CertificationBadge
                          allowed={exam.default_max_attempts}
                        />
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {exam.pass_mark}% to pass
                        </span>
                      </span>
                      <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-brand-500 dark:text-brand-400">
                        Open exam
                        <span aria-hidden="true">↗</span>
                        <span className="sr-only">(opens in a new tab)</span>
                      </span>
                    </a>
                  ) : (
                    /* NOT A LINK. The paper and the submit route both refuse an
                       unfinished course, so a link here would lead to a red
                       sentence — the lock belongs where the student can see the
                       reason instead. */
                    <div
                      key={exam.id}
                      className="flex flex-col rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-white/[0.02]"
                    >
                      <p className="mb-1 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        {exam.course_title}
                      </p>
                      <h3 className="flex items-center gap-2 font-semibold text-gray-600 dark:text-gray-300">
                        <span aria-hidden="true">🔒</span>
                        {exam.title}
                      </h3>
                      <span className="mt-3 flex flex-wrap items-center gap-2">
                        <CertificationBadge
                          allowed={exam.default_max_attempts}
                        />
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {exam.pass_mark}% to pass
                        </span>
                      </span>
                      <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
                        {exam.locked_reason ??
                          "Finish the course to open this exam."}
                      </p>
                      <p className="mt-3 text-xs font-medium text-gray-500 dark:text-gray-400">
                        {exam.modules_completed} of {exam.modules_total} modules
                        completed
                      </p>
                    </div>
                  ),
                )}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
