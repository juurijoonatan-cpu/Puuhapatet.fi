/**
 * Admin Profile System
 *
 * Users are hard-coded — no invite/registration flow.
 * Login picks one of these profiles and stores the selection in localStorage.
 */

export type UserRole = "HOST" | "STAFF" | "MARKETER";

export interface AdminProfile {
  id: string;
  name: string;
  role: UserRole;
  photoUrl?: string;
  photoObjectPosition?: string;
  phone?: string;
  email?: string;         // Työntekijän sähköposti (piilokopio lähetettäviin viesteihin)
  yTunnus?: string;       // Y-tunnus (esim. "3598782-9")
  hasYTunnus?: boolean;   // Y-tunnus → elinkeinotoiminnan veroilmoitus (lomake 5)
  isUnder18?: boolean;    // alle 18v → huoltaja hoitaa OmaVerossa
  startupBonus?: number;  // senttiä — yritysseteli/aloitustuki 4H-yhdistykseltä
  iban?: string;          // Tilinumero tilisiirto-laskuille
  bic?: string;           // BIC/SWIFT-koodi
  address?: string;       // Postiosoite (laskuille)
  /** Worker who logs in only to their own gig dashboard — never sees the admin.
   *  After login they're routed straight to /tyo/<token> (see login + guard). */
  dashboardOnly?: boolean;
  /** Trainee (harjoittelija): works under a leader's responsibility, no own
   *  Y-tunnus, doesn't invoice — earnings are pooled & split like staff. */
  isTrainee?: boolean;
  /** Admin-profile id of the leader responsible for this trainee (e.g. "matias"). */
  traineeOf?: string;
  /** Door-to-door marketer: logs in only to the sell panel (/admin/myynti),
   *  captures leads for founder triage, never sees the rest of the admin. */
  marketerOnly?: boolean;
}

// ─── Hard-coded team members ─────────────────────────────────────────────────

export const USERS: AdminProfile[] = [
  {
    id: "joonatan",
    name: "Joonatan Juuri",
    role: "HOST",
    photoUrl: "/joonatan.jpg.jpeg",
    photoObjectPosition: "50% 35%",
    phone: "+358400389999",
    email: "joonatan@puuhapatet.fi",
    yTunnus: "3598782-9",
    hasYTunnus: true,
    isUnder18: true,   // 17v
    startupBonus: 30000, // 300 €
    iban: "FI05 1808 3500 0328 48",
    bic: "NDEAFIHH",
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
    iban: "FI74 5720 2320 2418 33",
    bic: "OKOYFIHH",
    address: "Haapaniemenrinne 5A, 02940 Espoo",
  },
  {
    // Alihankkija — kirjautuu vain omaan keikkadashboardiinsa (ei admin-näkymää).
    // Aloitussalasana "Petrus123" (server INITIAL_PASSWORDS); kirjautuessa pyydetään
    // vaihtamaan se ja ohjataan suoraan /tyo-työpöydälle. Crew-linkitys:
    // linkedUserId = "petrus" (aseta työntekijät-näkymästä).
    id: "petrus",
    name: "Petrus Aalto",
    role: "STAFF",
    photoUrl: "/petrus.jpg.jpeg?v=2",
    phone: "+358442372930",
    email: "petrus.aalto@icloud.com",
    yTunnus: "3620983-4",
    hasYTunnus: true,
    isUnder18: true,    // alle 18v
    startupBonus: 30000, // 300 €
    dashboardOnly: true,
  },
  {
    // FR8-tekijä — kirjautuu vain omaan keikkadashboardiinsa (ei admin-näkymää).
    // Aloitussalasana "Jani123" (server INITIAL_PASSWORDS); kirjautuessa pyydetään
    // vaihtamaan se ja ohjataan suoraan /tyo-työpöydälle. Linkitys: crew-jäsenen
    // linkedUserId = "jani" (aseta työntekijät-näkymästä).
    id: "jani",
    name: "Jani Ihalainen",
    role: "STAFF",
    photoUrl: "/fr8/jani.jpg",
    dashboardOnly: true,
  },
  {
    // Harjoittelija — kirjautuu vain omaan keikkadashboardiinsa (kuten Jani), mutta
    // EI alihankkija: ei omaa Y-tunnusta, ei itselaskutusta. Matias Pitkänen vastaa
    // hänestä keikalla; ansiot jaetaan tiimin kesken. Aloitussalasana "milja456"
    // (server INITIAL_PASSWORDS). Crew-linkitys: linkedUserId = "milja" tai
    // etunimimatch (Milja → milja) hoituu automaattisesti.
    id: "milja",
    name: "Milja Niminen",
    role: "STAFF",
    dashboardOnly: true,
    isTrainee: true,
    traineeOf: "matias",
    hasYTunnus: false,
  },
  {
    // FR8-tekijä (alihankkija, kuten Jani) — kirjautuu vain omaan keikka-
    // dashboardiinsa. Käy läpi saman alihankkijan onboardingin: profiili + sopimukset
    // (oma Y-tunnus, omat verot/vakuutukset, urakkaperusteinen korvaus). Aloitus-
    // salasana "Oliver234" (server INITIAL_PASSWORDS); kirjautuessa pyydetään vaihtamaan.
    // Crew-linkitys: linkedUserId = "oliver" tai etunimimatch (Oliver → oliver).
    id: "oliver",
    name: "Oliver",
    role: "STAFF",
    dashboardOnly: true,
  },
  {
    // FR8-tekijä (alihankkija, kuten Jani & Oliver) — aloittaa FR8-keikalla ja
    // kirjautuu vain omaan keikkadashboardiinsa (ei admin-näkymää). Käy läpi saman
    // alihankkijan onboardingin: profiili + sopimukset (oma Y-tunnus, omat verot/
    // vakuutukset, urakkaperusteinen korvaus). Aloitussalasana "Oona345" (server
    // INITIAL_PASSWORDS); kirjautuessa pyydetään vaihtamaan se. Crew-linkitys:
    // linkedUserId = "oona" tai etunimimatch (Oona → oona) hoituu automaattisesti.
    id: "oona",
    name: "Oona",
    role: "STAFF",
    photoUrl: "/fr8/oona.jpg",
    dashboardOnly: true,
  },
  {
    // FR8-tekijä (alihankkija, kuten Jani, Oliver & Oona) — kokenut ammattilainen,
    // kirjautuu vain omaan keikkadashboardiinsa (ei admin-näkymää). Käy läpi
    // "kevyt" sopimuspaketin (shared/worker-agreements.ts DEFAULT_AGREEMENT_SETS):
    // oma Y-tunnus, omat verot/vakuutukset, urakkaperusteinen korvaus, ei kilpailu-
    // kieltoa. Aloitussalasana "Doma123" (server INITIAL_PASSWORDS); kirjautuessa
    // pyydetään vaihtamaan se. Crew-linkitys: linkedUserId = "doma" tai etunimimatch
    // (Doma → doma) hoituu automaattisesti.
    id: "doma",
    name: "Doma",
    role: "STAFF",
    photoUrl: "/fr8/doma.jpg",
    dashboardOnly: true,
  },
  {
    // Ovelta ovelle -myyjä — kirjautuu vain myyntipaneeliin (/admin/myynti).
    // Kerää liidejä (asiakas + keikka tilassa "lead", submissionStatus
    // "pending_review"), jotka perustajat hyväksyvät/ottavat/hylkäävät. Saa
    // kiinteän palkkion jokaisesta hyväksytystä diilistä (shared/team.ts).
    // Aloitussalasana "Myyja123" (server INITIAL_PASSWORDS).
    id: "myyja1",
    name: "Myyjä",
    role: "MARKETER",
    marketerOnly: true,
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

// ─── Preferred default washer ─────────────────────────────────────────────────
//
// When marking a window washed in the projektinäkymä, the entry is attributed to
// a "default washer". By default that's the logged-in admin, but each admin can
// pick a preferred default per gig (e.g. attribute everything to Matias today) —
// the per-window picker still lets them override a single window. Stored locally
// per job so it follows the admin's own dashboard, not the customer/worker.

const WASHER_KEY_PREFIX = "puuhapatet_default_washer";

export function getPreferredWasher(jobId: number): string | null {
  try {
    return localStorage.getItem(`${WASHER_KEY_PREFIX}_${jobId}`) || null;
  } catch {
    return null;
  }
}

export function setPreferredWasher(jobId: number, workerId: string): void {
  try {
    if (workerId) localStorage.setItem(`${WASHER_KEY_PREFIX}_${jobId}`, workerId);
    else localStorage.removeItem(`${WASHER_KEY_PREFIX}_${jobId}`);
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

export function isProfileComplete(profile: AdminProfile | null): boolean {
  return !!(profile?.id && profile?.name && profile?.role);
}

// ─── Role helpers ─────────────────────────────────────────────────────────────

export function canManageUsers(role: UserRole): boolean {
  return role === "HOST";
}

/** Can capture door-to-door leads (the sell panel): marketers + founders. */
export function canSell(role: UserRole): boolean {
  return role === "MARKETER" || role === "HOST";
}

/** Can triage marketer-submitted leads (accept/take/decline): founders only. */
export function canApproveLeads(role: UserRole): boolean {
  return role === "HOST";
}
