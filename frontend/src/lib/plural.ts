/**
 * Counting things in a sentence.
 *
 * The screens were writing `${n} assignment(s)`, `${n} course(s)`,
 * `${n} submission(s)` and so on. That reads like an internal tool: nobody
 * writes "1 assignment(s)" to a person, and a student sees this on every
 * module. One helper rather than a ternary at each call site, so the next
 * count added does not reintroduce the pattern.
 */
export function plural(count: number, singular: string, pluralForm?: string) {
  return count === 1 ? singular : (pluralForm ?? `${singular}s`);
}

/** The count and its noun together — the usual case. */
export function counted(count: number, singular: string, pluralForm?: string) {
  return `${count} ${plural(count, singular, pluralForm)}`;
}
