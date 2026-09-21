/**
 * Typed fetch wrapper for the FastAPI backend.
 *
 * The backend returns one error shape for every failure (see
 * backend/app/schemas ErrorResponse), so this unpacks it into a real Error
 * with the status attached instead of leaving callers to inspect `res.ok`.
 */

import { API_V1, env } from "@/lib/env";

export interface ApiErrorBody {
  /**
   * A string on our own routes. fastapi-users sends an OBJECT here for a
   * refused password — `{ code, reason }` — and the reason is the sentence
   * meant for the person typing.
   */
  detail: string | { code?: string; reason?: string } | undefined;
  code?: string | null;
}

/**
 * Details that are FastAPI's defaults rather than something we wrote.
 *
 * Around ninety call sites do `caught instanceof Error ? caught.message : …`,
 * which is right when the backend authored a sentence for the reader and
 * wrong when it did not. A student whose dashboard fails to load was shown a
 * red banner reading "Not found" — technically the 404's detail, and useless:
 * it names nothing, suggests nothing, and reads as though their account is
 * missing.
 *
 * Caught here rather than at the call sites. Ninety `if` statements is ninety
 * chances to forget one, and the routes keep their own good messages either
 * way: anything not in this list still passes straight through.
 */
const FRAMEWORK_DETAILS = new Set([
  "not found",
  "internal server error",
  "unprocessable entity",
  "bad request",
  "method not allowed",
  "service unavailable",
  "bad gateway",
  "gateway timeout",
  "forbidden",
]);

/**
 * What to say when the backend did not say anything useful.
 *
 * The previous fallback was `response.statusText`, so a failure showed the
 * reader "Not Found" or "Internal Server Error" — the same words as the
 * detail it was replacing, with different capitals. Each of these names
 * something the reader can do instead.
 *
 * None of them name a host, a port, an endpoint or a stack. The detail for
 * whoever has to fix it goes to the console at the throw site.
 */
function sentenceFor(status: number): string {
  if (status === 401)
    return "Your session has ended. Sign in again to carry on.";
  if (status === 403) return "You do not have access to that.";
  if (status === 404) return "We could not find that.";
  if (status === 409) return "That clashes with something already there.";
  if (status === 413) return "That file is too large.";
  if (status === 429) return "Too many tries just now. Wait a moment.";
  if (status >= 500) return "Something went wrong at our end. Try again in a moment.";
  if (status >= 400) return "That did not go through. Check the details and try again.";
  return "Something went wrong.";
}

/**
 * The sentence to show, out of whatever shape the error arrived in.
 *
 * Without this, `detail` being an object stringified to "[object Object]" —
 * which is what the sign-up form displayed the moment the backend started
 * refusing weak passwords, in place of "Use at least 8 characters".
 */
function messageFrom(detail: ApiErrorBody["detail"], fallback: string): string {
  if (typeof detail === "string" && detail) {
    // A framework default tells the reader nothing, so the caller's own
    // fallback ("Could not load your dashboard.") wins over it.
    return FRAMEWORK_DETAILS.has(detail.trim().toLowerCase())
      ? fallback
      : detail;
  }
  if (detail && typeof detail === "object") {
    if (typeof detail.reason === "string" && detail.reason)
      return detail.reason;
    if (typeof detail.code === "string" && detail.code) {
      // A bare code is not a sentence, but it is better than the status text.
      return detail.code.replace(/_/g, " ").toLowerCase();
    }
  }
  return fallback;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  /**
   * True when `message` is one of the status sentences above rather than
   * something the backend wrote for this particular failure.
   *
   * It lets a caller prefer its own wording. "We could not find that." is
   * honest but says nothing about what failed; "Could not load your
   * dashboard." tells the reader which part of the screen is empty and why.
   * `errorText` below is what acts on this.
   */
  readonly generic: boolean;

  constructor(
    status: number,
    detail: string,
    code: string | null = null,
    generic = false,
  ) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.generic = generic;
  }
}

/**
 * The sentence to put in front of the reader, given what was thrown.
 *
 * Every screen in the app already had a fallback written for it, in the shape
 * `caught instanceof Error ? caught.message : "Could not load the exam."` —
 * and the fallback was dead code, because `caught.message` is always set.
 * That is how a student came to see a red banner reading "Not found" when
 * their dashboard failed to load.
 *
 * This flips the order for the cases where the backend had nothing specific
 * to say: the screen's own sentence wins, and the API's wording is used only
 * when it was actually written for the situation.
 */
export function errorText(caught: unknown, fallback: string): string {
  if (caught instanceof ApiError) {
    return caught.generic ? fallback : caught.message;
  }
  return caught instanceof Error && caught.message ? caught.message : fallback;
}

export interface ApiRequestOptions extends Omit<RequestInit, "body"> {
  /** JSON-serialisable request body. */
  body?: unknown;
  /** Set false for unversioned routes such as /health. */
  versioned?: boolean;
  /** Next.js server-side caching. Ignored in the browser. */
  next?: { revalidate?: number | false; tags?: string[] };
  /** Send the session cookie. Required for anything behind auth. */
  withCredentials?: boolean;
}

export async function apiFetch<T>(
  path: string,
  {
    body,
    versioned = true,
    withCredentials = false,
    headers,
    ...init
  }: ApiRequestOptions = {},
): Promise<T> {
  const prefix = versioned ? API_V1 : "";
  const url = `${env.apiBaseUrl}${prefix}${path.startsWith("/") ? path : `/${path}`}`;

  // A REACHABILITY FAILURE IS NOT A RESPONSE. `fetch` rejects outright when
  // the server is unreachable — no status, no body — and the rejection reads
  // "Failed to fetch" or "NetworkError when attempting to fetch resource",
  // which is browser wording that means nothing to the reader and differs per
  // browser. Everything below assumes a `response`, so it has to be caught
  // here or the raw string reaches the screen. `lib/auth.ts` does the same for
  // the sign-in routes, which do not go through this wrapper.
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      ...(withCredentials ? { credentials: "include" as const } : {}),
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (cause) {
    console.error(`[api] ${url} is unreachable`, cause);
    // Not generic: "we could not reach the server" is the most specific
    // thing anyone can say about an unreachable server, and a screen's own
    // "could not load X" would be less true than that.
    throw new ApiError(
      0,
      "We could not reach Voice Tutor just now. Check your connection and try again in a moment.",
    );
  }

  if (!response.ok) {
    const statusSentence = sentenceFor(response.status);
    let detail = statusSentence;
    let code: string | null = null;
    try {
      const parsed = (await response.json()) as ApiErrorBody;
      detail = messageFrom(parsed.detail, detail);
      code =
        parsed.code ??
        (parsed.detail && typeof parsed.detail === "object"
          ? (parsed.detail.code ?? null)
          : null);
    } catch {
      // Non-JSON error: a proxy timeout, or a gateway's own HTML page. The
      // status sentence already covers it, and the body is not worth showing.
    }
    // The reader gets `detail`; whoever has to fix it gets the rest, here,
    // where the URL and status are still in scope.
    //
    // EXCEPT THE TWO THAT ARE ANSWERS RATHER THAN FAULTS.
    //
    // 401 means "not signed in", which is the ordinary state of every visitor
    // who has not signed in yet — and several callers ask a question before
    // they know the answer to that. `UserDropdown` reads the unread count on
    // mount and catches the failure on purpose, with a comment saying it is
    // "not worth an error on a menu"; this line then wrote one to the console
    // anyway, in red, on the home page, for everybody signed out.
    //
    // 402 means "you have not bought this". It is a PRICE TAG, never a defect:
    // decision 60 chose it over 403 precisely so `PaywallNotice` could turn it
    // into a Buy button rather than a red sentence. The certificates page asks
    // every enrolled course for its exams and catches the refusals, with its
    // own comment saying an entitlement that lapsed answers 402 here — and got
    // a console error per locked course for its trouble. Reported from a real
    // session, on an account that had just stopped being staff.
    //
    // 403 STILL LOGS, and should. That one means signed in and refused, which
    // is a rule disagreeing with the screen that offered the action — how the
    // certification exam's two-gates bug was spotted.
    const EXPECTED = new Set([401, 402]);
    if (!EXPECTED.has(response.status)) {
      console.error(`[api] ${response.status} ${url}`, { code });
    }
    throw new ApiError(
      response.status,
      detail,
      code,
      // Unchanged from the status sentence means the backend wrote nothing
      // for this case, so a caller with better context should override it.
      detail === statusSentence,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

/** Shape of GET /health on the backend. */
export interface HealthResponse {
  status: "ok" | "degraded";
  environment: string;
  database: {
    configured: boolean;
    reachable: boolean;
    pgvector_version: string | null;
    error: string | null;
  };
}
