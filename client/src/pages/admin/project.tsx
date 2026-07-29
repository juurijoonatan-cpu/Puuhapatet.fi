/**
 * FR8 projektinäkymä — admin tool page (protected).
 *
 * Hosts the ported floor-plan window tool (dashboard + per-floor mapping +
 * work hours) and persists everything to the database via /api/jobs/:id/project.
 * Replaces the prototype's localStorage with debounced server autosave and adds
 * per-worker attribution so the dashboard can show window counts and €/h.
 */
import { useEffect, useState, useRef, useCallback } from "react";
import { useRoute, useLocation } from "wouter";
import { api } from "@/lib/api";
import { getAdminProfile, USERS, getPreferredWasher, setPreferredWasher } from "@/lib/admin-profile";
import { useCrewWorkerRedirect } from "@/lib/use-crew-redirect";
import {
  emptyProjectData, computeWorkerStats, isFr8Plans, fixedDealFor, allPoints, computeDealBilling,
  dealInternalRateCents,
  type ProjectData, type ProjMarksData, type WindowStatus, type ProjNoteKind, type ProjExpense,
} from "@shared/project";
import { computeP2Billing, p2WorkerPayoutCents, DEFAULT_P2_WORKER_SHARE_PCT, DEFAULT_P2_PAYOUT_SCHEDULE, P2_PRICE_PRESETS_CENTS, type P2State, type P2PayoutRule } from "@shared/p2";
import { computeGuided, type GuidedWork } from "@shared/guided";
import Navbar, { type Fr8Tab } from "@/components/fr8/Navbar";
import { FOUNDER_IDS } from "@shared/team";
import { traineeForUserId, traineeForName } from "@shared/trainees";
import { DEFAULT_WORKER_PER_WINDOW_CENTS } from "@shared/crew";
import Dashboard from "@/components/fr8/Dashboard";
import FounderEraInvoiceDialog from "@/components/fr8/FounderEraInvoiceDialog";
import MaksutView from "@/components/fr8/MaksutView";
import type { GigBillingState, EraInvoiceClient } from "@/lib/api";
import { computeWorkerSettlements, eraSettlementByWorker, sumWorkerSettlements } from "@shared/worker-payouts";
import { BRAND_BILLERS } from "@shared/billers";
import FloorView from "@/components/fr8/FloorView";
import Section from "@/components/fr8/Section";
import LoadingOrb from "@/components/LoadingOrb";
import { useIsMobile } from "@/hooks/use-mobile";

const MARKS_URL = "/fr8/marks_data.json";

/** True if at least one floor has seeded window marks. */
function hasAnyMarks(marks: ProjMarksData | null | undefined): boolean {
  if (!marks) return false;
  return Object.values(marks).some((f) => Array.isArray(f?.marks) && f.marks.length > 0);
}

/** Load the bundled base marks (static asset, served from the same origin). */
async function fetchBaseMarks(): Promise<ProjMarksData> {
  try {
    const r = await fetch(MARKS_URL);
    const j = await r.json();
    return j && typeof j === "object" ? (j as ProjMarksData) : {};
  } catch {
    return {};
  }
}

function workerName(id: string): string {
  const u = USERS.find((x) => x.id === id);
  if (u) return u.name.split(" ")[0];
  return id ? id.charAt(0).toUpperCase() + id.slice(1) : id;
}
function workerInitial(id: string): string {
  return (workerName(id)[0] || "?").toUpperCase();
}

/**
 * Build the display-name map + this gig's pickable crew (for the "who washed"
 * and "default washer" pickers).
 *
 * This page is founders-only (admin-linked workers like Petrus are redirected to
 * their own dashboard), so every active crew member — INCLUDING admin-linked
 * ones (Petrus) — is pickable here. That lets a founder (e.g. Matias) attribute
 * windows/points to Petrus from the menu. Inactive crew are left out.
 */
function computeWorkerMaps(project: ProjectData): {
  workerNames: Record<string, string>;
  gigWorkers: { id: string; name: string }[];
} {
  const workerNames: Record<string, string> = {};
  for (const u of USERS) workerNames[u.id] = u.name;
  for (const m of project.crew ?? []) workerNames[m.id] = m.name;
  // Crew members who can't be picked: only inactive (removed) ones.
  const hiddenWorkerIds = new Set<string>();
  for (const m of project.crew ?? []) {
    if (m.active === false) hiddenWorkerIds.add(m.id);
  }
  const gigWorkers: { id: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const id of [...(project.workers ?? []), ...((project.crew ?? []).map((m) => m.id))]) {
    if (seen.has(id) || hiddenWorkerIds.has(id)) continue;
    seen.add(id);
    gigWorkers.push({ id, name: workerNames[id] ?? workerName(id) });
  }
  return { workerNames, gigWorkers };
}

export default function AdminProjectPage() {
  const [, params] = useRoute("/admin/gig/:id/projekti");
  const [, navigate] = useLocation();
  const jobId = Number(params?.id);
  const profile = getAdminProfile();
  const currentWorker = profile?.id || "joonatan";
  const { checking: crewChecking } = useCrewWorkerRedirect(jobId);

  // Syvälinkki `?tab=maksut` — keikkanäkymän "Tekijöiden maksut" hyppää suoraan
  // Maksut-välilehdelle, ettei samaa osiota tarvitse toistaa kahdessa näkymässä.
  const [tab, setTab] = useState<Fr8Tab>(() => {
    if (typeof window === "undefined") return "dashboard";
    const t = new URLSearchParams(window.location.search).get("tab");
    return t === "maksut" || t === "floor" ? t : "dashboard";
  });
  const [activeFloor, setActiveFloor] = useState("K");
  // Who new "pesty" markings are attributed to by default. Defaults to the
  // logged-in admin, but each admin can pick a preferred default washer per gig
  // (persisted locally) — the per-window picker still overrides a single window.
  const [defaultWasher, setDefaultWasher] = useState<string>(currentWorker);
  const washerInit = useRef(false);
  const [project, setProject] = useState<ProjectData | null>(null);
  // How much P2 (keltaiset) is already invoiced (server sums scope:"p2" payments)
  // — lets the P2 panel show "laskuttamatta = kertymä − laskutettu".
  const [p2Invoiced, setP2Invoiced] = useState(0);
  // Asiakaslaskutuksen tila serveriltä (punaisten 4 erää + keltaiset). Yksi
  // laskenta serverillä → dash ja Maksut näyttävät samat luvut kuin laskureitti.
  const [billing, setBilling] = useState<GigBillingState | null>(null);
  /** Päivitä keltaisten laskutustila + asiakaslaskutuksen erä-statsit serveriltä.
   *  Kutsutaan kun P2-tila muuttuu (hinta lukittuu → kertymä kasvaa). */
  const refreshBilling = useCallback(async () => {
    const r = await api.getProject(jobId);
    if (r.ok && r.data) {
      setP2Invoiced(r.data.p2InvoicedCents ?? 0);
      setBilling(r.data.billing ?? null);
    }
  }, [jobId]);
  // Tekijöiden erälaskut — tarvitaan dashin "tekijöille maksettavaa" -statsiin.
  // Reitti on johtajarajattu ja palauttaa tyhjän listan ei-FR8-keikalla, joten
  // epäonnistuminen ei ole virhe: silloin stats jää pois.
  const [eraInvoices, setEraInvoices] = useState<EraInvoiceClient[]>([]);
  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    void api.getEraInvoices(jobId).then((r) => {
      if (cancelled) return;
      setEraInvoices(r.ok && Array.isArray(r.data?.invoices) ? r.data.invoices : []);
    });
    return () => { cancelled = true; };
  }, [jobId]);
  const [gigName, setGigName] = useState("");   // gig/company name for a neutral header
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<ProjectData | null>(null);
  // True while `latest.current` holds changes that haven't been confirmed saved.
  // Drives the last-chance flush on page hide/refresh so marks/notes can't be
  // lost in the debounce window (the cause of "dots reset after refresh").
  const dirty = useRef(false);

  // Lock browser page-zoom while the tool is open so pinch/scroll gestures zoom
  // only the floor-plan map (which has its own in-app zoom) — not the whole
  // page and its stats. The previous viewport is restored on unmount.
  useEffect(() => {
    const vp = document.querySelector('meta[name="viewport"]');
    const prev = vp?.getAttribute("content") ?? null;
    vp?.setAttribute("content", "width=device-width, initial-scale=1.0, maximum-scale=1, user-scalable=no");
    return () => { if (vp && prev != null) vp.setAttribute("content", prev); };
  }, []);

  // ── Load (and seed / heal if necessary) ─────────────────────────────────────
  useEffect(() => {
    if (!jobId) { setError("Virheellinen keikka."); setLoading(false); return; }
    let cancelled = false;
    (async () => {
      // Always load the bundled floor marks alongside the backend calls so the
      // maps can be filled even if persistence is missing or stale.
      const [jobRes, projRes, baseMarks] = await Promise.all([
        api.getJobById(jobId),
        api.getProject(jobId),
        fetchBaseMarks(),
      ]);
      if (cancelled) return;

      // Workers assigned to the job → who appears in the hours view.
      const job = (jobRes.ok && jobRes.data) ? ((jobRes.data as any).job ?? jobRes.data) : null;
      const assigned = String(job?.assignedTo ?? "")
        .split(",").map((s) => s.trim()).filter(Boolean)
        .filter((id) => USERS.some((u) => u.id === id));
      const workers = assigned.length ? assigned : ["matias", "joonatan"];

      // Gig/company name → neutral header for white-label gigs (no FR8 branding).
      try {
        const gd = job?.gigData ? JSON.parse(job.gigData) : null;
        if (gd?.company?.name) setGigName(String(gd.company.name));
      } catch { /* ignore */ }

      // Backend reachable and a project already exists.
      if (projRes.ok && projRes.data?.project) {
        const p = projRes.data.project;
        setP2Invoiced(projRes.data.p2InvoicedCents ?? 0);
        setBilling(projRes.data.billing ?? null);
        // Make sure every assigned worker shows up in the hours view.
        const mergedWorkers = Array.from(new Set([...(p.workers || []), ...workers]));
        // Heal the original FR8 gig if it was ever saved without its bundled
        // marks. Other gigs are left untouched so they never inherit FR8 plans.
        const needMarks = isFr8Plans(p.building.planBase) && !hasAnyMarks(p.marks) && hasAnyMarks(baseMarks);
        // Pin the FR8 signed price so every consumer (tools, billing) agrees.
        const fr8Deal = fixedDealFor(p);
        const needPrice = !!fr8Deal && p.pricePerWindow !== fr8Deal.pricePerWindow;
        if (needMarks || needPrice) {
          const healed: ProjectData = {
            ...p,
            marks: needMarks ? baseMarks : p.marks,
            pricePerWindow: needPrice ? fr8Deal!.pricePerWindow : p.pricePerWindow,
            workers: mergedWorkers,
          };
          setProject(healed);
          void api.updateProject(jobId, healed);
        } else {
          setProject({ ...p, workers: mergedWorkers });
        }
        setLoading(false);
        return;
      }

      // Backend reachable, no project yet → create a blank, editable project.
      // (No FR8 marks/plans — the crew sets up floors & maps per gig.)
      if (projRes.ok) {
        const seeded: ProjectData = { ...emptyProjectData(), workers };
        const saveRes = await api.updateProject(jobId, seeded);
        if (cancelled) return;
        if (saveRes.ok && saveRes.data) {
          setProject({ ...saveRes.data.project, workers });
        } else {
          // Even if the save fails (e.g. column not migrated yet), show the tool
          // so it is usable; just warn that changes won't persist yet.
          setProject(seeded);
          setError(saveRes.error
            ? `Tallennus ei vielä käytössä (${saveRes.error}) — näkymä toimii, mutta muutoksia ei tallenneta.`
            : null);
        }
        setLoading(false);
        return;
      }

      // Backend unreachable (route missing, server asleep, network) → still show
      // the tool so it is usable. Edits won't persist until the connection is back.
      setProject({ ...emptyProjectData(), workers });
      setError(projRes.error
        ? `Yhteys palvelimeen epäonnistui (${projRes.error}) — muutoksia ei tallenneta.`
        : "Yhteys palvelimeen epäonnistui — muutoksia ei tallenneta.");
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [jobId]);

  // ── Debounced autosave ──────────────────────────────────────────────────────
  const scheduleSave = useCallback((next: ProjectData) => {
    latest.current = next;
    dirty.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const payload = latest.current;
      if (!payload) return;
      setSaving(true);
      const res = await api.updateProject(jobId, payload);
      setSaving(false);
      if (res.ok) dirty.current = false;
      else setError(res.error || "Tallennus epäonnistui");
    }, 700);
  }, [jobId]);

  // Last-chance save when the page is hidden/closed/refreshed. A hard refresh or
  // tab close does NOT run React's unmount cleanup, so a pending debounced save
  // would be lost — that's why marked dots/notes "reset" after a refresh. We
  // flush synchronously with a keepalive request that outlives the page.
  // visibilitychange→hidden is the reliable signal on iOS Safari / PWAs (where
  // beforeunload often doesn't fire); pagehide covers desktop reloads/closes.
  useEffect(() => {
    const flush = () => {
      if (!dirty.current || !latest.current) return;
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
      api.flushProject(jobId, latest.current);
      dirty.current = false;
    };
    const onHide = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
      // SPA navigation away from the page: flush whatever is still pending.
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (dirty.current && latest.current) { void api.updateProject(jobId, latest.current); }
    };
  }, [jobId]);

  // Apply a mutation to the project (clone → mutate → set state + autosave).
  const mutate = useCallback((producer: (draft: ProjectData) => void) => {
    setProject((cur) => {
      if (!cur) return cur;
      const next = JSON.parse(JSON.stringify(cur)) as ProjectData;
      producer(next);
      next.updatedAt = Date.now();
      scheduleSave(next);
      return next;
    });
  }, [scheduleSave]);

  // ── Window helpers ──────────────────────────────────────────────────────────
  const getPriority = useCallback((draft: ProjectData, key: string): 1 | 2 => {
    if (key.includes("#c")) {
      const f = key.split("#")[0];
      return (draft.customMarks[f] || []).find((c) => c.key === key)?.p ?? 1;
    }
    const [f, idx] = key.split("#");
    return draft.marks?.[f]?.marks[parseInt(idx, 10)]?.p ?? 1;
  }, []);

  const onStatusChange = useCallback((key: string, status: WindowStatus, washedById?: string) => {
    // The washer defaults to the admin's preferred default washer (falling back
    // to the logged-in user), but can be overridden per window (and changed
    // later) via the picker in FloorView's status popover.
    const washer = washedById ?? defaultWasher ?? currentWorker;
    mutate((d) => {
      if (status === "ei") { delete d.statuses[key]; delete d.washedBy[key]; }
      else {
        d.statuses[key] = status;
        if (status === "pesty") d.washedBy[key] = washer;
        else delete d.washedBy[key];
      }
      // A 50/50 split only makes sense on a fully-washed window — drop it otherwise.
      if (status !== "pesty" && d.washedBy2) delete d.washedBy2[key];
      const p = getPriority(d, key);
      const floor = key.split("#")[0];
      d.log = [{ floor, key, p, status, ts: Date.now(), by: washer }, ...d.log].slice(0, 60);
    });
  }, [mutate, getPriority, currentWorker, defaultWasher]);

  // Credit a fully-washed window to a second worker (50/50). Passing null clears
  // the split. The window stays one washed window — only the earnings split.
  const onSetSplit = useCallback((key: string, second: string | null) => {
    mutate((d) => {
      if (!d.washedBy2) d.washedBy2 = {};
      if (second && d.washedBy[key] && d.washedBy[key] !== second) d.washedBy2[key] = second;
      else delete d.washedBy2[key];
    });
  }, [mutate]);

  const onAddCustomMark = useCallback((floor: string, x: number, y: number, p: 1 | 2) => {
    mutate((d) => {
      const key = `${floor}#c${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
      d.customMarks[floor] = [...(d.customMarks[floor] || []), { key, p, x, y }];
    });
  }, [mutate]);

  const onDeleteMark = useCallback((key: string) => {
    mutate((d) => {
      const f = key.split("#")[0];
      delete d.posOverrides[key];
      delete d.statuses[key];
      delete d.washedBy[key];
      if (d.washedBy2) delete d.washedBy2[key];
      if (key.includes("#c")) {
        d.customMarks[f] = (d.customMarks[f] || []).filter((c) => c.key !== key);
      } else {
        d.deleted[key] = true;
      }
    });
  }, [mutate]);

  const onMoveMark = useCallback((key: string, x: number, y: number) => {
    mutate((d) => { d.posOverrides[key] = { x, y }; });
  }, [mutate]);

  const onResetFloor = useCallback((floor: string) => {
    mutate((d) => {
      d.posOverrides = Object.fromEntries(Object.entries(d.posOverrides).filter(([k]) => !k.startsWith(floor + "#")));
      d.deleted = Object.fromEntries(Object.entries(d.deleted).filter(([k]) => !(k.startsWith(floor + "#") && !k.includes("#c"))));
      d.customMarks[floor] = [];
    });
  }, [mutate]);

  // ── Navigation markers / notes ──────────────────────────────────────────────
  const onAddNote = useCallback((floor: string, x: number, y: number, kind: ProjNoteKind): string => {
    const key = `${floor}#n${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
    mutate((d) => {
      if (!d.notes) d.notes = {};
      d.notes[floor] = [...(d.notes[floor] || []), { key, x, y, kind, text: "", ts: Date.now(), by: currentWorker }];
    });
    return key;
  }, [mutate, currentWorker]);

  const onUpdateNote = useCallback((floor: string, key: string, text: string) => {
    mutate((d) => {
      if (!d.notes?.[floor]) return;
      d.notes[floor] = d.notes[floor].map((n) => (n.key === key ? { ...n, text } : n));
    });
  }, [mutate]);

  const onDeleteNote = useCallback((floor: string, key: string) => {
    mutate((d) => {
      if (!d.notes?.[floor]) return;
      d.notes[floor] = d.notes[floor].filter((n) => n.key !== key);
    });
  }, [mutate]);

  // Per-window observation (text + optional photo). Empty clears it.
  const onSetObservation = useCallback((key: string, text: string, imageDataUrl?: string) => {
    mutate((d) => {
      if (!d.observations) d.observations = {};
      if (!text.trim() && !imageDataUrl) delete d.observations[key];
      else d.observations[key] = { text: text.trim(), imageDataUrl, by: currentWorker, ts: Date.now() };
    });
  }, [mutate, currentWorker]);

  // ── Active work zone ("work happening here now", visible to the customer) ────
  const onSetActiveZone = useCallback((floor: string, x: number, y: number) => {
    mutate((d) => { d.activeZone = { floor, x, y, ts: Date.now() }; });
  }, [mutate]);

  const onClearActiveZone = useCallback(() => {
    mutate((d) => { d.activeZone = null; });
  }, [mutate]);

  const onGoToFloor = useCallback((floor: string) => {
    setActiveFloor(floor);
    setTab("floor");
  }, []);

  const changeDefaultWasher = useCallback((id: string) => {
    setDefaultWasher(id);
    setPreferredWasher(jobId, id);
  }, [jobId]);

  // Seed the default washer once the project (and its crew) is known: use the
  // admin's saved preference for this gig if it points at a valid worker, else
  // fall back to the logged-in admin.
  useEffect(() => {
    if (washerInit.current || !project) return;
    washerInit.current = true;
    const { gigWorkers } = computeWorkerMaps(project);
    const pref = getPreferredWasher(jobId);
    setDefaultWasher(pref && gigWorkers.some((w) => w.id === pref) ? pref : currentWorker);
  }, [project, jobId, currentWorker]);

  const backToGig = useCallback(() => navigate(`/admin/gig/${jobId}`), [navigate, jobId]);

  // ── Expense management ──────────────────────────────────────────────────────
  const addExpense = useCallback(async (data: { kind: string; desc: string; amountCents: number; by: string; forWhom?: string; receiptDataUrl?: string }) => {
    const res = await api.addProjectExpense(jobId, data);
    if (res.ok && res.data?.expenses) {
      setProject((cur) => cur ? { ...cur, expenses: res.data!.expenses } : cur);
    }
  }, [jobId]);

  const deleteExpense = useCallback(async (expenseId: string) => {
    const res = await api.deleteProjectExpense(jobId, expenseId);
    if (res.ok && res.data?.expenses) {
      setProject((cur) => cur ? { ...cur, expenses: res.data!.expenses } : cur);
    }
  }, [jobId]);

  // ── P2 (keltaiset ikkunat) — per-window pricing handlers ────────────────────
  // Dedikoidut /p2-reitit palauttavat tallennetun p2-tilan; se päivitetään
  // paikalliseen projektiin sellaisenaan (geneerinen autosave ei koske p2:een —
  // serveri liittää aina oman kopionsa takaisin, ks. server/routes.ts).
  // HUOM: nämä hookit PITÄÄ olla ennen alla olevia early returneja (loading/
  // !project) — hookit eivät saa suorittua ehdollisesti (React #310).
  const applyP2 = useCallback((p2: P2State) => {
    setProject((cur) => (cur ? { ...cur, p2 } : cur));
    latest.current = latest.current ? { ...latest.current, p2 } : latest.current;
    // Hinnan lukitus/avaus muuttaa keltaisten kertymää → laskutustiili ja dashin
    // LASKUTUS & MAKSUT -statsit haetaan uudelleen serverin laskennasta.
    void refreshBilling();
  }, [refreshBilling]);
  const onP2Propose = useCallback(async (keys: string[], priceCents: number) => {
    const res = await api.p2Propose(jobId, { keys, priceCents, by: currentWorker });
    if (res.ok && res.data) applyP2(res.data.p2);
    else setError(res.error || "Hinnoittelu epäonnistui");
  }, [jobId, currentWorker, applyP2]);

  // ── Ohjattu eteneminen (guided) — perustajan kytkin + kerroksen ohitus ──────
  // Guided-tila on serverin omistama kuten p2 (geneerinen autosave ei koske
  // siihen). /guided-reitti palauttaa tallennetun kytkimen; päivitetään paikalliseen
  // projektiin. Johdettu tila (aktiivinen kerros, seuraava ikkuna) lasketaan
  // clientissä `computeGuided`illä suoraan kartasta, joten se pysyy aina synkassa.
  // HUOM: tämä hook on ennen early returneja (React #310).
  const onGuidedSet = useCallback(async (data: { enabled?: boolean; activeFloorOverride?: string | null; openFloors?: string[] }) => {
    const res = await api.guidedSet(jobId, data);
    if (res.ok && res.data) {
      const guided = res.data.guided;
      setProject((cur) => (cur ? { ...cur, guided } : cur));
      latest.current = latest.current ? { ...latest.current, guided } : latest.current;
    } else setError(res.error || "Tallennus epäonnistui");
  }, [jobId]);

  // ── Render ──────────────────────────────────────────────────────────────────
  const shell = (children: React.ReactNode) => (
    <div className="fr8-root" style={{ position: "fixed", top: 0, left: 0, right: 0, background: "#060607", color: "#fff", overflow: "hidden", fontFamily: "var(--font-onest, system-ui, sans-serif)" }}>
      {/* Single, very subtle top glow — kept faint so the dashboard reads clean */}
      <div style={{ position: "absolute", top: "-35%", left: "50%", transform: "translateX(-50%)", width: "1000px", height: "620px", background: "radial-gradient(ellipse at center, rgba(120,124,150,0.05), transparent 68%)", pointerEvents: "none" }} />
      {children}
    </div>
  );

  if (loading || crewChecking) {
    return shell(
      <div style={{ position: "relative", zIndex: 10, height: "100%" }}>
        <LoadingOrb label="Ladataan projektinäkymää" theme="dark" fullScreen={false} />
      </div>,
    );
  }
  if (!project) {
    return shell(
      <div style={{ position: "relative", zIndex: 10, height: "100%", display: "flex", flexDirection: "column", gap: 16, alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "rgba(255,255,255,0.6)" }}>{error || "Projektia ei voitu ladata."}</p>
        <button onClick={backToGig} style={{ padding: "10px 18px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.05)", color: "#fff", cursor: "pointer" }}>
          Takaisin keikkaan
        </button>
      </div>,
    );
  }

  // The FR8 gig is a signed, fixed-price deal (€37.50/red window, €6300 cap) —
  // the price is locked and only red windows accrue money.
  const deal = fixedDealFor(project);
  const effectivePrice = deal ? deal.pricePerWindow : project.pricePerWindow;

  // ── "Uusi luku" -juhla ────────────────────────────────────────────────────
  // Kun asiakas on hyväksynyt KAIKEN: P2 päällä, ainakin yksi ikkuna lukittu,
  // eikä yhtään avointa ehdotusta (asiakkaan inbox) tai vastatarjousta (meidän
  // inbox) — ja jokainen keltainen on hinnoiteltu (ei roikkuvia asiakasehdotuksia).
  // Näytetään VAIN perustajille (Joonatan & Matias), kerran per keikka/selain.
  const isFounderView = profile?.role === "HOST" || FOUNDER_IDS.includes(profile?.id || "");
  const cb = computeP2Billing(project);
  const p2AllApproved =
    !!project.p2?.enabled &&
    cb.lockedCount > 0 &&
    cb.proposedCount === 0 &&
    cb.counteredCount === 0 &&
    cb.pricedCount === cb.yellowTotal;
  const celebrateMilestone = !!deal && p2AllApproved;

  // ── Ansiomalli ──────────────────────────────────────────────────────────────
  // • Työntekijä: pestyt × oma €/ikkuna (esim. Jani 20 €).
  // • Perustaja (Joonatan/Matias): sisäinen kate × itse pesemät ikkunat
  //   + tuotto-osuus työntekijöiden ikkunoista: jokaisesta työntekijän pesemästä
  //   ikkunasta (sisäinen kate − työntekijän rate) jaetaan perustajien kesken.
  //   Sisäinen kate = sopimuksen kokonaissumma / punaiset ikkunat yhteensä
  //   (esim. 6300 € / 165 ikk = 38,18 €/ikk — dynaamisesti projektikohtaisesti).
  // Manuaalinen ohitus (manualEarningsCents) voittaa aina. Nimet crew:stä.
  const crew = project.crew ?? [];
  const isFounder = (id: string, role?: string) => role === "host" || FOUNDER_IDS.includes(id);
  const dealTotalCents = Math.round(effectivePrice * 100);
  // Sisäinen kate: EFEKTIIVINEN sopimussumma jaettuna todellisella punaisella
  // ikkunamäärällä (`dealInternalRateCents`). Tämä on perustajien oman työn oikea
  // ansio per ikkuna — ei nimellinen 37,50 € (laskettu sopimuksen 168 ikkunan
  // mukaan) eikä raaka 6300 € / ikkunamäärä.
  //
  // HUOM: tämä laskettiin aiemmin täällä raa'asta `deal.capCents`ista, kun
  // Dashboard laski saman luvun efektiivisestä summasta — perustajien osio
  // jakoi siis enemmän kuin keikan kertymä näytti. Nyt yksi jaettu funktio.
  const totalBillable = deal ? allPoints(project).filter((p) => p.p === deal.billablePriority).length : 0;
  const internalKateCents = deal ? dealInternalRateCents(project, deal) : dealTotalCents;
  const founderCount = Math.max(1, crew.filter((c) => isFounder(c.id, c.role)).length || FOUNDER_IDS.length);
  // A trainee (e.g. Milja) is credited to their responsible leader (Matias):
  // their washed windows + hours fold into the leader, and the trainee is NOT a
  // separate earner here. (On the worker's own dashboard they still see their own
  // work; this folding is only for the manager/earnings views.)
  const leaderOf = (id: string): string | null => {
    const mm = crew.find((c) => c.id === id);
    const t = traineeForUserId(mm?.linkedUserId) || traineeForUserId(id) || traineeForName(mm?.name);
    return t ? t.responsibleLeaderId : null;
  };
  const isTrainee = (id: string): boolean => !!leaderOf(id);
  const baseStatsRaw = computeWorkerStats(project);
  // Trainees (e.g. Milja) are NOT folded into their leader's DISPLAYED windows/hours
  // anymore. Each person — trainees included — keeps their own window and hour counts
  // so the bosses see real individual progress and a leader like Matias tracks only
  // his own work. A trainee's washed windows still feed their LEADER's PAY below (the
  // founder earns the full rate per trainee window), but the trainee never shows a
  // euro figure of their own — their pay stays combined with the leader.
  const baseStats = baseStatsRaw.map((st) => ({ ...st }));
  // A trainee's washed RED windows, credited to their responsible leader FOR PAY
  // ONLY. Keltaiset lasketaan erikseen palkkiotaulukolla (`p2EarnedFor`), joten
  // niitä ei saa summata tähän punaisten taksalla laskettavaan määrään.
  const traineeWashedByLeader: Record<string, number> = {};
  for (const st of baseStatsRaw) {
    const lead = leaderOf(st.worker);
    if (lead) traineeWashedByLeader[lead] = (traineeWashedByLeader[lead] || 0) + st.washedP1;
  }
  /** Harjoittelijan KELTAISET palkkiot, hyvitetään samoin johtajalle (hän tilittää
   *  ne eteenpäin). Ilman tätä johtajan kortin erittely (oma työ + harjoittelija +
   *  tuotto-osuus + keltaiset) ei summautuisi kortin loppusummaan. */
  const traineeP2CentsByLeader: Record<string, number> = {};
  // Hours are shown per person (no folding) so a trainee's specific hours stay
  // separate from their leader's.
  const managerHours: Record<string, number> = {};
  for (const [id, h] of Object.entries(project.hours || {})) {
    managerHours[id] = (managerHours[id] || 0) + (h || 0);
  }
  // Tekijän oma €/ikkuna. YKSI fallback kaikkialla (aiemmin sama tapaus käytti
  // kolmea eri arvoa: 37,50 € täällä, 20 € tuottopotissa ja 0 € erälaskennassa —
  // poistetun tekijän haamu-ikkunat maksoivat siis eri verran joka näkymässä).
  const rateOf = (id: string): number => crew.find((c) => c.id === id)?.perWindowCents ?? DEFAULT_WORKER_PER_WINDOW_CENTS;
  // Keltaisen (P2) ikkunan palkkio tekijälle — palkkiotaulukko, ei punaisten taksa.
  const p2Enabled = !!project.p2?.enabled;
  const p2SharePct = project.p2?.workerSharePct ?? DEFAULT_P2_WORKER_SHARE_PCT;
  const p2Schedule = project.p2?.payoutSchedule;
  // Keltaisten palkkiot per tekijä YHDELLÄ kartan läpikäynnillä (aiempi per-tekijä
  // -haku olisi käynyt koko pistelistan jokaiselle tekijälle joka renderillä).
  const p2CentsByWorker: Record<string, number> = {};
  if (p2Enabled) {
    const offers = project.p2?.offers ?? {};
    const by2 = project.washedBy2 || {};
    for (const pt of allPoints(project)) {
      if (pt.p !== 2 || pt.status !== "pesty") continue;
      const offer = offers[pt.key];
      if (offer?.status !== "locked" || !offer.lockedCents) continue;
      const payout = p2WorkerPayoutCents(offer.lockedCents, p2SharePct, p2Schedule);
      const second = by2[pt.key];
      if (pt.washedBy) p2CentsByWorker[pt.washedBy] = (p2CentsByWorker[pt.washedBy] || 0) + (second ? payout / 2 : payout);
      if (second) p2CentsByWorker[second] = (p2CentsByWorker[second] || 0) + payout / 2;
    }
  }
  /** Yhden tekijän keltaisista kertynyt palkkio (0 kun vaihe 2 ei ole päällä). */
  const p2EarnedFor = (workerId: string): number => Math.round(p2CentsByWorker[workerId] || 0);
  // Profit pool = Σ over real workers (NOT founders, NOT trainees) of
  // (sisäinen kate − that worker's rate) per worker-washed RED window. Keltaiset
  // eivät kuulu tähän: niissä kate lasketaan omalla logiikallaan (computeP2Billing
  // marginCents) eikä punaisten sisäisellä katteella. Aiemmin tässä käytettiin
  // `st.washed`ia, joka sisälsi keltaiset → haamukatetta perustajille.
  let profitPoolCents = 0;
  for (const st of baseStatsRaw) {
    const mm = crew.find((c) => c.id === st.worker);
    if (!isFounder(st.worker, mm?.role) && !isTrainee(st.worker)) {
      profitPoolCents += st.washedP1 * Math.max(0, internalKateCents - rateOf(st.worker));
    }
  }
  const founderProfitEachCents = Math.round(profitPoolCents / founderCount);
  const earningsFor = (st: { worker: string; washed: number; washedP1: number }): number => {
    const mm = crew.find((c) => c.id === st.worker);
    if (mm?.manualEarningsCents != null) return mm.manualEarningsCents;
    // washed can be fractional (50/50 split windows count as 0.5) — round cents.
    // PUNAISET maksavat oman taksan (perustajille sisäinen kate), KELTAISET
    // palkkiotaulukon mukaan — sama malli kuin crewMemberStats, joka ajaa
    // tekijän omaa näkymää ja Tiimi-sivua. Aiemmin täällä kaikki ikkunat
    // (myös keltaiset) laskettiin punaisten taksalla → dash ja Tiimi eri mieltä.
    const p2Cents = p2EarnedFor(st.worker);
    if (isFounder(st.worker, mm?.role)) {
      const traineeWashed = traineeWashedByLeader[st.worker] || 0;
      return Math.round((st.washedP1 + traineeWashed) * internalKateCents)
        + (traineeP2CentsByLeader[st.worker] || 0)
        + founderProfitEachCents
        + p2Cents;
    }
    return Math.round(st.washedP1 * rateOf(st.worker)) + p2Cents;
  };
  const resolveName = (id: string): string => {
    const m = crew.find((c) => c.id === id);
    if (m?.name?.trim()) return m.name.trim().split(/\s+/)[0];
    return workerName(id);
  };

  // Trainee indicator: each trainee (e.g. Milja) now gets their OWN windows/hours card
  // on the dashboard, with no euro — their pay is settled through the leader (Matias).
  // This maps a trainee id → the leader's display name for that "palkka <leader>" note.
  const traineeInfo: Record<string, { leaderName: string }> = {};
  // Leader id → the trainee slices folded into their COMBINED pay, so the leader's card
  // can break the total down ("sis. Milja 6 ikk · 225 €" — how much of the combined sum
  // is the trainee's work). Each trainee window is worth the full deal rate.
  const traineeShareByLeader: Record<string, { name: string; washed: number; cents: number }[]> = {};
  for (const st of baseStatsRaw) {
    const lead = leaderOf(st.worker);
    if (lead) {
      traineeInfo[st.worker] = { leaderName: resolveName(lead) };
      const traineeP2 = p2EarnedFor(st.worker);
      traineeP2CentsByLeader[lead] = (traineeP2CentsByLeader[lead] || 0) + traineeP2;
      if (st.washed > 0) (traineeShareByLeader[lead] ||= []).push({
        name: resolveName(st.worker),
        washed: st.washed,
        cents: Math.round(st.washedP1 * internalKateCents) + traineeP2,
      });
    }
  }

  // Founders appear even with 0 own windows — they still earn the profit share.
  const statIds = new Set(baseStats.map((s) => s.worker));
  for (const f of crew.filter((c) => isFounder(c.id, c.role))) {
    if (!statIds.has(f.id)) baseStats.push({ worker: f.id, washed: 0, washedP1: 0, washedP2: 0, revenueCents: 0, hours: Math.max(0, managerHours[f.id] || 0), windowsPerHour: 0, eurPerHour: 0 });
  }
  // Deaktivoitu tekijä (esim. Milja, jolle on maksettu ja joka on poistettu
  // rosterista) ei näy dashissa lainkaan. Palaa näkyviin heti kun hänet
  // aktivoidaan Tiimi-sivun kytkimestä.
  const inactiveIds = new Set(crew.filter((c) => c.active === false).map((c) => c.id));
  const workerStats = baseStats.filter((s) => !inactiveIds.has(s.worker)).map((s) => {
    // Trainees show no euro of their own — their pay is folded into their leader.
    const cents = isTrainee(s.worker) ? 0 : earningsFor(s);
    return {
      ...s,
      revenueCents: cents,
      windowsPerHour: s.hours > 0 ? s.washed / s.hours : 0,
      eurPerHour: s.hours > 0 ? cents / 100 / s.hours : 0,
    };
  });
  // ── Perustajien (bossien) ansioerittely dashboardille ───────────────────────
  // Perustajan ansio = oma PUNAINEN työ × sisäinen kate + harjoittelijan osuus
  // + tuotto-osuus työntekijöiden punaisista + oma keltainen palkkio.
  const founderEarnings = workerStats
    .filter((s) => isFounder(s.worker, crew.find((c) => c.id === s.worker)?.role))
    .map((s) => {
      const mm = crew.find((c) => c.id === s.worker);
      // Vastuullaan tehty PUNAINEN työ = omat + harjoittelijan ikkunat. Harjoittelija
      // ei ole enää oma rivi kortilla (hänelle on maksettu ja hän on deaktivoitu),
      // joten hänen työnsä lasketaan johtajan omaan työhön — näin kortin erittely
      // (oma työ + tuotto-osuus + keltaiset) summautuu tarkalleen loppusummaan.
      const ownWashed = s.washedP1 + (traineeWashedByLeader[s.worker] || 0);
      const manual = mm?.manualEarningsCents != null;
      const p2Cents = p2EarnedFor(s.worker) + (traineeP2CentsByLeader[s.worker] || 0);
      return {
        id: s.worker,
        name: resolveName(s.worker),
        ownWashed,
        ownCents: Math.round(ownWashed * internalKateCents),
        shareCents: founderProfitEachCents,
        p2Cents,
        p2Washed: s.washedP2,
        totalCents: s.revenueCents, // respects manual override
        manual,
        hours: s.hours,
      };
    })
    .sort((a, b) => b.totalCents - a.totalCents);
  // What all real workers (not founders, not trainees) earn — the labour cost side
  // of the gig. PUNAISTEN osuus erikseen, koska "Sopimushinta"-tiili sen vieressä
  // on punaisten efektiivinen sopimussumma: jos keltaiset laskettaisiin samaan
  // lukuun, kolmen tiilen rivi ei enää täsmäisi (sopimus ≠ työntekijät + perustajat).
  const realWorkerStats = workerStats.filter((s) => {
    const mm = crew.find((c) => c.id === s.worker);
    return !isFounder(s.worker, mm?.role) && !isTrainee(s.worker);
  });
  const workerLaborP2Cents = realWorkerStats.reduce((sum, s) => sum + p2EarnedFor(s.worker), 0);
  const workerLaborCents = realWorkerStats.reduce((sum, s) => sum + s.revenueCents, 0) - workerLaborP2Cents;

  // Founders can manually set their own day/session earnings (e.g. split 50/50).
  const setWorkerEarnings = (id: string, cents: number | null) => {
    setProject((cur) => {
      if (!cur) return cur;
      const next = { ...cur, crew: (cur.crew || []).map((mm) => mm.id === id ? { ...mm, manualEarningsCents: cents == null ? undefined : cents } : mm) };
      void api.updateProject(jobId, next);
      return next;
    });
  };

  // Paljonko tekijöille on punaisista vielä siirtämättä — sama jaettu laskenta
  // kuin Maksut-välilehdellä ja Tiimi-sivulla, jotta dashin stats ei voi eriytyä.
  const dashPayable = computeWorkerSettlements(project, {
    era: eraSettlementByWorker(eraInvoices, "p1"),
    p2Era: eraSettlementByWorker(eraInvoices, "p2"),
  });
  const dashOpenP1Cents = sumWorkerSettlements(dashPayable).openP1Cents;

  // Display-name map + this gig's pickable crew (used by both the "who washed"
  // and "default washer" pickers).
  const { workerNames, gigWorkers } = computeWorkerMaps(project);
  // The default washer the picker shows is the saved preference if it's still a
  // valid worker, else the logged-in admin.
  const effectiveWasher = gigWorkers.some((w) => w.id === defaultWasher) ? defaultWasher : currentWorker;

  return shell(
    <>
      <Navbar
        activeTab={tab}
        onTabChange={setTab}
        buildingName={project.building.name || gigName || undefined}
        buildingAddress={project.building.address}
        currentWorkerName={resolveName(effectiveWasher)}
        saving={saving}
        onBack={backToGig}
        workers={gigWorkers}
        defaultWasherId={effectiveWasher}
        onChangeDefaultWasher={changeDefaultWasher}
        showMaksutTab={!!deal && (profile?.role === "HOST" || FOUNDER_IDS.includes(profile?.id || ""))}
      />
      {isFounderView && celebrateMilestone && (
        <FounderCelebration jobId={jobId} />
      )}
      {error && (
        <div
          style={{
            position: "fixed", top: 70, left: "50%", transform: "translateX(-50%)", zIndex: 60,
            maxWidth: "min(92vw, 560px)", padding: "9px 16px", borderRadius: 11,
            background: "rgba(80,60,20,0.85)", border: "1px solid rgba(255,200,90,0.35)",
            color: "rgba(255,236,200,0.95)", fontSize: 12.5, textAlign: "center",
            backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)",
            boxShadow: "0 12px 34px rgba(0,0,0,0.45)",
          }}
        >
          {error}
        </div>
      )}
      <main style={{ position: "relative", zIndex: 10, minHeight: 0 }}>
        {tab === "dashboard" && (
          <Dashboard project={project} workerStats={workerStats} workerName={resolveName} onGoToFloor={onGoToFloor} deal={deal} onSetEarnings={setWorkerEarnings} founderEarnings={founderEarnings} workerLaborCents={workerLaborCents} workerLaborP2Cents={workerLaborP2Cents} founderRateEur={internalKateCents / 100}
            p2Slot={deal ? (
              <P2AdminPanel
                project={project}
                jobId={jobId}
                by={currentWorker}
                onP2={applyP2}
                onGoToFloor={onGoToFloor}
                canSend={profile?.role === "HOST" || FOUNDER_IDS.includes(profile?.id || "")}
                p2InvoicedCents={p2Invoiced}
              />
            ) : undefined}
            /* Kerrosten lukitus on apuasetus, ei päänäkymän asia — se renderöidään
               dashin alalaitaan omana slotina. */
            settingsSlot={
              <FloorLockPanel
                project={project}
                onGuidedSet={onGuidedSet}
                canSend={profile?.role === "HOST" || FOUNDER_IDS.includes(profile?.id || "")}
              />
            }
            expensesTotalCents={(project.expenses || []).reduce((s, e) => s + e.amountCents, 0)}
            expensesSlot={
              <ExpensesView
                expenses={project.expenses || []}
                workers={[...gigWorkers, ...crew.filter(c => !gigWorkers.some(w => w.id === c.id)).map(c => ({ id: c.id, name: resolveName(c.id) }))]}
                currentWorker={currentWorker}
                resolveName={resolveName}
                onAdd={addExpense}
                onDelete={deleteExpense}
              />
            }
            founderInvoiceSlot={(founderId) => {
              // Johtaja-välinen erälasku (kohta 3C.1): painike VAIN toisen
              // johtajan kortilla — omalla kortilla ei koskaan (kriteeri 6.5).
              // HUOM: crew.tsx:n Tiimi-sivu ei kelpaa paikaksi, koska
              // /api/jobs/:id/crew suodattaa host-rivit pois (ks. reitin
              // kommentti) — perustajakortit ovat siellä olemattomia.
              const myId = profile?.id || "";
              if (!deal || founderId === myId || !FOUNDER_IDS.includes(myId) || !FOUNDER_IDS.includes(founderId)) return null;
              return (
                <FounderEraInvoiceDialog
                  jobId={jobId}
                  senderId={myId}
                  senderName={BRAND_BILLERS.find((b) => b.id === myId)?.name || myId}
                  recipient={{ id: founderId, name: BRAND_BILLERS.find((b) => b.id === founderId)?.name || resolveName(founderId) }}
                />
              );
            }}
            /* Tekijöiden maksu EI ole enää täällä: se asuu Maksut-välilehdellä
               per-tekijä-maksettavan vieressä, jossa summat ovat näkyvissä.
               Aiemmin nappi oli kesken KERROKSITTAIN- ja VIIMEISIN TOIMINTA
               -palkkeja ilman mitään tietoa siitä paljonko kuuluu maksaa. */
            gigBilling={billing}
            workerOpenP1Cents={dashOpenP1Cents}
            onGoToMaksut={() => setTab("maksut")}
          />
        )}
        {/* Maksut — koko rahaliikenne (asiakaslaskutus + tekijöiden maksettava),
            vain FR8 + johtajat. Navbar näyttää välilehden vain johtajille; tämä
            ehto on sama tuplavarmistus. */}
        {tab === "maksut" && deal && (profile?.role === "HOST" || FOUNDER_IDS.includes(profile?.id || "")) && (
          <MaksutView jobId={jobId} project={project} billing={billing} onOpenGig={backToGig} />
        )}
        {tab === "floor" && (
          <FloorView
            floors={project.building.floors}
            planBase={project.building.planBase || ""}
            pricePerWindow={effectivePrice}
            marks={project.marks}
            statuses={project.statuses}
            posOverrides={project.posOverrides}
            customMarks={project.customMarks}
            deleted={project.deleted}
            initialFloor={activeFloor}
            onStatusChange={onStatusChange}
            onAddCustomMark={onAddCustomMark}
            onDeleteMark={onDeleteMark}
            onMoveMark={onMoveMark}
            onMoveMarkCommit={onMoveMark}
            onResetFloor={onResetFloor}
            washedBy={project.washedBy}
            washedBy2={project.washedBy2}
            onSetSplit={onSetSplit}
            keskenBy={project.keskenBy}
            workerNames={workerNames}
            workers={gigWorkers}
            currentWorkerId={effectiveWasher}
            notes={project.notes}
            onAddNote={onAddNote}
            onUpdateNote={onUpdateNote}
            onDeleteNote={onDeleteNote}
            observations={project.observations}
            canObserve
            onSetObservation={onSetObservation}
            activeZone={project.activeZone}
            onSetActiveZone={onSetActiveZone}
            onClearActiveZone={onClearActiveZone}
            deal={deal}
            p2={project.p2 ? { enabled: project.p2.enabled, offers: project.p2.offers } : null}
            onP2Propose={onP2Propose}
            /* Kartta tarvitsee vain tiedon avoimista kerroksista — "seuraava ikkuna"
               -ohjaus on poistettu. */
            guided={project.guided?.enabled ? (() => { const g = computeGuided(project); return { enabled: true, activeFloor: g.activeFloor, activeFloors: g.activeFloors, lockedFloors: g.lockedFloors, nextKey: null }; })() : null}
          />
        )}
      </main>
    </>,
  );
}

// ─── FounderCelebration — "uusi luku" -juhla (vain perustajille) ──────────────

/**
 * Kertaluontoinen (per keikka/selain) juhlaoverlay perustajille kun asiakas on
 * hyväksynyt kaikki lisäikkunat. Itsenäinen: CSS-serpentiinit (index.css:
 * fr8-confetti-fall) + kortti. prefers-reduced-motion pysäyttää animaation.
 */
function FounderCelebration({ jobId }: { jobId: number }) {
  const seenKey = `fr8-celebrate-${jobId}`;
  const [show, setShow] = useState(() => {
    try { return localStorage.getItem(seenKey) !== "1"; } catch { return true; }
  });
  const strips = useState(() => {
    const colors = ["255,72,72", "255,205,40", "95,224,138", "255,255,255", "124,180,255"];
    return Array.from({ length: 48 }, (_, i) => ({
      left: Math.round(Math.random() * 100),
      color: colors[i % colors.length],
      delay: Math.round(Math.random() * 2200) / 1000,
      dur: 2.6 + Math.round(Math.random() * 2200) / 1000,
      w: i % 3 === 0 ? 6 : 3,
      h: 12 + (i % 5) * 4,
    }));
  })[0];
  useEffect(() => {
    if (!show) return;
    try { localStorage.setItem(seenKey, "1"); } catch { /* ignore */ }
    const t = window.setTimeout(() => setShow(false), 6500);
    return () => window.clearTimeout(t);
  }, [show, seenKey]);
  if (!show) return null;
  return (
    <div
      className="fr8-confetti"
      onClick={() => setShow(false)}
      style={{ position: "fixed", inset: 0, zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(4,4,6,0.55)", backdropFilter: "blur(3px)", WebkitBackdropFilter: "blur(3px)", cursor: "pointer" }}
    >
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
        {strips.map((s, i) => (
          <span key={i} style={{
            position: "absolute", top: -30, left: `${s.left}%`, width: s.w, height: s.h,
            borderRadius: 2, background: `rgb(${s.color})`,
            animation: `fr8-confetti-fall ${s.dur}s linear ${s.delay}s infinite`,
          }} />
        ))}
      </div>
      <div style={{ position: "relative", maxWidth: 420, margin: "0 20px", padding: "26px 28px", borderRadius: 20, background: "linear-gradient(160deg, rgba(20,22,26,0.98), rgba(12,13,16,0.98))", border: "1px solid rgba(95,224,138,0.35)", boxShadow: "0 24px 70px rgba(0,0,0,0.6)", textAlign: "center" }}>
        <div style={{ fontSize: 42, marginBottom: 6 }}>🎉</div>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: "#9ff0bd", marginBottom: 8 }}>Uusi luku alkaa</div>
        <div style={{ fontSize: 19, fontWeight: 800, color: "#fff", lineHeight: 1.35, marginBottom: 8 }}>
          Asiakas hyväksyi kaikki lisäikkunat! 🟢
        </div>
        <p style={{ margin: "0 0 16px", fontSize: 13.5, lineHeight: 1.6, color: "rgba(255,255,255,0.72)" }}>
          Priority 2 on kokonaan sovittu. Hienoa työtä, Joonatan &amp; Matias — nyt pestään ja laskutetaan. 💪
        </p>
        <button onClick={() => setShow(false)}
          style={{ padding: "10px 22px", borderRadius: 12, border: "none", background: "#5fe08a", color: "#062012", fontFamily: "inherit", fontSize: 14, fontWeight: 800, cursor: "pointer" }}>
          Jatketaan 🚀
        </button>
      </div>
    </div>
  );
}

// ─── P2AdminPanel — keltaisten ikkunoiden hinnoittelu & neuvottelu ────────────

const p2eur = (c: number) => (c / 100).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const P2_STATUS_LABEL: Record<string, string> = {
  proposed: "odottaa asiakasta",
  countered: "vastatarjous",
  locked: "lukittu ✓",
  declined: "hylätty",
};

/**
 * Adminin P2-osio dashboardilla: vaihekytkin, tekijän %-osuus, tilannetiilet,
 * neuvottelu-inbox (asiakkaan vastatarjoukset), anomaliavaroitukset ja
 * tapahtumaloki. Hinnoittelu itsessään tapahtuu kartalla (€ Hinnoittele -tila).
 */
function P2AdminPanel({ project, jobId, by, onP2, onGoToFloor, canSend, p2InvoicedCents = 0 }: {
  project: ProjectData;
  jobId: number;
  by: string;
  onP2: (p2: P2State) => void;
  onGoToFloor: (floor: string) => void;
  canSend: boolean;
  /** €-cents of P2 already invoiced (scope:"p2" payments) — from the server. */
  p2InvoicedCents?: number;
}) {
  const p2 = project.p2;
  const b = computeP2Billing(project);
  const p2Remaining = Math.max(0, b.earnedCents - p2InvoicedCents);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [shareDraft, setShareDraft] = useState(String(p2?.workerSharePct ?? DEFAULT_P2_WORKER_SHARE_PCT));
  const [counterInputs, setCounterInputs] = useState<Record<string, string>>({});
  const [showLog, setShowLog] = useState(false);
  // Tekijän palkkiotaulukko (hinta → kiinteä palkkio). Muokataan euroina.
  const activeSchedule: P2PayoutRule[] = p2?.payoutSchedule ?? DEFAULT_P2_PAYOUT_SCHEDULE;
  const [showPayout, setShowPayout] = useState(false);
  const [payoutRows, setPayoutRows] = useState<{ price: string; pay: string }[]>(
    activeSchedule.map((r) => ({ price: String(r.priceCents / 100), pay: String(r.payoutCents / 100) })),
  );
  const parseEuro = (str: string) => { const v = Number(String(str).replace(",", ".")); return Number.isFinite(v) ? Math.round(v * 100) : NaN; };
  const savePayout = () => {
    const rules: P2PayoutRule[] = [];
    for (const row of payoutRows) {
      const priceCents = parseEuro(row.price), payoutCents = parseEuro(row.pay);
      if (!(priceCents > 0) || !(payoutCents >= 0)) continue;
      rules.push({ priceCents, payoutCents });
    }
    void run(() => api.p2SetPhase(jobId, { payoutSchedule: rules, by }), "Palkkiotaulukko tallennettu");
  };

  async function run<T extends { ok: boolean; error?: string; data?: { p2: P2State } }>(fn: () => Promise<T>, okMsg?: string) {
    setBusy(true); setMsg(null);
    const res = await fn();
    setBusy(false);
    if (res.ok && res.data) { onP2(res.data.p2); if (okMsg) setMsg(okMsg); }
    else setMsg(res.error || "Toiminto epäonnistui");
  }

  const setPhase = (enabled: boolean) => run(() => api.p2SetPhase(jobId, { enabled, by }), enabled ? "Vaihe 2 avattu" : "Vaihe 2 suljettu");
  const saveShare = () => {
    const pct = Math.floor(Number(shareDraft));
    if (!Number.isInteger(pct) || pct < 1 || pct > 100) { setMsg("Osuuden on oltava 1–100 %"); return; }
    void run(() => api.p2SetPhase(jobId, { workerSharePct: pct, by }), "Osuus tallennettu");
  };
  const respond = (key: string, action: "accept_counter" | "cancel" | "unlock" | "propose", priceCents?: number, version?: number) =>
    run(() => api.p2Respond(jobId, { key, action, priceCents, version, by }));

  const countered = Object.entries(p2?.offers ?? {}).filter(([, o]) => o.status === "countered");
  const customerAdded = (p2?.events ?? []).filter((e) => e.action === "add_point").length;
  const sharePct = p2?.workerSharePct ?? DEFAULT_P2_WORKER_SHARE_PCT;

  // Napit ovat 44 px korkeita (Applen/Googlen minimiosumakoko). Aiemmat 30 px
  // napit olivat syy siihen että "pitää painaa napin yläpuolelta".
  const btn: React.CSSProperties = { minHeight: 44, padding: "11px 15px", borderRadius: 11, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.9)", fontFamily: "var(--font-onest, system-ui, sans-serif)", fontSize: "13px", fontWeight: 600, cursor: "pointer" };
  const tile: React.CSSProperties = { flex: "1 1 120px", minWidth: 110, padding: "11px 13px", borderRadius: 12, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" };
  const tileLabel: React.CSSProperties = { fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "9px", letterSpacing: "0.1em", color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 4 };
  const tileVal: React.CSSProperties = { fontSize: "15px", fontWeight: 700, color: "#fff", fontVariantNumeric: "tabular-nums" };

  return (
    <Section
      id="p2"
      label="KELTAISET"
      summary={
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {p2?.enabled ? "🟢 " : ""}
          {b.lockedCount > 0 ? `${b.lockedCount} sovittu · ${p2eur(b.lockedSumCents)}` : `${b.yellowTotal} kpl`}
          {countered.length > 0 ? ` · ${countered.length} vastatarjous` : ""}
        </span>
      }
      defaultOpen={countered.length > 0}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

        {/* Vaihe päälle/pois — yksi nappi, ei selityksiä. */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button
            disabled={busy || !canSend}
            onClick={() => void setPhase(!(p2?.enabled))}
            style={{ ...btn, border: "none", background: p2?.enabled ? "rgba(95,224,138,0.9)" : "rgba(255,255,255,0.12)", color: p2?.enabled ? "#0a0a0c" : "#fff", fontWeight: 700 }}
          >
            {p2?.enabled ? "Vaihe 2 päällä" : "Avaa vaihe 2"}
          </button>
          <button style={btn} onClick={() => onGoToFloor(project.building.floors[0] || "K")}>€ Hinnoittele kartalla</button>
        </div>

        {/* Luvut: sovittu · pesty · odottaa hyväksyntää · kate. Ei virkkeitä. */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div style={tile}><span style={tileLabel}>SOVITTU</span><span style={{ ...tileVal, color: "#7CE0A6" }}>{b.lockedCount} kpl · {p2eur(b.lockedSumCents)}</span></div>
          <div style={tile}><span style={tileLabel}>PESTY</span><span style={tileVal}>{b.lockedWashedCount} kpl · {p2eur(b.earnedCents)}</span></div>
          {b.pendingWashedCount > 0 && (
            <div style={{ ...tile, borderColor: "rgba(150,175,255,0.35)" }}>
              <span style={tileLabel}>ODOTTAA HYVÄKSYNTÄÄ</span>
              <span style={{ ...tileVal, color: "rgb(150,175,255)" }}>{b.pendingWashedCount} kpl · {p2eur(b.pendingEarnedCents)}</span>
            </div>
          )}
          <div style={tile}>
            <span style={tileLabel}>KATE</span>
            <span style={{ ...tileVal, color: "#9ff0bd" }}>{p2eur(b.marginCents)}</span>
            <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)", display: "block", marginTop: 2 }}>tekijöille {p2eur(b.workerCostCents)}</span>
          </div>
          {(p2InvoicedCents > 0 || p2Remaining > 0) && (
            <div style={tile}>
              <span style={tileLabel}>LASKUTETTU</span>
              <span style={tileVal}>{p2eur(p2InvoicedCents)}</span>
              <span style={{ fontSize: "10px", color: p2Remaining > 0 ? "rgb(255,205,40)" : "rgba(255,255,255,0.4)", display: "block", marginTop: 2 }}>
                {p2Remaining > 0 ? `laskuttamatta ${p2eur(p2Remaining)}` : "kaikki laskutettu ✓"}
              </span>
            </div>
          )}
        </div>

        {/* Yksi tilarivi: hinnoittelematta / odottaa asiakasta / asiakkaan lisäämät. */}
        <div style={{ fontSize: "12.5px", color: "rgba(255,255,255,0.6)", display: "flex", gap: 14, flexWrap: "wrap" }}>
          <span><b style={{ color: "#fff" }}>{b.yellowTotal}</b> keltaista</span>
          <span><b style={{ color: "rgb(150,175,255)" }}>{b.proposedCount}</b> odottaa asiakasta</span>
          {b.yellowTotal - b.pricedCount > 0 && <span><b style={{ color: "rgb(255,205,40)" }}>{b.yellowTotal - b.pricedCount}</b> ilman hintaa</span>}
          {customerAdded > 0 && <span>💡 asiakas ehdotti {customerAdded}</span>}
        </div>

        {/* Pesty ilman hintaa — perustajan tehtävälista, ei varoitusseinä. */}
        {b.unpricedWashedCount > 0 && (
          <div style={{ padding: "10px 13px", borderRadius: 11, background: "rgba(255,176,72,0.08)", border: "1px solid rgba(255,176,72,0.3)", fontSize: "12.5px", color: "rgba(255,220,160,0.95)" }}>
            {b.unpricedWashedCount} pesty ilman hintaa — hinnoittele ne kartalla.
          </div>
        )}

        {/* Vastatarjoukset — tässä on ainoa varsinainen toiminto. */}
        {countered.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "10px", letterSpacing: "0.12em", color: "rgba(255,205,40,0.8)" }}>VASTATARJOUKSET</span>
            {countered.map(([key, offer]) => {
              const floor = key.split("#")[0];
              const draft = counterInputs[key] ?? "";
              const draftCents = (() => { const v = Number(draft.replace(",", ".")); return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null; })();
              return (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "10px 12px", borderRadius: 11, background: "rgba(255,205,40,0.05)", border: "1px solid rgba(255,205,40,0.2)" }}>
                  <button onClick={() => onGoToFloor(floor)} style={{ minHeight: 38, background: "transparent", border: "none", color: "#fff", fontWeight: 700, fontSize: "13px", cursor: "pointer", fontFamily: "inherit", padding: "0 4px" }} title="Näytä kartalla">
                    krs {floor} · {key.split("#")[1]}
                  </button>
                  <span style={{ fontSize: "12.5px", color: "rgba(255,255,255,0.6)", fontVariantNumeric: "tabular-nums" }}>
                    {p2eur(offer.priceCents)} → <strong style={{ color: "rgb(255,205,40)" }}>{p2eur(offer.counterCents ?? 0)}</strong>
                  </span>
                  <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <button disabled={busy} onClick={() => void respond(key, "accept_counter", offer.counterCents, offer.version)} style={{ ...btn, border: "none", background: "rgba(95,224,138,0.9)", color: "#0a0a0c", fontWeight: 700 }}>
                      Hyväksy
                    </button>
                    <input
                      type="number" inputMode="decimal" min={1} step="0.5" placeholder="uusi €"
                      value={draft}
                      onChange={(e) => setCounterInputs((m) => ({ ...m, [key]: e.target.value }))}
                      style={{ width: 78, minHeight: 44, padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.16)", background: "rgba(0,0,0,0.4)", color: "#fff", fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "13px", outline: "none" }}
                    />
                    <button disabled={busy || !draftCents} onClick={() => draftCents && void respond(key, "propose", draftCents)} style={btn}>Ehdota</button>
                    <button disabled={busy} onClick={() => void respond(key, "cancel", undefined, offer.version)} style={{ ...btn, color: "rgba(255,155,155,0.9)" }}>Peru</button>
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Palkkiotaulukko + loki — kaksi nappia, sisällöt piilossa kunnes tarvitaan.
            Sopimusteksti EI ole täällä: se kuuluu keikkanäkymän sopimusosioon. */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => { setShowPayout((v) => !v); setPayoutRows(activeSchedule.map((r) => ({ price: String(r.priceCents / 100), pay: String(r.payoutCents / 100) }))); }} style={btn}>
            Palkkiot {activeSchedule.map((r) => `${Math.round(r.payoutCents / 100)}`).join("/")} €
          </button>
          {(p2?.events?.length ?? 0) > 0 && (
            <button onClick={() => setShowLog((v) => !v)} style={{ ...btn, marginLeft: "auto", background: "transparent", color: "rgba(255,255,255,0.55)" }}>
              {showLog ? "Piilota loki" : `Loki (${p2!.events.length})`}
            </button>
          )}
        </div>

        {showPayout && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px", borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
            {payoutRows.map((row, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input value={row.price} inputMode="decimal" aria-label="Ikkunan hinta" onChange={(e) => setPayoutRows((rs) => rs.map((r, j) => j === i ? { ...r, price: e.target.value } : r))}
                  style={{ width: 74, minHeight: 44, padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.16)", background: "rgba(0,0,0,0.4)", color: "#fff", fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "13px", outline: "none" }} />
                <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.4)" }}>€ →</span>
                <input value={row.pay} inputMode="decimal" aria-label="Tekijän palkkio" onChange={(e) => setPayoutRows((rs) => rs.map((r, j) => j === i ? { ...r, pay: e.target.value } : r))}
                  style={{ width: 74, minHeight: 44, padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(124,224,166,0.3)", background: "rgba(0,0,0,0.4)", color: "#7CE0A6", fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "13px", outline: "none" }} />
                <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.4)" }}>€</span>
                <button onClick={() => setPayoutRows((rs) => rs.filter((_, j) => j !== i))} aria-label="Poista rivi" style={{ ...btn, minWidth: 44, padding: "10px 12px" }}>✕</button>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button onClick={() => setPayoutRows((rs) => [...rs, { price: "", pay: "" }])} style={btn}>+ Rivi</button>
              <button onClick={() => setPayoutRows(DEFAULT_P2_PAYOUT_SCHEDULE.map((r) => ({ price: String(r.priceCents / 100), pay: String(r.payoutCents / 100) })))} style={btn}>Oletukset</button>
              <button disabled={busy} onClick={savePayout} style={{ ...btn, border: "none", background: "#fff", color: "#0a0a0c", fontWeight: 700 }}>Tallenna</button>
            </div>
            {/* Fallback-% muille hinnoille — pieni, ei selitystä. */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.07)" }}>
              <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.5)" }}>Muut hinnat</span>
              <input type="number" min={1} max={100} value={shareDraft} onChange={(e) => setShareDraft(e.target.value)}
                style={{ width: 64, minHeight: 44, padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.16)", background: "rgba(0,0,0,0.4)", color: "#fff", fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "13px", outline: "none" }} />
              <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.4)" }}>%</span>
              {Number(shareDraft) !== sharePct && (
                <button disabled={busy} onClick={saveShare} style={btn}>Tallenna %</button>
              )}
            </div>
          </div>
        )}

        {showLog && (
          <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 260, overflowY: "auto" }}>
            {p2!.events.slice(0, 40).map((e, i) => (
              <div key={i} style={{ display: "flex", gap: 8, fontSize: "11.5px", color: "rgba(255,255,255,0.6)", fontVariantNumeric: "tabular-nums" }}>
                <span style={{ flexShrink: 0, fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "10px", color: "rgba(255,255,255,0.35)" }}>
                  {new Date(e.ts).toLocaleString("fi-FI", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
                <span style={{ fontWeight: 600, color: e.actor === "customer" ? "rgb(255,205,40)" : "#9ff0bd" }}>{e.actor === "customer" ? "asiakas" : e.actor}</span>
                <span>
                  {e.action === "propose" ? "ehdotti" : e.action === "accept" ? "hyväksyi" : e.action === "counter" ? "vastatarjosi" : e.action === "accept_counter" ? "hyväksyi vastatarjouksen" : e.action === "decline" ? "hylkäsi" : e.action === "cancel" ? "perui" : e.action === "unlock" ? "avasi lukituksen" : "lisäsi pisteen"}
                  {" "}{e.key}{e.priceCents ? ` · ${p2eur(e.priceCents)}` : ""}
                </span>
              </div>
            ))}
          </div>
        )}

        {msg && <div style={{ fontSize: "12.5px", color: "rgba(255,220,160,0.95)" }}>{msg}</div>}
      </div>
    </Section>
  );
}

// ─── FloorLockPanel — kerrosten lukitus ───────────────────────────────────────

/** Kerroksen selkokielinen nimi ("Kellari" / "3. kerros"). */
function guidedFloorName(floor: string | null): string {
  if (!floor) return "—";
  return floor === "K" ? "Kellari" : `${floor}. kerros`;
}

/**
 * KERROSTEN LUKITUS — yksi asia, ei ohjausjärjestelmää.
 *
 * Perustaja valitsee mitkä kerrokset ovat AUKI. Tavalliset tekijät näkevät ja
 * pesevät vain avoimia kerroksia; perustajat pesevät kaikkia. Ei mitään muuta:
 * ei automaattista etenemistä, ei "seuraava ikkuna" -ohjausta, ei pakotettuja
 * kerroksia. (Aiempi ohjattu eteneminen teki kaikkea tuota ja oli käytössä
 * lähinnä tiellä — kun keltaisia on satoja auki, "yks kerros kerrallaa" ei
 * vastaa todellisuutta.)
 *
 * Data on sama kuin ennen (`guided.enabled` + `guided.openFloors`), joten
 * serverin portti ja testit pysyvät ennallaan: ei valittuja kerroksia =
 * ei lukkoa (enabled=false), valitut kerrokset = tasan ne auki.
 */
function FloorLockPanel({ project, onGuidedSet, canSend }: {
  project: ProjectData;
  onGuidedSet: (data: { enabled?: boolean; activeFloorOverride?: string | null; openFloors?: string[] }) => Promise<void>;
  canSend: boolean;
}) {
  const enabled = project.guided?.enabled === true;
  const openFloors = enabled ? (project.guided?.openFloors ?? []) : [];
  const [busy, setBusy] = useState(false);
  const floors = project.building.floors;

  /** Napauta kerrosta → auki/lukkoon. Ensimmäinen valinta kytkee lukituksen
   *  päälle, kaikkien poisto kytkee sen pois (kartta kokonaan auki). */
  const toggleFloor = async (f: string) => {
    const next = openFloors.includes(f) ? openFloors.filter((x) => x !== f) : [...openFloors, f];
    setBusy(true);
    await onGuidedSet(next.length ? { enabled: true, openFloors: next, activeFloorOverride: null } : { enabled: false, openFloors: [] });
    setBusy(false);
  };
  const openAll = async () => { setBusy(true); await onGuidedSet({ enabled: false, openFloors: [] }); setBusy(false); };

  const lockedFloors = enabled ? floors.filter((f) => !openFloors.includes(f)) : [];

  return (
    <Section
      id="floorlock"
      label="KERROSTEN LUKITUS"
      summary={enabled && openFloors.length
        ? `auki: ${openFloors.join(", ")}`
        : "kaikki auki"}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {floors.map((f) => {
            const on = !enabled || openFloors.includes(f);
            return (
              <button key={f} disabled={busy || !canSend} onClick={() => void toggleFloor(f)}
                style={{
                  minWidth: 52, minHeight: 44, padding: "10px 14px", borderRadius: 11,
                  border: on ? "1px solid rgba(95,224,138,0.55)" : "1px solid rgba(255,255,255,0.14)",
                  background: on ? "rgba(95,224,138,0.16)" : "rgba(255,255,255,0.04)",
                  color: on ? "#9ff0bd" : "rgba(255,255,255,0.5)",
                  fontFamily: "var(--font-onest, system-ui, sans-serif)", fontSize: "14px", fontWeight: 700,
                  cursor: "pointer", opacity: canSend ? 1 : 0.5,
                }}>
                {on ? "" : "🔒 "}{f}
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: "12px", color: "rgba(255,255,255,0.55)" }}>
          {lockedFloors.length > 0
            ? <span>Lukossa tekijöiltä: <b style={{ color: "#fff" }}>{lockedFloors.map(guidedFloorName).join(", ")}</b></span>
            : <span>Kaikki kerrokset auki.</span>}
          {enabled && (
            <button disabled={busy || !canSend} onClick={() => void openAll()}
              style={{ marginLeft: "auto", minHeight: 38, padding: "8px 13px", borderRadius: 9, border: "1px solid rgba(255,255,255,0.16)", background: "transparent", color: "rgba(255,255,255,0.75)", fontFamily: "var(--font-onest, system-ui, sans-serif)", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>
              Avaa kaikki
            </button>
          )}
        </div>
      </div>
    </Section>
  );
}

// ─── ExpensesView ─────────────────────────────────────────────────────────────

const EXPENSE_KINDS: { id: string; label: string }[] = [
  { id: "transport", label: "Kuljetukset" },
  { id: "materials", label: "Tarvikkeet" },
  { id: "equipment", label: "Välineet" },
  { id: "other", label: "Muu" },
];

const EXPENSE_TOOLTIP =
  "Mitä voi merkitä kuluksi:\n" +
  "• Kuljetukset — polttoaine, julkinen liikenne, pysäköinti keikan takia\n" +
  "• Tarvikkeet — pesuaineet, räsyt, muut keikalla kuluvat materiaalit\n" +
  "• Välineet — työkalu tai varuste ostettu/vuokrattu tätä keikkaa varten\n" +
  "• Muu — muu suoraan keikkaan liittyvä kulu\n\n" +
  "Ei merkitä: yleinen toimistokulut, omat palkkakulut, myöhemmin palautettavat esineet.";

/** Downscale a chosen receipt photo to a small JPEG data URL (kirjanpidon tosite). */
async function fileToReceiptDataUrl(file: File): Promise<string> {
  const dataUrl: string = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(new Error("Kuvan luku epäonnistui"));
    r.readAsDataURL(file);
  });
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Kuvaa ei voitu avata"));
      i.src = dataUrl;
    });
    const maxDim = 1280;
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    return dataUrl;
  }
}

function ExpensesView({
  expenses, workers, currentWorker, resolveName, onAdd, onDelete,
}: {
  expenses: ProjExpense[];
  workers: { id: string; name: string }[];
  currentWorker: string;
  resolveName: (id: string) => string;
  onAdd: (data: { kind: string; desc: string; amountCents: number; by: string; forWhom?: string; receiptDataUrl?: string }) => Promise<void>;
  onDelete: (expenseId: string) => Promise<void>;
}) {
  const m = useIsMobile();
  const [kind, setKind] = useState("transport");
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [by, setBy] = useState(currentWorker);
  const [forWhom, setForWhom] = useState(currentWorker);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showTip, setShowTip] = useState(false);

  const fmtEur = (cents: number) => (cents / 100).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  const fmtStamp = (ts: number) => new Date(ts).toLocaleString("fi-FI", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });

  const pickReceipt = async (file: File | undefined) => {
    if (!file) { setReceipt(null); return; }
    try { setReceipt(await fileToReceiptDataUrl(file)); } catch { setReceipt(null); }
  };

  const submit = async () => {
    const amountCents = Math.round(parseFloat(amount.replace(",", ".")) * 100);
    if (!amountCents || amountCents <= 0 || isNaN(amountCents)) return;
    setBusy(true);
    await onAdd({ kind, desc: desc.trim(), amountCents, by, forWhom: forWhom || undefined, receiptDataUrl: receipt || undefined });
    setBusy(false);
    setDesc("");
    setAmount("");
    setReceipt(null);
  };

  const card: React.CSSProperties = {
    background: "rgba(255,255,255,0.035)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "16px",
  };
  const fieldStyle: React.CSSProperties = {
    padding: "11px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.05)", color: "#fff", fontFamily: "inherit", fontSize: 14, width: "100%", boxSizing: "border-box",
  };

  const sorted = [...expenses].sort((a, b) => b.ts - a.ts);

  return (
    <div>
      <div style={{ maxWidth: "780px", margin: "0 auto" }}>
        {/* Kirjanpito-ohje: kuitti + aikaleima. Tucked into a collapsible bar so the
            add-expense form stays front and centre — open it when you need the rules. */}
        <div style={{ marginBottom: "14px" }}>
          <Section id="expense-help" label="🧾 KIRJANPITO-OHJE" summary="kuitti · summa · pvm">
            <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: "rgba(255,255,255,0.7)" }}>
              Lisää jokaisesta kulusta <b style={{ color: "#fff" }}>kuva kuitista</b> — se on kirjanpidon tosite. Aikaleima
              tallentuu automaattisesti. Näin kirjanpito pysyy oikeana ja yksinkertaisena: kuitti, summa ja päivämäärä riittävät.
            </p>
          </Section>
        </div>

        {/* Add expense form — stacks cleanly on phones, no horizontal overflow */}
        <div style={{ ...card, padding: m ? "16px" : "20px", marginBottom: "18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "14px" }}>
            <span style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "10px", letterSpacing: "0.14em", color: "rgba(255,255,255,0.4)" }}>LISÄÄ KULU</span>
            <div style={{ position: "relative" }}>
              <button
                onClick={() => setShowTip((v) => !v)}
                style={{ width: 18, height: 18, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.25)", background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.55)", fontSize: "11px", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                title="Mitä voi merkitä kuluksi?"
              >?</button>
              {showTip && (
                <>
                  <div onClick={() => setShowTip(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                  <div style={{ position: "absolute", left: 0, top: "calc(100% + 6px)", zIndex: 50, width: "320px", padding: "14px 16px", borderRadius: "12px", background: "rgba(18,18,22,0.97)", border: "1px solid rgba(255,255,255,0.14)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", boxShadow: "0 16px 40px rgba(0,0,0,0.65)" }}>
                    <p style={{ margin: "0 0 8px", fontSize: "12px", fontWeight: 700, color: "rgba(255,255,255,0.85)" }}>Mitä voi merkitä kuluksi?</p>
                    {EXPENSE_TOOLTIP.split("\n").map((line, i) => (
                      <p key={i} style={{ margin: line === "" ? "8px 0" : "2px 0", fontSize: "12px", color: line.startsWith("•") ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.45)" }}>{line || " "}</p>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: m ? "1fr" : "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <label style={{ display: "block" }}>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 4 }}>Kululaji</span>
              <select value={kind} onChange={(e) => setKind(e.target.value)} style={fieldStyle}>
                {EXPENSE_KINDS.map((k) => <option key={k.id} value={k.id} style={{ background: "#1a1a1e" }}>{k.label}</option>)}
              </select>
            </label>
            <label style={{ display: "block" }}>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 4 }}>Maksaja</span>
              <select value={by} onChange={(e) => setBy(e.target.value)} style={fieldStyle}>
                {workers.map((w) => <option key={w.id} value={w.id} style={{ background: "#1a1a1e" }}>{w.name}</option>)}
              </select>
            </label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: m ? "1fr" : "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <label style={{ display: "block" }}>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 4 }}>Kenelle (Y-tunnus / kirjanpito)</span>
              <select value={forWhom} onChange={(e) => setForWhom(e.target.value)} style={fieldStyle}>
                <option value="" style={{ background: "#1a1a1e" }}>— valitse —</option>
                {workers.map((w) => <option key={w.id} value={w.id} style={{ background: "#1a1a1e" }}>{w.name}</option>)}
              </select>
            </label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: m ? "1fr" : "1fr 130px", gap: 10, marginBottom: 10 }}>
            <label style={{ display: "block" }}>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 4 }}>Kuvaus (valinnainen)</span>
              <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="esim. pesuaineet" style={fieldStyle} />
            </label>
            <label style={{ display: "block" }}>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 4 }}>Summa</span>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} inputMode="decimal" placeholder="0,00 €" style={{ ...fieldStyle, textAlign: "right" }} />
            </label>
          </div>

          {/* Receipt photo (kuitti) — camera on mobile, file on desktop */}
          <label style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 12px", borderRadius: 10, border: "1px dashed rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.03)", cursor: "pointer", marginBottom: 12 }}>
            <input type="file" accept="image/*" capture="environment" onChange={(e) => pickReceipt(e.target.files?.[0])} style={{ display: "none" }} />
            {receipt ? (
              <img src={receipt} alt="kuitti" style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
            ) : (
              <span style={{ width: 44, height: 44, borderRadius: 8, background: "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>🧾</span>
            )}
            <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: receipt ? "#9ff0bd" : "rgba(255,255,255,0.6)" }}>
              {receipt ? "Kuitti lisätty ✓ — vaihda napauttamalla" : "Lisää kuva kuitista (suositeltu)"}
            </span>
            {receipt && (
              <button type="button" onClick={(e) => { e.preventDefault(); setReceipt(null); }} style={{ flexShrink: 0, padding: "5px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.14)", background: "transparent", color: "rgba(255,255,255,0.6)", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>Poista</button>
            )}
          </label>

          <button onClick={submit} disabled={busy || !amount} style={{ width: "100%", padding: "12px 18px", borderRadius: 10, border: "none", background: busy || !amount ? "rgba(255,255,255,0.1)" : "rgba(95,224,138,0.85)", color: busy || !amount ? "rgba(255,255,255,0.4)" : "#0a1a0e", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: busy || !amount ? "default" : "pointer" }}>
            {busy ? "Tallennetaan…" : "Lisää kulu"}
          </button>
        </div>

        {/* Expense list */}
        {sorted.length === 0 ? (
          <p style={{ textAlign: "center", color: "rgba(255,255,255,0.3)", fontSize: 13, marginTop: 24 }}>
            Ei kuluja. Lisää ensimmäinen kulu yllä.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {sorted.map((exp) => (
              <div key={exp.id} style={{ ...card, padding: m ? "12px 14px" : "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                {exp.receiptDataUrl ? (
                  <a href={exp.receiptDataUrl} target="_blank" rel="noreferrer" style={{ flexShrink: 0 }} title="Avaa kuitti">
                    <img src={exp.receiptDataUrl} alt="kuitti" style={{ width: 40, height: 40, borderRadius: 8, objectFit: "cover", border: "1px solid rgba(255,255,255,0.12)" }} />
                  </a>
                ) : (
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: "rgba(255,155,110,0.7)", flexShrink: 0 }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                    {EXPENSE_KINDS.find((k) => k.id === exp.kind)?.label ?? exp.kind}
                    {exp.desc && <span style={{ fontWeight: 400, color: "rgba(255,255,255,0.55)", marginLeft: 8 }}>{exp.desc}</span>}
                  </div>
                  <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
                    <span title="Maksaja">maksoi: {resolveName(exp.by)}</span>
                    {exp.forWhom && exp.forWhom !== exp.by && (
                      <span style={{ color: "#9cc1ff", marginLeft: 6 }} title="Kenelle kirjanpidossa">· kenelle: {resolveName(exp.forWhom)}</span>
                    )}
                    <span style={{ marginLeft: 6 }}>· {fmtStamp(exp.ts)}</span>
                    {!exp.receiptDataUrl && <span style={{ color: "#e7a17a", marginLeft: 6 }}>· ei kuittia</span>}
                  </div>
                </div>
                <span style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: 14, fontWeight: 700, color: "#ff9b6e", flexShrink: 0 }}>{fmtEur(exp.amountCents)}</span>
                <button
                  onClick={() => onDelete(exp.id)}
                  title="Poista kulu"
                  style={{ width: 28, height: 28, borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.4)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}
                >×</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
