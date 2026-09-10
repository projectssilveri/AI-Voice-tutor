import { apiFetch } from "@/lib/api";
import { API_V1, env } from "@/lib/env";

/** A PDF attached to a module. */
export interface Material {
  id: string;
  module_id: string;
  filename: string;
  size_bytes: number;
  content_type: string;
  created_at: string;
}

export interface ExtractedText {
  material_id: string;
  text: string | null;
  characters: number;
}

/** 20 MB — mirrors MAX_BYTES in the backend service. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const authed = { withCredentials: true } as const;

export function listMaterials(moduleId: string) {
  return apiFetch<Material[]>(`/modules/${moduleId}/materials`, authed);
}

export function getExtractedText(materialId: string) {
  return apiFetch<ExtractedText>(`/materials/${materialId}/text`, authed);
}

export function deleteMaterial(materialId: string) {
  return apiFetch<void>(`/materials/${materialId}`, {
    ...authed,
    method: "DELETE",
  });
}

/**
 * A plain URL the browser opens itself, so its own PDF viewer handles the file
 * and the session cookie rides along with the navigation. Nothing has to be
 * buffered in memory here.
 */
export function materialUrl(materialId: string): string {
  return `${env.apiBaseUrl}${API_V1}/materials/${materialId}/download`;
}

/**
 * Upload a PDF.
 *
 * Deliberately NOT using `apiFetch`: that sets a JSON Content-Type, and a
 * multipart body needs the browser to set its own — including the boundary it
 * generates. Setting the header by hand produces a body the server cannot
 * parse, with a confusing 422 as the only clue.
 */
export async function uploadMaterial(
  moduleId: string,
  file: File,
): Promise<Material> {
  const body = new FormData();
  body.append("file", file);

  const response = await fetch(
    `${env.apiBaseUrl}${API_V1}/modules/${moduleId}/materials`,
    { method: "POST", credentials: "include", body },
  );

  if (!response.ok) {
    let detail = `Upload failed (${response.status})`;
    try {
      const parsed = await response.json();
      if (typeof parsed?.detail === "string") detail = parsed.detail;
    } catch {
      // A non-JSON error body is still a failure; the status is enough.
    }
    throw new Error(detail);
  }
  return (await response.json()) as Material;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
