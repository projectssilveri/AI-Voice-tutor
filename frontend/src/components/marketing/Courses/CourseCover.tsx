/**
 * A course's cover art, drawn rather than photographed.
 *
 * Eleven courses used to share three stock photographs, cycled by position in
 * the list — so four courses looked identical, a course's picture CHANGED as
 * you typed in the search box, and its own page showed a different photo again
 * because the detail route passed a hard-coded index. Three problems from one
 * missing a course had no picture of its own.
 *
 * This gives every course one, derived from its title. No uploads, no stock
 * library, nothing to maintain, and course number twelve gets a distinct cover
 * the moment somebody creates it.
 *
 * Deliberately not a photograph of a laptop. A cover here has one job — let
 * you tell this card apart from the one beside it at a glance — and a generic
 * desk photo does that job worse than a colour and two letters.
 */

/** Stable hash of a string. Same input, same colour, forever. */
function hash(value: string): number {
  let total = 0;
  for (let i = 0; i < value.length; i += 1) {
    total = (total * 31 + value.charCodeAt(i)) >>> 0;
  }
  return total;
}

/**
 * Up to two "React Essentials" -> "RE", "PHP for the Web" -> "PW".
 *
 * Small words are skipped, so "for", "and", "the" do not become the letter
 * somebody sees. A one-word title keeps its first two letters rather than
 * showing a lonely capital.
 */
function initials(title: string): string {
  const skip = new Set([
    "for",
    "and",
    "the",
    "of",
    "to",
    "in",
    "a",
    "an",
    "with",
  ]);
  const words = title
    .split(/[\s/&-]+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((word) => word.length > 0 && !skip.has(word.toLowerCase()));

  if (words.length === 0) return title.slice(0, 2).toUpperCase() || "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * Eighteen hues spread round the wheel, each far enough from its neighbours
 * to be told apart at a glance.
 *
 * Fixed hues rather than `hash % 360`: two courses landing eight degrees from
 * each other would look like the repetition this replaces.
 *
 * Eighteen rather than twelve because twelve was not enough. With eleven
 * courses and twelve hues the catalogue drew only six distinct colours —
 * three courses shared one. That is the birthday problem, and the cure is
 * simply more: at eighteen the same catalogue spreads far wider, and the
 * initials tell apart whichever pair still lands together.
 *
 * Saturation and lightness are held constant so the cards read as one set
 * rather than as eleven unrelated posters.
 */
const HUES = [
  4, 24, 44, 64, 88, 108, 132, 152, 172, 190, 208, 224, 244, 262, 280, 300, 318,
  338,
];

export default function CourseCover({
  title,
  courseId,
  className = "",
}: {
  title: string;
  /** Falls back to the title, so a preview with no id still gets a cover. */
  courseId?: string;
  className?: string;
}) {
  const seed = hash(courseId || title);
  const hue = HUES[seed % HUES.length];
  // The gradient's second hue. Taken from HIGHER bits of the hash than the
  // base hue, and varied in both size and direction — so two courses that do
  // land on the same base still shade away from it differently.
  const drift = 30 + ((seed >> 13) % 30);
  const partner = (hue + ((seed >> 17) % 2 === 0 ? drift : -drift) + 360) % 360;
  const label = initials(title);

  return (
    <svg
      viewBox="0 0 370 220"
      preserveAspectRatio="xMidYMid slice"
      className={`h-full w-full ${className}`}
      // Decorative. The course title is already a heading next to it, and a
      // screen reader reading "RE on a purple gradient" adds nothing.
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`cover-${seed}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={`hsl(${hue} 62% 46%)`} />
          <stop offset="100%" stopColor={`hsl(${partner} 58% 32%)`} />
        </linearGradient>
      </defs>
      <rect width="370" height="220" fill={`url(#cover-${seed})`} />

      {/* Two soft discs, placed from the hash. They stop the panel reading as
 a flat swatch and give two courses of similar hue different shapes. */}
      <circle
        cx={60 + (seed % 210)}
        cy={40 + ((seed >> 3) % 120)}
        r={70 + ((seed >> 5) % 50)}
        fill="#ffffff"
        opacity="0.10"
      />
      <circle
        cx={300 - ((seed >> 7) % 180)}
        cy={190 - ((seed >> 9) % 110)}
        r={45 + ((seed >> 11) % 40)}
        fill="#000000"
        opacity="0.10"
      />

      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        fill="#ffffff"
        fillOpacity="0.94"
        fontSize="78"
        fontWeight="700"
        letterSpacing="2"
        fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
      >
        {label}
      </text>
    </svg>
  );
}
