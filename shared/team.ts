/**
 * Team roles & service-fee model — shared by client and server.
 *
 * Everyone pays a service fee on their share of each job's net revenue,
 * settled to the brand:
 *   • founders (HOST) ............... 10 %
 *   • current grandfathered workers . per-person rate (e.g. Petrus 30 %)
 *   • new / upcoming workers (STAFF)  35 %
 *
 * This is the single source of truth for the fee rates and who counts as a
 * founder. The client profile list (client/src/lib/admin-profile.ts) mirrors
 * these roles with its richer per-user data, and the member agreement
 * (shared/member-agreement.ts) quotes the rate returned here.
 */

export type TeamRole = "HOST" | "STAFF";

/** Service fee for new / upcoming STAFF workers, as a fraction of their share. */
export const STAFF_SERVICE_FEE_RATE = 0.35;

/** Service fee for founders (HOST), as a fraction of their net-revenue share. */
export const HOST_SERVICE_FEE_RATE = 0.10;

/**
 * Per-person rates that differ from the STAFF default — current workers whose
 * rate was agreed before the standard rose to 35 % keep their original rate.
 */
export const GRANDFATHERED_FEE_RATES: Readonly<Record<string, number>> = {
  petrus: 0.30,
};

/** Whole-number percentages for UI copy, e.g. 35 → "35 %". */
export const STAFF_SERVICE_FEE_PCT = Math.round(STAFF_SERVICE_FEE_RATE * 100);
export const HOST_SERVICE_FEE_PCT = Math.round(HOST_SERVICE_FEE_RATE * 100);

/** Founder (HOST) user IDs. Everyone else is treated as STAFF. */
export const FOUNDER_IDS: readonly string[] = ["joonatan", "matias"];

/** Is this user a founder (HOST)? */
export function isFounder(workerId: string): boolean {
  return FOUNDER_IDS.includes(workerId);
}

/**
 * Service-fee rate for a given worker:
 *   • 10 % for founders
 *   • the person's grandfathered rate if one is set (e.g. Petrus 30 %)
 *   • 35 % for everyone else (new / upcoming workers)
 * Unknown IDs default to the STAFF rate (safe default — charge the higher fee).
 */
export function feeRateForWorker(workerId: string): number {
  if (isFounder(workerId)) return HOST_SERVICE_FEE_RATE;
  if (workerId in GRANDFATHERED_FEE_RATES) return GRANDFATHERED_FEE_RATES[workerId];
  return STAFF_SERVICE_FEE_RATE;
}

/** Service-fee rate as a whole-number percentage for the given worker. */
export function feePctForWorker(workerId: string): number {
  return Math.round(feeRateForWorker(workerId) * 100);
}
