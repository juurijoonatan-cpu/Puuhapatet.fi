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
  emptyProjectData, computeWorkerStats, isFr8Plans, fixedDealFor, allPoints,
  type ProjectData, type ProjMarksData, type WindowStatus, type ProjNoteKind, type ProjExpense,
} from "@shared/project";
import Navbar, { type Fr8Tab } from "@/components/fr8/Navbar";
import { FOUNDER_IDS } from "@shared/team";
import { traineeForUserId, traineeForName } from "@shared/trainees";
import { DEFAULT_WORKER_PER_WINDOW_CENTS } from "@shared/crew";
import Dashboard from "@/components/fr8/Dashboard";
import FloorView from "@/components/fr8/FloorView";
import HoursView from "@/components/fr8/HoursView";
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

  const [tab, setTab] = useState<Fr8Tab>("dashboard");
  const [activeFloor, setActiveFloor] = useState("K");
  // Who new "pesty" markings are attributed to by default. Defaults to the
  // logged-in admin, but each admin can pick a preferred default washer per gig
  // (persisted locally) — the per-window picker still overrides a single window.
  const [defaultWasher, setDefaultWasher] = useState<string>(currentWorker);
  const washerInit = useRef(false);
  const [project, setProject] = useState<ProjectData | null>(null);
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

  const onAddHours = useCallback((worker: string, delta: number) => {
    mutate((d) => {
      d.hours[worker] = Math.max(0, +(((d.hours[worker] || 0) + delta).toFixed(2)));
      d.hourLog = [{ worker, delta, ts: Date.now(), by: currentWorker }, ...d.hourLog].slice(0, 60);
    });
  }, [mutate, currentWorker]);

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

  // ── Render ──────────────────────────────────────────────────────────────────
  const shell = (children: React.ReactNode) => (
    <div className="fr8-root" style={{ position: "fixed", inset: 0, background: "#060607", color: "#fff", overflow: "hidden", fontFamily: "var(--font-onest, system-ui, sans-serif)" }}>
      {/* Single, very subtle top glow — kept faint so the dashboard reads clean */}
      <div style={{ position: "absolute", top: "-35%", left: "50%", transform: "translateX(-50%)", width: "1000px", height: "620px", background: "radial-gradient(ellipse at center, rgba(120,124,150,0.05), transparent 68%)", pointerEvents: "none" }} />
      {children}
    </div>
  );

  if (loading || crewChecking) {
    return shell(
      <div style={{ position: "relative", zIndex: 10, height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.45)", fontSize: "14px" }}>
        Ladataan projektinäkymää…
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
  // Sisäinen kate: sopimushinta jaettuna todellisella punaisella ikkunamäärällä.
  // Tämä on perustajien oman työn oikea ansio per ikkuna (ei sama kuin nimellinen
  // 37,50 €, joka on laskettu sopimuksen 168 ikkunan mukaan eikä välttämättä vastaa
  // todellista ikkunamäärää). Käytetään myös tuottolaskelmassa workers vs. founders.
  const totalBillable = deal ? allPoints(project).filter((p) => p.p === deal.billablePriority).length : 0;
  const internalKateCents = deal && totalBillable > 0
    ? Math.round(deal.capCents / totalBillable)
    : dealTotalCents;
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
  // A trainee's washed windows, credited to their responsible leader FOR PAY ONLY.
  const traineeWashedByLeader: Record<string, number> = {};
  for (const st of baseStatsRaw) {
    const lead = leaderOf(st.worker);
    if (lead) traineeWashedByLeader[lead] = (traineeWashedByLeader[lead] || 0) + st.washed;
  }
  // Hours are shown per person (no folding) so a trainee's specific hours stay
  // separate from their leader's.
  const managerHours: Record<string, number> = {};
  for (const [id, h] of Object.entries(project.hours || {})) {
    managerHours[id] = (managerHours[id] || 0) + (h || 0);
  }
  // Profit pool = Σ over real workers (NOT founders, NOT trainees) of
  // (sisäinen kate − that worker's rate) per worker-washed window.
  let profitPoolCents = 0;
  for (const st of baseStatsRaw) {
    const mm = crew.find((c) => c.id === st.worker);
    if (!isFounder(st.worker, mm?.role) && !isTrainee(st.worker)) {
      profitPoolCents += st.washed * Math.max(0, internalKateCents - (mm?.perWindowCents ?? DEFAULT_WORKER_PER_WINDOW_CENTS));
    }
  }
  const founderProfitEachCents = Math.round(profitPoolCents / founderCount);
  const earningsFor = (st: { worker: string; washed: number }): number => {
    const mm = crew.find((c) => c.id === st.worker);
    if (mm?.manualEarningsCents != null) return mm.manualEarningsCents;
    // washed can be fractional (50/50 split windows count as 0.5) — round cents.
    // Trainee windows earn the worker rate (not the full deal rate) — the rest stays
    // as margin, not extra pay. Founder's own windows still earn the full deal rate.
    if (isFounder(st.worker, mm?.role)) {
      const traineeWashed = traineeWashedByLeader[st.worker] || 0;
      return Math.round((st.washed + traineeWashed) * internalKateCents) + founderProfitEachCents;
    }
    return Math.round(st.washed * (mm?.perWindowCents ?? dealTotalCents));
  };
  const resolveName = (id: string): string => {
    const m = crew.find((c) => c.id === id);
    if (m?.name?.trim()) return m.name.trim().split(/\s+/)[0];
    return workerName(id);
  };
  const resolveInitial = (id: string): string => (resolveName(id)[0] || "?").toUpperCase();

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
      if (st.washed > 0) (traineeShareByLeader[lead] ||= []).push({ name: resolveName(st.worker), washed: st.washed, cents: Math.round(st.washed * internalKateCents) });
    }
  }

  // Founders appear even with 0 own windows — they still earn the profit share.
  const statIds = new Set(baseStats.map((s) => s.worker));
  for (const f of crew.filter((c) => isFounder(c.id, c.role))) {
    if (!statIds.has(f.id)) baseStats.push({ worker: f.id, washed: 0, revenueCents: 0, hours: Math.max(0, managerHours[f.id] || 0), windowsPerHour: 0, eurPerHour: 0 });
  }
  const workerStats = baseStats.map((s) => {
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
  // Jokaisen perustajan ansio = oma työ (omat ikkunat × 37,50) + harjoittelijan osuus
  // (harjoittelijan ikkunat × 20 €/ikkuna — tilitä harjoittelijalle) + tuotto-osuus.
  const founderEarnings = workerStats
    .filter((s) => isFounder(s.worker, crew.find((c) => c.id === s.worker)?.role))
    .map((s) => {
      const mm = crew.find((c) => c.id === s.worker);
      const ownWashed = s.washed; // only the founder's own windows — trainee shown separately
      const manual = mm?.manualEarningsCents != null;
      return {
        id: s.worker,
        name: resolveName(s.worker),
        ownWashed,
        ownCents: Math.round(ownWashed * internalKateCents),
        shareCents: founderProfitEachCents,
        totalCents: s.revenueCents, // respects manual override
        manual,
        hours: s.hours,
      };
    })
    .sort((a, b) => b.totalCents - a.totalCents);
  // What all real workers (not founders, not trainees) earn in total — the labour
  // cost side of the gig, so the margin to the founders is obvious.
  const workerLaborCents = workerStats
    .filter((s) => { const mm = crew.find((c) => c.id === s.worker); return !isFounder(s.worker, mm?.role) && !isTrainee(s.worker); })
    .reduce((sum, s) => sum + s.revenueCents, 0);

  // Founders can manually set their own day/session earnings (e.g. split 50/50).
  const setWorkerEarnings = (id: string, cents: number | null) => {
    setProject((cur) => {
      if (!cur) return cur;
      const next = { ...cur, crew: (cur.crew || []).map((mm) => mm.id === id ? { ...mm, manualEarningsCents: cents == null ? undefined : cents } : mm) };
      void api.updateProject(jobId, next);
      return next;
    });
  };
  // Tunnit-näkymä: perustajat + keikan aktiiviset työntekijät (esim. Jani) JA
  // harjoittelijat (esim. Milja) — jokaisen tekijän omat tunnit näkyvät johtajille
  // erikseen (harjoittelijan palkka pysyy ohjaajalla, mutta tunnit ovat omat).
  const hoursIds = Array.from(new Set([
    ...(project.workers.length ? project.workers : ["matias", "joonatan"]),
    ...crew.filter((c) => c.active && c.role === "worker" && !c.adminLinked).map((c) => c.id),
  ]));
  const hoursWorkers = hoursIds.map((id) => ({ id, name: resolveName(id), initial: resolveInitial(id) }));
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
      />
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
      <main style={{ position: "relative", zIndex: 10, height: "calc(100% - 62px)" }}>
        {tab === "dashboard" && (
          <Dashboard project={project} workerStats={workerStats} workerName={resolveName} onGoToFloor={onGoToFloor} deal={deal} onSetEarnings={setWorkerEarnings} traineeInfo={traineeInfo} traineeShareByLeader={traineeShareByLeader} founderEarnings={founderEarnings} workerLaborCents={workerLaborCents} founderRateEur={internalKateCents / 100} />
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
          />
        )}
        {tab === "hours" && (
          <HoursView workers={hoursWorkers} hours={managerHours} hourLog={project.hourLog} stats={workerStats} onAddHours={onAddHours} traineeInfo={traineeInfo} />
        )}
        {tab === "expenses" && (
          <ExpensesView
            expenses={project.expenses || []}
            workers={[...gigWorkers, ...crew.filter(c => !gigWorkers.some(w => w.id === c.id)).map(c => ({ id: c.id, name: resolveName(c.id) }))]}
            currentWorker={currentWorker}
            resolveName={resolveName}
            onAdd={addExpense}
            onDelete={deleteExpense}
          />
        )}
      </main>
    </>,
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
  const totalCents = expenses.reduce((s, e) => s + e.amountCents, 0);

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
    <div style={{ height: "100%", overflowY: "auto", padding: m ? "16px 12px calc(96px + env(safe-area-inset-bottom))" : "24px 20px 44px" }}>
      <div style={{ maxWidth: "780px", margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: "16px", display: "flex", alignItems: "baseline", gap: 12 }}>
          <div>
            <div style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "10px", letterSpacing: "0.16em", color: "rgba(255,255,255,0.4)", marginBottom: 6 }}>PROJEKTIKULUT</div>
            <h1 style={{ margin: 0, fontSize: m ? "22px" : "26px", fontWeight: 700, letterSpacing: "-0.01em" }}>Kulut</h1>
          </div>
          {totalCents > 0 && (
            <span style={{ marginLeft: "auto", fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: m ? "17px" : "20px", fontWeight: 700, color: "#ff9b6e" }}>
              {fmtEur(totalCents)}
            </span>
          )}
        </div>

        {/* Kirjanpito-ohje: kuitti + aikaleima. Pidetään yksinkertaisena. */}
        <div style={{ ...card, padding: "12px 14px", marginBottom: "14px", background: "rgba(255,155,110,0.06)", border: "1px solid rgba(255,155,110,0.2)", display: "flex", gap: 10, alignItems: "flex-start" }}>
          <span style={{ fontSize: 15, lineHeight: 1 }}>🧾</span>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.55, color: "rgba(255,255,255,0.7)" }}>
            Lisää jokaisesta kulusta <b style={{ color: "#fff" }}>kuva kuitista</b> — se on kirjanpidon tosite. Aikaleima
            tallentuu automaattisesti. Näin kirjanpito pysyy oikeana ja yksinkertaisena: kuitti, summa ja päivämäärä riittävät.
          </p>
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
