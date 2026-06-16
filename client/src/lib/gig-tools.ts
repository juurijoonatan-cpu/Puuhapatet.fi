/**
 * Gig tools registry — the single list of dashboard tools available on every
 * custom gig. Keeping it as data (not hard-coded JSX) means new tools can be
 * added in one place and they show up both in the on-page list and the
 * full-screen tools overlay.
 *
 * `kind`:
 *   - "route" → navigates to an existing admin route (e.g. the projektinäkymä).
 *   - "panel" → rendered inside the tools overlay, no route change.
 */
import {
  LayoutDashboard, Gauge, Map as MapIcon, type LucideIcon,
} from "lucide-react";

export type GigToolId = "projekti" | "tehokkuus" | "pohjakartat";

export interface GigToolDef {
  id: GigToolId;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  accent: string;        // rgb triple, used for the icon glow
  kind: "route" | "panel";
  /** Route to navigate to, relative to /admin/gig/:id (kind === "route" only). */
  route?: (jobId: number) => string;
}

export const GIG_TOOLS: GigToolDef[] = [
  {
    id: "projekti",
    title: "Projektinäkymä",
    subtitle: "Pohjapiirros & ikkunakartta · kojelauta · työtunnit",
    icon: LayoutDashboard,
    accent: "120,200,255",
    kind: "route",
    route: (jobId) => `/admin/gig/${jobId}/projekti`,
  },
  {
    id: "tehokkuus",
    title: "Tehokkuus & tahti",
    subtitle: "Edistymistahti, arvioitu valmistuminen ja €/h",
    icon: Gauge,
    accent: "95,224,138",
    kind: "panel",
  },
  {
    id: "pohjakartat",
    title: "Pohjakartat & asetukset",
    subtitle: "Rakennus, kerrokset, hinta — tuo omat pohjakartat",
    icon: MapIcon,
    accent: "223,166,20",
    kind: "panel",
  },
];

export function getGigTool(id: GigToolId): GigToolDef | undefined {
  return GIG_TOOLS.find((t) => t.id === id);
}
