"use client";

import AdminHome from "@/components/dashboard/AdminHome";
import StudentHome from "@/components/dashboard/StudentHome";
import { useAuth } from "@/context/AuthContext";

/**
 * One dashboard URL for everybody.
 *
 * Student, admin and super admin sign in through the same page and land here;
 * what changes is the content, not the shell. That keeps it one product rather
 * than three, and means nobody has to be told which URL is "theirs".
 *
 * Choosing the view from the role here is convenience. Every figure on either
 * view comes from an endpoint that re-checks the role server-side, so a
 * student who somehow rendered AdminHome would see a page full of 403s rather
 * than anybody's data.
 */
export default function DashboardPage() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 animate-pulse rounded-lg bg-gray-100 dark:bg-white/[0.04]" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
          {[0, 1, 2, 3, 4, 5].map((n) => (
            <div
              key={n}
              className="h-24 animate-pulse rounded-2xl bg-gray-100 dark:bg-white/[0.04]"
            />
          ))}
        </div>
        <div className="h-72 animate-pulse rounded-2xl bg-gray-100 dark:bg-white/[0.04]" />
      </div>
    );
  }

  const isStaff = user?.role === "admin" || user?.role === "super_admin";
  return isStaff ? <AdminHome /> : <StudentHome />;
}
