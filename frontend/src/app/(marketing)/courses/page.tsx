import type { Metadata } from "next";

import CourseGrid from "@/components/marketing/Courses/CourseGrid";
import Breadcrumb from "@/components/marketing/common/Breadcrumb";
import RefundPolicyNote from "@/components/marketing/RefundPolicyNote";
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
      <CourseGrid browsable />
      {/* Same reason as /pricing: every course on this page has a price
          on it, so the refund terms belong where the prices are. */}
      <RefundPolicyNote />
    </>
  );
}
