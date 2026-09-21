"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import ReviewQueue from "@/components/admin/ReviewQueue";
import RequireAuth from "@/components/auth/RequireAuth";

/**
 * Courses waiting for the owner's decision.
 *
 * WHY THIS PAGE EXISTS. The queue itself has been built and working for a
 * while; it was embedded on the Website screen, and it renders nothing when
 * there is nothing pending. So with an empty queue there was no trace of the
 * approval workflow anywhere in the product — no menu entry, no page, nothing.
 * A tester went looking for it, could not find it, and reported the workflow as
 * missing and non-functional (issues 34 and 35). The workflow was neither. It
 * had nowhere to live.
 *
 * Super admin only, matching `admin_reviews.py`: approving is the same
 * authority as publishing, and publishing has always sat with the owner.
 *
 * ONE PLACE TO ACT. The Website screen keeps a link here rather than a second
 * copy of the queue — two screens that can both approve the same course is how
 * two people approve it twice.
 */
function CourseApprovals() {
  // Bumped after a decision so the queue re-reads. The queue reloads itself
  // too; this is for anything on the page that needs to know it changed.
  const [, setDecisions] = useState(0);
  const onDecided = useCallback(() => setDecisions((n) => n + 1), []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-title-sm font-bold text-gray-800 dark:text-white/90">
          Course approvals
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          An admin writes a course and sends it up; you decide whether it goes
          on sale. Approving publishes it. Sending it back needs a reason, which
          the author sees.
        </p>
      </div>

      <ReviewQueue standalone onDecided={onDecided} />

      <p className="text-sm text-gray-500 dark:text-gray-400">
        Editing a course itself happens on{" "}
        <Link
          href="/admin/courses"
          className="font-medium text-brand-500 hover:underline dark:text-brand-400"
        >
          Add or modify courses
        </Link>
        , and what is already on sale is on{" "}
        <Link
          href="/admin/website"
          className="font-medium text-brand-500 hover:underline dark:text-brand-400"
        >
          Website
        </Link>
        .
      </p>
    </div>
  );
}

export default function Page() {
  // `super_admin` explicitly, not `admin`. RequireAuth widens "admin" upwards
  // to include super admins; there is no widening that would exclude an
  // ordinary admin, so the role is named directly.
  return (
    <RequireAuth roles={["super_admin"]}>
      <CourseApprovals />
    </RequireAuth>
  );
}
