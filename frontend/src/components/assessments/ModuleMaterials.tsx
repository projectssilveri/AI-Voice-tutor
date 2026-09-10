"use client";

import { useEffect, useState } from "react";

import {
  type Material,
  formatBytes,
  listMaterials,
  materialUrl,
} from "@/lib/materials";

/**
 * The lesson in written form: the notes the tutor teaches from, and any files
 * attached to the module.
 *
 * ONE SECTION, NOT TWO. The notes used to live in a separate collapsed block
 * called "Show module material", while this panel held only PDF attachments —
 * of which there are none on any module, so the panel never rendered and the
 * written lesson was hidden behind a toggle further down the page. The half
 * with the actual content in it was the half nobody could find.
 *
 * Still silent when a module has neither: an empty panel on every module is a
 * standing reminder of something missing. A failed load is silent too — these
 * are supplementary, and an error banner under the tutor would suggest the
 * lesson itself had broken.
 */
export default function ModuleMaterials({
  moduleId,
  notes,
}: {
  moduleId: string;
  /** `modules.content` — what the tutor teaches from. */
  notes?: string | null;
}) {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const found = await listMaterials(moduleId);
        if (!cancelled) setMaterials(found);
      } catch {
        // Supplementary content; the module still works without it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [moduleId]);

  const written = notes?.trim() ?? "";
  if (!written && materials.length === 0) return null;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-raised p-6 dark:border-gray-800 dark:bg-white/[0.03]">
      <h2 className="mb-1 text-base font-semibold text-gray-800 dark:text-white/90">
        Documents
      </h2>
      <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
        Everything the tutor teaches from, in writing. Read it instead of
        listening, or alongside. As often as you like.
      </p>

      {written ? (
        <div className="mb-4">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="flex w-full items-center justify-between gap-3 rounded-xl border border-gray-200 px-4 py-3 text-left transition hover:border-brand-300 hover:bg-brand-25 dark:border-gray-800 dark:hover:border-brand-700 dark:hover:bg-brand-500/10"
          >
            <span className="flex min-w-0 items-center gap-3">
              <span
                aria-hidden="true"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-xs font-bold text-brand-600 dark:bg-brand-500/15 dark:text-brand-400"
              >
                TXT
              </span>
              <span className="min-w-0">
                <span className="block truncate font-medium text-gray-800 dark:text-white/90">
                  Module notes
                </span>
                <span className="block text-xs text-gray-500 dark:text-gray-400">
                  {/* A word count rather than a character one: it is the
                      figure a reader can turn into "how long will this take".
                      Roughly 200 words a minute, silently. */}
                  {written.split(/\s+/).length.toLocaleString()} words
                </span>
              </span>
            </span>
            <span
              aria-hidden="true"
              className="shrink-0 text-gray-500 dark:text-gray-400"
            >
              {open ? "Hide" : "Read"}
            </span>
          </button>
          {open ? (
            <div className="mt-3 whitespace-pre-wrap rounded-xl bg-gray-50 p-4 text-sm leading-relaxed text-gray-700 dark:bg-white/[0.03] dark:text-gray-300">
              {written}
            </div>
          ) : null}
        </div>
      ) : null}

      <ul className="space-y-2">
        {materials.map((material) => (
          <li key={material.id}>
            <a
              href={materialUrl(material.id)}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center justify-between gap-3 rounded-xl border border-gray-200 px-4 py-3 transition hover:border-brand-300 hover:bg-brand-25 dark:border-gray-800 dark:hover:border-brand-700 dark:hover:bg-brand-500/10"
            >
              <span className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-error-50 text-xs font-bold text-error-600 dark:bg-error-500/15 dark:text-error-400"
                >
                  PDF
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium text-gray-800 group-hover:text-brand-600 dark:text-white/90 dark:group-hover:text-brand-400">
                    {material.filename}
                  </span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400">
                    {formatBytes(material.size_bytes)}
                  </span>
                </span>
              </span>
              <span className="shrink-0 text-sm font-medium text-brand-500 dark:text-brand-400">
                Open ↗<span className="sr-only"> (opens in a new tab)</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
