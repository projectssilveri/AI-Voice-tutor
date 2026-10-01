"use client";

/**
 * Session state for the signed-in user.
 *
 * The session itself lives in an httpOnly cookie the backend owns; this only
 * caches who that cookie belongs to so the UI does not refetch on every render.
 * `refresh()` re-reads it after login, registration, or sign-out.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { type AuthUser, fetchSession, logout as apiLogout } from "@/lib/auth";

interface AuthContextValue {
  user: AuthUser | null;
  /** True until the first session check completes. */
  loading: boolean;
  refresh: () => Promise<AuthUser | null>;
  signOut: () => Promise<void>;
  /**
   * Bumped whenever the signed-in person changes their own photo.
   *
   * The photo endpoint sets `max-age=300`, which is right for a table of fifty
   * faces and wrong for the one you just replaced. Every avatar that draws THIS
   * person passes this as its cache key, so a change lands in the header, on
   * the account card and in the upload box at the same moment. It used to be a
   * counter inside the upload box alone, so removing a photo cleared it there
   * and left it in the header for the next five minutes.
   */
  photoVersion: number;
  /** Call after an upload or a removal. */
  photoChanged: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [photoVersion, setPhotoVersion] = useState(0);

  const refresh = useCallback(async () => {
    const next = await fetchSession();
    setUser(next);
    setLoading(false);
    return next;
  }, []);

  // The session carries `has_photo`, so it is read again after an upload or
  // a removal. Otherwise the header would keep skipping a photo that now
  // exists, or keep asking for one that is gone.
  const photoChanged = useCallback(() => {
    setPhotoVersion((n) => n + 1);
    void refresh().catch(() => {
      // The old session stays; the next page load corrects it.
    });
  }, [refresh]);

  const signOut = useCallback(async () => {
    // `apiLogout` is a bare fetch, so it REJECTS when the backend is
    // unreachable. Unguarded, that rejection propagated out of every caller —
    // the header dropdown awaits this inside an async handler with no catch —
    // so a sign-out during a blip did nothing at all: no navigation, no
    // message, an unhandled rejection in the console, and the user left
    // looking at a page that still says they are signed in.
    try {
      await apiLogout();
    } catch {
      // Nothing useful to do about it here. The session cookie is httpOnly, so
      // the browser cannot clear it; the next session check will reveal the
      // truth either way.
    }
    // Cleared regardless, so the UI is never stuck. If the server never got
    // the request the cookie survives, and the next `refresh()` restores the
    // session — which is the honest outcome rather than a UI that pretends.
    setUser(null);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ user, loading, refresh, signOut, photoVersion, photoChanged }),
    [user, loading, refresh, signOut, photoVersion, photoChanged],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
