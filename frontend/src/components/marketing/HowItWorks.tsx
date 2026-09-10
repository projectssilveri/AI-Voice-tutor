import SectionTitle from "@/components/marketing/common/SectionTitle";
import Panel from "@/components/marketing/ui/Panel";
import Section from "@/components/marketing/ui/Section";
import SpotlightGroup from "@/components/marketing/ui/SpotlightGroup";
import Reveal from "@/components/ui/Reveal";

/**
 * Three steps, in the order they happen.
 *
 * The version this replaces was a two-column block with a six-item tick list
 * beside a stock illustration, and the ticks repeated points the feature grid
 * already made. A tick list is not a sequence: it does not tell a first-time
 * reader what actually happens when they press the button.
 *
 * The illustration is gone with it. `about-image.svg` was the template's own
 * artwork, drawn for a generic startup page, and it showed nothing about this
 * product.
 *
 * The id matches the footer's anchor. It was "about" in the template, left
 * over from a section no link pointed at.
 */

const STEPS: { title: string; body: string }[] = [
  {
    title: "Open a module",
    body: "Pick any module in a course you have. There is nothing to configure and no prompt to write. The free course needs no card.",
  },
  {
    title: "It starts teaching",
    body: "A short spoken lecture on that exact topic begins straight away, in the tutor voice you chose. The transcript runs beside it as it speaks.",
  },
  {
    title: "Cut in whenever",
    body: "Say what you did not follow. The lecture stops, you get an answer drawn from that module, and then it carries on from where it stopped.",
  },
];

export default function HowItWorks() {
  return (
    <Section id="how-it-works">
      <SectionTitle
        eyebrow="How it works"
        title="Three steps, and none of them are typing"
        paragraph="A tutor that talks first and stops when you do. Here is the whole of it."
      />

      <SpotlightGroup as="ol" className="grid gap-4 md:grid-cols-3">
        {STEPS.map((step, index) => (
          <Reveal
            key={step.title}
            as="li"
            delay={index * 80}
            className="h-full list-none"
          >
            <Panel className="h-full p-6" spotlight>
              <span
                aria-hidden="true"
                className="mb-5 grid size-9 place-items-center rounded-lg border border-[var(--mk-line)] text-sm font-semibold text-[var(--mk-brand-lit)]"
              >
                {index + 1}
              </span>
              <h3 className="mb-2 text-[17px] font-semibold text-[var(--mk-text)]">
                {step.title}
              </h3>
              <p className="text-[15px] leading-relaxed text-[var(--mk-muted)]">
                {step.body}
              </p>
            </Panel>
          </Reveal>
        ))}
      </SpotlightGroup>
    </Section>
  );
}
