import type { Metadata } from "next";
import Link from "next/link";

import { ApiError, apiFetch } from "@/lib/api";

interface PageProps {
  params: Promise<{ certificateId: string }>;
}

interface CertificateCheck {
  valid: boolean;
  student_name: string | null;
  course_title: string | null;
  exam_title: string | null;
  issued_at: string | null;
}

export const metadata: Metadata = {
  title: "Verify a certificate",
  description: "Check whether a Voice Tutor LMS certificate is genuine.",
};

/**
 * Public certificate verification. No account required.
 *
 * A certificate is worth nothing if the person receiving it cannot check it,
 * so this page is deliberately open to anyone holding the id — that id is
 * printed on the PDF, and possessing it is what proves the holder had the
 * certificate in the first place.
 *
 * An unknown id renders "not valid" rather than a 404: someone pasting an id
 * has asked a question, and "this page does not exist" is not the answer to
 * it.
 */
export default async function VerifyCertificatePage({ params }: PageProps) {
  const { certificateId } = await params;

  let result: CertificateCheck = {
    valid: false,
    student_name: null,
    course_title: null,
    exam_title: null,
    issued_at: null,
  };
  let unreachable = false;

  try {
    result = await apiFetch<CertificateCheck>(
      `/public/certificates/${certificateId}`,
      { next: { revalidate: 0 } },
    );
  } catch (caught) {
    // A MALFORMED ID ANSWERS 422, AND THAT IS AN ANSWER: there is no such
    // certificate. The comment here always said so; the code did not, and
    // lumped it in with a real outage — so somebody who mistyped an ID was
    // told "we could not check" rather than "no certificate with this ID".
    //
    // Anything else genuinely means we could not check, and saying "not valid"
    // then would brand a real certificate a fake because our own service was
    // down. That distinction is the whole point of this branch.
    const status = caught instanceof ApiError ? caught.status : 0;
    if (status !== 404 && status !== 422) {
      unreachable = true;
    }
  }

  return (
    <section className="relative z-10 bg-[var(--mk-raised)] pb-20 pt-14 md:pt-20">
      <div className="container">
        <div className="mx-auto max-w-2xl">
          <h1 className="mb-8 text-3xl font-semibold text-[var(--mk-text)] sm:text-4xl">
            Certificate verification
          </h1>

          {unreachable ? (
            <div className="rounded-xl border border-[var(--mk-line)] bg-white/[0.02] p-8">
              <p className="text-lg font-semibold text-[var(--mk-text)]">
                We could not check this right now
              </p>
              <p className="mt-2 text-base text-[var(--mk-muted)]">
                Something went wrong at our end, so this is not a judgement
                about the certificate. Please try again shortly.
              </p>
            </div>
          ) : result.valid ? (
            <div className="overflow-hidden rounded-xl border border-success-500/30 bg-success-500/10">
              <div className="border-b border-success-500/20 px-8 py-6">
                <p className="flex items-center gap-3 text-xl font-semibold text-success-400">
                  <span aria-hidden="true">✓</span> This certificate is valid
                </p>
              </div>
              <dl className="divide-y divide-green-500/15 px-8">
                {[
                  { label: "Awarded to", value: result.student_name },
                  { label: "Course", value: result.course_title },
                  { label: "Assessment", value: result.exam_title },
                  {
                    label: "Issued",
                    value: result.issued_at
                      ? new Date(result.issued_at).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        })
                      : null,
                  },
                ].map((row) => (
                  <div
                    key={row.label}
                    className="flex flex-wrap gap-2 py-4 sm:grid sm:grid-cols-3"
                  >
                    <dt className="text-sm uppercase tracking-wide text-[var(--mk-muted)]">
                      {row.label}
                    </dt>
                    <dd className="col-span-2 text-base font-medium text-[var(--mk-text)]">
                      {row.value ?? "Not recorded"}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="px-8 pb-6 pt-2 text-sm break-all text-[var(--mk-muted)]">
                Certificate ID: {certificateId}
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-error-500/30 bg-error-500/10 p-8">
              <p className="flex items-center gap-3 text-xl font-semibold text-error-400">
                <span aria-hidden="true">✕</span> No certificate with this ID
              </p>
              <p className="mt-2 text-base text-[var(--mk-muted)]">
                Nothing on record matches it. Check the ID was copied in full. It is a long string and the end is easy to miss.
              </p>
              <p className="mt-4 text-sm break-all text-[var(--mk-muted)]">
                Checked: {certificateId}
              </p>
            </div>
          )}

          <p className="mt-8 text-base text-[var(--mk-muted)]">
            Every certificate we issue carries an ID that anyone can check here,
            without an account.{" "}
            <Link
              href="/courses"
              className="font-medium text-[var(--mk-brand-lit)] hover:underline"
            >
              See the courses
            </Link>
            .
          </p>
        </div>
      </div>
    </section>
  );
}
