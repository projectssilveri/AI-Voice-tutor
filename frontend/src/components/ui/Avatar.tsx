"use client";

import { useEffect, useState } from "react";

import { photoUrl } from "@/lib/profile";

/**
 * A person, as a small square picture.
 *
 * SQUARE, AND IN ONE PLACE. It used to be round here and round in four
 * hand-written copies elsewhere, while the marketing header drew its own
 * square one — so signing in and walking from the website to the dashboard
 * changed the shape of your own face. The shape is settled here now, and the
 * copies were deleted rather than corrected, because five corrected copies
 * drift again.
 *
 * THE INITIAL IS THE DEFAULT, not the error case. Most accounts have no photo,
 * so the component starts by drawing the initial and only swaps in an image
 * once one has actually loaded. Doing it the other way, `<img>` first and catch
 * the 404, flashes a broken-image icon on every avatar in a fifty-row table.
 *
 * NO NAME MEANS NOT LOADED YET, not "unknown person". This used to draw a "?"
 * in a coloured square whenever the name was missing, and the name is missing
 * on every single page load until the session check comes back — so the first
 * thing anybody saw after a refresh was a question mark where their face goes.
 * It is a plain grey square now, which is what a thing that has not arrived
 * should look like.
 *
 * Deliberately not `next/image`: these are authenticated, per-user bytes served
 * from the API host with a session cookie, which the Next image optimiser
 * cannot fetch on the server. A plain `<img>` lets the browser send the cookie.
 */

// The radius grows with the box, at about a quarter of it — the proportion
// the marketing header already used at 32px. One shared `rounded-lg` would
// make the 96px avatar a square with filed corners and the 32px one a blob.
const SIZES = {
  sm: "h-8 w-8 rounded-lg text-xs",
  md: "h-10 w-10 rounded-xl text-sm",
  lg: "h-14 w-14 rounded-2xl text-xl",
  xl: "h-24 w-24 rounded-3xl text-2xl",
} as const;

/** A stable colour per person, so the same face is the same colour everywhere. */
const TINTS = [
  // White on each of these, measured. The initial is 12px in a table row, so
  // it is normal text and needs 4.5:1 — two of the original six did not have
  // it: blue-light-500 was 2.76 and orange-500 was 3.15. The 700 shades of the
  // same hues clear it (5.86 and 5.52) and still read as six distinct colours.
  "bg-brand-500", // 4.84
  "bg-success-700", // 5.41
  "bg-warning-700", // 5.43
  "bg-error-700", // 6.57
  "bg-blue-light-700", // 5.86
  "bg-orange-700", // 5.52
] as const;

function tintFor(seed: string): string {
  let total = 0;
  for (let i = 0; i < seed.length; i += 1) total += seed.charCodeAt(i);
  return TINTS[total % TINTS.length];
}

export default function Avatar({
  /** Absent while a header is still loading the session. Nothing is fetched
      and nothing is drawn in it. */
  userId,
  name,
  size = "md",
  /** Changes when the photo changes, so the browser refetches instead of
      showing the old one from cache. */
  version,
  /**
   * Called with whether a photo actually loaded.
   *
   * This component is the only thing that finds out — it is the thing that
   * fetches the image — and the account screen needs to know so that Remove
   * is not offered on an account whose "photo" is a drawn letter.
   */
  onPhotoState,
  className = "",
}: {
  userId: string | null | undefined;
  name: string | null | undefined;
  size?: keyof typeof SIZES;
  version?: string | number;
  onPhotoState?: (has: boolean) => void;
  className?: string;
}) {
  const [hasPhoto, setHasPhoto] = useState(true);

  // TRY AGAIN WHEN THE PHOTO CHANGES. `hasPhoto` was one-way: the first 404
  // turned it off and nothing turned it back on, so uploading a photo right
  // after removing one left the letter sitting there until a full reload.
  useEffect(() => {
    setHasPhoto(true);
  }, [userId, version]);

  const trimmed = name?.trim() ?? "";
  const initial = trimmed.charAt(0).toUpperCase();
  //: Nothing to draw yet. Not an unknown person: an unfinished session check.
  const blank = !trimmed && !userId;

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden font-semibold text-white ${
        SIZES[size]
      } ${
        blank ? "bg-gray-200 dark:bg-gray-700" : tintFor(userId ?? "")
      } ${className}`}
      // The name, not "avatar" — a screen reader announcing "image" beside a
      // name it is already reading adds nothing.
      title={name ?? undefined}
    >
      {initial}
      {hasPhoto && userId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photoUrl(userId, version)}
          alt=""
          aria-hidden="true"
          onError={() => {
            setHasPhoto(false);
            onPhotoState?.(false);
          }}
          onLoad={() => onPhotoState?.(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : null}
    </span>
  );
}
