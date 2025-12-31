/**
 * Admin Profile System
 * 
 * Manages user profiles with roles, stored in localStorage.
 * This is a simple MVP implementation - production should use server-side storage.
 * 
 * Roles:
 * - HOST: Full permissions (Joonatan Juuri)
 * - BOARD_MEMBER: Near-admin permissions
 * - STAFF: Operational permissions
 */

export type UserRole = "HOST" | "BOARD_MEMBER" | "STAFF";

export interface AdminProfile {
  id: string;
  name: string;
  role: UserRole;
  phone?: string;
  photoUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InviteCode {
  code: string;
  intendedRole: UserRole;
  createdBy: string;
  createdAt: string;
  used: boolean;
  usedBy?: string;
}

const PROFILE_KEY = "puuhapatet_admin_profile";
const INVITES_KEY = "puuhapatet_admin_invites";
const PROFILES_KEY = "puuhapatet_all_profiles";

export function getAdminProfile(): AdminProfile | null {
  try {
    const stored = localStorage.getItem(PROFILE_KEY);
    if (!stored) return null;
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

export function setAdminProfile(profile: AdminProfile): void {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  
  const allProfiles = getAllProfiles();
  const existing = allProfiles.findIndex(p => p.id === profile.id);
  if (existing >= 0) {
    allProfiles[existing] = profile;
  } else {
    allProfiles.push(profile);
  }
  localStorage.setItem(PROFILES_KEY, JSON.stringify(allProfiles));
}

export function clearAdminProfile(): void {
  localStorage.removeItem(PROFILE_KEY);
}

export function isProfileComplete(profile: AdminProfile | null): boolean {
  if (!profile) return false;
  return !!(profile.name && profile.role && profile.photoUrl);
}

export function getAllProfiles(): AdminProfile[] {
  try {
    const stored = localStorage.getItem(PROFILES_KEY);
    if (!stored) return [];
    return JSON.parse(stored);
  } catch {
    return [];
  }
}

export function getInviteCodes(): InviteCode[] {
  try {
    const stored = localStorage.getItem(INVITES_KEY);
    if (!stored) return [];
    return JSON.parse(stored);
  } catch {
    return [];
  }
}

export function createInviteCode(intendedRole: UserRole, createdBy: string): InviteCode {
  const code = `INV-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  const invite: InviteCode = {
    code,
    intendedRole,
    createdBy,
    createdAt: new Date().toISOString(),
    used: false,
  };
  
  const invites = getInviteCodes();
  invites.push(invite);
  localStorage.setItem(INVITES_KEY, JSON.stringify(invites));
  
  return invite;
}

export function useInviteCode(code: string, userId: string): InviteCode | null {
  const invites = getInviteCodes();
  const invite = invites.find(i => i.code === code && !i.used);
  
  if (!invite) return null;
  
  invite.used = true;
  invite.usedBy = userId;
  localStorage.setItem(INVITES_KEY, JSON.stringify(invites));
  
  return invite;
}

export function validateInviteCode(code: string): InviteCode | null {
  const invites = getInviteCodes();
  return invites.find(i => i.code === code && !i.used) || null;
}

export function canManageUsers(role: UserRole): boolean {
  return role === "HOST" || role === "BOARD_MEMBER";
}

export function canCreateInvites(role: UserRole): boolean {
  return role === "HOST" || role === "BOARD_MEMBER";
}

export function canGiveDiscounts(role: UserRole): boolean {
  return true;
}

export function canGenerateInvoice(role: UserRole): boolean {
  return true;
}

export function generateProfileId(): string {
  return `USER-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
}
