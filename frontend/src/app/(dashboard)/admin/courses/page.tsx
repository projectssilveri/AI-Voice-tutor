"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import RequireAuth from "@/components/auth/RequireAuth";
import ExamBadge from "@/components/admin/ExamBadge";
import ReviewBadge from "@/components/admin/ReviewBadge";
import { useAuth } from "@/context/AuthContext";
import { formatMoney } from "@/lib/money";
import {
  type CourseRow,
  createCourse,
  deleteCourse,
  listCourses,
} from "@/lib/authoring";
import { counted } from "@/lib/plural";

/**
 * Course authoring — step 5's "basic admin screen to create courses
 * and add modules with content text".
 *
 * This screen decides what the AI tutor is able to teach: a module's content
 * text is the only material a voice session is grounded in. Before this
 * existed, the only way to add a course was the seed script.
 */
function CourseAuthoring() {
  // DELETING IS THE OWNER'S. An ordinary admin authors courses; destroying one
  // — with its modules, quizzes, assignments and every student's progress —
  // sits with the super admin beside publishing and pricing. The server
  // agrees: `DELETE /courses/{id}` is behind `RequireSuperAdmin`, so hiding
  // the button only saves an admin a refusal they cannot act on.
  const { user } = useAuth();
  const canDelete = user?.role === "super_admin";

  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setCourses(await listCourses());
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not load courses.",
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
    if (!title.trim()) {
      setError("Give the course a title.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const created = await createCourse({
        title: title.trim(),
        description: description.trim() || null,
      });
      setTitle("");
      setDescription("");
      // STRAIGHT INTO THE COURSE, rather than back to a list with a new empty
      // row on it. Creating used to leave the author looking at the catalogue
      // with a Free, Draft, 0-module entry that nothing had asked them to
      // finish, and the tester read that as the course having been created
      // without a setup step (issue 32). The row is still created here — a
      // course has to exist before it can have modules hung off it — but the
      // next thing on screen is now the thing that needs filling in.
      router.push(`/admin/courses/${created.id}`);
      return;
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not create the course.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(courseId: string) {
    setError(null);
    try {
      await deleteCourse(courseId);
      setConfirmingDelete(null);
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not delete the course.",
      );
    }
  }

  const fieldClass =
    "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1 text-title-sm font-bold text-gray-800 dark:text-white/90">
          Courses
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Create a course, then add modules. A module&apos;s content is the only
          material the AI tutor teaches and answers from.
        </p>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-2xl border border-error-500 bg-error-50 p-4 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400"
        >
          {error}
        </div>
      ) : null}

      <form
        onSubmit={handleCreate}
        className="rounded-2xl border border-gray-200 bg-white shadow-raised p-6 dark:border-gray-800 dark:bg-white/[0.03]"
      >
        <h2 className="mb-4 text-base font-semibold text-gray-800 dark:text-white/90">
          New course
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. TypeScript Fundamentals"
              className={fieldClass}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
              Description
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="One line, shown on the course card"
              className={fieldClass}
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={saving}
          className="mt-5 rounded-lg bg-brand-500 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-50"
        >
          {saving ? "Creating…" : "Create course"}
        </button>
      </form>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-raised dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="border-b border-gray-200 px-6 py-4 dark:border-gray-800">
          <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">
            All courses
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {loading ? "Loading…" : `${counted(courses.length, "course")}.`}
          </p>
        </div>

        {loading ? (
          <p className="px-6 py-8 text-center text-sm text-gray-500">
            Loading…
          </p>
        ) : courses.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No courses yet. Create one above.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {courses.map((course) => (
              <li
                key={course.id}
                className="flex flex-wrap items-center justify-between gap-4 px-6 py-4"
              >
                <div className="min-w-0">
                  <Link
                    href={`/admin/courses/${course.id}`}
                    className="font-medium text-gray-800 hover:text-brand-500 dark:text-white/90"
                  >
                    {course.title}
                  </Link>
                  <p className="mt-0.5 truncate text-sm text-gray-500 dark:text-gray-400">
                    {course.description ?? "No description"}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      course.price_minor === 0
                        ? "bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-400"
                        : "bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400"
                    }`}
                  >
                    {course.price_minor === 0
                      ? "Free"
                      : formatMoney(course.price_minor, course.currency)}
                  </span>
                  <ReviewBadge course={course} />
                  <ExamBadge course={course} />
                  <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                    {counted(course.module_count ?? 0, "module")}
                  </span>
                  <Link
                    href={`/admin/courses/${course.id}`}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03]"
                  >
                    Edit
                  </Link>

                  {/* Two-step delete, and super admin only. A course cascades
                      to its modules, quizzes, assignments and every student's
                      progress, so neither one click nor one role is enough. */}
                  {!canDelete ? null : confirmingDelete === course.id ? (
                    <span className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleDelete(course.id)}
                        className="rounded-lg bg-error-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-error-800"
                      >
                        Delete for good
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingDelete(null)}
                        className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400"
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmingDelete(course.id)}
                      className="rounded-lg border border-error-500 px-4 py-2 text-sm font-medium text-error-600 transition hover:bg-error-50 dark:text-error-400 dark:hover:bg-error-500/10"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function AdminCoursesPage() {
  return (
    <RequireAuth roles={["super_admin"]}>
      <CourseAuthoring />
    </RequireAuth>
  );
}
