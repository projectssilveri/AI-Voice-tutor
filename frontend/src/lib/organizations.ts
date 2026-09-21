/**
 * Organizations — the platform super admin's view.
 *
 * Every call here is behind `RequireSuperAdmin` on the backend, WITH ONE
 * EXCEPTION at the bottom of this file. Creating a tenant decides who exists on
 * the platform at all, which puts it with revenue and role management rather
 * than with ordinary admin work (decision 50).
 */

import { apiFetch } from "@/lib/api";

const authed = { withCredentials: true, cache: "no-store" } as const;

export interface Branch {
  id: string;
  name: string;
  is_active: boolean;
  user_count: number;
}

export interface Department {
  id: string;
  name: string;
  /** Null means a company-wide department, not a missing value. */
  branch_id: string | null;
  branch_name: string | null;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  branch_count: number;
  department_count: number;
  user_count: number;
  admin_count: number;
  course_count: number;
}

export interface OrganizationDetail extends Organization {
  branches: Branch[];
  departments: Department[];
  meets_admin_minimum: boolean;
  min_admins: number;
}

const BASE = "/admin/organizations";

export function listOrganizations(): Promise<Organization[]> {
  return apiFetch<Organization[]>(BASE, authed);
}

/** Just enough of an organisation to name it in a dropdown. */
export interface OrganizationName {
  id: string;
  name: string;
}

/**
 * Names and ids, for a platform admin appointing a customer's administrator.
 *
 * THE ONLY CALL IN THIS FILE AN ORDINARY ADMIN MAY MAKE, and it returns two
 * fields on purpose. `listOrganizations` above carries seat counts, admin
 * counts and course counts — a read of how large each customer is and how
 * close to stranded, which is the super admin's business and not something to
 * hand out so somebody can fill in a dropdown.
 */
export function listOrganizationNames(): Promise<OrganizationName[]> {
  return apiFetch<OrganizationName[]>(`${BASE}/names`, authed);
}

export function getOrganization(id: string): Promise<OrganizationDetail> {
  return apiFetch<OrganizationDetail>(`${BASE}/${id}`, authed);
}

export function createOrganization(body: {
  name: string;
  slug: string;
}): Promise<Organization> {
  return apiFetch<Organization>(BASE, { ...authed, method: "POST", body });
}

export function updateOrganization(
  id: string,
  body: { name?: string; is_active?: boolean },
): Promise<Organization> {
  return apiFetch<Organization>(`${BASE}/${id}`, {
    ...authed,
    method: "PATCH",
    body,
  });
}

export function createBranch(
  organizationId: string,
  body: { name: string },
): Promise<Branch> {
  return apiFetch<Branch>(`${BASE}/${organizationId}/branches`, {
    ...authed,
    method: "POST",
    body,
  });
}

export function createDepartment(
  organizationId: string,
  body: { name: string; branch_id?: string | null },
): Promise<Department> {
  return apiFetch<Department>(`${BASE}/${organizationId}/departments`, {
    ...authed,
    method: "POST",
    body,
  });
}

/**
 * Suggest a slug from a name, matching the backend's rules.
 *
 * Only a suggestion — the field stays editable, and the backend validates and
 * normalises independently. Two implementations of one rule is a drift risk, so
 * this deliberately only *offers* a value rather than deciding it: if the two
 * ever disagree, the backend wins and says why.
 */
export function suggestSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents; the backend is ASCII-only
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/, "");
}

// ---------------------------------------------------------------------------
// What a customer is allowed
// ---------------------------------------------------------------------------

/**
 * Null means UNLIMITED, everywhere — the state every organization was in before
 * limits existed. Zero is a real limit meaning "none allowed", which is exactly
 * why the absent case cannot be zero.
 */
export interface OrganizationLimitsInput {
  max_members?: number | null;
  max_ai_minutes_per_month?: number | null;
  max_modules_per_course?: number | null;
  plan_note?: string | null;
}

export interface OrganizationUsage {
  members_used: number;
  members_allowed: number | null;
  members_remaining: number | null;
  ai_minutes_used: number;
  ai_minutes_allowed: number | null;
  ai_minutes_remaining: number | null;
  /** Always a number: the platform default applies when there is no override. */
  max_modules_per_course: number;
  plan_note: string | null;
}

export function getOrganizationLimits(
  organizationId: string,
): Promise<OrganizationUsage> {
  return apiFetch<OrganizationUsage>(`${BASE}/${organizationId}/limits`, {
    withCredentials: true,
    cache: "no-store",
  });
}

export function setOrganizationLimits(
  organizationId: string,
  input: OrganizationLimitsInput,
): Promise<OrganizationUsage> {
  return apiFetch<OrganizationUsage>(`${BASE}/${organizationId}/limits`, {
    withCredentials: true,
    method: "PATCH",
    body: input,
  });
}
