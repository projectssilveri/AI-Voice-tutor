"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import RequireAuth from "@/components/auth/RequireAuth";
import EmptyState from "@/components/ui/EmptyState";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { ApiError } from "@/lib/api";
import {
  type ContactMessage,
  listContactMessages,
  replyToContactMessage,
  setContactHandled,
} from "@/lib/messages";
import { counted } from "@/lib/plural";

/**
 * The contact-form inbox.
 *
 * Messages land in the database rather than an inbox because no mail provider
 * is wired (decision 36), so this screen is the only place anyone sees them —
 * which is why unanswered ones sort to the top and why the reply is stored
 * here rather than pretending to send an email.
 *
 * A table, not a stack of cards: these are compared with each other ("who
 * wrote in this week and which are still open"), and comparing is what a table
 * is for. Every column the sender gave us is shown, phone included, so nobody
 * has to open a row to find out how to reach them.
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

function ContactInbox() {
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showHandled, setShowHandled] = useState(true);
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const load = useCallback(async () => {
    try {
      setMessages(await listContactMessages());
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not load messages.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return messages.filter((message) => {
      if (!showHandled && message.handled) return false;
      if (!needle) return true;
      return [
        message.name,
        message.email,
        message.phone ?? "",
        message.subject ?? "",
        message.message,
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [messages, showHandled, search]);

  const open = messages.filter((message) => !message.handled).length;

  async function toggleHandled(message: ContactMessage) {
    setBusyId(message.id);
    try {
      const updated = await setContactHandled(message.id, !message.handled);
      setMessages((current) =>
        current.map((row) => (row.id === updated.id ? updated : row)),
      );
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not update it.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function submitReply(message: ContactMessage) {
    if (!draft.trim()) return;
    setBusyId(message.id);
    try {
      const updated = await replyToContactMessage(message.id, draft.trim());
      setMessages((current) =>
        current.map((row) => (row.id === updated.id ? updated : row)),
      );
      setOpenId(null);
      setDraft("");
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not save the reply.",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-title-sm font-bold text-gray-800 dark:text-white/90">
          Contact messages
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Sent from the public contact page by people without an account.{" "}
          {open > 0
            ? `${counted(open, "message")} still waiting for a reply.`
            : "Everything here has been answered."}
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search name, email, phone or text"
          className="h-10 min-w-64 flex-1 rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
        />
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          <input
            type="checkbox"
            checked={showHandled}
            onChange={(event) => setShowHandled(event.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-brand-500 dark:text-brand-400 focus:ring-brand-500/25"
          />
          Show replied
        </label>
      </div>

      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-error-500 bg-error-50 px-4 py-2.5 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400"
        >
          {error}
        </p>
      ) : null}

      {loading ? (
        <SkeletonRows rows={6} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon="📮"
          title="Nothing here"
          body={
            messages.length === 0
              ? "Nobody has written in through the contact page yet."
              : "No message matches what you searched for."
          }
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-raised dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="overflow-x-auto">
            <table className="table-wide w-full min-w-[62rem]">
              <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:bg-white/[0.02] dark:text-gray-400">
                <tr>
                  <th className="px-4 py-3">Sent</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Message</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {visible.map((message) => (
                  <Fragment key={message.id}>
                    <tr className="hover:bg-gray-50 dark:hover:bg-white/[0.02]">
                      <td
                        className={`${CELL} whitespace-nowrap text-gray-500 dark:text-gray-400`}
                      >
                        {when(message.created_at)}
                      </td>
                      <td
                        className={`${CELL} font-medium text-gray-800 dark:text-white/90`}
                      >
                        {message.name}
                      </td>
                      <td className={CELL}>
                        <a
                          href={`mailto:${message.email}`}
                          className="text-brand-500 dark:text-brand-400 hover:text-brand-600"
                        >
                          {message.email}
                        </a>
                      </td>
                      <td className={CELL}>
                        {message.phone ? (
                          <a
                            href={`tel:${message.phone}`}
                            className="whitespace-nowrap text-brand-500 dark:text-brand-400 hover:text-brand-600"
                          >
                            {message.phone}
                          </a>
                        ) : (
                          <span className="text-gray-500 dark:text-gray-400">
                            Not given
                          </span>
                        )}
                      </td>
                      <td className={`${CELL} max-w-md`}>
                        {message.subject ? (
                          <p className="font-medium text-gray-800 dark:text-white/90">
                            {message.subject}
                          </p>
                        ) : null}
                        <p className="whitespace-pre-wrap text-gray-600 dark:text-gray-400">
                          {message.message}
                        </p>
                      </td>
                      <td className={CELL}>
                        {message.handled ? (
                          <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-success-50 px-2.5 py-1 text-xs font-medium text-success-700 dark:bg-success-500/15 dark:text-success-400">
                            <span aria-hidden="true">✓</span> Replied
                          </span>
                        ) : (
                          <span className="inline-flex whitespace-nowrap rounded-full bg-warning-50 px-2.5 py-1 text-xs font-medium text-warning-700 dark:bg-warning-500/15 dark:text-warning-400">
                            Waiting
                          </span>
                        )}
                        {message.handled_by_name ? (
                          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            by {message.handled_by_name}
                          </p>
                        ) : null}
                      </td>
                      <td className={`${CELL} text-right`}>
                        <div className="flex flex-col items-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setOpenId(
                                openId === message.id ? null : message.id,
                              );
                              setDraft(message.reply_body ?? "");
                            }}
                            className="whitespace-nowrap rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
                          >
                            {openId === message.id
                              ? "Close"
                              : message.reply_body
                                ? "View reply"
                                : "Write a reply"}
                          </button>
                          {/* GREEN when it is done, grey when it is not. The
                              colour is the status at a glance down the column;
                              the label says which way pressing it goes. */}
                          <button
                            type="button"
                            disabled={busyId === message.id}
                            onClick={() => void toggleHandled(message)}
                            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
                              message.handled
                                ? "bg-success-700 text-white hover:bg-success-800"
                                : "border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
                            }`}
                          >
                            {message.handled ? "Replied ✓" : "Mark replied"}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {openId === message.id ? (
                      <tr className="bg-gray-50 dark:bg-white/[0.02]">
                        <td colSpan={7} className="px-4 py-4">
                          <label
                            htmlFor={`reply-${message.id}`}
                            className="mb-2 block text-sm font-medium text-gray-800 dark:text-white/90"
                          >
                            Reply to {message.name}
                          </label>
                          <textarea
                            id={`reply-${message.id}`}
                            value={draft}
                            onChange={(event) => setDraft(event.target.value)}
                            rows={4}
                            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                          />
                          <div className="mt-3 flex flex-wrap items-center gap-3">
                            <button
                              type="button"
                              disabled={busyId === message.id || !draft.trim()}
                              onClick={() => void submitReply(message)}
                              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-50"
                            >
                              Save reply and mark replied
                            </button>
                            <a
                              href={`mailto:${message.email}?subject=${encodeURIComponent(
                                `Re: ${message.subject ?? "your message"}`,
                              )}&body=${encodeURIComponent(draft)}`}
                              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-white dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
                            >
                              Open in your mail app
                            </a>
                            {/* Says plainly what saving does. Nothing here
                                sends an email, and a button that looked like it
                                did would be worse than no button. */}
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              Saving keeps a record of your reply. It does not
                              send the email. Use your mail app for that.
                            </p>
                          </div>
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
    </div>
  );
}

export default function AdminContactPage() {
  return (
    <RequireAuth roles={["admin"]}>
      <ContactInbox />
    </RequireAuth>
  );
}
