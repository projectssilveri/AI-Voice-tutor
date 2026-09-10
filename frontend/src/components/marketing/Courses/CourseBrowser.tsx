"use client";

import { useMemo, useState } from "react";

import SpotlightGroup from "@/components/marketing/ui/SpotlightGroup";
import Reveal from "@/components/ui/Reveal";
import type { Course, CourseLevel } from "@/types/course";

import CourseCard from "./CourseCard";

/**
 * Search and filters over the catalogue.
 *
 * FILTERED IN THE BROWSER, not on the server. The whole catalogue is six
 * courses and will be dozens before it is thousands; a round trip per keystroke
 * would be slower and would put the marketing page behind the API's
 * availability, which `CourseGrid` deliberately keeps it out of. When the
 * catalogue outgrows that, the filter state is already the shape a query string
 * would take.
 *
 * WHAT YOU CAN FILTER BY, and why these and not others. Courses carry no
 * category or difficulty column, so every dimension here is derived from
 * something real rather than invented:
 *
 *   Topic   the first word of the title, which is how `tagFor` already labels
 *           the badge on the card — so the filter matches what is on screen
 *   Level   derived from module count by `levelFor`, same as the card shows
 *   Price   free or paid, the one distinction a visitor filters by first
 *
 * A count is always shown. "No courses match" with no indication of how many
 * exist reads as a broken page rather than a narrow filter.
 */

const ALL = "All";

type PriceFilter = "All" | "Free" | "Paid";

// `--mk-text`, not muted: this holds what the person has typed or chosen, and
// their own input has to be the brightest thing in the control. The
// placeholder is muted separately by the rule in globals.css.
const CONTROL =
  "h-11 rounded-xl border border-white/10 bg-[var(--mk-canvas)]/80 px-4 text-sm text-white backdrop-blur-md " +
  "outline-hidden transition-all duration-200 focus:border-indigo-500/60 focus:bg-white/[0.06] focus:ring-3 focus:ring-indigo-500/20";

export default function CourseBrowser({ courses }: { courses: Course[] }) {
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState<string>(ALL);
  const [level, setLevel] = useState<CourseLevel | typeof ALL>(ALL);
  const [price, setPrice] = useState<PriceFilter>(ALL);

  // Built from the courses themselves, so a topic can never be offered that
  // matches nothing — an empty result the reader cannot explain.
  const topics = useMemo(
    () => [ALL, ...[...new Set(courses.map((c) => c.tag))].sort()],
    [courses],
  );
  const levels = useMemo(
    () =>
      [ALL, ...[...new Set(courses.map((c) => c.level))]] as (
        | CourseLevel
        | typeof ALL
      )[],
    [courses],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return courses.filter((course) => {
      if (topic !== ALL && course.tag !== topic) return false;
      if (level !== ALL && course.level !== level) return false;
      if (price === "Free" && course.priceMinor !== 0) return false;
      if (price === "Paid" && course.priceMinor === 0) return false;
      if (!needle) return true;
      // Title and description both, because somebody searching "async" is
      // looking for a topic covered inside a course, not one named after it.
      return `${course.title} ${course.paragraph}`.toLowerCase().includes(needle);
    });
  }, [courses, query, topic, level, price]);

  const filtering =
    query.trim() !== "" || topic !== ALL || level !== ALL || price !== ALL;

  return (
    <>
      <div className="mb-10 rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-5 backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.25)]">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <label className="sr-only" htmlFor="course-search">
              Search courses
            </label>
            <input
              id="course-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search courses..."
              className={`${CONTROL} w-full pl-10`}
            />
            <svg
              className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>

          <label className="sr-only" htmlFor="course-topic">
            Topic
          </label>
          <select
            id="course-topic"
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            className={CONTROL}
          >
            {topics.map((value) => (
              <option key={value} value={value} className="bg-slate-900 text-white">
                {value === ALL ? "All topics" : value}
              </option>
            ))}
          </select>

          <label className="sr-only" htmlFor="course-level">
            Level
          </label>
          <select
            id="course-level"
            value={level}
            onChange={(event) =>
              setLevel(event.target.value as CourseLevel | typeof ALL)
            }
            className={CONTROL}
          >
            {levels.map((value) => (
              <option key={value} value={value} className="bg-slate-900 text-white">
                {value === ALL ? "All levels" : value}
              </option>
            ))}
          </select>

          <label className="sr-only" htmlFor="course-price">
            Price
          </label>
          <select
            id="course-price"
            value={price}
            onChange={(event) => setPrice(event.target.value as PriceFilter)}
            className={CONTROL}
          >
            <option value="All" className="bg-slate-900 text-white">Any price</option>
            <option value="Free" className="bg-slate-900 text-white">Free</option>
            <option value="Paid" className="bg-slate-900 text-white">Paid</option>
          </select>

          {filtering ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setTopic(ALL);
                setLevel(ALL);
                setPrice(ALL);
              }}
              className="h-11 rounded-xl border border-white/10 px-4 text-sm font-semibold text-indigo-300 transition hover:bg-white/5 hover:text-white"
            >
              Clear
            </button>
          ) : null}
        </div>

        {/* Always the count, never just the cards. A visitor who has narrowed
            to two results needs to know whether that is the whole catalogue or
            two out of forty. */}
        <p
          aria-live="polite"
          className="mt-3 text-xs font-medium text-slate-400"
        >
          {filtering
            ? `Showing ${visible.length} of ${courses.length} ${
                courses.length === 1 ? "course" : "courses"
              }`
            : `${courses.length} total ${courses.length === 1 ? "course" : "courses"}`}
        </p>
      </div>

      {visible.length === 0 ? (
        <p className="text-center text-base text-[var(--mk-muted)]">
          No courses match that. Try a different search or clear the filters.
        </p>
      ) : (
        // Same grid and same spotlight as the home page teaser. This one had
        // its own four-breakpoint gap (`gap-x-8 gap-y-10 md:gap-x-6
        // lg:gap-x-8`), so the catalogue page's cards sat at different
        // distances from each other than the identical cards on the home page.
        <SpotlightGroup className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((course, index) => (
            /* Staggered by column, not by index: on a 3-up grid a flat index
               stagger makes row two start where row one finished, so the last
               card is half a second late. Modulo keeps every row identical. */
            <Reveal key={course.id} delay={(index % 3) * 80} className="h-full">
              {/* h2: on /courses the page hero is the h1 and this grid
                  follows it directly, with no section heading between. */}
              <CourseCard course={course} headingLevel="h2" />
            </Reveal>
          ))}
        </SpotlightGroup>
      )}
    </>
  );
}
