"use client";

import { useRef, useState } from "react";

import Avatar from "@/components/ui/Avatar";
import { useAuth } from "@/context/AuthContext";
import { deletePhoto, uploadPhoto } from "@/lib/profile";
import { errorText } from "@/lib/api";

/**
 * Upload, replace or remove your own photo.
 *
 * The file input is hidden behind a real button rather than styled: a native
 * `<input type="file">` cannot be made to look like anything, and hiding it
 * while a `<button>` clicks it is the one arrangement that stays keyboard
 * accessible.
 *
 * Type and size are checked HERE only to give a fast answer. The bytes are
 * checked again server-side by their magic numbers, which is the check that
 * counts — a browser's idea of a file's type comes from its extension.
 */

const ACCEPT = "image/jpeg,image/png,image/gif,image/webp";
const MAX_BYTES = 2 * 1024 * 1024;

export default function ProfilePhoto() {
  const { user } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped after every change so `Avatar` refetches instead of showing the
  // cached old picture. The endpoint sets max-age=300, which is right for a
  // table of fifty faces and wrong for the one you just replaced.
  const [version, setVersion] = useState(0);

  if (!user) return null;

  async function choose(file: File | undefined) {
    if (!file) return;
    setError(null);

    if (file.size > MAX_BYTES) {
      setError(
        `That image is ${Math.round(file.size / 1024)}KB. Keep it under 2MB.`,
      );
      return;
    }

    setBusy(true);
    try {
      await uploadPhoto(file);
      setVersion((n) => n + 1);
    } catch (caught) {
      setError(
        errorText(caught, "Could not upload that."),
      );
    } finally {
      setBusy(false);
      // Cleared so choosing the SAME file again still fires a change event.
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await deletePhoto();
      setVersion((n) => n + 1);
    } catch (caught) {
      setError(
        errorText(caught, "Could not remove it."),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-5">
      <Avatar userId={user.id} name={user.name} size="xl" version={version} />

      <div>
        <p className="mb-1 font-medium text-gray-800 dark:text-white/90">
          Profile photo
        </p>
        <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
          JPEG, PNG, GIF or WebP, up to 2MB. Shown beside your name to people
          you share an organisation or a message with.
        </p>

        {/* Hidden and opened by the button below, so nothing visible is
            joined to it and it had no accessible name at all — a file input
            announced as "blank". The button beside it carries the label a
            sighted person reads; this carries the same words for everybody
            else. */}
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          aria-label="Choose a profile photo"
          onChange={(event) => void choose(event.target.files?.[0])}
          id="profile-photo-input"
        />
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => input.current?.click()}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-50"
          >
            {busy ? "Working…" : "Choose a photo"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void remove()}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
          >
            Remove
          </button>
        </div>

        {error ? (
          <p
            role="alert"
            className="mt-3 rounded-lg border border-error-500 bg-error-50 px-3 py-2 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400"
          >
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
