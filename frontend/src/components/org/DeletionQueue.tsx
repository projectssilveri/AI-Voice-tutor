"use client";

import { useCallback, useEffect, useState } from "react";

import { Action } from "@/components/ui/Action";
import {
  type DeletionRequestRow,
  approveDeletion,
  declineDeletion,
  listDeletionRequests,
} from "@/lib/orgPortal";
import { counted } from "@/lib/plural";

/**
 * Deletions waiting on this organization's administrators.
 *
 * WHY THIS SCREEN EXISTS. A platform admin can see a customer's people,
 * training and documents in full, and can destroy none of it on their own. The
 * data is the customer's even though the platform holds it, so anything that
 * would destroy it arrives here and one of the customer's own administrators
 * says yes or no.
 *
 * ONE QUEUE, TWO SOURCES: platform staff asking from the admin console, and a
 * branch or department manager asking from inside this portal. The decider is
 * the same person either way, so two lists would only be two things to
 * remember to check.
 *
 * ABOVE EVERYTHING ELSE ON THE PAGE, in the shape `SuspensionQueue` already
 * uses. A pending request is somebody's account, course or file in limbo until
 * an administrator looks; putting it under the members table would be the same
 * as not having it. Renders nothing at all when the queue is empty.
 */

/** What the request is about, in the words the rest of the portal uses. */
const WHAT: Record<string, string> = {
  member: "Person",
  training: "Training",
  document: "Document",
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

export default function DeletionQueue({
  slug,
  onDecided,
}: {
  slug: string;
  /** The members list behind this needs reloading once something is removed. */
  onDecided: () => void;
}) {
  const [rows, setRows] = useState<DeletionRequestRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Which row has its decline box open, and what is in it.
  const [declining, setDeclining] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      setRows(await listDeletionRequests(slug));
      setError(null);
    } catch {
      // A branch manager reaching this page gets 403 from the queue endpoint.
      // Silent: they should not be told what is in a queue they cannot read,
      // and an error banner about it would be noise on a page that otherwise
      // works for them.
      setRows([]);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(row: DeletionRequestRow, approve: boolean) {
    if (approve) {
      // ONE CONFIRMATION, NAMING THE THING. This is the button that actually
      // destroys something, and the row above it looks identical.
      if (
        !window.confirm(
          `Approve the deletion of ${row.target_label}?\n\n` +
            "This cannot be undone. An account with history is closed rather " +
            "than deleted, so nothing already recorded is lost.",
        )
      ) {
        return;
      }
    }

    setBusyId(row.id);
    try {
      if (approve) {
        const done = await approveDeletion(slug, row.id);
        setNotice(
          done.outcome === "closed"
            ? `${row.target_label} had history, so the account was closed rather than deleted.`
            : `${row.target_label} has been removed.`,
        );
      } else {
        await declineDeletion(slug, row.id, note);
        setNotice(`${row.target_label} has been kept. The request was declined.`);
        setDeclining(null);
        setNote("");
      }
      setError(null);
      await load();
      onDecided();
    } catch (caught) {
      // Shown verbatim. "must keep at least 2 administrators" is exactly what
      // the person needs to read, and it is computed now rather than when the
      // request was raised.
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
            : `${counted(rows.length, "request")} to delete something of yours. Nothing has been removed.`}
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
                    {WHAT[row.target_type] ?? row.target_type}
                  </span>
                  <span className="font-medium text-gray-800 dark:text-white/90">
                    {row.target_label}
                  </span>
                </p>
                {/* THE REASON IS THE POINT. An administrator deciding from a
                    name alone is not deciding, and the server requires one for
                    exactly this. */}
                <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
                  &ldquo;{row.reason}&rdquo;
                </p>
                <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                  Asked by {row.requested_by_name ?? "somebody"}
                  {row.requested_by_email ? ` (${row.requested_by_email})` : ""}
                  {" · "}
                  {when(row.requested_at)}
                </p>
              </div>

              {/* `shrink-0` ONLY FROM sm UP. On a phone it stopped this button group
                  narrowing at all, so three buttons held the row at their own
                  width and pushed the whole page 121px wider than the screen —
                  `flex-wrap` could not help, because nothing was allowed to
                  shrink enough to wrap. Full width below sm, so the buttons
                  wrap onto their own line instead. */}
              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">
                {/* NOBODY DECIDES THEIR OWN REQUEST. The server refuses it, so
                    the buttons say why rather than erroring when pressed. */}
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

            {/* DECLINING NEEDS A REASON, for the same reason rejecting a course
                does: a refusal that says nothing tells the person who asked
                nothing they can act on, so they ask again next week. */}
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
                  placeholder="They are on secondment, not leaving."
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
