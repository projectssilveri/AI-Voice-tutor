"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { buttonClasses } from "@/components/marketing/ui/MarketingButton";
import Avatar from "@/components/ui/Avatar";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/cn";

/**
 * The right-hand side of the marketing header.
 *
 * Signed out it is Sign in / Start free. Signed in it becomes the account menu
 * with name, Dashboard, Profile and Log out, so someone who is already a
 * student is not invited to sign up again on every marketing page.
 *
 * `loading` matters here: the session is fetched client-side, so rendering the
 * signed-out state while it is still unknown makes the buttons flip a moment
 * after every page load.
 */
export default function AccountMenu() {
  const { user, loading, photoVersion, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const wrapper = useRef<HTMLDivElement>(null);

  // Close on an outside click or Escape — a menu you cannot dismiss without
  // choosing something is a trap.
  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (loading) {
    // Same footprint as the buttons it replaces, so the header does not jump.
    return <div className="hidden h-11 w-44 sm:block" aria-hidden="true" />;
  }

  if (!user) {
    return (
      <>
        <Link
          href="/signin"
          className="hidden rounded-lg px-3 py-2 text-[15px] text-[var(--mk-muted)] transition-colors hover:text-[var(--mk-text)] sm:block"
        >
          Sign in
        </Link>
        <Link href="/signup" className={buttonClasses()}>
          Start free
        </Link>
      </>
    );
  }

  // THE WHOLE NAME. This cut at the first space, so "Super Admin" read
  // "Super" and "Priya Sharma" read "Priya". The `truncate` on the span
  // below already handles a name too long for the space, so the split was
  // solving the same problem a second time and losing half the name to do
  // it.
  const displayName = user.name?.trim() || user.email || "Account";

  return (
    <div ref={wrapper} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-xl border border-[var(--mk-line)] py-1.5 pl-1.5 pr-3 text-[15px] text-[var(--mk-text)] transition-colors hover:border-[var(--mk-line-lift)] hover:bg-white/5"
      >
        {/* This was the only square avatar on the site, and the only one
            the other five were not copied from. It keeps its shape; the rest
            now share it. The colour is the person's own rather than the brand,
            so the same face is the same colour here and in the dashboard. */}
        <Avatar
          userId={user.id}
          name={user.name || user.email}
          size="sm"
          version={photoVersion}
          hasPhoto={user.has_photo}
        />
        <span className="hidden max-w-[11rem] truncate sm:block" title={displayName}>
          {displayName}
        </span>
        <span
          aria-hidden="true"
          className={cn(
            "text-[var(--mk-muted)] transition-transform duration-200",
            open && "rotate-180",
          )}
        >
          ▾
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-xl border border-[var(--mk-line)] bg-[var(--mk-raised)] shadow-[0_24px_48px_-12px_rgb(0_0_0/60%)]"
        >
          <div className="border-b border-[var(--mk-line)] px-4 py-3">
            <p className="truncate text-sm font-semibold text-[var(--mk-text)]">
              {user.name}
            </p>
            <p className="truncate text-xs text-[var(--mk-muted)]">
              {user.email}
            </p>
          </div>

          <Link
            href="/dashboard"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-4 py-3 text-sm text-[var(--mk-muted)] transition-colors hover:bg-white/5 hover:text-[var(--mk-text)]"
          >
            Dashboard
          </Link>
          <Link
            href="/profile"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-4 py-3 text-sm text-[var(--mk-muted)] transition-colors hover:bg-white/5 hover:text-[var(--mk-text)]"
          >
            Profile
          </Link>

          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              setOpen(false);
              await signOut();
              // Back to the public home page, and refresh so any
              // server-rendered marketing page re-reads the signed-out state.
              router.push("/");
              router.refresh();
            }}
            className="block w-full border-t border-[var(--mk-line)] px-4 py-3 text-left text-sm text-[var(--mk-muted)] transition-colors hover:bg-white/5 hover:text-[var(--mk-text)]"
          >
            Log out
          </button>
        </div>
      ) : null}
    </div>
  );
}
