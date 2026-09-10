import type { Metadata } from "next";
import Link from "next/link";

import ReadingProgress from "@/components/marketing/ui/ReadingProgress";
import {
  PageHeader,
  PageSection,
  Placeholder,
} from "@/components/marketing/PageShell";

export const metadata: Metadata = {
  title: "About us",
  description:
    "Why we built a tutor that lectures out loud and stops the moment you speak.",
};

/**
 * About us.
 *
 * Everything stated here about how the product behaves is true and verified —
 * the half-second interruption is a measured figure, not a marketing round
 * number. Anything only the business can answer (who runs it, where it is
 * registered, when it started) is left as a visible placeholder rather than
 * invented.
 */
export default function AboutPage() {
  return (
    <>
      <ReadingProgress />
      <PageHeader
        eyebrow="About us"
        title="Most learning platforms hand you a video. We wanted something that talks back."
        intro="A recorded lecture cannot tell when it has lost you. You rewind it, or you go and look somewhere else, or you give up. We built the thing that a good tutor does instead: it explains, and it stops the moment you have a question."
      />

      <PageSection title="What we built">
        <p>
          Every module opens with a short spoken lecture on that exact topic.
          The tutor starts on its own. There is no empty chat box waiting for
          you to think of the right question first.
        </p>
        <p>
          When you speak, it stops. Not at the end of the sentence, not after a
          polite pause: it stops mid-word, answers what you asked, and then
          picks the lecture back up. We measured that at{" "}
          <strong className="text-[var(--mk-text)]">
            0.42 seconds
          </strong>{" "}
          from the moment a student starts talking, which is roughly the pause
          you would leave before interrupting a person.
        </p>
        <p>
          The tutor only teaches from the module you are on. Ask it something
          from three modules ahead and it will say so and bring you back. That is deliberate. A tutor willing to answer anything would get some of it wrong, and sound exactly as certain either way.
        </p>
      </PageSection>

      <PageSection title="What we decided not to do" tinted>
        <p>
          <strong className="text-[var(--mk-text)]">
            Quizzes and assignments are not marked by an AI.
          </strong>{" "}
          They are marked by matching your answer against the answers the author
          accepted. A mark you might want to appeal has to be reproducible, and
          the same model asked twice can disagree with itself. Matching is
          instant and costs nothing to run. What matters more is that it gives
          the same answer every time.
        </p>
        <p>
          <strong className="text-[var(--mk-text)]">
            Reading is never rationed.
          </strong>{" "}
          Modules, handouts and transcripts can be opened as often as you like.
          Only the certification exam is capped, at three attempts, and an admin
          can grant more.
        </p>
        <p>
          <strong className="text-[var(--mk-text)]">
            Certificates can be checked.
          </strong>{" "}
          Each one carries a unique ID, so anyone you send it to can confirm it
          is real rather than taking a PDF at face value.
        </p>
      </PageSection>

      <PageSection title="Who we are">
        <Placeholder
          label="The company, the team, and how this started"
          hint="Who runs it, where it is based, when it began, and anything else you want a visitor to know. Nothing here has been written for you. Invented company history on a public page is a claim your business would be making."
        />
      </PageSection>

      <PageSection tinted>
        <div className="flex flex-wrap gap-4">
          <Link
            href="/courses"
            className="inline-block rounded-xl bg-[var(--mk-brand)] px-8 py-4 text-base font-semibold text-white duration-300 hover:bg-[var(--mk-brand)]/80"
          >
            Browse the courses
          </Link>
          <Link
            href="/contact"
            className="inline-block rounded-xl bg-white/[0.06] px-8 py-4 text-base font-semibold text-[var(--mk-text)] duration-300 hover:bg-white/10"
          >
            Get in touch
          </Link>
        </div>
      </PageSection>
    </>
  );
}
