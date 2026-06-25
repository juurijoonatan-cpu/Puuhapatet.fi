/**
 * Worker-mode guard for admin gig pages.
 *
 * Some Puuhapatet admins (e.g. Petrus) are ALSO workers on a specific gig
 * (adminLinked crew). For those gigs they must NOT see the host view — no gig
 * total, no customer price, no other workers' euros.
 *
 * Two modes:
 *  • autoRedirect (default): bounce straight to the worker's private dashboard
 *    (/tyo/:token) so a price never even renders. Used on the deep host-only
 *    pages (crew, project) as a hard safety net.
 *  • autoRedirect: false: don't navigate — just report the linked membership so
 *    the page can render a personalised "open my workspace" landing instead.
 *    Used on the gig page so Petrus stays inside his normal admin (his gig shows
 *    in Keikat, and he opens HIS dashboard from there) rather than being thrown
 *    straight into the big gig's dashboard.
 *
 * Hosts who aren't crew on the gig (Joonatan, Matias) are unaffected.
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { api } from "@/lib/api";
import { getAdminProfile } from "@/lib/admin-profile";

export interface LinkedCrewMember {
  token: string;
  name: string;
}

export function useCrewWorkerRedirect(
  jobId: number | undefined,
  opts: { autoRedirect?: boolean } = {},
): { checking: boolean; linkedMember: LinkedCrewMember | null } {
  const autoRedirect = opts.autoRedirect !== false; // default: redirect
  const [, navigate] = useLocation();
  const [checking, setChecking] = useState(true);
  const [linkedMember, setLinkedMember] = useState<LinkedCrewMember | null>(null);

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
        setLinkedMember({ token: me.member.token, name: me.member.name });
        if (autoRedirect) {
          navigate(`/tyo/${me.member.token}`, { replace: true });
          // keep "checking" true so the host view never flashes before redirect
        } else {
          setChecking(false);
        }
      } else {
        setChecking(false);
      }
    }).catch(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [jobId, navigate, autoRedirect]);

  return { checking, linkedMember };
}
