"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { ThemeToggleButton } from "@/components/common/ThemeToggleButton";
import Logo from "@/components/marketing/ui/Logo";
import Avatar from "@/components/ui/Avatar";
import { useAuth } from "@/context/AuthContext";
import { roleLabel } from "@/lib/orgPortal";

/**
 * The chrome every organization page sits in.
 *
 * The portal pages were bare centred divs with no header, no navigation and no
 * way back — functional, and visibly below the standard of the rest of the
 * product. This gives them the same shell.
 *
 * It is NOT the dashboard shell, deliberately: that one carries marketplace
 * nav, pricing and the platform admin section, none of which exists inside a
 * walled garden. An org learner should never be shown something to buy.
 */
export default function OrgShell({
  slug,
  organizationName,
  role,
  canAuthor,
  canManagePeople,
  isAdmin,
  isPlatformStaff,
  children,
}: {
  slug: string;
  organizationName?: string | null;
  role?: string | null;
  /** Writes training. An org admin, or a department admin for their own team. */
  canAuthor?: boolean;
  /** Adds and edits people — org admin, branch manager or department admin. */
  canManagePeople?: boolean;
  isAdmin?: boolean;
  isPlatformStaff?: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const { user, photoVersion } = useAuth();

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
    // Documents are for everyone — a learner needs the handbook as much as an
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
              {/* One component instead of two <Image> tags swapped by theme.
                  Those pointed at the free template's own logo files, and the
                  pair existed only because a flat SVG cannot change colour
                  with the theme. This one inherits it. */}
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
              {/* The same control as the dashboard header. This used to be
                  `ThemeTogglerTwo`, the big solid-blue one built to float
                  alone on the sign-in page, and at 56px it was taller than
                  the avatar and louder than the company name. */}
              <ThemeToggleButton />
              <div className="hidden text-right sm:block">
                <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                  {user?.name}
                </p>
                {role ? (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {roleLabel(role)}
                  </p>
                ) : null}
              </div>
              <Avatar
                userId={user?.id}
                name={user?.name}
                size="sm"
                version={photoVersion}
              />
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
