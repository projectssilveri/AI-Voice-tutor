"use client";

import { useCallback, useEffect, useState } from "react";

import { SkeletonRows } from "@/components/ui/Skeleton";
import {
  type NotificationPreferences,
  getNotificationPreferences,
  setNotificationPreferences,
} from "@/lib/profile";
import { errorText } from "@/lib/api";

/**
 * What we email, and what neither switch turns off.
 *
 * Saved on change rather than behind a Save button. There are two switches;
 * a form with a submit for two booleans is a form somebody leaves without
 * pressing it, and then wonders why they are still getting email.
 *
 * The note at the bottom is not boilerplate. Somebody who turns both of these
 * off and then buys a course still has to receive the receipt, and telling them
 * that here is the difference between a preference and a broken promise.
 */

function Toggle({
  id,
  checked,
  onChange,
  disabled,
  title,
  description,
}: {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled: boolean;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-gray-100 py-4 last:border-0 dark:border-gray-800">
      <div>
        <label
          htmlFor={id}
          className="block font-medium text-gray-800 dark:text-white/90"
        >
          {title}
        </label>
        <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
          {description}
        </p>
      </div>

      {/* A real checkbox underneath, so it is focusable, announced, and works
          from the keyboard. The switch is what you see; the checkbox is what
          the browser and a screen reader deal with. */}
      <label className="relative inline-flex shrink-0 cursor-pointer items-center">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          className="peer sr-only"
        />
        <span className="h-6 w-11 rounded-full bg-gray-300 transition-colors peer-checked:bg-brand-500 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-500 peer-disabled:opacity-50 dark:bg-gray-700" />
        <span className="pointer-events-none absolute left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5" />
      </label>
    </div>
  );
}

export default function NotificationSettings() {
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      setPrefs(await getNotificationPreferences());
      setError(null);
    } catch (caught) {
      setError(
        errorText(caught, "Could not load your preferences."),
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function change(next: NotificationPreferences) {
    // Applied immediately so the switch moves when it is pressed, then rolled
    // back if the save fails. A toggle that waits for a round trip before
    // moving feels broken on a slow connection.
    const previous = prefs;
    setPrefs(next);
    setBusy(true);
    setSaved(false);
    try {
      await setNotificationPreferences(next);
      setSaved(true);
      setError(null);
    } catch (caught) {
      setPrefs(previous);
      setError(
        errorText(caught, "Could not save that."),
      );
    } finally {
      setBusy(false);
    }
  }

  if (!prefs) {
    return error ? (
      <p
        role="alert"
        className="rounded-lg border border-error-500 bg-error-50 px-4 py-2.5 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400"
      >
        {error}
      </p>
    ) : (
      <SkeletonRows rows={2} />
    );
  }

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">
          Notification preferences
        </h2>
        {saved ? (
          <span
            role="status"
            className="text-sm text-success-700 dark:text-success-400"
          >
            Saved
          </span>
        ) : null}
      </div>
      <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
        Manage the types of communications you receive.
      </p>

      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-error-500 bg-error-50 px-4 py-2.5 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400"
        >
          {error}
        </p>
      ) : null}

      <div className="rounded-2xl border border-gray-200 bg-white px-5 shadow-raised dark:border-gray-800 dark:bg-white/[0.03]">
        <Toggle
          id="notify-offers"
          checked={prefs.notify_offers}
          disabled={busy}
          onChange={(next) => void change({ ...prefs, notify_offers: next })}
          title="Updates and offerings"
          description="New courses, changes to the product, and the occasional offer. Off unless you turn it on."
        />
        <Toggle
          id="notify-learning"
          checked={prefs.notify_learning}
          disabled={busy}
          onChange={(next) => void change({ ...prefs, notify_learning: next })}
          title="Your learning"
          description="Reminders about a course you have started, quiz and exam results, and certificates."
        />
      </div>

      <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
        These settings apply to email. To stop WhatsApp messages, reply{" "}
        <span className="font-medium text-gray-700 dark:text-gray-300">
          stop
        </span>{" "}
        in the WhatsApp chat. Changes can take a few hours to take effect. You
        will still receive email about your account and anything you buy even if
        you turn both of these off. A receipt is not something we can let you
        opt out of.
      </p>
    </section>
  );
}
