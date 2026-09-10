"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { sendContactMessage } from "@/lib/catalogue";
import {
  isClean,
  validateEmail,
  validateName,
  validatePhone,
  validateRequired,
} from "@/lib/validate";

import WhatHappensNext from "./WhatHappensNext";
import { errorText } from "@/lib/api";

/** The field, and the same field once it is wrong. */
function fieldClass(error: string | null | undefined): string {
  return error
    ? `${FIELD} border-error-500 focus:border-error-500 focus:ring-red-500/25`
    : FIELD;
}

/**
 * The message under a field.
 *
 * `role="alert"` so a screen reader announces it when it appears, and the
 * input points at it with aria-describedby so the two are connected rather
 * than merely adjacent.
 */
function FieldError({ id, message }: { id: string; message: string | null }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-2 text-sm text-error-400">
      {message}
    </p>
  );
}

const FIELD =
  "w-full rounded-xl border border-[var(--mk-line)] bg-[var(--mk-inset)] px-4 py-3 text-base text-[var(--mk-text)] outline-none transition-[border-color,box-shadow] focus:border-[var(--mk-brand)] focus:ring-3 focus:ring-[var(--mk-brand)]/25";

/**
 * The Contact form, wired to FastAPI (step 11).
 *
 * It previously rendered a Submit button with no handler — the form looked
 * like it worked and threw every message away.
 */
export default function Contact() {
  // "Contact sales" on the business page arrives here with the subject
  // already decided. Pre-filling it means the enquiry lands in the admin
  // inbox labelled, rather than as another untitled message someone has to
  // read to categorise. Still editable — it is only a suggestion.
  const searchParams = useSearchParams();
  const presetSubject = searchParams.get("subject") ?? "";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [subject, setSubject] = useState(presetSubject);
  const [message, setMessage] = useState("");

  // One message per field, keyed by field. Null means the field is fine.
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  // Honeypot: hidden from people, irresistible to bots.
  const [website, setWebsite] = useState("");

  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Every rule, in one place, so blur and submit cannot disagree. */
  function validateAll(): Record<string, string | null> {
    return {
      name: validateName(name),
      email: validateEmail(email),
      // Optional. Asking for a number and refusing the form without one loses
      // the messages from people who would rather not give it.
      phone: validatePhone(phone),
      message: validateRequired(message, { field: "your message", min: 10 }),
    };
  }

  function check(field: string) {
    setErrors((current) => ({ ...current, [field]: validateAll()[field] }));
  }

  function clear(field: string) {
    // Only clears once the value is actually valid — wiping the message on the
    // first keystroke would hide the rule from someone still getting it wrong.
    const now = validateAll()[field];
    if (!now) setErrors((current) => ({ ...current, [field]: null }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    // Without this the browser does a native GET submit and reloads the page,
    // which looks exactly like "nothing happened".
    event.preventDefault();
    setError(null);

    const found = validateAll();
    setErrors(found);
    if (!isClean(found)) {
      // Focus the FIRST bad field rather than only colouring it. On a long
      // form the error can be below the fold, and a form that refuses to
      // submit with no visible reason reads as broken.
      const firstBad = Object.keys(found).find((key) => found[key]);
      if (firstBad) {
        document.getElementById(`contact-${firstBad}`)?.focus();
      }
      return;
    }

    setSending(true);
    try {
      await sendContactMessage({
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        subject: subject.trim() || undefined,
        message: message.trim(),
        website,
      });
      setSent(true);
      setName("");
      setEmail("");
      setPhone("");
      setSubject("");
      setMessage("");
      setErrors({});
    } catch (caught) {
      setError(
        errorText(caught, "Could not send your message. Please try again."),
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <section id="contact" className="overflow-hidden py-16 md:py-20 lg:py-28">
      <div className="container">
        <div className="grid gap-8 lg:grid-cols-[8fr_4fr]">
          <div>
            <div className="rounded-2xl border border-[var(--mk-line)] bg-[var(--mk-raised)] p-6 sm:p-8">
              <h2 className="mb-3 text-2xl font-semibold text-[var(--mk-text)] sm:text-3xl lg:text-2xl xl:text-3xl">
                Get in touch
              </h2>
              <p className="mb-12 text-base font-medium text-[var(--mk-muted)]">
                Questions about a course, access, or your certification
                attempts? Send them here and we will reply by email.
              </p>

              {sent ? (
                <div
                  role="status"
                  className="rounded-xl border border-success-500/40 bg-success-500/10 p-6"
                >
                  <p className="mb-2 text-lg font-semibold text-success-400">
                    Message sent
                  </p>
                  <p className="text-base text-[var(--mk-muted)]">
                    Thanks. We have it, and we will reply to the address you
                    gave.
                  </p>
                  <button
                    type="button"
                    onClick={() => setSent(false)}
                    className="mt-4 text-base font-medium text-[var(--mk-brand-lit)] hover:underline"
                  >
                    Send another message
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} noValidate>
                  {error ? (
                    <div
                      role="alert"
                      className="mb-8 rounded-xl border border-error-500/40 bg-error-500/10 px-6 py-4 text-base text-error-400"
                    >
                      {error}
                    </div>
                  ) : null}

                  <div className="grid gap-x-6 md:grid-cols-2">
                    <div>
                      <div className="mb-8">
                        <label
                          htmlFor="contact-name"
                          className="mb-3 block text-sm font-medium text-[var(--mk-text)]"
                        >
                          Your name
                        </label>
                        <input
                          id="contact-name"
                          type="text"
                          value={name}
                          onChange={(e) => {
                            setName(e.target.value);
                            if (errors.name) clear("name");
                          }}
                          onBlur={() => check("name")}
                          aria-invalid={Boolean(errors.name)}
                          aria-describedby={errors.name ? "contact-name-error" : undefined}
                          placeholder="Enter your name"
                          maxLength={255}
                          className={fieldClass(errors.name)}
                        />
                        <FieldError id="contact-name-error" message={errors.name} />
                      </div>
                    </div>
                    <div>
                      <div className="mb-8">
                        <label
                          htmlFor="contact-email"
                          className="mb-3 block text-sm font-medium text-[var(--mk-text)]"
                        >
                          Your email
                        </label>
                        <input
                          id="contact-email"
                          type="email"
                          value={email}
                          onChange={(e) => {
                            setEmail(e.target.value);
                            if (errors.email) clear("email");
                          }}
                          onBlur={() => check("email")}
                          aria-invalid={Boolean(errors.email)}
                          aria-describedby={errors.email ? "contact-email-error" : undefined}
                          placeholder="you@example.com"
                          maxLength={320}
                          className={fieldClass(errors.email)}
                        />
                        <FieldError id="contact-email-error" message={errors.email} />
                      </div>
                    </div>
                    <div>
                      <div className="mb-8">
                        <label
                          htmlFor="contact-phone"
                          className="mb-3 block text-sm font-medium text-[var(--mk-text)]"
                        >
                          Phone{" "}
                          <span className="font-normal text-[var(--mk-muted)]">
                            (optional)
                          </span>
                        </label>
                        {/* type="tel" rather than "text": it brings up the
                            phone keypad on a mobile and turns off autocorrect,
                            which mangles a number typed with spaces. */}
                        <input
                          id="contact-phone"
                          type="tel"
                          value={phone}
                          onChange={(e) => {
                            setPhone(e.target.value);
                            if (errors.phone) clear("phone");
                          }}
                          onBlur={() => check("phone")}
                          aria-invalid={Boolean(errors.phone)}
                          aria-describedby={errors.phone ? "contact-phone-error" : undefined}
                          placeholder="+91 98765 43210"
                          maxLength={40}
                          className={fieldClass(errors.phone)}
                        />
                        <FieldError id="contact-phone-error" message={errors.phone} />
                      </div>
                    </div>
                    <div>
                      <div className="mb-8">
                        <label
                          htmlFor="contact-subject"
                          className="mb-3 block text-sm font-medium text-[var(--mk-text)]"
                        >
                          Subject{" "}
                          <span className="font-normal text-[var(--mk-muted)]">
                            (optional)
                          </span>
                        </label>
                        <input
                          id="contact-subject"
                          type="text"
                          value={subject}
                          onChange={(e) => setSubject(e.target.value)}
                          placeholder="What is this about?"
                          maxLength={255}
                          className={FIELD}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="mb-8">
                        <label
                          htmlFor="contact-message"
                          className="mb-3 block text-sm font-medium text-[var(--mk-text)]"
                        >
                          Your message
                        </label>
                        <textarea
                          id="contact-message"
                          rows={5}
                          value={message}
                          onChange={(e) => {
                            setMessage(e.target.value);
                            if (errors.message) clear("message");
                          }}
                          onBlur={() => check("message")}
                          aria-invalid={Boolean(errors.message)}
                          aria-describedby={
                            errors.message ? "contact-message-error" : undefined
                          }
                          placeholder="Enter your message"
                          maxLength={5000}
                          className={`${fieldClass(errors.message)} resize-none`}
                        />
                        <FieldError
                          id="contact-message-error"
                          message={errors.message}
                        />
                        <p className="mt-2 text-sm text-[var(--mk-muted)]">
                          {message.length} / 5000
                        </p>
                      </div>
                    </div>

                    {/* Off-screen rather than display:none — some bots skip
                        hidden fields but fill anything they can focus. */}
                    <div className="absolute left-[-9999px]" aria-hidden>
                      <label htmlFor="contact-website">
                        Leave this field empty
                      </label>
                      <input
                        id="contact-website"
                        type="text"
                        tabIndex={-1}
                        autoComplete="off"
                        value={website}
                        onChange={(e) => setWebsite(e.target.value)}
                      />
                    </div>

                    <div>
                      <button
                        type="submit"
                        disabled={sending}
                        className="rounded-xl bg-[var(--mk-brand)] px-9 py-4 text-base font-medium text-white duration-300 hover:bg-[var(--mk-brand)]/90 disabled:opacity-60"
                      >
                        {sending ? "Sending…" : "Send message"}
                      </button>
                    </div>
                  </div>
                </form>
              )}
            </div>
          </div>
          <div>
            <WhatHappensNext />
          </div>
        </div>
      </div>
    </section>
  );
}
