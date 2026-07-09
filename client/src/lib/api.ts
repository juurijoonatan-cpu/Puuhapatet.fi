/**
 * API Client — Render.com Express backend
 */

import type { GigData, GigTotals } from "@shared/gig";
import type { ProjectData, ProjTotals, WorkerStat, ProjMarksData, ProjCustomMark, WindowStatus, ProjBuilding, FixedDeal, EraDebtBreakdown } from "@shared/project";
import type { MemberAgreementSignature } from "@shared/member-agreement";
import type { CrewMember, CrewMemberStats, CrewProfile, CrewAgreementSignature } from "@shared/crew";
import type { WorkerAgreement } from "@shared/worker-agreements";
import type { EraInvoiceKind, EraInvoiceTila } from "@shared/era-billing";

// Worker dashboard payload — the gig price/cap is intentionally absent.
export interface WorkerView {
  worker: {
    id: string;
    name: string;
    role: "worker" | "host";
    perWindowCents: number;
    adminLinked: boolean;
    hasPin: boolean;
    onboarded: boolean;
    /** Signing is gated AND this worker hasn't signed the current set → show banner. */
    needsToSign: boolean;
    /** Has signed every required agreement at the current version. */
    signedAll: boolean;
    /** Set when this worker is a trainee (harjoittelija) under a leader's
     *  responsibility — no own Y-tunnus, no self-invoicing. null otherwise. */
    trainee: { responsibleLeaderName: string } | null;
    /** Epoch ms when the work-hour timer was started (null if not running). */
    activeShiftAt: number | null;
    /** Washed count when the current shift started (for the live session counter). */
    shiftStartWashed: number | null;
    /** Completed work sessions, newest-first. */
    sessions: import("@shared/crew").CrewSession[];
    profile: CrewProfile | null;
    signedAgreementIds: string[];
    notes: { t: number; text: string }[];
    billing: { name: string | null; yTunnus: string | null; iban: string | null; address: string | null };
  };
  payouts: import("@shared/crew").CrewPayout[];
  /** FR8 erälaskut, vain tämän tekijän omat (kohta 3B): "luonnos" odottaa
   *  tekijän Lähetä lasku / Hylkää -vastausta; hyväksytty/hylätty on lukittu. */
  eraInvoices: EraInvoiceClient[];
  building: ProjBuilding;
  pricePerWindow: number;          // the worker's OWN rate (not the gig price)
  marks: ProjMarksData;
  statuses: Record<string, WindowStatus>;
  washedBy: Record<string, string>;
  keskenBy: Record<string, string>;
  /** crew id → display name, for the "who washed / who noted this" labels. */
  workerNames: Record<string, string>;
  /** Host info notes (ladders, hazards, storage, …) + worker-added notes. */
  notes: Record<string, import("@shared/project").ProjMapNote[]>;
  /** Per-window observations (text + optional photo) keyed by window key. */
  observations: Record<string, import("@shared/project").ProjWindowObservation>;
  /** The single "work happening here now" highlight (read-only for workers). */
  activeZone: import("@shared/project").ProjActiveZone | null;
  customMarks: Record<string, ProjCustomMark[]>;
  posOverrides: Record<string, { x: number; y: number }>;
  deleted: Record<string, boolean>;
  hours: number;
  stats: CrewMemberStats;
  /** Gig-wide window counts (team) for the shared paydate-progress stat. No euros. */
  windowsTotal: number;
  windowsWashed: number;
  agreementVersion: string;
  requiredAgreementIds: string[];
  /** Whether agreement signing is currently enforced (soft start when false). */
  agreementsGated: boolean;
  /** Team standings (workers only) — name + windows + windows/hour, no €/rates. */
  leaderboard: { id: string; name: string; washed: number; windowsPerHour: number; hours: number; isMe: boolean }[];
  /** This worker's own logged expenses (other workers' costs never included). */
  expenses: import("@shared/project").ProjExpense[];
}

export interface CrewOnboardPayload {
  profile?: CrewProfile;
  agreements?: Partial<CrewAgreementSignature>[];
  pin?: string;
}

export interface HostCrewRow {
  member: CrewMember;
  stats: CrewMemberStats;
  onboarded: boolean;
}

/** Client-side shape of an `era_invoices` row — `eraNumbers`/`rivit` arrive as
 *  JSON text from the DB but are parsed server-side before the response, ks.
 *  shared/era-billing.ts + docs/fr8-era-laskutus-plan.md. */
export interface EraInvoiceClient {
  id: number;
  jobId: number;
  kind: EraInvoiceKind;
  senderId: string;
  recipientId: string;
  eraNumbers: number[];
  rivit: any;
  totalCents: number;
  xCents: number | null;
  kateCents: number | null;
  katePerJohtajaCents: number | null;
  manualAdjustmentCents: number;
  dueDate: string | null;
  tila: EraInvoiceTila;
  invoiceNumber: string | null;
  referenceNumber: string | null;
  createdAt: string;
  sentAt: string | null;
  respondedAt: string | null;
  /** Sähköposti_loki (kohta 3D) — rivejä syntyy vaiheesta 4 alkaen. Mukana vain
   *  johtajien listauksessa (GET /era-invoices), ei tekijän omassa näkymässä. */
  emails?: { recipients: string[]; success: boolean; sentAt: string }[];
}

/** Founder settlement for a fixed deal. The biller collects the full instalment;
 *  the kate (instalment − palkat) is split equally as passive income; the biller
 *  pays the others their share. Computed over BILLED erät only. */
export interface FounderSettlement {
  founders: {
    id: string;
    name: string;
    billedCents: number;     // total this founder collected from the customer (as biller)
    kateShareCents: number;  // their passive-income share of the kate
  }[];
  settlements: {
    era: number;
    billerId: string;
    billerName: string;
    instalmentCents: number;   // 1575 — what the biller collected
    palkatCents: number;       // paid to workers
    kateCents: number;         // instalment − palkat
    billerShareCents: number;  // biller's own kate share (what they keep)
    paysOut: { id: string; name: string; cents: number }[]; // biller pays each other founder this
  }[];
}

/** Founder cross-invoicing netted across all gigs. The founders split gigs
 *  50/50 but only one bills each erä, so the biller holds the other's half —
 *  `crossInvoices` is the net "X should pay Y €Z" after cancelling opposing debts. */
export interface FounderCrossSettlement {
  ok: boolean;
  founders: {
    id: string;
    name: string;
    yTunnus?: string;
    billedCents: number;      // total collected from customers as biller
    kateShareCents: number;   // equal share of the total kate (passive income)
    palkatPaidCents: number;  // workers' palkat the biller fronted
  }[];
  crossInvoices: { fromId: string; fromName: string; toId: string; toName: string; cents: number }[];
  perGig: {
    jobId: number;
    gigName: string;
    eras: {
      era: number;
      /** Billing date of the instalment (ms) — used to year-bucket kate income. */
      dateMs: number | null;
      billerId: string; billerName: string;
      instalmentCents: number; palkatCents: number; kateCents: number;
      /** Every founder's kate share of this erä (incl. the biller's own). */
      shares: { id: string; cents: number }[];
      paysOut: { id: string; name: string; cents: number }[];
    }[];
  }[];
  /** Done small jobs where the biller owes the other founder their 50/50 share
   *  (computed on total − kulut, matching the tilitystosite maths). */
  smallJobs: {
    jobId: number; name: string; dateMs: number; totalCents: number; expensesCents: number;
    billerId: string; billerName: string; numWorkers: number;
    owes: { id: string; name: string; cents: number }[];
  }[];
  /** Already-issued vastalaskut — subtracted from crossInvoices by the server. */
  settled: { id: number; fromId: string; toId: string; cents: number; invoiceNo?: string; createdAtMs: number }[];
  /** Recorded gig instalments with NO biller — excluded from the debt maths
   *  until attributed (ALV card lists them with a one-tap assign). */
  unassignedEraCount?: number;
}

/** Aggregated single-worker admin view (/admin/tiimi/:workerId). */
export interface WorkerDetail {
  worker: {
    id: string; name: string; role: string; token: string;
    photoDataUrl?: string; phone?: string; email?: string; yTunnus?: string; city?: string;
    answers: Record<string, string>;
  };
  totals: { earnedCents: number; paidCents: number; openCents: number };
  payouts: (import("@shared/crew").CrewPayout & { jobId: number; gigName: string; token: string })[];
  documents: (import("@shared/crew").CrewDocument & { jobId: number })[];
  /** SENT customer invoices, computed live from jobs (small jobs by billedBy +
   *  gig instalments by payment biller) — past gigs always included. */
  customerInvoices: { jobId: number; dateMs: number; name: string; ref?: string; amountCents: number; source: "keikka" | "era" }[];
  /** Founder-to-founder settlements involving this person (vastalaskut + MobilePay). */
  settlements: { id: number; fromId: string; toId: string; cents: number; invoiceNo?: string; createdAtMs: number }[];
}

/** The logged-in admin's own earnings on a gig they also work (e.g. Petrus). */
export interface MyGigWork {
  jobId: number;
  gigName: string;
  token: string;        // their private /tyo link token
  washed: number;
  earnedCents: number;
  paidCents: number;
  pendingCents: number;
}

// Defaults to the Render backend in production; override with VITE_API_BASE
// (e.g. "" for same-origin) when running the server locally.
const API_BASE = import.meta.env.VITE_API_BASE ?? "https://puuhapatet-fi.onrender.com";

// ─── Admin auth token ──────────────────────────────────────────────────────────
// The server issues an HMAC-signed bearer token at login; we keep it in
// localStorage and attach it to every API call. Public customer/worker pages
// simply have no token, so the header is omitted and those routes stay open.
const ADMIN_TOKEN_KEY = "puuhapatet_admin_token";

export function getAdminToken(): string | null {
  try { return localStorage.getItem(ADMIN_TOKEN_KEY); } catch { return null; }
}
export function setAdminToken(token: string): void {
  try { localStorage.setItem(ADMIN_TOKEN_KEY, token); } catch { /* private mode */ }
}
export function clearAdminToken(): void {
  try { localStorage.removeItem(ADMIN_TOKEN_KEY); } catch { /* private mode */ }
}

function authHeaders(): Record<string, string> {
  const t = getAdminToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/**
 * Merge the admin auth header into a headers object — for the few components
 * that call protected endpoints with a raw `fetch` instead of the `api` helper.
 */
export function withAuth(headers: Record<string, string> = {}): Record<string, string> {
  return { ...headers, ...authHeaders() };
}

// On 401 from a protected endpoint the token is missing/expired → drop it and
// bounce to the login screen. Public pages never reach this path.
function handleUnauthorized(): void {
  clearAdminToken();
  if (typeof window !== "undefined" && !window.location.pathname.startsWith("/admin/login")) {
    window.location.href = "/admin/login";
  }
}

export interface GigPublicView {
  contractId: string | null;
  companyName: string;
  description: string;
  currency: string;
  vatNote: string | null;
  customerNote: string | null;
  sectors: Array<{ id: string; name: string; color: string; unitLabel: string; total: number; unitPriceCents: number; washed: number; skipped: number }>;
  totals: GigTotals;
  updatedAt: number;
  invoicedCents: number;
  paymentsCount: number;
  /** True when the gig is billed as a fixed flat-rate contract (4 equal instalments). */
  isFixedDeal: boolean;
  // Read-only floor-plan map (white, customer view). Null if no plan.
  map: {
    building: { name: string | null; address: string | null; floors: string[]; planBase: string };
    marks: ProjMarksData;
    statuses: Record<string, WindowStatus>;
    customMarks: Record<string, ProjCustomMark[]>;
    posOverrides: Record<string, { x: number; y: number }>;
    deleted: Record<string, boolean>;
    notes?: Record<string, import("@shared/project").ProjMapNote[]>;
    observations?: Record<string, import("@shared/project").ProjWindowObservation>;
    activeZone?: import("@shared/project").ProjActiveZone | null;
  } | null;
  // Contract & signing gate
  contractText: string | null;
  requireSignature: boolean;
  status: "draft" | "signed" | "approved";
  signed: boolean;
  signedAt: number | null;
  signerName: string | null;
  approved: boolean;
  approvedAt: number | null;
  signature: {
    signerName: string;
    place: string | null;
    signedAt: number;
    customer: { legalName: string; businessId?: string; billingAddress?: string; eInvoice?: string; contactPerson?: string };
    signatureDataUrl: string;
  } | null;
  company: {
    name: string | null;
    businessId: string | null;
    email: string | null;
    contact: string | null;
    address: string | null;
  } | null;
}

export interface GigSignPayload {
  signerName: string;
  signerTitle?: string;
  place?: string;
  option?: string;
  acceptedSectorIds?: string[];
  signatureDataUrl: string;
  customer: {
    legalName: string;
    businessId?: string;
    billingAddress?: string;
    eInvoice?: string;
    contactPerson?: string;
  };
}

interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResponse<T>> {
  // Abort timeout so a sleeping/cold backend can't hang the UI indefinitely.
  // No retry here — these calls can be non-idempotent (e.g. createJob).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 70000);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...authHeaders() },
      body: body ? JSON.stringify(body) : undefined,
      mode: "cors",
      signal: controller.signal,
    });
    if (res.status === 401) {
      handleUnauthorized();
      return { ok: false, error: "Kirjautuminen vaaditaan" };
    }
    if (!res.ok) {
      try {
        const errData = await res.json();
        return { ok: false, error: errData.error || `HTTP ${res.status}` };
      } catch {
        return { ok: false, error: `HTTP ${res.status}` };
      }
    }
    const data = await res.json();
    return { ok: true, data };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      return { ok: false, error: "Yhteys aikakatkaistiin" };
    }
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Wake the Render backend ahead of time. The free tier spins down after ~15 min
 * of inactivity, and the first request then pays a ~50s cold-start penalty.
 * Call this when a page with a contact form mounts so the server is already
 * awake by the time the visitor presses send. Fire-and-forget; failures ignored.
 */
export function warmBackend(): void {
  try {
    fetch(`${API_BASE}/api/health`, { method: "GET", mode: "cors" }).catch(() => {});
  } catch {
    /* no-op */
  }
}

/**
 * POST JSON with an abort timeout and one cold-start retry.
 *
 * Without a timeout the browser fetch can hang for minutes while Render wakes
 * up, leaving the submit button spinning with no feedback. The timeout is set
 * generously (longer than a worst-case cold start) so a slow-but-working
 * request is never aborted mid-flight — that keeps the single retry reserved
 * for genuine connection failures, avoiding duplicate submissions.
 */
export async function postJson<T = any>(
  path: string,
  body: unknown,
  { timeoutMs = 70000, retries = 1 }: { timeoutMs?: number; retries?: number } = {},
): Promise<ApiResponse<T>> {
  let lastError = "Network error";
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
        mode: "cors",
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.status === 401) {
        handleUnauthorized();
        return { ok: false, error: "Kirjautuminen vaaditaan" };
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        return { ok: false, error: json.error || `HTTP ${res.status}` };
      }
      return { ok: true, data: json };
    } catch (e) {
      clearTimeout(timer);
      lastError =
        e instanceof DOMException && e.name === "AbortError"
          ? "Yhteys aikakatkaistiin"
          : e instanceof Error
            ? e.message
            : "Network error";
      // Retry once — a cold start or a dropped connection usually recovers.
    }
  }
  return { ok: false, error: lastError };
}

export function generateJobId(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `PP-${timestamp}-${random}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NormalizedPackage {
  id: string;
  name: string;
  description: string;
  durationMinutes: number;
  price: number;
  category?: string;
  active: boolean;
}

// Keep for backward compat (new-job.tsx imports these)
export interface ApiPackage {
  PackageCode: string;
  Name: string;
  Category?: string;
  BasePriceEUR?: string;
  Description_Public?: string;
  Description_Internal?: string;
  Active?: boolean;
}

export function normalizePackage(pkg: ApiPackage): NormalizedPackage {
  return {
    id: pkg.PackageCode,
    name: pkg.Name,
    description: pkg.Description_Public || pkg.Description_Internal || "",
    durationMinutes: 60,
    price: pkg.BasePriceEUR ? parseFloat(pkg.BasePriceEUR) || 0 : 0,
    category: pkg.Category,
    active: pkg.Active !== false,
  };
}

export interface NewCustomer {
  name: string;
  phone: string;
  email?: string;
  address: string;
  notes?: string;
  ownedBy?: string;
  isYritys?: boolean;
  companyName?: string;
  yTunnus?: string;
}

export interface NewJob {
  customerId: number;
  description: string;
  agreedPrice: number; // cents
  status?: string;
  assignedTo?: string;
  notes?: string;
  scheduledAt?: string | null;
  customerSignature?: string;
  staffSignature?: string;
  waiveFee?: boolean;
  pendingWorkers?: string | null;
  paymentMethod?: string | null;
  quoteToken?: string;
  quoteVideoUrl?: string;
  isTaloyhtiio?: boolean;
  taloyhtiioName?: string;
  unitCount?: number;
  propertyImageUrl?: string;
  isYritys?: boolean;
  isCustomGig?: boolean;
  gigData?: string;       // JSON string of GigData
}

export interface StatsResponse {
  totalJobs: number;
  totalRevenue: number;
  totalExpenses: number;
  serviceFeeTotal: number;
  netIncome: number;
  upcoming: number;
}

export interface WorkerStatsResponse {
  workerFees: Record<string, number>;     // current debt (cents) per worker ID
  workerJobCount: Record<string, number>; // done job count per worker ID
  brandCash: number;                      // total paid to brand so far (cents)
  brandEarned: number;                    // total service fees earned from gigs (cents)
}

// ─── Static package list (no packages table yet) ──────────────────────────────

const STATIC_PACKAGES: NormalizedPackage[] = [
  { id: "BASIC",   name: "Peruspesu",   description: "Ikkunoiden peruspesu ulkoa",          price: 89,  durationMinutes: 60,  active: true },
  { id: "FULL",    name: "Täyspesu",    description: "Ikkunat ja karmit sisä + ulko",        price: 149, durationMinutes: 90,  active: true },
  { id: "PREMIUM", name: "Premium",     description: "Kaikki pinnat, sisä ja ulko + karmit", price: 249, durationMinutes: 120, active: true },
];

// ─── API object ───────────────────────────────────────────────────────────────

export const api = {
  health: () =>
    request<{ ok: boolean; ts: string }>("GET", "/api/health"),

  stats: () =>
    request<StatsResponse>("GET", "/api/stats"),

  workersStats: () =>
    request<WorkerStatsResponse>("GET", "/api/workers/stats"),

  // Per-founder (biller) customer-invoice turnover by calendar year, for the
  // ALV vähäinen-toiminta threshold tracker in the Verotus view.
  getBillerTurnover: () =>
    request<{
      ok: boolean;
      limitEur: number;
      billers: { id: string; name: string; yTunnus?: string }[];
      turnoverByYear: Record<string, Record<string, number>>;
      /** Done small jobs with no biller set — attribute them or the tracker under-counts. */
      unassignedByYear: Record<string, { count: number; cents: number }>;
      /** Recorded gig instalments (urakkaerät) with no biller — in NOBODY's
       *  turnover/debt until assigned via setGigPaymentBiller. */
      unassignedEras: { jobId: number; index: number; name: string; dateMs: number | null; cents: number }[];
    }>("GET", "/api/admin/biller-turnover"),

  // Attribute (or correct) who billed a recorded gig instalment — feeds the
  // ALV turnover, the invoice register and the founder debt in one go.
  setGigPaymentBiller: (jobId: number, index: number, billerId: string) =>
    request<{ ok: boolean }>("POST", `/api/jobs/${jobId}/gig-payment-biller`, { index, billerId }),

  // Enterprise instalment management: list EVERY gig instalment (with kate
  // breakdown), edit any one (amount/date/biller — deliberately overwrites),
  // or delete a bogus one. All recompute the gig's invoiced totals.
  getGigInstalments: () =>
    request<{
      ok: boolean;
      billers: { id: string; name: string }[];
      instalments: {
        jobId: number; index: number; gigName: string; jobDescription: string;
        dateMs: number | null; amountCents: number;
        biller: { id: string; name: string } | null;
        isFixedDeal: boolean;
        instalmentBasisCents: number | null;
        kateCents: number | null; palkatCents: number | null;
        shares: { id: string; name: string; cents: number }[] | null;
      }[];
    }>("GET", "/api/admin/gig-instalments"),
  editGigPayment: (jobId: number, index: number, patch: { amountCents?: number; dateMs?: number; billerId?: string | null }) =>
    request<{ ok: boolean }>("PATCH", `/api/jobs/${jobId}/gig-payment/${index}`, patch),
  deleteGigPayment: (jobId: number, index: number) =>
    request<{ ok: boolean }>("DELETE", `/api/jobs/${jobId}/gig-payment/${index}`),

  // Founder cross-invoicing netted across ALL gigs: who owes whom, plus each
  // founder's totals and a per-gig breakdown. Powers "Bossien laskutus & tilitys".
  getFounderSettlement: () =>
    request<FounderCrossSettlement>("GET", "/api/admin/founder-settlement"),

  // Record a PAYMENT between the founders — the open cross-debt shrinks and
  // the same euros are never billed twice; delete = undo a wrong booking.
  recordFounderSettlement: (data: { fromId: string; toId: string; cents: number; invoiceNo?: string }) =>
    request<{ ok: boolean }>("POST", "/api/admin/founder-settlement/record", data),
  // Issue a vastalasku: files myyntilasku + ostolasku into both founders'
  // Dokumentit WITHOUT touching the open debt — the payment is recorded
  // separately when the money actually moves.
  issueFounderInvoice: (data: {
    fromId: string; toId: string; cents: number; invoiceNo: string;
    // Optional: lets the server generate a real PDF (filed + backed up to
    // Google Drive) matching exactly what the printable preview showed.
    items?: { label: string; cents: number }[];
    dueDateStr?: string; iban?: string; bic?: string; paidNote?: string;
  }) =>
    request<{ ok: boolean }>("POST", "/api/admin/founder-settlement/issue-invoice", data),
  deleteFounderSettlement: (id: number) =>
    request<{ ok: boolean }>("DELETE", `/api/admin/founder-settlement/${id}`),

  // ─── FR8 erälaskutus (docs/fr8-era-laskutus-plan.md) ─────────────────────
  getEraInvoices: (jobId: number) =>
    request<{ ok: boolean; invoices: EraInvoiceClient[] }>("GET", `/api/jobs/${jobId}/era-invoices`),
  // Johtaja luo tekijä-maksuehdotukset valitulle erälle (§3A) — yksi rivi per
  // tekijä; jää tilaan "luonnos" kunnes tekijä itse hyväksyy/hylkää (vaihe 3).
  createWorkerEraInvoiceBatch: (jobId: number, data: {
    eraNumbers: number[];
    workers: { workerId: string; name: string; pestytIkkunat: number; sovittuMuutosCents: number; ennakkoCents: number }[];
    /** Eräpäivä, johtajan valitsema ("YYYY-MM-DD"). Puuttuessaan 14 vrk -oletus. */
    dueDate?: string;
  }) => request<{ ok: boolean; invoices: EraInvoiceClient[] }>("POST", `/api/jobs/${jobId}/era-invoice/worker-batch`, data),
  // Johtaja lähettää suoraan toiselle johtajalle ristiinlaskun (§3C) — lukittu heti.
  sendFounderEraInvoice: (jobId: number, data: {
    eraNumbers: number[]; senderId: string; itsepestytIkkunat: number; kokonaisikkunat: number;
    totalCents: number; manualAdjustmentCents?: number; dueDate?: string;
  }) => request<{ ok: boolean; invoice: EraInvoiceClient }>("POST", `/api/jobs/${jobId}/era-invoice/founder`, data),
  // Johtajan PDF-lataus (kohta 4) — admin-Bearer-autentikoitu reitti, joten ei
  // kelpaa suoraan <a href>:ksi; haetaan blobina ja avataan/ladataan JS:llä.
  downloadEraInvoicePdf: async (jobId: number, invoiceId: number): Promise<{ ok: boolean; blob?: Blob; error?: string }> => {
    try {
      const res = await fetch(`${API_BASE}/api/jobs/${jobId}/era-invoice/${invoiceId}/pdf`, { headers: authHeaders() });
      if (res.status === 401) { handleUnauthorized(); return { ok: false, error: "Kirjautuminen vaaditaan" }; }
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      return { ok: true, blob: await res.blob() };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Network error" };
    }
  },
  // Tekijän oman laskun PDF-URL — token on jo itsessään autentikointi, joten
  // kelpaa suoraan <a href>:ksi (sama malli kuin payout/:id/invoice.pdf).
  crewEraInvoicePdfUrl: (token: string, invoiceId: number) =>
    `${API_BASE}/api/crew/${token}/era-invoice/${invoiceId}/pdf`,

  markWorkerPaid: (workerId: string, amount: number) =>
    request<{ id: number }>("POST", `/api/workers/${workerId}/mark-paid`, { amount }),

  resetWorkerPayments: () =>
    request<{ ok: boolean }>("DELETE", "/api/workers/payments"),

  // packages() returns static list — no packages table in DB yet
  packages: (): Promise<ApiResponse<{ ok: boolean; packages: ApiPackage[] }>> =>
    Promise.resolve({ ok: true, data: { ok: true, packages: [] } }),

  createCustomer: (data: NewCustomer) =>
    request<{ id: number } & NewCustomer>("POST", "/api/customers", data),

  getCustomers: () =>
    request<unknown[]>("GET", "/api/customers"),

  getCustomer: (id: number) =>
    request<unknown>("GET", `/api/customers/${id}`),

  createJob: (data: NewJob) =>
    request<{ id: number } & NewJob>("POST", "/api/jobs", data),

  getJobs: () =>
    request<unknown[]>("GET", "/api/jobs"),

  getJobById: (id: number) =>
    request<unknown>("GET", `/api/jobs/${id}`),

  updateJob: (id: number, data: Partial<NewJob>) =>
    request<unknown>("PATCH", `/api/jobs/${id}`, data),

  deleteJob: (id: number) =>
    request<{ ok: boolean }>("DELETE", `/api/jobs/${id}`),

  updateCustomer: (id: number, data: Partial<NewCustomer>) =>
    request<unknown>("PATCH", `/api/customers/${id}`, data),

  getExpenses: (jobId: number) =>
    request<unknown[]>("GET", `/api/jobs/${jobId}/expenses`),

  addExpense: (jobId: number, data: { description: string; amount: number }) =>
    request<unknown>("POST", `/api/jobs/${jobId}/expenses`, data),

  deleteExpense: (expenseId: number) =>
    request<unknown>("DELETE", `/api/expenses/${expenseId}`),

  getInvestments: () =>
    request<unknown[]>("GET", "/api/investments"),

  addInvestment: (data: {
    description: string;
    amount: number;
    category?: string;
    boughtBy: string;
    splitWith?: string | null;
    bonusBy?: string | null;
    note?: string;
  }) => request<unknown>("POST", "/api/investments", data),

  updateInvestment: (id: number, data: Record<string, unknown>) =>
    request<unknown>("PATCH", `/api/investments/${id}`, data),

  deleteInvestment: (id: number) =>
    request<{ ok: boolean }>("DELETE", `/api/investments/${id}`),

  getStartupBonusUsages: (userId: string) =>
    request<unknown[]>("GET", `/api/startup-bonus-usages?userId=${encodeURIComponent(userId)}`),

  addStartupBonusUsage: (data: {
    userId: string;
    amount: number;
    description: string;
    category?: string;
  }) => request<unknown>("POST", "/api/startup-bonus-usages", data),

  deleteStartupBonusUsage: (id: number) =>
    request<{ ok: boolean }>("DELETE", `/api/startup-bonus-usages/${id}`),

  deleteCustomer: (id: number) =>
    request<{ ok: boolean }>("DELETE", `/api/customers/${id}`),

  inviteWorker: (jobId: number, invitedUserId: string, inviterName?: string, note?: string) =>
    request<{ ok: boolean; job: unknown }>("POST", `/api/jobs/${jobId}/invite`, { invitedUserId, inviterName, note }),

  respondInvite: (jobId: number, userId: string, accept: boolean) =>
    request<{ ok: boolean; job: unknown }>("POST", `/api/jobs/${jobId}/invite-respond`, { userId, accept }),

  sendReceipt: (data: {
    to: string;
    bcc?: string;
    customerName: string;
    customerAddress?: string;
    date: string;
    description: string;
    price: string;
    paymentMethod?: string;
    workerName?: string;
    workerPhone?: string;
    workerYTunnus?: string;
    isReturning?: boolean;
    lang?: "fi" | "en";
  }) => request<{ ok: boolean; id?: string }>("POST", "/api/send-receipt", data),

  sendProgressUpdate: (data: {
    to: string;
    bcc?: string;
    customerName: string;
    description?: string;
    progressNotes: string;
    continuationPlan?: string;
    continuationDate?: string;
    workerName?: string;
    workerPhone?: string;
    lang?: "fi" | "en";
  }) => request<{ ok: boolean; id?: string }>("POST", "/api/send-progress-update", data),

  sendJobSummary: (data: {
    to: string;
    bcc?: string[];
    customerName: string;
    customerAddress?: string;
    timelineEvents?: { label: string; date: string }[];
    description: string;
    price: string;
    paymentMethod: string;
    iban?: string;
    bic?: string;
    viitenumero?: string;
    dueDate?: string;
    workerMessage?: string;
    jobNotes?: string;
    photoDataUrl?: string;
    allWorkers?: { name: string; phone?: string; email?: string; yTunnus?: string }[];
    senderName?: string;
    senderAddress?: string;
    agreedPriceCents?: number;
    expensesTotalCents?: number;
    estimatedHours?: number;
    lang?: "fi" | "en";
    unitBreakdown?: { unitName: string; priceEur: string }[];
    // Tilitystosite: usean tekijän keikoilla kullekin tekijälle lähetettävä erittely
    settlement?: {
      collectorName?: string;
      workers: {
        name: string;
        email?: string;
        yTunnus?: string;
        grossCents: number;
        expensesCents: number;
        feePct: number;
        feeCents: number;
        netCents: number;
      }[];
    };
  }) => request<{ ok: boolean; id?: string; settlementSent?: number }>("POST", "/api/send-job-summary", data),

  notifyResidents: (jobId: number) =>
    request<{ ok: boolean; sent: number }>("POST", `/api/jobs/${jobId}/notify-residents`, {}),

  sendQuote: (data: {
    to: string;
    bcc?: string;
    quoteId: string;
    quoteToken?: string;
    quoteVideoUrl?: string;
    customerName: string;
    customerAddress?: string;
    items: Array<{ title: string; detail: string; price: number }>;
    total: number;
    validDays: number;
    customMessage?: string;
    workerName?: string;
    workerPhone?: string;
    workerEmail?: string;
    lang?: "fi" | "en";
    isTaloyhtiio?: boolean;
    taloyhtiioName?: string;
    unitCount?: number;
    propertyImageUrl?: string;
    isYritys?: boolean;
  }) => request<{ ok: boolean; id?: string }>("POST", "/api/send-quote", data),

  getQuote: (token: string) =>
    request<{
      quoteId: string;
      customerName: string;
      customerAddress: string;
      description: string;
      agreedPriceCents: number;
      validUntil: string | null;
      quoteStatus: string;
      quoteVideoUrl: string | null;
      isTaloyhtiio: boolean;
      taloyhtiioApproved: boolean;
      unitCount: number | null;
      propertyImageUrl: string | null;
      taloyhtiioName: string | null;
      unitResponses: Array<{
        unitId: string;
        unitName: string;
        status: "accepted" | "declined";
        email?: string;
        times: string[];
        message: string;
      }>;
      isYritys: boolean;
      scheduledAt: string | null;
      suggestedTimes: string[];
      boardContactName: string | null;
      boardContactEmail: string | null;
      boardContactPhone: string | null;
    }>("GET", `/api/quote/${token}`),

  respondToQuote: (token: string, data: {
    status: "accepted" | "declined";
    suggestedTimes?: string[];
    customerMessage?: string;
    boardContactName?: string;
    boardContactEmail?: string;
    boardContactPhone?: string;
    unitResponse?: {
      unitId: string;
      unitName: string;
      status: "accepted" | "declined";
      email?: string;
      residentName?: string;
      times: string[];
      message: string;
    };
  }) => request<{ ok: boolean }>("POST", `/api/quote/${token}/respond`, data),

  approveTaloyhtiio: (jobId: number, approved: boolean) =>
    request<{ ok: boolean }>("PATCH", `/api/jobs/${jobId}/taloyhtiio-approve`, { approved }),

  getCustomerJobCount: (customerId: number) =>
    request<{ count: number }>("GET", `/api/customers/${customerId}/job-count`),

  // Server-side login — verifies credentials and returns an HMAC-signed token.
  adminLogin: (userId: string, password: string) =>
    request<{ ok: boolean; token: string; role: string; mustChangePassword?: boolean }>("POST", "/api/admin/login", { userId, password }),

  // Resolve the logged-in user's personal worker dashboard link (dashboard-only users).
  getMyDashboard: () =>
    request<{ ok: boolean; token: string | null }>("GET", "/api/admin/my-dashboard"),

  // Workers who've finished onboarding (entered the app + signed their agreements) —
  // powers the login picker and the about-page team photos so a new hire appears
  // automatically, on top of the hand-maintained profiles in admin-profile.ts.
  getTeamRoster: () =>
    request<{ ok: boolean; workers: { id: string; name: string; photoUrl?: string }[] }>("GET", "/api/team-roster"),

  setUserPasswordRemote: (userId: string, password: string, currentPassword: string) =>
    request<{ ok: boolean }>("POST", `/api/admin/user-password/${userId}`, { password, currentPassword }),

  // ─── Member agreement (signed inside the admin) ─────────────────────────────
  getMemberAgreement: (userId: string) =>
    request<{ ok: boolean; signature: MemberAgreementSignature | null }>(
      "GET", `/api/admin/member-agreement/${userId}`),

  saveMemberAgreement: (userId: string, signature: Partial<MemberAgreementSignature>) =>
    request<{ ok: boolean; signature: MemberAgreementSignature }>(
      "POST", `/api/admin/member-agreement/${userId}`, signature),

  // ─── Custom gigs (cap-pricing) ──────────────────────────────────────────────
  getGig: (token: string) =>
    request<GigPublicView>("GET", `/api/gig/${token}`),

  signGig: (token: string, payload: GigSignPayload) =>
    request<{ ok: boolean; signedAt: number }>("POST", `/api/gig/${token}/sign`, payload),

  approveGig: (jobId: number, data: { approved?: boolean; by?: string; note?: string }) =>
    request<{ ok: boolean; gigData: GigData; status: "draft" | "signed" | "approved" }>(
      "POST", `/api/jobs/${jobId}/gig/approve`, data,
    ),

  updateGig: (jobId: number, gigData: GigData) =>
    request<{ ok: boolean; gigData: GigData; totals: GigTotals }>(
      "PATCH", `/api/jobs/${jobId}/gig`, { gigData },
    ),

  sendGigInvoice: (jobId: number, data: {
    to?: string;
    bcc?: string;
    iban?: string;
    bic?: string;
    viitenumero?: string;
    dueDate?: string;
    senderName?: string;
    senderYTunnus?: string;
    senderAddress?: string;
    billerId?: string;
    workerPhone?: string;
    message?: string;
    isFinal?: boolean;
    eInvoice?: string;
    paymentNumber?: number;
    sendMethod?: "email" | "verkkolasku";
  }) => request<{ ok: boolean; id?: string; amountCents: number; gigData: GigData }>(
    "POST", `/api/jobs/${jobId}/gig/invoice`, data,
  ),

  /** Email a comprehensive payment report (instalments + crew payouts + expenses
   *  + margin) for a gig to the founders. Manager-only summary, never the customer. */
  sendGigReport: (jobId: number) =>
    request<{ ok: boolean; id?: string }>("POST", `/api/jobs/${jobId}/gig/report`, {}),

  /** Undo the most recent instalment in the gig's tracked state (does not recall a
   *  sent email) — resets the "next instalment" counter after a mistaken send. */
  undoGigInstalment: (jobId: number) =>
    request<{ ok: boolean; gigData: GigData }>("POST", `/api/jobs/${jobId}/gig/invoice/undo`, {}),

  // ─── Project / floor-plan window tool (FR8 projektinäkymä) ──────────────────
  getProject: (jobId: number) =>
    request<{ ok: boolean; project: ProjectData | null; totals?: ProjTotals; workerStats?: WorkerStat[] }>(
      "GET", `/api/jobs/${jobId}/project`,
    ),

  updateProject: (jobId: number, projectData: ProjectData) =>
    request<{ ok: boolean; project: ProjectData; totals: ProjTotals; workerStats: WorkerStat[] }>(
      "PATCH", `/api/jobs/${jobId}/project`, { projectData },
    ),

  /**
   * Last-chance save for the floor-plan project, used when the page is being
   * hidden/closed/refreshed (pagehide/visibilitychange). A normal fetch is
   * cancelled the moment the document tears down, which is exactly when a
   * pending debounced autosave would otherwise be lost — so the dots a worker
   * just marked "reset" after a refresh. `keepalive` lets the request outlive
   * the page so the marks actually reach the server. Fire-and-forget.
   */
  flushProject: (jobId: number, projectData: ProjectData): void => {
    try {
      void fetch(`${API_BASE}/api/jobs/${jobId}/project`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ projectData }),
        mode: "cors",
        keepalive: true,
      }).catch(() => {});
    } catch {
      /* page is tearing down — nothing more we can do */
    }
  },

  // ─── Gig crew — worker dashboard (private link) ─────────────────────────────
  getCrewView: (token: string) =>
    request<{ ok: boolean; view: WorkerView }>("GET", `/api/crew/${token}`),

  crewAuth: (token: string, pin: string) =>
    request<{ ok: boolean; needsPin?: boolean }>("POST", `/api/crew/${token}/auth`, { pin }),

  crewOnboard: (token: string, payload: CrewOnboardPayload) =>
    request<{ ok: boolean; view: WorkerView }>("POST", `/api/crew/${token}/onboard`, payload),

  crewMarkWindow: (token: string, key: string, status: WindowStatus, p?: 1 | 2) =>
    request<{ ok: boolean; view: WorkerView }>("POST", `/api/crew/${token}/window`, { key, status, p }),

  crewAddHours: (token: string, delta: number) =>
    request<{ ok: boolean; view: WorkerView }>("POST", `/api/crew/${token}/hours`, { delta }),

  // Log a whole work day by hand — adds the hours and a diary session.
  crewManualShift: (token: string, hours: number) =>
    request<{ ok: boolean; view: WorkerView }>("POST", `/api/crew/${token}/manual-session`, { hours }),

  // Start/end the work-hour timer. On end, pass worked minutes (breaks deducted)
  // so the session log records the right duration.
  crewShift: (token: string, start: boolean, minutes?: number) =>
    request<{ ok: boolean; view: WorkerView }>("POST", `/api/crew/${token}/shift`, { start, minutes }),

  crewAddNote: (token: string, text: string) =>
    request<{ ok: boolean; view: WorkerView }>("POST", `/api/crew/${token}/note`, { text }),

  // Per-window observation (text + optional photo). Empty text + no image clears it.
  crewSetWindowObservation: (token: string, key: string, text: string, imageDataUrl?: string) =>
    request<{ ok: boolean; view: WorkerView }>("POST", `/api/crew/${token}/window-observation`, { key, text, imageDataUrl }),

  // Worker map notes (simple shared markers on the floor plan).
  crewAddMapNote: (token: string, floor: string, x: number, y: number, kind: string, text?: string) =>
    request<{ ok: boolean; key: string; view: WorkerView }>("POST", `/api/crew/${token}/map-note`, { floor, x, y, kind, text }),

  crewUpdateMapNote: (token: string, floor: string, key: string, text: string) =>
    request<{ ok: boolean; view: WorkerView }>("POST", `/api/crew/${token}/map-note/update`, { floor, key, text }),

  crewDeleteMapNote: (token: string, floor: string, key: string) =>
    request<{ ok: boolean; view: WorkerView }>("POST", `/api/crew/${token}/map-note/delete`, { floor, key }),

  // Worker approves a payout (locks in their billing snapshot for the invoice).
  crewApprovePayout: (
    token: string,
    payoutId: string,
    billing: { name?: string; yTunnus?: string; iban?: string; address?: string },
    expenses?: { id?: string; desc: string; amountCents: number; receiptDataUrl?: string }[],
  ) =>
    request<{ ok: boolean; view: WorkerView }>("POST", `/api/crew/${token}/payout/${payoutId}/approve`, { billing, expenses }),

  // FR8 erälasku (kohta 3B): tekijä hyväksyy ja LÄHETTÄÄ johtajan luonnosteleman
  // laskun — toimii tasan kerran, lasku lukittuu ja saa laskunumeron + viitteen.
  crewSendEraInvoice: (token: string, invoiceId: number) =>
    request<{ ok: boolean; invoice: EraInvoiceClient; view: WorkerView }>(
      "POST", `/api/crew/${token}/era-invoice/${invoiceId}/send`),

  // FR8 erälasku: tekijä hylkää luonnoksen (lopullinen; johtaja voi lähettää uuden).
  crewRejectEraInvoice: (token: string, invoiceId: number) =>
    request<{ ok: boolean; invoice: EraInvoiceClient; view: WorkerView }>(
      "POST", `/api/crew/${token}/era-invoice/${invoiceId}/reject`),

  // Worker logs an expense for the current job (own costs only — transport, materials, etc.).
  crewAddExpense: (token: string, data: { kind: string; desc: string; amountCents: number }) =>
    request<{ ok: boolean; expense: import("@shared/project").ProjExpense; expenses: import("@shared/project").ProjExpense[] }>(
      "POST", `/api/crew/${token}/expense`, data),

  crewDeleteExpense: (token: string, expenseId: string) =>
    request<{ ok: boolean; expenses: import("@shared/project").ProjExpense[] }>(
      "DELETE", `/api/crew/${token}/expense/${expenseId}`),

  // Admin adds/removes project-level expenses (all workers visible).
  addProjectExpense: (jobId: number, data: { kind: string; desc: string; amountCents: number; by?: string; forWhom?: string; receiptDataUrl?: string }) =>
    request<{ ok: boolean; expense: import("@shared/project").ProjExpense; expenses: import("@shared/project").ProjExpense[] }>(
      "POST", `/api/jobs/${jobId}/project/expense`, data),

  deleteProjectExpense: (jobId: number, expenseId: string) =>
    request<{ ok: boolean; expenses: import("@shared/project").ProjExpense[] }>(
      "DELETE", `/api/jobs/${jobId}/project/expense/${expenseId}`),

  getCrewAgreements: () =>
    request<{ ok: boolean; version: string; agreements: WorkerAgreement[]; requiredAgreementIds: string[] }>(
      "GET", `/api/crew-agreements`),

  // ─── Host crew management ───────────────────────────────────────────────────
  getHostCrew: (jobId: number) =>
    request<{ ok: boolean; crew: HostCrewRow[]; building: ProjBuilding; version: string; deal: FixedDeal | null; totalBillable: number; billableWashed: number; eraWindows: number[] | null; eraBreakdown: EraDebtBreakdown[]; founderSettlement: FounderSettlement }>(
      "GET", `/api/jobs/${jobId}/crew`),

  // Founders' editable per-erä (instalment) window counts for the fixed deal.
  setEraWindows: (jobId: number, windows: number[]) =>
    request<{ ok: boolean; eraWindows: number[] }>(
      "POST", `/api/jobs/${jobId}/project/era-windows`, { windows }),

  // The logged-in admin's own gig worker memberships (e.g. Petrus). Used to show
  // a small earnings card + link to their worker dashboard on the admin landing.
  getMyGigWork: () =>
    request<{ ok: boolean; gigs: MyGigWork[] }>("GET", `/api/me/gig-worker`),

  seedCrew: (jobId: number) =>
    request<{ ok: boolean; crew: CrewMember[]; alreadySeeded?: boolean }>(
      "POST", `/api/jobs/${jobId}/crew/seed`),

  addCrewMember: (jobId: number, data: { name?: string; role?: "worker" | "host"; perWindowCents?: number; adminLinked?: boolean }) =>
    request<{ ok: boolean; member: CrewMember; crew: CrewMember[] }>(
      "POST", `/api/jobs/${jobId}/crew`, data),

  updateCrewMember: (jobId: number, memberId: string, data: { name?: string; perWindowCents?: number; active?: boolean; role?: "worker" | "host"; rotateToken?: boolean; linkedUserId?: string; agreementSet?: "standard" | "kevyt"; endShift?: boolean; profile?: { fullName?: string; phone?: string; email?: string; city?: string; yTunnus?: string; iban?: string; answers?: Record<string, string> } }) =>
    request<{ ok: boolean; member: CrewMember; crew: CrewMember[] }>(
      "PATCH", `/api/jobs/${jobId}/crew/${memberId}`, data),

  // Host adds a note against a worker (e.g. "lyhytaikainen apu"). Admin-keyed
  // counterpart to crewAddNote (which is worker-token keyed).
  addCrewNote: (jobId: number, memberId: string, text: string) =>
    request<{ ok: boolean; member: CrewMember; crew: CrewMember[] }>(
      "POST", `/api/jobs/${jobId}/crew/${memberId}/note`, { text }),

  removeCrewMember: (jobId: number, memberId: string) =>
    request<{ ok: boolean; crew: CrewMember[] }>(
      "DELETE", `/api/jobs/${jobId}/crew/${memberId}`),

  // Host logs a worker's day on their behalf (hours + today's windows) and emails
  // the worker their day summary.
  crewLogDay: (jobId: number, memberId: string, hours: number) =>
    request<{ ok: boolean; crew: CrewMember[]; windows: number; emailed: boolean }>(
      "POST", `/api/jobs/${jobId}/crew/${memberId}/log-day`, { hours }),

  // Host: create a payout notification for a worker (Puuhapatet → alihankkija).
  // billerId = which leader (their Y-tunnus) is the BUYER the worker invoices.
  createPayout: (jobId: number, memberId: string, data: { amountCents: number; windows?: number; note?: string; billerId?: string }) =>
    request<{ ok: boolean; member: CrewMember }>(
      "POST", `/api/jobs/${jobId}/crew/${memberId}/payout`, data),

  // Host: delete a NON-paid payout (scrap a wrong one and make a new one).
  deletePayout: (jobId: number, memberId: string, payoutId: string) =>
    request<{ ok: boolean; member: CrewMember }>(
      "DELETE", `/api/jobs/${jobId}/crew/${memberId}/payout/${payoutId}`),

  // Host: single-worker detail (profile + money movement + documents) across gigs.
  getWorker: (workerId: string) =>
    request<{ ok: boolean } & WorkerDetail>("GET", `/api/admin/worker/${workerId}`),

  // Host: attach a document (receipt/invoice) to a worker by hand.
  addWorkerDocument: (
    workerId: string,
    data: { date?: number; desc: string; amountCents?: number; fileName?: string; fileDataUrl?: string; kind?: "kuitti" | "lasku" | "muu" },
  ) =>
    request<{ ok: boolean; document: import("@shared/crew").CrewDocument }>(
      "POST", `/api/admin/worker/${workerId}/document`, data),

  // Host: mark a payout paid (after manual bank transfer) → auto-invoice + email.
  // Optional billerId overrides the buyer captured at creation.
  markPayoutPaid: (jobId: number, memberId: string, payoutId: string, billerId?: string) =>
    request<{ ok: boolean; member: CrewMember; emailId?: string }>(
      "POST", `/api/jobs/${jobId}/crew/${memberId}/payout/${payoutId}/paid`, billerId ? { billerId } : undefined),

  // Legacy compat stubs
  getJob: (_jobId: string): Promise<ApiResponse<{ ok: boolean; job?: unknown }>> =>
    Promise.resolve({ ok: false }),

  upsertJob: (_job: unknown): Promise<ApiResponse<{ ok: boolean; jobId?: string; error?: string }>> =>
    Promise.resolve({ ok: false, error: "Deprecated" }),

  // ─── Kirjanpito (double-entry ledger) — Talous ja verotus -osio ────────────
  // Every GET rebuilds the ledger server-side from jobs/expenses/investments/
  // founderSettlements first, so the numbers are always current.

  financeLedgers: () =>
    request<{ ledgers: { id: string; name: string; yTunnus?: string; entityType: "toiminimi" | "oy" }[] }>(
      "GET", "/api/finance/ledgers"),

  financeChartOfAccounts: (ledgerId: string) =>
    request<{ accounts: FinanceAccount[] }>("GET", `/api/finance/chart-of-accounts?ledgerId=${ledgerId}`),

  financeJournal: (ledgerId: string, year?: number) =>
    request<{ entries: FinanceJournalEntry[] }>(
      "GET", `/api/finance/journal?ledgerId=${ledgerId}${year ? `&year=${year}` : ""}`),

  financeGeneralLedger: (ledgerId: string, year?: number) =>
    request<{ accounts: FinanceLedgerAccount[] }>(
      "GET", `/api/finance/general-ledger?ledgerId=${ledgerId}${year ? `&year=${year}` : ""}`),

  financeIncomeStatement: (ledgerId: string, year: number) =>
    request<FinanceIncomeStatement>("GET", `/api/finance/income-statement?ledgerId=${ledgerId}&year=${year}`),

  financeBalanceSheet: (ledgerId: string, asOf?: string) =>
    request<FinanceBalanceSheet>(
      "GET", `/api/finance/balance-sheet?ledgerId=${ledgerId}${asOf ? `&asOf=${asOf}` : ""}`),

  financeSummary: (ledgerId: string, year: number) =>
    request<FinanceSummary>("GET", `/api/finance/summary?ledgerId=${ledgerId}&year=${year}`),

  financeForecast: (ledgerId: string) =>
    request<{ entries: FinanceForecastEntry[] }>("GET", `/api/finance/forecast?ledgerId=${ledgerId}`),

  addFinanceForecastEntry: (data: Omit<FinanceForecastEntry, "id" | "createdAt">) =>
    request<FinanceForecastEntry>("POST", "/api/finance/forecast", data),

  updateFinanceForecastEntry: (id: number, patch: Partial<Omit<FinanceForecastEntry, "id" | "createdAt">>) =>
    request<FinanceForecastEntry>("PATCH", `/api/finance/forecast/${id}`, patch),

  deleteFinanceForecastEntry: (id: number) =>
    request<{ ok: boolean }>("DELETE", `/api/finance/forecast/${id}`),

  financeForecastProjection: (ledgerId: string, start?: string, end?: string) =>
    request<{ months: { month: string; incomeCents: number; expenseCents: number; profitCents: number }[] }>(
      "GET", `/api/finance/forecast/projection?ledgerId=${ledgerId}${start ? `&start=${start}` : ""}${end ? `&end=${end}` : ""}`),

  financeBackupStatus: (ledgerId: string, year: number) =>
    request<{ configured: boolean; files: Record<string, { webViewLink?: string; updatedAt: string } | null> }>(
      "GET", `/api/finance/backup/status?ledgerId=${ledgerId}&year=${year}`),

  financeBackupNow: (ledgerId: string, year: number) =>
    request<{ ok: boolean; reports: { uploaded: { report: string; ok: boolean }[] }; forecast: { ok: boolean } }>(
      "POST", "/api/finance/backup", { ledgerId, year }),
};

// ─── Kirjanpito types (mirror server/finance/*.ts) ────────────────────────────

export interface FinanceAccount {
  id: number; ledgerId: string; code: string; name: string;
  accountType: "asset" | "liability" | "equity" | "revenue" | "expense";
  isSystemAccount: boolean;
}

export interface FinanceJournalEntry {
  id: number; entryNumber: number; date: string; description: string;
  sourceType: "customer_invoice" | "internal_invoice" | "expense" | "investment" | "manual";
  lines: { accountCode: string; accountName: string; debitCents: number; creditCents: number }[];
}

export interface FinanceLedgerAccount {
  account: FinanceAccount;
  rows: { date: string; entryNumber: number; description: string; debitCents: number; creditCents: number; balanceCents: number }[];
  endBalanceCents: number;
}

export interface FinanceIncomeStatement {
  year: number;
  revenue: { code: string; name: string; cents: number }[];
  revenueTotal: number;
  expenses: { code: string; name: string; cents: number }[];
  expensesTotal: number;
  result: number;
}

export interface FinanceBalanceSheet {
  asOf: string;
  assets: { code: string; name: string; cents: number }[];
  assetsTotal: number;
  liabilities: { code: string; name: string; cents: number }[];
  liabilitiesTotal: number;
  equity: { code: string; name: string; cents: number }[];
  cumulativeResultCents: number;
  equityTotal: number;
  liabilitiesAndEquityTotal: number;
}

export interface FinanceSummary {
  year: number;
  totalInvoicedCents: number;
  totalIncomeCents: number;
  totalExpensesCents: number;
  profitCents: number;
}

export interface FinanceForecastEntry {
  id: number; ledgerId: string; label: string; kind: "income" | "expense";
  amountCents: number; startMonth: string; endMonth: string | null;
  recurring: boolean; category: string; createdAt?: string;
}

export { API_BASE };
