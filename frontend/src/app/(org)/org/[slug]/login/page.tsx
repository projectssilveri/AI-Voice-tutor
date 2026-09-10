"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { useAuth } from "@/context/AuthContext";
import { login } from "@/lib/auth";
import { type PublicOrg, getPublicOrg } from "@/lib/orgPortal";

const FIELD =
  "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

/**
 * An organization's own sign-in page.
 *
 * The credentials are the platform's — one account, one password — but the
 * page belongs to the customer: their name, their address bar, no marketplace
 * and no signup link. There is deliberately no "create an account" here:
 * membership of an organization is granted by their administrator, never
 * claimed by anyone who knows the URL.
 *
 * Signing in is global; belonging is what the portal checks. Someone from
 * another organization can enter valid credentials here and will be told, on
 * the other side, that this is not their organization — which is the honest
 * outcome, and better than pretending their password was wrong.
 */
function OrgLogin() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const params = useSearchParams();
  const { refresh } = useAuth();

  const [org, setOrg] = useState<PublicOrg | null>(null);
  const [lookupFailed, setLookupFailed] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPublicOrg(slug)
      .then(setOrg)
      .catch(() => setLookupFailed(true));
  }, [slug]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
      await refresh();
      router.replace(params.get("next") ?? `/org/${slug}`);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not sign you in.",
      );
      setBusy(false);
    }
  }

  if (lookupFailed) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <p className="mb-2 text-4xl" aria-hidden="true">
          🏢
        </p>
        <h1 className="mb-2 text-xl font-bold text-gray-800 dark:text-white/90">
          We can&apos;t find that organization
        </h1>
        <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">
          Check the address with whoever sent it to you. It should look like{" "}
          <span className="font-mono">/org/your-company/login</span>.
        </p>
        <Link
          href="/"
          className="text-sm font-medium text-brand-500 dark:text-brand-400 hover:text-brand-600"
        >
          Go to the main site
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-16 dark:bg-gray-900">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <span
            aria-hidden="true"
            className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-500 text-2xl"
          >
            🏢
          </span>
          <h1 className="text-title-sm font-bold text-gray-800 dark:text-white/90">
            {/* The skeleton keeps the heading's height so the card does not
                jump when the name arrives. */}
            {org?.name ?? (
              <span className="mx-auto block h-7 w-48 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
            )}
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Sign in to your training
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-gray-200 bg-white p-6 shadow-lifted dark:border-gray-800 dark:bg-white/[0.03] sm:p-8"
        >
          {error ? (
            <p
              role="alert"
              className="mb-5 rounded-lg bg-error-50 px-4 py-3 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400"
            >
              {error}
            </p>
          ) : null}

          <label
            htmlFor="org-email"
            className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
          >
            Work email
          </label>
          <input
            id="org-email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`${FIELD} mb-4`}
            required
          />

          <label
            htmlFor="org-password"
            className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
          >
            Password
          </label>
          <input
            id="org-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${FIELD} mb-6`}
            required
          />

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-brand-500 px-6 py-3 text-sm font-medium text-white shadow-raised transition-[background-color,box-shadow,transform] duration-150 hover:bg-brand-600 active:scale-[0.98] disabled:opacity-50 motion-reduce:active:scale-100"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>

          {/* No signup link, deliberately — see the component docstring. */}
          <p className="mt-5 text-center text-xs text-gray-500 dark:text-gray-400">
            Accounts here are created by your administrator. If you cannot sign
            in, ask them rather than creating a new one.
          </p>
        </form>
      </div>
    </div>
  );
}

export default function OrgLoginPage() {
  /* useSearchParams suspends during prerender; without the boundary the
     production build fails outright. */
  return (
    <Suspense fallback={null}>
      <OrgLogin />
    </Suspense>
  );
}
