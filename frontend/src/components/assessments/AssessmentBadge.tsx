/**
 * The quiz / certification distinction, made visible.
 *
 * The rule has always been enforced server-side — quizzes are unlimited,
 * certification is capped and every submitted attempt counts — but a student
 * had to infer it from prose. Two assessments that look identical and behave
 * completely differently is exactly where someone burns an attempt they meant
 * to practise with.
 */
export function PracticeQuizBadge({ questions }: { questions?: number }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-success-50 px-3 py-1 text-xs font-semibold text-success-700 dark:bg-success-500/15 dark:text-success-400">
      <span aria-hidden="true">✅</span>
      Practice quiz, unlimited attempts
      {questions !== undefined ? (
        <span className="font-normal opacity-80">· {questions} questions</span>
      ) : null}
    </span>
  );
}

export function CertificationBadge({
  allowed,
  remaining,
}: {
  allowed?: number;
  remaining?: number;
}) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-warning-50 px-3 py-1 text-xs font-semibold text-warning-700 dark:bg-warning-500/15 dark:text-warning-400">
      <span aria-hidden="true">🎓</span>
      Certification exam
      {allowed !== undefined ? (
        <span className="font-normal opacity-80">
          · {allowed} attempts
          {remaining !== undefined ? ` · ${remaining} left` : ""}
        </span>
      ) : null}
    </span>
  );
}
