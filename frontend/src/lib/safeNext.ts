/**
 * Turn a `?next=` parameter into a path this site will actually navigate to.
 *
 * `next` comes from the URL, so it is attacker-controlled: anyone can send a
 * victim a link to our own sign-in page carrying a destination of their
 * choosing. Following it blindly is an open redirect — the victim sees our
 * domain, signs in, and is handed to somebody else's page with our address in
 * the referrer.
 *
 * ONE RULE, ONE PLACE. This existed inline in `SignInForm` as
 * `next.startsWith("/") && !next.startsWith("//")`, and `RedirectIfSignedIn`
 * then needed the same check. Two copies of a security rule is one copy that
 * will be updated and one that will not.
 *
 * What is rejected, and why:
 *
 *   https://evil.test   absolute, another origin
 *   //evil.test         protocol-relative; the browser reads it as a host
 *   /\evil.test         the same trick with a backslash, which several
 *                       browsers normalise to a forward slash. This is the
 *                       case the inline version in SignInForm missed.
 *   javascript:...      not a navigation at all
 *   anything relative   ambiguous, and nothing in this app produces one
 */
export function safeNext(next: string | null, fallback: string): string {
  if (!next) return fallback;
  // One leading slash, and the character after it must be neither another
  // slash nor a backslash.
  const sameOrigin = /^\/(?![/\\])/.test(next);
  return sameOrigin ? next : fallback;
}
