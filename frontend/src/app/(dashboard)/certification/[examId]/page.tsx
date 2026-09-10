"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import PaywallNotice from "@/components/assessments/PaywallNotice";
import { type ExamProctor, useExamProctor } from "@/hooks/useExamProctor";
import { ApiError, errorText } from "@/lib/api";

import QuestionList from "@/components/assessments/QuestionList";
import {
  type CertAttempt,
  type CertExamDetail,
  type CertExamResult,
  type QuizQuestionForStudent,
  certificateDownloadUrl,
  getExam,
  getExamQuestions,
  listExamAttempts,
  submitExam,
} from "@/lib/assessments";
import { counted } from "@/lib/plural";
import {
  Skeleton,
  SkeletonPanel,
  SkeletonTiles,
} from "@/components/ui/Skeleton";
import { CertificationBadge } from "@/components/assessments/AssessmentBadge";

/**
 * Certification exam. Attempts are CAPPED.
 *
 * The remaining count shown here is display only — it comes from the server
 * and is re-derived there on every submission. Nothing on this screen is
 * trusted as a permission decision; submitting past the cap returns 403
 * regardless of what the UI believes.
 *
 * Two modes. The COVER shows the standing and the history and is where you
 * start from. Once started, the paper takes over the whole viewport in an
 * overlay and asks the browser for real fullscreen: this is the one capped,
 * one-shot assessment in the product, and answering it next to a sidebar full
 * of links to the course material is the wrong setting for it.
 */
export default function CertExamPage() {
  const { examId } = useParams<{ examId: string }>();

  const [exam, setExam] = useState<CertExamDetail | null>(null);
  const [attempts, setAttempts] = useState<CertAttempt[]>([]);
  const [questions, setQuestions] = useState<QuizQuestionForStudent[] | null>(
    null,
  );
  const [selections, setSelections] = useState<Record<string, number>>({});
  const [result, setResult] = useState<CertExamResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when the student presses Submit with questions left blank. The submit
  // does not go through until they press again.
  const [confirmingSubmit, setConfirmingSubmit] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // Set when the proctor ended the paper, so the result can say why.
  // Not a count and not a policy — just what happened, once.
  const [endedByLeaving, setEndedByLeaving] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      const [nextExam, nextAttempts] = await Promise.all([
        getExam(examId),
        listExamAttempts(examId),
      ]);
      setExam(nextExam);
      setAttempts(nextAttempts);
    } catch (caught) {
      // The object, not just its message: `PaywallNotice` needs the status to
      // tell "buy this" apart from "something went wrong", and the status only
      // survives on the ApiError itself.
      setLoadError(caught);
      setError(
        errorText(caught, "Could not load the exam."),
      );
    } finally {
      setLoading(false);
    }
  }, [examId]);

  useEffect(() => {
    void load();
  }, [load]);

  // The browser is the source of truth for fullscreen: the student can leave
  // it with Escape at any time and no event of ours would fire.
  useEffect(() => {
    const sync = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", sync);
    sync();
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  // Never strand the tab in fullscreen if the page unmounts mid-exam.
  useEffect(() => {
    return () => {
      if (document.fullscreenElement)
        void document.exitFullscreen().catch(() => {});
    };
  }, []);

  function requestFullscreen() {
    // Called straight from the click handler, not after an await: browsers
    // only grant fullscreen while a user gesture is still being processed.
    // Refusal is survivable — the overlay below is already full-viewport, so
    // the exam is distraction-free either way.
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen?.().catch(() => {});
    }
  }

  async function leaveFullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
    }
  }

  function handleStart() {
    requestFullscreen();
    setStarting(true);
    setError(null);
    void (async () => {
      try {
        setQuestions(await getExamQuestions(examId));
        setSelections({});
        setEndedByLeaving(false);
        setResult(null);
        setConfirmingSubmit(false);
        window.scrollTo({ top: 0 });
      } catch (caught) {
        await leaveFullscreen();
        setError(
          errorText(caught, "Could not start the exam."),
        );
      } finally {
        setStarting(false);
      }
    })();
  }

  async function handleSubmit(lapses?: number) {
    // Before anything else: this function exits fullscreen, and that fires the
    // same event a student switching tabs does. Waiting for `active` to go
    // false would be a race between a state update and a browser event.
    proctorRef.current?.pause();
    setSubmitting(true);
    setError(null);
    try {
      const answers = Object.entries(selections).map(
        ([question_id, selected]) => ({ question_id, selected }),
      );
      // The count goes with the submit so an admin can see it when a
      // mark is queried. It is never rendered on this screen.
      const nextResult = await submitExam(
        examId,
        answers,
        lapses,
        lapses !== undefined,
      );
      setResult(nextResult);
      setQuestions(null);
      setConfirmingSubmit(false);
      await leaveFullscreen();
      await load();
    } catch (caught) {
      setError(
        errorText(caught, "Could not submit the exam."),
      );
      // The attempt may still have been consumed; re-read the standing rather
      // than assuming.
      await load();
      // The paper is still open, so it is still an exam.
      proctorRef.current?.resume();
    } finally {
      setSubmitting(false);
    }
  }

  // Armed only while a paper is open, and reset every time one is — the
  // allowance is per attempt, not per student. `submitRef` breaks the
  // circular reference between the proctor and the handler it calls.
  const submitRef = useRef(handleSubmit);
  submitRef.current = handleSubmit;
  // Read back inside handlers declared above this line, which is why it is a
  // ref rather than the returned object used directly.
  const proctorRef = useRef<ExamProctor | null>(null);

  const proctor = useExamProctor({
    active: questions !== null && result === null,
    onLimitReached: (lapses) => {
      // Submitted as it stands. Saying nothing here and letting the
      // result screen appear would look like a bug; the result screen
      // itself explains what happened.
      setEndedByLeaving(true);
      void submitRef.current(lapses);
    },
  });
  proctorRef.current = proctor;
  const { warning, dismissWarning } = proctor;

  /** Abandon without submitting. Costs nothing — attempts are spent on submit. */
  async function handleLeave() {
    proctorRef.current?.pause();
    setQuestions(null);
    setSelections({});
    setConfirmingSubmit(false);
    setLeaving(false);
    await leaveFullscreen();
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-3 h-7 w-80" />
        </div>
        <SkeletonTiles />
        <SkeletonPanel lines={2} />
      </div>
    );
  }

  if (!exam) {
    // A locked course answers 402 on the cover now, exactly as it already did
    // on the paper. Before this the two disagreed: the cover loaded, the
    // student pressed Start, and only then were they told to buy the course.
    return (
      <div className="space-y-4">
        <PaywallNotice error={loadError} />
        {!(loadError instanceof ApiError && loadError.status === 402) ? (
          <div className="rounded-2xl border border-error-500 bg-error-50 p-4 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400">
            {error ?? "Exam not found."}
          </div>
        ) : null}
      </div>
    );
  }

  const { standing } = exam;
  const certificateUrl = certificateDownloadUrl(examId);
  const answeredCount = Object.keys(selections).length;
  const unanswered = questions ? questions.length - answeredCount : 0;

  // ---------------------------------------------------------------- exam mode
  if (questions) {
    return (
      <div className="fixed inset-0 z-999999 flex flex-col bg-white dark:bg-gray-900">
        {/* Header: what this is, how far in, and the way out. */}
        <header className="shrink-0 border-b border-gray-200 bg-white px-5 py-3 dark:border-gray-800 dark:bg-gray-900">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-semibold text-gray-800 dark:text-white/90">
                {exam.title}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Attempt {standing.used_attempts + 1} of{" "}
                {standing.allowed_attempts} · {answeredCount} of{" "}
                {questions.length} answered
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  isFullscreen ? void leaveFullscreen() : requestFullscreen()
                }
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-white/[0.03]"
              >
                {isFullscreen ? "Exit full screen" : "Full screen"}
              </button>
              <button
                type="button"
                onClick={() => setLeaving(true)}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-white/[0.03]"
              >
                Leave
              </button>
            </div>
          </div>

          {warning ? (
            // Shown every time they come back, in the same words. A sterner
            // second message would tell them a count is being kept and roughly
            // where they are in it, which is an invitation to spend the rest.
            <div
              role="alert"
              className="mx-auto mt-3 flex max-w-3xl flex-wrap items-center justify-between gap-3 rounded-2xl border border-warning-400 bg-warning-50 p-4 text-sm font-medium text-warning-900 dark:border-warning-500/50 dark:bg-warning-500/15 dark:text-warning-300"
            >
              <span>{warning}</span>
              <button
                type="button"
                onClick={dismissWarning}
                className="shrink-0 rounded-lg border border-warning-400 px-3 py-1.5 text-xs font-semibold text-warning-900 transition hover:bg-warning-100 dark:border-warning-500/50 dark:text-warning-300 dark:hover:bg-warning-500/20"
              >
                Continue
              </button>
            </div>
          ) : null}

          {/* Jump to any question; filled means answered. Useful precisely
              because submitting with blanks is what costs an attempt. */}
          <div className="mx-auto mt-3 flex max-w-3xl flex-wrap gap-1.5">
            {questions.map((question, index) => {
              const done = selections[question.id] !== undefined;
              return (
                <button
                  key={question.id}
                  type="button"
                  aria-label={`Question ${index + 1}${done ? ", answered" : ", not answered"}`}
                  onClick={() =>
                    document
                      .getElementById(`q-${index}`)
                      ?.scrollIntoView({ behavior: "smooth", block: "start" })
                  }
                  className={`h-7 w-7 rounded-md text-xs font-medium transition ${
                    done
                      ? "bg-brand-500 text-white hover:bg-brand-600"
                      : "border border-gray-300 text-gray-500 hover:border-brand-400 dark:border-gray-700 dark:text-gray-400"
                  }`}
                >
                  {index + 1}
                </button>
              );
            })}
          </div>
        </header>

        {/* The paper */}
        <div className="flex-1 overflow-y-auto px-5 py-6">
          <div className="mx-auto max-w-3xl">
            {error ? (
              <div className="mb-5 rounded-xl border border-error-500 bg-error-50 p-4 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400">
                {error}
              </div>
            ) : null}
            <QuestionList
              questions={questions}
              selections={selections}
              onSelect={(questionId, index) =>
                setSelections((current) => ({
                  ...current,
                  [questionId]: index,
                }))
              }
              disabled={submitting}
              idPrefix="q"
              highlightUnanswered={confirmingSubmit}
            />
          </div>
        </div>

        {/* Submit stays in reach without scrolling to the bottom. */}
        <footer className="shrink-0 border-t border-gray-200 bg-white px-5 py-4 dark:border-gray-800 dark:bg-gray-900">
          <div className="mx-auto max-w-3xl">
            {unanswered > 0 && confirmingSubmit ? (
              <div className="mb-3 rounded-xl border border-warning-300 bg-warning-25 p-3 dark:border-warning-800 dark:bg-warning-500/10">
                <p className="text-sm font-medium text-warning-700 dark:text-warning-400">
                  {counted(unanswered, "question")} still unanswered, marked in
                  the paper above.
                </p>
                <p className="mt-0.5 text-sm text-warning-700 dark:text-warning-400">
                  Submitting now uses one of your{" "}
                  {counted(standing.remaining_attempts, "remaining attempt")}{" "}
                  and scores the blanks wrong.
                </p>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  if (unanswered > 0 && !confirmingSubmit) {
                    setConfirmingSubmit(true);
                    document
                      .getElementById(
                        `q-${questions.findIndex((q) => selections[q.id] === undefined)}`,
                      )
                      ?.scrollIntoView({ behavior: "smooth", block: "center" });
                    return;
                  }
                  void handleSubmit();
                }}
                disabled={submitting}
                className={`rounded-lg px-6 py-2.5 text-sm font-medium text-white disabled:opacity-50 ${
                  unanswered > 0 && confirmingSubmit
                    ? "bg-warning-500 hover:bg-warning-600"
                    : "bg-brand-500 hover:bg-brand-600"
                }`}
              >
                {submitting
                  ? "Submitting…"
                  : unanswered > 0 && confirmingSubmit
                    ? "Submit anyway"
                    : "Submit exam"}
              </button>

              {confirmingSubmit && unanswered > 0 && !submitting ? (
                <button
                  type="button"
                  onClick={() => setConfirmingSubmit(false)}
                  className="rounded-lg border border-gray-300 px-6 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03]"
                >
                  Keep answering
                </button>
              ) : null}

              <span className="text-sm text-gray-500 dark:text-gray-400">
                Submitting uses one attempt.{" "}
                {counted(standing.remaining_attempts, "attempt")} left.
              </span>
            </div>
          </div>
        </footer>

        {/* Leaving is free, but the answers go — so say so once. */}
        {leaving ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-900/50 p-5">
            <div className="w-full max-w-sm rounded-2xl bg-white p-6 dark:bg-gray-800">
              <h2 className="mb-2 font-semibold text-gray-800 dark:text-white/90">
                Leave the exam?
              </h2>
              <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
                This costs you nothing. An attempt is only used when you submit.
                Your {counted(answeredCount, "answer")} so far will be
                discarded.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => void handleLeave()}
                  className="rounded-lg bg-error-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-error-800"
                >
                  Leave
                </button>
                <button
                  type="button"
                  onClick={() => setLeaving(false)}
                  className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03]"
                >
                  Stay
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  // -------------------------------------------------------------------- cover
  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/certification"
          className="mb-2 inline-block text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400"
        >
          ← All exams
        </Link>
        <h1 className="mb-1 text-title-sm font-bold text-gray-800 dark:text-white/90">
          {exam.title}
        </h1>
        <CertificationBadge
          allowed={standing.allowed_attempts}
          remaining={standing.remaining_attempts}
        />
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          {exam.question_count} questions. Every submitted attempt counts,
          whether you pass or fail.
        </p>
      </div>

      {error ? (
        <div className="rounded-2xl border border-error-500 bg-error-50 p-4 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400">
          {error}
        </div>
      ) : null}

      {/* Attempt standing */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { label: "Attempts allowed", value: standing.allowed_attempts },
          { label: "Used", value: standing.used_attempts },
          { label: "Remaining", value: standing.remaining_attempts },
          { label: "Granted by admin", value: standing.granted_attempts },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-2xl border border-gray-200 bg-white shadow-raised p-4 text-center dark:border-gray-800 dark:bg-white/[0.03]"
          >
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {item.label}
            </p>
            <p className="mt-1 text-title-sm font-bold text-gray-800 dark:text-white/90">
              {item.value}
            </p>
          </div>
        ))}
      </div>

      {standing.passed ? (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-success-300 bg-success-25 p-5 dark:border-success-800 dark:bg-success-500/10">
          <div>
            <p className="font-semibold text-success-700 dark:text-success-400">
              Certificate issued
            </p>
            <p className="text-sm text-success-700 dark:text-success-400">
              You passed this exam
              {standing.certificate_issued_at
                ? ` on ${new Date(standing.certificate_issued_at).toLocaleDateString()}`
                : ""}
              .
            </p>
          </div>
          {/* A plain link, not a fetch: the endpoint streams a PDF and the
              session cookie rides along, so the browser's own viewer handles
              it without the page having to buffer the file in memory. */}
          <a
            href={certificateUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded-lg bg-success-600 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-success-700"
          >
            Download certificate
          </a>
        </div>
      ) : null}

      {!standing.can_attempt ? (
        <div className="rounded-2xl border border-error-300 bg-error-25 p-5 dark:border-error-800 dark:bg-error-500/10">
          <p className="font-semibold text-error-700 dark:text-error-400">
            No attempts remaining
          </p>
          <p className="text-sm text-error-700 dark:text-error-400">
            You have used all {standing.allowed_attempts} attempts. Contact an
            admin to request more.
          </p>
        </div>
      ) : null}

      {/* Result of the attempt just submitted */}
      {result ? (
        <div className="rounded-2xl border border-gray-200 bg-white shadow-raised p-6 text-center dark:border-gray-800 dark:bg-white/[0.03]">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Attempt #{result.attempt.attempt_number}
          </p>
          {endedByLeaving ? (
            // WHY it ended, not the rule behind it. A student who is simply
            // shown a score they did not press Submit for has no idea what
            // happened, and that is the complaint an admin cannot answer.
            // What is deliberately absent: how many lapses were allowed, how
            // many were used, and that this cost them the attempt.
            <p className="mx-auto mt-2 max-w-md rounded-lg bg-warning-50 px-4 py-2 text-sm text-warning-900 dark:bg-warning-500/15 dark:text-warning-300">
              This attempt was submitted because you left the exam.
            </p>
          ) : null}
          <p className="my-2 text-title-md font-bold text-gray-800 dark:text-white/90">
            {result.attempt.score}%
          </p>
          <p
            className={`text-sm font-medium ${
              result.attempt.passed
                ? "text-success-600 dark:text-success-400"
                : "text-error-600 dark:text-error-400"
            }`}
          >
            {result.attempt.passed ? "Passed" : "Not passed"}
          </p>
          {result.certificate_issued ? (
            <p className="mt-2 text-sm text-success-600 dark:text-success-400">
              Your certificate has been issued.
            </p>
          ) : null}
          {/* No per-question review here, unlike quizzes: attempts are limited,
              so handing back the answer key would devalue the ones remaining. */}
        </div>
      ) : null}

      {standing.can_attempt ? (
        <div className="rounded-2xl border border-gray-200 bg-white shadow-raised p-6 dark:border-gray-800 dark:bg-white/[0.03]">
          <p className="mb-1 text-sm text-gray-600 dark:text-gray-300">
            {/* Kept, and kept short. This is the one fact that stops a
                student hesitating to open the paper, and the exam takes over
                the screen the moment they do — which is worth a warning. */}
            An attempt is only used when you submit. The exam opens full screen;
            you can leave any time before submitting.
          </p>
          <button
            type="button"
            onClick={handleStart}
            disabled={starting}
            className="rounded-lg bg-brand-500 px-6 py-2.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {starting ? "Loading…" : "Start exam"}
          </button>
        </div>
      ) : null}

      {attempts.length > 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white shadow-raised p-6 dark:border-gray-800 dark:bg-white/[0.03]">
          <h2 className="mb-3 text-base font-semibold text-gray-800 dark:text-white/90">
            Attempt history
          </h2>
          <ul className="space-y-2">
            {attempts.map((attempt) => (
              <li
                key={attempt.id}
                className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-2 text-sm dark:bg-white/[0.03]"
              >
                <span className="text-gray-600 dark:text-gray-400">
                  Attempt #{attempt.attempt_number} ·{" "}
                  {new Date(attempt.ts).toLocaleString()}
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-medium text-gray-800 dark:text-white/90">
                    {attempt.score}%
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      attempt.passed
                        ? "bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-400"
                        : "bg-error-50 text-error-700 dark:bg-error-500/15 dark:text-error-400"
                    }`}
                  >
                    {attempt.passed ? "Passed" : "Failed"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
