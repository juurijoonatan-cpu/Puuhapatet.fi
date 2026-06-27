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

// ─── Door-to-door marketer commission ───────────────────────────────────────
// Marketers (ovelta ovelle -myyjät) earn a PROGRESSIVE commission: a share of
// the FINAL agreed deal value, capped at a roof. This is intentionally simple:
//   • bigger gig value → bigger commission (up to the roof), and
//   • if the marketer discounts the price to close, the final value is lower,
//     so the commission drops proportionally — no separate discount rule needed.
// Tune the whole model with these two constants.
export const MARKETER_COMMISSION_RATE = 0.05;        // 5 % of the closed deal value
export const MARKETER_COMMISSION_CAP_CENTS = 4000;   // 40,00 € roof

/** Progressive marketer commission (cents) for a closed deal of the given value
 *  (in cents). A share of the final price, capped at the roof. */
export function marketerCommissionCents(dealValueCents: number): number {
  const c = Math.round(Math.max(0, dealValueCents || 0) * MARKETER_COMMISSION_RATE);
  return Math.min(MARKETER_COMMISSION_CAP_CENTS, c);
}

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

/**
 * The full billed total of a job, in cents.
 *
 * For taloyhtiö (housing-company) gigs `agreedPrice` is the price *per
 * apartment* ("Hinta per asunto"), and the real bill is that price times the
 * number of apartments (`unitCount`). For every other job `agreedPrice` is
 * already the full total. All revenue / service-fee / tax math must go through
 * this helper so taloyhtiö gigs aren't undercounted by a factor of unitCount.
 */
export function effectiveJobTotal(job: {
  agreedPrice: number;
  unitCount?: number | null;
  isTaloyhtiio?: boolean | null;
}): number {
  const price = job.agreedPrice ?? 0;
  if (job.isTaloyhtiio && job.unitCount && job.unitCount > 1) {
    return price * job.unitCount;
  }
  return price;
}
