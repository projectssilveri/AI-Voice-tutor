"use client";

import { useEffect } from "react";

/**
 * Start marketing pages at the top.
 *
 * The body is a BLOCK, deliberately. It was written as a concise arrow —
 * `useEffect(() => window.document.scrollingElement?.scrollTo(0, 0), [])` —
 * which implicitly returns whatever `scrollTo` evaluates to, and React reads
 * an effect's return value as its clean-up function. That produced the dev
 * warning "useEffect must not return anything besides a function". Nothing
 * broke, because the value happens to be undefined, but the effect was relying
 * on that: any browser or polyfill whose `scrollTo` returns something would
 * have had React try to call it on unmount.
 */
export default function ScrollUp() {
  useEffect(() => {
    window.document.scrollingElement?.scrollTo(0, 0);
  }, []);

  return null;
}
