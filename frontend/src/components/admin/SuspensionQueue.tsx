"use client";

import { useCallback, useEffect, useState } from "react";

import {
  type SuspensionRow,
  decideSuspension,
  listSuspensionRequests,
} from "@/lib/admin";
import { counted } from "@/lib/plural";

/**
 * Accounts an admin has asked to have switched off.
 *
 * The account is still active while a row sits here — that is the point of the
 * request. Approving is what suspends it.
 *
 * Renders nothing when the queue is empty, like the course review queue: a
 * permanent "nothing waiting" panel on the busiest admin screen is one more
 * thing to scroll past.
 */
export default function SuspensionQueue({
  onDecided,
}: {
  onDecided: () => void;
}) {
  const [rows, setRows] = useState<SuspensionRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      setRows(await listSuspensionRequests("pending"));
    } catch {
      // Quiet: this sits above the user table, and a banner here would read as
      // the whole screen having failed.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(row: SuspensionRow, approve: boolean) {
    setBusyId(row.id);
    setError(null);
    try {
      // The note belongs to the row it was typed on. `note` is one piece of
      // state for the whole queue, so typing a reason to decline one request
      // and then approving a different one attached the first row's words to
      // the second row's decision — a sentence about the wrong person, in a
      // record kept precisely so somebody can read back why.
      const reason = noteFor === row.id ? note.trim() : "";
      await decideSuspension(row.id, approve, reason || undefined);
      setNoteFor(null);
      setNote("");
      await load();
      onDecided();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not save that.",
      );
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) return null;

  return (
    <div className="mb-6 rounded-2xl border border-warning-500 bg-warning-50 p-6 dark:bg-warning-500/10">
      <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">
        {counted(rows.length, "account")} an admin wants suspended
      </h2>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
        Nobody is locked out yet. These accounts still work, and approving is
        what switches one off.
      </p>

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-error-500 bg-white px-4 py-2.5 text-sm text-error-700 dark:bg-gray-900 dark:text-error-400"
        >
          {error}
        </p>
      ) : null}

      <ul className="mt-4 space-y-3">
        {rows.map((row) => (
          <li
            key={row.id}
            className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                  {row.user_name}{" "}
                  <span className="font-normal text-gray-500 dark:text-gray-400">
                    {row.user_email}
                  </span>
                </p>
                {/* The reason, verbatim. It is the whole basis for the
                    decision, so it is not summarised or truncated. */}
                <p className="mt-1 max-w-2xl text-sm text-gray-700 dark:text-gray-300">
                  {row.reason}
                </p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Asked by {row.requested_by_name} ·{" "}
                  {new Date(row.requested_at).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </p>
              </div>

              {/* `shrink-0` ONLY FROM sm UP. On a phone it stopped this button group
                  narrowing at all, so three buttons held the row at their own
                  width and pushed the whole page 121px wider than the screen —
                  `flex-wrap` could not help, because nothing was allowed to
                  shrink enough to wrap. Full width below sm, so the buttons
                  wrap onto their own line instead. */}
              <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:shrink-0">
                <button
                  type="button"
                  disabled={busyId === row.id}
                  onClick={() => void decide(row, true)}
                  className="rounded-lg bg-error-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-error-800 disabled:opacity-40"
                >
                  {busyId === row.id ? "Working…" : "Suspend the account"}
                </button>
                <button
                  type="button"
                  disabled={busyId === row.id}
                  onClick={() =>
                    setNoteFor((current) =>
                      current === row.id ? null : row.id,
                    )
                  }
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03]"
                >
                  Decline
                </button>
              </div>
            </div>

            {noteFor === row.id ? (
              <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-gray-100 pt-4 dark:border-gray-800">
                <label className="min-w-[240px] flex-1">
                  <span className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300">
                    Why not? Optional, but it tells the admin what to do next.
                  </span>
                  <input
                    type="text"
                    value={note}
                    maxLength={2000}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Spoke to them; they have agreed to stop."
                    className="h-10 w-full rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                  />
                </label>
                <button
                  type="button"
                  disabled={busyId === row.id}
                  onClick={() => void decide(row, false)}
                  className="h-10 rounded-lg bg-brand-500 px-4 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-40"
                >
                  Leave the account alone
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
