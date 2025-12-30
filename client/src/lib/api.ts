/**
 * API Client for Google Apps Script backend
 * Uses text/plain Content-Type as required by Apps Script
 */

const API_BASE = "https://script.google.com/macros/s/AKfycbx_6MzJ4WTa00fzDGIjOW6P1RVA8-2PgJ413lKmP2qWIy7lsKtRNlqLCPxI3QcC7nfpIA/exec";

interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function apiGet<T>(action: string): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(`${API_BASE}?action=${action}`, {
      method: "GET",
      mode: "cors",
    });
    
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }
    
    const data = await response.json();
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Network error" };
  }
}

async function apiPost<T, P>(action: string, payload: P): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(`${API_BASE}?action=${action}`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
      },
      body: JSON.stringify(payload),
      mode: "cors",
    });
    
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }
    
    const data = await response.json();
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Network error" };
  }
}

export function generateJobId(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `PP-${timestamp}-${random}`;
}

export interface ApiPackage {
  PackageCode: string;
  Name: string;
  Category?: string;
  SeasonMode?: string;
  BasePriceEUR?: string;
  Description_Public?: string;
  Description_Internal?: string;
  Active?: boolean;
}

export interface NormalizedPackage {
  id: string;
  name: string;
  description: string;
  durationMinutes: number;
  price: number;
  category?: string;
  active: boolean;
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

export const api = {
  health: () => apiGet<{ ok: boolean; ts: string }>("health"),
  packages: () => apiGet<{ ok: boolean; packages: ApiPackage[] }>("packages"),
  upsertJob: <T>(job: T) => apiPost<{ ok: boolean; jobId?: string; message?: string; error?: string }, T>("upsert_job", job),
  getJob: (jobId: string) => apiPost<{ ok: boolean; job?: unknown; error?: string }, { jobId: string }>("get_job", { jobId }),
  listJobs: () => apiGet<{ ok: boolean; jobs: unknown[]; total?: number; error?: string }>("list_jobs"),
};

export { API_BASE };
