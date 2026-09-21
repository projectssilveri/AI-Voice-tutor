/**
 * A person's own profile: photo, what we email them, and leaving.
 *
 * Every call here acts on the signed-in user. None of them takes a user id,
 * because none of them is about anybody else.
 */

import { apiFetch } from "@/lib/api";
import { API_V1, env } from "@/lib/env";

const authed = { withCredentials: true, cache: "no-store" } as const;

// ---------------------------------------------------------------------------
// Photo
// ---------------------------------------------------------------------------

/**
 * Where a person's photo lives.
 *
 * Returns a URL even when they have none — the endpoint 404s and the `<img>`
 * falls back to its initial. Asking first would mean a request per avatar in
 * every table that shows one.
 */
export function photoUrl(userId: string, cacheBust?: string | number): string {
  const suffix = cacheBust ? `?v=${encodeURIComponent(String(cacheBust))}` : "";
  return `${env.apiBaseUrl}${API_V1}/users/${userId}/photo${suffix}`;
}

export async function uploadPhoto(file: File): Promise<void> {
  const body = new FormData();
  body.append("file", file);
  // Deliberately not `apiFetch`: that sets Content-Type: application/json and
  // serialises the body. A multipart upload needs the browser to set the
  // boundary itself, which it only does when the header is absent.
  const response = await fetch(`${env.apiBaseUrl}${API_V1}/profile/photo`, {
    method: "PUT",
    body,
    credentials: "include",
  });
  if (!response.ok) {
    let detail = "Could not upload that image.";
    try {
      detail =
        ((await response.json()) as { detail?: string }).detail ?? detail;
    } catch {
      // Non-JSON error. Keep the sentence above.
    }
    throw new Error(detail);
  }
}

/** True when there was a photo to take off, false when there was not. */
export function deletePhoto(): Promise<{ removed: boolean }> {
  return apiFetch<{ removed: boolean }>("/profile/photo", {
    ...authed,
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export interface NotificationPreferences {
  notify_learning: boolean;
  notify_offers: boolean;
}

export function getNotificationPreferences(): Promise<NotificationPreferences> {
  return apiFetch<NotificationPreferences>("/profile/notifications", authed);
}

export function setNotificationPreferences(
  preferences: NotificationPreferences,
): Promise<NotificationPreferences> {
  return apiFetch<NotificationPreferences>("/profile/notifications", {
    ...authed,
    method: "PUT",
    body: preferences,
  });
}

// ---------------------------------------------------------------------------
// Leaving
// ---------------------------------------------------------------------------

/** One voice on offer, as `services/gemini_live` describes it. */
export interface VoiceOption {
  name: string;
  label: string;
  /** "male" or "female" — how it reads, not a claim about what it is. */
  sounds: string;
  hint: string;
}

export interface VoiceChoice {
  /** Null means no preference: whatever the platform default happens to be. */
  voice: string | null;
  /** Sent by the server so the browser keeps no second copy of the list. */
  options: VoiceOption[];
}

export function getTutorVoice(): Promise<VoiceChoice> {
  return apiFetch<VoiceChoice>("/profile/voice", authed);
}

export function setTutorVoice(voice: string | null): Promise<VoiceChoice> {
  return apiFetch<VoiceChoice>("/profile/voice", {
    ...authed,
    method: "PUT",
    body: { voice },
  });
}

export interface CloseAccountResult {
  closed: boolean;
  explanation: string;
}

export function closeAccount(payload: {
  confirm_email: string;
  reason?: string;
}): Promise<CloseAccountResult> {
  return apiFetch<CloseAccountResult>("/profile/close", {
    ...authed,
    method: "POST",
    body: payload,
  });
}
