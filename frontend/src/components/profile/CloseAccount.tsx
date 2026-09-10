"use client";

import { useState } from "react";

import { useAuth } from "@/context/AuthContext";
import { errorText } from "@/lib/api";
import { closeAccount } from "@/lib/profile";

/**
 * Leaving.
 *
 * Folded shut by default. This is the one destructive control on a page full
 * of ordinary settings, and an always-open panel headed "Close account" sitting
 * under a password form is an invitation to a bad afternoon.
 *
 * Confirmed by TYPING THE EMAIL ADDRESS, not by ticking a box. A checkbox is
 * one careless click; typing your own address is a deliberate act, and it is
 * the pattern people already recognise from every other product that asks this.
 *
 * The copy says closed, not deleted, because that is what happens — records
 * that name this person (certificates, an organisation's activity log) belong
 * to more than one party and stay. Promising erasure here and not delivering it
 * would be worse than saying so plainly.
 */
export default function CloseAccount() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (!user) return null;

  const matches = confirm.trim().toLowerCase() === user.email.toLowerCase();

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await closeAccount({
        confirm_email: confirm.trim(),
        reason: reason.trim() || undefined,
      });
      setDone(result.explanation);
      // A full navigation, not a router push: the session is gone server-side
      // and every cached page in the client needs to find that out.
      setTimeout(() => window.location.assign("/"), 4000);
    } catch (caught) {
      setError(
        errorText(caught, "Could not close the account."),
      );
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-raised dark:border-gray-800 dark:bg-white/[0.03]">
        <h2 className="mb-2 text-lg font-semibold text-gray-800 dark:text-white/90">
          Your account is closed
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">{done}</p>
        <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
          Taking you back to the home page.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-error-200 bg-white p-6 shadow-raised dark:border-error-500/30 dark:bg-white/[0.03]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            Close your account
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            You will be signed out and will not be able to sign back in.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="rounded-lg border border-error-300 px-4 py-2 text-sm font-medium text-error-700 transition hover:bg-error-50 dark:border-error-500/40 dark:text-error-400 dark:hover:bg-error-500/10"
        >
          {open ? "Cancel" : "Close account"}
        </button>
      </div>

      {open ? (
        <div className="mt-6 border-t border-gray-100 pt-6 dark:border-gray-800">
          <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
            Your name stays on the records you are part of: certificates you
            earned, and the activity log your organisation keeps. Those belong
            to more than one person, not only to you. Everything else stops: no
            sign-in, no email, no access to your courses. Write to us if you
            need those records erased as well.
          </p>

          <div className="mb-4">
            <label
              htmlFor="close-confirm"
              className="mb-1.5 block text-sm font-medium text-gray-800 dark:text-white/90"
            >
              Type <span className="font-mono">{user.email}</span> to confirm
            </label>
            <input
              id="close-confirm"
              type="text"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="off"
              className="w-full max-w-md rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm text-gray-800 focus:border-error-400 focus:outline-hidden focus:ring-3 focus:ring-error-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
            />
          </div>

          <div className="mb-5">
            <label
              htmlFor="close-reason"
              className="mb-1.5 block text-sm font-medium text-gray-800 dark:text-white/90"
            >
              Why are you leaving?{" "}
              <span className="font-normal text-gray-500 dark:text-gray-400">
                (optional)
              </span>
            </label>
            <textarea
              id="close-reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={200}
              className="w-full max-w-md rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
            />
          </div>

          {error ? (
            <p
              role="alert"
              className="mb-4 rounded-lg border border-error-500 bg-error-50 px-4 py-2.5 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400"
            >
              {error}
            </p>
          ) : null}

          <button
            type="button"
            disabled={busy || !matches}
            onClick={() => void submit()}
            className="rounded-lg bg-error-700 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-error-800 disabled:opacity-40"
          >
            {busy ? "Closing…" : "Close my account permanently"}
          </button>
          {!matches && confirm ? (
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              That does not match the address on this account.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
