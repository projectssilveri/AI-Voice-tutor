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
        <div className="relative isolate">
          {/* Ambient colorful glow behind panel */}
          <div className="pointer-events-none absolute -inset-6 -z-10 rounded-3xl bg-gradient-to-r from-indigo-500/20 via-purple-500/20 to-pink-500/20 blur-3xl opacity-80" />

          <Panel className="relative isolate overflow-hidden border-white/15 bg-[var(--mk-canvas)]/80 px-6 py-16 text-center backdrop-blur-2xl shadow-[0_20px_60px_rgba(0,0,0,0.6)] sm:px-12 sm:py-24">
            <GlowBackdrop placement="center" />

            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-4 py-1 text-xs font-semibold uppercase tracking-wider text-indigo-300">
              <span className="size-1.5 rounded-full bg-indigo-400 animate-pulse" />
              Get started in seconds
            </div>

            <h2 className="mx-auto max-w-[620px] text-[clamp(2rem,3.8vw,3rem)] font-bold leading-[1.1] tracking-[-0.03em] text-white">
              Try it on the{" "}
              <span className="bg-gradient-to-r from-indigo-400 via-purple-300 to-pink-400 bg-clip-text text-transparent">
                free course
              </span>{" "}
              first
            </h2>
            <p className="mx-auto mt-4 max-w-[520px] text-lg leading-relaxed text-slate-300">
              JavaScript Foundations is free and needs no credit card. Open a module, let
              the tutor speak, and talk over it. That is the whole experience in two minutes.
            </p>

            <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <PrimaryCta />
              <MarketingButton href="/courses" variant="secondary" size="large">
                Browse the catalogue
              </MarketingButton>
            </div>
          </Panel>
        </div>
      </Reveal>
    </Section>
  );
}
