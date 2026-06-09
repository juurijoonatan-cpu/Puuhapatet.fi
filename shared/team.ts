/**
 * Team roles & service-fee model — shared by client and server.
 *
 * Founders (HOST) own the brand and keep 100 % of their jobs — no service fee.
 * Workers (STAFF) pay a service fee on their share of each job's net revenue;
 * that fee is settled to the brand (Joonatan / Matias).
 *
 * This is the single source of truth for the fee rate and who counts as a
 * founder. The client profile list (client/src/lib/admin-profile.ts) mirrors
 * these roles with its richer per-user data.
 */

export type TeamRole = "HOST" | "STAFF";

/** Service fee charged to STAFF workers, as a fraction of their net-revenue share. */
export const STAFF_SERVICE_FEE_RATE = 0.25;

/** Whole-number percentage for UI copy, e.g. 25 → "25 %". */
export const STAFF_SERVICE_FEE_PCT = Math.round(STAFF_SERVICE_FEE_RATE * 100);

/** Founder (HOST) user IDs. Everyone else is treated as STAFF. */
export const FOUNDER_IDS: readonly string[] = ["joonatan", "matias"];

/** Is this user a founder (HOST)? Founders pay no service fee. */
export function isFounder(workerId: string): boolean {
  return FOUNDER_IDS.includes(workerId);
}

/**
 * Service-fee rate for a given worker: 0 for founders, the STAFF rate otherwise.
 * Unknown IDs default to the STAFF rate (safe default — charge the fee).
 */
export function feeRateForWorker(workerId: string): number {
  return isFounder(workerId) ? 0 : STAFF_SERVICE_FEE_RATE;
}
