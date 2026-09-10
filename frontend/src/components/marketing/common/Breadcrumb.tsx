import Link from "next/link";

import Container from "@/components/marketing/ui/Container";
import GlowBackdrop from "@/components/marketing/ui/GlowBackdrop";

/**
 * The page hero for an inner marketing page.
 *
 * The template's version put the trail in a right-hand column opposite the
 * title, which is why it needed a 12-column flex row to hold two things. A
 * trail belongs above the title it leads to; that is the order you read them
 * in. One column now, no grid.
 *
 * Its two decorative SVGs are gone as well — a translucent blue triangle top
 * left and two more top right, on every inner page. `GlowBackdrop` replaces
 * them, and it is the same glow the home page uses, so the pages match.
 */
export default function Breadcrumb({
  pageName,
  description,
}: {
  pageName: string;
  description: string;
}) {
  return (
    <section className="relative isolate overflow-hidden pb-4 pt-14 sm:pt-20">
      <GlowBackdrop />
      <Container>
        <nav aria-label="Breadcrumb" className="mb-6">
          <ol className="flex items-center gap-2 text-[13px] text-[var(--mk-muted)]">
            <li>
              <Link
                href="/"
                className="transition-colors hover:text-[var(--mk-text)]"
              >
                Home
              </Link>
            </li>
            <li aria-hidden="true" className="text-white/20">
              /
            </li>
            <li aria-current="page" className="text-[var(--mk-text)]">
              {pageName}
            </li>
          </ol>
        </nav>

        <h1 className="max-w-[820px] text-[clamp(2.1rem,4.6vw,3.4rem)] font-semibold leading-[1.06] tracking-[-0.03em] text-[var(--mk-text)]">
          {pageName}
        </h1>
        <p className="mt-5 max-w-[640px] text-lg leading-relaxed text-[var(--mk-muted)]">
          {description}
        </p>
      </Container>
    </section>
  );
}
