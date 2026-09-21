"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { formatMoney } from "@/lib/money";
import { ApiError, errorText } from "@/lib/api";
import { type CourseDetail, enroll, getCourse, unenroll } from "@/lib/student";
import {
  Skeleton,
  SkeletonPanel,
  SkeletonText,
} from "@/components/ui/Skeleton";
import ModuleAccordion from "@/components/dashboard/ModuleAccordion";
import CourseAccessNote from "@/components/dashboard/CourseAccessNote";
import ExpiryNotice from "@/components/dashboard/ExpiryNotice";
import CourseCertificationCta from "@/components/dashboard/CourseCertificationCta";

export default function CourseDetailPage() {
  const params = useParams<{ courseId: string }>();
  const courseId = params.courseId;

  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // MISSING AND BROKEN ARE DIFFERENT ANSWERS.
  //
  // This used to render "We can't find that course" for every failure, so a
  // backend that was down or 500ing told the student their course did not
  // exist — which sends them away and hides the outage from anyone watching.
  // Decision 63 fixed exactly this on the public side and left this half.
  //
  // Only a real 404 (or a 402, which the paywall notice handles) means the
  // course is not there. Everything else says so plainly and offers a retry,
  // because a retry is usually all it needs.
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCourse(await getCourse(courseId));
      setMissing(false);
      setError(null);
    } catch (caught) {
      const notThere = caught instanceof ApiError && caught.status === 404;
      setMissing(notThere);
      setError(
        notThere
          ? null
          : errorText(caught, "Could not load the course."),
      );
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleLeave() {
    // Asked once, and the question names what actually happens. "Are you sure?"
    // tells somebody nothing; the thing they want to know is whether they lose
    // the work.
    if (
      !window.confirm(
        `Leave ${course?.title ?? "this course"}?\n\nYour progress, quiz scores and any certificate are kept. You can enrol again and pick up where you left off.`,
      )
    ) {
      return;
    }
    setEnrolling(true);
    setError(null);
    try {
      await unenroll(courseId);
      await load();
    } catch (caught) {
      setError(errorText(caught, "Could not leave."));
    } finally {
      setEnrolling(false);
    }
  }

  async function handleEnroll() {
    setEnrolling(true);
    setError(null);
    try {
      await enroll(courseId);
      await load();
    } catch (caught) {
      setError(errorText(caught, "Could not enrol."));
    } finally {
      setEnrolling(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-3 h-7 w-72" />
          <div className="mt-3 max-w-3xl">
            <SkeletonText lines={2} />
          </div>
        </div>
        <SkeletonPanel lines={4} />
      </div>
    );
  }

  if (!course) {
    // A bad course id in the URL is a wrong-page problem, not an error to
    // stare at — it needs a route back, which a bare red box did not give.
    return (
      <div className="rounded-2xl border border-gray-200 bg-white shadow-raised p-8 text-center dark:border-gray-800 dark:bg-white/[0.03]">
        <h1 className="mb-2 text-lg font-semibold text-gray-800 dark:text-white/90">
          {missing
            ? "We can't find that course"
            : "We could not load that course"}
        </h1>
        <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">
          {missing
            ? "It may have been removed, or the link may be wrong."
            : `${error ?? "We could not load this course."} That is our end. Try again in a moment.`}
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          {!missing ? (
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600"
            >
              Try again
            </button>
          ) : null}
          <Link
            href="/learn"
            className={`inline-flex rounded-lg px-5 py-2.5 text-sm font-medium transition ${
              missing
                ? "bg-brand-500 text-white hover:bg-brand-600"
                : "border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
            }`}
          >
            Browse all courses
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/learn"
          className="mb-2 inline-block text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400"
        >
          ← All courses
        </Link>
        <h1 className="mb-1 text-title-sm font-bold text-gray-800 dark:text-white/90">
          {course.title}
        </h1>
        <p className="max-w-3xl text-sm text-gray-500 dark:text-gray-400">
          {course.description}
        </p>
        {/* Same numbers as the course card on /learn, from the same helper —
            two screens telling a student different expiry dates is exactly the
            kind of disagreement that ends up in a support ticket. */}
        <CourseAccessNote course={course} className="mt-2 text-sm" />
      </div>

      {error ? (
        <div className="rounded-2xl border border-error-500 bg-error-50 p-4 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400">
          {error}
        </div>
      ) : null}

      {/* Before the paywall block, so somebody whose access has just lapsed
          reads WHY they are being asked to pay before they read the price. */}
      <ExpiryNotice
        courseId={course.id}
        courseTitle={course.title}
        expiresAt={course.expires_at}
        accessVia={course.access_via}
      />

      {/* Two different situations, and conflating them is what makes paywalls
          confusing: you either need to BUY this course, or you own it and just
          have not enrolled yet. */}
      {!course.has_access ? (
        <div className="rounded-2xl border border-brand-200 bg-brand-25 p-6 dark:border-brand-800 dark:bg-brand-500/10">
          <p className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">
            You do not have this course yet
          </p>
          <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
            It costs {formatMoney(course.price_minor, course.currency)}. You can
            read every module here already. Buying turns on the voice tutor, the
            quizzes and the certification exam.
          </p>
          {/* Buying happens on the public course page, which is the one place
              that sells. Two checkout buttons on two screens is two places for
              the price to drift. */}
          <Link
            href={`/courses/${courseId}`}
            className="inline-flex rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600"
          >
            View course and buy
          </Link>
        </div>
      ) : !course.enrolled ? (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-brand-200 bg-brand-25 p-5 dark:border-brand-800 dark:bg-brand-500/10">
          <div>
            <p className="font-medium text-gray-800 dark:text-white/90">
              Enrol to use the AI tutor
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {course.access_reason === "subscription"
                ? "Included in your subscription. "
                : course.access_reason === "purchased"
                  ? "You own this course. "
                  : ""}
              You can read every module either way. Enrolling tracks your
              progress and turns on the voice tutor.
            </p>
          </div>
          <button
            type="button"
            onClick={handleEnroll}
            disabled={enrolling}
            className="rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {enrolling ? "Enrolling…" : "Enrol"}
          </button>
        </div>
      ) : null}

      <div className="rounded-2xl border border-gray-200 bg-white shadow-raised p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
        <h2 className="mb-4 text-base font-semibold text-gray-800 dark:text-white/90">
          Modules
        </h2>

        <ModuleAccordion
          courseId={courseId}
          modules={course.modules}
          enrolled={course.enrolled}
        />
      </div>

      {/* The end of the course, at the end of the page. Locked until every
          module is complete — the exam is the one capped assessment here, and
          sitting it before you have been taught the material is how a student
          spends an attempt they cannot get back. */}
      <CourseCertificationCta
        courseId={courseId}
        modules={course.modules}
        enrolled={course.enrolled}
        hasAccess={course.has_access}
      />
      {course.enrolled ? (
        <p className="pt-2 text-center text-sm text-gray-500 dark:text-gray-400">
          <button
            type="button"
            onClick={handleLeave}
            disabled={enrolling}
            className="underline underline-offset-2 hover:text-gray-700 disabled:opacity-50 dark:hover:text-gray-300"
          >
            Leave this course
          </button>{" "}
          . Your progress is kept if you come back.
        </p>
      ) : null}
    </div>
  );
}
