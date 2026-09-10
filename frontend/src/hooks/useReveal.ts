"use client";

import { type RefObject, useEffect, useRef, useState } from "react";

/**
 * Reveal an element the first time it scrolls into view.
 *
 * The Startup template shipped `wow fadeInUp` markup on ten elements across
 * four files. WOW.js is not a dependency and never was, so all ten were inert
 * — the marketing site had no entrance animation of any kind. This is that,
 * without the library.
 *
 * Once only: `unobserve` after the first trigger, so scrolling back up does
 * not replay the animation. Content re-animating every time it passes the
 * viewport is a distraction rather than an effect.
 *
 * Starts visible when `IntersectionObserver` is missing, so an unsupported
 * browser gets the content rather than a permanently invisible page — the
 * failure mode that makes scroll animation dangerous.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>(options?: {
  /** How far into the viewport before it fires. Default 12%. */
  threshold?: number;
  /** Fire early, while the element is still below the fold. */
  rootMargin?: string;
}): { ref: RefObject<T | null>; revealed: boolean; instant: boolean } {
  const ref = useRef<T>(null);
  const [revealed, setRevealed] = useState(false);
  // True when it was revealed without ever being observed — already on screen,
  // or motion is switched off. The caller uses this to skip the transition:
  // there is nothing to animate for something the reader is already looking
  // at, and a suspended transition in a hidden tab would leave it stuck
  // part-way.
  const [instant, setInstant] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    if (typeof IntersectionObserver === "undefined") {
      setRevealed(true);
      setInstant(true);
      return;
    }

    // Someone who has asked for less motion should simply have the content,
    // not a zero-length animation of it arriving.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setRevealed(true);
      setInstant(true);
      return;
    }

    // Already on screen at mount? Reveal it now and never observe.
    //
    // This is not an optimisation. IntersectionObserver delivers nothing while
    // `document.visibilityState === "hidden"`, and this app deliberately opens
    // pages in background tabs (voice sessions, exams, certificate PDFs all use
    // target="_blank"). Without this, content that is plainly in the viewport
    // sits at opacity 0 until the tab is focused — and any future path where
    // the observer never fires leaves the page permanently blank. Content that
    // can become invisible is a worse outcome than content that arrives
    // without an animation.
    const box = element.getBoundingClientRect();
    if (box.top < window.innerHeight && box.bottom > 0) {
      setRevealed(true);
      setInstant(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setRevealed(true);
        observer.unobserve(entry.target);
      },
      {
        threshold: options?.threshold ?? 0.12,
        rootMargin: options?.rootMargin ?? "0px 0px -40px 0px",
      },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [options?.threshold, options?.rootMargin]);

  return { ref, revealed, instant };
}
