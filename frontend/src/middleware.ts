import { NextResponse, type NextRequest } from "next/server";

import { contentSecurityPolicy } from "@/lib/csp";

/**
 * Gives every page request a fresh nonce and its Content-Security-Policy.
 *
 * The policy goes on the REQUEST as well as the response: Next reads the nonce
 * from the request's policy while rendering and stamps it on its own inline
 * scripts. `x-nonce` carries the bare value to the root layout's theme script.
 * Both are set here, never taken from the browser, so a client cannot choose
 * its own nonce.
 */
export function middleware(request: NextRequest) {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const nonce = btoa(String.fromCharCode(...bytes));
  const policy = contentSecurityPolicy(nonce);

  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", policy);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("content-security-policy", policy);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only. Built files, images and fonts carry no script, and a
      // prefetch fetches data, not a page.
      source:
        "/((?!_next/|favicon|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|webmanifest|woff2?)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
