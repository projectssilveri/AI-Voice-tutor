import type { Metadata } from "next";

import BundleStrip from "@/components/marketing/Bundles/BundleStrip";
import CourseGrid from "@/components/marketing/Courses/CourseGrid";
import Breadcrumb from "@/components/marketing/common/Breadcrumb";
import RefundPolicyNote from "@/components/marketing/RefundPolicyNote";
import MarketplaceOnly from "@/components/org/MarketplaceOnly";
import OrgRedirectNotice from "@/components/org/OrgRedirectNotice";

export const metadata: Metadata = {
  title: "Courses",
  description: "Courses you can learn by voice, one module at a time.",
};

export default function CoursesPage() {
  return (
    <>
      <Breadcrumb
        pageName="Courses"
        description="Each course is split into modules. Open any module and the tutor starts teaching it out loud."
      />
      <OrgRedirectNotice context="catalogue" />
      {/* Hidden from an organisation member: their training is not here, and a
          public course they click only leads to "We can't find that course". */}
      <MarketplaceOnly>
        <CourseGrid browsable />
      {/* Somebody buying courses one at a time is the exact person a bundle is
          for, and this row is the only thing on the site that tells them so.
          It was written for this page and imported by nothing — the same
          half-finished split that left bundle prices on /pricing. */}
      <BundleStrip />
      {/* Same reason as /pricing: every course on this page has a price
          on it, so the refund terms belong where the prices are. */}
        <RefundPolicyNote />
      </MarketplaceOnly>
    </>
  );
}
