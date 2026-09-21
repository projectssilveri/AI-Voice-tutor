"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Watches whether the student stays on the exam.
 *
 * WHAT IT COUNTS. Leaving fullscreen, switching tab or window, and the page
 * being hidden. All three mean the same thing from here: the exam is no longer
 * the thing on screen.
 *
 * WHAT IT DOES. Any one of them ends the attempt, immediately. The paper is
 * submitted as it stands and the attempt is gone, because the attempt was
 * spent when the paper opened (migration 0026).
 *
 * NO WARNINGS AND NO STRIKES. There used to be a budget of two, and a budget
 * on screen is a budget to spend: "one warning left" is an instruction to
 * leave once more. The rule asked for is simply that a violation costs an
 * attempt, and the exam page says so before anybody starts, which is the
 * moment it is worth knowing.
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

/**
 * The limit lives on the SERVER now, in `certification.ALLOWED_LAPSES`, and
 * the count lives on the attempt row.
 *
 * It was a constant here and a number in a React ref, reset every time a paper
 * opened. That held while opening a paper was a one-off. Papers are resumable
 * since migration 0026, so the budget reset every time somebody came back:
 * leave twice, close the tab, reopen, start again at zero.
 *
 * This hook now reports each departure and does what it is told.
 */

/**
 * How long somebody may be away before it counts as leaving.
 *
 * Come back inside this window and nothing happened. Nothing is reported,
 * nothing is recorded, and the attempt is untouched.
 *
 * WHY THERE IS A WINDOW AT ALL. One departure ends the attempt here, with no
 * warnings, which is stricter than the tools universities actually use:
 * Respondus LockDown Browser warns on the first swipe away and only ends the
 * session on the second, and FlexiQuiz lets a teacher set the number and tells
 * students what it is. With a rule this hard, the accidents matter. A
 * notification stealing focus for half a second, a trackpad gesture, a laptop
 * waking a display. Ending somebody's exam for those is indefensible.
 *
 * FIVE SECONDS, taken from Wayground, which ignores anything under three. Five
 * rather than three because the penalty here is heavier. Nobody looks an answer
 * up in five seconds, so this costs nothing in strictness and removes the whole
 * class of failure where the student did not actually do anything.
 *
 * It also replaces the old debounce. Leaving fullscreen in order to switch tab
 * fires both events, and both now find the same timer already pending.
 */
const GRACE_MS = 5000;

export interface ExamProctor {
  /** Shown from the moment they leave until the result appears. */
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
  onLapse,
  onLimitReached,
}: {
  /** True only while a paper is open. */
  active: boolean;
  /**
   * Report one departure. Resolves with the running total and whether the
   * allowance is gone. Failure is treated as "not over the limit": a student
   * whose network blipped must not have their exam submitted for them.
   */
  onLapse: (() => Promise<{ used: number; over: boolean }>) | undefined;
  /** Called once, when the allowance is gone. */
  onLimitReached: (lapses: number) => void;
}): ExamProctor {
  const [warning, setWarning] = useState<string | null>(null);
  const lapses = useRef(0);
  //: The grace window in flight, if somebody is away right now.
  const pending = useRef<number | null>(null);
  //: Whether full screen was ever granted. Until it has been, being out of it
  //: is the browser's doing rather than the student's.
  const fullscreenSeen = useRef(false);
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
  const lapseCallback = useRef(onLapse);
  lapseCallback.current = onLapse;

  useEffect(() => {
    if (!active) {
      lapses.current = 0;
      finished.current = false;
      paused.current = false;
      fullscreenSeen.current = false;
      if (pending.current !== null) {
        window.clearTimeout(pending.current);
        pending.current = null;
      }
      setWarning(null);
      return;
    }

    const record = () => {
      if (finished.current || paused.current) return;

      lapses.current += 1;

      // THE SERVER DECIDES. It holds the count on the attempt, so it is the
      // only one that knows about departures from a previous opening of this
      // same paper.
      void (async () => {
        let over = false;
        try {
          const result = await lapseCallback.current?.();
          if (result) {
            lapses.current = result.used;
            over = result.over;
          }
        } catch {
          // Unreachable, or refused. NOT treated as over the limit: submitting
          // somebody's exam because their wifi dropped is the worst thing this
          // file could do.
        }
        if (over && !finished.current) {
          finished.current = true;
          setWarning(null);
          limitCallback.current(lapses.current);
        }
      })();

      if (finished.current) return;

      // THE ONLY MESSAGE THERE IS. There used to be a warning here saying the
      // departure had been recorded and another one would end the exam. There
      // is no "another one" any more: leaving ends the attempt, so the only
      // honest thing to say is that it is ending. It shows for the moment
      // between the departure and the result screen appearing.
      setWarning(
        "You left the exam. This attempt is over and is being submitted as " +
          "it stands.",
      );
    };

    // ARE THEY AWAY RIGHT NOW? Asked fresh on every event rather than tracked
    // as a flag, because there are two independent ways to be away and they do
    // not clear each other.
    //
    // This is what the first version got wrong. It cancelled the countdown on
    // any event that was not a departure, so a `visibilitychange` saying the
    // tab was visible wiped out a pending FULLSCREEN departure. Exit full
    // screen, then touch the window, and the exam forgave it. Caught by
    // leaving full screen in a real session and watching nothing happen.
    const away = () =>
      document.hidden ||
      (fullscreenSeen.current && !document.fullscreenElement);

    const settle = () => {
      if (finished.current || paused.current) return;

      if (away()) {
        if (pending.current !== null) return; // already counting down
        pending.current = window.setTimeout(() => {
          pending.current = null;
          record();
        }, GRACE_MS);
        return;
      }

      // Back on every count, inside the window. Nothing is reported and
      // nothing is recorded: as far as the exam goes, they never left.
      if (pending.current !== null) {
        window.clearTimeout(pending.current);
        pending.current = null;
      }
    };

    const onVisibility = () => settle();
    const onFullscreen = () => {
      // Full screen can be REFUSED by the browser, and the exam is playable
      // without it. Only once it has actually been held does leaving it mean
      // anything, or a student whose browser never offered it is away from the
      // moment they start.
      if (document.fullscreenElement) fullscreenSeen.current = true;
      settle();
    };

    // A paper that opens while already in full screen gets no event, so the
    // first reading has to be taken by hand.
    if (document.fullscreenElement) fullscreenSeen.current = true;

    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => {
      if (pending.current !== null) {
        window.clearTimeout(pending.current);
        pending.current = null;
      }
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
