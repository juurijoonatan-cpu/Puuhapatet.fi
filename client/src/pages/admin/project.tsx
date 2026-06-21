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
  emptyProjectData, computeWorkerStats, isFr8Plans, fixedDealFor,
  type ProjectData, type ProjMarksData, type WindowStatus, type ProjNoteKind,
} from "@shared/project";
import Navbar, { type Fr8Tab } from "@/components/fr8/Navbar";
import { FOUNDER_IDS } from "@shared/team";
import Dashboard from "@/components/fr8/Dashboard";
import FloorView from "@/components/fr8/FloorView";
import HoursView from "@/components/fr8/HoursView";

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

/** Founders split the per-window margin (17,50 € / 2) → 8,75 € each per window. */
const FOUNDER_PER_WINDOW_CENTS = 875;

/**
 * Build the display-name map + this gig's pickable crew (for the "who washed"
 * and "default washer" pickers). Admin-linked crew (e.g. Petrus) are masked —
 * they're hidden from this gig, so they must not appear as a pickable worker.
 */
function computeWorkerMaps(project: ProjectData): {
  workerNames: Record<string, string>;
  gigWorkers: { id: string; name: string }[];
} {
  const workerNames: Record<string, string> = {};
  for (const u of USERS) workerNames[u.id] = u.name;
  for (const m of project.crew ?? []) workerNames[m.id] = m.name;
  const maskedWorkerIds = new Set<string>(["petrus"]);
  for (const m of project.crew ?? []) {
    if (m.adminLinked && m.role !== "host") maskedWorkerIds.add(m.id);
  }
  const gigWorkers: { id: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const id of [...(project.workers ?? []), ...((project.crew ?? []).map((m) => m.id))]) {
    if (seen.has(id) || maskedWorkerIds.has(id)) continue;
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
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const payload = latest.current;
      if (!payload) return;
      setSaving(true);
      const res = await api.updateProject(jobId, payload);
      setSaving(false);
      if (!res.ok) setError(res.error || "Tallennus epäonnistui");
    }, 700);
  }, [jobId]);

  // Flush a pending save when leaving the page.
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (latest.current) { void api.updateProject(jobId, latest.current); }
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
      const p = getPriority(d, key);
      const floor = key.split("#")[0];
      d.log = [{ floor, key, p, status, ts: Date.now(), by: washer }, ...d.log].slice(0, 60);
    });
  }, [mutate, getPriority, currentWorker, defaultWasher]);

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

  // Per-person PAY (not the gig price): each worker earns their own €/window from
  // the crew (e.g. Jani 20 €); founders split the per-window margin → 8,75 € each.
  // The big revenue/priority cards stay on the gig deal — only the per-worker
  // TEKIJÄT figures use personal pay, and names come from the crew (so a renamed
  // worker shows as "Jani", not "Tyontekija1").
  const crew = project.crew ?? [];
  const rateForWorker = (id: string): number => {
    const m = crew.find((c) => c.id === id);
    if (m && (m.role === "host" || FOUNDER_IDS.includes(id))) return FOUNDER_PER_WINDOW_CENTS;
    return m?.perWindowCents ?? Math.round(effectivePrice * 100);
  };
  const resolveName = (id: string): string => {
    const m = crew.find((c) => c.id === id);
    if (m?.name?.trim()) return m.name.trim().split(/\s+/)[0];
    return workerName(id);
  };
  const resolveInitial = (id: string): string => (resolveName(id)[0] || "?").toUpperCase();

  const workerStats = computeWorkerStats(project).map((s) => {
    const cents = Math.round(s.washed * rateForWorker(s.worker));
    return { ...s, revenueCents: cents, eurPerHour: s.hours > 0 ? cents / 100 / s.hours : 0 };
  });
  const hoursWorkers = (project.workers.length ? project.workers : ["matias", "joonatan"]).map((id) => ({
    id, name: resolveName(id), initial: resolveInitial(id),
  }));
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
          <Dashboard project={project} workerStats={workerStats} workerName={resolveName} onGoToFloor={onGoToFloor} deal={deal} />
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
            workerNames={workerNames}
            workers={gigWorkers}
            currentWorkerId={effectiveWasher}
            notes={project.notes}
            onAddNote={onAddNote}
            onUpdateNote={onUpdateNote}
            onDeleteNote={onDeleteNote}
            activeZone={project.activeZone}
            onSetActiveZone={onSetActiveZone}
            onClearActiveZone={onClearActiveZone}
            deal={deal}
          />
        )}
        {tab === "hours" && (
          <HoursView workers={hoursWorkers} hours={project.hours} hourLog={project.hourLog} stats={workerStats} onAddHours={onAddHours} />
        )}
      </main>
    </>,
  );
}
