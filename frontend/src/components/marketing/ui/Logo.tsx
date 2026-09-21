import { cn } from "@/lib/cn";

/**
 * The mark: five bars whose tops fall and rise to draw a V.
 *
 * It is a waveform and the letter V at the same time — voice, and the shape a
 * level meter makes. That double reading is the whole idea, and it is why the
 * bars are bottom-aligned rather than centred: a centred waveform is a shape
 * every audio product already uses, while the tops forming a letter is ours.
 *
 * Replaces `/images/logo/startup-logo-2.svg`, which was the free template's
 * own logo file, renamed for us but not redrawn.
 *
 * Drawn as a component rather than a file so it inherits the page's colour,
 * costs no request, and stays crisp at 16px. `Image` with an SVG src can do
 * none of those.
 *
 * NO <defs>, AND NO GRADIENT ELEMENT. The first version used a
 * `<linearGradient id="vt-logo-grad">`, and the docstring here warned that two
 * marks on one page sharing an id would collide. Namespacing the id did not
 * solve that: the header and the footer both render this, so the page really
 * did carry two elements with the same id, which is invalid HTML and which an
 * accessibility audit flags. `url(#id)` resolves to the FIRST match, so both
 * logos silently drew the header's gradient. Identical today, and a trap the
 * moment they are not.
 *
 * `useId` would fix it and would also force this into a client component for
 * a decorative mark. Stepping the colour per bar removes the need entirely:
 * the gradient ran diagonally across a 32px box, so five solid stops read the
 * same at every size this is used at, and the component stays a server
 * component with no ids at all.
 */
function Mark({ className }: { className?: string }) {
  // 5 bars, 3.6 wide on a 6 pitch, bottom-aligned to y=26 in a 32 box.
  // `fill` is the diagonal gradient's colour sampled at each bar's position.
  const bars = [
    { x: 2.2, h: 20, fill: "#9cb9ff" },
    { x: 8.2, h: 13, fill: "#87a3ff" },
    { x: 14.2, h: 7, fill: "#718cff" },
    { x: 20.2, h: 13, fill: "#5c76ff" },
    { x: 26.2, h: 20, fill: "#465fff" },
  ];

  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={cn("shrink-0", className)}
    >
      {bars.map((bar) => (
        <rect
          key={bar.x}
          x={bar.x}
          y={26 - bar.h}
          width={3.6}
          height={bar.h}
          rx={1.8}
          fill={bar.fill}
        />
      ))}
    </svg>
  );
}

/**
 * Mark plus wordmark, for headers and footers.
 *
 * `href` is left to the caller: the header wraps it in a link to home, the
 * footer does not always want one, and a logo that is a link inside a link is
 * invalid markup.
 */
export default function Logo({
  className,
  markOnly = false,
}: {
  className?: string;
  markOnly?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <Mark className="size-8" />
      {!markOnly && (
        // INHERITS, like the mark above it. This used to paint itself
        // `text-gray-900 dark:text-white`, which follows the app-wide theme
        // toggle. The marketing site does not follow that toggle: it is dark
        // at all times, from its own `--mk-*` tokens. So with the theme set to
        // light the wordmark came out rgb(16, 24, 40) on a background of
        // rgb(16, 24, 40) — the same colour, in the header and the footer.
        //
        // Every caller sits inside something that has a colour, and the two
        // that need a specific one say so at the call site.
        <span className="text-[19px] font-semibold tracking-[-0.02em]">
          Voice Tutor
        </span>
      )}
    </span>
  );
}

export { Mark as LogoMark };
