"use client";

import { useParams, usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { useAuth } from "@/context/AuthContext";

/**
 * Sends a signed-out visitor to their organisation's own sign-in page.
 *
 * Only the portal's home page did this. Every other page drew itself for
 * nobody: `/org/{slug}/admin` showed the single word "Unauthorized", and
 * `/org/{slug}/admin/audit` drew the whole organisation menu around an empty
 * log. Once, here, in the layout, so a page added later cannot forget.
 *
 * The login page itself passes through, or it would redirect to itself.
 * Presentation only: every request behind these pages is refused by the API
 * without a session whatever this renders.
 */
export default function OrgSignInGuard({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();
  const { slug } = useParams<{ slug: string }>();
  const pathname = usePathname();
  const router = useRouter();

  const onLoginPage = pathname === `/org/${slug}/login`;
  const mustSignIn = !onLoginPage && !loading && user === null;

  useEffect(() => {
    if (mustSignIn) {
      router.replace(`/org/${slug}/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [mustSignIn, router, slug, pathname]);

  if (onLoginPage) return <>{children}</>;
  // Nothing drawn while the session is checked or the redirect is on its way,
  // rather than a page that is about to be taken away.
  if (loading || user === null) return null;
  return <>{children}</>;
}
