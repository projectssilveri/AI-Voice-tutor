"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Counts a figure up when it scrolls into view.
 *
 * THE VALUE IS NEVER A LIE, which is the whole design of this component. The
 * server renders the real number, and that is also this component's initial
 * state — so a reader with JavaScript off, a failed hydration, or a tab that
 * never becomes visible sees the true figure, not a zero.
 *
 * That matters more here than anywhere else on the page: this strip is the
 * proof block. "0 courses" would be worse than no animation at all, and it is
 * exactly what a naive count-up produces in a background tab, where
 * requestAnimationFrame is suspended and the animation sits on its first
 * frame indefinitely. Decisions 116, 123 and 206 in this codebase are each a
 * version of the same bug.
 *
 * So the count only ever starts when the tab is actually visible, and if the
 * tab is hidden mid-count the value snaps to the truth rather than freezing
 * part-way there.
 *
 * `prefix` and `suffix` carry the non-numeric parts ("up to ", " min"), so the
 * animation only touches the digits.
 */
export default function CountUp({
  value,
  prefix = "",
  suffix = "",
  duration = 900,
}: {
  value: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
}) {
  const [shown, setShown] = useState(value);
  const host = useRef<HTMLSpanElement>(null);
  const done = useRef(false);

  useEffect(() => {
    const el = host.current;
    if (!el || done.current) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches) return;

    let frame = 0;
    const settle = () => {
      cancelAnimationFrame(frame);
      setShown(value);
      done.current = true;
    };

    const run = () => {
      done.current = true;
      const start = performance.now();
      const step = (now: number) => {
        // The tab went away mid-count. Show the real number rather than
        // whatever fraction of it we had reached.
        if (document.visibilityState !== "visible") return settle();
        const t = Math.min(1, (now - start) / duration);
        // Ease out, so it decelerates into the final figure instead of
        // stopping dead on it.
        setShown(Math.round(value * (1 - (1 - t) ** 3)));
        if (t < 1) frame = requestAnimationFrame(step);
      };
      setShown(0);
      frame = requestAnimationFrame(step);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || done.current) return;
        observer.disconnect();
        if (document.visibilityState === "visible") run();
      },
      { threshold: 0.4 },
    );
    observer.observe(el);

    document.addEventListener("visibilitychange", settle, { once: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", settle);
    };
  }, [value, duration]);

  return (
    <span ref={host}>
      {prefix}
      {shown.toLocaleString("en-IN")}
      {suffix}
    </span>
  );
}
