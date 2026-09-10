/**
 * Public course catalogue for the marketing site.
 *
 * Read without a session, so anyone browsing before signing up sees the real
 * courses rather than placeholder cards.
 */

import { ApiError, apiFetch } from "@/lib/api";
import type { Course, CourseLevel, CourseModule } from "@/types/course";

interface PublicCourseRow {
  id: string;
  title: string;
  description: string | null;
  module_count: number;
  price_minor: number;
  list_price_minor: number | null;
  access_days: number | null;
  currency: string;
}

export interface PublicPlan {
  id: string;
  name: string;
  description: string | null;
  price_minor: number;
  currency: string;
  billing_interval: string;
  course_titles: string[];
  /** Used by the pricing page to tell whether the reader already holds it. */
  course_ids: string[];
  /** True when the plan covers the whole published catalogue. */
  covers_everything: boolean;
  course_count: number;
  /** What these courses cost bought one at a time, at today's prices. */
  separate_total_minor: number;
}

export function listPublicPlans(): Promise<PublicPlan[]> {
  return apiFetch<PublicPlan[]>("/public/plans", {
    next: { revalidate: 60 },
  });
}

/**
 * The plans, split into the two kinds a reader actually distinguishes.
 *
 * A bundle is a stack — three or four courses used together. All-access is the
 * whole catalogue. The backend decides which is which by counting courses, so
 * the split is derived from what the plan really unlocks rather than from a
 * label somebody could forget to update.
 *
 * Cheapest first inside each group, which is the order somebody comparing
 * them reads in.
 */
export function splitPlans(plans: PublicPlan[]): {
  bundles: PublicPlan[];
  allAccess: PublicPlan[];
} {
  const byPrice = (a: PublicPlan, b: PublicPlan) =>
    a.price_minor - b.price_minor;
  return {
    bundles: plans.filter((plan) => !plan.covers_everything).sort(byPrice),
    allAccess: plans.filter((plan) => plan.covers_everything).sort(byPrice),
  };
}

/** "monthly" -> "month", for a price line that reads as a sentence. */
export function intervalLabel(value: string): string {
  return value === "yearly" ? "year" : "month";
}

interface PublicCourseDetailRow extends PublicCourseRow {
  modules: CourseModule[];
}

/** First word of the title as a topic badge: "React Basics" -> "React". */
function tagFor(title: string): string {
  return title.split(/\s+/)[0] ?? "Course";
}

/** Derived from length until courses carry a real difficulty field. */
function levelFor(moduleCount: number): CourseLevel {
  if (moduleCount <= 4) return "Beginner";
  if (moduleCount <= 8) return "Intermediate";
  return "Advanced";
}

function toCourse(row: PublicCourseRow): Course {
  return {
    id: row.id,
    title: row.title,
    paragraph: row.description ?? "",
    tag: tagFor(row.title),
    moduleCount: row.module_count,
    level: levelFor(row.module_count),
    priceMinor: row.price_minor,
    listPriceMinor: row.list_price_minor,
    accessDays: row.access_days,
    currency: row.currency,
  };
}

/**
 * How long access lasts, in words.
 *
 * Months rather than days, because "45 days" makes a reader do arithmetic
 * before they can judge whether it is enough. Half-months are kept — 45 days
 * is "1.5 months", not "1 month" rounded down, which would understate what
 * they get, nor "2 months" rounded up, which would overstate it.
 *
 * Shared by the card and the purchase panel deliberately: two screens quoting
 * different windows for the same course is decision 201's failure repeating.
 */
export function accessLabel(days: number | null): string | null {
  if (!days) return null;
  if (days < 30) return `${days} days of access`;
  const months = days / 30;
  const rounded = Math.round(months * 2) / 2;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text} month${rounded === 1 ? "" : "s"} of access`;
}

export interface ContactSubmission {
  name: string;
  email: string;
  /** Optional, and validated as digits + punctuation on both sides. */
  phone?: string;
  subject?: string;
  message: string;
  /** Honeypot. Left empty by humans; only a bot fills it in. */
  website?: string;
}

/**
 * Send a message from the Contact page.
 *
 * No session needed — the people using this form do not have accounts yet.
 */
export async function sendContactMessage(
  submission: ContactSubmission,
): Promise<void> {
  await apiFetch<{ status: string }>("/public/contact", {
    method: "POST",
    body: submission,
    cache: "no-store",
  });
}

export async function listPublicCourses(): Promise<Course[]> {
  const rows = await apiFetch<PublicCourseRow[]>("/public/courses", {
    // Courses change rarely, but a permanently stale marketing page is worse
    // than one request a minute.
    next: { revalidate: 60 },
  });
  return rows.map(toCourse);
}

/**
 * A course's public page, or null when there is genuinely no such course.
 *
 * Only 404 and 422 return null. Everything else is re-thrown, because the
 * caller turns null into `notFound()` — and swallowing every error here meant
 * a backend outage rendered "this course does not exist" on every course on
 * the site. That is a lie, it tells the visitor to stop looking, and it hides
 * the outage from anyone watching for 5xx.
 *
 * 422 is included because an id that is not a UUID cannot name a course
 * either; that is a bad URL, which is a 404 in every sense that matters here.
 */
export async function getPublicCourse(
  courseId: string,
): Promise<{ course: Course; modules: CourseModule[] } | null> {
  try {
    const row = await apiFetch<PublicCourseDetailRow>(
      `/public/courses/${courseId}`,
      { next: { revalidate: 60 } },
    );
    return {
      course: toCourse(row),
      modules: [...row.modules].sort((a, b) => a.order - b.order),
    };
  } catch (caught) {
    if (
      caught instanceof ApiError &&
      (caught.status === 404 || caught.status === 422)
    ) {
      return null;
    }
    throw caught;
  }
}
