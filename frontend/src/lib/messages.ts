/**
 * Private messages, and the public contact inbox.
 *
 * Two different things behind one module because the console shows them side
 * by side: a contact message comes from a stranger with no account and can only
 * be answered by email, a direct message is between two accounts we know and
 * threads properly.
 */

import { apiFetch } from "@/lib/api";

const authed = { withCredentials: true, cache: "no-store" } as const;

// ---------------------------------------------------------------------------
// Private messages
// ---------------------------------------------------------------------------

export interface DirectMessage {
  id: string;
  subject: string;
  body: string;
  created_at: string;
  read_at: string | null;
  in_reply_to_id: string | null;

  sender_id: string;
  sender_name: string;
  sender_email: string;
  sender_role: string;
  sender_phone: string | null;

  recipient_id: string;
  recipient_name: string;
  recipient_email: string;
  recipient_role: string;
  recipient_phone: string | null;
}

export interface Correspondent {
  id: string;
  name: string;
  email: string;
  role: string;
  phone: string | null;
}

export function listInbox(): Promise<DirectMessage[]> {
  return apiFetch<DirectMessage[]>("/messages/inbox", authed);
}

export function listSent(): Promise<DirectMessage[]> {
  return apiFetch<DirectMessage[]>("/messages/sent", authed);
}

export function unreadCount(): Promise<{ unread: number }> {
  return apiFetch<{ unread: number }>("/messages/unread", authed);
}

export function markRead(id: string): Promise<void> {
  return apiFetch<void>(`/messages/${id}/read`, { ...authed, method: "POST" });
}

export function listRecipients(query?: string): Promise<Correspondent[]> {
  const qs = query ? `?q=${encodeURIComponent(query)}` : "";
  return apiFetch<Correspondent[]>(`/messages/recipients${qs}`, authed);
}

export function sendMessage(payload: {
  /** Omitted by a learner: the server resolves who support is for them. */
  recipient_id?: string;
  subject: string;
  body: string;
  in_reply_to_id?: string;
}): Promise<DirectMessage> {
  return apiFetch<DirectMessage>("/messages", {
    ...authed,
    method: "POST",
    body: payload,
  });
}

export function listAllMessages(query?: string): Promise<DirectMessage[]> {
  const qs = query ? `?q=${encodeURIComponent(query)}` : "";
  return apiFetch<DirectMessage[]>(`/admin/messages${qs}`, authed);
}

// ---------------------------------------------------------------------------
// The public contact inbox
// ---------------------------------------------------------------------------

export interface ContactMessage {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  subject: string | null;
  message: string;
  handled: boolean;
  handled_by_name: string | null;
  handled_at: string | null;
  reply_body: string | null;
  created_at: string;
}

export function listContactMessages(): Promise<ContactMessage[]> {
  return apiFetch<ContactMessage[]>("/admin/contact-messages", authed);
}

export function setContactHandled(
  id: string,
  handled: boolean,
): Promise<ContactMessage> {
  return apiFetch<ContactMessage>(`/admin/contact-messages/${id}`, {
    ...authed,
    method: "PATCH",
    body: { handled },
  });
}

export function replyToContactMessage(
  id: string,
  body: string,
): Promise<ContactMessage> {
  return apiFetch<ContactMessage>(`/admin/contact-messages/${id}/reply`, {
    ...authed,
    method: "POST",
    body: { body },
  });
}
