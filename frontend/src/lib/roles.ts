/**
 * What a role is called out loud.
 *
 * ONE COPY. There were three near-identical maps — one on the audit screen, one
 * on the users screen, one in `RequireAuth` — plus several screens that showed
 * the raw column with a `capitalize` class on it. So the same person was
 * "Platform Admin" in the users table and "admin" on their own account page,
 * and `RequireAuth` still called a super admin "the platform owner", a tier
 * that was settled as not existing.
 *
 * THE LADDER, once, so nothing here has to be worked out from context:
 *
 *     super admin  >  platform admin  >  organisation admin
 *
 * and inside a customer, below their organisation admin: branch manager, then
 * department admin.
 *
 * `lib/orgPortal` keeps its own `roleLabel` on purpose. Inside one company's
 * portal an org admin is just "Administrator" — the word "organisation" is
 * redundant when the whole screen is that organisation, and the picker there
 * carries a hint per role that this map has no room for.
 */

const LABELS: Record<string, string> = {
  student: "Student",
  // "Platform Admin", not "Admin". It appears in lists beside "Organisation
  // Admin", and the bare word left the reader to guess which of the two
  // ladders they were looking at.
  admin: "Platform Admin",
  super_admin: "Super Admin",
  org_admin: "Organisation Admin",
  branch_manager: "Branch Manager",
  dept_admin: "Department Admin",
};

/** Title case, for a badge or a table cell. */
export function roleLabel(role: string | null | undefined): string {
  if (!role) return "";
  return LABELS[role] ?? role.replace(/_/g, " ");
}

/**
 * Lower case, for the middle of a sentence.
 *
 * "You are signed in as a platform admin." Title case inside a sentence reads
 * like a job title on a business card.
 */
export function roleWords(role: string | null | undefined): string {
  const label = roleLabel(role);
  return label ? label.toLowerCase() : "";
}

/** With the article: "a student", "an organisation admin". */
export function roleWithArticle(role: string | null | undefined): string {
  const words = roleWords(role);
  if (!words) return "";
  return `${/^[aeiou]/.test(words) ? "an" : "a"} ${words}`;
}

/** Plural, for "this area is for platform admins". */
export function rolePlural(role: string | null | undefined): string {
  const words = roleWords(role);
  return words ? `${words}s` : "";
}

/** Every role this map knows, for a filter dropdown. */
export const ROLE_VALUES = Object.keys(LABELS);
