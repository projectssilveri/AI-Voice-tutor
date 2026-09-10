import type { Metadata } from "next";
import { Suspense } from "react";

import Contact from "@/components/marketing/Contact";
import Breadcrumb from "@/components/marketing/common/Breadcrumb";

export const metadata: Metadata = {
  title: "Contact",
  description: "Get in touch about courses, access, or anything else.",
};

export default function ContactPage() {
  return (
    <>
      <Breadcrumb
        pageName="Contact"
        description="Questions about a course, your account, or exam attempts? Send them here."
      />
      {/* Contact reads ?subject= so "Contact sales" can arrive pre-filled.
          useSearchParams suspends during prerender, so the boundary is
          required — without it the production build fails outright. */}
      <Suspense fallback={null}>
        <Contact />
      </Suspense>
    </>
  );
}
