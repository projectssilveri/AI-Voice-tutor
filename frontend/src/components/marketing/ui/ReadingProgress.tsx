"use client";

import { useEffect, useRef } from "react";

/**
 * A hairline bar across the top showing how far down a long page you are.
 *
 * For the reading pages: terms, privacy, about. On a page of solid prose the
 * scrollbar is the only cue about length, and on a dark page a browser
 * scrollbar is close to invisible.
 *
 * It writes a CSS variable and lets the compositor scale the bar, rather than
 * setting `width` on every scroll event. Scaling does not trigger layout;
 * width does, once per frame, for the whole page.
 *
 * `aria-hidden` and no `role="progressbar"`. It reports the scroll position,
 * which a screen reader already conveys, so announcing it again would be one
 * more thing to skip past on every page.
 */
export default function ReadingProgress() {
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const el = bar.current;
      if (!el) return;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      // A page shorter than the viewport has nothing to report. Showing a
      // full bar there would say "you have read it all" before you started.
      el.style.setProperty("--progress", max > 40 ? String(window.scrollY / max) : "0");
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5"
    >
      <div
        ref={bar}
        className="scroll-progress h-full bg-gradient-to-r from-[var(--mk-brand)] to-[var(--mk-brand-lit)]"
      />
    </div>
  );
}
