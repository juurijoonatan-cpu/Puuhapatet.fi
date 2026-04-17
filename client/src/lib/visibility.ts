/**
 * Ownership / visibility helpers
 *
 * A user "owns" a job when they're in its assignedTo list.
 * A user "owns" a customer when they own at least one of that customer's jobs.
 *
 * STAFF users can only see their owned customers/jobs. HOST users default to
 * their owned view but can toggle to see everything.
 */

import { USERS } from "./admin-profile";

/** Normalize assignedTo string (IDs or legacy full names) to array of user IDs. */
export function parseWorkerIds(assignedTo: string | null | undefined): string[] {
  if (!assignedTo) return [];
  return assignedTo
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const byName = USERS.find((u) => u.name === s);
      return byName ? byName.id : s;
    });
}

/** Is this job assigned to the given user? */
export function isMyJob(
  assignedTo: string | null | undefined,
  userId: string,
): boolean {
  return parseWorkerIds(assignedTo).includes(userId);
}

/** Set of customer IDs the user has at least one job on, or directly owns. */
export function getMyCustomerIds(
  jobs: { customerId: number; assignedTo: string | null | undefined }[],
  customers: { id: number; ownedBy?: string | null }[],
  userId: string,
): Set<number> {
  const ids = new Set<number>();
  for (const j of jobs) {
    if (isMyJob(j.assignedTo, userId)) ids.add(j.customerId);
  }
  for (const c of customers) {
    if (c.ownedBy === userId) ids.add(c.id);
  }
  return ids;
}
