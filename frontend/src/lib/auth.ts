/**
 * Auth calls against the FastAPI backend.
 *
 * The session is an httpOnly cookie set by the backend, so nothing here stores
 * a token — every request just needs `credentials: "include"`. That also means
 * a token cannot be read by injected script, unlike localStorage.
 */

import { API_V1, env } from "@/lib/env";

/**
 * `super_admin` sits above `admin`: it passes every admin gate and adds
 * revenue and role management. The backend widens `require_role` accordingly,
 * so anywhere the UI checks for admin it should accept both.
 */
// "teacher" is gone — retired in migration 0025. It was the last piece of
// the first schema and still carried the paywall bypass.
export type UserRole = "student" | "admin" | "super_admin";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  /** Optional, and null until someone fills it in. */
  phone: string | null;
  /**
   * The organization this person belongs to, or null for a public B2C user.
   *
   * Read-only, and the cue for the walled garden: an organization member is
   * shown no prices, no Buy buttons and no marketplace nav. Presentation only
   * — `services/access.py` is what actually separates the two catalogues, and
   * it does so regardless of what the browser draws.
   */
  organization_id: string | null;
  role: UserRole;
  is_active: boolean;
  /**
   * Whether this account has a profile photo. Sent by `/users/session` only,
   * so it is absent on anything read from `/users/me`. When false, avatars do
   * not ask for a picture that is not there.
   */
  has_photo?: boolean;
  is_superuser: boolean;
  is_verified: boolean;
}

export class AuthError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

function url(path: string): string {
  return `${env.apiBaseUrl}${API_V1}${path}`;
}

/**
 * fastapi-users identifies failures with an enum whose `str()` serialises as
 * "ErrorCode.LOGIN_BAD_CREDENTIALS". Showing that to someone who mistyped a
 * password is not an error message, so known codes are mapped to real English
 * here. Matched by substring because the code arrives sometimes as a bare
 * string and sometimes nested under `detail.code`.
 */
const ERROR_MESSAGES: ReadonlyArray<[string, string]> = [
  // NOT "no account with that email", however much more helpful that sounds.
  // The server already answers identically whether the account exists or the
  // password is wrong, and it has to: a message that distinguishes them turns
  // the login form into a tool for confirming which email addresses are
  // registered here, one guess at a time. OWASP names that account
  // enumeration and asks for one message covering every failure.
  //
  // The genuine new arrival is helped by the SIGN-UP LINK the form renders
  // beside this, which points somewhere useful without confirming anything.
  ["LOGIN_BAD_CREDENTIALS", "Incorrect email or password"],
  ["LOGIN_USER_NOT_VERIFIED", "Please verify your email before signing in"],
  ["REGISTER_USER_ALREADY_EXISTS", "An account with that email already exists"],
  ["REGISTER_INVALID_PASSWORD", "That password is not strong enough"],
  ["UPDATE_USER_EMAIL_ALREADY_EXISTS", "That email is already in use"],
];

function humanise(raw: string): string | null {
  for (const [code, message] of ERROR_MESSAGES) {
    if (raw.includes(code)) return message;
  }
  return null;
}

/** Pull a human-usable message out of FastAPI's several error shapes. */
async function readError(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body = await response.json();
    const detail = body?.detail;

    if (typeof detail === "string") {
      return humanise(detail) ?? detail;
    }

    if (detail?.code) {
      const mapped = humanise(String(detail.code));
      if (mapped) return mapped;
    }

    // Password-policy failures come back as {code, reason}.
    if (detail?.reason) {
      if (typeof detail.reason === "string") return detail.reason;
      if (Array.isArray(detail.reason)) {
        return detail.reason
          .map((r: { reason?: string }) => r.reason)
          .filter(Boolean)
          .join(" ");
      }
    }

    // 422 validation errors arrive as an array.
    if (Array.isArray(detail) && detail[0]?.msg) return detail[0].msg;
    if (Array.isArray(body?.errors) && body.errors[0]?.msg) {
      return body.errors[0].msg;
    }
  } catch {
    // Non-JSON body — fall through.
  }
  return fallback;
}

/** Current user, or null when signed out. Never throws on 401. */
export async function fetchSession(): Promise<AuthUser | null> {
  try {
    const response = await fetch(url("/users/session"), {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) return null;
    return (await response.json()) as AuthUser | null;
  } catch {
    // Backend down — treated as signed out rather than a crash.
    return null;
  }
}

/**
 * fetch() rejects with a bare "Failed to fetch" when the server is
 * unreachable, which tells a user nothing. Translate it into something they
 * can act on.
 *
 * TWO AUDIENCES, TWO MESSAGES. This used to throw
 * "Could not reach the server at http://localhost:8000. Is the backend
 * running?" straight onto the sign-in form. That is a developer's diagnostic:
 * it names infrastructure, asks the reader a question only we can answer, and
 * on a customer's screen reads as "this site is broken".
 *
 * The address is not a secret — the browser makes the request, so it is in the
 * network tab regardless — but it does not belong in front of a visitor. It
 * goes to the console instead, where the person who can restart the service is
 * already looking.
 */
async function post(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (cause) {
    console.error(
      `[auth] ${input} is unreachable (API base: ${env.apiBaseUrl})`,
      cause,
    );
    throw new AuthError(
      0,
      "We could not reach Voice Tutor just now. Check your connection and try again in a moment.",
    );
  }
}

export async function login(email: string, password: string): Promise<void> {
  // fastapi-users' login expects OAuth2 form encoding, not JSON, and the email
  // goes in the field named `username`.
  const body = new URLSearchParams({ username: email, password });

  const response = await post(url("/auth/login"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    throw new AuthError(
      response.status,
      await readError(response, "We could not sign you in. Check the email and password, then try again."),
    );
  }
}

export async function register(
  name: string,
  email: string,
  password: string,
): Promise<void> {
  const response = await post(url("/auth/register"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password }),
  });

  if (!response.ok) {
    throw new AuthError(
      response.status,
      await readError(response, "Could not create the account."),
    );
  }
}

/**
 * Update the signed-in user's own account.
 *
 * `PATCH /users/me` is fastapi-users'. It ignores `role` and `is_superuser` on
 * this route, so a student cannot promote themselves by adding a field here.
 */
export async function updateMe(changes: {
  name?: string;
  /** null clears it; the backend treats a blank string as null too. */
  phone?: string | null;
  password?: string;
  /** Required by the server whenever `password` is sent. */
  current_password?: string;
}): Promise<AuthUser> {
  const response = await post(url("/users/me"), {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  });

  if (!response.ok) {
    throw new AuthError(
      response.status,
      await readError(response, "Could not save your changes."),
    );
  }
  return (await response.json()) as AuthUser;
}

export async function logout(): Promise<void> {
  await fetch(url("/auth/logout"), {
    method: "POST",
    credentials: "include",
  });
}
