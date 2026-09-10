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
      className="sticky top-0 z-40 border-b border-[var(--mk-line)] bg-white/95 backdrop-blur"
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
 ?"border-[var(--mk-brand)] text-[var(--mk-brand-lit)]"
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
