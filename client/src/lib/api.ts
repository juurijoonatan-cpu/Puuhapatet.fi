/**
 * API Client — Render.com Express backend
 */

const API_BASE = "https://puuhapatet-fi.onrender.com";

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
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      mode: "cors",
    });
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
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }
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
    allWorkers?: { name: string; phone?: string; email?: string; yTunnus?: string }[];
    lang?: "fi" | "en";
  }) => request<{ ok: boolean; id?: string }>("POST", "/api/send-job-summary", data),

  sendQuote: (data: {
    to: string;
    bcc?: string;
    quoteId: string;
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
  }) => request<{ ok: boolean; id?: string }>("POST", "/api/send-quote", data),

  getCustomerJobCount: (customerId: number) =>
    request<{ count: number }>("GET", `/api/customers/${customerId}/job-count`),

  getUserPassword: (userId: string) =>
    request<{ password: string | null }>("GET", `/api/admin/user-password/${userId}`),

  setUserPasswordRemote: (userId: string, password: string) =>
    request<{ ok: boolean }>("POST", `/api/admin/user-password/${userId}`, { password }),

  // Legacy compat stubs
  getJob: (_jobId: string): Promise<ApiResponse<{ ok: boolean; job?: unknown }>> =>
    Promise.resolve({ ok: false }),

  upsertJob: (_job: unknown): Promise<ApiResponse<{ ok: boolean; jobId?: string; error?: string }>> =>
    Promise.resolve({ ok: false, error: "Deprecated" }),
};

export { API_BASE };
