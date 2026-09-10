"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Panel } from "@/components/dashboard/Tiles";
import ProgressBar from "@/components/ui/ProgressBar";
import { type HeldPlan, listMyBundles } from "@/lib/bundles";
import { counted } from "@/lib/plural";

/**
 * The bundles this student holds, and every course inside each one.
 *
 * WHY THIS EXISTS. Buying a four-course stack put four unrelated cards in
 * "Your courses" and nothing anywhere said they arrived together, what the
 * bundle was called, or when it renews. Somebody who had paid for the Java
 * stack had no way to see, from the product, that they owned it — only that
 * four courses happened to be open. Enrolment is per course and knows nothing
 * about what was bought, so this reads `/subscriptions/mine`, which does.
 *
 * Every course is listed, not the first three. The count is the point of a
 * bundle: "3 of your 4 courses" is only checkable if all four are on screen.
 *
 * Renders NOTHING when the student holds no subscription, which is most of
 * them — an empty "Your bundles" panel would be a permanent advert on the
 * dashboard of somebody who bought courses outright.
 */
export default function MyBundles() {
  const [plans, setPlans] = useState<HeldPlan[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listMyBundles()
      .then((rows) => {
        if (!cancelled) setPlans(rows);
      })
      .catch(() => {
        // Quietly. The rest of the dashboard is unaffected, and an error
        // banner here would suggest something larger had broken — the same
        // reasoning as the header search's course fetch.
        if (!cancelled) setPlans([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (plans === null || plans.length === 0) return null;

  return (
    <div className="space-y-6">
      {plans.map((plan) => (
        <Panel
          key={plan.subscription_id}
          title={plan.name}
          subtitle={subtitleFor(plan)}
          action={
            <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-600 dark:bg-brand-500/15 dark:text-brand-400">
              {plan.covers_everything ? "All Access" : "Bundle"}
            </span>
          }
        >
          <ul className="grid gap-3 md:grid-cols-2">
            {plan.courses.map((course) => (
              <li key={course.id}>
                <Link
                  href={`/learn/${course.id}`}
                  className="flex h-full flex-col gap-3 rounded-xl border border-gray-200 p-4 transition hover:border-brand-300 hover:bg-brand-25 dark:border-gray-800 dark:hover:border-brand-700 dark:hover:bg-brand-500/10"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-gray-800 dark:text-white/90">
                        {course.title}
                      </span>
                      <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                        {course.total_modules === 0
                          ? "No modules yet"
                          : `${course.completed_modules} of ${counted(
                              course.total_modules,
                              "module",
                            )}`}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs font-medium text-brand-600 dark:text-brand-400">
                      {course.percent_complete === 100
                        ? "Done"
                        : course.enrolled
                          ? "Continue"
                          : "Start"}
                    </span>
                  </div>
                  <ProgressBar
                    value={course.percent_complete}
                    tone={course.percent_complete === 100 ? "success" : "brand"}
                    label={`${course.title}: ${course.percent_complete}% complete`}
                  />
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      ))}
    </div>
  );
}

/**
 * The line under the bundle name: what is in it, how far through, and what
 * happens next.
 *
 * "Renews" and "ends" are different words on purpose. A cancelled subscription
 * still runs to the end of its period, and telling somebody it renews on a
 * date it will actually stop is the kind of small lie a billing screen must
 * not tell.
 */
function subtitleFor(plan: HeldPlan): string {
  const when = new Date(plan.renews_at).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const parts = [
    counted(plan.course_count, "course"),
    `${plan.completed_courses} finished`,
    plan.cancelled ? `ends ${when}` : `renews ${when}`,
  ];
  return parts.join(" · ");
}
