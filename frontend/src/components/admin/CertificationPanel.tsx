"use client";

import { useCallback, useEffect, useState } from "react";

import {
  type CertExam,
  createCourseExam,
  listCourseExams,
} from "@/lib/assessments";
import { errorText } from "@/lib/api";
import { counted } from "@/lib/plural";
import { getCourse } from "@/lib/student";

/**
 * Whether this course issues a certificate, and setting one up if it does not.
 *
 * NOTHING ON THE AUTHORING SIDE MENTIONED CERTIFICATION AT ALL. The API has
 * been able to create an exam since certification was built, and no screen ever
 * called it — so an author could write a whole course, publish it, and have no
 * way to tell whether a certificate existed at the end of it or how to add one.
 * A tester found exactly that and filed issues 72, 73 and 74.
 *
 * WHERE THE QUESTIONS COME FROM. Not from here, and that surprises people. A
 * certification exam is drawn from the quiz questions already written on the
 * course's modules, so the way to add exam questions is to write module
 * quizzes. This panel says so rather than offering a question editor that would
 * quietly write to the same place.
 */
export default function CertificationPanel({
  courseId,
  courseTitle,
  moduleCount,
}: {
  courseId: string;
  courseTitle: string;
  moduleCount: number;
}) {
  const [exams, setExams] = useState<CertExam[] | null>(null);
  // HOW MANY QUESTIONS THE EXAM WOULD ACTUALLY HAVE. Read here rather than
  // threaded down as a prop: the authoring endpoints return modules without
  // their quiz counts, and one request on one admin screen is a better trade
  // than widening an API shape for a single badge.
  const [quizQuestionCount, setQuizQuestionCount] = useState(0);
  const [creating, setCreating] = useState(false);
  const [attempts, setAttempts] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setExams(await listCourseExams(courseId));
      setError(null);
    } catch (caught) {
      setError(errorText(caught, "Could not read the certification setup."));
      setExams([]);
    }
  }, [courseId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    getCourse(courseId)
      .then((course) => {
        if (cancelled) return;
        setQuizQuestionCount(
          course.modules.reduce((sum, m) => sum + m.quiz_questions, 0),
        );
      })
      .catch(() => {
        // The count only drives a warning. Failing to read it must not stop
        // the panel saying whether certification is on.
      });
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  async function create() {
    setCreating(true);
    try {
      await createCourseExam(courseId, {
        title: `${courseTitle} Certification`,
        // Blank means "use the platform default", which the server decides.
        // Sending a number the screen invented would freeze today's default
        // into every exam made from here.
        default_max_attempts: attempts ? Number(attempts) : null,
      });
      setAttempts("");
      await load();
    } catch (caught) {
      setError(errorText(caught, "Could not create the exam."));
    } finally {
      setCreating(false);
    }
  }

  const exam = exams?.[0] ?? null;

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-raised dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="border-b border-gray-200 px-6 py-4 dark:border-gray-800">
        <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">
          Certification
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Whether a student earns a certificate for finishing this course.
        </p>
      </div>

      <div className="px-6 py-5">
        {error ? (
          <p
            role="alert"
            className="mb-4 rounded-lg border border-error-500 bg-error-50 px-3 py-2 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400"
          >
            {error}
          </p>
        ) : null}

        {exams === null ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
        ) : exam ? (
          <>
            {/* ISSUE 74 asks to be able to SEE whether certification is on. It
                is the first thing here, stated rather than inferred. */}
            <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-success-50 px-3 py-1 text-sm font-medium text-success-700 dark:bg-success-500/15 dark:text-success-400">
              <span aria-hidden="true">✓</span>
              Certification is on for this course
            </p>
            <dl className="grid gap-3 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-gray-500 dark:text-gray-400">
                  Exam
                </dt>
                <dd className="text-sm font-medium text-gray-800 dark:text-white/90">
                  {exam.title}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500 dark:text-gray-400">
                  Attempts allowed
                </dt>
                <dd className="text-sm font-medium text-gray-800 dark:text-white/90">
                  {exam.default_max_attempts}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500 dark:text-gray-400">
                  Pass mark
                </dt>
                <dd className="text-sm font-medium text-gray-800 dark:text-white/90">
                  {exam.pass_mark}%
                </dd>
              </div>
            </dl>

            {/* The failure mode nobody would guess at: an exam with no
                questions behind it. It exists, it is switched on, and the
                first student to reach it gets an error. */}
            {quizQuestionCount === 0 ? (
              <p className="mt-4 rounded-lg border border-warning-300 bg-warning-50 px-3 py-2 text-sm text-warning-800 dark:border-warning-500/40 dark:bg-warning-500/10 dark:text-warning-400">
                This exam has no questions yet. Exam questions come from the
                practice quizzes on this course&rsquo;s modules, and there are
                none, so a student reaching the exam would find it empty.
              </p>
            ) : (
              <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
                Drawn from {counted(quizQuestionCount, "quiz question")} across
                this course&rsquo;s modules. To change the exam, change those.
              </p>
            )}
          </>
        ) : (
          <>
            <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
              <span aria-hidden="true">○</span>
              No certificate for this course
            </p>
            <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
              Students can finish the course, but there is no exam to sit and no
              certificate at the end. Adding one draws its questions from the
              practice quizzes on this course&rsquo;s modules.
            </p>

            {moduleCount === 0 ? (
              <p className="rounded-lg border border-warning-300 bg-warning-50 px-3 py-2 text-sm text-warning-800 dark:border-warning-500/40 dark:bg-warning-500/10 dark:text-warning-400">
                Add a module first. An exam over a course with nothing in it has
                no questions to ask.
              </p>
            ) : (
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label
                    htmlFor="cert-attempts"
                    className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
                  >
                    Attempts allowed
                  </label>
                  <input
                    id="cert-attempts"
                    type="number"
                    min={1}
                    max={10}
                    value={attempts}
                    onChange={(event) => setAttempts(event.target.value)}
                    placeholder="Default"
                    className="h-11 w-32 rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void create()}
                  disabled={creating}
                  className="h-11 rounded-lg bg-brand-500 px-5 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-50"
                >
                  {creating ? "Adding…" : "Add certification"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
