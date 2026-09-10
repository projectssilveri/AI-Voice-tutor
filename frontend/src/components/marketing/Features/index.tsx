import SectionTitle from "@/components/marketing/common/SectionTitle";
import Section from "@/components/marketing/ui/Section";
import SpotlightGroup from "@/components/marketing/ui/SpotlightGroup";

import SingleFeature from "./SingleFeature";
import featuresData from "./featuresData";

/**
 * The feature grid. One of these on the site now, not two.
 *
 * See the note at the top of `featuresData.tsx` for what was merged and why.
 */
export default function Features() {
  return (
    <Section id="features">
      <SectionTitle
        eyebrow="What you get"
        title="A lecture you can talk over"
        paragraph="Voice is the primary way you learn here. This is not a chatbot bolted onto a course library."
      />

      <SpotlightGroup className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {featuresData.map((feature, index) => (
          <SingleFeature key={feature.id} feature={feature} index={index} />
        ))}
      </SpotlightGroup>
    </Section>
  );
}
