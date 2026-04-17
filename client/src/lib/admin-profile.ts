/**
 * Admin Profile System
 *
 * Users are hard-coded — no invite/registration flow.
 * Login picks one of these profiles and stores the selection in localStorage.
 */

export type UserRole = "HOST" | "STAFF";

export interface AdminProfile {
  id: string;
  name: string;
  role: UserRole;
  photoUrl?: string;
  phone?: string;
  email?: string;         // Työntekijän sähköposti (piilokopio lähetettäviin viesteihin)
  yTunnus?: string;       // Y-tunnus (esim. "3598782-9")
  hasYTunnus?: boolean;   // Y-tunnus → elinkeinotoiminnan veroilmoitus (lomake 5)
  isUnder18?: boolean;    // alle 18v → huoltaja hoitaa OmaVerossa
  startupBonus?: number;  // senttiä — yritysseteli/aloitustuki 4H-yhdistykseltä
  iban?: string;          // Tilinumero tilisiirto-laskuille
  bic?: string;           // BIC/SWIFT-koodi
  address?: string;       // Postiosoite (laskuille)
}

// ─── Hard-coded team members ─────────────────────────────────────────────────

export const USERS: AdminProfile[] = [
  {
    id: "joonatan",
    name: "Joonatan Juuri",
    role: "HOST",
    photoUrl: "/joonatan.jpg.jpeg",
    phone: "+358400389999",
    email: "joonatan@puuhapatet.fi",
    yTunnus: "3598782-9",
    hasYTunnus: true,
    isUnder18: true,   // 17v
    startupBonus: 30000, // 300 €
    iban: "FI49 5780 2420 5091 79",
    bic: "OKOYFIHH",
    address: "Braskarna 8, 02380 Espoo",
  },
  {
    id: "matias",
    name: "Matias Pitkänen",
    role: "HOST",
    photoUrl: "/matias.jpg.jpeg",
    phone: "+358442350881",
    email: "matias@puuhapatet.fi",
    yTunnus: "3609912-9",
    hasYTunnus: true,
    isUnder18: false,  // 18v
    startupBonus: 30000, // 300 €
    iban: "FI49 5780 2420 5091 79",
    bic: "OKOYFIHH",
    address: "Haapaniemenrinne 5A, 02940 Espoo",
  },
  {
    id: "testi1",
    name: "Testi Ykkönen",
    role: "STAFF",
    phone: "+358000000001",
    isUnder18: false,
  },
  {
    id: "testi2",
    name: "Testi Kakkonen",
    role: "STAFF",
    phone: "+358000000002",
    isUnder18: true,
  },
];

// ─── localStorage helpers ─────────────────────────────────────────────────────

const PROFILE_KEY = "puuhapatet_admin_profile";

export function getAdminProfile(): AdminProfile | null {
  try {
    const stored = localStorage.getItem(PROFILE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as AdminProfile;
    // Always return fresh data from USERS (overrides any stale localStorage cache)
    const fresh = USERS.find(u => u.id === parsed.id);
    return fresh ?? parsed;
  } catch {
    return null;
  }
}

export function setAdminProfile(profile: AdminProfile): void {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export function clearAdminProfile(): void {
  localStorage.removeItem(PROFILE_KEY);
}

export function isProfileComplete(profile: AdminProfile | null): boolean {
  return !!(profile?.id && profile?.name && profile?.role);
}

// ─── Role helpers ─────────────────────────────────────────────────────────────

export function canManageUsers(role: UserRole): boolean {
  return role === "HOST";
}
