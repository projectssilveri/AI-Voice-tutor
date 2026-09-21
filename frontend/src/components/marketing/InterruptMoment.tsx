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
    text: "…so a promise is an object that stands in for a value you do not have yet. When the work finishes, the promise settles, and anything waiting on it…",
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
            Stop it mid-word.{" "}
            <span className="bg-gradient-to-r from-indigo-400 via-violet-300 to-purple-400 bg-clip-text text-transparent">
              It will not lose its place.
            </span>
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
          <div className="relative isolate">
            {/* Ambient background glow */}
            <div className="pointer-events-none absolute -inset-4 -z-10 rounded-3xl bg-gradient-to-tr from-indigo-500/15 via-purple-500/10 to-transparent blur-2xl" />

            <Panel className="border-white/10 bg-[var(--mk-raised)]/80 p-5 sm:p-6 shadow-[0_16px_40px_rgba(0,0,0,0.5)]">
              {/* Header bar indicating live voice status */}
              <div className="mb-4 flex items-center justify-between border-b border-white/5 pb-3">
                <div className="flex items-center gap-2.5">
                  <span className="relative flex size-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" />
                  </span>
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                    Live Audio Barge-in
                  </span>
                </div>
                {/* Visualizer bars */}
                <div className="flex items-center gap-1">
                  <span className="h-3 w-0.5 animate-[pulse_1s_ease-in-out_infinite] rounded-full bg-indigo-400" />
                  <span className="h-5 w-0.5 animate-[pulse_0.7s_ease-in-out_infinite_0.1s] rounded-full bg-indigo-400" />
                  <span className="h-2 w-0.5 animate-[pulse_1.2s_ease-in-out_infinite_0.2s] rounded-full bg-indigo-400" />
                  <span className="h-4 w-0.5 animate-[pulse_0.9s_ease-in-out_infinite_0.15s] rounded-full bg-indigo-400" />
                  <span className="h-2.5 w-0.5 animate-[pulse_1.1s_ease-in-out_infinite_0.3s] rounded-full bg-indigo-400" />
                </div>
              </div>

              <div className="space-y-3.5">
                {TURNS.map((turn, index) => {
                  const isTutor = turn.who === "Tutor";
                  return (
                    <div
                      key={index}
                      className={`relative rounded-xl border p-4 text-[14px] leading-relaxed transition-all ${
                        isTutor
                          ? "border-indigo-500/20 bg-indigo-950/20 shadow-[inset_0_1px_0_0_rgba(99,102,241,0.15)]"
                          : "border-emerald-500/30 bg-emerald-950/20 shadow-[0_0_20px_rgba(16,185,129,0.08)]"
                      }`}
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className={`grid size-6 place-items-center rounded-full text-[11px] font-bold ${
                              isTutor
                                ? "bg-gradient-to-tr from-indigo-600 to-violet-500 text-white"
                                : "bg-gradient-to-tr from-emerald-600 to-teal-500 text-white"
                            }`}
                          >
                            {isTutor ? "AI" : "YOU"}
                          </span>
                          <span className="text-[12px] font-semibold text-slate-200">
                            {isTutor ? "Voice Tutor" : "Learner"}
                          </span>
                        </div>
                        {turn.cut && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/15 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-rose-300 shadow-[0_0_10px_rgba(244,63,94,0.2)]">
                            <span className="size-1 rounded-full bg-rose-400 animate-ping" />
                            Cut off (~0.5s)
                          </span>
                        )}
                      </div>
                      <p
                        className={
                          isTutor
                            ? "text-slate-200"
                            : "font-medium text-emerald-100"
                        }
                      >
                        {turn.text}
                      </p>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 flex items-center gap-2 border-t border-white/5 pt-3.5 text-[12.5px] text-[var(--mk-muted)]">
                <svg
                  className="size-4 shrink-0 text-indigo-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth="2"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
                <span>
                  The lecture stopped ~500ms after you spoke &ldquo;hold&rdquo;. No lag, and it kept its place.
                </span>
              </div>
            </Panel>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
