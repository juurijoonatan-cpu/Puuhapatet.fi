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
}

// ─── Hard-coded team members ─────────────────────────────────────────────────

export const USERS: AdminProfile[] = [
  {
    id: "joonatan",
    name: "Joonatan Juuri",
    role: "HOST",
    photoUrl: "/joonatan.jpg.jpeg",
    phone: "+358 45 123 4567",
  },
  {
    id: "matias",
    name: "Matias Pitkänen",
    role: "HOST",
    photoUrl: "/matias.jpg.jpeg",
    phone: "+358 45 765 4321",
  },
];

// ─── localStorage helpers ─────────────────────────────────────────────────────

const PROFILE_KEY = "puuhapatet_admin_profile";

export function getAdminProfile(): AdminProfile | null {
  try {
    const stored = localStorage.getItem(PROFILE_KEY);
    if (!stored) return null;
    return JSON.parse(stored) as AdminProfile;
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
