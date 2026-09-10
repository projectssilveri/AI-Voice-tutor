import type { Metadata } from "next";
import { notFound } from "next/navigation";

import CourseCover from "@/components/marketing/Courses/CourseCover";
import CourseTabs from "@/components/marketing/course/CourseTabs";
import CurriculumAccordion from "@/components/marketing/course/CurriculumAccordion";
import { getPublicCourse } from "@/lib/catalogue";
import { counted } from "@/lib/plural";
import CoursePurchase from "@/components/marketing/course/CoursePurchase";
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
      <section className="relative z-10 overflow-hidden bg-[var(--mk-raised)] pb-12 pt-14 md:pt-20">
        <div className="container">
          <div className="grid items-center gap-10 lg:grid-cols-[7fr_5fr] lg:gap-14">
            <div>
              <span className="mb-4 inline-flex rounded-full bg-[var(--mk-brand)] px-4 py-1.5 text-sm font-semibold capitalize text-white">
                {course.tag}
              </span>
              <h1 className="mb-4 text-3xl font-semibold leading-tight text-[var(--mk-text)] sm:text-4xl md:text-5xl">
                {course.title}
              </h1>
              <p className="mb-6 max-w-2xl text-base !leading-relaxed text-[var(--mk-muted)] md:text-lg">
                {course.paragraph}
              </p>

              {/* Quick stats. The voice lecture is stated as a headline
                  feature rather than left for someone to discover after
                  paying — it is the whole reason this product exists. */}
              <dl className="mb-6 grid max-w-xl grid-cols-2 gap-4 sm:grid-cols-4">
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
                    className="rounded-xl bg-white/[0.03] px-4 py-3"
                  >
                    <dt className="text-xs uppercase tracking-wide text-[var(--mk-muted)]">
                      {stat.label}
                    </dt>
                    <dd className="mt-0.5 text-lg font-semibold text-[var(--mk-text)]">
                      {stat.value}
                    </dd>
                  </div>
                ))}
              </dl>

              <ul className="mb-8 space-y-2 text-sm text-[var(--mk-muted)]">
                <li className="flex items-start gap-2">
                  <span aria-hidden="true">🎙️</span>
                  <span>
                    <strong className="text-[var(--mk-text)]">
                      AI-led voice lecture
                    </strong>{" "}
                    on every module. Ask questions any time, out loud, mid-sentence.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span aria-hidden="true">🎓</span>
                  <span>
                    <strong className="text-[var(--mk-text)]">
                      Shareable certificate
                    </strong>{" "}
                    on passing. It carries a unique ID anyone can verify.
                  </span>
                </li>
              </ul>

              {/* Price and the buy decision. This block used to be two links
                  and no price at all — see CoursePurchase for why that
                  mattered. */}
              <CoursePurchase
                id="buy"
                courseId={course.id}
                priceMinor={course.priceMinor}
                listPriceMinor={course.listPriceMinor}
                accessDays={course.accessDays}
                currency={course.currency}
              />
            </div>

            <div>
              {/* Generated from the title, the same as the catalogue card.
                  `Course.image` was removed when covers stopped coming from a
                  pool of three stock photographs, and this was the last place
                  still reaching for it. */}
              <div className="relative aspect-[37/22] w-full overflow-hidden rounded-2xl border border-[var(--mk-line)]">
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
        className="scroll-mt-16 bg-[var(--mk-inset)] py-16 md:py-20"
      >
        <div className="container">
          <div className="grid gap-10 lg:grid-cols-[8fr_4fr] lg:gap-14">
            <div>
              <h2 className="mb-2 text-2xl font-semibold text-[var(--mk-text)] sm:text-3xl">
                About this course
              </h2>
              <p className="mb-8 text-base text-[var(--mk-muted)]">
                {course.paragraph}
              </p>

              <h2
                id="curriculum"
                className="mb-2 scroll-mt-20 text-2xl font-semibold text-[var(--mk-text)] sm:text-3xl"
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
              <div className="rounded-2xl border border-[var(--mk-line)] bg-[var(--mk-raised)] p-6">
                <h3 className="mb-5 text-xl font-semibold text-[var(--mk-text)]">
                  How this course works
                </h3>
                <ul className="space-y-4 text-base text-[var(--mk-muted)]">
                  <li>The tutor speaks first, with no prompting needed.</li>
                  <li>Cut in mid-sentence with a question, by voice.</li>
                  <li>Answers stay inside this course&apos;s material.</li>
                  <li>A live transcript runs alongside the audio.</li>
                  <li>Re-read anything as many times as you like.</li>
                  <li>
                    Pass the exam and your certificate carries a unique ID that anyone you send it to can check.
                  </li>
                </ul>
                <a
                  href="#buy"
                  className="mt-8 flex w-full items-center justify-center rounded-lg bg-[var(--mk-brand)] px-6 py-3 text-base font-semibold text-white transition-[background-color,box-shadow,transform] duration-200 ease-[var(--ease-out-soft)] hover:bg-[var(--mk-brand)]/90 active:scale-[0.98] motion-reduce:active:scale-100"
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
