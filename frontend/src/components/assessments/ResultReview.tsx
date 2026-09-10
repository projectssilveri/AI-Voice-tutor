"use client";

import type { QuizAnswerResult } from "@/lib/assessments";

/**
 * Per-question review after grading.
 *
 * The answer key appears only here, once the attempt is already recorded — so
 * showing it cannot be used to improve the attempt it belongs to.
 */
export default function ResultReview({
  results,
}: {
  results: QuizAnswerResult[];
}) {
  return (
    <ol className="space-y-4">
      {results.map((result, index) => (
        <li
          key={result.question_id}
          className={`rounded-xl border p-4 ${
            result.is_correct
              ? "border-success-200 bg-success-25 dark:border-success-800 dark:bg-success-500/10"
              : "border-error-200 bg-error-25 dark:border-error-800 dark:bg-error-500/10"
          }`}
        >
          <p className="mb-2 font-medium text-gray-800 dark:text-white/90">
            <span className="mr-2 text-gray-500 dark:text-gray-400">
              {index + 1}.
            </span>
            {result.question}
          </p>

          <p className="text-sm">
            <span className="text-gray-500 dark:text-gray-400">
              Your answer:{" "}
            </span>
            <span
              className={
                result.is_correct
                  ? "font-medium text-success-700 dark:text-success-400"
                  : "font-medium text-error-700 dark:text-error-400"
              }
            >
              {result.selected === null
                ? "Not answered"
                : result.options[result.selected]}
            </span>
          </p>

          {!result.is_correct ? (
            <p className="mt-1 text-sm">
              <span className="text-gray-500 dark:text-gray-400">
                Correct answer:{" "}
              </span>
              <span className="font-medium text-gray-800 dark:text-white/90">
                {result.options[result.correct_answer]}
              </span>
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
