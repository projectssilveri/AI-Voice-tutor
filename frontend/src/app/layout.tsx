import type { Metadata } from "next";
import { Outfit } from "next/font/google";

import { AuthProvider } from "@/context/AuthContext";
import { ThemeProvider } from "@/context/ThemeContext";
import "./globals.css";
import StackedTableLabels from "@/components/ui/StackedTableLabels";

// Self-hosted via next/font — the templates pulled fonts from a Google CDN at
// runtime, which costs a round trip and leaks a request per visitor.
const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Voice Tutor LMS",
    template: "%s | Voice Tutor LMS",
  },
  description:
    "A voice-first learning platform where an AI tutor delivers spoken " +
    "micro-lectures you can interrupt with a question at any point.",
  // Declared here, pointing into /public, rather than as `app/icon.svg`.
  // next.config.ts routes every .svg import through @svgr/webpack so TailAdmin
  // can import icons as React components — which also intercepts Next's
  // file-based metadata loader, so `app/icon.svg` came back as a component and
  // Next rejected it as "not a valid image file". That failure is not confined
  // to the icon: the broken metadata route 500s every page in the app. A file
  // in /public is served statically and never reaches webpack.
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/favicon.svg",
  },
};

/**
 * Sets the theme class before the browser paints anything.
 *
 * ThemeProvider applies the class from a useEffect, which by definition runs
 * after hydration — so a person on a dark desktop got a full white page first
 * and a flip to dark a moment later, on every single navigation. There is no
 * React-side fix for that; the work has to happen in a blocking script in the
 * document head. Kept to one expression, wrapped in try/catch because
 * localStorage throws outright in some privacy modes and a theme preference is
 * not worth taking the page down for.
 *
 * The logic here MUST match `resolveTheme` in context/ThemeContext.tsx.
 */
const THEME_SCRIPT = `try{var t=localStorage.getItem("theme");if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.classList.toggle("dark",t==="dark")}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className={`${outfit.variable} dark:bg-gray-900`}>
        <ThemeProvider>
          {/* Gives every wide table's cells their column name, which is
              what lets them stack into cards on a phone. At the root rather
              than in the dashboard shell because the refund table on /terms
              needs it too. Renders nothing, and does nothing on a page with
              no such table. */}
          <StackedTableLabels />
          <AuthProvider>{children}</AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
