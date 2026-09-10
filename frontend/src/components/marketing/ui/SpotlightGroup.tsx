"use client";

import { useCallback, useEffect, useRef } from "react";

import { cn } from "@/lib/cn";

import type { ReactNode } from "react";

/**
 * Lights the panel under the cursor as it moves across a grid.
 *
 * The effect every good dark product page has, and the reason it works is not
 * the glow itself: on a near-black page a grid of hairline cards is hard to
 * scan, and a highlight that tracks the pointer tells you which one you are
 * about to click before you get there.
 *
 * ONE LISTENER, NOT ONE PER CARD. The handler lives on the group and writes
 * `--spot-x` / `--spot-y` onto every child panel in a single pass, so a grid
 * of nine cards costs one `pointermove` subscription rather than nine. The
 * pass is throttled to an animation frame, because `pointermove` fires far
 * faster than the screen refreshes.
 *
 * RECTS ARE HELD IN PAGE COORDINATES, WHICH IS WHY THERE IS NO SCROLL
 * LISTENER. The first version cached viewport-relative rects and therefore
 * had to re-measure whenever the page scrolled — and it did that synchronously
 * on every scroll event. Measured on the home page: three groups, eighteen
 * cards, and 18 forced `getBoundingClientRect` calls PER SCROLL EVENT, at a
 * scroll event rate well above the refresh rate. That is a layout thrash on
 * the one page the effect exists to make feel smooth.
 *
 * Adding `scrollX/scrollY` at measure time and again to the pointer position
 * makes the two frames agree no matter where the page is scrolled to, so
 * scrolling cannot invalidate the cache and the listener is unnecessary.
 * Only a resize changes a page-space rect.
 *
 * The whole thing is decoration:
 *   - it renders nothing of its own, so a JavaScript failure leaves the grid
 *     exactly as it was
 *   - the CSS hides it where there is no fine pointer
 *   - the transition it drives is covered by the global reduced-motion rule
 */
export default function SpotlightGroup({
  children,
  className,
  as: Component = "div",
}: {
  children: ReactNode;
  className?: string;
  /**
   * The element to render. `ol` for the how-it-works steps, because those are
   * a numbered sequence and a div would throw that away to add a light.
   */
  as?: "div" | "ol" | "ul";
}) {
  const host = useRef<HTMLElement>(null);
  const frame = useRef(0);
  /** Page-space boxes: viewport rect plus the scroll offset at measure time. */
  const targets = useRef<
    { el: HTMLElement; left: number; top: number }[]
  >([]);

  const measure = useCallback(() => {
    const root = host.current;
    if (!root) return;
    const offsetX = window.scrollX;
    const offsetY = window.scrollY;
    targets.current = [
      ...root.querySelectorAll<HTMLElement>("[data-spotlight]"),
    ].map((el) => {
      const rect = el.getBoundingClientRect();
      return { el, left: rect.left + offsetX, top: rect.top + offsetY };
    });
  }, []);

  useEffect(() => {
    // Skipped entirely where there is no fine pointer, so a phone never pays
    // for the listener or the measuring.
    if (!window.matchMedia("(pointer: fine)").matches) return;

    measure();
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      cancelAnimationFrame(frame.current);
    };
  }, [measure]);

  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (frame.current) return;
    // Into the same page space the rects are stored in.
    const pointerX = event.clientX + window.scrollX;
    const pointerY = event.clientY + window.scrollY;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      for (const { el, left, top } of targets.current) {
        el.style.setProperty("--spot-x", `${pointerX - left}px`);
        el.style.setProperty("--spot-y", `${pointerY - top}px`);
      }
    });
  };

  return (
    <Component
      ref={host as React.Ref<never>}
      onPointerMove={onPointerMove}
      // Re-measured on entry rather than continuously: this is the moment the
      // rects start mattering, and it also covers a grid whose contents
      // changed since mount, such as the course list after a filter.
      onPointerEnter={measure}
      className={cn("group/spot", className)}
    >
      {children}
    </Component>
  );
}
