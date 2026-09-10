"use client";

import type React from "react";
import { createContext, useState, useContext, useEffect } from "react";

type Theme = "light" | "dark";

type ThemeContextType = {
  theme: Theme;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

/**
 * Resolve the theme the same way the blocking script in `app/layout.tsx` does.
 *
 * The two MUST agree. That script runs before first paint and sets the class;
 * this runs after hydration and owns the state. If they disagreed, the page
 * would paint in one theme and then visibly flip to the other.
 */
function resolveTheme(): Theme {
  const saved = localStorage.getItem("theme");
  if (saved === "light" || saved === "dark") return saved;
  // No stored choice means the person has never used the toggle here — so the
  // right default is the one their operating system already asked for. This
  // was previously hard-coded to "light", which handed someone running a dark
  // desktop a white screen and no explanation.
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [theme, setTheme] = useState<Theme>("light");
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    setTheme(resolveTheme());
    setIsInitialized(true);
  }, []);

  // Follow the system while the person has expressed no preference of their
  // own. Switching the OS to dark at night should carry the app with it.
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => {
      if (localStorage.getItem("theme")) return; // an explicit choice wins
      setTheme(event.matches ? "dark" : "light");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  // Only the class is synced here. Writing localStorage on every render would
  // record a "choice" the person never made, and the system-preference
  // listener above would then never fire again.
  useEffect(() => {
    if (!isInitialized) return;
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme, isInitialized]);

  const toggleTheme = () => {
    setTheme((previous) => {
      const next = previous === "light" ? "dark" : "light";
      localStorage.setItem("theme", next); // this is the explicit choice
      return next;
    });
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
};
