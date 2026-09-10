"use client";

import { useState } from "react";

import { photoUrl } from "@/lib/profile";

/**
 * A person, as a small round picture.
 *
 * THE INITIAL IS THE DEFAULT, not the error case. Most accounts have no photo,
 * so the component starts by drawing the initial and only swaps in an image
 * once one has actually loaded. Doing it the other way — `<img>` first, catch
 * the 404 — flashes a broken-image icon on every avatar in a fifty-row table.
 *
 * Deliberately not `next/image`: these are authenticated, per-user bytes served
 * from the API host with a session cookie, which the Next image optimiser
 * cannot fetch on the server. A plain `<img>` lets the browser send the cookie.
 */

const SIZES = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-16 w-16 text-lg",
  xl: "h-24 w-24 text-2xl",
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
  userId,
  name,
  size = "md",
  /** Changes when the photo changes, so the browser refetches instead of
      showing the old one from cache. */
  version,
  className = "",
}: {
  userId: string;
  name: string | null | undefined;
  size?: keyof typeof SIZES;
  version?: string | number;
  className?: string;
}) {
  const [hasPhoto, setHasPhoto] = useState(true);
  const initial = (name?.trim()?.charAt(0) ?? "?").toUpperCase();

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white ${
        SIZES[size]
      } ${tintFor(userId)} ${className}`}
      // The name, not "avatar" — a screen reader announcing "image" beside a
      // name it is already reading adds nothing.
      title={name ?? undefined}
    >
      {initial}
      {hasPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photoUrl(userId, version)}
          alt=""
          aria-hidden="true"
          onError={() => setHasPhoto(false)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : null}
    </span>
  );
}
