import Panel from "@/components/marketing/ui/Panel";
import Reveal from "@/components/ui/Reveal";
import { Feature } from "@/types/feature";

/**
 * One feature card.
 *
 * On a dark canvas the old bare-text card had nothing holding it together, so
 * six of them read as one wall of paragraphs. `Panel` gives each its own
 * edges, which is what lets the eye count them.
 *
 * The icon tile shrank from 70px to 40px. At 70 it was the loudest thing in
 * the card and the heading came second, which is backwards.
 */
export default function SingleFeature({
  feature,
  index = 0,
}: {
  feature: Feature;
  index?: number;
}) {
  const { icon, title, paragraph } = feature;

  return (
    // Staggered across the row, capped at 240ms. A grid where the last card
    // lands a second after the first reads as a slow page rather than a
    // considered one.
    <Reveal delay={Math.min(index, 3) * 80} className="h-full">
      <Panel className="group/feature h-full p-6 transition-all duration-300 hover:border-indigo-500/40 hover:shadow-[0_12px_32px_-8px_rgba(99,102,241,0.2)]" interactive spotlight>
        <div className="mb-5 grid size-11 place-items-center rounded-xl border border-indigo-500/30 bg-gradient-to-br from-indigo-500/20 to-purple-500/10 text-indigo-300 shadow-[0_0_15px_rgba(99,102,241,0.15)] transition-all duration-300 ease-[var(--ease-spring)] group-hover/feature:scale-110 group-hover/feature:border-indigo-400/50 group-hover/feature:shadow-[0_0_20px_rgba(99,102,241,0.35)] motion-reduce:group-hover/feature:scale-100">
          {icon}
        </div>
        <h3 className="mb-2 text-[17px] font-semibold text-white transition-colors group-hover/feature:text-indigo-200">
          {title}
        </h3>
        <p className="text-[14.5px] leading-relaxed text-[var(--mk-muted)]">
          {paragraph}
        </p>
      </Panel>
    </Reveal>
  );
}
