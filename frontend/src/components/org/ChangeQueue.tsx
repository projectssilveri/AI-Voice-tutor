"use client";

import { useCallback, useEffect, useState } from "react";

import { Action } from "@/components/ui/Action";
import {
  type OrgChangeRow,
  approveOrgChange,
  declineOrgChange,
  listOrgChanges,
} from "@/lib/orgChanges";
import { counted } from "@/lib/plural";

/**
 * Changes a branch manager or department admin asked for, for the org admin.
 *
 * Sir's rule of 2026-10-01: the org admin runs their organisation and approves
 * what the managers ask to do, create, edit or delete a person, course or
 * document. Nothing happens until they decide. The org admin and platform
 * staff act directly and never raise a request, so this is empty for them.
 *
 * Renders nothing when the queue is empty, like the suspension queue.
 */

const WHAT: Record<string, string> = {
  member: "Person",
  training: "Course",
  document: "Document",
};

const VERB: Record<string, string> = {
  create: "Add",
  edit: "Edit",
  delete: "Remove",
};

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ChangeQueue({
  slug,
  onDecided,
}: {
  slug: string;
  /** The members list behind this needs reloading once something is applied. */
  onDecided: () => void;
}) {
  const [rows, setRows] = useState<OrgChangeRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [declining, setDeclining] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      setRows(await listOrgChanges(slug));
      setError(null);
    } catch {
      // A manager reaching this gets 403 from the endpoint; stay silent.
      setRows([]);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(row: OrgChangeRow, approve: boolean) {
    if (approve) {
      if (
        !window.confirm(
          `Approve: ${VERB[row.action] ?? row.action} ${(
            WHAT[row.kind] ?? row.kind
          ).toLowerCase()} "${row.label}"?\n\nThis will be applied now.`,
        )
      ) {
        return;
      }
    }
    setBusyId(row.id);
    try {
      if (approve) {
        await approveOrgChange(slug, row.id);
        setNotice(`Done: ${row.label}.`);
      } else {
        await declineOrgChange(slug, row.id, note);
        setNotice(`Declined: ${row.label}.`);
        setDeclining(null);
        setNote("");
      }
      setError(null);
      await load();
      onDecided();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That did not work.");
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0 && !notice) return null;

  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-warning-300 bg-warning-50/50 dark:border-warning-500/40 dark:bg-warning-500/5">
      <div className="border-b border-warning-300 px-5 py-4 dark:border-warning-500/40">
        <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">
          Waiting for your approval
        </h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {rows.length === 0
            ? "Nothing is waiting."
            : `${counted(rows.length, "change")} a branch manager or department admin asked for. Nothing happens until you approve it.`}
        </p>
      </div>

      {error ? (
        <p
          role="alert"
          className="mx-5 mt-4 rounded-lg border border-error-500 bg-error-50 px-4 py-2.5 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mx-5 mt-4 rounded-lg border border-success-500 bg-success-50 px-4 py-2.5 text-sm text-success-700 dark:bg-success-500/10 dark:text-success-400">
          {notice}
        </p>
      ) : null}

      <ul className="divide-y divide-warning-300/60 dark:divide-warning-500/20">
        {rows.map((row) => (
          <li key={row.id} className="px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-900 dark:text-gray-400">
                    {VERB[row.action] ?? row.action}{" "}
                    {(WHAT[row.kind] ?? row.kind).toLowerCase()}
                  </span>
                  <span className="font-medium text-gray-800 dark:text-white/90">
                    {row.label}
                  </span>
                </p>
                {row.reason ? (
                  <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
                    &ldquo;{row.reason}&rdquo;
                  </p>
                ) : null}
                <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                  Asked by {row.requested_by_name ?? "somebody"}
                  {row.requested_by_email ? ` (${row.requested_by_email})` : ""}
                  {" · "}
                  {when(row.requested_at)}
                </p>
              </div>

              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">
                {row.requested_by_me ? (
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    You asked for this, so another administrator decides it.
                  </span>
                ) : (
                  <>
                    <Action
                      onClick={() => void decide(row, true)}
                      disabled={busyId === row.id}
                    >
                      Approve
                    </Action>
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() =>
                        setDeclining((open) => (open === row.id ? null : row.id))
                      }
                      className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-white disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
                    >
                      Decline
                    </button>
                  </>
                )}
              </div>
            </div>

            {declining === row.id ? (
              <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                <label
                  htmlFor={`decline-${row.id}`}
                  className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
                >
                  Why are you declining?
                </label>
                <textarea
                  id={`decline-${row.id}`}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={2}
                  className="w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:text-white/90"
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <Action
                    onClick={() => void decide(row, false)}
                    disabled={busyId === row.id || !note.trim()}
                  >
                    Decline the request
                  </Action>
                  <button
                    type="button"
                    onClick={() => {
                      setDeclining(null);
                      setNote("");
                    }}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
