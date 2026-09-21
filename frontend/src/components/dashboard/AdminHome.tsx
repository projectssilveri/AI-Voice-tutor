"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  AreaChart,
  BarChart,
  CHART_COLORS,
  RadialProgress,
} from "@/components/charts/Charts";
import {
  DashboardHeader,
  ErrorBanner,
  Panel,
  StatTile,
} from "@/components/dashboard/Tiles";
import { useAuth } from "@/context/AuthContext";
import { formatMoney } from "@/lib/money";
import {
  type PlatformAnalytics,
  type RevenueAnalytics,
  getPlatformAnalytics,
  getRevenueAnalytics,
  shortDay,
} from "@/lib/analytics";

/**
 * The operator's home — one screen for admin and super admin.
 *
 * The difference is data, not layout: the revenue block only renders for a
 * super admin. That is presentation. What actually protects the figures is
 * `/analytics/revenue` returning 403 to anyone else, so an admin who forces
 * the request still learns nothing.
 */
export default function AdminHome() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";

  const [platform, setPlatform] = useState<PlatformAnalytics | null>(null);
  const [revenue, setRevenue] = useState<RevenueAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await getPlatformAnalytics();
        if (!cancelled) setPlatform(next);
      } catch (caught) {
        if (!cancelled) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Could not load analytics.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isSuperAdmin) return;
    let cancelled = false;
    (async () => {
      try {
        const next = await getRevenueAnalytics();
        if (!cancelled) setRevenue(next);
      } catch {
        // A missing revenue block is not worth an error banner over the whole
        // page — the rest of the dashboard is still useful.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSuperAdmin]);

  const tutorAdoption =
    platform && platform.total_students > 0
      ? (platform.students_who_used_tutor / platform.total_students) * 100
      : 0;

  return (
    <div className="space-y-6">
      <DashboardHeader
        title={isSuperAdmin ? "Platform overview" : "Admin overview"}
        subtitle={
          isSuperAdmin
            ? "Learners, engagement, and revenue across the platform."
            : "Learners, engagement, and how the AI tutor is being used."
        }
        action={
          <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-600 dark:bg-brand-500/15 dark:text-brand-400">
            {isSuperAdmin ? "Super Admin" : "Platform Admin"}
          </span>
        }
      />

      {error ? <ErrorBanner message={error} /> : null}

      {/* Revenue: super admin only. */}
      {isSuperAdmin ? (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatTile
              label="Net revenue"
              value={formatMoney(revenue?.net_minor ?? 0)}
              hint="Paid less refunds"
              tone="success"
              loading={!revenue}
            />
            <StatTile
              label="Paid orders"
              value={revenue?.paid_orders ?? 0}
              loading={!revenue}
            />
            <StatTile
              label="Conversion"
              value={`${revenue?.conversion_rate ?? 0}%`}
              hint="Checkouts that completed"
              loading={!revenue}
            />
            <StatTile
              label="Refunded"
              value={formatMoney(revenue?.refunded_minor ?? 0)}
              tone={
                revenue && revenue.refunded_minor > 0 ? "warning" : "default"
              }
              loading={!revenue}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Panel
              title="Revenue"
              subtitle="Last 30 days"
              className="lg:col-span-2"
            >
              <AreaChart
                points={(revenue?.revenue_per_day ?? []).map((point) => ({
                  label: shortDay(point.day),
                  value: point.value,
                }))}
                color={CHART_COLORS.SUCCESS}
                emptyMessage="No payments in this period."
              />
            </Panel>
            <Panel title="Revenue by course" subtitle="All time">
              <BarChart
                points={revenue?.revenue_per_course ?? []}
                horizontal
                color={CHART_COLORS.SUCCESS}
                valuePrefix="₹"
                emptyMessage="No payments yet."
              />
            </Panel>
          </div>

          <Panel
            title="Recent orders"
            subtitle="Who bought what, newest first"
            action={
              <Link
                href="/admin/users"
                className="text-sm font-medium text-brand-500 dark:text-brand-400 hover:text-brand-600"
              >
                All users
              </Link>
            }
          >
            {!revenue || revenue.recent_orders.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                No orders yet.
              </p>
            ) : (
              <div className="max-w-full overflow-x-auto custom-scrollbar">
                <table className="table-wide min-w-full text-sm">
                  <thead className="border-b border-gray-200 dark:border-gray-800">
                    <tr>
                      {["Buyer", "Item", "Amount", "Status", "When"].map(
                        (h) => (
                          <th
                            key={h}
                            className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400"
                          >
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {revenue.recent_orders.map((order) => (
                      <tr
                        key={order.id}
                        className="border-b border-gray-100 last:border-0 dark:border-gray-800"
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-800 dark:text-white/90">
                            {order.user_name}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {order.user_email}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                          {order.item}
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-800 dark:text-white/90">
                          {formatMoney(order.amount_minor, order.currency)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              order.status === "paid"
                                ? "bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-400"
                                : order.status === "failed"
                                  ? "bg-error-50 text-error-700 dark:bg-error-500/15 dark:text-error-400"
                                  : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                            }`}
                          >
                            {order.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                          {new Date(order.created_at).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      ) : null}

      {/* Learners — both roles. */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label="Students"
          value={platform?.total_students ?? 0}
          loading={loading}
        />
        <StatTile
          label="Active (30d)"
          value={platform?.active_students_30d ?? 0}
          hint="Used the tutor"
          loading={loading}
        />
        <StatTile
          label="Enrolments"
          value={platform?.total_enrolments ?? 0}
          loading={loading}
        />
        <StatTile
          label="Modules done"
          value={platform?.modules_completed ?? 0}
          tone="success"
          loading={loading}
        />
        <StatTile
          label="Certificates"
          value={platform?.certificates_issued ?? 0}
          tone="brand"
          loading={loading}
        />
        <StatTile
          label="Tutor minutes"
          value={platform?.total_voice_minutes ?? 0}
          hint={`${platform?.total_interruptions ?? 0} interruptions`}
          loading={loading}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel
          title="New students"
          subtitle="Signups, last 30 days"
          className="lg:col-span-2"
        >
          <AreaChart
            points={(platform?.signups_per_day ?? []).map((point) => ({
              label: shortDay(point.day),
              value: point.value,
            }))}
            emptyMessage="No signups in this period."
          />
        </Panel>

        <Panel
          title="AI tutor adoption"
          subtitle="Students who have used it at least once"
        >
          <RadialProgress percent={tutorAdoption} label="of students" />
          <p className="mt-2 text-center text-sm text-gray-500 dark:text-gray-400">
            {platform?.students_who_used_tutor ?? 0} of{" "}
            {platform?.total_students ?? 0} have started a session
          </p>
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Tutor usage" subtitle="Minutes per day">
          <BarChart
            points={(platform?.voice_minutes_per_day ?? []).map((point) => ({
              label: shortDay(point.day),
              value: point.value,
            }))}
            valueSuffix=" min"
            emptyMessage="No tutor sessions in this period."
          />
        </Panel>
        <Panel
          title="Enrolments per course"
          subtitle="All time, busiest first"
        >
          {/* TOP EIGHT, not all fifteen. Past about seven categories a bar
              chart stops being a comparison and becomes a badly sorted table —
              and with courses nobody has joined now filtered out server-side,
              what is left is the part worth ranking. The count below says how
              many did not fit, so nothing is silently hidden. */}
          <BarChart
            points={(platform?.enrolments_per_course ?? []).slice(0, 8)}
            horizontal
            color={CHART_COLORS.BRAND_SOFT}
            valueSuffix=" enrolled"
            emptyMessage="Nobody has enrolled in anything yet."
          />
          {(platform?.enrolments_per_course ?? []).length > 8 ? (
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              {(platform?.enrolments_per_course ?? []).length - 8} more course
              {(platform?.enrolments_per_course ?? []).length - 8 === 1
                ? ""
                : "s"}{" "}
              with fewer enrolments.
            </p>
          ) : null}
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel
          title="Completion rate"
          subtitle="Share of enrolled learners' modules finished"
        >
          {/* `percentage` pins the axis to 0-100. It used to scale to the data,
              so a chart topping out at 50% filled the panel and read as though
              everything were finished — and when the figure could still exceed
              100 (it could: a course measured 125%) the axis quietly drew to
              150 and made an impossible number look like a good one.

              Courses with nobody enrolled are dropped server-side. A 0% bar on
              a course nobody has started says "everyone is failing this" when
              it means "nobody has begun". */}
          <BarChart
            points={(platform?.completion_rate_per_course ?? []).slice(0, 8)}
            horizontal
            percentage
            color={CHART_COLORS.SUCCESS}
            valueSuffix="%"
            emptyMessage="No enrolled learners yet, so nothing to measure."
          />
        </Panel>

        <Panel
          title="Certification"
          subtitle={`${platform?.cert_pass_rate ?? 0}% of submitted attempts pass`}
        >
          <RadialProgress
            percent={platform?.cert_pass_rate ?? 0}
            label="pass rate"
            color={CHART_COLORS.WARNING}
          />
          <p className="mt-2 text-center text-sm text-gray-500 dark:text-gray-400">
            {platform?.certificates_issued ?? 0} certificates issued
          </p>
        </Panel>
      </div>

      <Panel
        title="Top learners"
        subtitle="Ranked by modules completed, certificates, and time with the tutor"
      >
        {loading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
        ) : (platform?.leaderboard ?? []).length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">
            No learner activity yet.
          </p>
        ) : (
          <div className="max-w-full overflow-x-auto custom-scrollbar">
            <table className="table-wide min-w-full text-sm">
              <thead className="border-b border-gray-200 dark:border-gray-800">
                <tr>
                  {[
                    "#",
                    "Student",
                    "Modules",
                    "Certificates",
                    "Minutes",
                    "Score",
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(platform?.leaderboard ?? []).map((row, index) => (
                  <tr
                    key={row.user_id}
                    className="border-b border-gray-100 last:border-0 dark:border-gray-800"
                  >
                    <td className="px-4 py-3">
                      <span
                        className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                          index === 0
                            ? "bg-warning-100 text-warning-700 dark:bg-warning-500/20 dark:text-orange-300"
                            : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                        }`}
                      >
                        {index + 1}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-800 dark:text-white/90">
                        {row.name}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {row.email}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                      {row.modules_completed}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                      {row.certificates}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                      {row.voice_minutes}
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-800 dark:text-white/90">
                      {row.score}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
