import SectionTitle from "@/components/marketing/common/SectionTitle";
import MarketingButton from "@/components/marketing/ui/MarketingButton";
import Section from "@/components/marketing/ui/Section";
import SpotlightGroup from "@/components/marketing/ui/SpotlightGroup";
import Reveal from "@/components/ui/Reveal";
import { listPublicCourses } from "@/lib/catalogue";
import type { Course } from "@/types/course";

import CourseBrowser from "./CourseBrowser";
import CourseCard from "./CourseCard";

/**
 * The course grid, used both as the Courses page and as a home page teaser.
 *
 * `limit` is what the home page needs. Measured before this change, the home
 * page rendered all 11 courses in a 2,797px section — more than half the
 * length of the page, spent on a list that has its own page and its own
 * filters. Six cards make the point and the eleventh is one click away.
 */
export default async function CourseGrid({
  // Search and filters belong on the Courses page, where somebody is choosing.
  // The home page runs the same grid as a teaser, and a filter bar there would
  // ask a visitor to narrow a catalogue they have not read yet.
  browsable = false,
  limit,
}: {
  browsable?: boolean;
  limit?: number;
} = {}) {
  let courses: Course[] = [];
  let failed = false;

  try {
    courses = await listPublicCourses();
  } catch {
    // The marketing page must still render if the API is down — a hero and a
    // sign-up button are more use than an error screen.
    failed = true;
  }

  const total = courses.length;
  const shown = limit ? courses.slice(0, limit) : courses;

  return (
    // Less air above the grid on /courses: the page hero already sits
    // directly above it, so the full section rhythm would leave the filter
    // bar stranded a third of the way down the screen.
    <Section id="courses" size={browsable ? "tight" : "default"}>
      {/* No heading in browsable mode. On /courses the page hero directly
          above is already the introduction, and a second one under it told
          the reader the same thing twice before showing a single course. */}
      {!browsable && (
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionTitle
            eyebrow="Catalogue"
            title="Start with one of these"
            paragraph="Every module comes with a tutor that lectures on that topic and answers your questions out loud."
            className="mb-0 flex-1"
          />
          {total > shown.length && (
            <MarketingButton href="/courses" variant="secondary">
              All {total} courses
              <span aria-hidden="true">→</span>
            </MarketingButton>
          )}
        </div>
      )}

      {/* The heading's own bottom margin is dropped above so it can sit level
          with the button beside it. The gap below the row is set here. */}
      <div className={browsable ? "" : "mt-12 md:mt-16"}>
        {total === 0 ? (
          <p className="text-[15px] text-[var(--mk-muted)]">
            {failed
              ? "We could not load the courses. That is our end, not yours. Reload in a moment."
              : "New courses are on the way. Check back soon."}
          </p>
        ) : browsable ? (
          <CourseBrowser courses={courses} />
        ) : (
          <SpotlightGroup className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((course, index) => (
              /* Staggered by column, not by index: on a 3-up grid a flat
                 index stagger makes row two start where row one finished,
                 so the last card is half a second late. Modulo keeps every
                 row's cadence identical. */
              <Reveal
                key={course.id}
                delay={(index % 3) * 80}
                className="h-full"
              >
                <CourseCard course={course} />
              </Reveal>
            ))}
          </SpotlightGroup>
        )}
      </div>
    </Section>
  );
}
