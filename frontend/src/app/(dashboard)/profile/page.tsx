"use client";

import { useEffect, useState } from "react";

import RequireAuth from "@/components/auth/RequireAuth";
import MessageCentre from "@/components/messages/MessageCentre";
import CloseAccount from "@/components/profile/CloseAccount";
import NotificationSettings from "@/components/profile/NotificationSettings";
import ProfilePhoto from "@/components/profile/ProfilePhoto";
import TutorVoice from "@/components/profile/TutorVoice";
import Avatar from "@/components/ui/Avatar";
import { useAuth } from "@/context/AuthContext";
import { updateMe } from "@/lib/auth";
import { errorText } from "@/lib/api";
import { roleLabel } from "@/lib/roles";

const FIELD =
  "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

/**
 * The account screen the header dropdown links to.
 *
 * It previously pointed at /profile, which did not exist — three dead links to
 * a 404. Name and password are editable because `PATCH /users/me` already
 * supports both; email is not, because changing it would need a
 * re-verification flow that does not exist yet, and silently letting someone
 * change the address they sign in with is worse than not offering it.
 */
function Profile() {
  const { user, photoVersion, refresh } = useAuth();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setName(user.name);
      setPhone(user.phone ?? "");
    }
  }, [user]);

  // JUMP TO #help-and-support ONCE IT EXISTS.
  //
  // Following the link on this page worked; opening it in a new tab did not.
  // The browser looks for the element as the document loads, and at that point
  // this page is still a sign-in check with no panel in it — so it finds
  // nothing and stays at the top. By the time the panel renders, the browser
  // has stopped caring. This asks again, after the content is there.
  useEffect(() => {
    if (!user) return;
    const id = window.location.hash.slice(1);
    if (!id) return;
    const target = document.getElementById(id);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [user]);

  async function handleSaveName(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (!name.trim()) {
      setError("Your name cannot be empty.");
      return;
    }

    setSaving(true);
    try {
      // Blank means "no number", not "leave it alone" — sending null is how
      // someone removes a number they no longer want us to hold.
      await updateMe({ name: name.trim(), phone: phone.trim() || null });
      await refresh();
      setNotice("Profile updated.");
    } catch (caught) {
      setError(errorText(caught, "Could not save."));
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }

    setSaving(true);
    try {
      await updateMe({ password });
      setPassword("");
      setConfirm("");
      setNotice("Password changed.");
    } catch (caught) {
      setError(
        errorText(caught, "Could not change it."),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1 text-title-sm font-bold text-gray-800 dark:text-white/90">
          Your account
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Signed in as {user?.email}.
        </p>
      </div>

      {/* First, because it is the only thing on this page that is visibly
          "you" — and the one people look for when they open a profile. */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-raised dark:border-gray-800 dark:bg-white/[0.03]">
        <ProfilePhoto />
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-2xl border border-error-500 bg-error-50 p-4 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400"
        >
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-2xl border border-success-500 bg-success-50 p-4 text-sm text-success-700 dark:bg-success-500/10 dark:text-success-400">
          {notice}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-gray-200 bg-white shadow-raised p-6 dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="flex items-center gap-4">
            {/* The card above this one shows your photo, and this one drew
                a letter — the same person, twice, on one page, looking like
                two different people. */}
            <Avatar
              userId={user?.id}
              name={user?.name}
              size="lg"
              version={photoVersion}
            />
            <div className="min-w-0">
              <p className="truncate font-semibold text-gray-800 dark:text-white/90">
                {user?.name}
              </p>
              <p className="truncate text-sm text-gray-500 dark:text-gray-400">
                {user?.email}
              </p>
            </div>
          </div>
          <dl className="mt-5 space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500 dark:text-gray-400">Role</dt>
              <dd>
                {/* The NAME of the role, not the column. This read
                    "admin" here and "Platform Admin" on every other screen,
                    which is how somebody ends up unsure whether they are a
                    platform admin or an organisation one. */}
                <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                  {roleLabel(user?.role)}
                </span>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500 dark:text-gray-400">Status</dt>
              <dd className="text-gray-800 dark:text-white/90">
                {user?.is_active ? "Active" : "Disabled"}
              </dd>
            </div>
          </dl>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <form
            onSubmit={handleSaveName}
            className="rounded-2xl border border-gray-200 bg-white shadow-raised p-6 dark:border-gray-800 dark:bg-white/[0.03]"
          >
            <h2 className="mb-4 text-base font-semibold text-gray-800 dark:text-white/90">
              Profile
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label
                  htmlFor="profile-name"
                  className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
                >
                  Name
                </label>
                <input
                  id="profile-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={FIELD}
                />
              </div>
              <div>
                <label
                  htmlFor="profile-email"
                  className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
                >
                  Email
                </label>
                <input
                  id="profile-email"
                  type="email"
                  value={user?.email ?? ""}
                  disabled
                  className={FIELD}
                />
                {/* This used to say "contact an admin" and give no way to do
                    it — a dead end on the one field people most often need
                    changed. The link goes to the Help panel below, which is a
                    real message to a real person.

                    An absolute path, not a bare "#", so the middle-click and
                    the right-click menu open a URL that stands on its own. The
                    effect above does the scrolling once the panel exists. */}
                <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                  To change the address you sign in with,{" "}
                  <a
                    href="/profile#help-and-support"
                    className="font-medium text-brand-500 dark:text-brand-400 hover:text-brand-600"
                  >
                    send us a message
                  </a>
                  .
                </p>
              </div>
              <div>
                <label
                  htmlFor="profile-phone"
                  className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
                >
                  Phone number{" "}
                  <span className="font-normal text-gray-500 dark:text-gray-400">
                    (optional)
                  </span>
                </label>
                {/* type="tel" rather than "text": it brings up the phone keypad
                    on a mobile and turns off autocorrect, which mangles a
                    number typed with spaces. Deliberately no pattern — country
                    codes, extensions and national spacing are all valid, and a
                    regex that guesses wrong stops someone saving their own
                    number. */}
                <input
                  id="profile-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  maxLength={32}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91 98765 43210"
                  className={FIELD}
                />
                <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                  Only used to reach you about your account. Clear the box to
                  remove it.
                </p>
              </div>
            </div>
            <button
              type="submit"
              disabled={
                saving ||
                (name.trim() === (user?.name ?? "") &&
                  phone.trim() === (user?.phone ?? ""))
              }
              className="mt-5 rounded-lg bg-brand-500 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </form>

          <form
            onSubmit={handleChangePassword}
            className="rounded-2xl border border-gray-200 bg-white shadow-raised p-6 dark:border-gray-800 dark:bg-white/[0.03]"
          >
            <h2 className="mb-4 text-base font-semibold text-gray-800 dark:text-white/90">
              Change password
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label
                  htmlFor="profile-new-password"
                  className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
                >
                  New password
                </label>
                <input
                  id="profile-new-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  className={FIELD}
                />
              </div>
              <div>
                <label
                  htmlFor="profile-confirm-password"
                  className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
                >
                  Confirm
                </label>
                <input
                  id="profile-confirm-password"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  className={FIELD}
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={saving || !password}
              className="mt-5 rounded-lg border border-gray-300 px-6 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03]"
            >
              {saving ? "Saving…" : "Change password"}
            </button>
          </form>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-raised dark:border-gray-800 dark:bg-white/[0.03]">
        {/* Above the email switches: this one changes what a lesson sounds
            like, which somebody opening their profile is far more likely to
            have come here for than a mailing preference. */}
        <TutorVoice />

        <NotificationSettings />
      </div>

      <div
        id="help-and-support"
        className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-raised dark:border-gray-800 dark:bg-white/[0.03]"
      >
        <MessageCentre
          title="Help"
          intro="Ask us anything about your account or your courses. Replies land here."
        />
      </div>

      {/* Last on the page, and folded shut. The one destructive control here
          sits below everything ordinary rather than beside it. */}
      <div className="mt-6">
        <CloseAccount />
      </div>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <RequireAuth>
      <Profile />
    </RequireAuth>
  );
}
