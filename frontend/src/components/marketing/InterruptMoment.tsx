import Eyebrow from "@/components/marketing/ui/Eyebrow";
import Panel from "@/components/marketing/ui/Panel";
import Section from "@/components/marketing/ui/Section";
import Reveal from "@/components/ui/Reveal";

/**
 * The one thing this product does that a course library does not.
 *
 * It used to be one bullet among twelve, which is the surest way to bury the
 * only claim worth making. It gets a section.
 *
 * The visual is a transcript with the interruption in it, because the claim is
 * about timing and a list of adjectives cannot show timing. The "cut off"
 * badge is the real one from `TranscriptFeed`, not an invention.
 *
 * The half-second figure is what the product measures: barge-in cancels the
 * tutor's audio on the next chunk boundary. If that changes, change it here.
 *
 * The dash at the end of the first turn is the one em dash on this site that
 * stays. It marks speech cut off mid-word, which is what an em dash is for and
 * is the entire subject of the section. It is not a dash standing in for a
 * comma in prose, which is the habit the copy pass removed everywhere else.
 */

const TURNS: { who: "Tutor" | "You"; text: string; cut?: boolean }[] = [
  {
    who: "Tutor",
    text: "…so a promise is an object that stands in for a value you do not have yet. When the work finishes, the promise settles, and anything waiting on it—",
    cut: true,
  },
  { who: "You", text: "hold on. settles?" },
  {
    who: "Tutor",
    text: "Settles means it has finished one way or the other: it either has the value, or it has an error explaining why it never will. Both count as settled.",
  },
];

export default function InterruptMoment() {
  return (
    <Section>
      <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <Reveal>
          <Eyebrow>The difference</Eyebrow>
          <h2 className="text-[clamp(1.9rem,3.6vw,2.9rem)] font-semibold leading-[1.1] tracking-[-0.03em] text-[var(--mk-text)]">
            Stop it mid-word. It will not lose its place.
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-[var(--mk-muted)]">
            A chat box waits for you to work out what to ask. A recorded lecture
            carries on whether you followed it or not. This does neither. It
            teaches, you cut in the second something stops making sense, and it
            answers from the module you are on before picking the lecture back
            up.
          </p>
          <p className="mt-4 text-lg leading-relaxed text-[var(--mk-muted)]">
            You do not press anything. You just talk, the way you would if the
            person teaching you were in the room.
          </p>
        </Reveal>

        <Reveal delay={120}>
          <Panel className="p-4 sm:p-5">
            <div className="space-y-3">
              {TURNS.map((turn, index) => {
                const isTutor = turn.who === "Tutor";
                return (
                  <div
                    key={index}
                    className={`rounded-lg border-l-2 p-3.5 text-[14px] leading-relaxed ${
                      isTutor
                        ? "border-[var(--mk-brand)] bg-white/[0.03]"
                        : "border-success-500 bg-success-500/10"
                    }`}
                  >
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--mk-muted)]">
                        {turn.who}
                      </span>
                      {turn.cut && (
                        <span className="rounded-full bg-error-500/20 px-2 py-0.5 text-[10px] font-medium text-error-400">
                          cut off
                        </span>
                      )}
                    </div>
                    <p className="text-[var(--mk-text)]/90">{turn.text}</p>
                  </div>
                );
              })}
            </div>
            <p className="mt-4 border-t border-[var(--mk-line)] pt-3.5 text-[13px] text-[var(--mk-muted)]">
              The lecture stopped about half a second after the word
              &ldquo;hold&rdquo;.
            </p>
          </Panel>
        </Reveal>
      </div>
    </Section>
  );
}
