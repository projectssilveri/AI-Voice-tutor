import type { Metadata } from "next";

import ReadingProgress from "@/components/marketing/ui/ReadingProgress";
import {
  PageHeader,
  PageSection,
  Placeholder,
} from "@/components/marketing/PageShell";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "How we handle your data.",
};

export default function Page() {
  return (
    <>
      <ReadingProgress />
      <PageHeader
        eyebrow="Legal"
        title="Privacy policy"
        intro="This policy has not been published yet."
      />
      <PageSection title="Not yet published" >
        <Placeholder
          label="Your privacy policy"
          hint="Left empty deliberately, for the same reason as the terms. For reference when drafting: the product stores your name, email, an argon2 password hash, your progress, quiz and exam attempts, assignment answers, and a transcript of every voice session. Payments go through Razorpay and card details never reach our servers."
        />
      </PageSection>
    </>
  );
}
