import Container from "@/components/marketing/ui/Container";
import MarketingButton from "@/components/marketing/ui/MarketingButton";
import PrimaryCta from "@/components/marketing/ui/PrimaryCta";
import ScrollParallax from "@/components/marketing/ui/ScrollParallax";
import ProductPanel from "@/components/marketing/ProductPanel";

/**
 * The home page hero — premium redesign.
 *
 * Visual upgrades over the previous version:
 *   - Three floating gradient orbs replace the flat GlowBackdrop
 *   - "AI tutor" in the headline gets a gradient text treatment
 *   - The badge is a glassmorphism pill with an animated pulse dot
 *   - The primary CTA has a shimmer animation overlay
 *   - A quick-stats row anchors the bottom of the text block
 */
export default function Hero() {
  return (
    <section className="relative isolate overflow-hidden pb-16 pt-16 sm:pb-24 sm:pt-24">
      {/* Floating gradient orbs — decoration only */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        {/* Indigo orb — top left */}
        <div className="animate-float absolute -left-32 -top-32 size-[600px] rounded-full opacity-25 blur-[100px]"
          style={{ background: "radial-gradient(circle, #6366f1, #4338ca)" }} />
        {/* Violet orb — top right */}
        <div className="animate-float-slow absolute -right-40 top-10 size-[500px] rounded-full opacity-20 blur-[120px]"
          style={{ background: "radial-gradient(circle, #8b5cf6, #6d28d9)" }} />
        {/* Cyan orb — bottom center */}
        <div className="animate-float-med absolute bottom-0 left-1/2 size-[400px] -translate-x-1/2 rounded-full opacity-15 blur-[100px]"
          style={{ background: "radial-gradient(circle, #06b6d4, #0891b2)" }} />
        {/* Subtle mesh grid */}
        <div className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: "linear-gradient(rgb(255 255 255 / 20%) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 20%) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }} />
      </div>

      <Container size="wide">
        <div className="animate-fade-up max-w-[820px]">
          {/* Glassmorphism badge */}
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[13px] text-[var(--mk-muted)] backdrop-blur-md">
            <span className="relative flex size-2">
              <span className="animate-ping absolute inline-flex size-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
            </span>
            One free course, no card needed
          </p>

          {/* Gradient headline */}
          <h1 className="text-[clamp(2.5rem,6.2vw,4.5rem)] font-semibold leading-[1.03] tracking-[-0.035em] text-[var(--mk-text)]">
            An{" "}
            <span
              style={{
                background: "linear-gradient(135deg, #a5b4fc, #c084fc, #67e8f9)",
                backgroundClip: "text",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              AI tutor
            </span>{" "}
            that lectures out loud, and stops the moment you speak
          </h1>

          <p className="mt-6 max-w-[620px] text-lg leading-relaxed text-[var(--mk-muted)] sm:text-xl">
            Every module opens with a short spoken lecture on that exact topic.
            Interrupt mid-sentence to ask a doubt, get an answer grounded in the
            material you are studying, then carry on.
          </p>

          {/* CTA buttons */}
          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
            {/* Shimmer-enhanced primary CTA wrapper */}
            <span className="relative inline-flex overflow-hidden rounded-xl">
              <PrimaryCta />
              <span
                aria-hidden="true"
                className="animate-btn-shimmer pointer-events-none absolute inset-0 w-1/3 bg-gradient-to-r from-transparent via-white/20 to-transparent"
              />
            </span>
            <MarketingButton href="/how-it-works" variant="secondary" size="large">
              See how it works
              <span aria-hidden="true">→</span>
            </MarketingButton>
          </div>

          {/* Quick stats row */}
          <div className="mt-10 flex flex-wrap items-center gap-x-7 gap-y-2">
            {[
              { value: "11", label: "courses" },
              { value: "40", label: "modules" },
              { value: "90 min", label: "AI tutor per session" },
              { value: "Free", label: "to start" },
            ].map((stat, i) => (
              <div key={i} className="flex items-baseline gap-1.5">
                <span className="text-[15px] font-semibold text-[var(--mk-text)]">{stat.value}</span>
                <span className="text-[13px] text-[var(--mk-muted)]">{stat.label}</span>
                {i < 3 && (
                  <span aria-hidden="true" className="ml-2 text-white/15">·</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Two elements on purpose — see previous version's note */}
        <div className="animate-fade-up mt-14 sm:mt-20">
          <ScrollParallax>
            {/* Glow ring behind the product panel */}
            <div className="relative">
              <div
                aria-hidden="true"
                className="absolute -inset-px rounded-2xl opacity-40 blur-xl"
                style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6, #06b6d4)" }}
              />
              <div className="relative rounded-2xl border border-white/10 overflow-hidden shadow-2xl"
                style={{ boxShadow: "0 0 60px rgb(99 102 241 / 15%), 0 40px 80px rgb(0 0 0 / 40%)" }}>
                <ProductPanel />
              </div>
            </div>
          </ScrollParallax>
        </div>
      </Container>
    </section>
  );
}
