"use client";

import { useAuth } from "@/context/AuthContext";

/**
 * Renders its children for everyone EXCEPT an organisation member.
 *
 * The walled garden: an org member's training comes from their organisation,
 * never the public catalogue. `OrgRedirectNotice` already tells them so, but
 * the catalogue itself was still shown and clickable, and opening a public
 * course sent them to "We can't find that course". Wrapping the catalogue, the
 * bundle strip and the buy controls in this means an org member never sees a
 * course they cannot open.
 *
 * Shows the children until we KNOW the viewer is an org member, so the common
 * case (a public visitor) never flickers. An org member sees them vanish once
 * their session loads, which is a moment, not a journey into a 404.
 */
export default function MarketplaceOnly({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  if (user?.organization_id != null) return null;
  return <>{children}</>;
}
