import Link from "next/link";

import Container from "@/components/marketing/ui/Container";
import Logo from "@/components/marketing/ui/Logo";
import MarketingButton from "@/components/marketing/ui/MarketingButton";

/**
 * Site footer: a business call to action, then the sitemap.
 *
 * Every link goes somewhere that exists. The template shipped Blog, Pricing,
 * About, TOS, Privacy and Refund links to pages we do not have, four social
 * icons pointing at "#", and a "Template by UIdeck" credit — all removed. The
 * MIT notice stays with the template's own LICENSE in the repo, which is what
 * the licence requires; a visitor-facing credit line is not it.
 *
 * The old footer painted itself `#1c1d1f` to stand apart from a white page.
 * The whole site is dark now, so separation comes from a hairline rule and the
 * canvas is left alone. One less colour that belongs to no palette.
 */

const COLUMNS: { heading: string; links: { href: string; label: string }[] }[] =
  [
    {
      heading: "Learn",
      links: [
        { href: "/courses", label: "Courses" },
        { href: "/bundles", label: "Full-stack bundles" },
        { href: "/pricing", label: "Pricing" },
        { href: "/how-it-works", label: "How it works" },
        // Dropped by accident when this footer was rewritten. The anchor
        // still exists: `Features` renders `<Section id="features">`.
        { href: "/#features", label: "What you get" },
      ],
    },
    {
      heading: "Company",
      links: [
        { href: "/about", label: "About us" },
        { href: "/business", label: "For business" },
        { href: "/careers", label: "Careers" },
        { href: "/contact", label: "Contact us" },
      ],
    },
    {
      heading: "Trust and legal",
      links: [
        { href: "/verify", label: "Verify a certificate" },
        // Both pages exist and state plainly that they are not written yet,
        // rather than carrying sample legal text a visitor might rely on.
        { href: "/terms", label: "Terms and conditions" },
        { href: "/privacy", label: "Privacy policy" },
      ],
    },
  ];

export default function Footer() {
  return (
    <footer className="relative mt-auto border-t border-[var(--mk-line)]">
      {/* Business band. The one thing a footer on a learning platform is
          reliably used for that is not navigation. */}
      <Container className="flex flex-wrap items-center justify-between gap-6 border-b border-[var(--mk-line)] py-10">
        <div className="max-w-xl">
          {/* Was "Training a team, not just yourself?" — the not-just-X-but-Y
              shape, which is the tell the copy pass removed everywhere else. */}
          <p className="text-lg font-semibold text-[var(--mk-text)]">
            Training a whole team?
          </p>
          <p className="mt-1 text-[15px] text-[var(--mk-muted)]">
            Voice Tutor for Business covers 2 to 50 people on one plan, and
            loads your own material in above that.
          </p>
        </div>
        <MarketingButton href="/business" variant="secondary">
          For business
        </MarketingButton>
      </Container>

      <Container className="py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2 lg:max-w-[320px]">
            <Logo className="mb-4" />
            <p className="text-sm leading-relaxed text-[var(--mk-muted)]">
              A learning platform where the teaching happens out loud, and you
              can interrupt the lecture whenever something stops making sense.
            </p>
          </div>

          {COLUMNS.map((column) => (
            <div key={column.heading}>
              <h2 className="mb-4 text-sm font-semibold text-[var(--mk-text)]">
                {column.heading}
              </h2>
              <ul className="space-y-3">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-[var(--mk-muted)] transition-colors hover:text-[var(--mk-text)]"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--mk-line)] pt-7">
          <p className="text-sm text-[var(--mk-muted)]">
            &copy; {new Date().getFullYear()} Voice Tutor LMS
          </p>
          <p className="text-sm text-[var(--mk-muted)]">
            Built for people who learn by listening.
          </p>
        </div>
      </Container>
    </footer>
  );
}
