/**
 * Worker-mode guard for admin gig pages.
 *
 * Some Puuhapatet admins (e.g. Petrus) are ALSO workers on a specific gig
 * (adminLinked crew). For those gigs they must NOT see the host view — no gig
 * total, no customer price, no other workers' euros. This hook detects that
 * case and bounces them straight to their own private worker dashboard
 * (/tyo/:token), so a price never even renders.
 *
 * Hosts who aren't crew on the gig (Joonatan, Matias) are unaffected.
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { api } from "@/lib/api";
import { getAdminProfile } from "@/lib/admin-profile";

export function useCrewWorkerRedirect(jobId: number | undefined): { checking: boolean } {
  const [, navigate] = useLocation();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let active = true;
    const profile = getAdminProfile();
    if (!jobId || !profile) { setChecking(false); return; }
    api.getHostCrew(jobId).then((res) => {
      if (!active) return;
      const me = res.ok && res.data
        ? res.data.crew.find((c) => c.member.id === profile.id && c.member.adminLinked && c.member.active)
        : undefined;
      if (me) {
        navigate(`/tyo/${me.member.token}`, { replace: true });
        // keep "checking" true so the host view never flashes before redirect
      } else {
        setChecking(false);
      }
    }).catch(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [jobId, navigate]);

  return { checking };
}
