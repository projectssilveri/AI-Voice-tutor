"use client";

import { useState } from "react";

import type { CourseModule } from "@/types/course";
import { counted } from "@/lib/plural";
import Collapse from "@/components/ui/Collapse";

/**
 * The curriculum, as a collapsed accordion.
 *
 * Coursera summarises a section as "10 videos, 3 readings, 3 assignments" so
 * you can judge the shape of it without expanding anything. Same idea, with
 * our content types — and the voice lecture is listed first and styled as the
 * primary item, because it is the thing that makes this course different from
 * a page of text.
 *
 * Counts only. The module's material is never sent to this page.
 */
function summarise(module: CourseModule): string {
  const parts: string[] = [];
  if (module.has_voice_lecture) parts.push("1 voice lecture");
  // Second, matching the order of the rows below: the written form of the same
  // lesson sits beside the spoken one, before the things that test it.
  if (module.has_notes) parts.push("written material");
  if (module.materials > 0) parts.push(counted(module.materials, "file"));
  if (module.quiz_questions > 0)
    parts.push(counted(module.quiz_questions, "quiz question"));
  if (module.assignments > 0)
    parts.push(counted(module.assignments, "assignment"));
  return parts.join(" · ") || "Being written";
}

function Row({
  icon,
  label,
  detail,
  primary = false,
}: {
  icon: string;
  label: string;
  detail: string;
  primary?: boolean;
}) {
  return (
    <li
      className={`flex items-start gap-3 rounded-xl px-4 py-3 ${
 primary
 ?"bg-primary/[0.07]"
          : "bg-white/[0.02]"
      }`}
    >
      <span aria-hidden="true" className="text-lg leading-none">
        {icon}
      </span>
      <span className="min-w-0">
        <span
          className={`block text-sm font-semibold ${
 primary ?"text-[var(--mk-brand-lit)]" : "text-[var(--mk-text)]"
          }`}
        >
          {label}
        </span>
        <span className="block text-sm text-[var(--mk-muted)]">
          {detail}
        </span>
      </span>
    </li>
  );
}

export default function CurriculumAccordion({
  modules,
}: {
  modules: CourseModule[];
}) {
  // Collapsed by default, as asked: the point of the accordion is to let
  // someone scan the whole course in one screen and open only what interests
  // them.
  const [open, setOpen] = useState<string | null>(null);

  if (modules.length === 0) {
    return (
      <p className="text-base text-[var(--mk-muted)]">
        Modules for this course are being written.
      </p>
    );
  }

  return (
    <ul className="overflow-hidden rounded-xl bg-[var(--mk-raised)]">
      {modules.map((module, index) => {
        const expanded = open === module.id;
        return (
          <li
            key={module.id}
            className="border-b border-[var(--mk-line)] last:border-b-0"
          >
            <h3>
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={`module-panel-${module.id}`}
                onClick={() => setOpen(expanded ? null : module.id)}
                className="flex w-full items-center gap-4 px-6 py-5 text-left transition hover:bg-white/[0.02]"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-[var(--mk-brand-lit)]">
                  {index + 1}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block text-base font-medium text-[var(--mk-text)]">
                    {module.title}
                  </span>
                  <span className="mt-0.5 block text-sm text-[var(--mk-muted)]">
                    {summarise(module)}
                  </span>
                </span>

                {module.estimated_minutes > 0 ? (
                  <span className="hidden shrink-0 text-sm text-[var(--mk-muted)] sm:block">
                    {module.estimated_minutes} min
                  </span>
                ) : null}

                <span
                  aria-hidden="true"
                  className={`shrink-0 text-[var(--mk-muted)] transition-transform ${expanded ?"rotate-180" : ""}`}
                >
                  ▾
                </span>
              </button>
            </h3>

            <Collapse open={expanded} id={`module-panel-${module.id}`}>
              <div className="px-6 pb-5 pl-[76px]">
                <ul className="space-y-2">
                  {module.has_voice_lecture ? (
                    <Row
                      primary
                      icon="🎙️"
                      label="Voice lecture"
                      detail={`The tutor teaches this out loud${
                        module.estimated_minutes > 0
                          ? ` · about ${module.estimated_minutes} min`
                          : ""
                      }. Interrupt any time to ask a question.`}
                    />
                  ) : null}
                  {/* DIRECTLY UNDER THE LECTURE, because it is the same
                      lesson in written form — the notes the tutor teaches
                      from, plus any handout attached to them. Reading and
                      listening are the two ways through a module, so they
                      belong next to each other; the quiz and the assignment
                      come after you have done one of them. */}
                  {module.has_notes || module.materials > 0 ? (
                    <Row
                      icon="📄"
                      label="Documents"
                      detail={
                        module.materials > 0
                          ? `Everything the tutor teaches from, in writing, plus ${counted(module.materials, "file")} to download`
                          : "Everything the tutor teaches from, in writing. Read it instead of listening, or alongside"
                      }
                    />
                  ) : null}
                  {module.quiz_questions > 0 ? (
                    <Row
                      icon="✅"
                      label="Practice quiz"
                      detail={`${counted(module.quiz_questions, "question")}, retake as often as you like`}
                    />
                  ) : null}
                  {module.assignments > 0 ? (
                    <Row
                      icon="✍️"
                      label={counted(module.assignments, "Assignment")}
                      detail="Marked the moment you submit"
                    />
                  ) : null}
                </ul>
              </div>
            </Collapse>
          </li>
        );
      })}
    </ul>
  );
}
