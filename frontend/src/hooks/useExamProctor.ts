"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Watches whether the student stays on the exam.
 *
 * WHAT IT COUNTS. Leaving fullscreen, switching tab or window, and the page
 * being hidden. All three mean the same thing from here: the exam is no longer
 * the thing on screen.
 *
 * WHAT IT DOES. The first two are warned. The third ends the exam, and because
 * an attempt is spent on submit (decision 4), ending it spends one.
 *
 * WHAT IT NEVER SAYS. The student is told they left; they are never told how
 * many times they may do it, how many they have left, or that an attempt is at
 * stake. Publishing the budget invites somebody to spend it — "one warning
 * left" is an instruction to leave once more. The warning has to be visible or
 * the eventual submit is inexplicable and unappealable; the arithmetic behind
 * it does not.
 *
 * WHAT IT IS NOT. This is client-side and therefore advisory: somebody who
 * disables JavaScript defeats it. It raises the effort of casually looking
 * something up mid-exam, which is the realistic case — it is not a defence
 * against a determined cheat, and nothing here should be described as one.
 *
 * Deliberately NOT counted: losing window focus on its own. A notification
 * toast, a password manager, or an on-screen keyboard all steal focus without
 * the exam leaving the screen, and voiding an attempt for that would generate
 * appeals nobody can adjudicate.
 */

/** Strikes before the exam ends. The third is the one that does it. */
const ALLOWED_LAPSES = 2;

/** Ignore a second event within this window: one action fires several. */
const DEBOUNCE_MS = 1200;

export interface ExamProctor {
  /** Shown when they come back. Null when there is nothing to say. */
  warning: string | null;
  dismissWarning: () => void;
  /** Total lapses, for the audit record. Never rendered. */
  lapses: number;
  /**
   * Stop counting, for a fullscreen exit WE asked for.
   *
   * Submitting and leaving both call `exitFullscreen`, which fires the same
   * event a student switching tabs does. Relying on `active` going false to
   * cover it is a race — the state update and the event are both async, and
   * losing it means a student is warned for pressing Submit, or on the last
   * allowed lapse is submitted twice.
   */
  pause: () => void;
  /** Count again. Called when a submit failed and the paper is still open. */
  resume: () => void;
}

export function useExamProctor({
  active,
  onLimitReached,
}: {
  /** True only while a paper is open. */
  active: boolean;
  /** Called once, when the last allowed lapse is used up. */
  onLimitReached: (lapses: number) => void;
}): ExamProctor {
  const [warning, setWarning] = useState<string | null>(null);
  const lapses = useRef(0);
  const lastAt = useRef(0);
  // Once fired, never again: the exam is already being submitted, and a second
  // call would submit twice.
  const finished = useRef(false);
  // Set around a fullscreen exit this page asked for. Distinct from `finished`,
  // which is one-way: this one is lifted again if the submit fails.
  const paused = useRef(false);

  // Held in a ref so the effect below does not need it as a dependency —
  // re-subscribing the listeners mid-exam would lose the count.
  const limitCallback = useRef(onLimitReached);
  limitCallback.current = onLimitReached;

  useEffect(() => {
    if (!active) {
      lapses.current = 0;
      finished.current = false;
      paused.current = false;
      setWarning(null);
      return;
    }

    const record = () => {
      if (finished.current || paused.current) return;

      const now = Date.now();
      // Leaving fullscreen to switch tab fires both events; one action is one
      // lapse, not two.
      if (now - lastAt.current < DEBOUNCE_MS) return;
      lastAt.current = now;

      lapses.current += 1;

      if (lapses.current > ALLOWED_LAPSES) {
        finished.current = true;
        setWarning(null);
        limitCallback.current(lapses.current);
        return;
      }

      // Same words both times. A second, sterner message would tell them the
      // count is being kept and roughly where they are in it.
      setWarning(
        "You left the exam. Stay on this page until you have submitted.",
      );
    };

    const onVisibility = () => {
      if (document.hidden) record();
    };
    const onFullscreen = () => {
      // Only leaving counts. Entering is what we asked them to do.
      if (!document.fullscreenElement) record();
    };

    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("fullscreenchange", onFullscreen);
    };
  }, [active]);

  const dismissWarning = useCallback(() => setWarning(null), []);
  const pause = useCallback(() => {
    paused.current = true;
  }, []);
  const resume = useCallback(() => {
    paused.current = false;
  }, []);

  return { warning, dismissWarning, lapses: lapses.current, pause, resume };
}
