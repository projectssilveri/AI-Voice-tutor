"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import TranscriptFeed from "@/components/voice-session/TranscriptFeed";
import VoiceAvatar from "@/components/voice-session/VoiceAvatar";
import { useVoiceSession } from "@/components/voice-session/useVoiceSession";
import {
  type ModuleDetail,
  type ModuleSummary,
  type ProgressStatus,
  getCourse,
  getModule,
  setModuleProgress,
} from "@/lib/student";
import ModuleMaterials from "@/components/assessments/ModuleMaterials";
import { counted } from "@/lib/plural";
import { errorText } from "@/lib/api";

/**
 * The module lecture — the product's core screen.
 *
 * The tutor is grounded in this module's content server-side; the client only
 * names the module. The transcript beside the avatar is the text backup the
 * brief calls for, and interrupted turns are marked so barge-in is visible
 * rather than something you have to take on trust.
 */
export default function ModuleVoicePage() {
  const params = useParams<{ courseId: string; moduleId: string }>();
  const { courseId, moduleId } = params;

  const [module, setModule] = useState<ModuleDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressStatus>("not_started");
  const [savingProgress, setSavingProgress] = useState(false);
  // The whole course's modules, in order — so this page can offer the next one
  // instead of sending the student back to the course list every time.
  const [siblings, setSiblings] = useState<ModuleSummary[]>([]);
  // What the tutor allows on this course, and how much of it this student has
  // used on THIS module. Both come from the course endpoint the siblings
  // already come from, so showing them costs no extra request.
  const [tutorAllowance, setTutorAllowance] = useState<{
    plays: number;
    minutes: number;
  } | null>(null);

  const {
    state,
    error,
    supersededMessage,
    transcript,
    aiLevel,
    micLevel,
    getAnalysers,
    noiseSuppressed,
    interruptCount,
    start,
    stop,
  } = useVoiceSession({ moduleId });

  const loadProgress = useCallback(async () => {
    // The module endpoint returns the content, not this student's progress;
    // the course listing is where per-module status lives — and where the
    // neighbouring modules come from, at no extra request.
    const course = await getCourse(courseId);
    setSiblings(course.modules);
    setTutorAllowance({
      plays: course.effective_ai_sessions_per_module,
      minutes: course.effective_ai_session_minutes,
    });
    const row = course.modules.find((m) => m.id === moduleId);
    if (row) setProgress(row.status);
  }, [courseId, moduleId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await getModule(moduleId);
        if (cancelled) return;
        setModule(next);
        await loadProgress();
      } catch (caught) {
        if (!cancelled) {
          setLoadError(
            errorText(caught, "Could not load this module."),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [moduleId, loadProgress]);

  // A session that ran long enough completes the module server-side, so the
  // status is re-read when one ENDS rather than guessed at here.
  //
  // Keyed on the transition, not on `state === "idle"`: idle is also the
  // starting value, so testing the value alone fired this on mount too and
  // fetched the course twice on every page load.
  const previousState = useRef(state);
  useEffect(() => {
    const wasRunning =
      previousState.current !== "idle" && previousState.current !== "error";
    previousState.current = state;
    if (wasRunning && state === "idle") {
      void loadProgress().catch(() => {
        // A stale badge is not worth an error banner over.
      });
    }
  }, [state, loadProgress]);

  async function toggleComplete() {
    setSavingProgress(true);
    try {
      const next = progress === "completed" ? "in_progress" : "completed";
      const saved = await setModuleProgress(moduleId, next);
      setProgress(saved.status);
    } catch (caught) {
      setLoadError(
        errorText(caught, "Could not save progress."),
      );
    } finally {
      setSavingProgress(false);
    }
  }

  const running =
    state !== "idle" && state !== "error" && state !== "superseded";

  const position = siblings.findIndex((m) => m.id === moduleId);
  const previousModule = position > 0 ? siblings[position - 1] : null;
  const nextModule =
    position >= 0 && position < siblings.length - 1
      ? siblings[position + 1]
      : null;
  const completedCount = siblings.filter(
    (m) => m.status === "completed",
  ).length;

  // HOW MANY TUTOR PLAYS ARE LEFT ON THIS MODULE.
  //
  // Null while the course is still loading, so the button is not disabled on a
  // count that has not arrived — a Start button that is dead for the first
  // second of every page load reads as broken. Clamped at zero because a
  // course whose limit was lowered below what somebody already used would
  // otherwise show a negative.
  const thisModule = siblings.find((m) => m.id === moduleId);
  const playsLeft =
    tutorAllowance && thisModule
      ? Math.max(0, tutorAllowance.plays - thisModule.tutor_sessions_used)
      : null;

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
          <Link
            href={`/learn/${courseId}`}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400"
          >
            ← Back to course
          </Link>
          {position >= 0 && siblings.length > 0 ? (
            <span className="text-gray-500 dark:text-gray-400">
              Module {position + 1} of {siblings.length}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-3">
              <h1 className="text-title-sm font-bold text-gray-800 dark:text-white/90">
                {module?.title ?? "Loading…"}
              </h1>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  progress === "completed"
                    ? "bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-400"
                    : progress === "in_progress"
                      ? "bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-orange-400"
                      : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                }`}
              >
                {progress === "completed"
                  ? "Completed"
                  : progress === "in_progress"
                    ? "In progress"
                    : "Not started"}
              </span>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              The tutor lectures on this module. Talk over it whenever you have
              a question.
            </p>
          </div>
          {/* The only control up here. Quiz and assignment are reached from
              the course curriculum dropdown, which is where every part of a
              module is listed together — duplicating two of them beside the
              heading made this page the second, incomplete menu. */}
          <div className="flex shrink-0 gap-3">
            {/* Completing never locks anything — the tutor and the material
                stay open, so this is safe to toggle either way. */}
            <button
              type="button"
              onClick={toggleComplete}
              disabled={savingProgress}
              className={`rounded-lg px-5 py-2.5 text-sm font-medium transition disabled:opacity-50 ${
                progress === "completed"
                  ? "border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03]"
                  : "bg-success-700 text-white hover:bg-success-800"
              }`}
            >
              {savingProgress
                ? "Saving…"
                : progress === "completed"
                  ? "Mark as unfinished"
                  : "Mark as complete"}
            </button>
          </div>
        </div>
      </div>

      {loadError ? (
        <div className="rounded-2xl border border-error-500 bg-error-50 p-4 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400">
          {loadError}
        </div>
      ) : null}
      {supersededMessage ? (
        // Not an error banner: nothing failed. The student opened this lesson
        // somewhere else and this tab stood down, so it says that and offers
        // the one thing they might want — to carry on here instead.
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warning-300 bg-warning-50 p-4 text-sm text-warning-900 dark:border-warning-500/40 dark:bg-warning-500/10 dark:text-warning-300">
          <span>{supersededMessage}</span>
          <button
            type="button"
            onClick={start}
            className="shrink-0 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-600"
          >
            Carry on in this tab
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-error-500 bg-error-50 p-4 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400">
          {error}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-gray-200 bg-white shadow-raised p-6 dark:border-gray-800 dark:bg-white/[0.03]">
          {/* Where am I, visible DURING the session.
              The heading above scrolls away and the overlay is the whole
              screen once a lecture is running, so without this the student has
              no anchor mid-call — and reconnecting here costs more than
              scrubbing a video back does. */}
          {position >= 0 && siblings.length > 0 ? (
            <div className="mb-5">
              <div className="mb-2 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                {/* Deliberately NOT "Module N of M" again — the page heading
                    directly above already says that, and the number this panel
                    adds is the one it does not: how far through the course you
                    are. */}
                <span className="truncate pr-3">{module?.title ?? ""}</span>
                <span className="shrink-0 font-medium text-gray-700 dark:text-gray-300">
                  {completedCount} of {siblings.length} modules done
                </span>
              </div>
              <div
                className="flex gap-1"
                role="img"
                aria-label={`Module ${position + 1} of ${siblings.length}, ${completedCount} of ${siblings.length} completed`}
              >
                {/* COLOUR MEANS COMPLETION. NOTHING ELSE.
                    This used to test `index === position` first, so the module
                    you were reading rendered blue even when it was finished —
                    the bar showed three green and one blue while the label
                    beside it read "4 of 4 modules done". Two facts were fighting
                    over one channel.

                    Position now has its own: a ring around the current
                    segment, which composes with any colour instead of
                    replacing it. */}
                {siblings.map((sibling, index) => (
                  <span
                    key={sibling.id}
                    className={`h-1.5 flex-1 rounded-full ${
                      sibling.status === "completed"
                        ? "bg-success-500"
                        : sibling.status === "in_progress"
                          ? "bg-warning-400"
                          : "bg-gray-200 dark:bg-gray-700"
                    } ${
                      index === position
                        ? "ring-2 ring-brand-500 ring-offset-2 ring-offset-white dark:ring-offset-gray-900"
                        : ""
                    }`}
                  />
                ))}
              </div>
            </div>
          ) : null}

          <VoiceAvatar
            state={state}
            aiLevel={aiLevel}
            micLevel={micLevel}
            getAnalysers={getAnalysers}
            noiseSuppressed={noiseSuppressed}
          />

          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={running ? stop : start}
              disabled={!running && playsLeft === 0}
              className={`rounded-lg px-6 py-3 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-40 ${
                running
                  ? "bg-error-500 hover:bg-error-600"
                  : "bg-brand-500 hover:bg-brand-600"
              }`}
            >
              {running
                ? "End session"
                : playsLeft === 0
                  ? "No sessions left"
                  : "Start session"}
            </button>
          </div>

          {/* WHAT IS LEFT, before it is spent rather than after. The server
              refuses a session past the cap either way; being told at the
              point of pressing is the difference between a rule and a
              surprise. */}
          {tutorAllowance && playsLeft !== null ? (
            <p className="mt-3 text-center text-sm text-gray-500 dark:text-gray-400">
              {tutorAllowance.plays === 0 ? (
                "The voice tutor is switched off for this course."
              ) : playsLeft === 0 ? (
                <>
                  You have used all{" "}
                  {counted(tutorAllowance.plays, "tutor session")} for this
                  module. The material, quiz and assignment are unaffected.
                </>
              ) : (
                <>
                  {counted(playsLeft, "session")} left on this module, out of{" "}
                  {tutorAllowance.plays}. Each runs up to{" "}
                  {tutorAllowance.minutes} minutes.
                </>
              )}
            </p>
          ) : null}

          <p className="mt-4 text-center text-sm text-gray-500 dark:text-gray-400">
            Interruptions:{" "}
            <span className="font-mono font-semibold text-gray-800 dark:text-white/90">
              {interruptCount}
            </span>
          </p>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white shadow-raised p-6 dark:border-gray-800 dark:bg-white/[0.03]">
          <h2 className="mb-3 text-base font-semibold text-gray-800 dark:text-white/90">
            Transcript
          </h2>
          <TranscriptFeed transcript={transcript} />
        </div>
      </div>

      {/* Directly under the lecture: the same lesson, written down. Reading
          is unlimited and never gated — the brief is explicit that only
          certification attempts are capped. */}
      <ModuleMaterials moduleId={moduleId} notes={module?.content} />

      {/* Move through the course without going back to the list each time.
          Finishing a module and having nowhere to go but "Back to course" is
          the reason a student loses their place. */}
      {siblings.length > 1 ? (
        <div className="flex flex-wrap items-stretch justify-between gap-4 border-t border-gray-200 pt-6 dark:border-gray-800">
          {previousModule ? (
            <Link
              href={`/learn/${courseId}/${previousModule.id}`}
              className="group flex max-w-xs flex-1 flex-col rounded-xl border border-gray-200 px-5 py-3 transition hover:border-brand-300 hover:bg-brand-25 dark:border-gray-800 dark:hover:border-brand-700 dark:hover:bg-brand-500/10"
            >
              <span className="text-xs text-gray-500 dark:text-gray-400">
                ← Previous
              </span>
              <span className="mt-0.5 font-medium text-gray-800 group-hover:text-brand-600 dark:text-white/90 dark:group-hover:text-brand-400">
                {previousModule.title}
              </span>
            </Link>
          ) : (
            <span />
          )}

          {nextModule ? (
            <Link
              href={`/learn/${courseId}/${nextModule.id}`}
              className="group flex max-w-xs flex-1 flex-col rounded-xl border border-brand-300 bg-brand-25 px-5 py-3 text-right transition hover:bg-brand-50 dark:border-brand-700 dark:bg-brand-500/10 dark:hover:bg-brand-500/20"
            >
              <span className="text-xs text-brand-600 dark:text-brand-400">
                Next module →
              </span>
              <span className="mt-0.5 font-medium text-gray-800 dark:text-white/90">
                {nextModule.title}
              </span>
            </Link>
          ) : (
            // Last module: the useful next step is the exam, not another module.
            <Link
              href="/certification"
              className="group flex max-w-xs flex-1 flex-col rounded-xl border border-success-300 bg-success-25 px-5 py-3 text-right transition hover:bg-success-50 dark:border-success-800 dark:bg-success-500/10 dark:hover:bg-success-500/20"
            >
              <span className="text-xs text-success-700 dark:text-success-400">
                Last module →
              </span>
              <span className="mt-0.5 font-medium text-gray-800 dark:text-white/90">
                Go to certification
              </span>
            </Link>
          )}
        </div>
      ) : null}
    </div>
  );
}
