"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import RequireAuth from "@/components/auth/RequireAuth";
import EmptyState from "@/components/ui/EmptyState";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { apiFetch } from "@/lib/api";
import { counted } from "@/lib/plural";

/**
 * What our customers have built, across every organisation.
 *
 * SEPARATE FROM "Add or modify courses" ON PURPOSE, and read-only. Those are
 * two different things that a single "Courses" screen made look like one: our
 * catalogue, which we own and sell, and a customer's private training, which
 * belongs to them and which we can see only for support.
 *
 * Collapsing them is what let an ordinary platform admin rename and then delete
 * a customer's course (decision 170). There is no edit control anywhere on this
 * page — changes are made by that organisation's own admins, in their portal.
 *
 * Super admin only, matching `services/access.py`: an ordinary platform admin
 * does not read customer data (decision 159).
 */

const CELL = "px-4 py-3 align-middle text-sm";

interface CustomerCourse {
  id: string;
  title: string;
  description: string | null;
  is_published: boolean;
  module_count: number;
  enrolled: number;
  created_at: string;
  updated_at: string;
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  department_name: string | null;
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function CustomerTraining() {
  const [courses, setCourses] = useState<CustomerCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    try {
      setCourses(
        await apiFetch<CustomerCourse[]>("/admin/organizations/courses/all", {
          withCredentials: true,
          cache: "no-store",
        }),
      );
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not load customer training.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return courses;
    return courses.filter((course) =>
      `${course.title} ${course.organization_name} ${course.department_name ?? ""}`
        .toLowerCase()
        .includes(needle),
    );
  }, [courses, search]);

  // Grouped by customer, because "what has Acme built" is the question this
  // screen is opened with — not "show me every course alphabetically".
  const byOrganization = useMemo(() => {
    const groups = new Map<string, CustomerCourse[]>();
    for (const course of visible) {
      const existing = groups.get(course.organization_id) ?? [];
      existing.push(course);
      groups.set(course.organization_id, existing);
    }
    return [...groups.values()].sort((a, b) =>
      a[0].organization_name.localeCompare(b[0].organization_name),
    );
  }, [visible]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-title-sm font-bold text-gray-800 dark:text-white/90">
          Customer training
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Courses our organisation customers have built for themselves. Read
          only: their own admins make the changes, in their portal. This is
          separate from{" "}
          <Link
            href="/admin/courses"
            className="text-brand-500 dark:text-brand-400 hover:text-brand-600"
          >
            our catalogue
          </Link>
          , which is the training we sell.
        </p>
      </div>

      <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search a course, organisation or department"
        className="mb-6 h-10 w-full max-w-md rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
      />

      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-error-500 bg-error-50 px-4 py-2.5 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400"
        >
          {error}
        </p>
      ) : null}

      {loading ? (
        <SkeletonRows rows={6} />
      ) : byOrganization.length === 0 ? (
        <EmptyState
          icon="🏢"
          title={
            courses.length === 0
              ? "No customer has built a course yet"
              : "Nothing matches that search"
          }
          body={
            courses.length === 0
              ? "When an organisation writes its own training, it appears here."
              : undefined
          }
        />
      ) : (
        <div className="space-y-8">
          {byOrganization.map((group) => (
            <section key={group[0].organization_id}>
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">
                  {group[0].organization_name}
                </h2>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-gray-500 dark:text-gray-400">
                    {counted(group.length, "course")}
                  </span>
                  <Link
                    href={`/admin/organizations/${group[0].organization_id}`}
                    className="text-brand-500 dark:text-brand-400 hover:text-brand-600"
                  >
                    Manage organisation
                  </Link>
                  {/* Opening a customer's portal is support access and is
                      recorded in THEIR audit trail (decision 152). New tab so
                      it is a deliberate crossing, not a click that swallows the
                      console you were using. */}
                  <a
                    href={`/org/${group[0].organization_slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-brand-500 dark:text-brand-400 hover:text-brand-600"
                  >
                    Open their portal ↗
                  </a>
                </div>
              </div>

              <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-raised dark:border-gray-800 dark:bg-white/[0.03]">
                <div className="overflow-x-auto">
                  <table className="table-wide w-full min-w-[52rem]">
                    <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:bg-white/[0.02] dark:text-gray-400">
                      <tr>
                        <th className="px-4 py-3">Course</th>
                        <th className="px-4 py-3">Department</th>
                        <th className="px-4 py-3">Modules</th>
                        <th className="px-4 py-3">Enrolled</th>
                        <th className="px-4 py-3">Published</th>
                        <th className="px-4 py-3">Updated</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {group.map((course) => (
                        <tr key={course.id}>
                          <td className={CELL}>
                            <p className="font-medium text-gray-800 dark:text-white/90">
                              {course.title}
                            </p>
                            {course.description ? (
                              <p className="mt-0.5 line-clamp-1 text-xs text-gray-500 dark:text-gray-400">
                                {course.description}
                              </p>
                            ) : null}
                          </td>
                          <td
                            className={`${CELL} text-gray-600 dark:text-gray-400`}
                          >
                            {course.department_name ?? (
                              <span className="text-gray-500 dark:text-gray-400">
                                Everyone
                              </span>
                            )}
                          </td>
                          <td
                            className={`${CELL} text-gray-600 dark:text-gray-400`}
                          >
                            {course.module_count}
                          </td>
                          <td
                            className={`${CELL} text-gray-600 dark:text-gray-400`}
                          >
                            {course.enrolled}
                          </td>
                          <td className={CELL}>
                            {course.is_published ? (
                              <span className="inline-flex rounded-full bg-success-50 px-2.5 py-1 text-xs font-medium text-success-800 dark:bg-success-500/15 dark:text-success-400">
                                Live
                              </span>
                            ) : (
                              <span className="inline-flex rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                                Draft
                              </span>
                            )}
                          </td>
                          <td
                            className={`${CELL} whitespace-nowrap text-gray-500 dark:text-gray-400`}
                          >
                            {day(course.updated_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdminCustomerTrainingPage() {
  return (
    <RequireAuth roles={["super_admin"]}>
      <CustomerTraining />
    </RequireAuth>
  );
}
