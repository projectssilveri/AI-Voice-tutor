"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  MAX_UPLOAD_BYTES,
  type Material,
  deleteMaterial,
  formatBytes,
  getExtractedText,
  listMaterials,
  materialUrl,
  uploadMaterial,
} from "@/lib/materials";
import { counted } from "@/lib/plural";

/**
 * PDF course material for one module, in the authoring screen.
 *
 * The "Use as tutor material" step is deliberately manual. `modules.content`
 * is the single source of what the AI may teach from, and PDF extraction is
 * imperfect — a scanned page yields nothing at all. Copying the text in
 * automatically would let a bad extraction silently become the lesson, so the
 * author is shown what came out and decides.
 */
export default function MaterialUploader({
  moduleId,
  onUseAsContent,
}: {
  moduleId: string;
  /** Called with the PDF's text so the parent can put it in the content box. */
  onUseAsContent?: (text: string) => void;
}) {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setMaterials(await listMaterials(moduleId));
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not load material.",
      );
    } finally {
      setLoading(false);
    }
  }, [moduleId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setNotice(null);

    // Checked here as well as server-side so a 20 MB upload is not sent only
    // to be rejected. The server's check is the one that counts.
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(
        `${file.name} is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`,
      );
      return;
    }

    setUploading(true);
    try {
      const added = await uploadMaterial(moduleId, file);
      setNotice(`Uploaded ${added.filename}.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleUseAsContent(material: Material) {
    setBusyId(material.id);
    setError(null);
    setNotice(null);
    try {
      const extracted = await getExtractedText(material.id);
      if (!extracted.text) {
        setError(
          `No text could be read from ${material.filename}. It is probably a scan, and the tutor cannot teach from an image, so type the material in yourself.`,
        );
        return;
      }
      onUseAsContent?.(extracted.text);
      setNotice(
        `Copied ${extracted.characters.toLocaleString()} characters into the module content. Review it, then save.`,
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not read the text.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(material: Material) {
    setBusyId(material.id);
    try {
      await deleteMaterial(material.id);
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not delete it.",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-raised p-6 dark:border-gray-800 dark:bg-white/[0.03]">
      <h3 className="mb-1 text-base font-semibold text-gray-800 dark:text-white/90">
        Course material (PDF)
      </h3>
      <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
        Handouts students can read alongside the module. Up to{" "}
        {formatBytes(MAX_UPLOAD_BYTES)} each. Uploading does not change what the
        tutor teaches from.
      </p>

      {error ? (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-error-500 bg-error-50 p-3 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400"
        >
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="mb-4 rounded-xl border border-success-500 bg-success-50 p-3 text-sm text-success-700 dark:bg-success-500/10 dark:text-success-400">
          {notice}
        </div>
      ) : null}

      <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600">
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          disabled={uploading}
          onChange={(e) => void handleFile(e.target.files?.[0])}
          className="sr-only"
        />
        {uploading ? "Uploading…" : "Upload a PDF"}
      </label>

      <div className="mt-5">
        {loading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
        ) : materials.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No material yet.
          </p>
        ) : (
          <>
            <p className="mb-2 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {counted(materials.length, "file")}
            </p>
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {materials.map((material) => (
                <li
                  key={material.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <a
                      href={materialUrl(material.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-gray-800 hover:text-brand-500 dark:text-white/90"
                    >
                      {material.filename}
                    </a>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {formatBytes(material.size_bytes)} ·{" "}
                      {new Date(material.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {onUseAsContent ? (
                      <button
                        type="button"
                        onClick={() => void handleUseAsContent(material)}
                        disabled={busyId === material.id}
                        title="Read the PDF's text into the module content box, for you to review"
                        className="rounded-lg border border-brand-500 px-3 py-1.5 text-xs font-medium text-brand-500 dark:text-brand-400 transition hover:bg-brand-50 disabled:opacity-50 dark:hover:bg-brand-500/10"
                      >
                        {busyId === material.id
                          ? "Reading…"
                          : "Use as tutor material"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void handleDelete(material)}
                      disabled={busyId === material.id}
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-white/[0.03]"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
