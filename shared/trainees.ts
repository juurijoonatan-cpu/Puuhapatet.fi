/**
 * Trainees (harjoittelijat) — workers who are NOT independent subcontractors.
 *
 * A trainee works UNDER a named leader's responsibility (e.g. Milja under Matias).
 * Legally this is different from an alihankkija:
 *   • the trainee does NOT need an own Y-tunnus and does NOT invoice us,
 *   • the responsible leader carries the responsibility for them on the gig,
 *   • their earnings are pooled with the leaders' and split like other staff —
 *     they don't go through the alihankkija payout/invoice/withholding flow.
 *
 * So a trainee skips the subcontractor agreement + tax/insurance self-liability
 * cards, and instead sees a simple "you're a trainee under <leader>" note.
 *
 * Matched to a crew member by the linked login id (linkedUserId / id) or, as a
 * fallback, the first name — so it works even before linkedUserId is set.
 */

export interface TraineeInfo {
  /** Login user id (admin-profile), e.g. "milja". */
  userId: string;
  name: string;
  /** The leader who is responsible for this trainee on the gig. */
  responsibleLeaderId: string;
  responsibleLeaderName: string;
}

export const TRAINEES: TraineeInfo[] = [
  {
    userId: "milja",
    name: "Milja Niminen",
    responsibleLeaderId: "matias",
    responsibleLeaderName: "Matias Pitkänen",
  },
];

function norm(s?: string | null): string {
  return (s || "").trim().toLowerCase();
}

/** Trainee for an explicit login id (linkedUserId or crew id). */
export function traineeForUserId(id?: string | null): TraineeInfo | undefined {
  const k = norm(id);
  return k ? TRAINEES.find((t) => t.userId === k) : undefined;
}

/** Trainee by first name (fallback when no link is set), e.g. "Milja …" → milja. */
export function traineeForName(name?: string | null): TraineeInfo | undefined {
  const first = norm(name).split(/\s+/)[0];
  return first ? TRAINEES.find((t) => t.userId === first) : undefined;
}

export function isTraineeUserId(id?: string | null): boolean {
  return !!traineeForUserId(id);
}
