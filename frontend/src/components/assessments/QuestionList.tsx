"use client";

import type { QuizQuestionForStudent } from "@/lib/assessments";

/**
 * The answering UI, shared by quizzes and certification exams.
 *
 * Identical in both because the difference between them is entirely a backend
 * rule — quizzes are unlimited, exams are capped. Duplicating the markup would
 * let the two drift apart for no reason.
 */
export default function QuestionList({
  questions,
  selections,
  onSelect,
  disabled = false,
  idPrefix,
  highlightUnanswered = false,
}: {
  questions: QuizQuestionForStudent[];
  selections: Record<string, number>;
  onSelect: (questionId: string, index: number) => void;
  disabled?: boolean;
  /** Anchors each question so a navigator can scroll to it. */
  idPrefix?: string;
  /**
   * Ring the questions still blank. Only switched on once the student has
   * tried to submit — flagging them before they have had a chance to answer
   * would be nagging, not helping.
   */
  highlightUnanswered?: boolean;
}) {
  return (
    <ol className="space-y-6">
      {questions.map((question, questionIndex) => {
        const answered = selections[question.id] !== undefined;
        const flag = highlightUnanswered && !answered;
        return (
          <li
            key={question.id}
            id={idPrefix ? `${idPrefix}-${questionIndex}` : undefined}
            className={
              flag
                ? "scroll-mt-28 rounded-xl border border-warning-300 bg-warning-25 p-4 dark:border-warning-700 dark:bg-warning-500/10"
                : "scroll-mt-28"
            }
          >
            <p className="mb-3 font-medium text-gray-800 dark:text-white/90">
              <span className="mr-2 text-gray-500 dark:text-gray-400">
                {questionIndex + 1}.
              </span>
              {question.question}
              {flag ? (
                <span className="ml-2 rounded-full bg-warning-100 px-2 py-0.5 text-[11px] font-medium text-warning-700 dark:bg-warning-500/20 dark:text-warning-400">
                  not answered
                </span>
              ) : null}
            </p>
            <div className="space-y-2">
              {question.options.map((option, optionIndex) => {
                const checked = selections[question.id] === optionIndex;
                return (
                  <label
                    key={optionIndex}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-sm transition ${
                      checked
                        ? "border-brand-500 bg-brand-25 dark:bg-brand-500/10"
                        : "border-gray-200 hover:border-gray-300 dark:border-gray-800"
                    } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
                  >
                    <input
                      type="radio"
                      name={question.id}
                      value={optionIndex}
                      checked={checked}
                      disabled={disabled}
                      onChange={() => onSelect(question.id, optionIndex)}
                      className="h-4 w-4 accent-brand-500"
                    />
                    <span className="text-gray-700 dark:text-gray-300">
                      {option}
                    </span>
                  </label>
                );
              })}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
