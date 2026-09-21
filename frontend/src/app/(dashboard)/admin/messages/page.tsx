"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import RequireAuth from "@/components/auth/RequireAuth";
import MessageCentre from "@/components/messages/MessageCentre";
import EmptyState from "@/components/ui/EmptyState";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { type DirectMessage, listAllMessages } from "@/lib/messages";
import { counted } from "@/lib/plural";

/**
 * Private messages, from the staff side.
 *
 * Two panels, and the split is the point. The table is EVERY message on the
 * platform, because a support inbox that only shows what was addressed to the
 * admin currently looking at it is not a support inbox — whoever is on shift
 * needs to see the lot. The panel underneath is that admin's own mail, where
 * replying happens.
 *
 * Scoped server-side: an ordinary platform admin does not read a customer
 * organization's correspondence (decision 171). A super admin does, for
 * support.
 */

const CELL = "px-4 py-3 align-top text-sm";

function when(iso: string): string {
  const date = new Date(iso);
  return `${date.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })}, ${date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function Person({
  name,
  email,
  phone,
  role,
}: {
  name: string;
  email: string;
  phone: string | null;
  role: string;
}) {
  return (
    <div>
      <p className="font-medium text-gray-800 dark:text-white/90">{name}</p>
      <a
        href={`mailto:${email}`}
        className="block text-xs text-brand-500 dark:text-brand-400 hover:text-brand-600"
      >
        {email}
      </a>
      {phone ? (
        <a
          href={`tel:${phone}`}
          className="block text-xs text-brand-500 dark:text-brand-400 hover:text-brand-600"
        >
          {phone}
        </a>
      ) : (
        <span className="block text-xs text-gray-500 dark:text-gray-400">
          No phone
        </span>
      )}
      <span className="text-xs text-gray-500 dark:text-gray-400">
        {role.replace(/_/g, " ")}
      </span>
    </div>
  );
}

function StaffMessages() {
  const [rows, setRows] = useState<DirectMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listAllMessages(search.trim() || undefined));
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not load messages.",
      );
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    // Debounced so typing in the search box does not fire a request per
    // keystroke against a table that grows with every message ever sent.
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  const unread = useMemo(
    () => rows.filter((row) => row.read_at === null).length,
    [rows],
  );

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-title-sm font-bold text-gray-800 dark:text-white/90">
          Private messages
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Everything sent between accounts on the platform.{" "}
          {unread > 0
            ? `${counted(unread, "message")} not yet opened by the person it went to.`
            : "All of it has been opened."}
        </p>
      </div>

      <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search subject, sender or recipient"
        className="mb-4 h-10 w-full max-w-md rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
      />

      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-error-500 bg-error-50 px-4 py-2.5 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400"
        >
          {error}
        </p>
      ) : null}

      {loading ? (
        <SkeletonRows rows={5} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="✉️"
          title="No private messages"
          body={
            search
              ? "Nothing matches what you searched for."
              : "When someone writes in from their profile, it appears here."
          }
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-raised dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="overflow-x-auto">
            <table className="table-wide w-full min-w-[58rem]">
              <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:bg-white/[0.02] dark:text-gray-400">
                <tr>
                  <th className="px-4 py-3">Sent</th>
                  <th className="px-4 py-3">From</th>
                  <th className="px-4 py-3">To</th>
                  <th className="px-4 py-3">Message</th>
                  <th className="px-4 py-3">Opened</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="hover:bg-gray-50 dark:hover:bg-white/[0.02]"
                  >
                    <td
                      className={`${CELL} whitespace-nowrap text-gray-500 dark:text-gray-400`}
                    >
                      {when(row.created_at)}
                    </td>
                    <td className={CELL}>
                      <Person
                        name={row.sender_name}
                        email={row.sender_email}
                        phone={row.sender_phone}
                        role={row.sender_role}
                      />
                    </td>
                    <td className={CELL}>
                      <Person
                        name={row.recipient_name}
                        email={row.recipient_email}
                        phone={row.recipient_phone}
                        role={row.recipient_role}
                      />
                    </td>
                    <td className={`${CELL} max-w-md`}>
                      <p className="font-medium text-gray-800 dark:text-white/90">
                        {row.subject}
                      </p>
                      <p className="whitespace-pre-wrap text-gray-600 dark:text-gray-400">
                        {row.body}
                      </p>
                    </td>
                    <td className={CELL}>
                      {row.read_at ? (
                        <span className="inline-flex whitespace-nowrap rounded-full bg-success-50 px-2.5 py-1 text-xs font-medium text-success-700 dark:bg-success-500/15 dark:text-success-400">
                          {when(row.read_at)}
                        </span>
                      ) : (
                        <span className="inline-flex whitespace-nowrap rounded-full bg-warning-50 px-2.5 py-1 text-xs font-medium text-warning-700 dark:bg-warning-500/15 dark:text-warning-400">
                          Not yet
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-8 rounded-2xl border border-gray-200 bg-white p-6 shadow-raised dark:border-gray-800 dark:bg-white/[0.03]">
        <MessageCentre
          title="Your mailbox"
          intro="What was sent to you, what you have sent, and a box to write a new one."
        />
      </div>
    </div>
  );
}

export default function AdminMessagesPage() {
  return (
    <RequireAuth roles={["admin"]}>
      <StaffMessages />
    </RequireAuth>
  );
}
