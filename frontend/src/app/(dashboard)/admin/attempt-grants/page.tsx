"use client";

import { useCallback, useEffect, useState } from "react";

import RequireAuth from "@/components/auth/RequireAuth";
import { useAuth } from "@/context/AuthContext";
import {
  type AdminExam,
  type AdminUserRow,
  type AttemptOverviewRow,
  type GrantRow,
  grantAttempts,
  listAttemptStats,
  listExams,
  listGrants,
  listUsers,
} from "@/lib/admin";
import { counted } from "@/lib/plural";

/**
 * Grant extra certification attempts.
 *
 * The form is the whole of the project spec's requirement: student, exam, +N,
 * reason. Every grant writes an `attempt_grants` row recording which admin
 * issued it, so the history below is an audit trail rather than a log.
 */
function AttemptGrantsAdmin() {
  const { user } = useAuth();
  // Every learner for platform staff since the role model of 2026-10-01,
  // customers' included; the server checks `can_manage` on each grant.
  const publicOnly = user?.role !== "admin" && user?.role !== "super_admin";
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [exams, setExams] = useState<AdminExam[]>([]);
  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [stats, setStats] = useState<AttemptOverviewRow[]>([]);

  const [userId, setUserId] = useState("");
  const [examId, setExamId] = useState("");
  const [extra, setExtra] = useState(1);
  const [reason, setReason] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [u, e, g, s] = await Promise.all([
        // ASKED FOR, not filtered afterwards. This pulled every account on
        // the platform and kept the students, which on a platform of any size
        // is most of a megabyte to fill one dropdown.
        listUsers({ role: "student", public_only: publicOnly, limit: 500 }),
        listExams(),
        listGrants(),
        listAttemptStats(),
      ]);
      setUsers(u.items);
      setExams(e);
      setGrants(g);
      setStats(s);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not load grant data.",
      );
    } finally {
      setLoading(false);
    }
  }, [publicOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!userId || !examId) {
      setError("Choose a student and an exam.");
      return;
    }

    setSaving(true);
    try {
      const grant = await grantAttempts({
        user_id: userId,
        cert_exam_id: examId,
        extra_attempts: extra,
        reason: reason.trim() || null,
      });
      setSuccess(
        `Granted ${counted(grant.extra_attempts_granted, "extra attempt")} to ${grant.user_name}.`,
      );
      setReason("");
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not grant attempts.",
      );
    } finally {
      setSaving(false);
    }
  }

  const fieldClass =
    "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1 text-title-sm font-bold text-gray-800 dark:text-white/90">
          Attempt grants
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Give a student extra certification attempts. Grants add to the exam
          default rather than replacing it.
        </p>
      </div>

      {error ? (
        <div className="rounded-2xl border border-error-500 bg-error-50 p-4 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="rounded-2xl border border-success-500 bg-success-50 p-4 text-sm text-success-700 dark:bg-success-500/10 dark:text-success-400">
          {success}
        </div>
      ) : null}

      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-gray-200 bg-white shadow-raised p-6 dark:border-gray-800 dark:bg-white/[0.03]"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
              Student
            </label>
            <select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className={fieldClass}
            >
              <option value="">Select a student…</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} ({user.email})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
              Exam
            </label>
            <select
              value={examId}
              onChange={(e) => setExamId(e.target.value)}
              className={fieldClass}
            >
              <option value="">Select an exam…</option>
              {exams.map((exam) => (
                <option key={exam.id} value={exam.id}>
                  {exam.course_title} · {exam.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
              Extra attempts
            </label>
            <input
              type="number"
              min={1}
              max={20}
              value={extra}
              onChange={(e) => setExtra(Number(e.target.value))}
              className={fieldClass}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
              Reason
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. connection dropped mid-exam"
              className={fieldClass}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="mt-5 rounded-lg bg-brand-500 px-6 py-2.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {saving ? "Granting…" : "Grant attempts"}
        </button>
      </form>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-raised dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="border-b border-gray-200 px-6 py-4 dark:border-gray-800">
          <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">
            Certification attempts
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Who is close to their limit.
          </p>
        </div>
        <div className="max-w-full overflow-x-auto custom-scrollbar">
          <table className="table-wide min-w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-white/[0.02]">
              <tr>
                {["Student", "Exam", "Attempts", "Best score", "Passed"].map(
                  (heading) => (
                    <th
                      key={heading}
                      className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400"
                    >
                      {heading}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-6 text-center text-gray-500"
                  >
                    Loading…
                  </td>
                </tr>
              ) : stats.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-6 text-center text-gray-500"
                  >
                    No exam attempts recorded yet.
                  </td>
                </tr>
              ) : (
                stats.map((row) => (
                  <tr
                    key={`${row.user_email}-${row.exam_title}`}
                    className="border-b border-gray-100 last:border-0 dark:border-gray-800"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-800 dark:text-white/90">
                        {row.user_name}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {row.user_email}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                      {row.exam_title}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                      {row.attempts}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                      {row.best_score}%
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          row.passed
                            ? "bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-400"
                            : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                        }`}
                      >
                        {row.passed ? "Yes" : "No"}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-raised dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="border-b border-gray-200 px-6 py-4 dark:border-gray-800">
          <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">
            Grant history
          </h2>
        </div>
        {grants.length === 0 ? (
          <p className="px-6 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
            No grants issued yet.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {grants.map((grant) => (
              <li key={grant.id} className="px-6 py-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-gray-800 dark:text-white/90">
                    +{grant.extra_attempts_granted} to {grant.user_name} ·{" "}
                    {grant.exam_title}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    by {grant.granted_by_name} ·{" "}
                    {new Date(grant.ts).toLocaleString()}
                  </span>
                </div>
                {grant.reason ? (
                  <p className="mt-1 text-gray-500 dark:text-gray-400">
                    {grant.reason}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function AdminAttemptGrantsPage() {
  return (
    <RequireAuth roles={["admin"]}>
      <AttemptGrantsAdmin />
    </RequireAuth>
  );
}
