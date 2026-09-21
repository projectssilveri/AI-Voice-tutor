"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import CartLink from "@/components/cart/CartLink";
import AccountMenu from "@/components/marketing/Header/AccountMenu";
import Logo from "@/components/marketing/ui/Logo";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/cn";

import menuData from "./menuData";

/**
 * The marketing nav: a floating pill that condenses on scroll.
 *
 * Replaces the template's full-width bar and the `-mx-4 flex flex-wrap` grid
 * inside it. Two things changed beyond looks:
 *
 *   - There is no theme toggle here any more. The public site is dark only
 *     (see `data-surface="marketing"` in globals.css). The dashboard keeps its
 *     own toggle, `components/common/ThemeToggleButton.tsx`, which is a
 *     different component and untouched.
 *   - The old markup carried state and handlers for dropdown submenus that
 *     nothing on this site has ever used. Removed rather than left dead.
 *
 * Kept from the original because both were real fixes: the scroll listener is
 * removed on unmount, and the mobile menu closes on navigation.
 *
 * THE MOBILE MENU IS A DRAWER, not a panel in the header. It used to be an
 * ordinary block rendered after the nav, inside a `sticky` header — so opening
 * it made the header taller and pushed the entire page down, and closing it
 * snapped back. On a phone that reads as the site breaking rather than as a
 * menu. It is now fixed, slides in over the content, and the page underneath
 * does not move.
 */
export default function Header() {
  const { user } = useAuth();
  const pathname = usePathname();

  // An organization member is not a customer of the marketplace: their
  // employer bought the training. Pricing and Bundles lead to plans they
  // cannot buy, so both are dropped from their nav. Presentation only —
  // `services/access.py` refuses them those courses regardless.
  const visibleMenu =
    user?.organization_id != null
      ? menuData.filter(
          (item) => item.path !== "/pricing" && item.path !== "/bundles",
        )
      : menuData;

  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close the mobile menu when the route changes. Without this, tapping a link
  // navigated but left the panel open on top of the new page.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // WHAT MAKES IT A DRAWER RATHER THAN A DIV THAT LOOKS LIKE ONE.
  //
  //   * Escape closes it, because it covers the page.
  //   * The page behind it does not scroll. Without this, dragging over the
  //     backdrop scrolls the article underneath and the drawer appears frozen
  //     to a scrolling page — the single most common mobile-drawer bug.
  //   * Focus moves into it on open and back to the button on close, and Tab
  //     stays inside while it is open. A menu covering the screen that the
  //     keyboard is not in is a menu a keyboard user cannot leave.
  useEffect(() => {
    if (!open) return;

    // Captured now, not read in the cleanup. By the time cleanup runs React
    // may have re-rendered and pointed the ref elsewhere, and focus would go
    // to whatever happened to be there.
    const opener = toggleRef.current;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusable = () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled])',
        ) ?? [],
      );

    focusable()[0]?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
      // Back to the control that opened it, so the keyboard does not land at
      // the top of the document.
      opener?.focus();
    };
  }, [open]);

  return (
    <header className="sticky top-0 z-50 px-4 pt-4 sm:px-6">
      <nav
        className={cn(
          "mx-auto flex max-w-[1200px] items-center gap-4 rounded-2xl px-4 sm:px-5",
          "border transition-all duration-300 ease-[var(--ease-out-soft)]",
          scrolled
            ? "border-white/15 bg-[var(--mk-canvas)]/80 py-2.5 backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
            : "border-white/5 bg-white/[0.02] py-3.5 backdrop-blur-md",
        )}
      >
        <Link
          href="/"
          aria-label="Voice Tutor, home"
          className="rounded-lg transition-transform hover:scale-105"
        >
          <Logo />
        </Link>

        <ul className="ml-6 hidden items-center gap-1.5 lg:flex">
          {visibleMenu.map((item) => {
            const active =
              item.path === "/"
                ? pathname === "/"
                : pathname.startsWith(item.path);
            return (
              <li key={item.id}>
                <Link
                  href={item.path}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-xl px-3.5 py-1.5 text-[14.5px] font-medium transition-all duration-200",
                    active
                      ? "border border-white/10 bg-white/[0.08] text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)]"
                      : "text-slate-400 hover:bg-white/[0.04] hover:text-white",
                  )}
                >
                  {item.title}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="ml-auto flex items-center gap-2">
          {/* `CartLink` hides itself from an organization member, for the
              same reason Pricing and Bundles are dropped from the nav above. */}
          <CartLink />
          <AccountMenu />

          <button
            ref={toggleRef}
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="marketing-mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            className="grid size-10 place-items-center rounded-lg border border-[var(--mk-line)] text-[var(--mk-text)] lg:hidden"
          >
            {/* Two bars that cross into an X. A separate close icon would
                swap glyphs on a button whose label already says which it is. */}
            <span aria-hidden="true" className="relative block h-3 w-4">
              <span
                className={cn(
                  "absolute inset-x-0 h-0.5 rounded-full bg-current transition-transform duration-200",
                  open ? "top-1/2 rotate-45" : "top-0",
                )}
              />
              <span
                className={cn(
                  "absolute inset-x-0 h-0.5 rounded-full bg-current transition-transform duration-200",
                  open ? "top-1/2 -rotate-45" : "bottom-0",
                )}
              />
            </span>
          </button>
        </div>
      </nav>

      {/* THE BACKDROP. Tapping outside a drawer to close it is the gesture
          people reach for first, and it also dims the page enough that the
          drawer reads as being on top rather than part of the layout.

          ALWAYS RENDERED, never `{open && ...}`: an element that does not
          exist cannot animate out, and unmounting it made closing instant
          while opening slid. `invisible` plus `pointer-events-none` keeps it
          out of the way of taps and of the accessibility tree when shut. */}
      <div
        onClick={() => setOpen(false)}
        aria-hidden="true"
        className={cn(
          "fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden",
          "transition-opacity duration-300 ease-[var(--ease-out-soft)]",
          "motion-reduce:transition-none",
          open ? "opacity-100" : "pointer-events-none invisible opacity-0",
        )}
      />

      <div
        ref={panelRef}
        id="marketing-mobile-nav"
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        className={cn(
          // FIXED, so the page underneath keeps its place. This is the whole
          // fix: the old panel was in normal flow and pushed the content down.
          "fixed inset-y-0 right-0 z-50 w-[min(20rem,85vw)] lg:hidden",
          "flex flex-col border-l border-[var(--mk-line)] bg-[var(--mk-raised)]",
          "shadow-[-16px_0_48px_rgba(0,0,0,0.5)]",
          // `dvh`, not `vh`: on a phone `vh` is the tallest the viewport ever
          // gets, so the bottom of the drawer sits under the browser chrome.
          "h-dvh overflow-y-auto overscroll-contain",
          "transition-transform duration-300 ease-[var(--ease-out-soft)]",
          "motion-reduce:transition-none",
          open ? "translate-x-0" : "pointer-events-none translate-x-full",
        )}
        // Hidden from assistive technology and from tabbing when shut, which
        // `translate` alone does not do — an off-screen menu is still readable
        // by a screen reader and still lands focus when you Tab into it.
        //
        // A real boolean. Passing an empty string is the pre-React-19 spelling
        // and React 19 now reads it as FALSE, so the menu stayed reachable
        // while shut and the console said so on every render.
        inert={!open}
      >
        <div className="flex items-center justify-between border-b border-[var(--mk-line)] px-5 py-4">
          <Logo />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="grid size-9 place-items-center rounded-lg border border-[var(--mk-line)] text-[var(--mk-muted)] transition-colors hover:text-[var(--mk-text)]"
          >
            <svg
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
            >
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <ul className="flex-1 p-3">
          {visibleMenu.map((item) => {
            const active =
              item.path === "/"
                ? pathname === "/"
                : pathname.startsWith(item.path);
            return (
              <li key={item.id}>
                <Link
                  href={item.path}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "block rounded-xl px-4 py-3 text-[15px] transition-colors",
                    active
                      ? "bg-white/[0.08] font-medium text-[var(--mk-text)]"
                      : "text-[var(--mk-muted)] hover:bg-white/5 hover:text-[var(--mk-text)]",
                  )}
                >
                  {item.title}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </header>
  );
}
