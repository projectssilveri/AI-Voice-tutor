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
    <section className="relative isolate overflow-hidden pb-6 pt-14 sm:pt-20">
      <GlowBackdrop />
      {/* Soft top aura */}
      <div className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 h-72 w-3/4 rounded-full bg-indigo-500/15 blur-[100px]" />

      <Container>
        <nav aria-label="Breadcrumb" className="mb-6">
          <ol className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1 text-[12.5px] font-medium text-[var(--mk-muted)] backdrop-blur-md">
            <li>
              <Link
                href="/"
                className="transition-colors hover:text-white"
              >
                Home
              </Link>
            </li>
            <li aria-hidden="true" className="text-white/25">
              /
            </li>
            <li aria-current="page" className="font-semibold text-indigo-300">
              {pageName}
            </li>
          </ol>
        </nav>

        <h1 className="max-w-[820px] text-[clamp(2.3rem,4.8vw,3.6rem)] font-bold leading-[1.06] tracking-[-0.03em] text-white">
          <span className="bg-gradient-to-r from-white via-slate-100 to-indigo-200 bg-clip-text text-transparent">
            {pageName}
          </span>
        </h1>
        <p className="mt-5 max-w-[640px] text-lg leading-relaxed text-[var(--mk-muted)]">
          {description}
        </p>
      </Container>
    </section>
  );
}
