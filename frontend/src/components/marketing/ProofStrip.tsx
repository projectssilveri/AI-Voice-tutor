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
    <Container size="wide" className="my-10">
      {/* A grid of divs rather than a <dl>. In a description list the label is
          the term and the number is the description, which is the reverse of
          the reading order here, and inverting it with flex to satisfy the
          markup would put the two out of step for a screen reader. */}
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] p-2 backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.37)]">
        {/* Subtle top glow line */}
        <div className="pointer-events-none absolute -top-px left-1/2 -translate-x-1/2 h-px w-3/4 bg-gradient-to-r from-transparent via-indigo-500/50 to-transparent" />
        
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {facts.map((fact) => (
            <div
              key={fact.label}
              className="group relative overflow-hidden rounded-xl border border-white/5 bg-[var(--mk-canvas)]/60 px-5 py-6 transition-all duration-300 hover:-translate-y-0.5 hover:border-indigo-500/30 hover:bg-white/[0.04]"
            >
              <p className="text-[28px] font-bold tabular-nums tracking-[-0.02em] text-white group-hover:bg-gradient-to-r group-hover:from-indigo-300 group-hover:to-violet-300 group-hover:bg-clip-text group-hover:text-transparent transition-all">
                <CountUp
                  value={fact.count}
                  prefix={fact.prefix}
                  suffix={fact.suffix}
                />
              </p>
              <p className="mt-1.5 text-[13px] font-medium leading-snug text-[var(--mk-muted)] group-hover:text-slate-300 transition-colors">
                {fact.label}
              </p>
            </div>
          ))}
        </div>
      </div>
    </Container>
  );
}
