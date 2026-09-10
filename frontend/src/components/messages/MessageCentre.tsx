"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import EmptyState from "@/components/ui/EmptyState";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { ApiError } from "@/lib/api";
import {
  type Correspondent,
  type DirectMessage,
  listInbox,
  listRecipients,
  listSent,
  markRead,
  sendMessage,
} from "@/lib/messages";

/**
 * Received, sent, and a box to write in.
 *
 * One component behind two screens — the learner's Help and support panel and
 * the staff inbox — because they are the same three things. The only real
 * difference is who you may address, and the API answers that: a learner gets
 * an empty recipient list and writes to support, staff get a picker.
 *
 * Deliberately not two separate implementations that drift.
 */

const FIELD =
  "w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

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

function Party({
  label,
  name,
  email,
  phone,
}: {
  label: string;
  name: string;
  email: string;
  phone: string | null;
}) {
  return (
    <div className="text-xs text-gray-500 dark:text-gray-400">
      <span className="uppercase tracking-wide">{label}</span>{" "}
      <span className="font-medium text-gray-800 dark:text-white/90">
        {name}
      </span>
      <span className="block">{email}</span>
      {/* The phone number is shown wherever a person is named. It is on the
          account already; making someone open a second screen to find it is
          the reason nobody uses it. */}
      {phone ? (
        <a
          href={`tel:${phone}`}
          className="block text-brand-500 dark:text-brand-400 hover:text-brand-600"
        >
          {phone}
        </a>
      ) : null}
    </div>
  );
}

function MessageCard({
  message,
  side,
  onReply,
}: {
  message: DirectMessage;
  side: "received" | "sent";
  onReply: (message: DirectMessage) => void;
}) {
  const unread = side === "received" && message.read_at === null;
  return (
    <article
      className={`rounded-2xl border p-4 shadow-raised transition ${
        unread
          ? "border-brand-300 bg-brand-50/40 dark:border-brand-500/40 dark:bg-brand-500/5"
          : "border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]"
      }`}
    >
      <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-gray-800 dark:text-white/90">
            {message.subject}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {when(message.created_at)}
          </p>
        </div>
        {unread ? (
          <span className="rounded-full bg-brand-500 px-2.5 py-1 text-xs font-medium text-white">
            New
          </span>
        ) : null}
      </div>

      <p className="mb-3 whitespace-pre-wrap text-sm text-gray-600 dark:text-gray-400">
        {message.body}
      </p>

      <div className="flex flex-wrap items-end justify-between gap-4">
        {side === "received" ? (
          <Party
            label="From"
            name={message.sender_name}
            email={message.sender_email}
            phone={message.sender_phone}
          />
        ) : (
          <Party
            label="To"
            name={message.recipient_name}
            email={message.recipient_email}
            phone={message.recipient_phone}
          />
        )}
        {side === "received" ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onReply(message);
            }}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
          >
            Reply
          </button>
        ) : null}
      </div>
    </article>
  );
}

export default function MessageCentre({
  title = "Messages",
  intro,
}: {
  title?: string;
  intro?: string;
}) {
  const [tab, setTab] = useState<"received" | "sent" | "write">("received");
  const [inbox, setInbox] = useState<DirectMessage[]>([]);
  const [sent, setSent] = useState<DirectMessage[]>([]);
  const [people, setPeople] = useState<Correspondent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const [recipientId, setRecipientId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<DirectMessage | null>(null);

  const load = useCallback(async () => {
    try {
      const [received, outgoing, correspondents] = await Promise.all([
        listInbox(),
        listSent(),
        listRecipients(),
      ]);
      setInbox(received);
      setSent(outgoing);
      setPeople(correspondents);
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

  // An empty picker is the API saying "you write to support", not an error and
  // not an empty dropdown to puzzle over.
  const canChooseRecipient = people.length > 0;
  const unread = useMemo(
    () => inbox.filter((message) => message.read_at === null).length,
    [inbox],
  );

  // READ MEANS READ. Every card shows the whole message body, so being on the
  // Received tab IS reading it — there is nothing further to open. Marking on
  // a click would leave a message the person has demonstrably read still
  // showing as new, which makes the badge meaningless.
  //
  // Failures are swallowed on purpose: this is a convenience, and an error
  // banner over somebody's mail because a bookkeeping call failed would be
  // worse than a stale badge.
  useEffect(() => {
    if (tab !== "received") return;
    const unreadIds = inbox
      .filter((message) => message.read_at === null)
      .map((message) => message.id);
    if (unreadIds.length === 0) return;

    let cancelled = false;
    void Promise.allSettled(unreadIds.map((id) => markRead(id))).then(() => {
      if (cancelled) return;
      const stamp = new Date().toISOString();
      setInbox((current) =>
        current.map((row) =>
          unreadIds.includes(row.id) ? { ...row, read_at: stamp } : row,
        ),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [tab, inbox]);

  function startReply(message: DirectMessage) {
    setReplyTo(message);
    setRecipientId(canChooseRecipient ? message.sender_id : "");
    setSubject(
      message.subject.toLowerCase().startsWith("re:")
        ? message.subject
        : `Re: ${message.subject}`,
    );
    setBody("");
    setTab("write");
  }

  async function submit() {
    if (!subject.trim() || !body.trim()) return;
    setSending(true);
    try {
      await sendMessage({
        recipient_id: canChooseRecipient ? recipientId || undefined : undefined,
        subject: subject.trim(),
        body: body.trim(),
        in_reply_to_id: replyTo?.id,
      });
      setSubject("");
      setBody("");
      setReplyTo(null);
      setNotice("Sent.");
      setError(null);
      await load();
      setTab("sent");
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not send it.",
      );
    } finally {
      setSending(false);
    }
  }

  const tabs = [
    {
      id: "received" as const,
      label: `Received${unread ? ` (${unread})` : ""}`,
    },
    { id: "sent" as const, label: "Sent" },
    { id: "write" as const, label: "Write" },
  ];

  return (
    <section>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">
          {title}
        </h2>
        {intro ? (
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {intro}
          </p>
        ) : null}
      </div>

      <div className="mb-4 flex gap-1 border-b border-gray-200 dark:border-gray-800">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === item.id
                ? "text-brand-600 dark:text-brand-400"
                : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
            }`}
          >
            {item.label}
            {tab === item.id ? (
              <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-brand-500" />
            ) : null}
          </button>
        ))}
      </div>

      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-error-500 bg-error-50 px-4 py-2.5 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mb-4 rounded-lg border border-success-500 bg-success-50 px-4 py-2.5 text-sm text-success-700 dark:bg-success-500/10 dark:text-success-400">
          {notice}
        </p>
      ) : null}

      {loading ? (
        <SkeletonRows rows={3} />
      ) : tab === "write" ? (
        <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-raised dark:border-gray-800 dark:bg-white/[0.03]">
          {canChooseRecipient ? (
            <div>
              <label
                htmlFor="message-to"
                className="mb-1.5 block text-sm font-medium text-gray-800 dark:text-white/90"
              >
                To
              </label>
              <select
                id="message-to"
                value={recipientId}
                onChange={(event) => setRecipientId(event.target.value)}
                className={FIELD}
              >
                <option value="">Support</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name} · {person.email}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600 dark:bg-white/[0.02] dark:text-gray-400">
              This goes to the team who look after your account. They can change
              your sign-in address, sort out access and answer anything about
              your training.
            </p>
          )}

          <div>
            <label
              htmlFor="message-subject"
              className="mb-1.5 block text-sm font-medium text-gray-800 dark:text-white/90"
            >
              Subject
            </label>
            <input
              id="message-subject"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              maxLength={255}
              placeholder="What is this about?"
              className={FIELD}
            />
          </div>

          <div>
            <label
              htmlFor="message-body"
              className="mb-1.5 block text-sm font-medium text-gray-800 dark:text-white/90"
            >
              Message
            </label>
            <textarea
              id="message-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={6}
              maxLength={5000}
              className={FIELD}
            />
          </div>

          <button
            type="button"
            disabled={sending || !subject.trim() || !body.trim()}
            onClick={() => void submit()}
            className="rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      ) : tab === "received" ? (
        inbox.length === 0 ? (
          <EmptyState
            icon="📭"
            title="No messages yet"
            body="Anything sent to you shows up here."
          />
        ) : (
          <div className="space-y-3">
            {inbox.map((message) => (
              <MessageCard
                key={message.id}
                message={message}
                side="received"
                onReply={startReply}
              />
            ))}
          </div>
        )
      ) : sent.length === 0 ? (
        <EmptyState
          icon="✉️"
          title="You have not written yet"
          body="Use the Write tab to get in touch."
          action={
            <button
              type="button"
              onClick={() => setTab("write")}
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-600"
            >
              Write a message
            </button>
          }
        />
      ) : (
        <div className="space-y-3">
          {sent.map((message) => (
            <MessageCard
              key={message.id}
              message={message}
              side="sent"
              onReply={startReply}
            />
          ))}
        </div>
      )}
    </section>
  );
}
