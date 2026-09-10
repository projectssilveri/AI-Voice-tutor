import Container from "@/components/marketing/ui/Container";
import CountUp from "@/components/marketing/ui/CountUp";
import { listPublicCourses } from "@/lib/catalogue";

/**
 * A thin band of real numbers under the hero.
 *
 * It is where a landing page usually puts customer logos. We have no customers
 * to name yet, and inventing them is the same lie the testimonials section
 * used to tell before it was removed: three quotes attributed to "Placeholder
 * Name". Facts about the catalogue are true, checkable by clicking through,
 * and do the same job of saying "this is a real thing" without pretending
 * anyone has endorsed it.
 *
 * Every figure is counted from the catalogue at request time, so it cannot go
 * stale when a course is added. The numbers count up on scroll, and `CountUp`
 * is built so the true figure is what renders when that animation cannot run.
 */
export default async function ProofStrip() {
  let courses: Awaited<ReturnType<typeof listPublicCourses>> = [];
  try {
    courses = await listPublicCourses();
  } catch {
    // Same rule as the course grid: the page renders without the API. An
    // empty strip is better than an error where a fact should be.
  }

  if (courses.length === 0) return null;

  const modules = courses.reduce((sum, course) => sum + course.moduleCount, 0);
  const free = courses.filter((course) => course.priceMinor === 0).length;

  const facts: { count: number; prefix?: string; suffix?: string; label: string }[] =
    [
      { count: courses.length, label: "courses" },
      { count: modules, label: "modules, each with its own lecture" },
      {
        // "up to", because 90 is the default in
        // `paid_course_ai_session_minutes` and a super admin can set a lower
        // allowance on an individual course. A flat "90 min" would be a
        // promise the product does not always keep.
        count: 90,
        prefix: "up to ",
        suffix: " min",
        label: "of tutor time in one paid session",
      },
      ...(free > 0
        ? [
            {
              count: free,
              suffix: " free",
              label:
                free === 1
                  ? "course, no card needed"
                  : "courses, no card needed",
            },
          ]
        : []),
    ];

  return (
    <Container size="wide">
      {/* A grid of divs rather than a <dl>. In a description list the label is
          the term and the number is the description, which is the reverse of
          the reading order here, and inverting it with flex to satisfy the
          markup would put the two out of step for a screen reader. */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-[var(--mk-line)] bg-[var(--mk-line)] sm:grid-cols-4">
        {facts.map((fact) => (
          <div key={fact.label} className="bg-[var(--mk-canvas)] px-5 py-6">
            <p className="text-[26px] font-semibold tabular-nums tracking-[-0.02em] text-[var(--mk-text)]">
              <CountUp
                value={fact.count}
                prefix={fact.prefix}
                suffix={fact.suffix}
              />
            </p>
            <p className="mt-1 text-[13.5px] leading-snug text-[var(--mk-muted)]">
              {fact.label}
            </p>
          </div>
        ))}
      </div>
    </Container>
  );
}
