"use client";

import NewAccountDialog, {
  generatePassword,
} from "@/components/admin/NewAccountDialog";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Action } from "@/components/ui/Action";
import Avatar from "@/components/ui/Avatar";
import DeletionQueue from "@/components/org/DeletionQueue";
import OrgShell from "@/components/org/OrgShell";
import { useAuth } from "@/context/AuthContext";
import EmptyState from "@/components/ui/EmptyState";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { counted } from "@/lib/plural";
import {
  ORG_ROLES,
  type MemberList,
  type OrgProfile,
  type OrgStructure,
  createMember,
  getOrgProfile,
  getOrgStructure,
  listMembers,
  roleLabel,
  removeMember,
  updateMember,
} from "@/lib/orgPortal";

const FIELD =
  "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

const ROLE_TONE: Record<string, string> = {
  org_admin:
    "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-400",
  branch_manager:
    "bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-400",
  student: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

export default function OrgPeoplePage() {
  const { slug } = useParams<{ slug: string }>();
  const { user: signedIn } = useAuth();

  const [profile, setProfile] = useState<OrgProfile | null>(null);
  const [data, setData] = useState<MemberList | null>(null);
  const [structure, setStructure] = useState<OrgStructure | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // What HAPPENED, as opposed to what went wrong. Removal needs it: the server
  // decides whether an account was deleted or closed, and the person who
  // pressed the button has to be told which.
  const [notice, setNotice] = useState<string | null>(null);
  // Held only long enough to show the dialog. Never persisted or logged.
  const [justCreated, setJustCreated] = useState<{
    name: string;
    email: string;
    password: string;
    pendingApproval: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    // A strong one, pre-filled. An empty box invites a weak password,
    // and the admin has to invent one anyway — there is no invite email.
    password: generatePassword(),
    role: "student",
    branch_id: "",
    department_id: "",
  });

  const load = useCallback(async () => {
    try {
      const [p, m, s] = await Promise.all([
        getOrgProfile(slug),
        listMembers(slug),
        getOrgStructure(slug),
      ]);
      setProfile(p);
      setData(m);
      setStructure(s);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not load your people.",
      );
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
      await load();
    } catch (caught) {
      // The backend's message is shown verbatim: "must keep at least 2
      // administrators" is exactly what the person needs to read.
      setError(caught instanceof Error ? caught.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  // Departments filtered to the chosen branch, plus the org-wide ones — a
  // department belonging to another branch is not a valid choice here.
  const availableDepartments = (structure?.departments ?? []).filter(
    (d) => d.branch_id === null || d.branch_id === form.branch_id,
  );

  // A BRANCH MANAGER RUNS THEIR BRANCH, a department admin runs their
  // department. That is what those roles are for, and gating writes on
  // `is_org_admin` alone left each of them with a read-only list of their own
  // people. The server decides the real limits — their own branch or
  // department, nobody senior to them — so this only stops offering controls
  // that would be refused.
  const isDeptAdmin = profile?.is_dept_admin ?? false;
  const canWrite = profile?.can_manage_people ?? false;

  // WHO REMOVES AT ONCE, the twin of `deletions.acts_directly` (2026-10-01).
  // Platform staff always. This organisation's admin for a branch manager or
  // a department admin. A branch manager or department admin for the people
  // in their own branch or department, the only people listed for them. The
  // org admin removing a learner or another admin asks, and a Platform Admin
  // or Super Admin decides. Presentation only: the server decides the same.
  const removesAtOnce = (role: string) =>
    Boolean(profile?.is_platform_staff) ||
    profile?.my_role === "branch_manager" ||
    profile?.my_role === "dept_admin" ||
    (profile?.my_role === "org_admin" &&
      (role === "branch_manager" || role === "dept_admin"));

  // NOBODY HANDS OUT MORE POWER THAN THEY HOLD. Mirrors ROLE_RANK in
  // `routers/org_portal.py`: everyone may assign their own level and below, so
  // a department admin may appoint a second admin for their own team — the
  // same reason an organization needs two — and never a branch manager above
  // them. Presentation only; `_assignable` refuses it regardless.
  const RANK: Record<string, number> = {
    student: 0,
    dept_admin: 2,
    branch_manager: 3,
    org_admin: 4,
  };
  const myRank = profile?.is_org_admin
    ? RANK.org_admin
    : (RANK[profile?.my_role ?? ""] ?? -1);
  const assignableRoles = ORG_ROLES.filter(
    (role) => (RANK[role.value] ?? 99) <= myRank,
  );

  // WHAT THIS SCREEN IS A LIST OF. An org admin gets the company; a department
  // admin gets their team and needs the heading to say so, or a list missing
  // most of the company reads as a broken page rather than a scoped one.
  // NOTHING LOADED, SO NOTHING TO SHOW BUT THE REASON. Opening another
  // company's address answers "Organization not found", and the page used to
  // draw its empty roster underneath anyway: "Nobody here yet. Add your
  // colleagues", on a company that is not theirs. Nothing leaked, but it read
  // as an invitation to add people to somebody else's organisation.
  const failedToLoad = !loading && data === null && error !== null;

  const scopeName = isDeptAdmin
    ? (profile?.department_name ?? "My department")
    : (profile?.branch_name ?? "My branch");

  if (failedToLoad) {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-error-500 bg-error-50 p-4 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400"
      >
        {error}
      </div>
    );
  }

  return (
    <OrgShell
      slug={slug}
      organizationName={profile?.name}
      role={profile?.my_role}
      isAdmin={profile?.is_org_admin}
      canManagePeople={profile?.can_manage_people}
      canAuthor={profile?.can_author}
      isPlatformStaff={profile?.is_platform_staff}
    >
      {justCreated ? (
        <NewAccountDialog
          name={justCreated.name}
          email={justCreated.email}
          password={justCreated.password}
          pendingApproval={justCreated.pendingApproval}
          onClose={() => setJustCreated(null)}
        />
      ) : null}

      {/* DECISIONS WAITING, above everything else on the page.
          Somebody has asked to delete one of this organization's people, its
          training or its files — from the platform's console or from inside
          this portal — and nothing happens to it until an administrator here
          says so. Below the members table would be the same as not having it.
          Renders nothing when the queue is empty, and reads as empty for
          anybody who is not an administrator. */}
      {profile?.is_org_admin ? (
        <DeletionQueue
          slug={slug}
          canDecide={Boolean(profile?.is_platform_staff)}
          onDecided={() => void load()}
        />
      ) : null}

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-title-sm font-bold text-gray-800 dark:text-white/90">
            {profile?.is_org_admin ? "People" : scopeName}
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {loading
              ? "Loading…"
              : profile?.is_org_admin
                ? `${counted(data?.total ?? 0, "person", "people")} in this organization.`
                : canWrite
                  ? `${counted(data?.total ?? 0, "person", "people")} in ${scopeName}. Other ${isDeptAdmin ? "departments" : "branches"} are not yours to manage.`
                  : "The people in your branch. Ask an administrator to make changes."}
          </p>
        </div>
        {canWrite && !adding ? (
          <Action onClick={() => setAdding(true)}>Add someone</Action>
        ) : null}
      </div>

      {error ? (
        <div
          role="alert"
          className="mb-6 rounded-2xl border border-error-500 bg-error-50 p-4 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400"
        >
          {error}
        </div>
      ) : null}

      {notice ? (
        <div className="mb-6 rounded-2xl border border-success-500 bg-success-50 p-4 text-sm text-success-700 dark:bg-success-500/10 dark:text-success-400">
          {notice}
        </div>
      ) : null}

      {data && data.admin_count < data.min_admins ? (
        <div className="mb-6 rounded-2xl border border-warning-300 bg-warning-50 p-4 text-sm text-warning-800 dark:border-warning-500/40 dark:bg-warning-500/10 dark:text-warning-400">
          <strong>You can be locked out.</strong> This organization has{" "}
          {counted(data.admin_count, "administrator")} and needs at least{" "}
          {data.min_admins}. Promote someone so one person leaving cannot strand
          everyone.
        </div>
      ) : null}

      {adding && canWrite ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const made = await createMember(slug, {
                name: form.name.trim(),
                email: form.email.trim(),
                password: form.password,
                role: form.role,
                branch_id: form.branch_id || null,
                department_id: form.department_id || null,
              });
              // Captured BEFORE the form is cleared. This is the only
              // moment the password exists in readable form anywhere.
              setJustCreated({
                name: form.name.trim(),
                email: form.email.trim(),
                password: form.password,
                pendingApproval: Boolean(made.pending_approval),
              });
              setForm({
                name: "",
                email: "",
                password: generatePassword(),
                role: "student",
                branch_id: "",
                department_id: "",
              });
              setAdding(false);
            });
          }}
          className="mb-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-raised dark:border-gray-800 dark:bg-white/[0.03]"
        >
          <h2 className="mb-4 text-base font-semibold text-gray-800 dark:text-white/90">
            Add someone
          </h2>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
                Full name
              </label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className={FIELD}
                required
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
                Work email
              </label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className={FIELD}
                required
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
                Starting password
              </label>
              <input
                type="text"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className={`${FIELD} font-mono`}
                minLength={8}
                required
              />
              {/* Said plainly rather than hidden: there is no email transport
                  to send an invite through, so somebody has to hand this over
                  and the person has to change it. */}
              <button
                type="button"
                onClick={() =>
                  setForm({ ...form, password: generatePassword() })
                }
                className="mt-1.5 text-xs font-medium text-brand-500 dark:text-brand-400 hover:text-brand-600"
              >
                Generate another
              </button>
              <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                Give this to them directly. They can change it from their
                profile once they are in.
              </p>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
                Role
              </label>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className={FIELD}
              >
                {assignableRoles.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                {ORG_ROLES.find((r) => r.value === form.role)?.hint}
              </p>
            </div>
            {/* A DEPARTMENT ADMIN DOES NOT CHOOSE THE PLACEMENT. The server
                forces both fields to their own department, so offering the
                pickers would let somebody select HR and then watch the account
                appear in Sales anyway. Told, not asked. */}
            {isDeptAdmin ? (
              <div className="sm:col-span-2">
                <p className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-400">
                  They join{" "}
                  <span className="font-medium text-gray-800 dark:text-white/90">
                    {profile?.department_name ?? "your department"}
                  </span>
                  . You can only add people to your own department.
                </p>
              </div>
            ) : (
              <>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
                    Branch
                  </label>
                  <select
                    value={form.branch_id}
                    onChange={(e) =>
                      // Changing branch clears the department: the old one may
                      // belong to a branch they are no longer in, and the backend
                      // would refuse it anyway.
                      setForm({
                        ...form,
                        branch_id: e.target.value,
                        department_id: "",
                      })
                    }
                    className={FIELD}
                  >
                    <option value="">Not assigned</option>
                    {structure?.branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
                    Department
                  </label>
                  <select
                    value={form.department_id}
                    onChange={(e) =>
                      setForm({ ...form, department_id: e.target.value })
                    }
                    className={FIELD}
                  >
                    <option value="">Not assigned</option>
                    {availableDepartments.map((department) => (
                      <option key={department.id} value={department.id}>
                        {department.name}
                        {department.branch_name ? "" : " (organization-wide)"}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
          </div>

          <div className="mt-5 flex gap-3">
            <Action type="submit" loading={busy}>
              Create account
            </Action>
            <Action variant="secondary" onClick={() => setAdding(false)}>
              Cancel
            </Action>
          </div>
        </form>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-raised dark:border-gray-800 dark:bg-white/[0.03]">
        {loading ? (
          <SkeletonRows rows={5} columns={4} />
        ) : !data || data.members.length === 0 ? (
          <EmptyState
            icon="👥"
            title="Nobody here yet"
            body="Add your colleagues and give each of them a role. Learners take the training; administrators manage everyone."
            className="border-0"
          />
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {data.members.map((member) => (
              <li
                key={member.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4"
              >
                <Avatar userId={member.id} name={member.name} size="md" />

                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-800 dark:text-white/90">
                    {member.name}
                    {member.pending_approval ? (
                      <span className="ml-2 text-xs font-medium text-warning-700 dark:text-warning-400">
                        (waiting for a super admin)
                      </span>
                    ) : !member.is_active ? (
                      <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">
                        (deactivated)
                      </span>
                    ) : null}
                  </p>
                  <p className="truncate text-sm text-gray-500 dark:text-gray-400">
                    {member.email}
                    {member.branch_name ? ` · ${member.branch_name}` : ""}
                    {member.department_name
                      ? ` · ${member.department_name}`
                      : ""}
                  </p>
                </div>

                {canWrite &&
                member.id !== signedIn?.id &&
                !member.pending_approval ? (
                  <select
                    value={member.role}
                    disabled={busy}
                    onChange={(e) =>
                      void run(() =>
                        updateMember(slug, member.id, { role: e.target.value }),
                      )
                    }
                    aria-label={`Role for ${member.name}`}
                    className="h-9 shrink-0 rounded-lg border border-gray-300 bg-transparent px-2 text-xs text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                  >
                    {/* Their CURRENT role first, even when it is one this
                        caller cannot hand out — a department admin looking at
                        a branch manager placed in their team would otherwise
                        get a select showing the wrong value, because a
                        <select> whose value matches no option renders blank.
                        Disabled, so it can be read and not chosen; the server
                        refuses the change anyway. */}
                    {assignableRoles.some(
                      (r) => r.value === member.role,
                    ) ? null : (
                      <option value={member.role} disabled>
                        {roleLabel(member.role)}
                      </option>
                    )}
                    {assignableRoles.map((role) => (
                      <option key={role.value} value={role.value}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      ROLE_TONE[member.role] ?? ROLE_TONE.student
                    }`}
                    title={
                      member.id === signedIn?.id
                        ? "Ask another administrator to change your own role"
                        : member.pending_approval
                          ? "Their role can change once a super admin decides"
                          : undefined
                    }
                  >
                    {roleLabel(member.role)}
                  </span>
                )}

                {/* Never offered for your own row. The admin floor stops an
                    organization losing its last admins; it does nothing for
                    the person clicking, who would be signed out on the next
                    request and unable to sign back in. Refused server-side
                    too — this only removes the trap. */}
                {/* Nor for somebody waiting for a super admin: switching
                    them on is that super admin's decision. "You" went on
                    THEIR row while this test sat in the first branch alone. */}
                {canWrite && member.id === signedIn?.id ? (
                  <span className="shrink-0 rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-400">
                    You
                  </span>
                ) : canWrite && !member.pending_approval ? (
                  <Action
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        updateMember(slug, member.id, {
                          is_active: !member.is_active,
                        }),
                      )
                    }
                  >
                    {member.is_active ? "Deactivate" : "Reactivate"}
                  </Action>
                ) : null}

                {/* Removal, and one confirmation before it. Deactivating is
                    reversible and sits next to this without a prompt; removing
                    somebody is not, so it asks — and it says what will actually
                    happen, because the server closes an account with history
                    rather than deleting it. */}
                {/* SEES PAST THE DEPARTMENT WALL. Only offered to somebody
                    actually IN a department — for an admin or a manager it is
                    already true by role, and a switch that changes nothing is
                    worse than no switch. */}
                {profile?.is_org_admin &&
                member.department_id &&
                member.role === "student" ? (
                  <label
                    className="flex shrink-0 items-center gap-2 text-xs text-gray-600 dark:text-gray-400"
                    title="Let them see training scoped to other departments"
                  >
                    <input
                      type="checkbox"
                      checked={member.sees_all_departments}
                      disabled={busy}
                      onChange={(e) =>
                        void run(() =>
                          updateMember(slug, member.id, {
                            sees_all_departments: e.target.checked,
                          }),
                        )
                      }
                      className="h-4 w-4 rounded border-gray-300 text-brand-500 dark:text-brand-400 focus:ring-brand-500/25"
                    />
                    All departments
                  </label>
                ) : null}

                {/* REMOVE, OR ASK TO. An administrator removes somebody
                    outright; a branch or department manager raises a request
                    that an administrator decides. The button says which, and
                    the prompt asks for the reason the request needs, because
                    an administrator deciding from a name alone is not
                    deciding. */}
                {canWrite && member.id !== signedIn?.id ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      const decides = removesAtOnce(member.role);
                      let reason = "";

                      if (decides) {
                        if (
                          !window.confirm(
                            `Remove ${member.name} from ${profile?.name ?? "this organization"}?

If they have any history their account is closed rather than deleted, so nothing they have done is lost.`,
                          )
                        ) {
                          return;
                        }
                      } else {
                        const answer = window.prompt(
                          `Ask to remove ${member.name}?

Nothing happens to their account until a Platform Admin or Super Admin approves it.

Why should they be removed?`,
                          "",
                        );
                        if (answer === null) return;
                        reason = answer.trim();
                        if (!reason) {
                          setError(
                            "Say why they should be removed. The request needs a reason.",
                          );
                          return;
                        }
                      }

                      void run(async () => {
                        const result = await removeMember(
                          slug,
                          member.id,
                          reason,
                        );
                        setNotice(result.explanation);
                      });
                    }}
                    className="shrink-0 rounded-lg border border-error-300 px-3 py-1.5 text-xs font-medium text-error-600 transition hover:bg-error-50 disabled:opacity-50 dark:border-error-500/40 dark:text-error-400 dark:hover:bg-error-500/10"
                  >
                    {removesAtOnce(member.role) ? "Remove" : "Ask to remove"}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </OrgShell>
  );
}
