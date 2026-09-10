/**
 * Marketing-facing course summary.
 *
 * Fields mirror the `courses` table plus a presentation-only extra (level)
 * that is derived rather than stored.
 *
 * No `image`. Cover art is drawn from the title by `CourseCover` at render
 * time, so carrying a path here would be a second answer to the same question
 * — and it was the wrong one: it came from a pool of three stock photos picked
 * by list position.
 */
export type CourseLevel = "Beginner" | "Intermediate" | "Advanced";

export type Course = {
  /** Real course UUID — used in the marketing course URL. */
  id: string;
  title: string;
  /** Maps to `courses.description`. */
  paragraph: string;
  /** Short topic label rendered as a badge, e.g. "React". */
  tag: string;
  moduleCount: number;
  level: CourseLevel;
  /** Integer minor units (paise). 0 means free. */
  priceMinor: number;
  /**
   * What the course used to cost, struck through beside `priceMinor`.
   *
   * `null` for almost every course, and that is the honest default: only a
   * price the course GENUINELY carried belongs here. A "was" figure invented
   * to make the real one look like a discount is a deceptive pricing practice.
   */
  listPriceMinor: number | null;
  /**
   * How long a purchase lasts, in days. `null` means it never expires — the
   * older "pay once, keep it" terms, still honoured for anyone who bought
   * under them.
   */
  accessDays: number | null;
  currency: string;
};

export type CourseModule = {
  id: string;
  title: string;
  order: number;
  /**
   * What is inside the module, as counts and a time estimate. Never the
   * material itself — that is what the tutor teaches from, and exposing it
   * here would let anyone read the course without an account.
   */
  estimated_minutes: number;
  has_voice_lecture: boolean;
  /** Whether the module has written material. Never the material itself. */
  has_notes: boolean;
  quiz_questions: number;
  assignments: number;
  materials: number;
};
