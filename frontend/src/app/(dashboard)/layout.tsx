"use client";

import React from "react";

import RequireAuth from "@/components/auth/RequireAuth";
import AppHeader from "@/components/dashboard/AppHeader";
import AppSidebar from "@/components/dashboard/AppSidebar";
import Backdrop from "@/components/dashboard/Backdrop";
import PageTransition from "@/components/ui/PageTransition";
import { CartProvider } from "@/context/CartContext";
import { SidebarProvider, useSidebar } from "@/context/SidebarContext";

/**
 * Shell for every signed-in screen — student and admin alike.
 *
 * Both roles share this layout; what differs is which routes exist under it
 * and which ones the backend will serve. Rendering an admin link here is not
 * authorisation: `require_role("admin")` on the FastAPI side is.
 */
function DashboardShell({ children }: { children: React.ReactNode }) {
  const { isExpanded, isHovered, isMobileOpen } = useSidebar();

  const mainContentMargin = isMobileOpen
    ? "ml-0"
    : isExpanded || isHovered
      ? "lg:ml-[290px]"
      : "lg:ml-[90px]";

  return (
    <div className="min-h-screen xl:flex">
      <AppSidebar />
      <Backdrop />
      <div
        /* margin-left only. `transition-all` also animated background-color, so
           a theme switch eased this panel into its new colour at a different
           rate from the sidebar beside it. */
        // `min-w-0` is load-bearing, not tidying. A flex item defaults to
        // `min-width: auto`, which means it refuses to shrink below the width
        // of its content — so a table with `min-w-[68rem]` pushed this whole
        // column past the viewport and the PAGE scrolled sideways, instead of
        // the table scrolling inside its own `overflow-x-auto` wrapper.
        //
        // Measured before the fix: 1265px viewport, 1428px document, every
        // wide-table screen affected (users, reports, audit, messages,
        // contact, customer training).
        className={`min-w-0 flex-1 transition-[margin] duration-300 ease-in-out ${mainContentMargin}`}
      >
        <AppHeader />
        <div className="p-4 mx-auto max-w-(--breakpoint-2xl) md:p-6">
          <PageTransition>{children}</PageTransition>
        </div>
      </div>
    </div>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <CartProvider>
        <DashboardShell>
          <RequireAuth>{children}</RequireAuth>
        </DashboardShell>
      </CartProvider>
    </SidebarProvider>
  );
}
