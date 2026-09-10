/**
 * Field validation, shared by every form.
 *
 * One module rather than a regex per form, because the rules have to agree:
 * a phone number the contact form accepts and the profile refuses is a bug the
 * person hitting it cannot explain.
 *
 * These are the FRIENDLY layer. Every rule here is also enforced server-side —
 * frontend validation tells someone what they typed wrong, it does not protect
 * anything ("frontend validation is not security").
 *
 * Each function returns the sentence to show, or null when the value is fine.
 * A sentence rather than a boolean so the message lives with the rule instead
 * of being reinvented at every call site.
 */

/** Letters, spaces, apostrophes and hyphens. Not "A-Za-z". */
const NAME_ALLOWED = /^[\p{L}\p{M}][\p{L}\p{M}\s'’.-]*$/u;

/** Digits, with the punctuation a real number is written with. */
const PHONE_ALLOWED = /^[+()\d\s.-]+$/;

/**
 * Deliberately loose. The only email rule worth enforcing in a browser is
 * "looks like an address": something, an @, a domain with a dot. Every stricter
 * pattern eventually rejects a valid address — the RFC allows more than anyone
 * expects — and the real check is whether the person receives what we send.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateName(value: string, field = "name"): string | null {
  const trimmed = value.trim();
  if (!trimmed) return `Enter your ${field}`;
  // No minimum beyond one character: a single-letter name is rare but real,
  // and the pattern below already refuses "1" and "_". Matches the server.
  if (trimmed.length > 255) return `That ${field} is too long`;
  if (!NAME_ALLOWED.test(trimmed)) {
    // Named rather than described: "invalid characters" makes people guess.
    return "Use letters only, no numbers or symbols";
  }
  return null;
}

export function validateEmail(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Enter your email address";
  if (!trimmed.includes("@")) return "An email address needs an @";
  if (!EMAIL_SHAPE.test(trimmed)) {
    return "That does not look like an email address";
  }
  if (trimmed.length > 320) return "That email address is too long";
  return null;
}

/**
 * Optional by default, because asking for a phone number and refusing the form
 * without one loses the messages from people who would rather not give it.
 */
export function validatePhone(
  value: string,
  { required = false }: { required?: boolean } = {},
): string | null {
  const trimmed = value.trim();
  if (!trimmed) return required ? "Enter a phone number" : null;
  if (!PHONE_ALLOWED.test(trimmed)) {
    return "Use numbers only, with + ( ) or spaces if you need them";
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7) return "That is too short for a phone number";
  if (digits.length > 15) return "That is too long for a phone number";
  return null;
}

export function validateRequired(
  value: string,
  {
    field = "this",
    min = 1,
    max = 5000,
  }: { field?: string; min?: number; max?: number } = {},
): string | null {
  const trimmed = value.trim();
  if (!trimmed) return `Please fill in ${field}`;
  if (trimmed.length < min)
    return `That is a bit short. ${min} characters at least`;
  if (trimmed.length > max) {
    return `That is too long. Keep it under ${max.toLocaleString()} characters.`;
  }
  return null;
}

export function validatePassword(value: string): string | null {
  if (!value) return "Choose a password";
  if (value.length < 8) return "Use at least 8 characters";
  if (value.length > 128) return "That password is too long";
  return null;
}

/**
 * The mistakes the server refuses, checked here first.
 *
 * Deliberately the same rules as `backend/app/core/passwords.py`, in the same
 * order, so the message somebody sees while typing is the message they would
 * have got from the API. A client check that is STRICTER than the server is
 * merely annoying; one that is LOOSER is worse — it waves the password through
 * and the account creation fails on submit, with the field already cleared.
 *
 * This is not security. The server does that. This is so nobody has to submit
 * a form to find out it was never going to work.
 */
export function passwordChecks(
  value: string,
): { label: string; met: boolean }[] {
  return [
    { label: "At least 8 characters", met: value.length >= 8 },
    { label: "At least one number (0-9)", met: /\d/.test(value) },
    {
      label: "At least one special character (!@#$...)",
      met: /[^A-Za-z0-9]/.test(value),
    },
  ];
}

export function validateNewPassword(value: string): string | null {
  if (!value) return "Choose a password";
  if (value.length < 8) return "Use at least 8 characters";
  if (value.length > 128) return "Keep it under 128 characters";
  if (value.trim() !== value) return "Remove the space at the start or end";
  if (!/\d/.test(value)) return "Add at least one number";
  if (!/[^A-Za-z0-9]/.test(value)) {
    return "Add at least one special character, such as ! or @";
  }
  return null;
}

/** True when nothing in the map holds a message. */
export function isClean(errors: Record<string, string | null>): boolean {
  return Object.values(errors).every((message) => !message);
}
