"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import OrgShell from "@/components/org/OrgShell";
import { Action } from "@/components/ui/Action";
import EmptyState from "@/components/ui/EmptyState";
import { SkeletonCards } from "@/components/ui/Skeleton";
import { counted } from "@/lib/plural";
import {
  type OrgCourse,
  type OrgDocument,
  type OrgProfile,
  courseAudience,
  createOrgCourse,
  createOrgModule,
  getOrgDocumentText,
  getOrgProfile,
  getOrgStructure,
  listOrgCourses,
  listOrgDocuments,
  updateOrgCourse,
  deleteOrgCourse,
} from "@/lib/orgPortal";

const FIELD =
  "w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

/**
 * An organization builds its own training.
 *
 * The tutor teaches from `modules.content`, so this screen is where a customer
 * decides what their AI actually says. The "use a document" button fills the
 * content box from an uploaded PDF's extracted text and then stops — the
 * author reads it, fixes it, and saves it. Decision 97: extraction is
 * imperfect, a scanned page yields nothing at all, and applying it
 * automatically would let a bad extraction become the lecture.
 */
export default function OrgCoursesPage() {
  const { slug } = useParams<{ slug: string }>();

  const [profile, setProfile] = useState<OrgProfile | null>(null);
  const [courses, setCourses] = useState<OrgCourse[]>([]);
  const [documents, setDocuments] = useState<OrgDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newCourse, setNewCourse] = useState({
    title: "",
    description: "",
    // "" is the whole organization, which is what every course was
    // before departments could be chosen.
    department_id: "",
  });
  // The organization's departments, for the picker. Loaded once; a
  // failure here loses the picker, not the form.
  const [departments, setDepartments] = useState<
    { id: string; name: string }[]
  >([]);
  // How many people each course actually reaches. Loaded per course once the
  // list is in, because it is the number that answers "did narrowing this to
  // one department leave anybody able to see it?"
  const [reach, setReach] = useState<Record<string, number>>({});
  const [creating, setCreating] = useState(false);

  // Which course is having a module added, and the module being written.
  const [openCourse, setOpenCourse] = useState<string | null>(null);
  const [module, setModule] = useState({ title: "", content: "" });

  const load = useCallback(async () => {
    try {
      const [p, c, d] = await Promise.all([
        getOrgProfile(slug),
        listOrgCourses(slug),
        listOrgDocuments(slug),
      ]);
      setProfile(p);
      setCourses(c);
      setDocuments(d.documents.filter((doc) => doc.has_text));
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not load courses.",
      );
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  // The departments, for the picker. Separate from the course load so a
  // failure here costs the picker and not the page.
  // Reach per course. One request each, and only for courses that exist — a
  // handful of courses, so this is not the N+1 that matters. The alternative is
  // a counts endpoint, which is not worth a migration for a number this small.
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      // ONLY THE COURSES THIS VIEWER OWNS. The audience is a list of names and
      // addresses, so a department admin asking about the company-wide course
      // was asking for the whole organization's learners — every other
      // department's included. The server refuses it now; not asking is the
      // other half, and it saves a request per row that would only 403.
      courses
        .filter((course) => course.can_edit)
        .map(async (course) => {
          try {
            const people = await courseAudience(slug, course.id);
            return [course.id, people.length] as const;
          } catch {
            return null;
          }
        }),
    ).then((pairs) => {
      if (cancelled) return;
      setReach(Object.fromEntries(pairs.filter(Boolean) as [string, number][]));
    });
    return () => {
      cancelled = true;
    };
  }, [slug, courses]);

  useEffect(() => {
    getOrgStructure(slug)
      .then((structure) =>
        setDepartments(
          structure.departments.map((d) => ({
            id: String(d.id),
            name: String(d.name),
          })),
        ),
      )
      .catch(() => {});
  }, [slug]);

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  // A DEPARTMENT ADMIN WRITES THEIR DEPARTMENT'S TRAINING. That is half of
  // what the role is for. `canWrite` is now "may author at all"; whether they
  // may touch a PARTICULAR course is `course.can_edit`, decided by the server
  // per row — a department admin sees the company-wide courses everyone sees
  // and cannot change them.
  const canWrite = profile?.can_author ?? false;
  const isDeptAdmin = profile?.is_dept_admin ?? false;

  return (
    <OrgShell
      slug={slug}
      organizationName={profile?.name}
      role={profile?.my_role}
      isAdmin={profile?.is_org_admin}
      canManagePeople={profile?.can_manage_people}
      canAuthor={profile?.can_author}
      isPlatformStaff={profile?.is_platform_staff}
    >
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-title-sm font-bold text-gray-800 dark:text-white/90">
            {isDeptAdmin
              ? `${profile?.department_name ?? "Department"} training`
              : "Training"}
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {loading
              ? "Loading…"
              : isDeptAdmin
                ? `${counted(courses.length, "course")} you can see: your department's, and the ones written for everybody.`
                : `${counted(courses.length, "course")} built for your organization. Only your people can see them.`}
          </p>
        </div>
        {canWrite && !creating ? (
          <Action onClick={() => setCreating(true)}>New course</Action>
        ) : null}
      </div>

      {error ? (
        <div
          role="alert"
          className="mb-6 rounded-2xl border border-error-500 bg-error-50 p-4 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400"
        >
          {error}
        </div>
      ) : null}
      {notice ? (
        <div
          role="status"
          className="mb-6 rounded-2xl border border-success-500 bg-success-50 p-4 text-sm text-success-700 dark:bg-success-500/10 dark:text-success-400"
        >
          {notice}
        </div>
      ) : null}

      {creating && canWrite ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await createOrgCourse(slug, {
                title: newCourse.title.trim(),
                description: newCourse.description.trim() || null,
                department_id: newCourse.department_id || null,
              });
              setNewCourse({ title: "", description: "", department_id: "" });
              setCreating(false);
            });
          }}
          className="mb-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-raised dark:border-gray-800 dark:bg-white/[0.03]"
        >
          <h2 className="mb-4 text-base font-semibold text-gray-800 dark:text-white/90">
            New course
          </h2>
          <div className="grid gap-4">
            <input
              value={newCourse.title}
              onChange={(e) =>
                setNewCourse({ ...newCourse, title: e.target.value })
              }
              placeholder="Data Protection 2026"
              aria-label="Course title"
              className={FIELD}
              required
            />
            <input
              value={newCourse.description}
              onChange={(e) =>
                setNewCourse({ ...newCourse, description: e.target.value })
              }
              placeholder="What this course covers"
              aria-label="Course description"
              className={FIELD}
            />
            {isDeptAdmin ? (
              /* TOLD, NOT ASKED. The server stamps their own department onto
                 every course they create, so a picker here could only offer a
                 choice that is then overridden — and the one option that would
                 matter, "everyone in the organisation", is precisely the one
                 they must not have. */
              <p className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-400">
                For{" "}
                <span className="font-medium text-gray-800 dark:text-white/90">
                  {profile?.department_name ?? "your department"}
                </span>
                . Nobody outside it will see this course.
              </p>
            ) : departments.length > 0 ? (
              <div>
                <label
                  htmlFor="course-department"
                  className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
                >
                  Who is it for?
                </label>
                <select
                  id="course-department"
                  value={newCourse.department_id}
                  onChange={(e) =>
                    setNewCourse({
                      ...newCourse,
                      department_id: e.target.value,
                    })
                  }
                  className={FIELD}
                >
                  <option value="">Everyone in the organisation</option>
                  {departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name} only
                    </option>
                  ))}
                </select>
                {/* Said plainly: this is the one setting on the form
                    that decides who can never see the course. */}
                <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                  A course for one department is invisible to everyone else.
                  Admins and managers always see it.
                </p>
              </div>
            ) : null}
          </div>
          <div className="mt-5 flex gap-3">
            <Action type="submit" loading={busy}>
              Create
            </Action>
            <Action variant="secondary" onClick={() => setCreating(false)}>
              Cancel
            </Action>
          </div>
        </form>
      ) : null}

      {loading ? (
        <SkeletonCards count={2} />
      ) : courses.length === 0 ? (
        <EmptyState
          icon="🎓"
          title="No training yet"
          body="Create a course, add modules, and the AI tutor will teach them out loud, using only the material you write. Nobody outside your organization can see it."
          action={
            canWrite && !creating ? (
              <Action onClick={() => setCreating(true)}>
                Create the first course
              </Action>
            ) : null
          }
        />
      ) : (
        <div className="space-y-4">
          {courses.map((course) => (
            <div
              key={course.id}
              className="rounded-2xl border border-gray-200 bg-white p-5 shadow-raised dark:border-gray-800 dark:bg-white/[0.03]"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-semibold text-gray-800 dark:text-white/90">
                    {course.title}
                  </h2>
                  <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                    {course.description ?? "No description yet."}
                  </p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {counted(course.module_count, "module")}
                    {/* Who it is for, and how many people that leaves. The
                        second number is the point of the first: an author who
                        has just narrowed a course to one department wants to
                        know whether anybody can still see it. */}
                    {course.department_name ? (
                      <>
                        {" · "}
                        <span className="font-medium text-warning-900 dark:text-warning-300">
                          {course.department_name} only
                        </span>
                      </>
                    ) : (
                      " · everyone"
                    )}
                    {reach[course.id] !== undefined
                      ? ` · reaches ${counted(reach[course.id], "person", "people")}`
                      : ""}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      course.is_published
                        ? "bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-400"
                        : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                    }`}
                  >
                    {course.is_published ? "Live" : "Draft"}
                  </span>
                  {/* A course they can see and not change. Saying so beats a
                      row that looks identical to an editable one minus its
                      buttons, which reads as a bug. */}
                  {canWrite && !course.can_edit ? (
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      Company-wide · read only
                    </span>
                  ) : null}
                  {canWrite && course.can_edit ? (
                    <Action
                      variant="secondary"
                      size="sm"
                      disabled={busy || course.module_count === 0}
                      title={
                        course.module_count === 0
                          ? "Add a module before publishing"
                          : undefined
                      }
                      onClick={() =>
                        void run(() =>
                          updateOrgCourse(slug, course.id, {
                            is_published: !course.is_published,
                          }),
                        )
                      }
                    >
                      {course.is_published ? "Unpublish" : "Publish"}
                    </Action>
                  ) : null}
                  {/* PLATFORM STAFF DELETE AT ONCE; anybody else who can
                      edit the course asks, with a reason, and a Platform
                      Admin or Super Admin decides (2026-10-01). */}
                  {canWrite && course.can_edit ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setNotice(null);
                        const staff = profile?.is_platform_staff ?? false;
                        const answer = window.prompt(
                          staff
                            ? `Delete "${course.title}"? This happens at once and cannot be undone.\n\nWhy? It is kept on this organisation's record.`
                            : `Ask to delete "${course.title}"?\n\nNothing is removed until a Platform Admin or Super Admin approves it.\n\nWhy should it be deleted?`,
                          "",
                        );
                        if (answer === null) return;
                        if (!staff && !answer.trim()) {
                          setError("Say why it should be deleted. The request needs a reason.");
                          return;
                        }
                        void run(async () => {
                          const result = await deleteOrgCourse(
                            slug,
                            course.id,
                            answer.trim(),
                          );
                          setNotice(result.explanation);
                        });
                      }}
                      className="rounded-lg border border-error-300 px-3 py-1.5 text-xs font-medium text-error-600 transition hover:bg-error-50 disabled:opacity-50 dark:border-error-500/40 dark:text-error-400 dark:hover:bg-error-500/10"
                    >
                      {profile?.is_platform_staff ? "Delete" : "Ask to delete"}
                    </button>
                  ) : null}
                </div>
              </div>

              {canWrite && course.can_edit ? (
                <div className="mt-4 border-t border-gray-200 pt-4 dark:border-gray-800">
                  {openCourse === course.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void run(async () => {
                          // No position: the server appends. Sending
                          // `module_count` put the new module on top of an
                          // existing one as soon as any had been deleted.
                          await createOrgModule(slug, course.id, {
                            title: module.title.trim(),
                            content: module.content.trim() || null,
                          });
                          setModule({ title: "", content: "" });
                          setOpenCourse(null);
                        });
                      }}
                      className="space-y-3"
                    >
                      <input
                        value={module.title}
                        onChange={(e) =>
                          setModule({ ...module, title: e.target.value })
                        }
                        placeholder="Module title"
                        aria-label="Module title"
                        className={FIELD}
                        required
                      />
                      <textarea
                        value={module.content}
                        onChange={(e) =>
                          setModule({ ...module, content: e.target.value })
                        }
                        rows={6}
                        placeholder="What the tutor teaches from. Write it as you would explain it out loud."
                        aria-label="Module content"
                        className={FIELD}
                      />

                      {documents.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            Start from a document:
                          </span>
                          {documents.map((doc) => (
                            <button
                              key={doc.id}
                              type="button"
                              disabled={busy}
                              onClick={async () => {
                                // Fills the box and stops. The author reads it
                                // and saves it — see the file docstring.
                                const { text } = await getOrgDocumentText(
                                  slug,
                                  doc.id,
                                );
                                setModule((m) => ({
                                  ...m,
                                  content: text ?? m.content,
                                }));
                              }}
                              className="rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-700 transition-colors hover:border-brand-400 hover:text-brand-600 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300"
                            >
                              {doc.title}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Pulling a document in fills this box so you can check
                        and edit it. Nothing is saved until you press Add.
                      </p>

                      <div className="flex gap-3">
                        <Action type="submit" size="sm" loading={busy}>
                          Add module
                        </Action>
                        <Action
                          variant="secondary"
                          size="sm"
                          onClick={() => setOpenCourse(null)}
                        >
                          Cancel
                        </Action>
                      </div>
                    </form>
                  ) : (
                    <Action
                      variant="secondary"
                      size="sm"
                      onClick={() => setOpenCourse(course.id)}
                    >
                      Add a module
                    </Action>
                  )}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </OrgShell>
  );
}
