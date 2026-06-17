/**
 * Gig crew — hard-coded workers for a custom gig, each with their own private
 * shareable link (token) and a worker-only dashboard.
 *
 * The crew lives INSIDE the gig's ProjectData (jobs.project_data JSON) so it
 * needs no schema migration and travels with the floor-plan map it attributes
 * work to. Window attribution already exists in ProjectData.washedBy (key →
 * worker id) and ProjectData.hours (worker id → hours); a CrewMember.id is the
 * same id used there, so a worker's earnings are simply their washed windows ×
 * their per-window pay rate.
 *
 * Workers are paid per pesty window (default 20 € / window) — a rate kept
 * SEPARATE from ProjectData.pricePerWindow (the customer/gig price). Workers
 * never see the gig price or cap; they only ever see their own rate × windows.
 */

import type { ProjectData } from "./project";
import { allPoints } from "./project";

export const DEFAULT_WORKER_PER_WINDOW_CENTS = 2000; // 20,00 €

export type CrewRole = "worker" | "host";

export interface CrewProfile {
  fullName?: string;
  phone?: string;
  email?: string;
  city?: string;
  yTunnus?: string;
  iban?: string;
  /** Free-text answers to the prebaked profile questions, keyed by question id. */
  answers?: Record<string, string>;
}

export interface CrewAgreementSignature {
  agreementId: string;          // "alihankinta" | "tietoturva" | "jatko"
  version: string;
  signedAt: number;             // epoch ms
  signerName: string;
  signatureDataUrl: string;     // PNG data URL
  acceptedClauseIds?: string[];
  ip?: string;                  // filled server-side
  userAgent?: string;           // filled server-side
}

export interface CrewNote {
  t: number;
  text: string;
}

/**
 * A payout from Puuhapatet → the worker (alihankkija) for work done.
 *
 * This is the OPPOSITE direction from the customer invoicing in gig-tracker:
 * here Puuhapatet pays the subcontractor, who then issues their own invoice
 * (their Y-tunnus) back to Puuhapatet. The bank transfer itself is MANUAL —
 * the system only tracks state + generates the worker's invoice document.
 *
 * Flow / status:
 *  - "ilmoitettu"  : Puuhapatet created a payout notification for the worker.
 *  - "hyvaksytty"  : the worker confirmed the amount + their billing details.
 *  - "maksettu"    : Puuhapatet paid it manually in the bank -> worker invoice
 *                    auto-generated (PDF) and emailed to the team.
 */
export type CrewPayoutStatus = "ilmoitettu" | "hyvaksytty" | "maksettu";

export interface CrewPayout {
  id: string;                   // stable id
  amountCents: number;          // gross amount paid to the worker
  windows: number;              // windows this payout covers (informational)
  note?: string;                // free-text (e.g. "FR8 - 1. era")
  status: CrewPayoutStatus;
  createdAt: number;            // when the notification was created
  approvedAt?: number;          // when the worker confirmed
  paidAt?: number;              // when marked paid (bank transfer done)
  invoiceNo?: string;           // the worker's invoice number once paid
  // Billing snapshot captured at approval (worker's own details for their invoice).
  billing?: {
    name?: string;
    yTunnus?: string;
    iban?: string;
    address?: string;
  };
}

export interface CrewMember {
  id: string;                   // stable worker id (matches washedBy / hours)
  token: string;                // secret link token (the worker's private URL)
  name: string;                 // display name (placeholder, editable by hosts)
  role: CrewRole;               // "worker" | "host"
  adminLinked?: boolean;        // true = also a Puuhapatet admin user (e.g. Petrus)
  perWindowCents: number;       // worker pay per pesty window, in cents
  active: boolean;
  pinHash?: string;             // optional 4-digit PIN, sha-256 hex (server-set)
  profile?: CrewProfile;
  agreements: CrewAgreementSignature[];
  onboardedAt?: number;         // when profile + agreements were completed
  notes: CrewNote[];
  payouts?: CrewPayout[];       // Puuhapatet -> worker payments (newest-first)
  createdAt: number;
}

// ─── Token generation ──────────────────────────────────────────────────────────

const TOKEN_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // no ambiguous chars

export function newCrewToken(rand: () => number = Math.random): string {
  let s = "";
  for (let i = 0; i < 14; i++) s += TOKEN_ALPHABET[Math.floor(rand() * TOKEN_ALPHABET.length)];
  return s;
}

// ─── Lookups & derived values ────────────────────────────────────────────────

export function getCrew(project: ProjectData | null | undefined): CrewMember[] {
  return Array.isArray(project?.crew) ? (project!.crew as CrewMember[]) : [];
}

export function findCrewByToken(project: ProjectData | null | undefined, token: string): CrewMember | undefined {
  if (!token) return undefined;
  return getCrew(project).find((m) => m.token === token);
}

export function findCrewById(project: ProjectData | null | undefined, id: string): CrewMember | undefined {
  return getCrew(project).find((m) => m.id === id);
}

export interface CrewMemberStats {
  washed: number;               // windows attributed to this worker (pesty)
  earnedCents: number;          // washed × perWindowCents
  hours: number;                // logged hours
  windowsPerHour: number;
  eurPerHour: number;
}

/** A worker's own progress: windows they marked pesty × their pay rate. */
export function crewMemberStats(project: ProjectData, member: CrewMember): CrewMemberStats {
  const pts = allPoints(project);
  const washed = pts.filter((p) => p.status === "pesty" && p.washedBy === member.id).length;
  const hours = Math.max(0, project.hours?.[member.id] || 0);
  const earnedCents = washed * member.perWindowCents;
  return {
    washed,
    earnedCents,
    hours,
    windowsPerHour: hours > 0 ? washed / hours : 0,
    eurPerHour: hours > 0 ? earnedCents / 100 / hours : 0,
  };
}

/** Has this worker finished onboarding (profile + every required agreement)? */
export function isOnboarded(member: CrewMember, requiredAgreementIds: string[], version: string): boolean {
  if (!member.onboardedAt) return false;
  return requiredAgreementIds.every((id) =>
    member.agreements.some((a) => a.agreementId === id && a.version === version),
  );
}

// ─── Sanitisation (server-side validation) ─────────────────────────────────────

function str(v: any, max: number): string | undefined {
  if (v == null) return undefined;
  const s = String(v).slice(0, max);
  return s.length ? s : undefined;
}
function clampCents(n: any): number {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) && v > 0 ? Math.min(v, 1_000_00) : DEFAULT_WORKER_PER_WINDOW_CENTS;
}

function sanitizeProfile(input: any): CrewProfile | undefined {
  if (!input || typeof input !== "object") return undefined;
  const answers: Record<string, string> = {};
  if (input.answers && typeof input.answers === "object") {
    for (const k of Object.keys(input.answers).slice(0, 40)) {
      const v = str(input.answers[k], 2000);
      if (v) answers[String(k).slice(0, 40)] = v;
    }
  }
  return {
    fullName: str(input.fullName, 160),
    phone: str(input.phone, 60),
    email: str(input.email, 200),
    city: str(input.city, 120),
    yTunnus: str(input.yTunnus, 40),
    iban: str(input.iban, 40),
    answers: Object.keys(answers).length ? answers : undefined,
  };
}

export const MAX_SIGNATURE_DATAURL_LEN = 300_000; // ~300 KB cap on a signature PNG

function sanitizeAgreement(input: any): CrewAgreementSignature | null {
  if (!input || typeof input !== "object") return null;
  const dataUrl = String(input.signatureDataUrl ?? "");
  const agreementId = String(input.agreementId ?? "").slice(0, 40);
  if (!agreementId || !dataUrl.startsWith("data:image/")) return null;
  // Reject (rather than truncate) an oversized signature — a truncated base64
  // data URL would render as a broken image. The pad keeps exports well under
  // the cap, so this only fires on abuse.
  if (dataUrl.length > MAX_SIGNATURE_DATAURL_LEN) return null;
  return {
    agreementId,
    version: String(input.version ?? "").slice(0, 24) || "?",
    signedAt: Number(input.signedAt) || Date.now(),
    signerName: String(input.signerName ?? "").slice(0, 160),
    signatureDataUrl: dataUrl,
    acceptedClauseIds: Array.isArray(input.acceptedClauseIds)
      ? input.acceptedClauseIds.slice(0, 24).map((x: any) => String(x).slice(0, 40))
      : undefined,
    ip: str(input.ip, 64),
    userAgent: str(input.userAgent, 400),
  };
}

function sanitizePayout(input: any): CrewPayout | null {
  if (!input || typeof input !== "object") return null;
  const id = String(input.id ?? "").slice(0, 40).trim();
  const amountCents = Math.floor(Number(input.amountCents));
  if (!id || !Number.isFinite(amountCents) || amountCents <= 0) return null;
  const status: CrewPayoutStatus =
    input.status === "maksettu" ? "maksettu" : input.status === "hyvaksytty" ? "hyvaksytty" : "ilmoitettu";
  const b = input.billing && typeof input.billing === "object" ? input.billing : null;
  return {
    id,
    amountCents: Math.min(amountCents, 1_000_000_00),
    windows: Math.max(0, Math.floor(Number(input.windows) || 0)),
    note: str(input.note, 200),
    status,
    createdAt: Number(input.createdAt) || Date.now(),
    approvedAt: input.approvedAt ? Number(input.approvedAt) || undefined : undefined,
    paidAt: input.paidAt ? Number(input.paidAt) || undefined : undefined,
    invoiceNo: str(input.invoiceNo, 40),
    billing: b ? {
      name: str(b.name, 160),
      yTunnus: str(b.yTunnus, 40),
      iban: str(b.iban, 40),
      address: str(b.address, 240),
    } : undefined,
  };
}

/** Total of all paid-out payouts (cents) for a worker. */
export function totalPaidPayoutCents(member: CrewMember): number {
  return (member.payouts || []).filter((p) => p.status === "maksettu").reduce((s, p) => s + p.amountCents, 0);
}

export function sanitizeCrewMember(input: any): CrewMember | null {
  if (!input || typeof input !== "object") return null;
  const id = String(input.id ?? "").slice(0, 40).trim();
  const token = String(input.token ?? "").slice(0, 40).trim();
  if (!id || !token) return null;
  const agreements = (Array.isArray(input.agreements) ? input.agreements : [])
    .slice(0, 12)
    .map(sanitizeAgreement)
    .filter((a: CrewAgreementSignature | null): a is CrewAgreementSignature => !!a);
  const notes = (Array.isArray(input.notes) ? input.notes : [])
    .slice(0, 200)
    .map((n: any) => ({ t: Number(n?.t) || Date.now(), text: String(n?.text ?? "").slice(0, 2000) }))
    .filter((n: CrewNote) => n.text);
  return {
    id,
    token,
    name: String(input.name ?? id).slice(0, 80),
    role: input.role === "host" ? "host" : "worker",
    adminLinked: !!input.adminLinked,
    perWindowCents: clampCents(input.perWindowCents),
    active: input.active !== false,
    pinHash: typeof input.pinHash === "string" && /^[a-f0-9]{64}$/.test(input.pinHash) ? input.pinHash : undefined,
    profile: sanitizeProfile(input.profile),
    agreements,
    onboardedAt: input.onboardedAt ? Number(input.onboardedAt) || undefined : undefined,
    notes,
    payouts: (Array.isArray(input.payouts) ? input.payouts : [])
      .slice(0, 100)
      .map(sanitizePayout)
      .filter((p: CrewPayout | null): p is CrewPayout => !!p),
    createdAt: Number(input.createdAt) || Date.now(),
  };
}

export function sanitizeCrew(input: any): CrewMember[] {
  if (!Array.isArray(input)) return [];
  const seenTokens = new Set<string>();
  const seenIds = new Set<string>();
  const out: CrewMember[] = [];
  for (const raw of input.slice(0, 60)) {
    const m = sanitizeCrewMember(raw);
    if (!m) continue;
    if (seenIds.has(m.id) || seenTokens.has(m.token)) continue;
    seenIds.add(m.id);
    seenTokens.add(m.token);
    out.push(m);
  }
  return out;
}
