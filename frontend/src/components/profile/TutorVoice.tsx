"use client";

import { useCallback, useEffect, useState } from "react";

import { SkeletonRows } from "@/components/ui/Skeleton";
import {
  type VoiceChoice,
  type VoiceOption,
  getTutorVoice,
  setTutorVoice,
} from "@/lib/profile";

/**
 * Which voice the tutor speaks in.
 *
 * Every student used to hear the same man, not by choice but by omission: the
 * backend never named a voice, so Gemini fell back to its own default. This is
 * the screen that ends that.
 *
 * Saved on selection rather than behind a Save button, like the notification
 * switches next to it — a form with a submit for one radio group is a form
 * people leave without pressing.
 *
 * The list comes from the server, not from a copy kept here. The set of voices
 * belongs to `services/gemini_live`, and a second list in the browser is a
 * second list to forget to update.
 */

function VoiceRow({
  option,
  selected,
  disabled,
  onChoose,
}: {
  option: VoiceOption | null;
  selected: boolean;
  disabled: boolean;
  onChoose: () => void;
}) {
  const id = `voice-${option?.name ?? "default"}`;
  return (
    <label
      htmlFor={id}
      className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition ${
        selected
          ? "border-brand-500 bg-brand-25 dark:border-brand-500 dark:bg-brand-500/10"
          : "border-gray-200 hover:border-gray-300 dark:border-gray-800 dark:hover:border-gray-700"
      }`}
    >
      <input
        id={id}
        type="radio"
        name="tutor-voice"
        checked={selected}
        disabled={disabled}
        onChange={onChoose}
        className="mt-1 h-4 w-4 shrink-0 text-brand-500 focus:ring-brand-500/25"
      />
      <span className="min-w-0">
        <span className="block font-medium text-gray-800 dark:text-white/90">
          {option ? option.label : "Whatever the platform uses"}
          {option ? (
            <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-normal text-gray-600 dark:bg-gray-800 dark:text-gray-400">
              {/* "sounds", not "is". These are synthesised voices; describing
                  one as being a man or a woman claims something about it that
                  is not true. */}
              sounds {option.sounds}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block text-sm text-gray-500 dark:text-gray-400">
          {option
            ? option.hint
            : "No preference. If we change the default later, yours changes with it."}
        </span>
      </span>
    </label>
  );
}

export default function TutorVoice() {
  const [choice, setChoice] = useState<VoiceChoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      setChoice(await getTutorVoice());
    } catch {
      setError("Could not load your voice setting.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function choose(voice: string | null) {
    if (!choice || voice === choice.voice) return;
    setBusy(true);
    setError(null);
    // Shown immediately, corrected by the response. Waiting for the round trip
    // to move a radio button makes the control feel broken.
    setChoice({ ...choice, voice });
    try {
      setChoice(await setTutorVoice(voice));
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch {
      setError("That did not save. Try again.");
      void load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-raised dark:border-gray-800 dark:bg-white/[0.03] lg:p-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">
            The tutor&apos;s voice
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Applies to every course. It takes effect the next time you start a
            lesson.
          </p>
        </div>
        {saved ? (
          <span
            role="status"
            className="text-sm font-medium text-success-600 dark:text-success-400"
          >
            Saved
          </span>
        ) : null}
      </div>

      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-error-500 bg-error-50 px-4 py-2.5 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400"
        >
          {error}
        </p>
      ) : null}

      {!choice ? (
        <SkeletonRows rows={4} columns={1} />
      ) : (
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="sr-only">Choose the tutor&apos;s voice</legend>
          {choice.options.map((option) => (
            <VoiceRow
              key={option.name}
              option={option}
              selected={choice.voice === option.name}
              disabled={busy}
              onChoose={() => void choose(option.name)}
            />
          ))}
          {/* Clearing the choice is its own option, not an empty state. It is
              meaningfully different from picking today's default by name:
              this one keeps tracking the default if it ever changes. */}
          <VoiceRow
            option={null}
            selected={choice.voice === null}
            disabled={busy}
            onChoose={() => void choose(null)}
          />
        </fieldset>
      )}
    </div>
  );
}
