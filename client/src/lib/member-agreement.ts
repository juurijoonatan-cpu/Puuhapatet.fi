/**
 * Client helper for the member agreement gate.
 *
 * Caches the signed agreement per user in localStorage (so the gate decision is
 * instant and works offline) and syncs with the server for cross-device truth.
 */

import { api } from "@/lib/api";
import { getAdminProfile, type AdminProfile } from "@/lib/admin-profile";
import { feePctForWorker, type TeamRole } from "@shared/team";
import {
  AGREEMENT_VERSION,
  agreementTypeForRole,
  buildAgreement,
  signatureIsCurrent,
  type AgreementParty,
  type MemberAgreementSignature,
} from "@shared/member-agreement";

const KEY = "puuhapatet_member_agreement_v1";

type Store = Record<string, MemberAgreementSignature>;

function readStore(): Store {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; }
  catch { return {}; }
}
function writeStore(s: Store) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* quota */ }
}

/** Locally cached signature for a user (may be stale or for an old version). */
export function getCachedSignature(userId: string): MemberAgreementSignature | null {
  return readStore()[userId] ?? null;
}

export function cacheSignature(sig: MemberAgreementSignature) {
  const s = readStore();
  s[sig.userId] = sig;
  writeStore(s);
}

/** Build the agreement party context from an admin profile. */
export function partyFromProfile(profile: AdminProfile): AgreementParty {
  return {
    userId: profile.id,
    name: profile.name,
    role: profile.role as TeamRole,
    yTunnus: profile.yTunnus,
    feePct: feePctForWorker(profile.id),
    isUnder18: profile.isUnder18,
  };
}

export function agreementForProfile(profile: AdminProfile) {
  return buildAgreement(partyFromProfile(profile));
}

/** True if the current profile has a cached signature for the current version. */
export function hasSignedCurrent(profile: AdminProfile | null): boolean {
  if (!profile) return false;
  return signatureIsCurrent(getCachedSignature(profile.id), AGREEMENT_VERSION);
}

/**
 * Resolve signing state against the server too, and refresh the local cache.
 * Returns whether the user has signed the current version.
 */
export async function refreshSignatureState(profile: AdminProfile | null): Promise<boolean> {
  if (!profile) return false;
  if (hasSignedCurrent(profile)) return true;
  const res = await api.getMemberAgreement(profile.id);
  if (res.ok && res.data?.signature) {
    cacheSignature(res.data.signature);
    return signatureIsCurrent(res.data.signature, AGREEMENT_VERSION);
  }
  return false;
}

/** Convenience: current profile shortcut. */
export function currentProfileNeedsSigning(): boolean {
  return !hasSignedCurrent(getAdminProfile());
}
