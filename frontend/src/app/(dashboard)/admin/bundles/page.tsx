"use client";

import { useCallback, useEffect, useState } from "react";

import RequireAuth from "@/components/auth/RequireAuth";
import BundleEditor from "@/components/admin/BundleEditor";
import {
  DashboardHeader,
  ErrorBanner,
  Panel,
} from "@/components/dashboard/Tiles";
import { useAuth } from "@/context/AuthContext";
import { type Bundle, createBundle, listBundles } from "@/lib/adminBundles";
import { formatMoney } from "@/lib/money";
import { type CourseRow, listCourses } from "@/lib/authoring";
import { counted } from "@/lib/plural";

const FIELD =
  "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

/**
 * Bundles and packages. Platform staff: a super admin or a platform admin.
 *
 * Everything sold as a subscription in one list: what it costs, which courses
 * it opens, how many people hold it, what it has taken, and — behind one click
 * per bundle — exactly who bought it.
 *
 * The role check here is convenience, not security. `GET /admin/bundles` is
 * behind `RequireSuperAdmin` and 403s an ordinary admin, so hiding the page
 * only saves them a wall of error banners.
 */
function BundlesAdmin() {
  const { user } = useAuth();
  // Platform staff, both tiers, since the role model of 2026-10-01.
  const isPlatformStaff = user?.role === "admin" || user?.role === "super_admin";

  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rupees, setRupees] = useState("");
  const [interval, setInterval] = useState("monthly");
  const [picked, setPicked] = useState<string[]>([]);
  // All Access: the server links every public course, now and later.
  const [newAllAccess, setNewAllAccess] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, allCourses] = await Promise.all([
        listBundles(),
        listCourses(),
      ]);
      setBundles(rows);
      // Public courses only. An organization's private training is not
      // something to put in a marketplace bundle, and the server would refuse
      // to show it on `/public/plans` anyway.
      setCourses(allCourses);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not load bundles.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isPlatformStaff) void load();
    else setLoading(false);
  }, [isPlatformStaff, load]);

  async function add() {
    setSaving(true);
    setError(null);
    try {
      await createBundle({
        name: name.trim(),
        description: description.trim() || null,
        price_minor: Math.round(Number(rupees || 0) * 100),
        billing_interval: interval,
        course_ids: newAllAccess ? [] : picked,
        all_access: newAllAccess,
      });
      setName("");
      setDescription("");
      setRupees("");
      setPicked([]);
      setNewAllAccess(false);
      setCreating(false);
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not create the bundle.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (!isPlatformStaff) {
    return (
      <div className="space-y-6">
        <DashboardHeader
          title="Bundles and packages"
          subtitle="What is sold as a subscription, and who holds it."
        />
        <Panel title="Platform staff only">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Bundle prices and the people who bought them sit with platform
            staff, alongside the rest of the revenue screens.
          </p>
        </Panel>
      </div>
    );
  }

  const live = bundles.filter((bundle) => bundle.is_active);
  const stacks = live.filter((bundle) => !bundle.covers_everything);
  const allAccess = live.filter((bundle) => bundle.covers_everything);
  const retired = bundles.filter((bundle) => !bundle.is_active);
  const currency = bundles[0]?.currency ?? "INR";

  const totalSubscribers = bundles.reduce(
    (sum, bundle) => sum + bundle.active_subscribers,
    0,
  );
  const totalNet = bundles.reduce((sum, bundle) => sum + bundle.net_minor, 0);

  return (
    <div className="space-y-6">
      <DashboardHeader
        title="Bundles and packages"
        subtitle="What is sold as a subscription, what it costs, and who holds it."
        action={
          <button
            type="button"
            onClick={() => setCreating((current) => !current)}
            className="rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600"
          >
            {creating ? "Cancel" : "New bundle"}
          </button>
        }
      />

      {error ? <ErrorBanner message={error} /> : null}

      {creating ? (
        <Panel
          title="New bundle"
          subtitle="A name, a price, and the courses it opens."
        >
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Name
              </span>
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Java Full Stack"
                className={FIELD}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Price ({currency})
              </span>
              <input
                type="number"
                min={0}
                step="1"
                value={rupees}
                onChange={(event) => setRupees(event.target.value)}
                placeholder="1099"
                className={FIELD}
              />
            </label>
          </div>

          <label className="mt-4 block">
            <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Description
            </span>
            <textarea
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this stack is for, in a sentence."
              className="w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
            />
          </label>

          <label className="mt-4 block max-w-xs">
            <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Billed
            </span>
            <select
              value={interval}
              onChange={(event) => setInterval(event.target.value)}
              className={FIELD}
            >
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </label>

          <label className="mt-4 flex items-center gap-2">
            <input
              type="checkbox"
              checked={newAllAccess}
              onChange={(event) => setNewAllAccess(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 dark:border-gray-700"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              All Access: every course, and new ones join automatically
            </span>
          </label>

          <div className="mt-4">
            <span className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {newAllAccess ? "Courses (all of them)" : `Courses (${picked.length} picked)`}
            </span>
            <div className="grid gap-2 sm:grid-cols-2">
              {courses.map((course) => (
                <label
                  key={course.id}
                  className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-800"
                >
                  <input
                    type="checkbox"
                    disabled={newAllAccess}
                    checked={newAllAccess || picked.includes(course.id)}
                    onChange={(event) =>
                      setPicked((current) =>
                        event.target.checked
                          ? [...current, course.id]
                          : current.filter((id) => id !== course.id),
                      )
                    }
                    className="h-4 w-4 rounded border-gray-300 dark:border-gray-700"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-700 dark:text-gray-300">
                    {course.title}
                  </span>
                  <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
                    {formatMoney(course.price_minor, course.currency)}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => void add()}
            disabled={saving || !name.trim() || (!newAllAccess && picked.length === 0)}
            className="mt-5 rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-40"
          >
            {saving ? "Creating…" : "Create bundle"}
          </button>
          {!newAllAccess && picked.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              Pick at least one course. A bundle with none in it opens nothing.
            </p>
          ) : null}
        </Panel>
      ) : null}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { label: "On sale", value: String(live.length) },
          { label: "Stack bundles", value: String(stacks.length) },
          { label: "Subscribers now", value: String(totalSubscribers) },
          { label: "Net taken", value: formatMoney(totalNet, currency) },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-2xl border border-gray-200 bg-white p-5 shadow-raised dark:border-gray-800 dark:bg-white/[0.03]"
          >
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {stat.label}
            </span>
            {/* Not a heading — see the note in `Tiles.tsx`. */}
            <p className="mt-2 text-title-sm font-bold text-gray-800 dark:text-white/90">
              {loading ? "…" : stat.value}
            </p>
          </div>
        ))}
      </div>

      {loading ? (
        <Panel title="Loading">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Reading the bundles…
          </p>
        </Panel>
      ) : (
        <>
          <Panel
            title="Stack bundles"
            subtitle={
              stacks.length === 0
                ? "None yet."
                : `${counted(stacks.length, "bundle")} covering part of the catalogue.`
            }
          >
            {stacks.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                No stack bundles on sale. Create one above.
              </p>
            ) : (
              <ul className="space-y-4">
                {stacks.map((bundle) => (
                  <BundleEditor
                    key={bundle.id}
                    bundle={bundle}
                    courses={courses}
                    onChanged={(updated) =>
                      setBundles((current) =>
                        current.map((row) =>
                          row.id === updated.id ? updated : row,
                        ),
                      )
                    }
                  />
                ))}
              </ul>
            )}
          </Panel>

          {allAccess.length > 0 ? (
            <Panel
              title="All Access"
              subtitle="Covers the whole published catalogue."
            >
              <ul className="space-y-4">
                {allAccess.map((bundle) => (
                  <BundleEditor
                    key={bundle.id}
                    bundle={bundle}
                    courses={courses}
                    onChanged={(updated) =>
                      setBundles((current) =>
                        current.map((row) =>
                          row.id === updated.id ? updated : row,
                        ),
                      )
                    }
                  />
                ))}
              </ul>
            </Panel>
          ) : null}

          {retired.length > 0 ? (
            <Panel
              title="Retired"
              subtitle="Off sale. Everyone who holds one keeps it until their period ends."
            >
              <ul className="space-y-4">
                {retired.map((bundle) => (
                  <BundleEditor
                    key={bundle.id}
                    bundle={bundle}
                    courses={courses}
                    onChanged={(updated) =>
                      setBundles((current) =>
                        current.map((row) =>
                          row.id === updated.id ? updated : row,
                        ),
                      )
                    }
                  />
                ))}
              </ul>
            </Panel>
          ) : null}
        </>
      )}
    </div>
  );
}

export default function BundlesPage() {
  // Guard matched to the API this page calls: admin_bundles.py is RequireSuperAdmin.
  //
  // Every other screen under /admin names its roles; this one did not,
  // so anyone signed in who typed the URL got an admin screen full of
  // failed requests instead of being turned away. The data was never at
  // risk — the API refuses them — but a student has no business looking
  // at the shape of the money screens.
  return (
    <RequireAuth roles={["admin"]}>
      <BundlesAdmin />
    </RequireAuth>
  );
}
