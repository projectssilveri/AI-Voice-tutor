"use client";

import { useEffect, useRef } from "react";

import { AudioMeter } from "@/components/voice-session/audio";
import type {
  VoiceAnalysers,
  VoiceState,
} from "@/components/voice-session/useVoiceSession";

/**
 * The active-speaker indicator: a ring that reacts to the sound itself.
 *
 * Three things are drawn, and each one says something different.
 *
 *   BARS     a circular spectrum. Height per bar is the energy in that band,
 *            log-spaced so a speaking voice actually fills the ring instead of
 *            crowding into the first eighth of it. This is the part that
 *            responds to frequency: a vowel is low and wide, a consonant is a
 *            flick at the top of the ring.
 *   RIPPLE   an expanding circle emitted on an onset — the start of a syllable,
 *            a beat. This is the part that responds to rhythm, and it is what
 *            makes the tile read as "someone is talking" from the corner of
 *            your eye rather than needing to be looked at.
 *   HALO     a soft ring whose weight follows overall loudness, so a quiet
 *            passage looks quiet.
 *
 * WHY A CANVAS, AND WHY IT OWNS ITS OWN LOOP. The obvious version puts the
 * spectrum in React state and re-renders. That is 44 numbers pushed through a
 * state update sixty times a second, each one re-rendering the lesson page and
 * everything under it — and the page it sits on also holds a live WebSocket, a
 * transcript and a quiz. This component reads the analyser directly inside a
 * requestAnimationFrame loop and never re-renders at all: the props it takes
 * change only when the session's STATE changes, a few times a minute.
 *
 * NOTHING HERE IS DECORATIVE MOTION. Every pixel that moves is driven by
 * measured audio, so a frozen frame is silence and a still ring means the
 * tutor genuinely is not talking. That matters on a screen whose whole job is
 * to show whether barge-in worked: an idle animation would look identical when
 * the audio pipeline had died.
 */

/** States in which a device is open and there is something to visualise. */
const LIVE_STATES: ReadonlySet<VoiceState> = new Set<VoiceState>([
  "speaking",
  "listening",
  "thinking",
  "interrupted",
]);

/** Level at which a rising edge counts as the start of a sound. */
const ONSET_LEVEL = 0.14;
/** Shortest gap between two ripples, in ms. Stops a loud passage strobing. */
const ONSET_INTERVAL_MS = 110;
/** How long a ripple takes to travel out and fade, in ms. */
const RIPPLE_MS = 900;
/** Most ripples alive at once. A hard cap, so a long turn cannot grow the array. */
const MAX_RIPPLES = 5;

/** Bars rise instantly and fall slowly — the standard that makes a meter readable. */
const BAR_ATTACK = 0.55;
const BAR_RELEASE = 0.12;

interface Ripple {
  /** Timestamp the ripple was emitted at. */
  born: number;
  /** How loud the onset was, 0..1. Sets its opening thickness. */
  strength: number;
}

interface SpeakerVisualizerProps {
  state: VoiceState;
  /** Live analysers. Absent before a session exists. */
  getAnalysers?: () => VoiceAnalysers;
  /**
   * Loudness to fall back on when no analyser is open, 0..1.
   *
   * Not decoration: a caller that has a level but no analyser — a test, or the
   * moment between permission and the first frame — still gets an honest ring
   * rather than a dead one.
   */
  fallbackLevel?: number;
  /** Diameter in CSS pixels. */
  size: number;
  /** Carries the state colour; everything is drawn in `currentColor`. */
  className?: string;
}

export default function SpeakerVisualizer({
  state,
  getAnalysers,
  fallbackLevel = 0,
  size,
  className = "",
}: SpeakerVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Read inside the loop, which must not restart when a number changes.
  const stateRef = useRef(state);
  stateRef.current = state;
  const fallbackRef = useRef(fallbackLevel);
  fallbackRef.current = fallbackLevel;

  const live = LIVE_STATES.has(state);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Back the canvas at device resolution; a 1x canvas on a 2x screen makes
    // hairline bars look like grey mush.
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (!live) {
      // Leaving the last frame up would show a spectrum for audio that has
      // stopped — a still picture of the tutor talking after it stopped.
      ctx.clearRect(0, 0, size, size);
      return;
    }

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    // One meter per analyser node. Kept in a map because the tutor's player is
    // rebuilt if the server reports a different sample rate, and a meter holds
    // a bin-to-bar mapping derived from that rate — reusing it across the swap
    // would map the new node's bins with the old node's arithmetic.
    const meters = new WeakMap<AnalyserNode, AudioMeter>();
    const meterFor = (node: AnalyserNode) => {
      let meter = meters.get(node);
      if (!meter) {
        meter = new AudioMeter(node);
        meters.set(node, meter);
      }
      return meter;
    };

    const centre = size / 2;
    // The bars sit in the gap between the avatar disc and the outer edge.
    const innerRadius = size * 0.36;
    const maxBarLength = size * 0.115;

    let smoothed: Float32Array | null = null;
    let smoothedLevel = 0;
    let wasAboveOnset = false;
    let lastOnset = 0;
    const ripples: Ripple[] = [];

    // The colour comes from `currentColor`, so the ring follows the state
    // palette and the light/dark theme without this file knowing either.
    // Re-read every few frames rather than every frame: getComputedStyle
    // forces style resolution, and the colour changes a handful of times a
    // minute at most.
    let rgb = "99, 102, 241";
    let sinceColourRead = 0;
    const readColour = () => {
      const parsed = getComputedStyle(canvas)
        .color.match(/-?[\d.]+/g)
        ?.slice(0, 3);
      if (parsed && parsed.length === 3) rgb = parsed.join(", ");
    };
    readColour();

    let raf = 0;
    let lastState = stateRef.current;

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);

      // A state change repaints the ring in the new state's colour, so it is
      // read at once rather than up to a quarter of a second later — the whole
      // point of the colour is that "interrupted" is visible the instant it
      // happens.
      if (stateRef.current !== lastState) {
        lastState = stateRef.current;
        sinceColourRead = 0;
        readColour();
      } else if (sinceColourRead++ >= 15) {
        sinceColourRead = 0;
        readColour();
      }

      ctx.clearRect(0, 0, size, size);

      // Whichever side is producing sound. Speaking means the tutor; anything
      // else means the student is the one who might be. Falling back to the
      // other node covers the moment before a device is open.
      const nodes = getAnalysers?.();
      const node =
        stateRef.current === "speaking"
          ? (nodes?.ai ?? nodes?.mic ?? null)
          : (nodes?.mic ?? nodes?.ai ?? null);

      let level: number;
      let bars: Float32Array | null = null;
      let bass = 0;

      if (node) {
        const frame = meterFor(node).read();
        level = frame.level;
        bars = frame.bars;
        bass = frame.bass;
      } else {
        level = fallbackRef.current;
      }

      // Smooth the headline level the same way as the bars, so the halo does
      // not flicker between the peaks of a waveform.
      smoothedLevel +=
        (level - smoothedLevel) *
        (level > smoothedLevel ? BAR_ATTACK : BAR_RELEASE);

      // ---- onset detection: the rhythm half of the brief --------------
      const above = smoothedLevel > ONSET_LEVEL;
      if (
        !reduceMotion &&
        above &&
        !wasAboveOnset &&
        now - lastOnset > ONSET_INTERVAL_MS
      ) {
        lastOnset = now;
        // Bass weighting: a syllable landing on a low note opens a heavier
        // ring than a hissed consonant of the same peak amplitude.
        ripples.push({
          born: now,
          strength: Math.min(1, smoothedLevel + bass * 0.6),
        });
        if (ripples.length > MAX_RIPPLES) ripples.shift();
      }
      wasAboveOnset = above;

      // ---- ripples ----------------------------------------------------
      for (let i = ripples.length - 1; i >= 0; i--) {
        const age = (now - ripples[i].born) / RIPPLE_MS;
        if (age >= 1) {
          ripples.splice(i, 1);
          continue;
        }
        // Ease out, so a ripple leaves quickly and lingers at the edge.
        const eased = 1 - Math.pow(1 - age, 3);
        const radius = innerRadius + eased * (centre - innerRadius);
        ctx.beginPath();
        ctx.arc(centre, centre, radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${rgb}, ${(1 - age) * 0.5 * ripples[i].strength})`;
        ctx.lineWidth = 1 + (1 - age) * 2.5 * ripples[i].strength;
        ctx.stroke();
      }

      // ---- the halo ---------------------------------------------------
      if (smoothedLevel > 0.01) {
        ctx.beginPath();
        ctx.arc(
          centre,
          centre,
          innerRadius - 3 + smoothedLevel * 4,
          0,
          Math.PI * 2,
        );
        ctx.strokeStyle = `rgba(${rgb}, ${0.15 + smoothedLevel * 0.4})`;
        ctx.lineWidth = 1.5 + smoothedLevel * 3;
        ctx.stroke();
      }

      // ---- the spectrum -----------------------------------------------
      if (bars) {
        if (!smoothed || smoothed.length !== bars.length) {
          smoothed = new Float32Array(bars.length);
        }
        const count = bars.length;
        // Mirrored around the vertical axis: the same spectrum drawn up both
        // sides. A single sweep puts all the bass on one side and reads as a
        // lopsided smear rather than a ring.
        const total = count * 2;
        const step = (Math.PI * 2) / total;

        ctx.lineCap = "round";
        for (let i = 0; i < count; i++) {
          const target = bars[i];
          smoothed[i] +=
            (target - smoothed[i]) *
            (target > smoothed[i] ? BAR_ATTACK : BAR_RELEASE);

          const magnitude = smoothed[i];
          if (magnitude < 0.02) continue;

          const length = 2 + magnitude * maxBarLength;
          ctx.strokeStyle = `rgba(${rgb}, ${0.35 + magnitude * 0.55})`;
          ctx.lineWidth = Math.max(1.5, (size / total) * 0.55);

          for (const side of [1, -1] as const) {
            // Start at the top and sweep down both sides, so low frequencies
            // meet at twelve o'clock and the ring is symmetrical.
            const angle = -Math.PI / 2 + side * (i + 0.5) * step;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            ctx.beginPath();
            ctx.moveTo(centre + cos * innerRadius, centre + sin * innerRadius);
            ctx.lineTo(
              centre + cos * (innerRadius + length),
              centre + sin * (innerRadius + length),
            );
            ctx.stroke();
          }
        }
      }
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ctx.clearRect(0, 0, size, size);
    };
  }, [live, size, getAnalysers]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
