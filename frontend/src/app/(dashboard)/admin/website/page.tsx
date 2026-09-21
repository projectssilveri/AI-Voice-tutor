"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import RequireAuth from "@/components/auth/RequireAuth";
import CourseAdminRow from "@/components/admin/CourseAdminRow";
import ReviewQueue from "@/components/admin/ReviewQueue";
import EmptyState from "@/components/ui/EmptyState";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { formatMoney } from "@/lib/money";
import { ApiError } from "@/lib/api";
import {
  type CourseRow,
  createCourse,
  listCourses,
  updateCoursePricing,
} from "@/lib/authoring";
import { counted } from "@/lib/plural";

/**
 * The public website, from the inside.
 *
 * Course authoring already existed, but nothing on the console answered the
 * question a super admin actually asks before publishing: "what will a visitor
 * see?" Publishing was a toggle on a form, and the only way to check the result
 * was to open the marketing site in another tab and hunt for the card.
 *
 * So this screen is the catalogue as the public sees it. Each course is drawn
 * as the card a visitor gets, with the price and the exact words on it, and the
 * publish switch sits on the card rather than on a form somewhere else. Adding
 * a course starts here too, because "add a course to the website" is one
 * intention, not two screens.
 *
 * Super admin only: price and publication are `RequireSuperAdmin` powers
 * (decision 51), and this screen is mostly those two things.
 */

const FIELD =
  "w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

/** The card as the marketing catalogue draws it, so this is a real preview. */
function PublicCard({ course }: { course: CourseRow }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-raised dark:border-gray-800 dark:bg-white/[0.03]">
      <h3 className="mb-1 font-semibold text-gray-800 dark:text-white/90">
        {course.title}
      </h3>
      <p className="mb-4 line-clamp-2 min-h-10 text-sm text-body-color dark:text-body-color-dark">
        {course.description ||
          "No description yet. Visitors will see nothing here."}
      </p>
      <div className="flex items-center justify-between">
        <span className="text-lg font-bold text-gray-800 dark:text-white/90">
          {/* Nobody reads ₹0 as an invitation. The catalogue writes "Free"
              (decision 128) and so does the preview, or the preview is lying. */}
          {course.price_minor > 0
            ? formatMoney(course.price_minor, course.currency)
            : "Free"}
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {counted(course.module_count ?? 0, "module")}
        </span>
      </div>
    </div>
  );
}

function WebsiteConsole() {
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");

  const load = useCallback(async () => {
    try {
      setCourses(await listCourses());
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not load courses.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    if (!title.trim()) return;
    setBusyId("new");
    try {
      const created = await createCourse({
        title: title.trim(),
        description: description.trim() || null,
      });
      // The price is a separate endpoint behind a stricter gate (decision 51),
      // so it is a second call rather than a field on create. Only made when a
      // price was actually typed — a course with no price given stays free.
      const rupees = Number(price);
      if (price.trim() && Number.isFinite(rupees) && rupees > 0) {
        await updateCoursePricing(created.id, {
          price_minor: Math.round(rupees * 100),
        });
      }
      setTitle("");
      setDescription("");
      setPrice("");
      setAdding(false);
      setNotice(
        `"${created.title}" created. Add modules to it, then publish it here.`,
      );
      await load();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not create the course.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function togglePublished(course: CourseRow) {
    setBusyId(course.id);
    try {
      await updateCoursePricing(course.id, {
        is_published: !course.is_published,
      });
      await load();
      setNotice(
        course.is_published
          ? `"${course.title}" is off the website. Anyone already enrolled keeps it.`
          : `"${course.title}" is live on the website.`,
      );
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not change it.",
      );
    } finally {
      setBusyId(null);
    }
  }

  // THE PUBLIC SITE ONLY. A super admin's course list spans every tenant, so
  // this screen was listing three organizations' private compliance training
  // under "live on the website, anyone can find and buy" — courses no visitor
  // can see, because `/public/courses` filters them out. It offered "View as a
  // visitor" on them too, which led nowhere. Customer training has its own
  // screen; this one is the catalogue.
  const marketplace = courses.filter(
    (course) => course.organization_id === null,
  );
  const live = marketplace.filter((course) => course.is_published);
  const drafts = marketplace.filter((course) => !course.is_published);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-title-sm font-bold text-gray-800 dark:text-white/90">
            Website
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            What visitors see on the public site, and what is still a draft.{" "}
            <Link
              href="/courses"
              target="_blank"
              className="text-brand-500 dark:text-brand-400 hover:text-brand-600"
            >
              Open the live catalogue ↗
            </Link>
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAdding((open) => !open)}
          className="rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600"
        >
          {adding ? "Close" : "Add a new course"}
        </button>
      </div>

      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-error-500 bg-error-50 px-4 py-2.5 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mb-4 rounded-lg border border-success-500 bg-success-50 px-4 py-2.5 text-sm text-success-700 dark:bg-success-500/10 dark:text-success-400">
          {notice}
        </p>
      ) : null}

      {/* WHAT IS WAITING ON YOU, above the catalogue. Still here, because
          approving is the same decision as publishing and publishing lives on
          this screen — but it is no longer the ONLY place it lives. It renders
          nothing when the queue is empty, which meant that with nothing pending
          the approval workflow left no trace in the product at all and was
          reported as missing. It now has its own page and menu entry too
          (issues 34 and 35); this stays as the shortcut for somebody already
          looking at the catalogue. */}
      <ReviewQueue onDecided={() => void load()} />

      {adding ? (
        <div className="mb-8 grid gap-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-lifted lg:grid-cols-2 dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">
              Add a course
            </h2>
            <div>
              <label
                htmlFor="course-title"
                className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
              >
                Title
              </label>
              <input
                id="course-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="React Essentials"
                className={FIELD}
              />
            </div>
            <div>
              <label
                htmlFor="course-description"
                className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
              >
                Description
              </label>
              <textarea
                id="course-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                placeholder="One or two sentences. This is what a visitor reads on the card."
                className={FIELD}
              />
            </div>
            <div>
              <label
                htmlFor="course-price"
                className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
              >
                Price in rupees{" "}
                <span className="font-normal text-gray-500 dark:text-gray-400">
                  (leave blank for free)
                </span>
              </label>
              <input
                id="course-price"
                type="number"
                min={0}
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                placeholder="1499"
                className={FIELD}
              />
            </div>
            <button
              type="button"
              disabled={busyId === "new" || !title.trim()}
              onClick={() => void add()}
              className="rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-50"
            >
              {busyId === "new" ? "Creating…" : "Create course"}
            </button>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              It starts as a draft. Add modules to it under Add or modify
              courses, then publish it from here.
            </p>
          </div>

          <div>
            <p className="mb-2 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
              How it will look
            </p>
            <PublicCard
              course={{
                id: "preview",
                title: title || "Your course title",
                description: description || null,
                created_at: "",
                updated_at: "",
                price_minor:
                  Number(price) > 0 ? Math.round(Number(price) * 100) : 0,
                // The preview is of a course that does not exist yet, so it
                // carries no earlier price and no window.
                list_price_minor: null,
                access_days: null,
                suggested_access_days: null,
                currency: "INR",
                is_published: false,
                module_count: 0,
                // No exam yet, because there is no course yet. Not rendered by
                // this card either way.
                has_certification: false,
                // Required by the type; NOT rendered by this card. Deliberately
                // left at zero rather than filled with today's default figures
                // — a preview that stated an allowance would be a third place
                // those numbers live, and the one nobody would think to update.
                ai_sessions_per_module: null,
                ai_session_minutes: null,
                effective_ai_sessions_per_module: 0,
                effective_ai_session_minutes: 0,
                ai_limit_basis: "free",
                organization_id: null,
                // A course that does not exist yet has not been submitted to
                // anybody. The preview card does not render these.
                review_status: "draft",
                submitted_at: null,
                reviewed_at: null,
                review_note: null,
              }}
            />
          </div>
        </div>
      ) : null}

      {loading ? (
        <SkeletonRows rows={4} />
      ) : courses.length === 0 ? (
        <EmptyState
          icon="🌐"
          title="Nothing on the website yet"
          body="Add your first course and it will appear here."
        />
      ) : (
        <>
          <section className="mb-10">
            <h2 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">
              Live on the website
            </h2>
            <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
              {live.length === 0
                ? "Nothing is published yet, so the catalogue is empty to visitors."
                : `${counted(live.length, "course")} anyone can find and buy.`}
            </p>
            {live.length > 0 ? (
              <ul className="space-y-4">
                {live.map((course) => (
                  <CourseAdminRow
                    key={course.id}
                    course={course}
                    busy={busyId === course.id}
                    onTogglePublished={(row) => void togglePublished(row)}
                  />
                ))}
              </ul>
            ) : null}
          </section>

          <section>
            <h2 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">
              Not on sale
            </h2>
            <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
              {drafts.length === 0
                ? "Nothing waiting. Everything written is live."
                : "Staff can open these; students cannot, unless they already bought or enrolled in one."}
            </p>
            {drafts.length > 0 ? (
              <ul className="space-y-4">
                {drafts.map((course) => (
                  <CourseAdminRow
                    key={course.id}
                    course={course}
                    busy={busyId === course.id}
                    onTogglePublished={(row) => void togglePublished(row)}
                  />
                ))}
              </ul>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}

export default function AdminWebsitePage() {
  return (
    <RequireAuth roles={["super_admin"]}>
      <WebsiteConsole />
    </RequireAuth>
  );
}
