"use client";

import { useState } from "react";

import { type ModuleRow, deleteModule, updateModule } from "@/lib/authoring";

import AssignmentEditor from "./AssignmentEditor";
import MaterialUploader from "@/components/admin/MaterialUploader";

const FIELD =
  "w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

/** Roughly how long the tutor takes to speak the content, at ~140 wpm. */
function speakingTime(content: string): string {
  const words = content.trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return "empty";
  const minutes = words / 140;
  return minutes < 1
    ? `${words} words · under a minute spoken`
    : `${words} words · ~${Math.round(minutes)} min spoken`;
}

export default function ModuleEditor({
  module,
  onChanged,
}: {
  module: ModuleRow;
  onChanged: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(module.title);
  const [order, setOrder] = useState(module.order);
  const [content, setContent] = useState(module.content ?? "");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const dirty =
    title !== module.title ||
    order !== module.order ||
    content !== (module.content ?? "");

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await updateModule(module.id, {
        title: title.trim(),
        order,
        content: content.trim() || null,
      });
      setSaved(true);
      await onChanged();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not save the module.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setError(null);
    try {
      await deleteModule(module.id);
      await onChanged();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not delete the module.",
      );
      setConfirmingDelete(false);
    }
  }

  const hasContent = Boolean(module.content && module.content.trim());

  return (
    <li className="px-6 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex min-w-0 items-center gap-3 text-left"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-sm font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            {module.order + 1}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium text-gray-800 dark:text-white/90">
              {module.title}
            </span>
            <span className="block text-xs text-gray-500 dark:text-gray-400">
              {hasContent
                ? speakingTime(module.content ?? "")
                : "No content, so the tutor has nothing to teach from"}
            </span>
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-3">
          {/* The tutor is grounded only in `content`. A module without it
              cannot hold a voice session, so it is flagged here rather than
              failing later when a student presses Start. */}
          {!hasContent ? (
            <span className="rounded-full bg-warning-50 px-2.5 py-0.5 text-xs font-medium text-warning-700 dark:bg-warning-500/15 dark:text-orange-400">
              Needs content
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03]"
          >
            {open ? "Close" : "Edit"}
          </button>
        </div>
      </div>

      {open ? (
        <div className="mt-5 space-y-4 rounded-xl border border-gray-200 p-5 dark:border-gray-800">
          {error ? (
            <div
              role="alert"
              className="rounded-lg border border-error-500 bg-error-50 px-4 py-3 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400"
            >
              {error}
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-[1fr_140px]">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
                Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className={FIELD}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
                Position
              </label>
              <input
                type="number"
                min={0}
                value={order}
                onChange={(e) => setOrder(Number(e.target.value))}
                className={FIELD}
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
              Content: what the tutor teaches from
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={14}
              placeholder="Write this to be spoken aloud: plain sentences, no markdown, no code blocks."
              className={`${FIELD} font-mono text-[13px] leading-relaxed`}
            />
            <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
              {speakingTime(content)}. This text goes straight into the voice
              session&apos;s system instruction, so write it the way you would
              say it out loud.
            </p>
          </div>

          {/* PDFs for students to read. Uploading one changes nothing about
              what the tutor says — "Use as tutor material" pastes the PDF's
              text into the box above, for the author to review before saving,
              because extraction is imperfect and this is the lesson. */}
          <MaterialUploader
            moduleId={module.id}
            onUseAsContent={(text) => setContent(text)}
          />

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !dirty}
              className="rounded-lg bg-brand-500 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save module"}
            </button>
            {saved && !dirty ? (
              <span className="text-sm text-success-600 dark:text-success-400">
                Saved.
              </span>
            ) : null}

            <span className="ml-auto">
              {confirmingDelete ? (
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="rounded-lg bg-error-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-error-800"
                  >
                    Delete for good
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(false)}
                    className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400"
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  className="rounded-lg border border-error-500 px-4 py-2 text-sm font-medium text-error-600 transition hover:bg-error-50 dark:text-error-400 dark:hover:bg-error-500/10"
                >
                  Delete module
                </button>
              )}
            </span>
          </div>

          <AssignmentEditor moduleId={module.id} />
        </div>
      ) : null}
    </li>
  );
}
