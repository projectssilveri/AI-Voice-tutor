"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import NewAccountDialog, {
  generatePassword,
} from "@/components/admin/NewAccountDialog";
import SuspensionQueue from "@/components/admin/SuspensionQueue";
import RequireAuth from "@/components/auth/RequireAuth";
import Avatar from "@/components/ui/Avatar";
import EmptyState from "@/components/ui/EmptyState";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { useAuth } from "@/context/AuthContext";
import {
  type AdminUserRow,
  type AssignableRole,
  createUser,
  listUsers,
  removeUser,
  setUserEnrollments,
  setUserRole,
  requestSuspension,
  setUserActive,
  updateUser,
} from "@/lib/admin";
import { ApiError } from "@/lib/api";
import { type CourseRow, listCourses } from "@/lib/authoring";
import { counted } from "@/lib/plural";
import {
  isClean,
  validateEmail,
  validateName,
  validatePassword,
  validatePhone,
} from "@/lib/validate";

/**
 * The people on the platform.
 *
 * Roles offered here are Student, Admin and Super admin. "Tutor" is gone from
 * the dropdown on request — nothing in the product distinguishes a teacher from
 * an admin today, so it was an option that changed nothing anybody could see.
 * Existing teacher accounts keep the role and are still shown; they just cannot
 * be handed out any more. Organization members are labelled as such and are not
 * editable from here: their own admins manage them at /org/{slug}/admin.
 *
 * Active status is a green Yes or a red No, not a word in grey. Whether
 * somebody can sign in is the fastest thing to need to know down a column of
 * fifty rows, and colour reads faster than text.
 */

const CELL = "px-4 py-3 align-middle text-sm";
const FIELD =
  "w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

/** What the console can hand out, in the order it makes sense to read them. */
const ASSIGNABLE = [
  { value: "student", label: "Student" },
  { value: "admin", label: "Admin" },
  { value: "super_admin", label: "Super admin" },
] as const;

const ROLE_LABELS: Record<string, string> = {
  student: "Student",
  teacher: "Tutor (retired role)",
  admin: "Admin",
  super_admin: "Super admin",
  org_admin: "Organisation admin",
  branch_manager: "Branch manager",
};

function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role.replace(/_/g, " ");
}

function isOrgRole(role: string): boolean {
  return role === "org_admin" || role === "branch_manager";
}

function when(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** The message under a field. Nothing when the field is fine. */
function FieldNote({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="mt-1.5 text-xs text-error-700 dark:text-error-400"
    >
      {message}
    </p>
  );
}

/** Green yes, red no. Nothing subtler is needed and nothing subtler is read. */
function ActiveFlag({ active }: { active: boolean }) {
  return active ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-success-50 px-2.5 py-1 text-xs font-semibold text-success-700 dark:bg-success-500/15 dark:text-success-400">
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full bg-success-500"
      />
      Yes
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-error-50 px-2.5 py-1 text-xs font-semibold text-error-700 dark:bg-error-500/15 dark:text-error-400">
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full bg-error-500"
      />
      No
    </span>
  );
}

function CreateUserPanel({
  courses,
  canMakeAdmins,
  onCreated,
  onClose,
}: {
  courses: CourseRow[];
  canMakeAdmins: boolean;
  onCreated: (created: {
    name: string;
    email: string;
    password: string;
  }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  // Pre-filled with a strong one. An empty box invites "Password123", and
  // the admin has to invent something anyway since no invite email is sent.
  const [password, setPassword] = useState(() => generatePassword());
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("student");
  const [courseIds, setCourseIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>(
    {},
  );

  const options = canMakeAdmins
    ? ASSIGNABLE
    : ASSIGNABLE.filter((option) => option.value === "student");

  async function submit() {
    // Checked here as well as server-side, so a mistyped address lands
    // under the field instead of coming back as a banner after a round trip.
    const found = {
      name: validateName(name),
      email: validateEmail(email),
      phone: validatePhone(phone),
      password: validatePassword(password),
    };
    setFieldErrors(found);
    if (!isClean(found)) return;

    setBusy(true);
    try {
      await createUser({
        name: name.trim(),
        email: email.trim(),
        password,
        role,
        phone: phone.trim() || null,
        course_ids: courseIds,
      });
      // The password travels back so it can be SHOWN once. It is stored as
      // an argon2 hash and nothing else, so this is the only moment it
      // exists in readable form anywhere.
      onCreated({ name: name.trim(), email: email.trim(), password });
      onClose();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not create the account.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-lifted dark:border-gray-800 dark:bg-white/[0.03]">
      <h2 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">
        Create a user
      </h2>

      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-error-500 bg-error-50 px-4 py-2.5 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400"
        >
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="new-name"
            className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
          >
            Name
          </label>
          <input
            id="new-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-invalid={Boolean(fieldErrors.name)}
            className={FIELD}
          />
          <FieldNote message={fieldErrors.name} />
        </div>
        <div>
          <label
            htmlFor="new-email"
            className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
          >
            Email
          </label>
          <input
            id="new-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={Boolean(fieldErrors.email)}
            className={FIELD}
          />
          <FieldNote message={fieldErrors.email} />
        </div>
        <div>
          <label
            htmlFor="new-password"
            className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
          >
            Password
          </label>
          <input
            id="new-password"
            type="text"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={FIELD}
          />
          {/* Shown as text, not dots. There is no mail provider to send an
              invite through, so whoever creates the account has to read this
              out or paste it — hiding it would only mean typing it twice. */}
          <FieldNote message={fieldErrors.password} />
          <div className="mt-1.5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setPassword(generatePassword())}
              className="text-xs font-medium text-brand-500 dark:text-brand-400 hover:text-brand-600"
            >
              Generate another
            </button>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              You will see this once more after the account is made, then never
              again.
            </p>
          </div>
        </div>
        <div>
          <label
            htmlFor="new-phone"
            className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
          >
            Phone{" "}
            <span className="font-normal text-gray-500 dark:text-gray-400">
              (optional)
            </span>
          </label>
          <input
            id="new-phone"
            type="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            aria-invalid={Boolean(fieldErrors.phone)}
            className={FIELD}
          />
          <FieldNote message={fieldErrors.phone} />
        </div>
        <div>
          <label
            htmlFor="new-role"
            className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
          >
            Role
          </label>
          <select
            id="new-role"
            value={role}
            onChange={(event) => setRole(event.target.value)}
            className={FIELD}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset className="mt-5">
        <legend className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-400">
          Enrol them in{" "}
          <span className="font-normal text-gray-500 dark:text-gray-400">
            (optional)
          </span>
        </legend>
        {courses.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No courses yet.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {courses.map((course) => (
              <label
                key={course.id}
                className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 dark:border-gray-800 dark:text-gray-300"
              >
                <input
                  type="checkbox"
                  checked={courseIds.includes(course.id)}
                  onChange={(event) =>
                    setCourseIds((current) =>
                      event.target.checked
                        ? [...current, course.id]
                        : current.filter((id) => id !== course.id),
                    )
                  }
                  className="h-4 w-4 rounded border-gray-300 text-brand-500 dark:text-brand-400 focus:ring-brand-500/25"
                />
                {course.title}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <div className="mt-6 flex gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className="rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create user"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Editing a person's details in place: name, email and phone.
 *
 * THE EMAIL IS THE POINT OF THIS. It was deliberately left uneditable — it is
 * the sign-in identifier, so changing it changes what somebody has to type —
 * and the consequence was that an address typed wrong when the account was
 * created locked that person out with no way to put it right short of the
 * database. It is editable now, with the warning shown rather than the field
 * hidden, and the server keeps it unique and records both the old and the new
 * value.
 *
 * `updateUser` already existed and was called by nothing. There was no editing
 * UI on this screen at all.
 */
function DetailsEditor({
  user,
  onDone,
}: {
  user: AdminUserRow;
  onDone: () => void;
}) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [phone, setPhone] = useState(user.phone ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailChanged = email.trim().toLowerCase() !== user.email.toLowerCase();

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await updateUser(user.id, {
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || null,
      });
      onDone();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not save that.",
      );
      setBusy(false);
    }
  }

  return (
    <td colSpan={9} className="px-4 py-4">
      {/* WHOSE ROW THIS IS. The editor replaces the whole row, so without this
          the name and avatar are gone the moment editing starts — and the one
          field most worth being certain about is the one that decides who can
          sign in. */}
      <p className="mb-3 text-sm font-medium text-gray-800 dark:text-white/90">
        Editing {user.name}{" "}
        <span className="font-normal text-gray-500 dark:text-gray-400">
          · {user.email}
        </span>
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-[160px] flex-1">
          <span className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300">
            Name
          </span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="h-10 w-full rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
          />
        </label>
        <label className="min-w-[220px] flex-1">
          <span className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300">
            Email
          </span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="h-10 w-full rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
          />
        </label>
        <label className="min-w-[140px]">
          <span className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300">
            Phone
          </span>
          <input
            type="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            className="h-10 w-full rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
          />
        </label>
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || !name.trim() || !email.trim()}
          className="h-10 rounded-lg bg-brand-500 px-4 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="h-10 px-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400"
        >
          Cancel
        </button>
      </div>

      {/* Only once it has actually changed. A permanent warning under an email
          field is a warning nobody reads. */}
      {emailChanged ? (
        <p className="mt-3 text-sm text-warning-700 dark:text-orange-400">
          {user.name} will have to sign in with{" "}
          <span className="font-medium">{email.trim()}</span> from now on. Their
          password does not change. Tell them.
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mt-3 text-sm text-error-600 dark:text-error-400"
        >
          {error}
        </p>
      ) : null}
    </td>
  );
}

function EnrolmentEditor({
  user,
  courses,
  onDone,
}: {
  user: AdminUserRow;
  courses: CourseRow[];
  onDone: () => void;
}) {
  const [selected, setSelected] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Their current enrolments are not on the list row (it carries a count, not
  // the ids), so this starts empty and is explicit about what saving does:
  // it SETS the list, it does not add to it.
  const chosen = selected ?? [];

  async function save() {
    setBusy(true);
    try {
      await setUserEnrollments(user.id, chosen);
      setError(null);
      onDone();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not save the enrolments.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <td colSpan={9} className="bg-gray-50 px-4 py-4 dark:bg-white/[0.02]">
      <p className="mb-3 text-sm font-medium text-gray-800 dark:text-white/90">
        Courses for {user.name}
      </p>
      <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
        Saving replaces their enrolments with exactly what is ticked here.
        Removing one keeps their progress, so re-adding it later picks up where
        they left off.
      </p>
      {error ? (
        <p
          role="alert"
          className="mb-3 rounded-lg border border-error-500 bg-error-50 px-3 py-2 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400"
        >
          {error}
        </p>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-3">
        {courses.map((course) => (
          <label
            key={course.id}
            className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300"
          >
            <input
              type="checkbox"
              checked={chosen.includes(course.id)}
              onChange={(event) =>
                setSelected(
                  event.target.checked
                    ? [...chosen, course.id]
                    : chosen.filter((id) => id !== course.id),
                )
              }
              className="h-4 w-4 rounded border-gray-300 text-brand-500 dark:text-brand-400 focus:ring-brand-500/25"
            />
            {course.title}
          </label>
        ))}
      </div>
      <div className="mt-4 flex gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-50"
        >
          {busy ? "Saving…" : `Save ${counted(chosen.length, "course")}`}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-white dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
        >
          Cancel
        </button>
      </div>
    </td>
  );
}

function UsersConsole() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // Held only long enough to show the dialog. Never persisted, never logged.
  const [justCreated, setJustCreated] = useState<{
    name: string;
    email: string;
    password: string;
  } | null>(null);
  const [enrolling, setEnrolling] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [orgFilter, setOrgFilter] = useState("");

  const isSuperAdmin = me?.role === "super_admin";

  const load = useCallback(async () => {
    try {
      const [people, catalogue] = await Promise.all([
        listUsers(),
        listCourses().catch(() => [] as CourseRow[]),
      ]);
      setUsers(people);
      setCourses(catalogue);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not load users.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return users.filter((row) => {
      if (roleFilter === "organisation") {
        if (!isOrgRole(row.role)) return false;
      } else if (roleFilter && row.role !== roleFilter) {
        return false;
      }
      if (orgFilter === "public") {
        if (row.organization_id) return false;
      } else if (orgFilter && row.organization_id !== orgFilter) {
        return false;
      }
      if (!needle) return true;
      return `${row.name} ${row.email} ${row.organization_name ?? ""}`
        .toLowerCase()
        .includes(needle);
    });
  }, [users, search, roleFilter, orgFilter]);

  // ADMINS PER CUSTOMER. An organisation must keep at least two, and
  // until now the only place that floor was visible was inside each
  // customer's own portal — so the platform owner could not see from here
  // which of them was one resignation away from being stranded.
  const organisations = useMemo(() => {
    const found = new Map<
      string,
      { id: string; name: string; people: number; admins: number }
    >();
    for (const row of users) {
      if (!row.organization_id) continue;
      const existing = found.get(row.organization_id) ?? {
        id: row.organization_id,
        name: row.organization_name ?? "Unnamed",
        people: 0,
        admins: 0,
      };
      existing.people += 1;
      if (row.role === "org_admin") existing.admins += 1;
      found.set(row.organization_id, existing);
    }
    return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [users]);

  async function changeRole(row: AdminUserRow, role: string) {
    setBusyId(row.id);
    try {
      await setUserRole(row.id, role as AssignableRole);
      await load();
      setNotice(`${row.name} is now ${roleLabel(role).toLowerCase()}.`);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not change it.",
      );
    } finally {
      setBusyId(null);
    }
  }

  /**
   * Suspending, which is now two different actions depending on who is asking.
   *
   * AN ADMIN RAISES A REQUEST. The account is untouched until the platform
   * owner approves it — an admin seeing a problem can report it immediately
   * without being able to lock a paying customer out on their own judgement.
   * The reason is required, and the server refuses an empty one.
   *
   * THE OWNER ACTS DIRECTLY, because they are the person who would otherwise
   * be approving their own request.
   */
  async function toggleActive(row: AdminUserRow) {
    if (isSuperAdmin) {
      setBusyId(row.id);
      try {
        await setUserActive(row.id, !row.is_active);
        await load();
        setNotice(
          row.is_active
            ? `${row.name} is suspended and cannot sign in.`
            : `${row.name} can sign in again.`,
        );
        setError(null);
      } catch (caught) {
        setError(
          caught instanceof ApiError ? caught.message : "Could not change it.",
        );
      } finally {
        setBusyId(null);
      }
      return;
    }

    const reason = window.prompt(
      `Ask the platform owner to suspend ${row.name} (${row.email})?

` +
        "The account stays active until they approve it. Say why, because they " +
        "cannot act on a request with no reason.",
    );
    if (reason === null) return;
    setBusyId(row.id);
    try {
      await requestSuspension(row.id, reason);
      setNotice(
        `Sent to the platform owner. ${row.name} can still sign in until they decide.`,
      );
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not send it.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function remove(row: AdminUserRow) {
    // One confirmation, naming the person, because this is the destructive
    // action on the screen and the row above it looks identical.
    if (
      !window.confirm(
        `Remove ${row.name} (${row.email})?\n\nIf the account has any history it is closed rather than deleted, so nothing they have done is lost.`,
      )
    ) {
      return;
    }
    setBusyId(row.id);
    try {
      const result = await removeUser(row.id);
      await load();
      setNotice(result.explanation);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not remove the account.",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-title-sm font-bold text-gray-800 dark:text-white/90">
            Users
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {counted(users.length, "account")} on the platform.
            {isSuperAdmin
              ? " Organisation members are shown too, and managed by their own admins."
              : " Organisation members are managed by their own admins."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating((open) => !open)}
          className="rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600"
        >
          {creating ? "Close" : "Create a new user"}
        </button>
      </div>

      {/* DECISIONS WAITING, above everything else on the page.
          An ordinary admin can ask for an account to be switched off but not
          switch it off, so a pending request is somebody locked in limbo until
          the owner looks. Putting it below the table would be the same as not
          having it. Renders nothing when the queue is empty. */}
      {isSuperAdmin ? <SuspensionQueue onDecided={() => void load()} /> : null}

      {creating ? (
        <CreateUserPanel
          courses={courses}
          canMakeAdmins={Boolean(isSuperAdmin)}
          onCreated={(created) => {
            void load();
            setJustCreated(created);
          }}
          onClose={() => setCreating(false)}
        />
      ) : null}

      {justCreated ? (
        <NewAccountDialog
          name={justCreated.name}
          email={justCreated.email}
          password={justCreated.password}
          onClose={() => setJustCreated(null)}
        />
      ) : null}

      <div className="mb-4 flex flex-wrap gap-3">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search name or email"
          className="h-10 min-w-64 flex-1 rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
        />
        <select
          value={roleFilter}
          onChange={(event) => setRoleFilter(event.target.value)}
          aria-label="Filter by role"
          className="h-10 rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
        >
          <option value="">Every role</option>
          <option value="student">Student</option>
          <option value="admin">Admin</option>
          <option value="super_admin">Super admin</option>
          <option value="organisation">Organisation</option>
        </select>
        {isSuperAdmin && organisations.length > 0 ? (
          <select
            value={orgFilter}
            onChange={(event) => setOrgFilter(event.target.value)}
            aria-label="Filter by organisation"
            className="h-10 rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
          >
            <option value="">Every organisation</option>
            <option value="public">No organisation (public)</option>
            {organisations.map((organisation) => (
              <option key={organisation.id} value={organisation.id}>
                {organisation.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-error-500 bg-error-50 px-4 py-2.5 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mb-4 rounded-lg border border-success-500 bg-success-50 px-4 py-2.5 text-sm text-success-700 dark:bg-success-500/10 dark:text-success-400">
          {notice}
        </p>
      ) : null}

      {isSuperAdmin && organisations.length > 0 ? (
        <div className="mb-6 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-raised dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-800">
            <h2 className="text-sm font-semibold text-gray-800 dark:text-white/90">
              Administrators per organisation
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Each organisation needs at least two, so one person leaving cannot
              strand it.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 p-4">
            {organisations.map((organisation) => {
              const short = organisation.admins < 2;
              return (
                <button
                  key={organisation.id}
                  type="button"
                  onClick={() =>
                    setOrgFilter(
                      orgFilter === organisation.id ? "" : organisation.id,
                    )
                  }
                  className={`rounded-xl border px-4 py-2 text-left transition ${
                    orgFilter === organisation.id
                      ? "border-brand-500 ring-2 ring-brand-500/20"
                      : short
                        ? "border-warning-300 dark:border-warning-500/40"
                        : "border-gray-200 hover:border-brand-300 dark:border-gray-800"
                  }`}
                >
                  <span className="block text-sm font-medium text-gray-800 dark:text-white/90">
                    {organisation.name}
                  </span>
                  <span
                    className={`block text-xs ${
                      short
                        ? "font-medium text-warning-900 dark:text-warning-300"
                        : "text-gray-500 dark:text-gray-400"
                    }`}
                  >
                    {counted(organisation.admins, "admin")} ·{" "}
                    {counted(organisation.people, "person", "people")}
                    {short ? " · below the minimum" : ""}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {loading ? (
        <SkeletonRows rows={8} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon="👥"
          title="Nobody here"
          body={
            users.length === 0
              ? "No accounts yet."
              : "No account matches that search."
          }
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-raised dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[68rem]">
              <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:bg-white/[0.02] dark:text-gray-400">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Active</th>
                  <th className="px-4 py-3">Courses</th>
                  <th className="px-4 py-3">Tutor use</th>
                  <th className="px-4 py-3">Joined</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {visible.map((row) => {
                  const isMe = row.id === me?.id;
                  const orgMember = isOrgRole(row.role);
                  return (
                    <tr
                      key={row.id}
                      className="hover:bg-gray-50 dark:hover:bg-white/[0.02]"
                    >
                      {editing === row.id ? (
                        <DetailsEditor
                          user={row}
                          onDone={() => {
                            setEditing(null);
                            void load();
                          }}
                        />
                      ) : enrolling === row.id ? (
                        <EnrolmentEditor
                          user={row}
                          courses={courses}
                          onDone={() => {
                            setEnrolling(null);
                            void load();
                          }}
                        />
                      ) : (
                        <>
                          <td
                            className={`${CELL} font-medium text-gray-800 dark:text-white/90`}
                          >
                            <span className="flex items-center gap-2.5">
                              <Avatar
                                userId={row.id}
                                name={row.name}
                                size="sm"
                              />
                              <Link
                                href={`/admin/users/${row.id}`}
                                className="hover:text-brand-500 dark:text-brand-400"
                              >
                                {row.name}
                              </Link>
                            </span>
                            {isMe ? (
                              <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-600 dark:bg-brand-500/15 dark:text-brand-400">
                                You
                              </span>
                            ) : null}
                          </td>
                          <td
                            className={`${CELL} text-gray-600 dark:text-gray-400`}
                          >
                            {row.email}
                          </td>
                          <td className={CELL}>
                            {/* An organization's roles are not ours to change:
                                their admins manage their people, and a
                                dropdown here would be a cross-tenant write the
                                backend would refuse anyway. */}
                            {orgMember || !isSuperAdmin || isMe ? (
                              <span className="text-gray-600 dark:text-gray-400">
                                {roleLabel(row.role)}
                              </span>
                            ) : (
                              <select
                                value={row.role}
                                disabled={busyId === row.id}
                                onChange={(event) =>
                                  void changeRole(row, event.target.value)
                                }
                                aria-label={`Role for ${row.name}`}
                                className="rounded-lg border border-gray-300 bg-transparent px-2 py-1 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                              >
                                {ASSIGNABLE.map((option) => (
                                  <option
                                    key={option.value}
                                    value={option.value}
                                  >
                                    {option.label}
                                  </option>
                                ))}
                                {row.role === "teacher" ? (
                                  <option value="teacher">
                                    {roleLabel("teacher")}
                                  </option>
                                ) : null}
                              </select>
                            )}
                          </td>
                          <td className={CELL}>
                            <ActiveFlag active={row.is_active} />
                          </td>
                          <td
                            className={`${CELL} text-gray-600 dark:text-gray-400`}
                          >
                            {row.enrollments}
                          </td>
                          <td className={CELL}>
                            {row.has_used_tutor ? (
                              <span className="text-gray-600 dark:text-gray-400">
                                {counted(row.voice_sessions, "session")} ·{" "}
                                {row.voice_minutes} min
                              </span>
                            ) : (
                              <span className="text-gray-500 dark:text-gray-400">
                                Never used
                              </span>
                            )}
                          </td>
                          <td
                            className={`${CELL} whitespace-nowrap text-gray-500 dark:text-gray-400`}
                          >
                            {when(row.created_at)}
                          </td>
                          <td className={`${CELL} text-right`}>
                            <div className="flex flex-wrap justify-end gap-2">
                              <Link
                                href={`/admin/users/${row.id}`}
                                className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
                              >
                                Full record
                              </Link>
                              <button
                                type="button"
                                onClick={() => setEditing(row.id)}
                                className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
                              >
                                Edit
                              </button>
                              {!orgMember ? (
                                <button
                                  type="button"
                                  onClick={() => setEnrolling(row.id)}
                                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
                                >
                                  Courses
                                </button>
                              ) : null}
                              {/* Not against a platform owner, and not from
                                  an ordinary admin. The service refuses it —
                                  anyone who could raise a request against the
                                  only person able to decide it could lock the
                                  platform out — so the button would have done
                                  nothing but produce an error. */}
                              {!isMe &&
                              (isSuperAdmin ||
                                (row.is_active &&
                                  row.role !== "super_admin")) ? (
                                <button
                                  type="button"
                                  disabled={
                                    busyId === row.id ||
                                    (row.suspension_pending && !isSuperAdmin)
                                  }
                                  onClick={() => void toggleActive(row)}
                                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
                                >
                                  {!row.is_active
                                    ? isSuperAdmin
                                      ? "Reactivate"
                                      : "Suspended"
                                    : row.suspension_pending && !isSuperAdmin
                                      ? "Waiting on the owner"
                                      : isSuperAdmin
                                        ? "Suspend"
                                        : "Ask to suspend"}
                                </button>
                              ) : null}
                              {isSuperAdmin && !isMe ? (
                                <button
                                  type="button"
                                  disabled={busyId === row.id}
                                  onClick={() => void remove(row)}
                                  className="rounded-lg border border-error-300 px-3 py-1.5 text-xs font-medium text-error-600 transition hover:bg-error-50 disabled:opacity-50 dark:border-error-500/40 dark:text-error-400 dark:hover:bg-error-500/10"
                                >
                                  Delete
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminUsersPage() {
  return (
    <RequireAuth roles={["admin"]}>
      <UsersConsole />
    </RequireAuth>
  );
}
