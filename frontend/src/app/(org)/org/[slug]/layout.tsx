import type { Metadata } from "next";

import { AuthProvider } from "@/context/AuthContext";

export const metadata: Metadata = {
  title: "Training",
};

/**
 * The organization portal shell.
 *
 * Deliberately NOT the dashboard shell: that one carries the marketplace nav,
 * pricing and the platform's own admin section, none of which exists inside a
 * customer's walled garden. An org learner should never see a Buy button.
 *
 * `AuthProvider` is re-declared because this route group sits outside
 * `(dashboard)`, which is where the other one lives. The context reads the same
 * httpOnly cookie either way, so this is a second reader of one session rather
 * than a second session.
 */
export default function OrgLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">{children}</div>
    </AuthProvider>
  );
}
