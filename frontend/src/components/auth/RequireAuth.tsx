"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect } from "react";

import { useAuth } from "@/context/AuthContext";
import type { UserRole } from "@/lib/auth";

/** What a role is called out loud. Nobody says "org_admin" to a person. */
const ROLE_LABELS: Record<string, string> = {
  student: "a student",
  teacher: "a tutor",
  admin: "an admin",
  super_admin: "a super admin",
  org_admin: "an organisation admin",
  branch_manager: "a branch manager",
};

const AREA_LABELS: Record<string, string> = {
  student: "students",
  teacher: "tutors",
  admin: "platform admins",
  super_admin: "the platform owner",
  org_admin: "organisation admins",
  branch_manager: "branch managers",
};

/**
 * Client-side guard for signed-in areas.
 *
 * This is a UX convenience, NOT a security boundary. It only decides what to
 * render; anyone can bypass it with devtools. Every endpoint behind these
 * screens is independently gated by `require_role` on the FastAPI side, which
 * is what actually protects the data.
 */
export default function RequireAuth({
  children,
  roles,
}: {
  children: React.ReactNode;
  /** If given, the user's role must be one of these. */
  roles?: UserRole[];
}) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // A super admin passes anything an admin passes, mirroring `require_role` on
  // the backend. Widening here rather than in each caller means adding an
  // admin screen cannot accidentally lock out the person who runs the
  // platform — the failure mode of forgetting is worse than the duplication.
  const permitted = roles?.includes("admin")
    ? [...roles, "super_admin" as const]
    : roles;

  const allowed = user !== null && (!permitted || permitted.includes(user.role));

  useEffect(() => {
    if (loading) return;
    if (user === null) {
      // Preserve where they were going so sign-in can return them there.
      router.replace(`/signin?next=${encodeURIComponent(pathname)}`);
    }
  }, [loading, user, router, pathname]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
      </div>
    );
  }

  if (user === null) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Redirecting to sign in…
        </p>
      </div>
    );
  }

  if (!allowed) {
    // A REFUSAL NEEDS A WAY OUT. This used to be a red box with the raw role
    // slug in it and no link anywhere — so an organisation admin who followed a
    // stale bookmark to /admin/contact was stranded on a dead end telling them
    // they were "org_admin". Both halves are fixed: the wording is what a
    // person would say, and there is somewhere to go.
    const audience = (roles ?? [])
      .map((role) => AREA_LABELS[role] ?? role)
      .join(" and ");
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-raised dark:border-gray-800 dark:bg-white/[0.03]">
        <p className="mb-3 text-4xl" aria-hidden="true">
          🔒
        </p>
        <h1 className="mb-2 text-lg font-semibold text-gray-800 dark:text-white/90">
          This part is not for your account
        </h1>
        <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">
          {audience
            ? `Only ${audience} can open this page.`
            : "You do not have access to this page."}{" "}
          You are signed in as {ROLE_LABELS[user.role] ?? user.role}.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link
            href="/dashboard"
            className="rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600"
          >
            Go to your dashboard
          </Link>
          <Link
            href="/profile#help-and-support"
            className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
          >
            Ask for access
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
