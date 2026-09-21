"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import EmptyState from "@/components/ui/EmptyState";
import { ApiError } from "@/lib/api";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { Action } from "@/components/ui/Action";
import OrgShell from "@/components/org/OrgShell";
import { actionTone, eventLabel, orgPageOpened } from "@/lib/audit";
import {
  type OrgAuditEvent,
  type OrgProfile,
  getOrgProfile,
  listOrgAudit,
} from "@/lib/orgPortal";

const PAGE = 50;

const TONE: Record<string, string> = {
  brand: "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-400",
  success:
    "bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-400",
  warning:
    "bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-400",
  error: "bg-error-50 text-error-700 dark:bg-error-500/15 dark:text-error-400",
  gray: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

/**
 * One organization's activity, and nothing else.
 *
 * The scoping is the backend's: `organization_id = this org`. An org admin
 * reading their own trail sees their own people and no one else's — not
 * another tenant's, and not the platform's own events, which have no
 * organization and are not theirs to read.
 *
 * The action labels are shared with the platform console (`lib/audit.ts`), so
 * a new event type reads the same in both places.
 */
export default function OrgAuditPage() {
  const { slug } = useParams<{ slug: string }>();
  const [events, setEvents] = useState<OrgAuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [action, setAction] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [profile, setProfile] = useState<OrgProfile | null>(null);

  useEffect(() => {
    getOrgProfile(slug)
      .then(setProfile)
      .catch(() => {
        // The shell renders without the organization name rather than the
        // page failing over a header detail.
      });
  }, [slug]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const page = await listOrgAudit(slug, {
        limit: PAGE,
        offset,
        action: action || undefined,
      });
      setEvents(page.events);
      setTotal(page.total);
      setError(null);
    } catch (caught) {
      // A REFUSAL IS NOT AN EMPTY LOG. A department admin who types this URL
      // is 403'd, and the page was then drawing "Nothing recorded yet" under
      // the error — two contradictory answers to the same question, and the
      // reassuring one is the lie. The log is the organization's, and covers
      // every department, which is exactly why they cannot read it.
      setDenied(caught instanceof ApiError && caught.status === 403);
      setError(
        caught instanceof Error ? caught.message : "Could not load the log.",
      );
    } finally {
      setLoading(false);
    }
  }, [slug, offset, action]);

  useEffect(() => {
    void load();
  }, [load]);

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
      <div className="mb-6">
        <h1 className="text-title-sm font-bold text-gray-800 dark:text-white/90">
          Activity log
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Every sign-in, tutor session and change made in this organization.
        </p>
      </div>

      {denied ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center dark:border-gray-800 dark:bg-white/[0.03]">
          <p className="mb-3 text-4xl" aria-hidden="true">
            🔒
          </p>
          <h2 className="mb-2 text-base font-semibold text-gray-800 dark:text-white/90">
            This log isn&apos;t yours to read
          </h2>
          <p className="mx-auto max-w-md text-sm text-gray-500 dark:text-gray-400">
            It covers every department in {profile?.name ?? "this organization"}
            , so only an organization administrator can open it. Your own
            department&apos;s people and training are on the other screens.
          </p>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <select
              value={action}
              onChange={(e) => {
                setAction(e.target.value);
                setOffset(0);
              }}
              aria-label="Filter by activity"
              className="h-10 rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
            >
              <option value="">Everything</option>
              <option value="auth.%">Sign-in activity</option>
              <option value="voice.%">AI tutor sessions</option>
              <option value="assessment.%">Assessments</option>
              <option value="org.%">Administrative changes</option>
            </select>
            <span className="ml-auto text-sm text-gray-500 dark:text-gray-400">
              {loading ? "Loading…" : `${total.toLocaleString()} recorded`}
            </span>
          </div>

          {error ? (
            <div
              role="alert"
              className="mb-6 rounded-2xl border border-error-500 bg-error-50 p-4 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400"
            >
              {error}
            </div>
          ) : null}

          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-raised dark:border-gray-800 dark:bg-white/[0.03]">
            {loading ? (
              <SkeletonRows rows={8} columns={3} />
            ) : events.length === 0 ? (
              <EmptyState
                icon="📋"
                title="Nothing recorded yet"
                body="Activity appears here as your people sign in and start training."
                className="border-0"
              />
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {events.map((event) => {
                  const at = new Date(event.created_at);
                  const opened = orgPageOpened(event.metadata);
                  return (
                    <li
                      key={event.id}
                      className="flex flex-wrap items-start gap-x-4 gap-y-2 px-5 py-4"
                    >
                      <div className="w-24 shrink-0 text-xs text-gray-500 dark:text-gray-400">
                        <span className="block font-mono">
                          {at.toLocaleTimeString(undefined, { hour12: false })}
                        </span>
                        <span className="block">{at.toLocaleDateString()}</span>
                      </div>
                      {/* THE BADGE SITS ABOVE THE NAME, not beside it. As
                          siblings in the flex row, a forty-character label
                          like "Platform staff opened a customer's portal"
                          took the whole line and squeezed the name into a
                          column two words wide. */}
                      <div className="min-w-[14rem] flex-1">
                        <span
                          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            TONE[actionTone(event.action)]
                          }`}
                        >
                          {eventLabel(event.action, event.metadata)}
                        </span>
                        <p className="mt-1.5 text-sm text-gray-800 dark:text-white/90">
                          {event.actor_name ?? (
                            <span className="italic text-gray-500">
                              Not signed in
                            </span>
                          )}
                          {event.actor_email ? (
                            <span className="text-gray-500 dark:text-gray-400">
                              {" "}
                              · {event.actor_email}
                            </span>
                          ) : null}
                        </p>
                        {/* WHICH PAGE. Opening the portal fires several calls
                            at once and each one is recorded, which is the
                            point: somebody reading a customer's people should
                            leave a mark. Without this they were five identical
                            lines at the same second. */}
                        {opened ? (
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            Opened {opened}
                          </p>
                        ) : null}
                      </div>
                      {/* Labelled. It read "Not recorded" on its own at the
                          end of a line, with no column heading and nothing
                          beside it to say what had not been recorded. */}
                      <span className="shrink-0 font-mono text-xs text-gray-500 dark:text-gray-400">
                        {event.ip_address ? (
                          `From ${event.ip_address}`
                        ) : (
                          <span className="font-sans italic">
                            Address not recorded
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {total > PAGE ? (
            <div className="mt-4 flex items-center justify-between">
              <Action
                variant="secondary"
                size="sm"
                disabled={offset === 0 || loading}
                onClick={() => setOffset(Math.max(0, offset - PAGE))}
              >
                ← Newer
              </Action>
              <Action
                variant="secondary"
                size="sm"
                disabled={offset + PAGE >= total || loading}
                onClick={() => setOffset(offset + PAGE)}
              >
                Older →
              </Action>
            </div>
          ) : null}
        </>
      )}
    </OrgShell>
  );
}
