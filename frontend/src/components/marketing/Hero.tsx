import ProductPanel from "@/components/marketing/ProductPanel";
import Container from "@/components/marketing/ui/Container";
import GlowBackdrop from "@/components/marketing/ui/GlowBackdrop";
import MarketingButton from "@/components/marketing/ui/MarketingButton";
import PrimaryCta from "@/components/marketing/ui/PrimaryCta";
import ScrollParallax from "@/components/marketing/ui/ScrollParallax";

/**
 * The home page hero.
 *
 * Three things are different from the version this replaces:
 *
 *   - It is left-aligned. Centred display text is the template default and it
 *     is the harder thing to read: every line starts in a new place, so the
 *     eye hunts for the start of each one.
 *   - The product is under it. The old hero was 682px of words and whitespace
 *     with 180px of padding above, and you could read the entire home page
 *     without seeing what a lesson looks like.
 *   - The two decorative SVGs are gone. About 240 of this file's 292 lines
 *     were overlapping blue circles and a bundle of wavy lines, and they were
 *     the most recognisable thing on the page. What they were recognisable AS
 *     was a free template. One soft glow does the job now.
 *
 * `animate-fade-up` on mount rather than on scroll: the hero is above the
 * fold, so an IntersectionObserver would fire immediately anyway and cost a
 * frame doing it.
 */
export default function Hero() {
  return (
    <section className="relative isolate overflow-hidden pb-16 pt-16 sm:pb-24 sm:pt-24">
      <GlowBackdrop />

      <Container size="wide">
        <div className="animate-fade-up max-w-[820px]">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-[var(--mk-line)] bg-[var(--mk-raised)] px-3 py-1.5 text-[13px] text-[var(--mk-muted)]">
            <span className="size-1.5 rounded-full bg-[var(--mk-brand-lit)]" />
            One free course, no card needed
          </p>

          <h1 className="text-[clamp(2.5rem,6.2vw,4.5rem)] font-semibold leading-[1.03] tracking-[-0.035em] text-[var(--mk-text)]">
            An AI tutor that lectures out loud, and stops the moment you speak
          </h1>

          <p className="mt-6 max-w-[620px] text-lg leading-relaxed text-[var(--mk-muted)] sm:text-xl">
            Every module opens with a short spoken lecture on that exact topic.
            Interrupt mid-sentence to ask a doubt, get an answer grounded in the
            material you are studying, then carry on.
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
            <PrimaryCta />
            <MarketingButton
              href="/how-it-works"
              variant="secondary"
              size="large"
            >
              See how it works
              <span aria-hidden="true">→</span>
            </MarketingButton>
          </div>
        </div>

        {/* Two elements on purpose. `animate-fade-up` writes `transform` on
            mount and the parallax writes it on scroll; on one element the
            second would cancel the first mid-animation. */}
        <div className="animate-fade-up mt-14 sm:mt-20">
          <ScrollParallax>
            <ProductPanel />
          </ScrollParallax>
        </div>
      </Container>
    </section>
  );
}
