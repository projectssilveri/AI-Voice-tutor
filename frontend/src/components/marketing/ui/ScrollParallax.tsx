"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/cn";

import type { ReactNode } from "react";

/**
 * Moves its children a little slower than the page as you scroll.
 *
 * Used on the hero product panel. The effect is depth: the panel reads as
 * sitting behind the plane of the text rather than pasted onto it, which is
 * what makes a flat dark hero feel like it has a foreground.
 *
 * Kept deliberately small. `strength` is a fraction of scroll distance, and
 * anything past about 0.1 stops reading as depth and starts reading as a
 * page that cannot keep up with the scroll wheel.
 *
 * TRANSFORM ONLY, AND NEVER OPACITY — the rule the rest of this codebase
 * arrived at three separate times. The panel is fully visible at every point,
 * and completely visible if this never runs at all: the effect adds only a
 * translation on top of where the element already is.
 *
 * Stops calculating when the element is off screen, so a long page is not
 * doing this work for a hero nobody can see.
 */
export default function ScrollParallax({
  children,
  className,
  strength = 0.06,
  maxOffset = 40,
}: {
  children: ReactNode;
  className?: string;
  strength?: number;
  /** Pixels. The furthest this will ever drift from where it was laid out. */
  maxOffset?: number;
}) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    let visible = true;

    const update = () => {
      frame = 0;
      if (!visible) return;
      // Capped. Uncapped, a long page drifts this element far enough to
      // overlap whatever follows it, and the parallax stops being depth and
      // becomes a layout bug that only appears once you scroll.
      const offset = Math.min(window.scrollY * strength, maxOffset);
      el.style.transform = `translate3d(0, ${offset.toFixed(1)}px, 0)`;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        visible = entries[0]?.isIntersecting ?? true;
        if (visible) onScroll();
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
      el.style.transform = "";
    };
  }, [strength, maxOffset]);

  return (
    <div ref={host} className={cn("will-change-transform", className)}>
      {children}
    </div>
  );
}
