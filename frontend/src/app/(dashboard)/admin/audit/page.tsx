"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import RequireAuth from "@/components/auth/RequireAuth";
import EmptyState from "@/components/ui/EmptyState";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { useAuth } from "@/context/AuthContext";
import {
  type AuditActor,
  type AuditEvent,
  type AuditFacets,
  type AuditQuery,
  actionLabel,
  describeRequest,
  actionTone,
  auditExportUrl,
  listAuditActors,
  listAuditEvents,
  listAuditFacets,
} from "@/lib/audit";
import { counted } from "@/lib/plural";
import { roleLabel } from "@/lib/roles";

/**
 * The compliance audit console.
 *
 * Filters are the whole point of this screen. A trail nobody can narrow is a
 * trail nobody reads: the questions asked of it are always "what did THIS
 * person do", "who touched THAT", "what happened between these dates" — and
 * before this it offered an action dropdown and a start date.
 *
 * The people filter is a picker built from who actually appears in the trail
 * (`/admin/audit/actors`), not a box to paste a UUID into. Nobody knows a
 * colleague's UUID, and a headline filter that needs one is a filter nobody
 * uses.
 *
 * Everything here is applied server-side, including the CSV export, which
 * carries the same filters and the same tenancy scope.
 */

const PAGE_SIZE = 50;

const TONE: Record<string, string> = {
  brand: "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-400",
  success:
    "bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-400",
  warning:
    "bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-400",
  error: "bg-error-50 text-error-700 dark:bg-error-500/15 dark:text-error-400",
  gray: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

const FIELD =
  "h-10 rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

/** Families, so "show me everything about signing in" is one click. */
const FAMILIES = [
  { value: "", label: "Everything" },
  { value: "auth.%", label: "Signing in and out" },
  { value: "voice.%", label: "AI tutor" },
  { value: "assessment.%", label: "Quizzes and exams" },
  { value: "progress.%", label: "Progress" },
  { value: "admin.%", label: "Admin actions" },
  { value: "content.%", label: "Course content" },
  { value: "org.%", label: "Organisations" },
  { value: "billing.%", label: "Payments" },
  { value: "message.%", label: "Messages" },
  { value: "http.request", label: "Other changes" },
];

/** Today, and N days back, as the YYYY-MM-DD a date input wants. */
function isoDay(offsetDays = 0): string {
  const day = new Date();
  day.setDate(day.getDate() - offsetDays);
  return day.toISOString().slice(0, 10);
}

function when(iso: string): { date: string; time: string } {
  const value = new Date(iso);
  return {
    date: value.toLocaleDateString(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
    // Seconds included on purpose: an audit trail is read to work out the
    // order things happened in, and minute precision loses that whenever
    // several actions land inside the same minute — which is most of them.
    time: value.toLocaleTimeString(undefined, { hour12: false }),
  };
}

/** One field that moved, written as it reads out loud: was this, now that. */
function Change({
  field,
  from,
  to,
}: {
  field: string;
  from: unknown;
  to: unknown;
}) {
  const show = (value: unknown) =>
    value === null || value === undefined || value === ""
      ? "empty"
      : typeof value === "boolean"
        ? value
          ? "yes"
          : "no"
        : String(value);
  return (
    <span className="block">
      <span className="text-gray-500 dark:text-gray-400">
        {field.replace(/_/g, " ")}:
      </span>{" "}
      <span className="text-gray-500 line-through dark:text-gray-500">
        {show(from)}
      </span>{" "}
      <span aria-hidden="true" className="text-gray-400">
        →
      </span>{" "}
      <span className="font-medium text-gray-800 dark:text-white/90">
        {show(to)}
      </span>
    </span>
  );
}

/**
 * The details column: what was touched, and what moved.
 *
 * IT USED TO PRINT THE RAW METADATA, every key joined with a dot, which is how
 * "Changed something · status: 200 · method: PATCH · path: /courses/8f3a..."
 * came to be the most common row in the trail. Three separate complaints came
 * out of that one line: nobody could tell what changed (issues 41, 59, 60),
 * nobody could tell what it changed TO (60), and the request path was on screen
 * for admins who have no use for it (issue 65).
 *
 * So: the name of the thing first, then each field that moved as "was → now",
 * then whatever is left over. `method`, `path` and `status` are dropped
 * entirely — `actionLabel` has already turned them into a sentence by the time
 * this renders, and repeating the plumbing underneath it adds nothing.
 */
const PLUMBING = new Set(["method", "path", "status"]);

function Meta({ data }: { data: Record<string, unknown> | null }) {
  if (!data || Object.keys(data).length === 0) return null;

  const name = typeof data.name === "string" ? data.name : null;
  const moved =
    data.changes && typeof data.changes === "object"
      ? (data.changes as Record<string, { from?: unknown; to?: unknown }>)
      : null;

  const rest = Object.entries(data).filter(
    ([key]) => !PLUMBING.has(key) && key !== "name" && key !== "changes",
  );

  if (!name && !moved && rest.length === 0) return null;

  return (
    <span className="block text-xs text-gray-500 dark:text-gray-400">
      {name ? (
        <span className="block font-medium text-gray-800 dark:text-white/90">
          {name}
        </span>
      ) : null}
      {moved
        ? Object.entries(moved).map(([field, value]) => (
            <Change
              key={field}
              field={field}
              from={value?.from}
              to={value?.to}
            />
          ))
        : null}
      {rest.length > 0 ? (
        <span className="block">
          {rest
            .map(([key, value]) => `${key.replace(/_/g, " ")}: ${String(value)}`)
            .join(" · ")}
        </span>
      ) : null}
    </span>
  );
}

function AuditConsole() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";
  // Every organisation's trail for platform staff since 2026-10-01. The
  // path filter below stays the super admin's: it is a debugging tool.
  const isPlatformStaff = user?.role === "admin" || user?.role === "super_admin";

  const [page, setPage] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [facets, setFacets] = useState<AuditFacets | null>(null);
  const [actors, setActors] = useState<AuditActor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(true);

  // One object rather than nine useStates: every filter has to travel together
  // to the listing, the count and the export, and splitting them is how the
  // export comes to disagree with the screen.
  const [filters, setFilters] = useState<AuditQuery>({});

  function set<K extends keyof AuditQuery>(key: K, value: AuditQuery[K]) {
    setOffset(0);
    setFilters((current) => ({ ...current, [key]: value || undefined }));
  }

  const query = useMemo<AuditQuery>(
    () => ({
      ...filters,
      // A date input gives YYYY-MM-DD; the API wants a datetime, and the whole
      // of that day is what a person means when they pick it.
      since: filters.since ? `${filters.since}T00:00:00` : undefined,
      until: filters.until ? `${filters.until}T23:59:59` : undefined,
    }),
    [filters],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listAuditEvents({
        ...query,
        limit: PAGE_SIZE,
        offset,
      });
      setPage(result.events);
      setTotal(result.total);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not load the audit trail.",
      );
    } finally {
      setLoading(false);
    }
  }, [query, offset]);

  useEffect(() => {
    // Debounced, because the free-text and IP boxes fire on every keystroke
    // against the fastest-growing table in the schema.
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    Promise.all([listAuditFacets(), listAuditActors()])
      .then(([foundFacets, foundActors]) => {
        setFacets(foundFacets);
        setActors(foundActors);
      })
      .catch(() => {
        // The filters are a convenience. Failing to build them must not take
        // the trail itself down with them.
      });
  }, []);

  const active = Object.entries(filters).filter(
    ([, value]) => value !== undefined && value !== "",
  ).length;

  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-title-sm font-bold text-gray-800 dark:text-white/90">
            Audit trail
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Who did what, when, and from where.
            {isPlatformStaff
              ? " You can see every organisation."
              : " Platform activity only. Each organisation keeps its own trail."}
          </p>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setShowFilters((open) => !open)}
            className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
          >
            {showFilters ? "Hide filters" : "Filters"}
            {active > 0 ? (
              <span className="ml-2 rounded-full bg-brand-500 px-2 py-0.5 text-xs text-white">
                {active}
              </span>
            ) : null}
          </button>
          <a
            href={auditExportUrl(query)}
            className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600"
          >
            Download CSV
          </a>
        </div>
      </div>

      {showFilters ? (
        <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-raised dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label
                htmlFor="filter-actor"
                className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
              >
                Person
              </label>
              <select
                id="filter-actor"
                value={filters.actor_user_id ?? ""}
                onChange={(event) => set("actor_user_id", event.target.value)}
                className={`${FIELD} w-full`}
              >
                <option value="">Anyone</option>
                {actors.map((actor) => (
                  <option key={actor.id} value={actor.id}>
                    {actor.name} ({actor.email}) · {actor.events}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="filter-search"
                className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
              >
                Search by name or email
              </label>
              <input
                id="filter-search"
                value={filters.q ?? ""}
                onChange={(event) => set("q", event.target.value)}
                placeholder="Part of a name or address"
                className={`${FIELD} w-full`}
              />
            </div>

            <div>
              {/* This and the box beside it are two ways of setting the same
                  filter: a family ("auth.%") or one exact action. Picking in
                  one clears the other, which is why the labels read as a pair
                  rather than as two independent filters. */}
              <label
                htmlFor="filter-family"
                className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
              >
                Kind of activity
              </label>
              <select
                id="filter-family"
                value={
                  FAMILIES.some((family) => family.value === filters.action)
                    ? (filters.action ?? "")
                    : ""
                }
                onChange={(event) => set("action", event.target.value)}
                className={`${FIELD} w-full`}
              >
                {FAMILIES.map((family) => (
                  <option key={family.value} value={family.value}>
                    {family.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="filter-action"
                className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
              >
                …or one exact action
              </label>
              <select
                id="filter-action"
                value={filters.action ?? ""}
                onChange={(event) => set("action", event.target.value)}
                className={`${FIELD} w-full`}
              >
                <option value="">Any action</option>
                {(facets?.actions ?? []).map((action) => (
                  <option key={action} value={action}>
                    {actionLabel(action)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="filter-role"
                className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
              >
                Their role
              </label>
              <select
                id="filter-role"
                value={filters.actor_role ?? ""}
                onChange={(event) => set("actor_role", event.target.value)}
                className={`${FIELD} w-full`}
              >
                <option value="">Any role</option>
                {(facets?.roles ?? []).map((role) => (
                  <option key={role} value={role}>
                    {roleLabel(role)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="filter-target"
                className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
              >
                What was acted on
              </label>
              <select
                id="filter-target"
                value={filters.target_type ?? ""}
                onChange={(event) => set("target_type", event.target.value)}
                className={`${FIELD} w-full`}
              >
                <option value="">Anything</option>
                {(facets?.target_types ?? []).map((target) => (
                  <option key={target} value={target}>
                    {target.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="filter-ip"
                className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
              >
                IP address
              </label>
              <input
                id="filter-ip"
                value={filters.ip_address ?? ""}
                onChange={(event) => set("ip_address", event.target.value)}
                placeholder="Whole address or the start of one"
                className={`${FIELD} w-full`}
              />
            </div>

            {/* SUPER ADMIN ONLY. Searching by API path is a debugging tool,
                not an administrative one — an ordinary admin has no way to
                know what to type in it, and issue 65 objects to backend
                plumbing being on this screen at all. It stays for whoever
                actually investigates an incident. */}
            {isSuperAdmin ? (
              <div>
                <label
                  htmlFor="filter-path"
                  className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
                >
                  Request path
                </label>
                <input
                  id="filter-path"
                  value={filters.path ?? ""}
                  onChange={(event) => set("path", event.target.value)}
                  placeholder="/api/v1/admin"
                  className={`${FIELD} w-full`}
                />
              </div>
            ) : null}

            {isPlatformStaff && (facets?.organizations.length ?? 0) > 0 ? (
              <div>
                <label
                  htmlFor="filter-org"
                  className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
                >
                  Organisation
                </label>
                <select
                  id="filter-org"
                  value={filters.organization_id ?? ""}
                  onChange={(event) =>
                    set("organization_id", event.target.value)
                  }
                  className={`${FIELD} w-full`}
                >
                  <option value="">Every organisation</option>
                  {(facets?.organizations ?? []).map((organization) => (
                    <option key={organization.id} value={organization.id}>
                      {organization.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div>
              <label
                htmlFor="filter-since"
                className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
              >
                From
              </label>
              <input
                id="filter-since"
                type="date"
                value={filters.since ?? ""}
                onChange={(event) => set("since", event.target.value)}
                className={`${FIELD} w-full`}
              />
            </div>

            <div>
              <label
                htmlFor="filter-until"
                className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
              >
                To
              </label>
              <input
                id="filter-until"
                type="date"
                value={filters.until ?? ""}
                onChange={(event) => set("until", event.target.value)}
                className={`${FIELD} w-full`}
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Quick range
            </span>
            {[
              { label: "Today", days: 0 },
              { label: "Last 7 days", days: 6 },
              { label: "Last 30 days", days: 29 },
              { label: "Last 90 days", days: 89 },
            ].map((range) => (
              <button
                key={range.label}
                type="button"
                onClick={() => {
                  setOffset(0);
                  setFilters((current) => ({
                    ...current,
                    since: isoDay(range.days),
                    until: isoDay(0),
                  }));
                }}
                // `min-h-11` is the touch target; `sm:` puts the compact
                // chip back for a mouse, where 26px was never the problem.
                className="inline-flex min-h-11 items-center rounded-full border border-gray-300 px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-50 sm:min-h-0 sm:px-3 sm:py-1 sm:text-xs dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
              >
                {range.label}
              </button>
            ))}
            {active > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setOffset(0);
                  setFilters({});
                }}
                className="ml-auto inline-flex min-h-11 items-center rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-50 sm:min-h-0 sm:px-3 sm:py-1.5 sm:text-xs dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
              >
                Clear {counted(active, "filter")}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-error-500 bg-error-50 px-4 py-2.5 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400"
        >
          {error}
        </p>
      ) : null}

      {loading ? (
        <SkeletonRows rows={10} />
      ) : page.length === 0 ? (
        <EmptyState
          icon="📋"
          title="Nothing matches"
          body={
            active > 0
              ? "No activity matches those filters. Try widening the dates."
              : "Nothing has been recorded yet."
          }
        />
      ) : (
        <>
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-raised dark:border-gray-800 dark:bg-white/[0.03]">
            <div className="overflow-x-auto">
              <table className="table-wide w-full min-w-[62rem]">
                <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:bg-white/[0.02] dark:text-gray-400">
                  <tr>
                    <th className="px-4 py-3">When</th>
                    <th className="px-4 py-3">Who</th>
                    <th className="px-4 py-3">What</th>
                    <th className="px-4 py-3">Details</th>
                    <th className="px-4 py-3">From</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {page.map((event) => {
                    const at = when(event.created_at);
                    return (
                      <tr
                        key={event.id}
                        className="hover:bg-gray-50 dark:hover:bg-white/[0.02]"
                      >
                        <td className="whitespace-nowrap px-4 py-3 align-top text-sm text-gray-600 dark:text-gray-400">
                          {at.date}
                          <span className="block text-xs text-gray-500 dark:text-gray-400">
                            {at.time}
                          </span>
                        </td>
                        <td className="px-4 py-3 align-top text-sm">
                          {event.actor_name ? (
                            <>
                              <button
                                type="button"
                                onClick={() =>
                                  set(
                                    "actor_user_id",
                                    event.actor_user_id ?? "",
                                  )
                                }
                                // 49 of these on one screen at 20px tall.
                                // The padding is negative-margined back out so
                                // the bigger hit area does not push the row
                                // apart — the target grows, the layout does not.
                                className="-mx-1 -my-2 inline-flex min-h-11 items-center px-1 py-2 text-left font-medium text-gray-800 hover:text-brand-500 sm:mx-0 sm:my-0 sm:min-h-0 sm:px-0 sm:py-0 dark:text-white/90"
                                title="Show only this person"
                              >
                                {event.actor_name}
                              </button>
                              <span className="block text-xs text-gray-500 dark:text-gray-400">
                                {event.actor_email}
                              </span>
                            </>
                          ) : (
                            <span className="text-gray-500 dark:text-gray-400">
                              Not signed in
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <span
                            className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${
                              TONE[actionTone(event.action)]
                            }`}
                          >
                            {(event.action === "http.request"
                              ? describeRequest(event.metadata)
                              : null) ?? actionLabel(event.action)}
                          </span>
                        </td>
                        <td className="px-4 py-3 align-top text-sm">
                          {event.target_type ? (
                            <span className="block text-xs text-gray-600 dark:text-gray-400">
                              {event.target_type.replace(/_/g, " ")}
                            </span>
                          ) : null}
                          <Meta data={event.metadata} />
                        </td>
                        <td className="px-4 py-3 align-top text-xs text-gray-500 dark:text-gray-400">
                          {event.ip_address ?? "Not recorded"}
                          {event.user_agent ? (
                            <span
                              className="block max-w-48 truncate"
                              title={event.user_agent}
                            >
                              {event.user_agent}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Showing {from}–{to} of {total.toLocaleString()}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={to >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function AdminAuditPage() {
  return (
    <RequireAuth roles={["admin"]}>
      <AuditConsole />
    </RequireAuth>
  );
}
