/**
 * Dashboard numbers.
 *
 * Three endpoints, three audiences. `/revenue` 403s for anyone below super
 * admin — the UI hides the tiles as well, but that is presentation; the 403 is
 * what actually protects the figures.
 */

import { apiFetch } from "@/lib/api";

const authed = { withCredentials: true, cache: "no-store" } as const;

export interface DayPoint {
  day: string;
  value: number;
}

export interface NamedValue {
  label: string;
  value: number;
}

export interface MyProgress {
  modules_completed: number;
  modules_in_progress: number;
  modules_total: number;
  courses_enrolled: number;
  voice_minutes: number;
  /** The same time in seconds; show it with `tutorTime`. */
  voice_seconds?: number;
  questions_asked: number;
  quizzes_taken: number;
  best_quiz_score: number | null;
  certificates_earned: number;
  current_streak_days: number;
  activity: DayPoint[];
  minutes_per_course: NamedValue[];
  /** The module touched most recently, for "Continue learning". */
  last_module: {
    course_id: string;
    course_title: string;
    module_id: string;
    module_title: string;
    status: string;
    module_number: number;
    module_count: number;
  } | null;
}

export interface LeaderboardRow {
  user_id: string;
  name: string;
  email: string;
  modules_completed: number;
  voice_minutes: number;
  /** The same time in seconds; show it with `tutorTime`. */
  voice_seconds?: number;
  certificates: number;
  score: number;
}

export interface PlatformAnalytics {
  total_students: number;
  active_students_30d: number;
  students_who_used_tutor: number;
  total_enrolments: number;
  modules_completed: number;
  certificates_issued: number;
  cert_pass_rate: number;
  total_voice_minutes: number;
  total_voice_seconds?: number;
  total_interruptions: number;
  signups_per_day: DayPoint[];
  voice_minutes_per_day: DayPoint[];
  enrolments_per_course: NamedValue[];
  completion_rate_per_course: NamedValue[];
  leaderboard: LeaderboardRow[];
}

export interface RecentOrder {
  id: string;
  user_name: string;
  user_email: string;
  item: string;
  amount_minor: number;
  currency: string;
  status: string;
  created_at: string;
}

export interface RevenueAnalytics {
  currency: string;
  gross_minor: number;
  refunded_minor: number;
  net_minor: number;
  paid_orders: number;
  failed_orders: number;
  conversion_rate: number;
  revenue_per_day: DayPoint[];
  revenue_per_course: NamedValue[];
  recent_orders: RecentOrder[];
}

export function getMyProgress(days = 30): Promise<MyProgress> {
  return apiFetch<MyProgress>(`/analytics/me?days=${days}`, authed);
}

export function getPlatformAnalytics(days = 30): Promise<PlatformAnalytics> {
  return apiFetch<PlatformAnalytics>(
    `/analytics/platform?days=${days}`,
    authed,
  );
}

export function getRevenueAnalytics(days = 30): Promise<RevenueAnalytics> {
  return apiFetch<RevenueAnalytics>(`/analytics/revenue?days=${days}`, authed);
}

/** "2026-08-11" -> "11 Aug", for chart axes. */
export function shortDay(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
