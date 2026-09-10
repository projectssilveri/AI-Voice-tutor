import { Feature } from "@/types/feature";

/**
 * The one feature list on the site.
 *
 * It used to be two. "What the tutor does" listed six points and "What makes
 * it different" listed six more, and four of them were the same point written
 * twice: interrupt mid-sentence, grounded in your module, transcript
 * alongside, and re-read anything. A reader who got through both learned six
 * things and read twelve cards. `WhatMakesItDifferent.tsx` is deleted and its
 * genuinely distinct points (deterministic marking, unlimited replays) are
 * folded in here.
 *
 * The icons are redrawn. The template's were abstract fills, stacked
 * rectangles and a scatter of dots, with no relationship to the labels under
 * them, which makes them noise rather than a second way to read the list.
 * These are 24px line icons that each show the thing they name.
 */

/** Shared attributes, so six icons cannot drift into six different weights. */
const stroke = {
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const featuresData: Feature[] = [
  {
    id: 1,
    icon: (
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
        <path
          d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z"
          {...stroke}
        />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" {...stroke} />
      </svg>
    ),
    title: "The tutor speaks first",
    paragraph:
      "Open a module and it starts teaching that topic out loud, unprompted. No blank chat box waiting for you to think of a question.",
  },
  {
    id: 2,
    icon: (
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
        <path d="M3 12h2m3-4v8m3-11v14m3-9v4m3-6v8m3-5v2" {...stroke} />
      </svg>
    ),
    title: "Interrupt it mid-sentence",
    paragraph:
      "Just talk. The lecture stops within about half a second, answers what you asked, then picks up where it left off. No button, no waiting for a pause.",
  },
  {
    id: 3,
    icon: (
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
        <path
          d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H5.5A1.5 1.5 0 0 1 4 15.5v-10Z"
          {...stroke}
        />
        <path
          d="M20 5.5A1.5 1.5 0 0 0 18.5 4H14a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h4.5a1.5 1.5 0 0 0 1.5-1.5v-10Z"
          {...stroke}
        />
      </svg>
    ),
    title: "It only teaches this module",
    paragraph:
      "Answers come from the material of the module you are on, so the tutor will not reply with something from three modules ahead that you have not reached yet.",
  },
  {
    id: 4,
    icon: (
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
        <path d="M5 4h14v16l-3.5-2-3.5 2-3.5-2L5 20V4Z" {...stroke} />
        <path d="M9 9h6M9 13h4" {...stroke} />
      </svg>
    ),
    title: "A transcript runs alongside",
    paragraph:
      "Every word from both sides appears as text next to the tutor, in step with the audio, and is saved so you can read back anything you missed.",
  },
  {
    id: 5,
    icon: (
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
        <path d="M20 6 9 17l-5-5" {...stroke} />
      </svg>
    ),
    title: "Marked the same way every time",
    paragraph:
      "Quizzes and assignments are graded by matching your answer, not by a model guessing at it. The same answer always gets the same mark, and you find out straight away.",
  },
  {
    id: 6,
    icon: (
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
        <path d="M4 9a8 8 0 0 1 13.7-5.7L20 5.5" {...stroke} />
        <path d="M20 15a8 8 0 0 1-13.7 5.7L4 18.5" {...stroke} />
        <path d="M20 3v2.5h-2.5M4 21v-2.5h2.5" {...stroke} />
      </svg>
    ),
    title: "Replay anything, any time",
    paragraph:
      // The last clause was dropped in the merge and is worth keeping: a
      // capped exam with no way to ask for another go reads much harsher than
      // the product actually is. `attempt_grants` and the admin screen behind
      // it are what make the sentence true.
      "There is no cap on opening a module or hearing a lesson again. Practice quizzes are unlimited too. Only the certification exam limits attempts, and an admin can grant more if you ask.",
  },
  // --- Three claims that went missing when two sections became one -------
  //
  // Merging twelve cards down to six dropped four duplicates, which was the
  // point, but it also dropped three points that appeared in only one of the
  // two lists and therefore had nowhere to merge INTO. Each was checked
  // against the product before being put back, because the standing rule here
  // is that nothing goes on a public page unless the software does it:
  //
  //   asking out loud    the whole premise; it was stated once, in the list
  //                      that was deleted
  //   hints first        `gemini_live.py` instructs the tutor to offer a hint
  //                      before the full answer
  //   knows where you    the system instruction is given the student's name
  //   are                and "module N of M", and opens with both
  //
  // Nine cards rather than eight, so the grid is three clean rows of three.
  {
    id: 7,
    icon: (
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
        <path
          d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.3-.6L3 21l1.8-4.6A8.3 8.3 0 0 1 3.6 11.5 8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4Z"
          {...stroke}
        />
      </svg>
    ),
    title: "Ask without typing",
    paragraph:
      "Say what you did not follow, in your own words. You never have to paste code, name the concept, or find the right search term for a thing you do not understand yet.",
  },
  {
    id: 8,
    icon: (
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
        <path d="M9 18h6M10 21h4" {...stroke} />
        <path
          d="M12 3a6 6 0 0 0-3.6 10.8c.4.3.6.8.6 1.2h6c0-.4.2-.9.6-1.2A6 6 0 0 0 12 3Z"
          {...stroke}
        />
      </svg>
    ),
    title: "A hint before the answer",
    paragraph:
      "Ask what something means and the tutor nudges you first. You get the whole answer if you want it, but you get a chance to reach it yourself before that.",
  },
  {
    id: 9,
    icon: (
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
        <path d="M4 6h16M4 12h10M4 18h6" {...stroke} />
        <path d="M17.5 15.5 19 17l3-3" {...stroke} />
      </svg>
    ),
    title: "It knows where you are",
    paragraph:
      "The tutor is told your name and which module of the course this is, so it greets you and picks the lesson up at the right point rather than starting from nothing.",
  },
];

export default featuresData;
