import GlowBackdrop from "@/components/marketing/ui/GlowBackdrop";
import MarketingButton from "@/components/marketing/ui/MarketingButton";
import Panel from "@/components/marketing/ui/Panel";
import PrimaryCta from "@/components/marketing/ui/PrimaryCta";
import Section from "@/components/marketing/ui/Section";
import Reveal from "@/components/ui/Reveal";

/**
 * The last thing on the page.
 *
 * Someone who has scrolled this far has read the whole pitch and the nearest
 * call to action is now a full screen behind them, in a header that scrolled
 * away. This is the button for them.
 *
 * The glow sits inside the panel rather than behind the section, so it reads
 * as one lit object at the end of a long dark page instead of a second wash
 * competing with the hero's.
 */
export default function ClosingCta() {
  return (
    <Section size="tight">
      <Reveal>
        <Panel className="relative isolate overflow-hidden px-6 py-14 text-center sm:px-12 sm:py-20">
          <GlowBackdrop placement="center" />

          <h2 className="mx-auto max-w-[620px] text-[clamp(1.8rem,3.4vw,2.6rem)] font-semibold leading-[1.1] tracking-[-0.03em] text-[var(--mk-text)]">
            Try it on the free course first
          </h2>
          <p className="mx-auto mt-4 max-w-[520px] text-lg leading-relaxed text-[var(--mk-muted)]">
            JavaScript Foundations is free and needs no card. Open a module, let
            the tutor start, and interrupt it. That is the whole product in
            about two minutes.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <PrimaryCta />
            <MarketingButton href="/courses" variant="secondary" size="large">
              Browse the catalogue
            </MarketingButton>
          </div>
        </Panel>
      </Reveal>
    </Section>
  );
}
