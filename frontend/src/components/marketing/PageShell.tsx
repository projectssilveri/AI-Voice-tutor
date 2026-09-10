import Container from "@/components/marketing/ui/Container";
import Eyebrow from "@/components/marketing/ui/Eyebrow";
import GlowBackdrop from "@/components/marketing/ui/GlowBackdrop";

import type { ReactNode } from "react";

/**
 * Heading block shared by the standalone marketing pages.
 *
 * Keeps About, Business, Careers, How it works, Terms and Privacy visually
 * consistent without each one re-deriving the hero spacing.
 *
 * The reading column is centred by `Container size="narrow"` now rather than
 * by an `mx-auto` inside a wider container. That `mx-auto` was load-bearing
 * and easy to lose: without it the 768px column sat against the left edge of a
 * 1280px container, so on a 1440px screen these pages had 569px of empty space
 * down the right and read as though the layout had failed. Putting the measure
 * in the container removes the chance of dropping it.
 */
export function PageHeader({
  eyebrow,
  title,
  intro,
}: {
  eyebrow?: string;
  title: string;
  intro?: string;
}) {
  return (
    <section className="relative isolate overflow-hidden pb-6 pt-14 sm:pt-20">
      <GlowBackdrop />
      <Container size="narrow">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <h1 className="text-[clamp(2.1rem,4.6vw,3.4rem)] font-semibold leading-[1.06] tracking-[-0.03em] text-[var(--mk-text)]">
          {title}
        </h1>
        {intro ? (
          <p className="mt-5 text-lg leading-relaxed text-[var(--mk-muted)]">
            {intro}
          </p>
        ) : null}
      </Container>
    </section>
  );
}

export function PageSection({
  title,
  children,
  tinted = false,
}: {
  title?: string;
  children: ReactNode;
  /**
   * A slightly lighter band, for separating a run of sections. The old
   * version swapped between two background colours per theme; on the dark
   * site a hairline rule and a 1.5% white wash do the same job without a
   * second colour in the palette.
   */
  tinted?: boolean;
}) {
  return (
    <section
      className={
        tinted
          ? "border-y border-[var(--mk-line)] bg-white/[0.015] py-12 md:py-16"
          : "py-12 md:py-16"
      }
    >
      <Container size="narrow">
        {title ? (
          <h2 className="mb-4 text-[clamp(1.5rem,2.6vw,2rem)] font-semibold tracking-[-0.02em] text-[var(--mk-text)]">
            {title}
          </h2>
        ) : null}
        <div className="space-y-4 text-[16.5px] leading-relaxed text-[var(--mk-muted)]">
          {children}
        </div>
      </Container>
    </section>
  );
}

/**
 * An explicit "this is not written yet" block.
 *
 * Deliberately looks unfinished. A placeholder that reads like finished copy
 * is worse than an empty page: a visitor cannot tell the difference, and the
 * team stops noticing it needs writing. Same reasoning that removed the
 * invented testimonials from the home page — anything on a public page is read
 * as a claim the business is making.
 */
export function Placeholder({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="rounded-xl border-2 border-dashed border-white/15 bg-white/[0.02] p-6">
      <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--mk-muted)]">
        Content to be added
      </p>
      <p className="text-base font-medium text-[var(--mk-text)]">{label}</p>
      {hint ? (
        <p className="mt-1 text-[15px] text-[var(--mk-muted)]">{hint}</p>
      ) : null}
    </div>
  );
}
