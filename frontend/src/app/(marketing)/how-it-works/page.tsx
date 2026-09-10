import type { Metadata } from "next";

import { PageHeader, PageSection } from "@/components/marketing/PageShell";
import MarketingButton from "@/components/marketing/ui/MarketingButton";
import PrimaryCta from "@/components/marketing/ui/PrimaryCta";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "What happens when you open a module: a spoken lecture you can interrupt, grounded in that module's material.",
};

const STEPS = [
  {
    n: "1",
    title: "Open a module and press start",
    body: "No setup, no prompt to write, no configuration. The tutor begins a short spoken lecture on that module about two seconds later.",
  },
  {
    n: "2",
    title: "Interrupt whenever you like",
    body: "Just talk. There is no button to press and no pause to wait for. The lecture stops within about half a second (0.42 seconds, measured) and the tutor answers what you asked.",
  },
  {
    n: "3",
    title: "It answers from this module only",
    body: "Answers come from the material you are studying. Ask about something several modules ahead and it will say so and bring you back, rather than guessing.",
  },
  {
    n: "4",
    title: "Read along, and read back",
    body: "A transcript of both sides runs beside the audio, in step with the voice. It is saved, so you can re-read the whole lesson afterwards.",
  },
  {
    n: "5",
    title: "Practise, then certify",
    body: "Each module has a quiz you can retake as often as you like, and assignments marked the moment you submit. The certification exam at the end is capped at three attempts.",
  },
];

/**
 * How it works.
 *
 * Every claim here is checked against the running product rather than written
 * as marketing: the interruption figure is measured, and the module-scoping is
 * what the tutor's system instruction actually says.
 */
export default function HowItWorksPage() {
  return (
    <>
      <PageHeader
        eyebrow="How it works"
        title="What actually happens when you open a module"
        intro="No setup, no configuration, nothing to write. You press start and the lesson begins. Talk over it whenever something stops making sense."
      />

      <PageSection>
        <ol className="space-y-8">
          {STEPS.map((step) => (
            <li key={step.n} className="flex gap-5">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--mk-brand)] text-lg font-semibold text-white">
                {step.n}
              </span>
              <span>
                <span className="mb-1 block text-lg font-semibold text-[var(--mk-text)]">
                  {step.title}
                </span>
                <span className="block text-base leading-relaxed text-[var(--mk-muted)]">
                  {step.body}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </PageSection>

      <PageSection title="What you need" tinted>
        <p>
          A browser and a microphone. Nothing to install. The first time you
          start a session your browser will ask permission to use the microphone. The tutor cannot hear you until you allow it.
        </p>
        <p>
          Headphones help but are not required: the microphone uses echo
          cancellation, so the tutor does not hear itself.
        </p>
      </PageSection>

      <PageSection>
        <div className="flex flex-wrap gap-3">
          {/* Was a hardcoded "Create an account" link to /signup, shown to
              everybody including people already signed in. `PrimaryCta` reads
              the session and sends them to their dashboard instead.

              The second button also carried `bg-white/[0.06]`, a black wash
              that is invisible on this canvas. */}
          <PrimaryCta />
          <MarketingButton href="/courses" variant="secondary" size="large">
            Browse the courses
          </MarketingButton>
        </div>
      </PageSection>
    </>
  );
}
