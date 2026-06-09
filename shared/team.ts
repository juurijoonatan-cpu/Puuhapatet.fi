/**
 * Team roles & service-fee model — shared by client and server.
 *
 * Everyone pays a service fee on their share of each job's net revenue,
 * settled to the brand: founders (HOST) pay 10 %, workers (STAFF) pay 25 %.
 *
 * This is the single source of truth for the fee rates and who counts as a
 * founder. The client profile list (client/src/lib/admin-profile.ts) mirrors
 * these roles with its richer per-user data.
 */

export type TeamRole = "HOST" | "STAFF";

/** Service fee for STAFF workers, as a fraction of their net-revenue share. */
export const STAFF_SERVICE_FEE_RATE = 0.25;

/** Service fee for founders (HOST), as a fraction of their net-revenue share. */
export const HOST_SERVICE_FEE_RATE = 0.10;

/** Whole-number percentages for UI copy, e.g. 25 → "25 %". */
export const STAFF_SERVICE_FEE_PCT = Math.round(STAFF_SERVICE_FEE_RATE * 100);
export const HOST_SERVICE_FEE_PCT = Math.round(HOST_SERVICE_FEE_RATE * 100);

/** Founder (HOST) user IDs. Everyone else is treated as STAFF. */
export const FOUNDER_IDS: readonly string[] = ["joonatan", "matias"];

/** Is this user a founder (HOST)? */
export function isFounder(workerId: string): boolean {
  return FOUNDER_IDS.includes(workerId);
}

/**
 * Service-fee rate for a given worker: 10 % for founders, 25 % otherwise.
 * Unknown IDs default to the STAFF rate (safe default — charge the higher fee).
 */
export function feeRateForWorker(workerId: string): number {
  return isFounder(workerId) ? HOST_SERVICE_FEE_RATE : STAFF_SERVICE_FEE_RATE;
}
