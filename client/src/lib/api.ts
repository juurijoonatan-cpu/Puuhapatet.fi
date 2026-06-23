/**
 * API Client — Render.com Express backend
 */

import type { GigData, GigTotals } from "@shared/gig";
import type { ProjectData, ProjTotals, WorkerStat, ProjMarksData, ProjCustomMark, WindowStatus, ProjBuilding } from "@shared/project";
import type { MemberAgreementSignature } from "@shared/member-agreement";
import type { CrewMember, CrewMemberStats, CrewProfile, CrewAgreementSignature } from "@shared/crew";
import type { WorkerAgreement } from "@shared/worker-agreements";

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
  }) => request<{ ok: boolean; id?: string; amountCents: number; gigData: GigData }>(
    "POST", `/api/jobs/${jobId}/gig/invoice`, data,
  ),

  // ─── Project / floor-plan window tool (FR8 projektinäkymä) ──────────────────
  getProject: (jobId: number) =>
    request<{ ok: boolean; project: ProjectData | null; totals?: ProjTotals; workerStats?: WorkerStat[] }>(
      "GET", `/api/jobs/${jobId}/project`,
    ),

  updateProject: (jobId: number, projectData: ProjectData) =>
    request<{ ok: boolean; project: ProjectData; totals: ProjTotals; workerStats: WorkerStat[] }>(
      "PATCH", `/api/jobs/${jobId}/project`, { projectData },
    ),

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
  crewApprovePayout: (token: string, payoutId: string, billing: { name?: string; yTunnus?: string; iban?: string; address?: string }) =>
    request<{ ok: boolean; view: WorkerView }>("POST", `/api/crew/${token}/payout/${payoutId}/approve`, { billing }),

  getCrewAgreements: () =>
    request<{ ok: boolean; version: string; agreements: WorkerAgreement[]; requiredAgreementIds: string[] }>(
      "GET", `/api/crew-agreements`),

  // ─── Host crew management ───────────────────────────────────────────────────
  getHostCrew: (jobId: number) =>
    request<{ ok: boolean; crew: HostCrewRow[]; building: ProjBuilding; version: string }>(
      "GET", `/api/jobs/${jobId}/crew`),

  seedCrew: (jobId: number) =>
    request<{ ok: boolean; crew: CrewMember[]; alreadySeeded?: boolean }>(
      "POST", `/api/jobs/${jobId}/crew/seed`),

  addCrewMember: (jobId: number, data: { name?: string; role?: "worker" | "host"; perWindowCents?: number; adminLinked?: boolean }) =>
    request<{ ok: boolean; member: CrewMember; crew: CrewMember[] }>(
      "POST", `/api/jobs/${jobId}/crew`, data),

  updateCrewMember: (jobId: number, memberId: string, data: { name?: string; perWindowCents?: number; active?: boolean; role?: "worker" | "host"; rotateToken?: boolean; linkedUserId?: string }) =>
    request<{ ok: boolean; member: CrewMember; crew: CrewMember[] }>(
      "PATCH", `/api/jobs/${jobId}/crew/${memberId}`, data),

  removeCrewMember: (jobId: number, memberId: string) =>
    request<{ ok: boolean; crew: CrewMember[] }>(
      "DELETE", `/api/jobs/${jobId}/crew/${memberId}`),

  // Host: create a payout notification for a worker (Puuhapatet → alihankkija).
  // billerId = which leader (their Y-tunnus) is the BUYER the worker invoices.
  createPayout: (jobId: number, memberId: string, data: { amountCents: number; windows?: number; note?: string; billerId?: string }) =>
    request<{ ok: boolean; member: CrewMember }>(
      "POST", `/api/jobs/${jobId}/crew/${memberId}/payout`, data),

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
};

export { API_BASE };
