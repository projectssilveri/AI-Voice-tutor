"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  navItems,
  othersItems,
  platformItems,
  superAdminItems,
} from "@/components/dashboard/AppSidebar";
import { useAuth } from "@/context/AuthContext";
import { type CourseRow, listCourses } from "@/lib/authoring";

/**
 * The header search, which until now was scenery.
 *
 * WHAT IT WAS. A TailAdmin `<form>` with no `onSubmit`, an `<input>` with no
 * `value` and no `onChange`, and a ⌘K badge that was a submit button with no
 * handler — so clicking it did a native GET and reloaded the page. ⌘K focused
 * the box and then typing achieved nothing. A control that looks like it works
 * and does not is worse than no control: people try it, conclude the product is
 * broken, and do not try it again. Same shape as the contact form and the
 * newsletter box that silently discarded what was typed into them.
 *
 * WHAT IT SEARCHES.
 *
 *   Pages   — the destinations the sidebar shows THIS person, imported from
 *             the sidebar rather than listed again here. A second copy is how
 *             the two would come to disagree about what a role can reach.
 *   Courses — from `/courses`, which is already role-scoped server-side: a
 *             student gets theirs, an org admin gets their organisation's, a
 *             platform admin gets the catalogue. Nothing is filtered for
 *             appearance here that the API would not also refuse.
 *
 * Hiding a destination is presentation, not authorisation. Every route behind
 * these is gated server-side, so a student who guesses an admin URL still gets
 * a 403 — this only decides what is worth offering.
 */

interface Hit {
  id: string;
  label: string;
  hint: string;
  href: string;
  group: "Pages" | "Courses";
}

const MAX_PER_GROUP = 5;

export default function HeaderSearch() {
  const router = useRouter();
  const { user } = useAuth();

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [courses, setCourses] = useState<CourseRow[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const isAdmin = user?.role === "admin" || user?.role === "super_admin";
  const isSuperAdmin = user?.role === "super_admin";

  // ⌘K / Ctrl+K focuses, Escape closes. The shortcut was already advertised on
  // the badge; now it leads somewhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Close when the click lands outside, or the panel outlives the search.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Fetched once, on the first keystroke rather than on mount: most visits to
  // a dashboard never touch the search, and a request everyone pays for to
  // serve the few who do is the wrong trade.
  useEffect(() => {
    if (!query || courses.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await listCourses();
        if (!cancelled) setCourses(rows);
      } catch {
        // Pages alone still work. An error banner under the tutor would
        // suggest something larger had broken.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [query, courses.length]);

  const destinations = useMemo(() => {
    const items = [...navItems];
    if (isAdmin) items.push(...othersItems, ...platformItems);
    if (isSuperAdmin) items.push(...superAdminItems);
    return items.filter((item) => Boolean(item.path));
  }, [isAdmin, isSuperAdmin]);

  const hits = useMemo<Hit[]>(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];

    const pages: Hit[] = destinations
      .filter((item) => item.name.toLowerCase().includes(needle))
      .slice(0, MAX_PER_GROUP)
      .map((item) => ({
        id: `page:${item.path}`,
        label: item.name,
        hint: item.path ?? "",
        href: item.path ?? "/dashboard",
        group: "Pages",
      }));

    const found: Hit[] = courses
      .filter((course) =>
        `${course.title} ${course.description ?? ""}`
          .toLowerCase()
          .includes(needle),
      )
      .slice(0, MAX_PER_GROUP)
      .map((course) => ({
        id: `course:${course.id}`,
        label: course.title,
        // Staff land on the editor, a learner on the course itself — the same
        // row means different things to different people, so it says which.
        hint: isAdmin ? "Edit this course" : "Open this course",
        href: isAdmin ? `/admin/courses/${course.id}` : `/learn/${course.id}`,
        group: "Courses",
      }));

    return [...pages, ...found];
  }, [query, destinations, courses, isAdmin]);

  useEffect(() => setCursor(0), [query]);

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || hits.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((c) => (c + 1) % hits.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((c) => (c - 1 + hits.length) % hits.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const chosen = hits[cursor];
      if (chosen) {
        setOpen(false);
        setQuery("");
        router.push(chosen.href);
      }
    }
  }

  let lastGroup = "";

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2">
          <svg
            className="fill-gray-500 dark:fill-gray-400"
            width="20"
            height="20"
            viewBox="0 0 20 20"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M3.04175 9.37363C3.04175 5.87693 5.87711 3.04199 9.37508 3.04199C12.8731 3.04199 15.7084 5.87693 15.7084 9.37363C15.7084 12.8703 12.8731 15.7053 9.37508 15.7053C5.87711 15.7053 3.04175 12.8703 3.04175 9.37363ZM9.37508 1.54199C5.04902 1.54199 1.54175 5.04817 1.54175 9.37363C1.54175 13.6991 5.04902 17.2053 9.37508 17.2053C11.2674 17.2053 13.003 16.5344 14.357 15.4176L17.177 18.238C17.4699 18.5309 17.9448 18.5309 18.2377 18.238C18.5306 17.9451 18.5306 17.4703 18.2377 17.1774L15.418 14.3573C16.5365 13.0033 17.2084 11.2669 17.2084 9.37363C17.2084 5.04817 13.7011 1.54199 9.37508 1.54199Z"
            />
          </svg>
        </span>

        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open && hits.length > 0}
          aria-controls="header-search-results"
          aria-label="Search pages and courses"
          autoComplete="off"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search pages and courses"
          className="dark:bg-dark-900 h-11 w-full rounded-lg border border-gray-200 bg-transparent py-2.5 pl-12 pr-14 text-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-800 dark:bg-white/[0.03] dark:text-white/90 dark:placeholder:text-white/30 dark:focus:border-brand-800 xl:w-[430px]"
        />

        {/* `type="button"`: it used to default to submit inside a form, so
            clicking the hint reloaded the page. */}
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => inputRef.current?.focus()}
          className="absolute right-2.5 top-1/2 inline-flex -translate-y-1/2 items-center gap-0.5 rounded-lg border border-gray-200 bg-gray-50 px-[7px] py-[4.5px] text-xs -tracking-[0.2px] text-gray-500 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-400"
        >
          <span> &#8984; </span>
          <span> K </span>
        </button>
      </div>

      {open && query.trim() ? (
        <div
          id="header-search-results"
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-2 max-h-96 overflow-y-auto rounded-xl border border-gray-200 bg-white py-2 shadow-lifted dark:border-gray-800 dark:bg-gray-900"
        >
          {hits.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
              Nothing matches &ldquo;{query.trim()}&rdquo;.
            </p>
          ) : (
            hits.map((hit, index) => {
              const heading = hit.group !== lastGroup ? hit.group : null;
              lastGroup = hit.group;
              return (
                <div key={hit.id}>
                  {heading ? (
                    <p className="px-4 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      {heading}
                    </p>
                  ) : null}
                  <Link
                    href={hit.href}
                    role="option"
                    aria-selected={index === cursor}
                    onMouseEnter={() => setCursor(index)}
                    onClick={() => {
                      setOpen(false);
                      setQuery("");
                    }}
                    className={`flex items-center justify-between gap-3 px-4 py-2.5 text-sm transition ${
                      index === cursor
                        ? "bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400"
                        : "text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.03]"
                    }`}
                  >
                    <span className="min-w-0 truncate font-medium">
                      {hit.label}
                    </span>
                    <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
                      {hit.hint}
                    </span>
                  </Link>
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
