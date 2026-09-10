"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import RequireAuth from "@/components/auth/RequireAuth";
import ModuleEditor from "@/components/admin/ModuleEditor";
import CourseReviewPanel from "@/components/admin/CourseReviewPanel";
import PricingControls from "@/components/admin/PricingControls";
import TutorLimitControls from "@/components/admin/TutorLimitControls";
import {
  type CourseRow,
  type ModuleRow,
  createModule,
  listCourses,
  listModules,
  updateCourse,
} from "@/lib/authoring";
import { counted } from "@/lib/plural";

const FIELD =
  "w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

function CourseDetailAuthoring() {
  const { courseId } = useParams<{ courseId: string }>();

  const [course, setCourse] = useState<CourseRow | null>(null);
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [savingCourse, setSavingCourse] = useState(false);
  const [courseSaved, setCourseSaved] = useState(false);

  const [newTitle, setNewTitle] = useState("");
  const [addingModule, setAddingModule] = useState(false);

  const load = useCallback(async () => {
    try {
      // The single-course endpoint returns the student shape (no `content`),
      // so the course row comes from the list and the modules come from the
      // authoring endpoint that does include it.
      const [courses, moduleRows] = await Promise.all([
        listCourses(),
        listModules(courseId),
      ]);
      const found = courses.find((row) => row.id === courseId) ?? null;
      setCourse(found);
      if (found) {
        setTitle(found.title);
        setDescription(found.description ?? "");
      }
      setModules(moduleRows);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not load the course.",
      );
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSaveCourse() {
    setSavingCourse(true);
    setError(null);
    setCourseSaved(false);
    try {
      await updateCourse(courseId, {
        title: title.trim(),
        description: description.trim() || null,
      });
      setCourseSaved(true);
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not save the course.",
      );
    } finally {
      setSavingCourse(false);
    }
  }

  async function handleAddModule() {
    if (!newTitle.trim()) {
      setError("Give the module a title.");
      return;
    }
    setAddingModule(true);
    setError(null);
    try {
      // Next free slot. Positions are unique per course in the database, so
      // No position: the server appends, reading the highest that exists.
      // This screen used to compute it and the org screen computed it
      // differently, which is how the two came to disagree.
      await createModule(courseId, {
        title: newTitle.trim(),
        content: null,
      });
      setNewTitle("");
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not add the module.",
      );
    } finally {
      setAddingModule(false);
    }
  }

  const courseDirty =
    course !== null &&
    (title !== course.title || description !== (course.description ?? ""));

  const withoutContent = modules.filter(
    (m) => !m.content || !m.content.trim(),
  ).length;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/courses"
          className="mb-2 inline-block text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400"
        >
          ← All courses
        </Link>
        <h1 className="mb-1 text-title-sm font-bold text-gray-800 dark:text-white/90">
          {loading ? "Loading…" : (course?.title ?? "Course not found")}
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {counted(modules.length, "module")}
          {withoutContent > 0
            ? ` · ${withoutContent} still without content`
            : modules.length > 0
              ? " · all have content"
              : ""}
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

      {/* WHERE IT STANDS, above everything else on the page. An author opening
          a course they submitted last week needs that answer before they need
          the title field. */}
      {course ? (
        <div className="mb-6">
          <CourseReviewPanel
            course={course}
            moduleCount={modules.length}
            onChanged={setCourse}
          />
        </div>
      ) : null}

      {course ? (
        <div className="rounded-2xl border border-gray-200 bg-white shadow-raised p-6 dark:border-gray-800 dark:bg-white/[0.03]">
          <h2 className="mb-4 text-base font-semibold text-gray-800 dark:text-white/90">
            Course details
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
                className={FIELD}
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
                className={FIELD}
              />
            </div>
          </div>
          <div className="mt-5 flex items-center gap-3">
            <button
              type="button"
              onClick={handleSaveCourse}
              disabled={savingCourse || !courseDirty}
              className="rounded-lg bg-brand-500 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-50"
            >
              {savingCourse ? "Saving…" : "Save details"}
            </button>
            {courseSaved && !courseDirty ? (
              <span className="text-sm text-success-600 dark:text-success-400">
                Saved.
              </span>
            ) : null}
          </div>

          <div className="mt-6">
            <PricingControls course={course} onChanged={setCourse} />
            {/* Beside the price, because it is the same kind of decision:
                what a student gets for what they paid. */}
            <TutorLimitControls course={course} onChanged={setCourse} />
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-raised dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-6 py-4 dark:border-gray-800">
          <div>
            <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">
              Modules
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Open one to write its content, quiz and assignments.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="New module title"
              className={`${FIELD} w-56`}
            />
            <button
              type="button"
              onClick={handleAddModule}
              disabled={addingModule}
              className="shrink-0 rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-50"
            >
              {addingModule ? "Adding…" : "Add"}
            </button>
          </div>
        </div>

        {loading ? (
          <p className="px-6 py-8 text-center text-sm text-gray-500">
            Loading…
          </p>
        ) : modules.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No modules yet. Add the first one above.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {[...modules]
              .sort((a, b) => a.order - b.order)
              .map((module) => (
                <ModuleEditor
                  key={module.id}
                  module={module}
                  onChanged={load}
                />
              ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function AdminCourseDetailPage() {
  return (
    <RequireAuth roles={["admin"]}>
      <CourseDetailAuthoring />
    </RequireAuth>
  );
}
