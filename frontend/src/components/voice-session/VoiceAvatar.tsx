"use client";

import SpeakerVisualizer from "@/components/voice-session/SpeakerVisualizer";
import type {
  VoiceAnalysers,
  VoiceState,
} from "@/components/voice-session/useVoiceSession";

/**
 * Video-call style participant tile, with an active-speaker indicator.
 *
 * The ring around the face is driven by the audio itself — the tutor's output
 * while it is speaking, the microphone while the student is. A decorative loop
 * would look similar but would not tell you whether audio is actually flowing,
 * which is exactly what you need to see when debugging barge-in.
 *
 * `SpeakerVisualizer` does the drawing on a canvas and reads the analysers
 * directly, so the spectrum never passes through React state. What is left
 * here is the parts that change a few times a minute: the state colour, the
 * glyph and the label.
 */

/** Tile diameter in CSS pixels. */
const TILE = 208;
/** The face disc inside it. */
const FACE = 144;

const STATE_STYLES: Record<
  VoiceState,
  { ring: string; dot: string; label: string; glow: string; face: string }
> = {
  idle: {
    ring: "border-gray-300 dark:border-gray-700",
    dot: "bg-gray-400",
    label: "Ready when you are",
    glow: "",
    face: "text-gray-500 dark:text-gray-400",
  },
  connecting: {
    ring: "border-gray-400 dark:border-gray-600",
    dot: "bg-gray-400 animate-pulse",
    label: "Connecting",
    glow: "",
    face: "text-gray-500",
  },
  speaking: {
    ring: "border-brand-500",
    dot: "bg-brand-500",
    label: "Tutor speaking",
    glow: "shadow-[0_0_60px_-12px_var(--color-brand-500)]",
    face: "text-brand-500 dark:text-brand-400",
  },
  listening: {
    ring: "border-success-500",
    dot: "bg-success-500",
    label: "Listening",
    glow: "shadow-[0_0_60px_-12px_var(--color-success-500)]",
    face: "text-success-500",
  },
  thinking: {
    ring: "border-warning-500",
    dot: "bg-warning-500 animate-pulse",
    label: "Thinking",
    glow: "shadow-[0_0_50px_-16px_var(--color-warning-500)]",
    face: "text-warning-500",
  },
  interrupted: {
    ring: "border-error-500",
    dot: "bg-error-500",
    label: "Interrupted",
    glow: "shadow-[0_0_60px_-12px_var(--color-error-500)]",
    face: "text-error-500",
  },
  error: {
    ring: "border-error-500",
    dot: "bg-error-500",
    label: "Error",
    glow: "",
    face: "text-error-500",
  },
  // Amber, not red. Nothing failed — the lesson simply moved to another tab,
  // and colouring it like a fault would have the student pressing start again.
  superseded: {
    ring: "border-warning-500",
    dot: "bg-warning-500",
    label: "Moved to another tab",
    glow: "",
    face: "text-warning-700",
  },
};

/**
 * The face of the tile.
 *
 * Was an emoji — 🎓 at rest, 🗣️ / 👂 in the two live states. Emoji render as a
 * different picture on every platform, cannot take the state colour, and at
 * 4xl on the product's signature screen looked like a placeholder because it
 * was one. These are drawn, so they inherit `currentColor` and match.
 */
function VoiceGlyph({
  state,
  className,
}: {
  state: VoiceState;
  className?: string;
}) {
  const common = {
    className: `h-14 w-14 transition-colors duration-300 ${className ?? ""}`,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  // Speaking: a waveform. Everything else: a microphone, because the student
  // is either being listened to or about to be.
  if (state === "speaking") {
    return (
      <svg {...common}>
        <path d="M2 12h2" />
        <path d="M6 8v8" />
        <path d="M10 4v16" />
        <path d="M14 7v10" />
        <path d="M18 10v4" />
        <path d="M22 12h-2" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v4" />
    </svg>
  );
}

interface VoiceAvatarProps {
  state: VoiceState;
  aiLevel: number;
  micLevel: number;
  /**
   * Live analysers, for the spectrum ring. Optional: without them the tile
   * still shows a level ring driven by `aiLevel` / `micLevel`, which is what a
   * caller that has not been updated gets.
   */
  getAnalysers?: () => VoiceAnalysers;
  /** Whether the browser confirmed it is filtering background noise. */
  noiseSuppressed?: boolean;
}

export default function VoiceAvatar({
  state,
  aiLevel,
  micLevel,
  getAnalysers,
  noiseSuppressed = false,
}: VoiceAvatarProps) {
  const styles = STATE_STYLES[state];

  // Whichever side is actually producing sound drives the ring. Only used when
  // there is no analyser to read; the canvas prefers the real thing.
  const level = state === "speaking" ? aiLevel : micLevel;

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        className="relative flex items-center justify-center"
        style={{ width: TILE, height: TILE }}
      >
        {/* THE ACTIVE-SPEAKER INDICATOR.
            Frequency bars, an expanding ring on every onset, and a halo that
            follows loudness — all of it measured from the audio that is
            playing, none of it on a timer. It sits under the face disc so the
            bars appear to radiate from behind it.

            This replaced two DOM rings: an `animate-pulse-ring` halo that was
            purely decorative — it looked identical whether audio was flowing
            or the pipeline had died — and a scaled border driven by a React
            prop updated sixty times a second. */}
        <SpeakerVisualizer
          state={state}
          getAnalysers={getAnalysers}
          fallbackLevel={level}
          size={TILE}
          className={styles.face}
        />

        <div
          className={`relative flex items-center justify-center rounded-full border-4 bg-white transition-[border-color,box-shadow] duration-300 ease-[var(--ease-out-soft)] dark:bg-gray-900 ${styles.ring} ${styles.glow}`}
          style={{ width: FACE, height: FACE }}
        >
          <VoiceGlyph state={state} className={styles.face} />
        </div>
      </div>

      {/* The numeric level readouts that used to sit here were debug output.
          The ring above already shows amplitude, and it does so continuously
          rather than as a number nobody can read at a glance. */}
      <div className="flex flex-col items-center gap-1">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${styles.dot}`} />
          <span
            className="text-sm font-medium text-gray-700 dark:text-gray-300"
            aria-live="polite"
          >
            {styles.label}
          </span>
        </div>
        {/* Shown only while the student is the one talking, and only when the
            microphone track actually REPORTED the filter as on — we ask for it
            in `getUserMedia`, but a constraint is a request and some devices
            simply do not honour it. Claiming otherwise would be telling
            somebody their background noise is handled when it is not. */}
        {noiseSuppressed &&
        (state === "listening" || state === "interrupted") ? (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            Background noise filtered
          </span>
        ) : null}
      </div>
    </div>
  );
}
