"use client";

import { useCallback, useEffect, useState } from "react";

import RequireAuth from "@/components/auth/RequireAuth";
import EmptyState from "@/components/ui/EmptyState";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { errorText } from "@/lib/api";
import { type ApprovalRow, decideApproval, listApprovals } from "@/lib/approvals";

/**
 * New organisation administrators, waiting for a super admin.
 *
 * The role model of 2026-10-01 gave platform admins the super admin's work,
 * except this: making somebody an organisation's administrator hands them a
 * whole customer, so when a platform admin does it, a super admin says yes or
 * no here. A new account cannot sign in until approved; a promotion is not
 * applied until approved.
 */

function when(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AdminApprovals() {
  const [rows, setRows] = useState<ApprovalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await listApprovals());
      setError(null);
    } catch (caught) {
      setError(errorText(caught, "Could not load the approvals."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(row: ApprovalRow, approve: boolean) {
    let note: string | undefined;
    if (!approve) {
      const answer = window.prompt(
        `Decline ${row.user_name} as an administrator of ${row.organization_name}? ` +
          "Say why, for the record and for whoever asked.",
        "",
      );
      if (answer === null) return;
      note = answer;
    }
    setBusyId(row.id);
    setError(null);
    setNotice(null);
    try {
      await decideApproval(row.id, approve, note);
      setNotice(
        approve
          ? row.kind === "new_account"
            ? `${row.user_name} can now sign in as an administrator of ${row.organization_name}.`
            : `${row.user_name} is now an administrator of ${row.organization_name}.`
          : row.kind === "new_account"
            ? `Declined. ${row.user_name}'s account stays switched off.`
            : `Declined. ${row.user_name} keeps their current role.`,
      );
      await load();
    } catch (caught) {
      setError(errorText(caught, "Could not record that."));
    } finally {
      setBusyId(null);
    }
  }

  const waiting = rows.filter((row) => row.status === "pending");
  const decided = rows.filter((row) => row.status !== "pending");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-title-sm font-bold text-gray-800 dark:text-white/90">
          Admin approvals
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Organisation administrators made by a platform admin wait here. A
          new account cannot sign in, and a promotion is not applied, until you
          approve it.
        </p>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-error-500 bg-error-50 px-4 py-2.5 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="rounded-lg border border-success-500 bg-success-50 px-4 py-2.5 text-sm text-success-800 dark:bg-success-500/10 dark:text-success-400"
        >
          {notice}
        </p>
      ) : null}

      {loading ? (
        <SkeletonRows rows={3} />
      ) : waiting.length === 0 ? (
        <EmptyState
          icon="✅"
          title="Nothing waiting"
          body="When a platform admin makes somebody an organisation's administrator, it appears here for you to approve."
        />
      ) : (
        <ul className="space-y-3">
          {waiting.map((row) => (
            <li
              key={row.id}
              className="rounded-2xl border border-warning-300 bg-white p-5 shadow-raised dark:border-warning-500/40 dark:bg-white/[0.03]"
            >
              <p className="font-semibold text-gray-800 dark:text-white/90">
                {row.user_name}{" "}
                <span className="font-normal text-gray-500 dark:text-gray-400">
                  {row.user_email}
                </span>
              </p>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                {row.kind === "new_account"
                  ? "New account as administrator of "
                  : "Raise to administrator of "}
                <span className="font-medium text-gray-800 dark:text-white/90">
                  {row.organization_name}
                </span>
                . Asked by {row.requested_by_name ?? "a platform admin"},{" "}
                {when(row.requested_at)}.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={busyId === row.id}
                  onClick={() => void decide(row, true)}
                  className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={busyId === row.id}
                  onClick={() => void decide(row, false)}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
                >
                  Decline
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {decided.length > 0 ? (
        <div>
          <h2 className="mb-2 text-base font-semibold text-gray-800 dark:text-white/90">
            Decided
          </h2>
          <ul className="divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-white/[0.03]">
            {decided.map((row) => (
              <li key={row.id} className="px-5 py-3 text-sm">
                <span className="font-medium text-gray-800 dark:text-white/90">
                  {row.user_name}
                </span>{" "}
                <span className="text-gray-500 dark:text-gray-400">
                  {row.organization_name} ·{" "}
                  {row.status === "approved" ? "Approved" : "Declined"} by{" "}
                  {row.decided_by_name ?? "a super admin"}, {when(row.decided_at)}
                  {row.decision_note ? `. "${row.decision_note}"` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export default function Page() {
  // `super_admin` by name: RequireAuth widens "admin" upwards, and there is no
  // widening that would leave a platform admin out.
  return (
    <RequireAuth roles={["super_admin"]}>
      <AdminApprovals />
    </RequireAuth>
  );
}
