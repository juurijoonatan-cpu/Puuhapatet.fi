/**
 * Gig tools overlay — a full-screen launcher + host for the per-gig dashboard
 * tools. Opens over the admin gig page (body scroll locked) so it never
 * disturbs the underlying UI, matching the projektinäkymä's dark aesthetic.
 *
 * Route-kind tools (the projektinäkymä) navigate away; panel-kind tools render
 * in place and share a single lazily-loaded copy of the project data.
 */
import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, X, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import { getAdminProfile, USERS } from "@/lib/admin-profile";
import { emptyProjectData, type ProjectData } from "@shared/project";
import { GIG_TOOLS, type GigToolId, getGigTool } from "@/lib/gig-tools";
import EfficiencyTool from "./EfficiencyTool";
import FloorSetupTool from "./FloorSetupTool";

interface Props {
  jobId: number;
  title: string;                 // gig / company name shown in the bar
  initialToolId?: GigToolId | null;
  onClose: () => void;
}

function workerName(id: string): string {
  const u = USERS.find((x) => x.id === id);
  if (u) return u.name.split(" ")[0];
  return id ? id.charAt(0).toUpperCase() + id.slice(1) : id;
}

export default function GigToolsOverlay({ jobId, title, initialToolId = null, onClose }: Props) {
  const [, navigate] = useLocation();
  const profile = getAdminProfile();
  const [active, setActive] = useState<GigToolId | null>(initialToolId);

  const [project, setProject] = useState<ProjectData | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lock page scroll while the overlay is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const openTool = useCallback((id: GigToolId) => {
    const tool = getGigTool(id);
    if (!tool) return;
    if (tool.kind === "route" && tool.route) { navigate(tool.route(jobId)); return; }
    setActive(id);
  }, [jobId, navigate]);

  // Lazily load the project once a panel tool needs it (shared between tools).
  useEffect(() => {
    const tool = active ? getGigTool(active) : null;
    if (!tool || tool.kind !== "panel" || project || loading) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.getProject(jobId).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setProject(res.data?.project ?? emptyProjectData());
      } else {
        setError(res.error || "Projektin lataus epäonnistui");
        setProject(emptyProjectData());
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [active, jobId, project, loading]);

  const saveProject = useCallback(async (next: ProjectData) => {
    setProject(next);            // optimistic
    setSaving(true);
    const res = await api.updateProject(jobId, next);
    setSaving(false);
    if (res.ok && res.data?.project) setProject(res.data.project);
    else setError(res.error || "Tallennus epäonnistui");
  }, [jobId]);

  // Esc closes the active tool (back to grid) or the overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (active) setActive(null); else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onClose]);

  const back = () => { if (active) setActive(null); else onClose(); };
  const activeTool = active ? getGigTool(active) : null;

  return (
    <div className="fr8-root" style={{ position: "fixed", inset: 0, zIndex: 90, background: "#060607", color: "#fff", overflow: "hidden", fontFamily: "var(--font-onest, system-ui, sans-serif)" }}>
      <div style={{ position: "absolute", top: "-35%", left: "50%", transform: "translateX(-50%)", width: "1000px", height: "620px", background: "radial-gradient(ellipse at center, rgba(120,124,150,0.05), transparent 68%)", pointerEvents: "none" }} />

      {/* Top bar */}
      <nav style={{ position: "relative", zIndex: 20, height: "62px", display: "flex", alignItems: "center", gap: "14px", padding: "0 16px", borderBottom: "1px solid rgba(255,255,255,0.07)", background: "rgba(8,8,10,0.55)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }}>
        <button onClick={back} title={active ? "Takaisin työkaluihin" : "Sulje"}
          style={{ display: "flex", alignItems: "center", gap: "7px", flexShrink: 0, padding: "8px 12px", borderRadius: "10px", cursor: "pointer", border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.78)", fontSize: "12.5px", fontWeight: 600 }}>
          <ArrowLeft style={{ width: 14, height: 14 }} /> {active ? "Työkalut" : "Keikka"}
        </button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: "14px", letterSpacing: "0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {activeTool ? activeTool.title : "Työkalut"}
          </div>
          <div style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "10px", letterSpacing: "0.07em", color: "rgba(255,255,255,0.4)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {(title || "SOPIMUSKEIKKA").toUpperCase()}{saving ? " · TALLENNETAAN…" : ""}
          </div>
        </div>
        <button onClick={onClose} title="Sulje työkalut"
          style={{ flexShrink: 0, width: "38px", height: "38px", borderRadius: "11px", border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.7)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <X style={{ width: 17, height: 17 }} />
        </button>
      </nav>

      <main style={{ position: "relative", zIndex: 10, height: "calc(100% - 62px)" }}>
        {/* Launcher grid */}
        {!active && (
          <div style={{ height: "100%", overflowY: "auto", padding: "26px 20px 44px" }}>
            <div style={{ maxWidth: "760px", margin: "0 auto" }}>
              <div style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "11px", letterSpacing: "0.18em", color: "rgba(255,255,255,0.4)", marginBottom: "7px" }}>KEIKAN TYÖKALUT</div>
              <h1 style={{ margin: "0 0 22px", fontSize: "26px", fontWeight: 700, letterSpacing: "-0.01em" }}>Valitse työkalu</h1>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "14px" }}>
                {GIG_TOOLS.map((t, i) => {
                  const Icon = t.icon;
                  return (
                    <button key={t.id} onClick={() => openTool(t.id)} className={`anim-fadeUp-${Math.min(i, 8)}`}
                      style={{ textAlign: "left", cursor: "pointer", padding: "20px", borderRadius: "20px", background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.08)", backdropFilter: "blur(22px)", WebkitBackdropFilter: "blur(22px)", color: "#fff", display: "flex", flexDirection: "column", gap: "14px", transition: "background .15s, transform .15s" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.035)"; }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ width: "46px", height: "46px", borderRadius: "14px", background: `rgba(${t.accent},0.12)`, border: `1px solid rgba(${t.accent},0.3)`, display: "flex", alignItems: "center", justifyContent: "center", color: `rgb(${t.accent})`, boxShadow: `0 0 18px rgba(${t.accent},0.18)` }}>
                          <Icon style={{ width: 22, height: 22 }} />
                        </span>
                        <ChevronRight style={{ width: 18, height: 18, color: "rgba(255,255,255,0.35)" }} />
                      </div>
                      <div>
                        <div style={{ fontSize: "16px", fontWeight: 600, marginBottom: "5px" }}>{t.title}</div>
                        <div style={{ fontSize: "12.5px", color: "rgba(255,255,255,0.45)", lineHeight: 1.5 }}>{t.subtitle}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Panel tools */}
        {active && (loading || !project) && (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.45)", fontSize: "14px" }}>
            {error || "Ladataan…"}
          </div>
        )}
        {active === "tehokkuus" && project && !loading && (
          <EfficiencyTool project={project} workerName={workerName} />
        )}
        {active === "pohjakartat" && project && !loading && (
          <FloorSetupTool project={project} saving={saving} onSave={saveProject} />
        )}
      </main>
    </div>
  );
}
