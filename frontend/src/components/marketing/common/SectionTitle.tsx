import Eyebrow from "@/components/marketing/ui/Eyebrow";
import Reveal from "@/components/ui/Reveal";
import { cn } from "@/lib/cn";

/**
 * The heading block above a section.
 *
 * The old version took `width`, `center` and `mb` as strings and applied them
 * as inline styles, so every caller invented its own measure and its own gap
 * and no two sections matched. The props are a closed set now: what a section
 * heading needs to decide is whether it is centred, not how many pixels sit
 * under it.
 *
 * The decorative gradient bar is gone, replaced by an optional `eyebrow`. A
 * 48px dash says nothing; a word tells you which part of the page you are in,
 * which is worth more on a long scroll.
 *
 * `wow fadeInUp` in the template was inert markup — WOW.js is not a dependency
 * and never was. `Reveal` is what actually animates it.
 */
export default function SectionTitle({
  eyebrow,
  title,
  paragraph,
  align = "left",
  className,
}: {
  eyebrow?: string;
  title: string;
  paragraph?: string;
  align?: "left" | "center";
  className?: string;
}) {
  return (
    <Reveal
      className={cn(
        "mb-12 md:mb-16",
        align === "center" && "mx-auto text-center",
        className,
      )}
    >
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h2
        className={cn(
          "max-w-[720px] text-[clamp(1.9rem,3.6vw,2.9rem)] font-semibold",
          "leading-[1.1] tracking-[-0.03em] text-[var(--mk-text)]",
          // The max-width has to be re-centred, or a centred section renders
          // a left-aligned heading inside a centred block.
          align === "center" && "mx-auto",
        )}
      >
        {title}
      </h2>
      {paragraph && (
        <p
          className={cn(
            "mt-4 max-w-[620px] text-lg leading-relaxed text-[var(--mk-muted)]",
            align === "center" && "mx-auto",
          )}
        >
          {paragraph}
        </p>
      )}
    </Reveal>
  );
}
