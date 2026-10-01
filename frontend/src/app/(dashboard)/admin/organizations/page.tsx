"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import RequireAuth from "@/components/auth/RequireAuth";
import { Action } from "@/components/ui/Action";
import EmptyState from "@/components/ui/EmptyState";
import { SkeletonCards } from "@/components/ui/Skeleton";
import { counted } from "@/lib/plural";
import {
  type Organization,
  createOrganization,
  listOrganizations,
  suggestSlug,
} from "@/lib/organizations";

const FIELD =
  "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

function Console() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  // Once someone edits the slug by hand, stop overwriting it from the name.
  const [slugTouched, setSlugTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setOrganizations(await listOrganizations());
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not load organizations.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createOrganization({ name: name.trim(), slug: slug.trim() });
      setName("");
      setSlug("");
      setSlugTouched(false);
      setCreating(false);
      await load();
    } catch (caught) {
      // The backend owns slug validation; showing its message verbatim means
      // "that slug is reserved" reaches the person who can act on it.
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not create the organization.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="mb-1 text-title-sm font-bold text-gray-800 dark:text-white/90">
            Organizations
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Corporate customers, each with their own branches, departments and
            private training.
          </p>
        </div>
        {!creating ? (
          <Action onClick={() => setCreating(true)}>New organization</Action>
        ) : null}
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-2xl border border-error-500 bg-error-50 p-4 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400"
        >
          {error}
        </div>
      ) : null}

      {creating ? (
        <form
          onSubmit={handleCreate}
          className="rounded-2xl border border-gray-200 bg-white p-6 shadow-raised dark:border-gray-800 dark:bg-white/[0.03]"
        >
          <h2 className="mb-4 text-base font-semibold text-gray-800 dark:text-white/90">
            New organization
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label
                htmlFor="org-name"
                className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
              >
                Name
              </label>
              <input
                id="org-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!slugTouched) setSlug(suggestSlug(e.target.value));
                }}
                placeholder="Acme Corporation"
                className={FIELD}
                required
              />
            </div>
            <div>
              <label
                htmlFor="org-slug"
                className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
              >
                Slug
              </label>
              <input
                id="org-slug"
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value);
                  setSlugTouched(true);
                }}
                placeholder="acme"
                className={`${FIELD} font-mono`}
                required
              />
              <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                Their sign-in address:{" "}
                <span className="font-mono">/org/{slug || "…"}/login</span>.
                Lowercase letters, numbers and hyphens. This cannot be changed
                later without breaking their links.
              </p>
            </div>
          </div>
          <div className="mt-5 flex gap-3">
            <Action type="submit" loading={saving} disabled={!name || !slug}>
              Create
            </Action>
            <Action
              variant="secondary"
              onClick={() => {
                setCreating(false);
                setError(null);
              }}
            >
              Cancel
            </Action>
          </div>
        </form>
      ) : null}

      {loading ? (
        <SkeletonCards count={2} />
      ) : organizations.length === 0 ? (
        <EmptyState
          icon="🏢"
          title="No organizations yet"
          body="An organization is a corporate customer. Their people sign in at their own address and see only their own training, never the public catalogue."
          action={
            !creating ? (
              <Action onClick={() => setCreating(true)}>
                Create the first one
              </Action>
            ) : null
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {organizations.map((org) => (
            <Link
              key={org.id}
              href={`/admin/organizations/${org.id}`}
              className="group flex flex-col rounded-2xl border border-gray-200 bg-white p-5 shadow-raised transition-[transform,box-shadow,border-color] duration-200 ease-[var(--ease-out-soft)] hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lifted dark:border-gray-800 dark:bg-white/[0.03] dark:hover:border-brand-800"
            >
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-semibold text-gray-800 group-hover:text-brand-600 dark:text-white/90 dark:group-hover:text-brand-400">
                    {org.name}
                  </h2>
                  <p className="font-mono text-xs text-gray-500 dark:text-gray-400">
                    /org/{org.slug}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    org.is_active
                      ? "bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-400"
                      : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                  }`}
                >
                  {org.is_active ? "Active" : "Suspended"}
                </span>
              </div>

              <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                {counted(org.user_count, "person", "people")} ·{" "}
                {counted(org.branch_count, "branch", "branches")} ·{" "}
                {counted(org.department_count, "department")} ·{" "}
                {counted(org.course_count, "course")}
              </p>

              {/* The lockout warning. An organization with fewer than two
                  admins can be stranded by one person leaving, and only
                  platform staff can undo that — so it is surfaced here rather
                  than discovered by the customer. */}
              {org.admin_count < 2 ? (
                <p className="mt-3 rounded-lg bg-warning-50 px-3 py-2 text-xs text-warning-700 dark:bg-warning-500/10 dark:text-warning-400">
                  ⚠ {counted(org.admin_count, "administrator")}. Needs at least
                  2 so they cannot be locked out.
                </p>
              ) : null}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function OrganizationsPage() {
  /* Presentation only. Every endpoint behind this is `RequireSuperAdmin`
     server-side, which is what actually protects it. */
  return (
    <RequireAuth roles={["admin"]}>
      <Console />
    </RequireAuth>
  );
}
