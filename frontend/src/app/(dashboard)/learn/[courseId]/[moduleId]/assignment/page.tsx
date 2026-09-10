"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import AssignmentCard from "@/components/assessments/AssignmentCard";
import PaywallNotice from "@/components/assessments/PaywallNotice";
import { ApiError, errorText } from "@/lib/api";
import {
  type StudentAssignment,
  listModuleAssignments,
} from "@/lib/assignments";
import { counted } from "@/lib/plural";

/** This module's assignments. Unlimited submissions, like the quiz. */
export default function ModuleAssignmentsPage() {
  const { courseId, moduleId } = useParams<{
    courseId: string;
    moduleId: string;
  }>();

  const [items, setItems] = useState<StudentAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Kept as the object so a 402 can be told apart from a network failure.
  const [loadError, setLoadError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      setItems(await listModuleAssignments(moduleId));
      setError(null);
      setLoadError(null);
    } catch (caught) {
      setLoadError(caught);
      setError(
        errorText(caught, "Could not load the assignments."),
      );
    } finally {
      setLoading(false);
    }
  }, [moduleId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/learn/${courseId}/${moduleId}`}
          className="mb-2 inline-block text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400"
        >
          ← Back to the module
        </Link>
        <h1 className="mb-1 text-title-sm font-bold text-gray-800 dark:text-white/90">
          {items[0]?.module_title ?? "Assignments"}
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {loading
            ? "Loading…"
            : items.length === 0
              ? "No assignments on this module."
              : counted(items.length, "assignment")}
        </p>
      </div>

      {/* 402 means the course is locked; that is a Buy prompt, not an error. */}
      <PaywallNotice error={loadError} courseId={courseId} />

      {error && !(loadError instanceof ApiError && loadError.status === 402) ? (
        <div
          role="alert"
          className="rounded-2xl border border-error-500 bg-error-50 p-4 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400"
        >
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-2xl border border-gray-200 bg-white shadow-raised p-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:bg-white/[0.03]">
          Loading…
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white shadow-raised p-8 text-center dark:border-gray-800 dark:bg-white/[0.03]">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Nothing set for this module yet.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <AssignmentCard
              key={item.assignment.id}
              item={item}
              onSubmitted={load}
            />
          ))}
        </div>
      )}
    </div>
  );
}
