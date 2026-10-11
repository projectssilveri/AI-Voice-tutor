"use client";

import { useCallback, useEffect, useState } from "react";

import { Action } from "@/components/ui/Action";
import { errorText } from "@/lib/api";
import {
  type OrgAssignment,
  type OrgCertExam,
  type OrgModule,
  type OrgQuizQuestion,
  createOrgAssignment,
  createOrgCertExam,
  createOrgQuizQuestion,
  deleteOrgAssignment,
  deleteOrgQuizQuestion,
  listOrgAssignments,
  listOrgCertExams,
  listOrgModules,
  listOrgQuizQuestions,
} from "@/lib/orgPortal";

const FIELD =
  "w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

/**
 * Quiz questions, assignments and a certification exam for one org course.
 *
 * The assessment layer was platform-staff only, so an org course could have
 * modules but no way to test or certify anyone on them. An org admin builds
 * these here; the backend scopes every call to this organisation's own course
 * (`routers/org_content.py`). Students take them through the ordinary module
 * screens once they exist.
 */
export default function OrgCourseAssessments({
  slug,
  courseId,
}: {
  slug: string;
  courseId: string;
}) {
  const [modules, setModules] = useState<OrgModule[]>([]);
  const [exams, setExams] = useState<OrgCertExam[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [m, e] = await Promise.all([
        listOrgModules(slug, courseId),
        listOrgCertExams(slug, courseId),
      ]);
      setModules(m);
      setExams(e);
      setError(null);
    } catch (caught) {
      setError(errorText(caught, "Could not load assessments."));
    }
  }, [slug, courseId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addExam() {
    const title = window.prompt(
      "Name the certification exam (its questions are the course's quiz questions):",
      "Course Certification",
    );
    if (!title || !title.trim()) return;
    setBusy(true);
    try {
      await createOrgCertExam(slug, courseId, { title: title.trim() });
      await load();
      setError(null);
    } catch (caught) {
      setError(errorText(caught, "Could not add the exam."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-5 border-t border-gray-200 pt-4 dark:border-gray-800">
      {error ? (
        <p className="rounded-lg border border-error-500 bg-error-50 px-3 py-2 text-xs text-error-700 dark:bg-error-500/10 dark:text-error-400">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-gray-800 dark:text-white/90">
            Certification
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {exams.length > 0
              ? exams.map((e) => e.title).join(", ")
              : "No exam yet. Add quiz questions to the modules, then add an exam."}
          </p>
        </div>
        <Action size="sm" variant="secondary" onClick={addExam} disabled={busy}>
          Add certification exam
        </Action>
      </div>

      <div className="space-y-4">
        <p className="text-sm font-semibold text-gray-800 dark:text-white/90">
          Quiz &amp; assignment, per module
        </p>
        {modules.length === 0 ? (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Add a module first, then come back to give it questions.
          </p>
        ) : (
          modules.map((m) => (
            <ModuleAssessments
              key={m.id}
              slug={slug}
              courseId={courseId}
              module={m}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ModuleAssessments({
  slug,
  courseId,
  module: mod,
}: {
  slug: string;
  courseId: string;
  module: OrgModule;
}) {
  const [questions, setQuestions] = useState<OrgQuizQuestion[]>([]);
  const [assignment, setAssignment] = useState<OrgAssignment | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // add-question form
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState("");
  const [correct, setCorrect] = useState("1");
  // add-assignment form
  const [aTitle, setATitle] = useState("");
  const [aPrompt, setAPrompt] = useState("");
  const [aAnswers, setAAnswers] = useState("");

  const load = useCallback(async () => {
    try {
      const [qs, as] = await Promise.all([
        listOrgQuizQuestions(slug, courseId, mod.id),
        listOrgAssignments(slug, courseId, mod.id),
      ]);
      setQuestions(qs);
      setAssignment(as[0] ?? null);
      setErr(null);
    } catch (caught) {
      setErr(errorText(caught, "Could not load this module's assessments."));
    }
  }, [slug, courseId, mod.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setErr(null);
    try {
      await work();
      await load();
    } catch (caught) {
      setErr(errorText(caught, "That did not work."));
    } finally {
      setBusy(false);
    }
  }

  function addQuestion() {
    const options = opts
      .split("\n")
      .map((o) => o.trim())
      .filter(Boolean);
    if (!q.trim() || options.length < 2) {
      setErr("Write the question and at least two options (one per line).");
      return;
    }
    const idx = Number(correct) - 1; // shown 1-based
    if (!Number.isInteger(idx) || idx < 0 || idx >= options.length) {
      setErr("The correct answer number must point at one of the options.");
      return;
    }
    void run(async () => {
      await createOrgQuizQuestion(slug, courseId, mod.id, {
        question: q.trim(),
        options,
        correct_answer: idx,
      });
      setQ("");
      setOpts("");
      setCorrect("1");
    });
  }

  function addAssignment() {
    const accepted = aAnswers
      .split("\n")
      .map((a) => a.trim())
      .filter(Boolean);
    if (!aTitle.trim() || !aPrompt.trim() || accepted.length === 0) {
      setErr("Give the assignment a title, a prompt, and at least one accepted answer.");
      return;
    }
    void run(async () => {
      await createOrgAssignment(slug, courseId, mod.id, {
        title: aTitle.trim(),
        prompt: aPrompt.trim(),
        accepted_answers: accepted,
      });
      setATitle("");
      setAPrompt("");
      setAAnswers("");
    });
  }

  return (
    <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
      <p className="mb-2 text-sm font-medium text-gray-800 dark:text-white/90">
        {mod.order + 1}. {mod.title}
      </p>
      {err ? (
        <p className="mb-2 text-xs text-error-600 dark:text-error-400">{err}</p>
      ) : null}

      {/* Quiz questions */}
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        Quiz ({questions.length})
      </p>
      <ul className="mb-2 space-y-1">
        {questions.map((item) => (
          <li
            key={item.id}
            className="flex items-center justify-between gap-2 text-xs text-gray-700 dark:text-gray-300"
          >
            <span className="truncate">
              {item.question}{" "}
              <span className="text-gray-400">
                (answer: {item.options[item.correct_answer]})
              </span>
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(() =>
                  deleteOrgQuizQuestion(slug, courseId, mod.id, item.id),
                )
              }
              className="shrink-0 text-error-600 hover:underline disabled:opacity-50 dark:text-error-400"
            >
              remove
            </button>
          </li>
        ))}
      </ul>
      <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Question"
          aria-label="Question"
          className={FIELD}
        />
        <textarea
          value={opts}
          onChange={(e) => setOpts(e.target.value)}
          placeholder="Options, one per line"
          aria-label="Options, one per line"
          rows={2}
          className={FIELD}
        />
        <div className="flex items-end gap-2">
          <input
            value={correct}
            onChange={(e) => setCorrect(e.target.value)}
            type="number"
            min={1}
            aria-label="Correct option number"
            title="Which option is correct (1 = first line)"
            className={`${FIELD} w-16`}
          />
          <Action size="sm" onClick={addQuestion} loading={busy}>
            Add
          </Action>
        </div>
      </div>

      {/* Assignment */}
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        Assignment
      </p>
      {assignment ? (
        <div className="mb-2 flex items-center justify-between gap-2 text-xs text-gray-700 dark:text-gray-300">
          <span className="truncate">{assignment.title}</span>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(() =>
                deleteOrgAssignment(slug, courseId, mod.id, assignment.id),
              )
            }
            className="shrink-0 text-error-600 hover:underline disabled:opacity-50 dark:text-error-400"
          >
            remove
          </button>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            value={aTitle}
            onChange={(e) => setATitle(e.target.value)}
            placeholder="Assignment title"
            aria-label="Assignment title"
            className={FIELD}
          />
          <input
            value={aPrompt}
            onChange={(e) => setAPrompt(e.target.value)}
            placeholder="What to do"
            aria-label="Assignment prompt"
            className={FIELD}
          />
          <textarea
            value={aAnswers}
            onChange={(e) => setAAnswers(e.target.value)}
            placeholder="Accepted answers, one per line"
            aria-label="Accepted answers, one per line"
            rows={2}
            className={`${FIELD} sm:col-span-2`}
          />
          <div className="sm:col-span-2">
            <Action size="sm" onClick={addAssignment} loading={busy}>
              Add assignment
            </Action>
          </div>
        </div>
      )}
    </div>
  );
}
