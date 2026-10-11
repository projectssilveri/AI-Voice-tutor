"use client";

import Link from "next/link";

/**
 * Shown when a signed-in person opens an org page they are not a member of.
 *
 * The API answers 404 for a non-member on purpose, so it never confirms to a
 * stranger whether a given company exists. Left raw, that 404 surfaced as a
 * generic "we couldn't load this" on the deeper org pages. This says what
 * actually happened and points somewhere useful, the same way the org home
 * page already does.
 */
export default function OrgNotMember({ slug }: { slug: string }) {
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
        <span className="font-mono">{slug}</span>. If you believe you should be,
        ask that organization&apos;s administrator to add you.
      </p>
      <Link
        href="/dashboard"
        className="text-sm font-medium text-brand-500 hover:text-brand-600 dark:text-brand-400"
      >
        Go to your own dashboard
      </Link>
    </div>
  );
}
