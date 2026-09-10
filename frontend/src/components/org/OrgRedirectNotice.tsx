"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useAuth } from "@/context/AuthContext";
import { getMyOrganizationSlug } from "@/lib/orgPortal";

/**
 * Shown to an organization member who has landed on a marketplace page.
 *
 * The walled garden is enforced server-side — `services/access.py` refuses an
 * org member every public course — but the marketing site was still *selling*
 * to them: six courses with prices, a Pricing link, and a Buy button that
 * leads to a 404. Correctly refused and badly explained is still a bug, and
 * this is the half I had claimed was done and had not built.
 *
 * A banner rather than a redirect. Their employer may genuinely want them to
 * read the public site — an About page, a careers page — and bouncing them out
 * of every marketing URL would be worse than telling them plainly that the
 * catalogue is not theirs to buy from.
 */
export default function OrgRedirectNotice({
  context = "catalogue",
}: {
  /** Tunes the wording; the meaning is the same. */
  context?: "catalogue" | "pricing" | "course";
}) {
  const { user, loading } = useAuth();
  const [slug, setSlug] = useState<string | null>(null);

  const inOrganization = user?.organization_id != null;

  useEffect(() => {
    if (loading || !inOrganization) return;
    let cancelled = false;
    getMyOrganizationSlug()
      .then((found) => {
        if (!cancelled) setSlug(found);
      })
      .catch(() => {
        // The banner still renders; only the link is dropped.
      });
    return () => {
      cancelled = true;
    };
  }, [loading, inOrganization]);

  if (loading || !inOrganization) return null;

  const message =
    context === "pricing"
      ? "These plans are for individual learners. Your training is provided by your organization, so there is nothing here for you to buy."
      : context === "course"
        ? "This is a course from our public catalogue. Your training comes from your organization instead."
        : "These are our public courses. Your own training is provided by your organization and lives in your dashboard.";

  return (
    <div className="container">
      <div className="mb-10 flex flex-wrap items-center justify-between gap-4 rounded-md border border-primary/30 bg-primary/5 p-5">
        <p className="max-w-2xl text-base text-body-color dark:text-body-color-dark">
          {message}
        </p>
        <div className="flex shrink-0 gap-3">
          <Link
            href="/dashboard"
            className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
          >
            My training
          </Link>
          {slug ? (
            <Link
              href={`/org/${slug}`}
              className="rounded-lg border border-primary px-5 py-2.5 text-sm font-semibold text-primary dark:text-brand-400 transition-colors hover:bg-primary hover:text-white"
            >
              My organization
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
