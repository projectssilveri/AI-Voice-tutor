"use client";

import RequireAuth from "@/components/auth/RequireAuth";
import DeletionQueue from "@/components/org/DeletionQueue";

/**
 * What people inside a customer asked to delete, from every customer.
 *
 * Since 2026-10-01 a Platform Admin or Super Admin decides these: an
 * organisation admin removing a learner or another admin, and any course or
 * document deleted from inside a customer. Platform staff, and managers
 * removing their own people, delete at once, so nothing of theirs waits here.
 */
export default function DeletionRequestsPage() {
  return (
    <RequireAuth roles={["admin"]}>
      <div className="space-y-6">
        <div>
          <h1 className="text-title-sm font-bold text-gray-800 dark:text-white/90">
            Deletion requests
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Things people inside a customer asked to delete. Nothing is removed
            until you approve it.
          </p>
        </div>
        <DeletionQueue canDecide alwaysShow />
      </div>
    </RequireAuth>
  );
}
