"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import OrgShell from "@/components/org/OrgShell";
import { Action } from "@/components/ui/Action";
import EmptyState from "@/components/ui/EmptyState";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { counted } from "@/lib/plural";
import {
  type DocumentVisibility,
  type OrgDocument,
  type OrgProfile,
  type OrgStructure,
  deleteOrgDocument,
  fileSize,
  getOrgProfile,
  getOrgStructure,
  listOrgDocuments,
  orgDocumentUrl,
  uploadOrgDocument,
} from "@/lib/orgPortal";

const FIELD =
  "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/25 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

const VISIBILITY_TONE: Record<DocumentVisibility, string> = {
  organization: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  branch:
    "bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-400",
  department:
    "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-400",
};

/**
 * The organization's document library.
 *
 * Who sees what is decided server-side and applied as a SQL filter — a payroll
 * procedure never reaches the browser of someone outside payroll. What this
 * page adds is telling an admin, at a glance, which audience each file is for,
 * because uploading a policy to the wrong scope is the mistake that matters
 * here and it is invisible once made.
 */
export default function OrgDocumentsPage() {
  const { slug } = useParams<{ slug: string }>();
  const fileInput = useRef<HTMLInputElement>(null);

  const [profile, setProfile] = useState<OrgProfile | null>(null);
  const [documents, setDocuments] = useState<OrgDocument[]>([]);
  const [structure, setStructure] = useState<OrgStructure | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    visibility: "organization" as DocumentVisibility,
    branch_id: "",
    department_id: "",
  });
  const [file, setFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, d, s] = await Promise.all([
        getOrgProfile(slug),
        listOrgDocuments(slug),
        getOrgStructure(slug),
      ]);
      setProfile(p);
      setDocuments(d.documents);
      setStructure(s);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not load documents.",
      );
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      await load();
    } catch (caught) {
      // The backend's message verbatim: "That file is not a PDF." is exactly
      // what the person needs to read.
      setError(caught instanceof Error ? caught.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  // A DEPARTMENT ADMIN KEEPS THEIR DEPARTMENT'S LIBRARY. Writing the course
  // while having to ask somebody else to upload its source document is half a
  // role. `canWrite` is "may upload at all"; whether a particular file is
  // theirs to remove is `document.can_edit`, decided per row by the server.
  const canWrite = profile?.can_author ?? false;
  const isDeptAdmin = profile?.is_dept_admin ?? false;
  // A BRANCH MANAGER asks for their branch's files. The server files every
  // upload of theirs against their own branch, the way it files a department
  // admin's against their department.
  const isBranchManager = profile?.is_branch_manager ?? false;
  // DELETES AT ONCE: the org admin and platform staff. A department admin or
  // branch manager asks, and the org admin approves (2026-10-01).
  const staff =
    (profile?.is_org_admin ?? false) || (profile?.is_platform_staff ?? false);

  // Departments narrowed to the chosen branch, plus the organization-wide
  // ones — a department under another branch is not a valid choice.
  const departments = structure?.departments ?? [];

  function scopeLabel(document: OrgDocument): string {
    if (document.visibility === "organization") return "Everyone";
    if (document.visibility === "branch") {
      return (
        structure?.branches.find((b) => b.id === document.branch_id)?.name ??
        "One branch"
      );
    }
    return (
      departments.find((d) => d.id === document.department_id)?.name ??
      "One department"
    );
  }

  return (
    <OrgShell
      slug={slug}
      organizationName={profile?.name}
      role={profile?.my_role}
      isAdmin={profile?.is_org_admin}
      canManagePeople={profile?.can_manage_people}
      canAuthor={profile?.can_author}
      isPlatformStaff={profile?.is_platform_staff}
    >
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-title-sm font-bold text-gray-800 dark:text-white/90">
            Documents
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {loading
              ? "Loading…"
              : isDeptAdmin
                ? `${counted(documents.length, "document")} you can see: your department's, and the ones shared with everybody.`
                : isBranchManager
                  ? `${counted(documents.length, "document")} you can see: ${profile?.branch_name ?? "your branch"}'s, and the ones shared with everybody.`
                  : canWrite
                  ? `${counted(documents.length, "document")} in your library.`
                  : "Policies and handbooks shared with you."}
          </p>
        </div>
        {canWrite && !adding ? (
          <Action onClick={() => setAdding(true)}>Upload a PDF</Action>
        ) : null}
      </div>

      {error ? (
        <div
          role="alert"
          className="mb-6 rounded-2xl border border-error-500 bg-error-50 p-4 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-400"
        >
          {error}
        </div>
      ) : null}
      {notice ? (
        <div
          role="status"
          className="mb-6 rounded-2xl border border-success-500 bg-success-50 p-4 text-sm text-success-700 dark:bg-success-500/10 dark:text-success-400"
        >
          {notice}
        </div>
      ) : null}

      {adding && canWrite ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!file) {
              setError("Choose a PDF first.");
              return;
            }
            setNotice(null);
            void run(async () => {
              const result = await uploadOrgDocument(slug, file, {
                title: form.title.trim() || file.name,
                description: form.description,
                // A branch manager's file is their branch's; the server
                // forces it either way, this only says the same thing.
                visibility: isBranchManager ? "branch" : form.visibility,
                branch_id: isBranchManager
                  ? (profile?.branch_id ?? null)
                  : form.branch_id || null,
                department_id: isBranchManager
                  ? null
                  : form.department_id || null,
              });
              setForm({
                title: "",
                description: "",
                visibility: "organization",
                branch_id: "",
                department_id: "",
              });
              setFile(null);
              if (fileInput.current) fileInput.current.value = "";
              setAdding(false);
              // A department admin's upload is held back: say so, because the
              // file will not appear in the list below until the org admin
              // approves it.
              if (result.requested) {
                setNotice(
                  result.message ??
                    "Your document was sent to the organisation administrator to approve.",
                );
              }
            });
          }}
          className="mb-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-raised dark:border-gray-800 dark:bg-white/[0.03]"
        >
          <h2 className="mb-4 text-base font-semibold text-gray-800 dark:text-white/90">
            Upload a document
          </h2>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
                PDF file
              </label>
              <input
                ref={fileInput}
                type="file"
                accept="application/pdf,.pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-gray-600 file:mr-4 file:rounded-lg file:border-0 file:bg-brand-500 file:px-4 file:py-2.5 file:text-sm file:font-medium file:text-white hover:file:bg-brand-600 dark:text-gray-400"
                required
              />
              {/* The accept attribute is a convenience, not a check — the
                  server decides what a PDF is by its first five bytes. */}
              <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                PDFs only, up to 20 MB. Checked on the server, so renaming a
                file will not get it through.
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
                Title
              </label>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder={file?.name ?? "Code of Conduct"}
                className={FIELD}
              />
            </div>

            {/* TOLD, NOT ASKED, for a department admin. The server files
                every upload of theirs against their own department, so the
                only choice this picker could offer them is one that gets
                overridden — and the option that matters, "everyone in the
                organization", is precisely the one they must not have. */}
            {isDeptAdmin ? (
              <p className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-400">
                Visible to{" "}
                <span className="font-medium text-gray-800 dark:text-white/90">
                  {profile?.department_name ?? "your department"}
                </span>
                . Nobody outside it will see this file.
              </p>
            ) : isBranchManager ? (
              <p className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-400">
                Visible to{" "}
                <span className="font-medium text-gray-800 dark:text-white/90">
                  {profile?.branch_name ?? "your branch"}
                </span>
                . Nobody outside it will see this file, and it is added once
                the organisation administrator approves it.
              </p>
            ) : (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
                  Who can see it
                </label>
                <select
                  value={form.visibility}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      visibility: e.target.value as DocumentVisibility,
                      branch_id: "",
                      department_id: "",
                    })
                  }
                  className={FIELD}
                >
                  <option value="organization">
                    Everyone in the organization
                  </option>
                  <option value="branch">One branch</option>
                  <option value="department">One department</option>
                </select>
              </div>
            )}

            {form.visibility === "branch" && !isDeptAdmin && !isBranchManager ? (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
                  Branch
                </label>
                <select
                  value={form.branch_id}
                  onChange={(e) =>
                    setForm({ ...form, branch_id: e.target.value })
                  }
                  className={FIELD}
                  required
                >
                  <option value="">Choose a branch…</option>
                  {structure?.branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {form.visibility === "department" &&
            !isDeptAdmin &&
            !isBranchManager ? (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
                  Department
                </label>
                <select
                  value={form.department_id}
                  onChange={(e) =>
                    setForm({ ...form, department_id: e.target.value })
                  }
                  className={FIELD}
                  required
                >
                  <option value="">Choose a department…</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                      {d.branch_name ? ` · ${d.branch_name}` : " · org-wide"}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="md:col-span-2">
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
                Description{" "}
                <span className="font-normal text-gray-500 dark:text-gray-400">
                  (optional)
                </span>
              </label>
              <input
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                className={FIELD}
              />
            </div>
          </div>

          <div className="mt-5 flex gap-3">
            <Action type="submit" loading={busy}>
              {staff ? "Upload" : "Ask to upload"}
            </Action>
            <Action variant="secondary" onClick={() => setAdding(false)}>
              Cancel
            </Action>
          </div>
        </form>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-raised dark:border-gray-800 dark:bg-white/[0.03]">
        {loading ? (
          <SkeletonRows rows={4} columns={3} />
        ) : documents.length === 0 ? (
          <EmptyState
            icon="📄"
            title={
              canWrite ? "No documents yet" : "Nothing shared with you yet"
            }
            body={
              canWrite
                ? isDeptAdmin
                  ? "Upload the handbooks and procedures your team needs. Everything you add here is for your department only."
                  : isBranchManager
                    ? "Ask to add the handbooks and procedures your branch needs. Everything you add here is for your branch only, once the organisation administrator approves it."
                    : "Upload your policies, handbooks and procedures. You choose whether each one is for everyone, one branch, or one department."
                : "Your administrator has not shared any documents with you yet."
            }
            action={
              canWrite && !adding ? (
                <Action onClick={() => setAdding(true)}>Upload a PDF</Action>
              ) : null
            }
            className="border-0"
          />
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {documents.map((document) => (
              <li
                key={document.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4"
              >
                <span aria-hidden="true" className="shrink-0 text-2xl">
                  📄
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-800 dark:text-white/90">
                    {document.title}
                  </p>
                  <p className="truncate text-sm text-gray-500 dark:text-gray-400">
                    {document.description ? `${document.description} · ` : ""}
                    {fileSize(document.size_bytes)}
                    {!document.has_text ? " · no readable text" : ""}
                  </p>
                </div>

                <span
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    VISIBILITY_TONE[document.visibility]
                  }`}
                >
                  {scopeLabel(document)}
                </span>

                <a
                  href={orgDocumentUrl(slug, document.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.04]"
                >
                  Open
                </a>

                {canWrite && document.can_edit ? (
                  <Action
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      // THE ORG ADMIN AND PLATFORM STAFF DELETE AT ONCE; a
                      // department admin asks, with a reason, and the org admin
                      // approves (`services/org_changes`, 2026-10-01).
                      setNotice(null);
                      if (staff) {
                        if (
                          !window.confirm(
                            `Delete "${document.title}"? This cannot be undone.`,
                          )
                        ) {
                          return;
                        }
                        void run(() => deleteOrgDocument(slug, document.id));
                        return;
                      }
                      const answer = window.prompt(
                        `Ask to delete "${document.title}"?\n\nNothing is removed until the organisation administrator approves it.\n\nWhy should it be deleted?`,
                        "",
                      );
                      if (answer === null) return;
                      if (!answer.trim()) {
                        setError("Say why it should be deleted. The request needs a reason.");
                        return;
                      }
                      void run(async () => {
                        await deleteOrgDocument(slug, document.id, answer.trim());
                        setNotice(
                          `Asked to delete "${document.title}". Nothing is removed until the organisation administrator approves it.`,
                        );
                      });
                    }}
                  >
                    {staff ? "Delete" : "Ask to delete"}
                  </Action>
                ) : canWrite ? (
                  /* Said, rather than left as a gap. A row identical to an
                     editable one minus its button reads as a bug. */
                  <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
                    Read only
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </OrgShell>
  );
}
