"use client";

import { useEffect, useState } from "react";

/**
 * Sticky in-page navigation for the course landing page.
 *
 * Anchor links, not routes: everything stays on one page so a prospective
 * student never loses their place, and the URL still deep-links to a section.
 *
 * The active tab follows the scroll position rather than only the last click,
 * so scrolling by hand keeps the indicator honest.
 */
export default function CourseTabs({
  sections,
}: {
  sections: { id: string; label: string }[];
}) {
  const [active, setActive] = useState(sections[0]?.id ?? "");

  useEffect(() => {
    // rootMargin pulls the trigger line to roughly a third down the viewport:
    // a section counts as "current" once it is properly in view, not the
    // instant its first pixel appears under the sticky bar.
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-96px 0px -60% 0px", threshold: 0 },
    );

    for (const section of sections) {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [sections]);

  return (
    <nav
      aria-label="Course sections"
      /* WHITE, ON A SITE THAT IS BLACK. `bg-white/95` over the dark canvas
         rendered as a dull grey slab with `--mk-muted` grey text on it — a
         colour meant to sit on the near-black canvas, and close to unreadable
         on light. It is the only surface on the marketing site that was not
         built from the `--mk-*` tokens.

         `top` parks it under the floating header instead of at 0, where it
         sat BEHIND the header pill (z-40 against the header's z-50) and
         showed through the 16px gap above it. */
      className="sticky top-[var(--mk-header-h)] z-40 border-y border-[var(--mk-line)] bg-[var(--mk-canvas)]/85 backdrop-blur-xl"
    >
      <div className="container">
        <ul className="-mb-px flex gap-8 overflow-x-auto">
          {sections.map((section) => {
            const current = active === section.id;
            return (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  aria-current={current ? "true" : undefined}
                  className={`inline-block whitespace-nowrap border-b-2 px-1 py-4 text-base font-medium transition ${
                    current
                      ? "border-[var(--mk-brand)] text-[var(--mk-brand-lit)]"
                      : "border-transparent text-[var(--mk-muted)] hover:text-[var(--mk-text)]"
                  }`}
                >
                  {section.label}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
