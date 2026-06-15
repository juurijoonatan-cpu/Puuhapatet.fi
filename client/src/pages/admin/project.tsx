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
import { getAdminProfile, USERS } from "@/lib/admin-profile";
import {
  emptyProjectData, computeWorkerStats,
  type ProjectData, type ProjMarksData, type WindowStatus,
} from "@shared/project";
import Navbar, { type Fr8Tab } from "@/components/fr8/Navbar";
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

export default function AdminProjectPage() {
  const [, params] = useRoute("/admin/gig/:id/projekti");
  const [, navigate] = useLocation();
  const jobId = Number(params?.id);
  const profile = getAdminProfile();
  const currentWorker = profile?.id || "joonatan";

  const [tab, setTab] = useState<Fr8Tab>("dashboard");
  const [activeFloor, setActiveFloor] = useState("K");
  const [project, setProject] = useState<ProjectData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<ProjectData | null>(null);

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

      // Backend reachable and a project already exists.
      if (projRes.ok && projRes.data?.project) {
        const p = projRes.data.project;
        // Make sure every assigned worker shows up in the hours view.
        const mergedWorkers = Array.from(new Set([...(p.workers || []), ...workers]));
        // Heal a project that was saved without its window marks (failed first
        // seed, etc.) so the floor maps are never empty.
        if (!hasAnyMarks(p.marks) && hasAnyMarks(baseMarks)) {
          const healed: ProjectData = { ...p, marks: baseMarks, workers: mergedWorkers };
          setProject(healed);
          void api.updateProject(jobId, healed);
        } else {
          setProject({ ...p, workers: mergedWorkers });
        }
        setLoading(false);
        return;
      }

      // Backend reachable, no project yet → seed from base marks and persist.
      if (projRes.ok) {
        const seeded: ProjectData = { ...emptyProjectData(), marks: baseMarks, workers };
        const saveRes = await api.updateProject(jobId, seeded);
        if (cancelled) return;
        if (saveRes.ok && saveRes.data) {
          const saved = saveRes.data.project;
          // If the server round-trip dropped the marks, keep the seeded copy so
          // the maps still render with their windows.
          setProject(hasAnyMarks(saved.marks) ? { ...saved, workers } : { ...seeded });
        } else {
          // Even if the save fails (e.g. column not migrated yet), show the tool
          // so the maps are usable; just warn that changes won't persist yet.
          setProject(seeded);
          setError(saveRes.error
            ? `Tallennus ei vielä käytössä (${saveRes.error}) — kartat näkyvät, mutta muutoksia ei tallenneta.`
            : null);
        }
        setLoading(false);
        return;
      }

      // Backend unreachable (route missing, server asleep, network) → still show
      // the tool from the bundled floor data so the maps are usable. Edits won't
      // persist until the connection is back.
      setProject({ ...emptyProjectData(), marks: baseMarks, workers });
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

  const onStatusChange = useCallback((key: string, status: WindowStatus) => {
    mutate((d) => {
      if (status === "ei") { delete d.statuses[key]; delete d.washedBy[key]; }
      else {
        d.statuses[key] = status;
        if (status === "pesty") d.washedBy[key] = currentWorker;
        else delete d.washedBy[key];
      }
      const p = getPriority(d, key);
      const floor = key.split("#")[0];
      d.log = [{ floor, key, p, status, ts: Date.now(), by: currentWorker }, ...d.log].slice(0, 60);
    });
  }, [mutate, getPriority, currentWorker]);

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

  const backToGig = useCallback(() => navigate(`/admin/gig/${jobId}`), [navigate, jobId]);

  // ── Render ──────────────────────────────────────────────────────────────────
  const shell = (children: React.ReactNode) => (
    <div className="fr8-root" style={{ position: "fixed", inset: 0, background: "#060607", color: "#fff", overflow: "hidden", fontFamily: "var(--font-onest, system-ui, sans-serif)" }}>
      {/* Single, very subtle top glow — kept faint so the dashboard reads clean */}
      <div style={{ position: "absolute", top: "-35%", left: "50%", transform: "translateX(-50%)", width: "1000px", height: "620px", background: "radial-gradient(ellipse at center, rgba(120,124,150,0.05), transparent 68%)", pointerEvents: "none" }} />
      {children}
    </div>
  );

  if (loading) {
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

  const workerStats = computeWorkerStats(project);
  const hoursWorkers = (project.workers.length ? project.workers : ["matias", "joonatan"]).map((id) => ({
    id, name: workerName(id), initial: workerInitial(id),
  }));

  return shell(
    <>
      <Navbar
        activeTab={tab}
        onTabChange={setTab}
        buildingName={project.building.name}
        buildingAddress={project.building.address}
        currentWorkerName={workerName(currentWorker)}
        saving={saving}
        onBack={backToGig}
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
          <Dashboard project={project} workerStats={workerStats} workerName={workerName} onGoToFloor={onGoToFloor} />
        )}
        {tab === "floor" && (
          <FloorView
            floors={project.building.floors}
            planBase={project.building.planBase || "/fr8/plans/bp-"}
            pricePerWindow={project.pricePerWindow}
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
          />
        )}
        {tab === "hours" && (
          <HoursView workers={hoursWorkers} hours={project.hours} hourLog={project.hourLog} stats={workerStats} onAddHours={onAddHours} />
        )}
      </main>
    </>,
  );
}
