"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import OrgShell from "@/components/org/OrgShell";
import { useAuth } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";
import { type OrgProfile, getOrgProfile, roleLabel } from "@/lib/orgPortal";

/**
 * The organization's landing page.
 *
 * Also the place the tenant boundary becomes visible to a person rather than
 * to a test: someone signed in to a different organization gets told plainly
 * that this is not theirs, rather than a bare 404 or a redirect loop.
 */
export default function OrgHomePage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [profile, setProfile] = useState<OrgProfile | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "denied" | "error">(
    "loading",
  );
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace(`/org/${slug}/login?next=/org/${slug}`);
      return;
    }
    getOrgProfile(slug)
      .then((found) => {
        setProfile(found);
        setStatus("ok");
      })
      .catch((caught) => {
        // 404 here means "not your organization" as often as it means "no such
        // organization" — the backend refuses to distinguish them, on purpose,
        // so that this page cannot be used to enumerate customers.
        if (caught instanceof ApiError && caught.status === 404) {
          setStatus("denied");
        } else {
          setMessage(
            caught instanceof Error ? caught.message : "Something went wrong.",
          );
          setStatus("error");
        }
      });
  }, [slug, user, authLoading, router]);

  if (status === "loading" || authLoading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-24">
        <div className="h-8 w-64 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
      </div>
    );
  }

  if (status === "denied") {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <p className="mb-3 text-4xl" aria-hidden="true">
          🔒
        </p>
        <h1 className="mb-2 text-xl font-bold text-gray-800 dark:text-white/90">
          This isn&apos;t your organization
        </h1>
        <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">
          You are signed in, but not as a member of{" "}
          <span className="font-mono">{slug}</span>. If you believe you should
          be, ask that organization&apos;s administrator to add you.
        </p>
        <Link
          href="/dashboard"
          className="text-sm font-medium text-brand-500 dark:text-brand-400 hover:text-brand-600"
        >
          Go to your own dashboard
        </Link>
      </div>
    );
  }

  if (status === "error" || !profile) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="mb-2 text-xl font-bold text-gray-800 dark:text-white/90">
          We couldn&apos;t load this
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{message}</p>
      </div>
    );
  }

  return (
    <OrgShell
      slug={slug}
      organizationName={profile.name}
      role={profile.my_role}
      isAdmin={profile.is_org_admin}
      canManagePeople={profile.can_manage_people}
      canAuthor={profile.can_author}
      isPlatformStaff={profile.is_platform_staff}
    >
      <div className="mb-8">
        <h1 className="text-title-sm font-bold text-gray-800 dark:text-white/90">
          Welcome, {user?.name}
        </h1>
        {/* WHICH TEAM, not just which role. A department admin needs to see
            "Department admin · Sales" at the top of every screen, because
            every screen below is scoped to Sales and a page that silently
            shows a subset reads as a page that is broken. */}
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {roleLabel(profile.my_role)}
          {profile.department_name ? ` · ${profile.department_name}` : ""}
          {profile.branch_name ? ` · ${profile.branch_name}` : ""}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/dashboard"
          className="rounded-2xl border border-gray-200 bg-white p-5 shadow-raised transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lifted dark:border-gray-800 dark:bg-white/[0.03]"
        >
          <p className="mb-1 text-2xl" aria-hidden="true">
            🎓
          </p>
          <p className="font-semibold text-gray-800 dark:text-white/90">
            My training
          </p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Courses, the AI tutor, quizzes and certificates.
          </p>
        </Link>

        <Link
          href={`/org/${slug}/documents`}
          className="rounded-2xl border border-gray-200 bg-white p-5 shadow-raised transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lifted dark:border-gray-800 dark:bg-white/[0.03]"
        >
          <p className="mb-1 text-2xl" aria-hidden="true">
            📄
          </p>
          <p className="font-semibold text-gray-800 dark:text-white/90">
            Documents
          </p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Policies, handbooks and procedures shared with you.
          </p>
        </Link>

        {profile.is_org_admin ? (
          <>
            <Link
              href={`/org/${slug}/courses`}
              className="rounded-2xl border border-gray-200 bg-white p-5 shadow-raised transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lifted dark:border-gray-800 dark:bg-white/[0.03]"
            >
              <p className="mb-1 text-2xl" aria-hidden="true">
                🎓
              </p>
              <p className="font-semibold text-gray-800 dark:text-white/90">
                Training
              </p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Build your own courses. The tutor teaches from what you write.
              </p>
            </Link>
            <Link
              href={`/org/${slug}/admin`}
              className="rounded-2xl border border-gray-200 bg-white p-5 shadow-raised transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lifted dark:border-gray-800 dark:bg-white/[0.03]"
            >
              <p className="mb-1 text-2xl" aria-hidden="true">
                👥
              </p>
              <p className="font-semibold text-gray-800 dark:text-white/90">
                People
              </p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Add colleagues, set roles, assign branches and departments.
              </p>
            </Link>
            <Link
              href={`/org/${slug}/admin/audit`}
              className="rounded-2xl border border-gray-200 bg-white p-5 shadow-raised transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lifted dark:border-gray-800 dark:bg-white/[0.03]"
            >
              <p className="mb-1 text-2xl" aria-hidden="true">
                📋
              </p>
              <p className="font-semibold text-gray-800 dark:text-white/90">
                Activity log
              </p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Who signed in, what they trained on, and every change made here.
              </p>
            </Link>
          </>
        ) : null}

        {/* THE DEPARTMENT ADMIN — the HR admin, the sales admin.
            Two tiles, both worded around the department rather than the
            company, because that is the whole of what they can reach: their
            own team's people and their own team's training. Nothing here
            offers the activity log, which is the organization's and would
            show them every other department's business. */}
        {!profile.is_org_admin && profile.is_dept_admin ? (
          <>
            <Link
              href={`/org/${slug}/courses`}
              className="rounded-2xl border border-gray-200 bg-white p-5 shadow-raised transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lifted dark:border-gray-800 dark:bg-white/[0.03]"
            >
              <p className="mb-1 text-2xl" aria-hidden="true">
                🎓
              </p>
              <p className="font-semibold text-gray-800 dark:text-white/90">
                {profile.department_name ?? "Department"} training
              </p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Write courses for your team. The tutor teaches from what you
                write, and only your team sees them.
              </p>
            </Link>
            <Link
              href={`/org/${slug}/admin`}
              className="rounded-2xl border border-gray-200 bg-white p-5 shadow-raised transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lifted dark:border-gray-800 dark:bg-white/[0.03]"
            >
              <p className="mb-1 text-2xl" aria-hidden="true">
                👥
              </p>
              <p className="font-semibold text-gray-800 dark:text-white/90">
                {profile.department_name ?? "My department"}
              </p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Add people to your team, set what they do, and see how they are
                getting on.
              </p>
            </Link>
          </>
        ) : null}

        {!profile.is_org_admin && profile.my_role === "branch_manager" ? (
          <>
            <Link
              href={`/org/${slug}/admin`}
              className="rounded-2xl border border-gray-200 bg-white p-5 shadow-raised transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lifted dark:border-gray-800 dark:bg-white/[0.03]"
            >
              <p className="mb-1 text-2xl" aria-hidden="true">
                👥
              </p>
              <p className="font-semibold text-gray-800 dark:text-white/90">
                My branch
              </p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                The people in {profile.branch_name ?? "your branch"}.
              </p>
            </Link>
            {/* Sir's rule of 2026-10-01: a branch manager's course and
                document changes go to the organisation admin, like their
                people changes. Asking needs a way in. */}
            <Link
              href={`/org/${slug}/courses`}
              className="rounded-2xl border border-gray-200 bg-white p-5 shadow-raised transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lifted dark:border-gray-800 dark:bg-white/[0.03]"
            >
              <p className="mb-1 text-2xl" aria-hidden="true">
                🎓
              </p>
              <p className="font-semibold text-gray-800 dark:text-white/90">
                {profile.branch_name ?? "Branch"} training
              </p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Ask to add or change courses for the departments in your
                branch. The organisation administrator approves them.
              </p>
            </Link>
          </>
        ) : null}
      </div>
    </OrgShell>
  );
}
