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
  getUserEnrollments,
  removeUser,
  setUserEnrollments,
  setUserRole,
  requestSuspension,
  setUserActive,
  updateUser,
} from "@/lib/admin";
import { ApiError, errorText } from "@/lib/api";
import { type CourseRow, listCourses } from "@/lib/authoring";
import {
  type Organization,
  type OrganizationName,
  listOrganizationNames,
  listOrganizations,
} from "@/lib/organizations";
import { counted } from "@/lib/plural";
import { roleLabel } from "@/lib/roles";
import {
  isClean,
  passwordChecks,
  validateEmail,
  validateName,
  validateNewPassword,
  validatePhone,
} from "@/lib/validate";

/**
 * The people on the platform.
 *
 * WHO IS ON THIS SCREEN DEPENDS ON WHO IS READING IT. A super admin sees
 * everyone. A platform admin sees everybody except the staff ladder above them
 * — so the whole public B2C side and every customer's people in full, and no
 * other platform admin and no super admin. The server decides that; this file
 * must not show a control the server would then refuse, which is what the two
 * tables below are for.
 *
 * A CUSTOMER'S PEOPLE ARE READ-ONLY HERE. Every one of them can be opened and
 * read in full — that is the point of them being listed — and none of them can
 * be edited, suspended, enrolled or role-changed. Decision 170 is why: a
 * platform admin once renamed and then deleted a customer's course because one
 * screen mixed "ours" with "theirs". Sight solved the support problem; a write
 * button would bring the original problem back.
 *
 * DELETING ONE ASKS THE CUSTOMER. The button raises a request that the
 * organisation's own administrator approves or refuses, and the row says so
 * until they do.
 *
 * "Tutor" is gone from the product, not just from the dropdowns — migration
 * 0025 retired it and moved its one account to Student. It was the last piece
 * of the original schema, and leaving it in the code after taking it off the
 * screen is what let it keep the paywall bypass and the exam exemption.
 *
 * Active status is a green Yes or a red No, not a word in grey. Whether
 * somebody can sign in is the fastest thing to need to know down a column of
 * fifty rows, and colour reads faster than text.
 */

const CELL = "px-4 py-3 align-middle text-sm";
const FIELD =
  "w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

/**
 * What the role dropdown ON AN EXISTING ROW can hand out. Super admin only.
 *
 * NOT the same list as creating an account, which is the table below it.
 * `PATCH /admin/users/{id}/role` accepts these three and nothing else, and in
 * particular it does not accept `org_admin`: moving somebody onto a customer's
 * ladder is not a role change, it is a change of which company they belong to.
 * Offering it here would be a dropdown whose selection the server rejects.
 */
/**
 * How many people the table asks for at a time.
 *
 * There was no page size before, because there was no paging: the screen took
 * every account on the platform and filtered it in the browser. Fifty is a
 * screenful and a bit on a laptop, and Load more asks for fifty more.
 */
const PAGE = 50;

const ASSIGNABLE = [
  { value: "student", label: "Student" },
  // "Platform admin", not "Admin". It sits in a list beside "Organisation
  // admin", and the bare word left the reader to work out which of the two
  // ladders they were looking at — which is exactly the confusion that put
  // 25 issues in the tester's log under the wrong heading.
  { value: "admin", label: "Platform Admin" },
  { value: "super_admin", label: "Super Admin" },
] as const;

/**
 * What each kind of admin may CREATE, mirroring `MAY_CREATE` in
 * backend/app/routers/admin_users.py.
 *
 * A platform admin does not staff the platform. They run the public side and
 * they appoint a customer's first administrator; deciding who else gets to run
 * the platform is the super admin's, and that split is the whole point. It used
 * to be a rank comparison — anything at or below your own — which is how a
 * platform admin could mint a peer and then a super admin.
 *
 * The server refuses anything outside this table regardless. Keeping a copy
 * here is so the dropdown never offers a choice that comes back as a 403.
 */
const MAY_CREATE: Record<string, readonly string[]> = {
  super_admin: ["student", "admin", "super_admin", "org_admin"],
  admin: ["student", "org_admin"],
};

/**
 * A role that only exists inside a customer.
 *
 * `dept_admin` was missing, which mattered little while a platform admin could
 * not see one. They can now, and a filter called "any organisation member"
 * that silently drops every HR and IT admin is worse than not having it.
 *
 * Deliberately by ROLE rather than by `organization_id`: a student inside a
 * customer is still a student, and somebody filtering for "student" expects to
 * find them. The organisation filter beside it is the one that asks the other
 * question.
 */
function isOrgRole(role: string): boolean {
  return (
    role === "org_admin" || role === "branch_manager" || role === "dept_admin"
  );
}

/**
 * Whether this row is ours to CHANGE, as opposed to merely see.
 *
 * The twin of `can_manage` in backend/app/routers/admin_users.py, and it has to
 * stay the twin: the write routes answer 404 for anything this returns false
 * for, so a button shown here that the server refuses is a dead end with an
 * error message on it.
 *
 * ANYBODY INSIDE AN ORGANISATION, not just its administrators. Was
 * `role !== "org_admin"`, which was right while a platform admin could only see
 * the administrators; now they see the whole roster and every one of those
 * people is the customer's.
 */
function canManage(row: AdminUserRow, isSuperAdmin: boolean): boolean {
  if (isSuperAdmin) return true;
  return row.organization_id === null;
}

/**
 * Whether the record behind this row opens.
 *
 * The twin of `_visible`, which is a WIDER door than `canManage`: the dossier,
 * the enrolment list and the extensions are reads, and a platform admin may
 * read a customer's people in full. So the name stays a link and "Full record"
 * stays on the row even where every other button is gone.
 */
function canOpen(
  row: AdminUserRow,
  isSuperAdmin: boolean,
  myId: string | undefined,
): boolean {
  if (isSuperAdmin) return true;
  // YOUR OWN ROW FIRST, exactly as `can_see` does. Without it a platform admin
  // could not open their own record — their role is `admin`, so the staff
  // check below caught them, and the one row on the screen that is definitely
  // theirs was the one row that would not open.
  if (row.id === myId) return true;
  return row.role !== "admin" && row.role !== "super_admin";
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
  viewerRole,
  onCreated,
  onClose,
}: {
  courses: CourseRow[];
  /** The signed-in person's role. It decides what this form may offer. */
  viewerRole: string;
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
  const [organisations, setOrganisations] = useState<OrganizationName[]>([]);
  const [organisationId, setOrganisationId] = useState("");

  const options = (MAY_CREATE[viewerRole] ?? ["student"]).map((value) => ({
    value,
    label: roleLabel(value),
  }));

  const needsOrganisation = role === "org_admin";

  const passwordRules = passwordChecks(password);

  // Fetched when the form opens rather than with the page, because this is the
  // only screen that needs it and most visits here never open the form.
  //
  // Names and ids only - the endpoint deliberately withholds seat counts and
  // limits, so an admin filling in a dropdown does not also learn how large
  // every customer is.
  useEffect(() => {
    let live = true;
    listOrganizationNames()
      .then((found) => {
        if (live) setOrganisations(found);
      })
      .catch(() => {
        // Left empty. The field below says so, and says it in a way that
        // explains the consequence rather than reporting a failed request.
        if (live) setOrganisations([]);
      });
    return () => {
      live = false;
    };
  }, []);

  async function submit() {
    // Checked here as well as server-side, so a mistyped address lands
    // under the field instead of coming back as a banner after a round trip.
    const found = {
      name: validateName(name),
      email: validateEmail(email),
      phone: validatePhone(phone),
      // `validateNewPassword`, NOT `validatePassword`. The latter checks only
      // the length, so a password missing a digit or a symbol sailed past the
      // form and came back from the server as a red banner at the top of the
      // page - nowhere near the field it was about, and about a field the
      // admin had not typed in, because the box comes pre-filled.
      password: validateNewPassword(password),
      // An organisation admin with no organisation administers nothing. The
      // server refuses it too; catching it here puts the message under the
      // field instead of in a banner after a round trip.
      organisation:
        needsOrganisation && !organisationId
          ? "Choose the organisation this administrator runs."
          : null,
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
        // Sent only for the role that may carry one. Any other role with an
        // organisation is a 400 - a platform account quietly stamped with a
        // customer's id is the exact shape that let a tenant reach one
        // through its own member list.
        organization_id: needsOrganisation ? organisationId : null,
      });
      // The password travels back so it can be SHOWN once. It is stored as
      // an argon2 hash and nothing else, so this is the only moment it
      // exists in readable form anywhere.
      onCreated({ name: name.trim(), email: email.trim(), password });
      onClose();
    } catch (caught) {
      const message =
        caught instanceof ApiError
          ? caught.message
          : "Could not create the account.";
      // PUT THE COMPLAINT WHERE THE PROBLEM IS. A message about the password
      // or the email address at the top of a nine-field form makes the reader
      // hunt for which box it means. The checks above catch most of these
      // before a request is sent; this is for anything the server knows and
      // the browser does not.
      const field = /password/i.test(message)
        ? "password"
        : /e-?mail|address/i.test(message)
          ? "email"
          : null;
      if (field) {
        setFieldErrors((current) => ({ ...current, [field]: message }));
        setError(null);
      } else {
        setError(message);
      }
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
          {/* THE RULES, BESIDE THE FIELD THEY ARE ABOUT. The same list the
              sign-up form shows, from the same `passwordChecks` that mirrors
              backend/app/core/passwords.py — so it cannot go all-green while
              the server still refuses. An admin who edits the generated
              password sees which rule they have broken as they type, instead
              of finding out from a banner after pressing Create. */}
          <ul className="mt-2 space-y-1">
            {passwordRules.map((rule) => (
              <li
                key={rule.label}
                className={`flex items-center gap-1.5 text-xs ${
                  rule.met
                    ? "text-success-700 dark:text-success-400"
                    : "text-gray-500 dark:text-gray-400"
                }`}
              >
                <span aria-hidden="true" className="w-3 shrink-0 text-center">
                  {rule.met ? "✓" : "–"}
                </span>
                {rule.label}
              </li>
            ))}
          </ul>
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
          {needsOrganisation ? (
            <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
              They will run that organisation&rsquo;s people and training from
              its own portal, not from here.
            </p>
          ) : null}
        </div>
        {/* Shown only for the one role that can have an organisation, rather
            than greyed out for the rest. A disabled field still asks the
            reader to work out why it is disabled. */}
        {needsOrganisation ? (
          <div>
            <label
              htmlFor="new-organisation"
              className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
            >
              Organisation
            </label>
            {organisations.length === 0 ? (
              <p className="rounded-lg border border-warning-300 bg-warning-50 px-3 py-2 text-sm text-warning-900 dark:border-warning-500/40 dark:bg-warning-500/15 dark:text-warning-300">
                No organisations to choose from. One has to exist before it can
                have an administrator.
              </p>
            ) : (
              <select
                id="new-organisation"
                value={organisationId}
                onChange={(event) => setOrganisationId(event.target.value)}
                aria-invalid={Boolean(fieldErrors.organisation)}
                className={FIELD}
              >
                <option value="">Choose an organisation</option>
                {organisations.map((organisation) => (
                  <option key={organisation.id} value={organisation.id}>
                    {organisation.name}
                  </option>
                ))}
              </select>
            )}
            <FieldNote message={fieldErrors.organisation} />
          </div>
        ) : null}
      </div>

      {/* HIDDEN FOR AN ORGANISATION ADMIN. These are our public courses;
          enrolling a customer's administrator in them on the way past is not
          what this form is for, and their own catalogue is theirs to assign. */}
      <fieldset className={needsOrganisation ? "hidden" : "mt-5"}>
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
    <td colSpan={10} className="px-4 py-4">
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
  // `null` means NOT LOADED YET, and every branch below treats it that way.
  // Saving sends the whole list, so an editor that starts empty and saves
  // deletes every course the student had. That is what used to happen: the
  // list row carries a count rather than ids, nothing read the ids, and adding
  // one course silently removed the rest.
  const [selected, setSelected] = useState<string[] | null>(null);
  const [original, setOriginal] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getUserEnrollments(user.id)
      .then((ids) => {
        if (cancelled) return;
        setSelected(ids);
        setOriginal(ids);
      })
      .catch((caught) => {
        if (cancelled) return;
        // NOT an empty list. Falling back to `[]` here is the original bug
        // wearing a different hat — the operator would see nothing ticked,
        // tick one course, and wipe the others. Refuse to edit instead.
        setLoadError(
          errorText(caught, "Could not read their current courses."),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  const loaded = selected !== null;
  const chosen = selected ?? [];
  // PUBLIC COURSES ONLY, which is all this editor can save. A super admin's
  // course list also holds every organisation's private training, and ticking
  // one of those came back as "one of those courses does not exist".
  const offered = courses.filter((course) => course.organization_id === null);
  // What saving would take away. Named on screen before the button is pressed,
  // because "saving replaces the list" is a sentence people read past.
  const removing = (original ?? []).filter((id) => !chosen.includes(id));
  const removingTitles = removing.map(
    (id) => courses.find((course) => course.id === id)?.title ?? "a course",
  );

  async function save() {
    if (!loaded) return;
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
    <td colSpan={10} className="bg-gray-50 px-4 py-4 dark:bg-white/[0.02]">
      <p className="mb-3 text-sm font-medium text-gray-800 dark:text-white/90">
        Courses for {user.name}
      </p>
      <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
        Ticked is what they have now. Saving replaces their enrolments with
        exactly what is ticked here. Removing one keeps their progress, so
        re-adding it later picks up where they left off.
      </p>
      {loadError ? (
        <p
          role="alert"
          className="mb-3 rounded-lg border border-error-500 bg-error-50 px-3 py-2 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400"
        >
          {loadError} Nothing can be saved until their current courses are
          known, or this would remove the ones already there.
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="mb-3 rounded-lg border border-error-500 bg-error-50 px-3 py-2 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400"
        >
          {error}
        </p>
      ) : null}
      {removingTitles.length > 0 ? (
        <p
          role="status"
          className="mb-3 rounded-lg border border-warning-300 bg-warning-50 px-3 py-2 text-sm text-warning-800 dark:border-warning-500/40 dark:bg-warning-500/10 dark:text-warning-400"
        >
          Saving will take away {counted(removingTitles.length, "course")}:{" "}
          {removingTitles.join(", ")}.
        </p>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-3">
        {offered.map((course) => (
          <label
            key={course.id}
            className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300"
          >
            <input
              type="checkbox"
              disabled={!loaded}
              checked={chosen.includes(course.id)}
              onChange={(event) =>
                setSelected(
                  event.target.checked
                    ? [...chosen, course.id]
                    : chosen.filter((id) => id !== course.id),
                )
              }
              className="h-4 w-4 rounded border-gray-300 text-brand-500 dark:text-brand-400 focus:ring-brand-500/25 disabled:opacity-40"
            />
            {course.title}
          </label>
        ))}
      </div>
      <div className="mt-4 flex gap-3">
        <button
          type="button"
          disabled={busy || !loaded}
          onClick={() => void save()}
          className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-50"
        >
          {!loaded
            ? "Loading their courses…"
            : busy
              ? "Saving…"
              : `Save ${counted(chosen.length, "course")}`}
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

  //: What the server was asked for, so "showing 10 of 5,015" can be true.
  const [total, setTotal] = useState(0);
  const [shown, setShown] = useState(PAGE);
  //: Names for the filter dropdown. Any platform admin may read these.
  const [orgNames, setOrgNames] = useState<OrganizationName[]>([]);
  //: Seat and admin counts for the floor panel, computed in SQL. Super admin
  //: only, which is why it is a separate call from the names above.
  const [orgStats, setOrgStats] = useState<Organization[]>([]);

  const query = useMemo(
    () => ({
      q: search.trim() || undefined,
      role: roleFilter && roleFilter !== "organisation" ? roleFilter : undefined,
      organization_id:
        orgFilter && orgFilter !== "public" ? orgFilter : undefined,
      public_only: orgFilter === "public" || undefined,
      limit: shown,
    }),
    [search, roleFilter, orgFilter, shown],
  );

  const load = useCallback(async () => {
    try {
      const [people, catalogue] = await Promise.all([
        listUsers(query),
        listCourses().catch(() => [] as CourseRow[]),
      ]);
      setUsers(people.items);
      setTotal(people.total);
      setCourses(catalogue);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not load users.",
      );
    } finally {
      setLoading(false);
    }
  }, [query]);

  // DEBOUNCED, because this is a database query now rather than a filter over
  // an array already in memory, and the search box fires on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  // A new filter starts at the first page again. Without this, narrowing to
  // one person while two hundred rows are on screen asks for two hundred
  // matches of a search that has one.
  useEffect(() => {
    setShown(PAGE);
  }, [search, roleFilter, orgFilter]);

  useEffect(() => {
    listOrganizationNames()
      .then(setOrgNames)
      .catch(() => setOrgNames([]));
  }, []);

  useEffect(() => {
    if (!isSuperAdmin) return;
    listOrganizations()
      .then(setOrgStats)
      .catch(() => setOrgStats([]));
  }, [isSuperAdmin]);

  // THE SERVER HAS ALREADY FILTERED. The one thing left is "organisation",
  // which means any of several roles rather than one, and is cheaper to keep
  // here than to teach the query.
  const visible = useMemo(
    () =>
      roleFilter === "organisation"
        ? users.filter((row) => isOrgRole(row.role))
        : users,
    [users, roleFilter],
  );

  // ADMINS PER CUSTOMER. An organisation must keep at least two, and
  // until now the only place that floor was visible was inside each
  // customer's own portal — so the super admin could not see from here
  // which of them was one resignation away from being stranded.
  // COUNTED IN SQL, not tallied here. `/admin/organizations` has answered
  // `user_count` and `admin_count` all along, and this screen already calls
  // it, so the browser was recomputing numbers it had been handed — over a
  // full copy of the platform it no longer downloads.
  const organisations = useMemo(
    () =>
      [...orgStats]
        .map((organisation) => ({
          id: organisation.id,
          name: organisation.name,
          people: organisation.user_count,
          admins: organisation.admin_count,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [orgStats],
  );

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
      `Ask the super admin to suspend ${row.name} (${row.email})?

` +
        "The account stays active until they approve it. Say why, because they " +
        "cannot act on a request with no reason.",
    );
    if (reason === null) return;
    setBusyId(row.id);
    try {
      await requestSuspension(row.id, reason);
      setNotice(
        `Sent to the super admin. ${row.name} can still sign in until they decide.`,
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

  /**
   * Remove an account — or ask the customer, which is the same button.
   *
   * WHICH ONE IT IS DEPENDS ON THE ACCOUNT, so the confirmation has to say
   * which before it is pressed. Telling somebody "this is permanent" and then
   * quietly raising a request is the kind of mismatch that makes people press
   * it twice; telling them "this asks Acme" and then deleting outright is
   * worse.
   *
   * A CUSTOMER'S ACCOUNT NEEDS A REASON, and the server refuses an empty one —
   * the administrator on the other end has to decide from it. Prompted here
   * rather than sent blank and bounced back.
   */
  async function remove(row: AdminUserRow) {
    const theirs = row.organization_id !== null;
    let reason = "";

    if (theirs) {
      const company = row.organization_name ?? "their organisation";
      const answer = window.prompt(
        `${row.name} belongs to ${company}, so this asks ${company}'s ` +
          `administrators to approve it. Nothing happens to the account ` +
          `until they do.\n\nWhy should it be removed?`,
        "",
      );
      // Cancel, as opposed to an empty box: both stop here, and the server
      // would refuse the empty one anyway.
      if (answer === null) return;
      reason = answer.trim();
      if (!reason) {
        setError("Say why it should be removed. The request needs a reason.");
        return;
      }
    } else if (
      !window.confirm(
        `Remove ${row.name} (${row.email})?\n\nIf the account has any history it is closed rather than deleted, so nothing they have done is lost.`,
      )
    ) {
      return;
    }

    setBusyId(row.id);
    try {
      const result = await removeUser(row.id, reason);
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
            {counted(total, "account")} on the platform.
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
          viewerRole={me?.role ?? "admin"}
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
          {/* A platform admin cannot see any platform staff but themselves, so
              these two would filter a list of nobody. An option that always
              returns zero rows reads as a bug in the data. */}
          {isSuperAdmin ? (
            <>
              <option value="admin">Platform Admin</option>
              <option value="super_admin">Super Admin</option>
            </>
          ) : null}
          <option value="org_admin">Organisation Admin</option>
          <option value="branch_manager">Branch Manager</option>
          <option value="dept_admin">Department Admin</option>
          <option value="organisation">Any organisation role</option>
        </select>
        {orgNames.length > 0 ? (
          <select
            value={orgFilter}
            onChange={(event) => setOrgFilter(event.target.value)}
            aria-label="Filter by organisation"
            className="h-10 rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
          >
            <option value="">Every organisation</option>
            <option value="public">No organisation (public)</option>
            {orgNames.map((organisation) => (
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

      {/* HOW MANY OF HOW MANY. A table that stops at fifty rows and says
          nothing looks exactly like a table with fifty rows in it. */}
      {!loading && total > visible.length ? (
        <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
          Showing {visible.length} of {counted(total, "match", "matches")}.{" "}
          <button
            type="button"
            onClick={() => setShown((n) => n + PAGE)}
            className="font-medium text-brand-500 hover:text-brand-600 dark:text-brand-400"
          >
            Load more
          </button>
        </p>
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
            <table className="table-wide w-full min-w-[68rem]">
              <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:bg-white/[0.02] dark:text-gray-400">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Email</th>
                  {/* WHO THEY BELONG TO. Every account was listed in one flat
                      table with no indication of which customer it came from,
                      so the owner could not tell a public B2C learner from
                      somebody's employee without opening each record. The API
                      already returned `organization_name` and the filter above
                      already used it; only the column was missing. Issue 40. */}
                  <th className="px-4 py-3">Belongs to</th>
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
                  // Theirs or ours. Two doors, not one: `open` is the wider
                  // — a customer's people can be read in full — and `mine` is
                  // the narrow one that every write hangs off.
                  const mine = canManage(row, Boolean(isSuperAdmin));
                  const open = canOpen(row, Boolean(isSuperAdmin), me?.id);
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
                              {/* A LINK WHEREVER THE RECORD OPENS, which
                                  now includes every customer's people — the
                                  dossier is a read. Only the staff ladder above
                                  this admin is plain text, and that is because
                                  those rows are not in the list at all. */}
                              {open ? (
                                <Link
                                  href={`/admin/users/${row.id}`}
                                  className="hover:text-brand-500 dark:text-brand-400"
                                >
                                  {row.name}
                                </Link>
                              ) : (
                                <span>{row.name}</span>
                              )}
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
                            {row.organization_name ? (
                              <span className="text-gray-700 dark:text-gray-300">
                                {row.organization_name}
                              </span>
                            ) : (
                              // NOT an empty cell. A blank reads as missing
                              // data; this account genuinely belongs to no
                              // customer, which is a fact worth stating.
                              <span className="text-gray-400 dark:text-gray-500">
                                Public
                              </span>
                            )}
                          </td>
                          <td className={CELL}>
                            {/* An organization's roles are not ours to change:
                                their admins manage their people, and a
                                dropdown here would be a cross-tenant write the
                                backend would refuse anyway. Role changes are
                                the super admin's in any case - `PATCH
                                /users/{id}/role` is RequireSuperAdmin. */}
                            {orgMember || !mine || !isSuperAdmin || isMe ? (
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
                            <div className="cell-actions flex flex-wrap justify-end gap-2">
                              {/* WAITING ON THE CUSTOMER. Shown before the
                                  buttons because it is the thing that changes
                                  what pressing them will do — and because an
                                  admin who cannot see it presses Delete again
                                  and gets a 409. */}
                              {row.deletion_pending ? (
                                <span className="rounded-full bg-warning-50 px-2.5 py-1 text-xs font-medium text-warning-900 dark:bg-warning-500/15 dark:text-warning-300">
                                  Deletion requested
                                </span>
                              ) : null}
                              {/* READ-ONLY, AND SAID SO. A platform admin sees
                                  a customer's people in full and changes none
                                  of them. An empty cell reads as something
                                  failing to load. */}
                              {!mine ? (
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                  Managed by{" "}
                                  {row.organization_name ?? "their organisation"}
                                </span>
                              ) : null}
                              {open ? (
                                <Link
                                  href={`/admin/users/${row.id}`}
                                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
                                >
                                  Full record
                                </Link>
                              ) : null}
                              {mine ? (
                                <button
                                  type="button"
                                  onClick={() => setEditing(row.id)}
                                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
                                >
                                  Edit
                                </button>
                              ) : null}
                              {/* Public accounts only. Somebody inside an
                                  organisation is trained there, and this editor
                                  could not save a thing for them. */}
                              {mine && !orgMember && !row.organization_id ? (
                                <button
                                  type="button"
                                  onClick={() => setEnrolling(row.id)}
                                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
                                >
                                  Courses
                                </button>
                              ) : null}
                              {/* Not against a super admin, and not from
                                  an ordinary admin. The service refuses it —
                                  anyone who could raise a request against the
                                  only person able to decide it could lock the
                                  platform out — so the button would have done
                                  nothing but produce an error.

                                  THAT WAS THE INTENT AND NOT THE CONDITION.
                                  `isSuperAdmin ||` let a super admin see
                                  Suspend on another super admin's row, press
                                  it, and get a 409. The tester read the button
                                  as the ability and kept issue 3 open. A super
                                  admin's row now only offers Reactivate, and
                                  only when it is already switched off. */}
                              {mine &&
                              !isMe &&
                              (row.role === "super_admin"
                                ? isSuperAdmin && !row.is_active
                                : isSuperAdmin || row.is_active) ? (
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
                              {/* THE LABEL SAYS WHICH OF THE TWO THINGS IT
                                  DOES. "Delete" on a customer's account would
                                  be a lie — it raises a request — and the
                                  difference matters most to the person about to
                                  press it. Disabled once something is already
                                  queued, because a second press only produces a
                                  409. */}
                              {isSuperAdmin && !isMe ? (
                                <button
                                  type="button"
                                  disabled={busyId === row.id || row.deletion_pending}
                                  onClick={() => void remove(row)}
                                  className="rounded-lg border border-error-300 px-3 py-1.5 text-xs font-medium text-error-600 transition hover:bg-error-50 disabled:opacity-50 dark:border-error-500/40 dark:text-error-400 dark:hover:bg-error-500/10"
                                >
                                  {row.deletion_pending
                                    ? "Waiting on them"
                                    : row.organization_id
                                      ? "Ask to delete"
                                      : "Delete"}
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
