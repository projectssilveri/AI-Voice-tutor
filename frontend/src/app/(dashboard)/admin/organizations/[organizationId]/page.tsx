"use client";

import OrganizationLimits from "@/components/admin/OrganizationLimits";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import RequireAuth from "@/components/auth/RequireAuth";
import { Action } from "@/components/ui/Action";
import EmptyState from "@/components/ui/EmptyState";
import { SkeletonPanel } from "@/components/ui/Skeleton";
import { counted } from "@/lib/plural";
import {
  type OrganizationDetail,
  createBranch,
  createDepartment,
  getOrganization,
  updateOrganization,
} from "@/lib/organizations";

const FIELD =
  "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

function Detail() {
  const { organizationId } = useParams<{ organizationId: string }>();

  const [org, setOrg] = useState<OrganizationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [branchName, setBranchName] = useState("");
  const [deptName, setDeptName] = useState("");
  // "" is the org-wide case, which is a real choice rather than "unset".
  const [deptBranch, setDeptBranch] = useState("");

  const load = useCallback(async () => {
    try {
      setOrg(await getOrganization(organizationId));
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not load this organization.",
      );
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <SkeletonPanel lines={5} />;

  if (!org) {
    return (
      <EmptyState
        icon="🏢"
        title="We can't find that organization"
        body={error ?? "It may have been removed, or the link may be wrong."}
        action={
          <Link
            href="/admin/organizations"
            className="inline-flex rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
          >
            All organizations
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/admin/organizations"
            className="mb-2 inline-block text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400"
          >
            ← All organizations
          </Link>
          <h1 className="mb-1 text-title-sm font-bold text-gray-800 dark:text-white/90">
            {org.name}
          </h1>
          <p className="font-mono text-sm text-gray-500 dark:text-gray-400">
            /org/{org.slug}
          </p>
        </div>
        <Action
          variant={org.is_active ? "secondary" : "success"}
          loading={busy}
          onClick={() =>
            run(() => updateOrganization(org.id, { is_active: !org.is_active }))
          }
        >
          {org.is_active ? "Suspend" : "Reactivate"}
        </Action>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-2xl border border-error-500 bg-error-50 p-4 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400"
        >
          {error}
        </div>
      ) : null}

      {!org.meets_admin_minimum ? (
        <div className="rounded-2xl border border-warning-300 bg-warning-50 p-4 text-sm text-warning-800 dark:border-warning-500/40 dark:bg-warning-500/10 dark:text-warning-400">
          <strong>This organization can be locked out.</strong> It has{" "}
          {counted(org.admin_count, "administrator")} and needs at least{" "}
          {org.min_admins}. One person leaving, losing a password or being
          deactivated would strand it, and only platform staff could undo that.
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          ["People", org.user_count],
          ["Administrators", org.admin_count],
          ["Branches", org.branch_count],
          ["Courses", org.course_count],
        ].map(([label, value]) => (
          <div
            key={String(label)}
            className="rounded-2xl border border-gray-200 bg-white p-4 shadow-raised dark:border-gray-800 dark:bg-white/[0.03]"
          >
            <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
            <p className="mt-1 text-title-sm font-bold text-gray-800 dark:text-white/90">
              {value}
            </p>
          </div>
        ))}
      </div>

      {/* Branches */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-raised dark:border-gray-800 dark:bg-white/[0.03]">
        <h2 className="mb-4 text-base font-semibold text-gray-800 dark:text-white/90">
          Branches
        </h2>

        {org.branches.length === 0 ? (
          <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
            No branches yet. A branch is a site or region; departments can sit
            under one, or across the whole organization.
          </p>
        ) : (
          <ul className="mb-5 divide-y divide-gray-100 dark:divide-gray-800">
            {org.branches.map((branch) => (
              <li
                key={branch.id}
                className="flex items-center justify-between py-3"
              >
                <span className="text-sm font-medium text-gray-800 dark:text-white/90">
                  {branch.name}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {counted(branch.user_count, "person", "people")}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap gap-3">
          <input
            value={branchName}
            onChange={(e) => setBranchName(e.target.value)}
            placeholder="London"
            aria-label="New branch name"
            className={`${FIELD} sm:max-w-xs`}
          />
          <Action
            loading={busy}
            disabled={!branchName.trim()}
            onClick={() =>
              run(async () => {
                await createBranch(org.id, { name: branchName.trim() });
                setBranchName("");
              })
            }
          >
            Add branch
          </Action>
        </div>
      </div>

      {/* Departments */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-raised dark:border-gray-800 dark:bg-white/[0.03]">
        <h2 className="mb-4 text-base font-semibold text-gray-800 dark:text-white/90">
          Departments
        </h2>

        {org.departments.length === 0 ? (
          <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
            No departments yet.
          </p>
        ) : (
          <ul className="mb-5 divide-y divide-gray-100 dark:divide-gray-800">
            {org.departments.map((department) => (
              <li
                key={department.id}
                className="flex items-center justify-between py-3"
              >
                <span className="text-sm font-medium text-gray-800 dark:text-white/90">
                  {department.name}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {department.branch_name ?? "Organization-wide"}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap gap-3">
          <input
            value={deptName}
            onChange={(e) => setDeptName(e.target.value)}
            placeholder="Compliance"
            aria-label="New department name"
            className={`${FIELD} sm:max-w-xs`}
          />
          <select
            value={deptBranch}
            onChange={(e) => setDeptBranch(e.target.value)}
            aria-label="Branch for the new department"
            className={`${FIELD} sm:max-w-xs`}
          >
            <option value="">Organization-wide</option>
            {org.branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
          <Action
            loading={busy}
            disabled={!deptName.trim()}
            onClick={() =>
              run(async () => {
                await createDepartment(org.id, {
                  name: deptName.trim(),
                  branch_id: deptBranch || null,
                });
                setDeptName("");
              })
            }
          >
            Add department
          </Action>
        </div>
      </div>

      <OrganizationLimits organizationId={organizationId} />

      <p className="text-sm text-gray-500 dark:text-gray-400">
        This organization&apos;s own admins manage their people and build their
        own courses inside their portal. Their training stays private to them:
        nobody outside the organization can reach it, and it never appears in
        the public catalogue.
      </p>
    </div>
  );
}

export default function OrganizationDetailPage() {
  return (
    <RequireAuth roles={["super_admin"]}>
      <Detail />
    </RequireAuth>
  );
}
