import Link from "next/link";

/**
 * Replaces the newsletter box that used to sit beside the contact form.
 *
 * That box had a "Subscribe" button with no handler and no backend behind it —
 * it collected an email and threw it away, under a promise of future updates.
 * There is no mailing list to join, so rather than fake one, this panel
 * answers the questions someone actually has at the moment they are writing in.
 */
export default function WhatHappensNext() {
  return (
    <div className="relative z-10 rounded-xl bg-[var(--mk-raised)] p-8 sm:p-11 lg:p-8 xl:p-11">
      <h3 className="mb-4 text-2xl font-semibold leading-tight text-[var(--mk-text)]">
        What happens next
      </h3>
      <p className="mb-8 border-b border-[var(--mk-line)] border-opacity-25 pb-8 text-base leading-relaxed text-[var(--mk-muted)]">
        Your message goes straight to the team running the platform. We reply by
        email to the address you give, so it is worth checking it is right.
      </p>

      <dl className="mb-8 space-y-5 text-base">
        <div>
          <dt className="font-semibold text-[var(--mk-text)]">
            Already have an account?
          </dt>
          <dd className="text-[var(--mk-muted)]">
            Most things are on your dashboard already: your progress, quiz results and certificate once you{" "}
            <Link href="/signin" className="text-[var(--mk-brand-lit)] hover:underline">
              sign in
            </Link>
            .
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-[var(--mk-text)]">
            Out of certification attempts?
          </dt>
          <dd className="text-[var(--mk-muted)]">
            Say which exam and why in your message. An admin can grant extra
            attempts.
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-[var(--mk-text)]">
            Something went wrong in a lesson?
          </dt>
          <dd className="text-[var(--mk-muted)]">
            Tell us the course and module. Sessions keep a transcript, so we can
            look at what actually happened.
          </dd>
        </div>
      </dl>

      <p className="text-sm leading-relaxed text-[var(--mk-muted)]">
        We only use what you send here to answer you.
      </p>
    </div>
  );
}
