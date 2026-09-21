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
    <footer className="relative mt-auto border-t border-white/10 bg-[var(--mk-canvas)]">
      {/* Subtle top edge gradient highlight */}
      <div className="pointer-events-none absolute -top-px left-1/2 -translate-x-1/2 h-px w-2/3 bg-gradient-to-r from-transparent via-indigo-500/40 to-transparent" />

      {/* Business band. The one thing a footer on a learning platform is
          reliably used for that is not navigation. */}
      <Container className="py-10">
        <div className="flex flex-wrap items-center justify-between gap-6 rounded-2xl border border-white/10 bg-white/[0.02] p-6 sm:p-8 backdrop-blur-md shadow-[0_8px_32px_rgba(0,0,0,0.2)]">
          <div className="max-w-xl">
            <p className="text-lg font-semibold text-white">
              Training a whole team?
            </p>
            <p className="mt-1 text-[14.5px] text-[var(--mk-muted)]">
              Voice Tutor for Business covers 2 to 50 people on one plan, and
              loads your own curriculum and knowledge base.
            </p>
          </div>
          <MarketingButton href="/business" variant="secondary">
            For business
          </MarketingButton>
        </div>
      </Container>

      <Container className="py-12">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2 lg:max-w-[320px]">
            {/* The colour is stated here rather than left to the Logo,
                which now inherits. This column's own text is muted, and
                the wordmark should not be. */}
            <Logo className="mb-4 text-[var(--mk-text)]" />
            <p className="text-sm leading-relaxed text-[var(--mk-muted)]">
              A learning platform where the teaching happens out loud, and you
              can interrupt the lecture whenever something stops making sense.
            </p>
          </div>

          {COLUMNS.map((column) => (
            <div key={column.heading}>
              <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-slate-300">
                {column.heading}
              </h2>
              <ul className="space-y-2.5">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-[var(--mk-muted)] transition-colors duration-150 hover:text-white"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-white/5 pt-7">
          {/* The real trading names, not the product's working title.
              The year stays generated rather than typed: it renders exactly
              what it says on the tin today, and nobody has to remember to
              change a legal line every January. */}
          <p className="text-xs text-[var(--mk-muted)]">
            &copy; {new Date().getFullYear()} AI Voice Tutor Platform Inc -
            Silveri Consulting Services Pvt Ltd. All rights reserved.
          </p>
          <p className="text-xs text-[var(--mk-muted)]">
            Built for people who learn by listening.
          </p>
        </div>
      </Container>
    </footer>
  );
}
