"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

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

  return (
    <header className="sticky top-0 z-50 px-4 pt-4 sm:px-6">
      <nav
        className={cn(
          "mx-auto flex max-w-[1200px] items-center gap-4 rounded-2xl px-4 sm:px-5",
          "border transition-[background-color,border-color,padding] duration-300",
          "ease-[var(--ease-out-soft)]",
          scrolled
            ? "border-[var(--mk-line)] bg-[var(--mk-canvas)]/80 py-2.5 backdrop-blur-xl"
            : "border-transparent py-4",
        )}
      >
        <Link
          href="/"
          aria-label="Voice Tutor, home"
          className="rounded-lg transition-opacity hover:opacity-80"
        >
          <Logo />
        </Link>

        <ul className="ml-6 hidden items-center gap-1 lg:flex">
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
                    "rounded-lg px-3 py-2 text-[15px] transition-colors",
                    active
                      ? "text-[var(--mk-text)]"
                      : "text-[var(--mk-muted)] hover:text-[var(--mk-text)]",
                  )}
                >
                  {item.title}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="ml-auto flex items-center gap-2">
          <AccountMenu />

          <button
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

      {open && (
        <div
          id="marketing-mobile-nav"
          className="mx-auto mt-2 max-w-[1200px] rounded-2xl border border-[var(--mk-line)] bg-[var(--mk-raised)] p-2 lg:hidden"
        >
          <ul>
            {visibleMenu.map((item) => (
              <li key={item.id}>
                <Link
                  href={item.path}
                  className="block rounded-xl px-4 py-3 text-[15px] text-[var(--mk-muted)] hover:bg-white/5 hover:text-[var(--mk-text)]"
                >
                  {item.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </header>
  );
}
