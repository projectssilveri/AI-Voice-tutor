import Link from "next/link";

import CourseCover from "@/components/marketing/Courses/CourseCover";
import Panel from "@/components/marketing/ui/Panel";
import { accessLabel } from "@/lib/catalogue";
import { Course } from "@/types/course";

/**
 * A course in the grid.
 *
 * Ported from Startup's `SingleBlog` originally; the author and date footer
 * was replaced with the two facts a student needs before enrolling, and this
 * pass moves the whole card onto `Panel` so it sits on the dark canvas with
 * the same edges as everything else.
 *
 * `overflow-hidden` lives on the media link rather than the card, so the cover
 * can scale on hover without also clipping the card's own rounded corners
 * against the border.
 */

/**
 * Price, or "Free".
 *
 * A free course renders the word rather than ₹0 — nobody reads "₹0" as an
 * invitation, and it is the one card we most want someone to click.
 */
function money(minor: number, currency: string): string {
  if (minor === 0) return "Free";
  const symbol = currency === "INR" ? "₹" : `${currency} `;
  return `${symbol}${(minor / 100).toLocaleString("en-IN")}`;
}

export default function CourseCard({
  course,
  headingLevel = "h3",
}: {
  course: Course;
  /**
   * The heading tag for the title.
   *
   * On /courses the grid IS the page: the hero is the h1 and there is no
   * section heading between it and the cards, so an h3 skips a level and the
   * document outline reads h1 then h3. On the home page the same card sits
   * under "Start with one of these", which is the h2, so h3 is right there.
   *
   * A prop rather than a guess, because the card cannot know which page it is
   * on and a wrong outline is invisible until somebody navigates by heading.
   */
  headingLevel?: "h2" | "h3";
}) {
  const Heading = headingLevel;
  const {
    title,
    paragraph,
    tag,
    moduleCount,
    level,
    priceMinor,
    listPriceMinor,
    accessDays,
    currency,
  } = course;
  const free = priceMinor === 0;
  // Only a HIGHER previous price is a discount worth showing. A list price
  // equal to or below what is charged is either a data slip or a claim that
  // is not true, and either way it does not go on the card.
  const wasMore = listPriceMinor !== null && listPriceMinor > priceMinor;
  const window = accessLabel(accessDays);

  return (
    <Panel className="group relative flex h-full flex-col overflow-hidden border-white/10 bg-[var(--mk-raised)]/70 transition-all duration-300 hover:border-indigo-500/50 hover:shadow-[0_16px_36px_-8px_rgba(99,102,241,0.22)]" interactive spotlight>
      <span
        aria-hidden="true"
        className="relative block aspect-[37/20] w-full overflow-hidden"
      >
        <span
          className={`absolute right-3.5 top-3.5 z-20 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold capitalize backdrop-blur-md ${
            free
              ? "border border-emerald-500/40 bg-emerald-950/70 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.3)]"
              : "border border-white/15 bg-black/60 text-white/90 shadow-[0_4px_12px_rgba(0,0,0,0.5)]"
          }`}
        >
          {free && <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />}
          {tag}
        </span>
        {/* Drawn from the course's own title rather than pulled from a pool
            of three stock photographs. Four courses used to share a picture,
            and the picture moved when the list was filtered. */}
        <span className="absolute inset-0 transition-transform duration-500 ease-[var(--ease-out-soft)] group-hover:scale-105 motion-reduce:group-hover:scale-100">
          <CourseCover title={title} courseId={course.id} />
        </span>
      </span>

      <div className="flex flex-1 flex-col p-5">
        <Heading className="text-[17px] font-semibold leading-snug">
          <Link
            href={`/courses/${course.id}`}
            className="text-white transition-colors duration-200 group-hover:text-indigo-300"
          >
            {/* Stretches the link over the whole card, so the entire panel is
                clickable while the accessible name stays just the title. The
                cover above is a plain span for the same reason: two links to
                one place is one too many to tab past. */}
            <span className="absolute inset-0" />
            {title}
          </Link>
        </Heading>

        <p className="mt-2 line-clamp-3 text-[14px] leading-relaxed text-[var(--mk-muted)]">
          {paragraph}
        </p>

        <div className="mt-auto pt-5">
          <div className="flex items-end justify-between gap-4 border-t border-white/5 pt-4">
            <p className="text-[12.5px] font-medium text-slate-400">
              {moduleCount} modules
              <span aria-hidden="true" className="mx-1.5 text-white/20">·</span>
              {level}
            </p>

            <div className="shrink-0 text-right">
              {wasMore ? (
                <span className="mr-1.5 text-[12.5px] text-[var(--mk-muted)] line-through">
                  {money(listPriceMinor, currency)}
                </span>
              ) : null}
              <span
                className={
                  free
                    ? "text-[16px] font-bold text-emerald-400"
                    : "text-[16px] font-bold text-white"
                }
              >
                {money(priceMinor, currency)}
              </span>
              <span className="block text-[11.5px] text-[var(--mk-muted)]">
                {/* Not "pay once, keep it" any more — a purchase expires now,
                    and repeating the old claim would promise something the
                    product no longer does. */}
                {free ? "no card needed" : (window ?? "yours to keep")}
              </span>
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}
