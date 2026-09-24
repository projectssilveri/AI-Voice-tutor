/**
 * The website's Content-Security-Policy, built per request by src/middleware.ts.
 *
 * WHY A NONCE. Next puts inline scripts in every page (the data React needs to
 * take over the server's HTML), and the root layout adds one that sets dark
 * mode before the first paint. A policy that lets those run with
 * 'unsafe-inline' also lets run any script an attacker manages to inject, which
 * is the one thing a policy is for. So every response gets a fresh random
 * nonce: Next reads it from the request's policy and stamps it on its own
 * scripts, the layout stamps it on the theme script, and no other inline
 * script runs.
 *
 * 'strict-dynamic' lets a trusted script load others. That is how Razorpay
 * checkout arrives: `loadRazorpay` appends checkout.js on demand and
 * checkout.js loads the rest. The host next to it is only for browsers too old
 * to understand 'strict-dynamic'.
 *
 * THE COST. A nonce has to be new on every request, so no page can be built
 * ahead of time: the root layout reads the request headers, which makes every
 * route render on demand. The frontend runs as a Node server on Render, so that
 * costs server time per page view.
 *
 * Styles stay 'unsafe-inline'. The server's HTML carries style attributes and
 * the chart library injects <style> tags. Neither can carry a nonce, and a
 * nonce in style-src would switch 'unsafe-inline' off. An injected style can
 * restyle a page but cannot run code.
 */

import { env } from "@/lib/env";

/** Razorpay checkout: its script, the payment iframe, and what checkout.js
 * fetches and shows from our page. Not testable until the keys are set. */
const RAZORPAY_SCRIPT = "https://checkout.razorpay.com";
const RAZORPAY_FRAMES = "https://api.razorpay.com https://checkout.razorpay.com";
const RAZORPAY_ANY = "https://*.razorpay.com";

export function contentSecurityPolicy(nonce: string): string {
  const dev = process.env.NODE_ENV === "development";
  // The API is on another origin. fetch and the avatar <img> use the HTTP
  // origin; the voice tutor uses the WebSocket one.
  const api = new URL(env.apiBaseUrl).origin;
  const socket = new URL(env.wsBaseUrl).origin;

  return [
    "default-src 'self'",
    // 'unsafe-eval' in development only: React uses eval there to rebuild
    // server error stacks. Production never evaluates strings.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${RAZORPAY_SCRIPT}${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${api} ${RAZORPAY_ANY}`,
    "font-src 'self' data:",
    // In development the hot reload runs over a WebSocket of its own.
    `connect-src 'self' ${api} ${socket} ${RAZORPAY_ANY}${dev ? " ws://localhost:* ws://127.0.0.1:*" : ""}`,
    "media-src 'self' blob: data:",
    `frame-src ${RAZORPAY_FRAMES}`,
    "object-src 'none'",
    "base-uri 'self'",
    // Checkout can post a form to Razorpay instead of opening its popup.
    "form-action 'self' https://api.razorpay.com",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
    // Only when the API is on HTTPS. Locally it is http://localhost:8000, and
    // upgrading those calls would break every one of them.
    ...(api.startsWith("https:") ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}
