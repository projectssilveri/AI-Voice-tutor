"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { ThemeToggleButton } from "@/components/common/ThemeToggleButton";
import UserDropdown from "@/components/header/UserDropdown";
import Logo from "@/components/marketing/ui/Logo";

/**
 * The chrome every organization page sits in.
 *
 * The portal pages were bare centred divs with no header, no navigation and no
 * way back. This gives them the same shell, and the same account menu the rest
 * of the product uses: the avatar opens a dropdown with the photo, the name and
 * role, a link to the account and settings page, and sign out. Org admins,
 * managers and learners get exactly what a B2C learner and a platform admin
 * already had, so nobody inside an organization is a second-class citizen.
 *
 * It is NOT the dashboard shell, deliberately: that one carries marketplace
 * nav, pricing and the platform admin section, none of which exists inside a
 * walled garden. An org learner should never be shown something to buy.
 */
export default function OrgShell({
  slug,
  organizationName,
  canAuthor,
  canManagePeople,
  isAdmin,
  isPlatformStaff,
  children,
}: {
  slug: string;
  organizationName?: string | null;
  /** The signed-in person's role. The account menu reads it from the session. */
  role?: string | null;
  /** Writes training. An org admin, or a department admin for their own team. */
  canAuthor?: boolean;
  /** Adds and edits people: org admin, branch manager or department admin. */
  canManagePeople?: boolean;
  isAdmin?: boolean;
  isPlatformStaff?: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();

  // THREE SEPARATE PERMISSIONS, not one "admin" flag.
  //
  // A department admin writes courses and runs people; a branch manager runs
  // people and writes nothing; only an org admin reads the organization's
  // activity log, because that log covers every department and showing it to
  // one department's admin is the leak this whole role exists to avoid.
  //
  // `isAdmin` still drives the log so an older caller that passes only that
  // prop keeps its previous behaviour.
  const mayAuthor = canAuthor ?? isAdmin;
  const mayManagePeople = canManagePeople ?? isAdmin;

  const tabs = [
    { href: `/org/${slug}`, label: "Home", exact: true },
    { href: "/dashboard", label: "My training", exact: false },
    // Documents are for everyone: a learner needs the handbook as much as an
    // admin does; the library itself decides which files they see.
    { href: `/org/${slug}/documents`, label: "Documents", exact: false },
    ...(mayAuthor
      ? [{ href: `/org/${slug}/courses`, label: "Courses", exact: false }]
      : []),
    ...(mayManagePeople
      ? [{ href: `/org/${slug}/admin`, label: "People", exact: false }]
      : []),
    ...(isAdmin
      ? [{ href: `/org/${slug}/admin/audit`, label: "Activity", exact: false }]
      : []),
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="mx-auto max-w-6xl px-4">
          <div className="flex h-16 items-center justify-between gap-4">
            <Link
              href={`/org/${slug}`}
              className="flex min-w-0 items-center gap-3"
            >
              <Logo className="shrink-0 text-gray-900 dark:text-white" />
              {organizationName ? (
                <>
                  <span
                    aria-hidden="true"
                    className="h-5 w-px bg-gray-300 dark:bg-gray-700"
                  />
                  <span className="truncate text-sm font-semibold text-gray-800 dark:text-white/90">
                    {organizationName}
                  </span>
                </>
              ) : null}
            </Link>

            <div className="flex items-center gap-3">
              <ThemeToggleButton />
              {/* The same account menu as the dashboard: avatar with photo,
                  name and role, a link to the account and settings page, and
                  sign out. Sign out returns to this organization's login, not
                  the public sign-in page. */}
              <UserDropdown signOutHref={`/org/${slug}/login`} />
            </div>
          </div>

          <nav className="flex gap-1 overflow-x-auto">
            {tabs.map((tab) => {
              const active = tab.exact
                ? pathname === tab.href
                : pathname.startsWith(tab.href);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`relative whitespace-nowrap px-3 py-3 text-sm font-medium transition-colors ${
                    active
                      ? "text-brand-600 dark:text-brand-400"
                      : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                  }`}
                >
                  {tab.label}
                  {active ? (
                    <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-brand-500" />
                  ) : null}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      {isPlatformStaff ? (
        // Shown on every page, not just the landing one: platform staff should
        // be reminded wherever they are that the customer can see this visit.
        <div className="border-b border-warning-300 bg-warning-50 px-4 py-2 text-center text-sm text-warning-800 dark:border-warning-500/40 dark:bg-warning-500/10 dark:text-warning-400">
          You are inside a customer&apos;s organization as platform staff. This
          visit is recorded in their audit trail.
        </div>
      ) : null}

      <main className="mx-auto max-w-6xl px-4 py-10">{children}</main>
    </div>
  );
}
