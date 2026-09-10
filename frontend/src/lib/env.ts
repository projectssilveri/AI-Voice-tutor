/**
 * Public environment configuration.
 *
 * API URLs are never hardcoded at a call site. Reading them here means a
 * missing variable fails once, loudly, at module load — rather than as a
 * confusing `fetch("undefined/api/v1/...")` at runtime.
 *
 * Only NEXT_PUBLIC_* values belong in this file: everything here is inlined
 * into the client bundle. Secrets stay in the FastAPI backend.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy frontend/.env.local.example ` +
        `to frontend/.env.local and fill it in.`,
    );
  }
  return value.replace(/\/$/, "");
}

export const env = {
  /** Base URL of the FastAPI backend, e.g. http://localhost:8000 */
  apiBaseUrl: required(
    "NEXT_PUBLIC_API_BASE_URL",
    process.env.NEXT_PUBLIC_API_BASE_URL,
  ),
  /** WebSocket origin for Gemini Live voice sessions, e.g. ws://localhost:8000 */
  wsBaseUrl: required(
    "NEXT_PUBLIC_WS_BASE_URL",
    process.env.NEXT_PUBLIC_WS_BASE_URL,
  ),
} as const;

/** Path prefix for versioned REST routes on the backend. */
export const API_V1 = "/api/v1";
