import type { Metadata } from "next";
import { notFound } from "next/navigation";

import CourseCover from "@/components/marketing/Courses/CourseCover";
import CourseTabs from "@/components/marketing/course/CourseTabs";
import CurriculumAccordion from "@/components/marketing/course/CurriculumAccordion";
import { getPublicCourse } from "@/lib/catalogue";
import { counted } from "@/lib/plural";
import CoursePurchase from "@/components/marketing/course/CoursePurchase";
import MarketplaceOnly from "@/components/org/MarketplaceOnly";
import OrgRedirectNotice from "@/components/org/OrgRedirectNotice";

interface PageProps {
  params: Promise<{ courseId: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { courseId } = await params;
  const data = await getPublicCourse(courseId);
  if (!data) return { title: "Course not found" };
  return {
    title: data.course.title,
    description: data.course.paragraph,
  };
}

/**
 * Public course landing page.
 *
 * The page someone reads before deciding to sign up, so it shows the syllabus
 * — module titles and count — but never module *content*. That is the material
 * the tutor teaches from; giving it away here would mean the course could be
 * read without ever creating an account.
 */
export default async function PublicCoursePage({ params }: PageProps) {
  const { courseId } = await params;
  const data = await getPublicCourse(courseId);

  if (!data) notFound();

  const { course, modules } = data;

  // Totals for the quick-stat row. Summed here rather than asked of the API:
  // the per-module numbers are already on the page.
  const totalMinutes = modules.reduce((sum, m) => sum + m.estimated_minutes, 0);
  const totalQuizzes = modules.reduce((sum, m) => sum + m.quiz_questions, 0);
  const totalAssignments = modules.reduce((sum, m) => sum + m.assignments, 0);
  const readingTime =
    totalMinutes >= 60
      ? `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`
      : `${totalMinutes} min`;

  return (
    <>
      <OrgRedirectNotice context="course" />
      {/* Hero */}
      <section className="relative z-10 overflow-hidden pb-12 pt-14 md:pt-20">
        <div className="pointer-events-none absolute -top-24 left-1/4 h-80 w-1/2 rounded-full bg-indigo-500/10 blur-[120px]" />
        <div className="container">
          <div className="grid items-center gap-10 lg:grid-cols-[7fr_5fr] lg:gap-14">
            <div>
              <span className="mb-4 inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-4 py-1 text-xs font-bold uppercase tracking-wider text-indigo-300 backdrop-blur-md">
                <span className="size-1.5 rounded-full bg-indigo-400 animate-pulse" />
                {course.tag}
              </span>
              <h1 className="mb-4 text-3xl font-bold leading-tight text-white sm:text-4xl md:text-5xl">
                <span className="bg-gradient-to-r from-white via-slate-100 to-indigo-200 bg-clip-text text-transparent">
                  {course.title}
                </span>
              </h1>
              <p className="mb-6 max-w-2xl text-base !leading-relaxed text-[var(--mk-muted)] md:text-lg">
                {course.paragraph}
              </p>

              {/* Quick stats. The voice lecture is stated as a headline
                  feature rather than left for someone to discover after
                  paying — it is the whole reason this product exists. */}
              <dl className="mb-6 grid max-w-xl grid-cols-2 gap-3.5 sm:grid-cols-4">
                {[
                  { label: "Modules", value: String(course.moduleCount) },
                  { label: "Tutor time", value: readingTime },
                  { label: "Level", value: course.level },
                  {
                    label: "Assessments",
                    value: String(totalQuizzes + totalAssignments),
                  },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3 backdrop-blur-md"
                  >
                    <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      {stat.label}
                    </dt>
                    <dd className="mt-1 text-base font-bold text-white">
                      {stat.value}
                    </dd>
                  </div>
                ))}
              </dl>

              <ul className="mb-8 space-y-2.5 text-sm text-[var(--mk-muted)]">
                <li className="flex items-start gap-2.5">
                  <span aria-hidden="true" className="text-base">🎙️</span>
                  <span>
                    <strong className="text-white">
                      AI-led voice lecture
                    </strong>{" "}
                    on every module. Ask questions any time, out loud, mid-sentence.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span aria-hidden="true" className="text-base">🎓</span>
                  <span>
                    <strong className="text-white">
                      Shareable certificate
                    </strong>{" "}
                    on passing. It carries a unique ID anyone can verify.
                  </span>
                </li>
              </ul>

              {/* Price and the buy decision. This block used to be two links
                  and no price at all — see CoursePurchase for why that
                  mattered. */}
              {/* No buy or start control for an organisation member: the
                  course is not theirs to take, and the start CTA led to "We
                  can't find that course". The notice above tells them where
                  their training is. */}
              <MarketplaceOnly>
                <CoursePurchase
                  id="buy"
                  courseId={course.id}
                  priceMinor={course.priceMinor}
                  listPriceMinor={course.listPriceMinor}
                  accessDays={course.accessDays}
                  currency={course.currency}
                />
              </MarketplaceOnly>
            </div>

            <div>
              {/* Generated from the title, the same as the catalogue card.
                  `Course.image` was removed when covers stopped coming from a
                  pool of three stock photographs, and this was the last place
                  still reaching for it. */}
              <div className="relative aspect-[37/22] w-full overflow-hidden rounded-2xl border border-white/15 shadow-[0_24px_60px_rgba(0,0,0,0.6)]">
                <CourseCover title={course.title} courseId={course.id} />
              </div>
            </div>
          </div>
        </div>
      </section>

      <CourseTabs
        sections={[
          { id: "about", label: "About" },
          { id: "curriculum", label: "Curriculum" },
        ]}
      />

      <section
        id="about"
        /* The header AND the tab bar sit above an anchored section, so 16
           left the heading underneath both. */
        className="scroll-mt-36 bg-[var(--mk-canvas)] py-16 md:py-20"
      >
        <div className="container">
          <div className="grid gap-10 lg:grid-cols-[8fr_4fr] lg:gap-14">
            <div>
              <h2 className="mb-3 text-2xl font-bold text-white sm:text-3xl">
                About this course
              </h2>
              <p className="mb-8 text-base leading-relaxed text-[var(--mk-muted)]">
                {course.paragraph}
              </p>

              <h2
                id="curriculum"
                className="mb-3 scroll-mt-36 text-2xl font-bold text-white sm:text-3xl"
              >
                Curriculum
              </h2>
              <p className="mb-8 text-base text-[var(--mk-muted)]">
                {counted(course.moduleCount, "module")}, about {readingTime} of tutor
                time. Open any module to see what is inside.
              </p>

              <CurriculumAccordion modules={modules} />
            </div>

            <div>
              <div className="rounded-2xl border border-white/10 bg-[var(--mk-raised)]/80 p-7 backdrop-blur-xl shadow-[0_16px_40px_rgba(0,0,0,0.3)]">
                <h3 className="mb-5 text-xl font-bold text-white">
                  How this course works
                </h3>
                <ul className="space-y-3.5 text-[14.5px] text-slate-300">
                  <li className="flex items-start gap-2.5">
                    <span className="mt-1 size-1.5 shrink-0 rounded-full bg-indigo-400" />
                    <span>The tutor speaks first, with no prompting needed.</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="mt-1 size-1.5 shrink-0 rounded-full bg-indigo-400" />
                    <span>Cut in mid-sentence with a question, by voice.</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="mt-1 size-1.5 shrink-0 rounded-full bg-indigo-400" />
                    <span>Answers stay inside this course&apos;s material.</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="mt-1 size-1.5 shrink-0 rounded-full bg-indigo-400" />
                    <span>A live transcript runs alongside the audio.</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="mt-1 size-1.5 shrink-0 rounded-full bg-indigo-400" />
                    <span>Re-read anything as many times as you like.</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="mt-1 size-1.5 shrink-0 rounded-full bg-indigo-400" />
                    <span>Pass the exam and your certificate carries a unique verifiable ID.</span>
                  </li>
                </ul>
                <a
                  href="#buy"
                  className="mt-8 flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-indigo-500 via-indigo-600 to-purple-600 px-6 py-3.5 text-base font-semibold text-white shadow-[0_4px_20px_rgba(99,102,241,0.4)] transition hover:shadow-[0_6px_28px_rgba(99,102,241,0.6)] active:scale-[0.98]"
                >
                  Get started
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
