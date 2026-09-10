import type { Metadata } from "next";
import Link from "next/link";

import Breadcrumb from "@/components/marketing/common/Breadcrumb";
import GlowBackdrop from "@/components/marketing/ui/GlowBackdrop";
import MarketingButton from "@/components/marketing/ui/MarketingButton";
import Panel from "@/components/marketing/ui/Panel";
import PrimaryCta from "@/components/marketing/ui/PrimaryCta";
import { listPublicCourses } from "@/lib/catalogue";
import type { Course } from "@/types/course";
import { counted } from "@/lib/plural";

export const metadata: Metadata = {
  title: "For business",
  description:
    "Voice-led training for teams. A plan for 2 to 50 people, one for larger organisations, and custom training built around what you need.",
};

const TEAM_FEATURES = [
  "Every course in the catalogue, for every member",
  "The voice tutor on every module, interruptible mid-sentence",
  "Quizzes and assignments, marked the moment they are submitted",
  "Certification exam and a verifiable certificate per course",
  "A team admin who can see who has started and who has finished",
  "Unlimited re-reads of every module and PDF",
];

const ENTERPRISE_FEATURES = [
  "Everything in the Team plan",
  "Your own courses loaded in, so the tutor teaches from your material",
  "Onboarding for your admins, and a named contact",
  "Consolidated invoicing and annual terms",
  "Reporting across departments, not just one team",
  "Security and data-handling review before you sign",
];

/**
 * Every one of these is a column on `organizations` or a rule in
 * `services/access.py`, not a sales line. A custom plan promising something the
 * product cannot enforce is a promise somebody keeps by hand, forever.
 */
const CUSTOM_FEATURES = [
  "A seat count agreed with you, not a bracket",
  "A monthly AI tutor budget set on your account",
  "Your own courses, written by your admins or loaded in by us",
  "Training scoped to a department, invisible to the rest of the company",
  "Branches and departments matching how you are actually organised",
  "Your own activity log, and reports you can pull into a spreadsheet",
  "A named contact, and a data-handling review before you sign",
];

function Tick() {
  return (
    <span
      aria-hidden="true"
      className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-[var(--mk-brand-lit)]"
    >
      ✓
    </span>
  );
}

/**
 * For business.
 *
 * Two tiers, split by headcount, because the thing that actually changes at
 * scale is the buying process rather than the product: a team of eight signs
 * up and starts, an organisation of three hundred wants a conversation, an
 * invoice and its own material loaded in. So the small tier gets a button and
 * the large one gets a person.
 *
 * Deliberately no fabricated logos, client names or "trusted by" counts —
 * decision 35 removed invented testimonials from the home page for the same
 * reason. Everything stated here is something the product actually does.
 */
export default async function BusinessPage() {
  let courses: Course[] = [];
  try {
    courses = await listPublicCourses();
  } catch {
    // The page is not about the catalogue; a count that cannot be fetched
    // simply is not shown rather than taking the page down.
  }

  const courseCount = courses.length;

  return (
    <>
      <Breadcrumb
        pageName="Voice Tutor for Business"
        description="Train your team with a tutor that talks, and lets them talk back. Pick the plan that fits your headcount."
      />

      {/* The two plans */}
      <section className="pb-12 pt-16 md:pb-16 md:pt-20">
        <div className="container">
          <div className="mx-auto mb-14 max-w-[620px] text-center">
            <h2 className="mb-4 text-3xl font-semibold text-[var(--mk-text)] sm:text-4xl">
              Two ways to buy
            </h2>
            <p className="text-base text-[var(--mk-muted)]">
              Priced per person, per month. Same product either way. What changes is how you buy it and how much we set up for you.
            </p>
          </div>

          <div className="mx-auto grid max-w-[1200px] gap-8 md:grid-cols-2 lg:grid-cols-3">
            {/* Team */}
            <div className="relative flex flex-col rounded-xl bg-[var(--mk-raised)] p-8 ring-2 ring-[var(--mk-brand)] sm:p-10">
              <span className="absolute right-8 top-8 rounded-full bg-[var(--mk-brand)] px-3 py-1 text-xs font-semibold text-white">
                Most teams
              </span>

              <h3 className="mb-1 text-2xl font-semibold text-[var(--mk-text)]">
                Team
              </h3>
              <p className="mb-6 text-base font-medium text-[var(--mk-brand-lit)]">
                2 to 50 people
              </p>

              <p className="mb-6 text-base text-[var(--mk-muted)]">
                For a team that wants to get going this week. Buy the seats you
                need, add your people, and everyone has the full catalogue the
                same day.
              </p>

              <ul className="mb-8 space-y-3 border-t border-[var(--mk-line)] pt-6">
                {TEAM_FEATURES.map((feature) => (
                  <li
                    key={feature}
                    className="flex gap-3 text-base text-[var(--mk-muted)]"
                  >
                    <Tick />
                    <span>{feature}</span>
                  </li>
                ))}
                {courseCount > 0 ? (
                  <li className="flex gap-3 text-base text-[var(--mk-muted)]">
                    <Tick />
                    <span>{counted(courseCount, "course")} available today</span>
                  </li>
                ) : null}
              </ul>

              <Link
                href="/contact?subject=Team%20plan%20(2%E2%80%9350%20people)"
                className="mt-auto flex w-full items-center justify-center rounded-xl bg-[var(--mk-brand)] px-6 py-4 text-base font-semibold text-white duration-300 hover:bg-[var(--mk-brand)]/80"
              >
                Buy the Team plan
              </Link>
              <p className="mt-3 text-center text-sm text-[var(--mk-muted)]">
                Tell us your seat count and we send the invoice and set the
                team up. No card details on this page.
              </p>
            </div>

            {/* Enterprise */}
            <div className="flex flex-col rounded-xl bg-[var(--mk-raised)] p-8 sm:p-10">
              <h3 className="mb-1 text-2xl font-semibold text-[var(--mk-text)]">
                Enterprise
              </h3>
              <p className="mb-6 text-base font-medium text-[var(--mk-muted)]">
                More than 50 people
              </p>

              <p className="mb-6 text-base text-[var(--mk-muted)]">
                For an organisation training a department or the whole company.
                Priced on headcount and on how much of your own material you
                want the tutor to teach from.
              </p>

              <ul className="mb-8 space-y-3 border-t border-[var(--mk-line)] pt-6">
                {ENTERPRISE_FEATURES.map((feature) => (
                  <li
                    key={feature}
                    className="flex gap-3 text-base text-[var(--mk-muted)]"
                  >
                    <Tick />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <Link
                href="/contact?subject=Enterprise%20plan%20(50%2B%20people)"
                className="mt-auto flex w-full items-center justify-center rounded-xl bg-primary/10 px-6 py-4 text-base font-semibold text-[var(--mk-brand-lit)] duration-300 hover:bg-[var(--mk-brand)] hover:text-white"
              >
                Contact sales
              </Link>
              <p className="mt-3 text-center text-sm text-[var(--mk-muted)]">
                Tell us roughly how many people and what you need covered. We
                reply with a quote.
              </p>
            </div>

            {/* Custom. The tier for a buyer whose question is not "how many of
                us are there" but "what can you change" — every item below is
                a limit the product actually holds, not a promise. */}
            <div className="flex flex-col rounded-xl bg-[var(--mk-raised)] p-8 sm:p-10">
              <h3 className="mb-1 text-2xl font-semibold text-[var(--mk-text)]">
                {/* "Custom" alone said nothing about what was being customised
                    — a reader scanning three tiers could not tell whether it
                    meant a custom price, custom seats, or something else. The
                    thing this tier actually buys is training built for you. */}
                Custom training
              </h3>
              <p className="mb-6 text-base font-medium text-[var(--mk-muted)]">
                Priced around what you need
              </p>

              <p className="mb-6 text-base text-[var(--mk-muted)]">
                For an organisation whose requirements do not fit a bracket. We
                agree the numbers with you and set them on your account, and
                they are enforced rather than assumed.
              </p>

              <ul className="mb-8 space-y-3 border-t border-[var(--mk-line)] pt-6">
                {CUSTOM_FEATURES.map((feature) => (
                  <li
                    key={feature}
                    className="flex gap-3 text-base text-[var(--mk-muted)]"
                  >
                    <Tick />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <Link
                href="/contact?subject=Custom%20training"
                className="mt-auto flex w-full items-center justify-center rounded-xl bg-primary/10 px-6 py-4 text-base font-semibold text-[var(--mk-brand-lit)] duration-300 hover:bg-[var(--mk-brand)] hover:text-white"
              >
                Talk to us about custom training
              </Link>
              <p className="mt-3 text-center text-sm text-[var(--mk-muted)]">
                Tell us the shape of your organisation and what you want the
                tutor to teach from. We come back with a price.
              </p>
            </div>
          </div>

          <p className="mx-auto mt-10 max-w-[720px] text-center text-sm text-[var(--mk-muted)]">
            Fewer than two people?{" "}
            <Link href="/pricing" className="text-[var(--mk-brand-lit)] hover:underline">
              Individual pricing
            </Link>{" "}
            covers single courses and personal subscriptions.
          </p>
        </div>
      </section>

      {/* Why it works for a team, specifically */}
      <section className="bg-[var(--mk-inset)] py-16 md:py-20">
        <div className="container">
          <div className="mx-auto mb-12 max-w-[620px] text-center">
            <h2 className="mb-4 text-3xl font-semibold text-[var(--mk-text)] sm:text-4xl">
              Why teams finish this
            </h2>
            <p className="text-base text-[var(--mk-muted)]">
              Recorded video courses get bought and not watched. This is a
              tutor that speaks, and stops the moment someone has a question.
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            {[
              {
                icon: "🎙️",
                title: "It teaches, it does not wait",
                body: "Open a module and the tutor starts the lecture. Nobody has to know what to ask first, which is usually the hard part.",
              },
              {
                icon: "✋",
                title: "Interrupt it mid-sentence",
                body: "Talk over it and it stops in under half a second, answers the question from that module's material, then carries on. Like putting your hand up.",
              },
              {
                icon: "📊",
                title: "You can see who is actually learning",
                body: "Minutes with the tutor, modules finished, quiz scores and exam results, per person. Including who has never opened it.",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="rounded-xl bg-[var(--mk-raised)] p-8"
              >
                <span aria-hidden="true" className="mb-4 block text-3xl">
                  {item.icon}
                </span>
                <h3 className="mb-3 text-xl font-semibold text-[var(--mk-text)]">
                  {item.title}
                </h3>
                <p className="text-base text-[var(--mk-muted)]">
                  {item.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Questions a buyer actually asks */}
      <section className="py-16 md:py-20">
        <div className="container">
          <div className="mx-auto max-w-[760px]">
            <h2 className="mb-10 text-center text-3xl font-semibold text-[var(--mk-text)] sm:text-4xl">
              Before you ask
            </h2>

            <dl className="space-y-8">
              {[
                {
                  q: "What counts as a seat?",
                  a: "One person, one login. Seats are not shared. Progress, quiz scores and certificates belong to one person, which is what makes the reporting worth reading.",
                },
                {
                  q: "Can we add people later?",
                  a: "Yes. Tell us and we add them; the change is billed from the month it happens. Going past 50 moves you onto the Enterprise plan.",
                },
                {
                  q: "Can the tutor teach our own material?",
                  a: "On the Enterprise plan, yes. We load your course text and PDFs in, and the tutor teaches strictly from them. It does not wander outside the module it was given.",
                },
                {
                  q: "Do the certificates mean anything outside the company?",
                  a: "Every certificate carries an ID that anyone can check on our site without an account, so a certificate someone shows you can be verified rather than taken on trust.",
                },
                {
                  q: "How do we pay?",
                  a: "By invoice. Card payment through Razorpay is available for individual purchases; team and enterprise agreements are invoiced.",
                },
              ].map((item) => (
                <div
                  key={item.q}
                  className="border-b border-[var(--mk-line)] pb-8 last:border-0"
                >
                  <dt className="mb-2 text-lg font-semibold text-[var(--mk-text)]">
                    {item.q}
                  </dt>
                  <dd className="text-base text-[var(--mk-muted)]">
                    {item.a}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="pb-20">
        <div className="container">
          {/* A hairline panel, not a brand-blue block.
              The block version needed its own set of colour rules to live on
              top of it, and they had drifted: the body copy was white/80,
              which measures 3.68:1 on that blue, and the "Start free" button
              had been flipped to a DARK fill by the palette conversion while
              its hover stayed white — so it inverted the moment you touched
              it. The panel is the same one the home page closes with, so
              there is nothing bespoke left to keep in step. */}
          <Panel className="relative isolate overflow-hidden px-8 py-14 text-center md:px-12 md:py-16">
            <GlowBackdrop placement="center" />
            <h2 className="mb-3 text-[clamp(1.6rem,3vw,2.2rem)] font-semibold tracking-[-0.02em] text-[var(--mk-text)]">
              Try it before you buy anything
            </h2>
            <p className="mx-auto mb-8 max-w-[560px] text-base leading-relaxed text-[var(--mk-muted)]">
              Make a free account, open a module and interrupt the tutor. It
              takes about two minutes and tells you more than this page can.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              {/* Was a hardcoded /signup link, which invited a signed-in
                  reader to make a second account. */}
              <PrimaryCta />
              <MarketingButton
                href="/contact?subject=Team%20plan%20(2%E2%80%9350%20people)"
                variant="secondary"
                size="large"
              >
                Talk to us
              </MarketingButton>
            </div>
          </Panel>
        </div>
      </section>
    </>
  );
}
