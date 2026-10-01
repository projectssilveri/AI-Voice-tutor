"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Fragment, useCallback, useEffect, useState } from "react";

import ExtendAccess from "@/components/admin/ExtendAccess";
import { useAuth } from "@/context/AuthContext";
import RequireAuth from "@/components/auth/RequireAuth";
import EmptyState from "@/components/ui/EmptyState";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { type UserDossier, getUserDossier } from "@/lib/admin";
import { eventDetails, eventLabel } from "@/lib/audit";
import { tutorTime } from "@/lib/duration";
import { roleLabel } from "@/lib/roles";
import { counted } from "@/lib/plural";

/**
 * Everything about one person, on one screen.
 *
 * The console could already answer "who are our users" and "what happened on
 * the platform", but not "what has THIS person actually done" — that meant the
 * users table, the activity log, the usage chart and the attempts report, four
 * screens, joined up in an admin's head.
 *
 * Tables throughout, because every section is a list of comparable things and
 * the questions asked of them are comparisons: which course is behind, which
 * exam was failed, when did they last sign in. Certifications open into their
 * attempt history rather than linking away, since the history is the answer to
 * the question the row provokes.
 */

const CELL = "px-4 py-3 align-middle text-sm";
const HEAD =
  "border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:bg-white/[0.02] dark:text-gray-400";
const PANEL =
  "overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-raised dark:border-gray-800 dark:bg-white/[0.03]";

function date(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function stamp(iso: string | null): string {
  if (!iso) return "Never";
  const value = new Date(iso);
  return `${date(iso)}, ${value.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

/**
 * A green or red pill that says what it means.
 *
 * It used to be called `Yes` and print the word "Yes", which is fine directly
 * under a column headed "Passed" and useless anywhere else. It was also used
 * bare in the header line, where it produced "Joined Aug 08, 2026 · Yes" and
 * left the reader to guess the question.
 */
function Flag({
  value,
  yes,
  no,
}: {
  value: boolean;
  yes: string;
  no: string;
}) {
  return value ? (
    <span className="rounded-full bg-success-50 px-2.5 py-1 text-xs font-semibold text-success-700 dark:bg-success-500/15 dark:text-success-400">
      {yes}
    </span>
  ) : (
    <span className="rounded-full bg-error-50 px-2.5 py-1 text-xs font-semibold text-error-700 dark:bg-error-500/15 dark:text-error-400">
      {no}
    </span>
  );
}

function Kpi({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-raised dark:border-gray-800 dark:bg-white/[0.03]">
      <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-gray-800 dark:text-white/90">
        {value}
      </p>
      {hint ? (
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <div className="mb-3">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">
          {title}
        </h2>
        {note ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">{note}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Bar({ percent }: { percent: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
        <span
          className="block h-full rounded-full bg-brand-500"
          style={{ width: `${percent}%` }}
        />
      </span>
      <span className="text-xs text-gray-500 dark:text-gray-400">
        {percent}%
      </span>
    </div>
  );
}

function Dossier() {
  const { userId } = useParams<{ userId: string }>();
  const { user: me } = useAuth();
  const [data, setData] = useState<UserDossier | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openExam, setOpenExam] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getUserDossier(userId));
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not load this person's record.",
      );
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <SkeletonRows rows={10} />;

  if (error || !data) {
    return (
      <EmptyState
        icon="⚠️"
        title="We could not load this record"
        body={error ?? "Unknown problem."}
        action={
          <Link
            href="/admin/users"
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white"
          >
            Back to users
          </Link>
        }
      />
    );
  }

  return (
    <div>
      <Link
        href="/admin/users"
        className="mb-4 inline-block text-sm text-brand-500 dark:text-brand-400 hover:text-brand-600"
      >
        ← All users
      </Link>

      <header className="mb-6">
        <h1 className="text-title-sm font-bold text-gray-800 dark:text-white/90">
          {data.name}
        </h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
          <a
            href={`mailto:${data.email}`}
            className="text-brand-500 dark:text-brand-400 hover:text-brand-600"
          >
            {data.email}
          </a>
          {data.phone ? (
            <a
              href={`tel:${data.phone}`}
              className="text-brand-500 dark:text-brand-400 hover:text-brand-600"
            >
              {data.phone}
            </a>
          ) : (
            <span>No phone number</span>
          )}
          <span>{roleLabel(data.role)}</span>
          {data.organization_name ? (
            <span>
              {data.organization_name}
              {data.branch_name ? ` · ${data.branch_name}` : ""}
              {data.department_name ? ` · ${data.department_name}` : ""}
            </span>
          ) : null}
          <span>Joined {date(data.created_at)}</span>
          <Flag value={data.is_active} yes="Active" no="Suspended" />
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Courses" value={data.total_courses} />
        <Kpi label="Modules done" value={data.total_modules_completed} />
        <Kpi label="Quiz attempts" value={data.total_quiz_attempts} />
        <Kpi
          label="Certificates"
          value={data.certificates_earned}
          hint={`${counted(data.certification_attempts, "exam attempt")}`}
        />
        <Kpi
          label="Tutor sessions"
          value={data.voice_sessions}
          hint={`${tutorTime(data.voice_seconds ?? data.voice_minutes * 60)} in total`}
        />
        <Kpi
          label="Sign-ins"
          value={data.login_count}
          hint={`Last ${stamp(data.last_login_at)}`}
        />
        <Kpi label="Last sign-out" value={stamp(data.last_logout_at)} />
        <Kpi label="Assignments" value={data.total_assignments} />
      </div>

      {/* ---- courses ---- */}
      <Section
        title="Courses and progress"
        note="What they have access to, how they got it, and how far through they are."
      >
        {data.courses.length === 0 ? (
          <EmptyState
            icon="📚"
            title="No courses"
            body="Not enrolled in anything yet."
          />
        ) : (
          <div className={PANEL}>
            <div className="overflow-x-auto">
              <table className="table-wide w-full min-w-[60rem]">
                <thead className={HEAD}>
                  <tr>
                    <th className="px-4 py-3">Course</th>
                    <th className="px-4 py-3">Progress</th>
                    <th className="px-4 py-3">Modules</th>
                    <th className="px-4 py-3">Access</th>
                    <th className="px-4 py-3">Purchased</th>
                    <th className="px-4 py-3">Expires</th>
                    <th className="px-4 py-3">Enrolled</th>
                    <th className="px-4 py-3">Last activity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {data.courses.map((course) => (
                    <tr key={course.course_id}>
                      <td
                        className={`${CELL} font-medium text-gray-800 dark:text-white/90`}
                      >
                        {course.course_title}
                      </td>
                      <td className={CELL}>
                        <Bar percent={course.percent} />
                      </td>
                      <td
                        className={`${CELL} text-gray-600 dark:text-gray-400`}
                      >
                        {course.modules_completed}/{course.modules_total}
                        {course.modules_in_progress > 0 ? (
                          <span className="ml-1 text-xs text-warning-600 dark:text-warning-400">
                            (+{course.modules_in_progress} started)
                          </span>
                        ) : null}
                      </td>
                      <td
                        className={`${CELL} capitalize text-gray-600 dark:text-gray-400`}
                      >
                        {course.access_via}
                      </td>
                      <td
                        className={`${CELL} whitespace-nowrap text-gray-600 dark:text-gray-400`}
                      >
                        {date(course.purchased_at)}
                      </td>
                      <td className={`${CELL} whitespace-nowrap`}>
                        {/* A course bought outright genuinely has no expiry.
                            Saying so beats an em dash the reader has to guess
                            at, and beats inventing a date. */}
                        {course.expires_at ? (
                          <span className="text-gray-600 dark:text-gray-400">
                            {date(course.expires_at)}
                          </span>
                        ) : course.access_via === "purchase" ? (
                          <span className="text-success-600 dark:text-success-400">
                            Never
                          </span>
                        ) : (
                          <span className="text-gray-500 dark:text-gray-400">
                            None
                          </span>
                        )}
                      </td>
                      <td
                        className={`${CELL} whitespace-nowrap text-gray-600 dark:text-gray-400`}
                      >
                        {date(course.enrolled_at)}
                      </td>
                      <td
                        className={`${CELL} whitespace-nowrap text-gray-600 dark:text-gray-400`}
                      >
                        {stamp(course.last_activity_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Section>

      {/* Directly under the course table, because the dates it changes are
          the ones in the Expires column above.

          FOR A CUSTOMER'S PEOPLE TOO, for platform staff: since the role
          model of 2026-10-01 a platform admin extends a customer's access as
          a super admin does. */}
      {data.organization_name === null ||
      me?.role === "admin" ||
      me?.role === "super_admin" ? (
        <div className="mt-4">
          <ExtendAccess
            userId={data.id}
            courses={data.courses.map((course) => ({
              id: course.course_id,
              title: course.course_title,
            }))}
            onGranted={() => void load()}
          />
        </div>
      ) : (
        <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
          {data.organization_name} manages this person&rsquo;s access. Their own
          administrators can change it from their portal.
        </p>
      )}

      {/* ---- quizzes ---- */}
      <Section
        title="Quizzes"
        note="Every quiz on their courses, taken or not. Quizzes have unlimited retakes."
      >
        {data.quizzes.length === 0 ? (
          <EmptyState
            icon="📝"
            title="No quizzes"
            body="None on their courses."
          />
        ) : (
          <div className={PANEL}>
            <div className="overflow-x-auto">
              <table className="table-wide w-full min-w-[48rem]">
                <thead className={HEAD}>
                  <tr>
                    <th className="px-4 py-3">Module</th>
                    <th className="px-4 py-3">Course</th>
                    <th className="px-4 py-3">Questions</th>
                    <th className="px-4 py-3">Taken</th>
                    <th className="px-4 py-3">Attempts</th>
                    <th className="px-4 py-3">Best</th>
                    <th className="px-4 py-3">Last</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {data.quizzes.map((quiz) => (
                    <tr key={quiz.module_id}>
                      <td
                        className={`${CELL} font-medium text-gray-800 dark:text-white/90`}
                      >
                        {quiz.module_title}
                      </td>
                      <td
                        className={`${CELL} text-gray-600 dark:text-gray-400`}
                      >
                        {quiz.course_title}
                      </td>
                      <td
                        className={`${CELL} text-gray-600 dark:text-gray-400`}
                      >
                        {quiz.questions}
                      </td>
                      <td className={CELL}>
                        <Flag value={quiz.taken} yes="Taken" no="Not taken" />
                      </td>
                      <td
                        className={`${CELL} text-gray-600 dark:text-gray-400`}
                      >
                        {quiz.attempts}
                      </td>
                      <td
                        className={`${CELL} text-gray-600 dark:text-gray-400`}
                      >
                        {quiz.best_score === null
                          ? "Not taken"
                          : `${quiz.best_score}%`}
                      </td>
                      <td
                        className={`${CELL} whitespace-nowrap text-gray-600 dark:text-gray-400`}
                      >
                        {stamp(quiz.last_attempt_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Section>

      {/* ---- certification ---- */}
      <Section
        title="Certification"
        note="The capped assessment. Three attempts by default, plus anything an admin has granted."
      >
        {data.certifications.length === 0 ? (
          <EmptyState
            icon="🎓"
            title="No certification exams"
            body="None on their courses."
          />
        ) : (
          <div className={PANEL}>
            <div className="overflow-x-auto">
              <table className="table-wide w-full min-w-[54rem]">
                <thead className={HEAD}>
                  <tr>
                    <th className="px-4 py-3">Exam</th>
                    <th className="px-4 py-3">Course</th>
                    <th className="px-4 py-3">Attempts</th>
                    <th className="px-4 py-3">Best</th>
                    <th className="px-4 py-3">Passed</th>
                    <th className="px-4 py-3">Certificate</th>
                    <th className="px-4 py-3 text-right">History</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {data.certifications.map((exam) => (
                    <Fragment key={exam.exam_id}>
                      <tr>
                        <td
                          className={`${CELL} font-medium text-gray-800 dark:text-white/90`}
                        >
                          {exam.exam_title}
                        </td>
                        <td
                          className={`${CELL} text-gray-600 dark:text-gray-400`}
                        >
                          {exam.course_title}
                        </td>
                        <td
                          className={`${CELL} text-gray-600 dark:text-gray-400`}
                        >
                          {exam.used_attempts} of {exam.allowed_attempts}
                          {exam.extra_granted > 0 ? (
                            <span className="ml-1 text-xs text-brand-600 dark:text-brand-400">
                              (+{exam.extra_granted} granted)
                            </span>
                          ) : null}
                        </td>
                        <td
                          className={`${CELL} text-gray-600 dark:text-gray-400`}
                        >
                          {exam.best_score === null
                            ? "Not taken"
                            : `${exam.best_score}%`}
                        </td>
                        <td className={CELL}>
                          <Flag
                            value={exam.passed}
                            yes="Passed"
                            no="Not passed"
                          />
                        </td>
                        <td className={CELL}>
                          {exam.certificate_id ? (
                            <Link
                              href={`/verify/${exam.certificate_id}`}
                              target="_blank"
                              className="text-brand-500 dark:text-brand-400 hover:text-brand-600"
                            >
                              Issued {date(exam.certificate_issued_at)}
                            </Link>
                          ) : (
                            <span className="text-gray-500 dark:text-gray-400">
                              Not issued
                            </span>
                          )}
                        </td>
                        <td className={`${CELL} text-right`}>
                          <button
                            type="button"
                            disabled={exam.attempts.length === 0}
                            onClick={() =>
                              setOpenExam(
                                openExam === exam.exam_id ? null : exam.exam_id,
                              )
                            }
                            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
                          >
                            {openExam === exam.exam_id
                              ? "Hide"
                              : `${counted(exam.attempts.length, "attempt")}`}
                          </button>
                        </td>
                      </tr>
                      {openExam === exam.exam_id ? (
                        <tr className="bg-gray-50 dark:bg-white/[0.02]">
                          <td colSpan={7} className="px-4 py-4">
                            <table className="table-wide w-full">
                              <thead className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                <tr>
                                  <th className="pb-2">Attempt</th>
                                  <th className="pb-2">Score</th>
                                  <th className="pb-2">Result</th>
                                  <th className="pb-2">When</th>
                                </tr>
                              </thead>
                              <tbody>
                                {exam.attempts.map((attempt) => (
                                  <tr key={attempt.attempt_number}>
                                    <td className="py-1.5 text-sm text-gray-800 dark:text-white/90">
                                      #{attempt.attempt_number}
                                    </td>
                                    <td className="py-1.5 text-sm text-gray-600 dark:text-gray-400">
                                      {attempt.score}%
                                    </td>
                                    <td className="py-1.5">
                                      <Flag
                                        value={attempt.passed}
                                        yes="Passed"
                                        no="Failed"
                                      />
                                    </td>
                                    <td className="py-1.5 text-sm text-gray-600 dark:text-gray-400">
                                      {stamp(attempt.taken_at)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Section>

      {/* ---- assignments ---- */}
      {data.assignments.length > 0 ? (
        <Section title="Assignments">
          <div className={PANEL}>
            <div className="overflow-x-auto">
              <table className="table-wide w-full min-w-[42rem]">
                <thead className={HEAD}>
                  <tr>
                    <th className="px-4 py-3">Assignment</th>
                    <th className="px-4 py-3">Module</th>
                    <th className="px-4 py-3">Submissions</th>
                    <th className="px-4 py-3">Best</th>
                    <th className="px-4 py-3">Last</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {data.assignments.map((row) => (
                    <tr key={row.assignment_id}>
                      <td
                        className={`${CELL} font-medium text-gray-800 dark:text-white/90`}
                      >
                        {row.title}
                      </td>
                      <td
                        className={`${CELL} text-gray-600 dark:text-gray-400`}
                      >
                        {row.module_title}
                      </td>
                      <td
                        className={`${CELL} text-gray-600 dark:text-gray-400`}
                      >
                        {row.attempts}
                      </td>
                      <td
                        className={`${CELL} text-gray-600 dark:text-gray-400`}
                      >
                        {row.best_score === null
                          ? "Not taken"
                          : `${row.best_score}%`}
                      </td>
                      <td
                        className={`${CELL} whitespace-nowrap text-gray-600 dark:text-gray-400`}
                      >
                        {stamp(row.last_submitted_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Section>
      ) : null}

      {/* ---- tutor sessions ---- */}
      <Section
        title="AI tutor sessions"
        note="Every voice lecture they have opened, and how long it ran."
      >
        {data.sessions.length === 0 ? (
          <EmptyState
            icon="🎙️"
            title="Never used the tutor"
            body="They have not opened a voice session yet."
          />
        ) : (
          <div className={PANEL}>
            <div className="overflow-x-auto">
              <table className="table-wide w-full min-w-[42rem]">
                <thead className={HEAD}>
                  <tr>
                    <th className="px-4 py-3">Started</th>
                    <th className="px-4 py-3">Module</th>
                    <th className="px-4 py-3">Course</th>
                    <th className="px-4 py-3">Length</th>
                    <th className="px-4 py-3">Ended</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {data.sessions.map((row) => (
                    <tr key={row.id}>
                      <td
                        className={`${CELL} whitespace-nowrap text-gray-600 dark:text-gray-400`}
                      >
                        {stamp(row.started_at)}
                      </td>
                      <td
                        className={`${CELL} text-gray-800 dark:text-white/90`}
                      >
                        {row.module_title ?? "Test session"}
                      </td>
                      <td
                        className={`${CELL} text-gray-600 dark:text-gray-400`}
                      >
                        {row.course_title ?? "No course"}
                      </td>
                      <td
                        className={`${CELL} text-gray-600 dark:text-gray-400`}
                      >
                        {row.ended_at ? `${row.minutes} min` : "Still open"}
                      </td>
                      <td
                        className={`${CELL} whitespace-nowrap text-gray-600 dark:text-gray-400`}
                      >
                        {stamp(row.ended_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Section>

      {/* ---- activity ---- */}
      <Section
        title="Activity"
        note="Sign-ins, sign-outs and everything else they have done, newest first."
      >
        {data.activity.length === 0 ? (
          <EmptyState
            icon="📋"
            title="Nothing recorded"
            body="No activity has been logged against this account."
          />
        ) : (
          <div className={PANEL}>
            <div className="overflow-x-auto">
              <table className="table-wide w-full min-w-[48rem]">
                <thead className={HEAD}>
                  <tr>
                    <th className="px-4 py-3">When</th>
                    <th className="px-4 py-3">What</th>
                    <th className="px-4 py-3">Details</th>
                    <th className="px-4 py-3">From</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {data.activity.map((row, index) => (
                    <tr key={`${row.action}-${row.created_at}-${index}`}>
                      <td
                        className={`${CELL} whitespace-nowrap text-gray-600 dark:text-gray-400`}
                      >
                        {stamp(row.created_at)}
                      </td>
                      <td
                        className={`${CELL} text-gray-800 dark:text-white/90`}
                      >
                        {eventLabel(row.action, row.metadata)}
                      </td>
                      <td
                        className={`${CELL} text-xs text-gray-500 dark:text-gray-400`}
                      >
                        {eventDetails(row.metadata, row.action) ?? "Not recorded"}
                      </td>
                      <td
                        className={`${CELL} text-xs text-gray-500 dark:text-gray-400`}
                      >
                        {row.ip_address ?? "Not recorded"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

export default function AdminUserDossierPage() {
  return (
    <RequireAuth roles={["admin"]}>
      <Dossier />
    </RequireAuth>
  );
}
