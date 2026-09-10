"use client";

import { useCallback, useEffect, useState } from "react";

import {
  type AssignmentAdmin,
  type MatchMode,
  createAssignment,
  deleteAssignment,
  listModuleAssignmentsAdmin,
  updateAssignment,
} from "@/lib/assignments";

const FIELD =
  "w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

/**
 * Authoring a module's assignments.
 *
 * Grading is a deterministic match against the answers listed here — no AI is
 * involved, so what an author types in "accepted answers" is exactly what will
 * be marked correct. The UI says so plainly, because an author who assumes
 * something smarter is judging the answer will write the wrong kind of prompt.
 */
export default function AssignmentEditor({ moduleId }: { moduleId: string }) {
  const [assignments, setAssignments] = useState<AssignmentAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // The assignment being edited, or null when creating a new one. One
  // form serves both: two near-identical forms is how they drift apart.
  const [editingId, setEditingId] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [answers, setAnswers] = useState("");
  const [matchMode, setMatchMode] = useState<MatchMode>("exact");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [maxScore, setMaxScore] = useState(100);

  const load = useCallback(async () => {
    try {
      setAssignments(await listModuleAssignmentsAdmin(moduleId));
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not load assignments.",
      );
    } finally {
      setLoading(false);
    }
  }, [moduleId]);

  useEffect(() => {
    void load();
  }, [load]);

  function reset() {
    setTitle("");
    setPrompt("");
    setAnswers("");
    setMatchMode("exact");
    setCaseSensitive(false);
    setMaxScore(100);
    setAdding(false);
    setEditingId(null);
  }

  /** Load an existing assignment into the form. */
  function startEditing(assignment: AssignmentAdmin) {
    setEditingId(assignment.id);
    setTitle(assignment.title);
    setPrompt(assignment.prompt);
    // One per line, which is how the field is read back on save.
    setAnswers(assignment.accepted_answers.join("\n"));
    setMatchMode(assignment.match_mode);
    setCaseSensitive(assignment.case_sensitive);
    setMaxScore(assignment.max_score);
    setAdding(true);
    setError(null);
  }

  async function handleSave() {
    const accepted = answers
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (!title.trim() || !prompt.trim() || accepted.length === 0) {
      setError("Title, prompt and at least one accepted answer are required.");
      return;
    }

    const body = {
      title: title.trim(),
      prompt: prompt.trim(),
      accepted_answers: accepted,
      match_mode: matchMode,
      case_sensitive: caseSensitive,
      max_score: maxScore,
    };

    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        // EDITING, not replacing. Submissions already made against this
        // assignment keep their marks — re-creating it would destroy
        // them, which was the only route available before this.
        await updateAssignment(editingId, body);
      } else {
        await createAssignment(moduleId, body);
      }
      reset();
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : editingId
            ? "Could not save the changes."
            : "Could not create the assignment.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(assignmentId: string) {
    setError(null);
    try {
      await deleteAssignment(assignmentId);
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not delete the assignment.",
      );
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 p-5 dark:border-gray-800">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-800 dark:text-white/90">
            Assignments
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Graded by matching the answer against the list you give. Marking is
            instant and identical every time.
          </p>
        </div>
        <button
          type="button"
          onClick={() => (adding ? reset() : setAdding(true))}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03]"
        >
          {adding ? "Cancel" : "Add assignment"}
        </button>
      </div>

      {error ? (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-error-500 bg-error-50 px-4 py-3 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400"
        >
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
      ) : assignments.length === 0 && !adding ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No assignments on this module yet.
        </p>
      ) : null}

      {assignments.length > 0 ? (
        <ul className="mb-4 space-y-3">
          {assignments.map((assignment) => (
            <li
              key={assignment.id}
              className="rounded-lg border border-gray-200 p-4 dark:border-gray-800"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-gray-800 dark:text-white/90">
                    {assignment.title}
                  </p>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                    {assignment.prompt}
                  </p>
                </div>
                <div className="flex shrink-0 gap-3">
                  {/* Editing keeps the submissions and their marks. Deleting
                      and re-creating was the only route before this, and it
                      destroys both. */}
                  <button
                    type="button"
                    onClick={() => startEditing(assignment)}
                    className="text-sm text-brand-500 dark:text-brand-400 hover:text-brand-600"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(assignment.id)}
                    className="text-sm text-error-700 hover:text-error-800"
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                  {assignment.match_mode === "exact"
                    ? "Exact match"
                    : "Must mention all"}
                </span>
                <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                  {assignment.max_score} marks
                </span>
                {assignment.case_sensitive ? (
                  <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                    Case sensitive
                  </span>
                ) : null}
                {assignment.accepted_answers.map((answer) => (
                  <span
                    key={answer}
                    className="rounded-full bg-success-50 px-2.5 py-0.5 text-xs font-medium text-success-700 dark:bg-success-500/15 dark:text-success-400"
                  >
                    {answer}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {adding ? (
        <div className="space-y-4 rounded-lg border border-gray-200 p-4 dark:border-gray-800">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Name the idea"
              className={FIELD}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
              Prompt
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder="What the student has to do."
              className={FIELD}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
              Accepted answers (one per line)
            </label>
            <textarea
              value={answers}
              onChange={(e) => setAnswers(e.target.value)}
              rows={3}
              placeholder={"declarative\nthe declarative style"}
              className={`${FIELD} font-mono text-[13px]`}
            />
            <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
              {matchMode === "exact"
                ? "Exact match: the answer must equal one of these. Case, extra spaces and a trailing full stop are ignored."
                : "Must mention all: the answer has to contain every line above, so use it for written responses that need specific terms."}
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
                Matching
              </label>
              <select
                value={matchMode}
                onChange={(e) => setMatchMode(e.target.value as MatchMode)}
                className={FIELD}
              >
                <option value="exact">Exact match</option>
                <option value="contains">Must mention all</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
                Marks
              </label>
              <input
                type="number"
                min={1}
                max={1000}
                value={maxScore}
                onChange={(e) => setMaxScore(Number(e.target.value))}
                className={FIELD}
              />
            </div>
            <div className="flex items-end pb-2.5">
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-400">
                <input
                  type="checkbox"
                  checked={caseSensitive}
                  onChange={(e) => setCaseSensitive(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-brand-500 dark:text-brand-400 focus:ring-brand-500/20 dark:border-gray-700"
                />
                Case sensitive
              </label>
            </div>
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-brand-500 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-50"
          >
            {saving
              ? editingId
                ? "Saving…"
                : "Adding…"
              : editingId
                ? "Save changes"
                : "Add assignment"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
