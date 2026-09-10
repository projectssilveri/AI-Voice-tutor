import type { Metadata } from "next";

import VerifyForm from "@/components/marketing/verify/VerifyForm";
import Breadcrumb from "@/components/marketing/common/Breadcrumb";

export const metadata: Metadata = {
  title: "Verify a certificate",
  description:
    "Paste a certificate ID to check who it belongs to and what they passed. No account needed.",
};

/**
 * A server component, so this page can carry its own title.
 *
 * It used to be `"use client"` in one piece, which made `metadata` impossible
 * to export and left the page showing the site-wide fallback title. The form
 * is the only part that needs to be interactive, so only the form is a client
 * component now.
 */
export default function VerifyLandingPage() {
  return (
    <>
      <Breadcrumb
        pageName="Verify a certificate"
        description="Every certificate we issue carries an ID. Paste it here to check who it belongs to and what they passed."
      />
      <VerifyForm />
    </>
  );
}
