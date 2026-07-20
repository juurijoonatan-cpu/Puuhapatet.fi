/**
 * Gig tool — "Pohjakartat & asetukset" (floor maps & setup).
 *
 * Makes the FR8 floor-plan toolkit reusable for any gig: edit the building name
 * & address, manage the floor list, set the price per window and the plan-image
 * base path, and import your own floor mappings by pasting a marks JSON. Changes
 * persist through the same project API the projektinäkymä uses, so the maps,
 * dashboard and billing all pick them up.
 */
import { useMemo, useState } from "react";
import { Plus, Trash2, Save, Upload, RotateCcw, Check, AlertCircle } from "lucide-react";
import {
  fixedDealFor,
  type ProjectData, type ProjMarksData, type ProjMark,
} from "@shared/project";
import { useIsMobile } from "@/hooks/use-mobile";

interface Props {
  project: ProjectData;
  saving: boolean;
  onSave: (next: ProjectData) => void;
}

const card: React.CSSProperties = {
  background: "rgba(255,255,255,0.035)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "20px",
  backdropFilter: "blur(22px)",
  WebkitBackdropFilter: "blur(22px)",
};
const mono: React.CSSProperties = {
  fontFamily: "var(--font-jetbrains-mono, monospace)",
  fontSize: "11px",
  letterSpacing: "0.14em",
  color: "rgba(255,255,255,0.4)",
};
const labelStyle: React.CSSProperties = {
  fontFamily: "var(--font-jetbrains-mono, monospace)",
  fontSize: "9.5px",
  letterSpacing: "0.12em",
  color: "rgba(255,255,255,0.4)",
  marginBottom: "7px",
  display: "block",
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  background: "rgba(0,0,0,0.35)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "12px",
  color: "#fff",
  fontSize: "14px",
  outline: "none",
  fontFamily: "var(--font-onest, system-ui, sans-serif)",
};

/** Count total marks in a marks map. */
function countMarks(marks: ProjMarksData): number {
  return Object.values(marks).reduce((a, f) => a + (Array.isArray(f?.marks) ? f.marks.length : 0), 0);
}

/** Parse a pasted marks JSON into a normalised ProjMarksData (loose, tolerant). */
function parseMarksJson(text: string): { marks: ProjMarksData; floors: string[]; count: number } {
  const raw = JSON.parse(text);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("JSON ei ole kerros-objekti");
  const out: ProjMarksData = {};
  for (const floor of Object.keys(raw)) {
    const v = raw[floor];
    // Accept either { marks: [...] } or a bare array of marks.
    const arr = Array.isArray(v) ? v : Array.isArray(v?.marks) ? v.marks : null;
    if (!arr) continue;
    const marks: ProjMark[] = arr
      .map((mk: any): ProjMark => ({
        p: Number(mk?.p) === 2 ? 2 : 1,
        x: Math.max(0, Math.min(100, Number(mk?.x))),
        y: Math.max(0, Math.min(100, Number(mk?.y))),
      }))
      .filter((mk: ProjMark) => Number.isFinite(mk.x) && Number.isFinite(mk.y));
    out[String(floor).slice(0, 8)] = { marks };
  }
  const floors = Object.keys(out);
  if (floors.length === 0) throw new Error("Ei löytynyt yhtään merkintää");
  return { marks: out, floors, count: countMarks(out) };
}

export default function FloorSetupTool({ project, saving, onSave }: Props) {
  const m = useIsMobile();
  const [draft, setDraft] = useState<ProjectData>(() => JSON.parse(JSON.stringify(project)));
  const [newFloor, setNewFloor] = useState("");
  const [marksText, setMarksText] = useState("");
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  // A signed, fixed-price deal (FR8) locks the price field.
  const priceLocked = !!fixedDealFor(draft);

  // Compare against the persisted project (ignoring the timestamp) to know if
  // there is anything to save.
  const dirty = useMemo(() => {
    const strip = (p: ProjectData) => JSON.stringify({ ...p, updatedAt: 0 });
    return strip(draft) !== strip(project);
  }, [draft, project]);

  const patch = (fn: (d: ProjectData) => void) => {
    setDraft((cur) => {
      const next = JSON.parse(JSON.stringify(cur)) as ProjectData;
      fn(next);
      return next;
    });
    setJustSaved(false);
  };

  const renameFloor = (idx: number, value: string) => {
    const clean = value.replace(/[^a-zA-Z0-9åäöÅÄÖ _-]/g, "").slice(0, 8);
    patch((d) => { d.building.floors[idx] = clean; });
  };
  const removeFloor = (idx: number) => patch((d) => { d.building.floors.splice(idx, 1); });
  const addFloor = () => {
    const clean = newFloor.replace(/[^a-zA-Z0-9åäöÅÄÖ _-]/g, "").slice(0, 8).trim();
    if (!clean) return;
    if (draft.building.floors.includes(clean)) { setNotice({ kind: "err", text: `Kerros "${clean}" on jo listalla` }); return; }
    patch((d) => { d.building.floors.push(clean); });
    setNewFloor("");
    setNotice(null);
  };

  const importMarks = () => {
    const text = marksText.trim();
    if (!text) return;
    try {
      const { marks, floors, count } = parseMarksJson(text);
      patch((d) => {
        d.marks = marks;
        // Add any imported floors that aren't already in the list (keep order).
        for (const f of floors) if (!d.building.floors.includes(f)) d.building.floors.push(f);
        // Imported maps replace stale per-window state so counts start clean.
        d.statuses = {};
        d.washedBy = {};
        d.posOverrides = {};
        d.deleted = {};
        d.customMarks = {};
      });
      setNotice({ kind: "ok", text: `Tuotiin ${count} merkintää · ${floors.length} kerrosta` });
      setMarksText("");
    } catch (err) {
      setNotice({ kind: "err", text: `Tuonti epäonnistui: ${err instanceof Error ? err.message : "virheellinen JSON"}` });
    }
  };

  const clearMarks = () => {
    if (!confirm("Tyhjennä kaikki ikkunamerkinnät tästä keikasta? Toimintoa ei voi perua.")) return;
    patch((d) => {
      d.marks = {}; d.statuses = {}; d.washedBy = {};
      d.posOverrides = {}; d.deleted = {}; d.customMarks = {};
    });
    setNotice({ kind: "ok", text: "Merkinnät tyhjennetty — muista tallentaa" });
  };

  const save = () => {
    onSave({ ...draft, updatedAt: Date.now() });
    setJustSaved(true);
    setNotice(null);
  };

  const liveMarks = countMarks(draft.marks);

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: m ? "18px 12px 120px" : "26px 30px 120px" }}>
      <div style={{ maxWidth: "820px", margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: m ? "16px" : "22px" }}>
          <div style={{ ...mono, letterSpacing: "0.18em", marginBottom: "7px" }}>POHJAKARTAT &amp; ASETUKSET</div>
          <h1 style={{ margin: 0, fontSize: m ? "22px" : "30px", fontWeight: 700, letterSpacing: "-0.01em" }}>Mukauta keikan työkalu</h1>
        </div>

        {/* Building + pricing */}
        <div className="anim-fadeUp-0" style={{ ...card, padding: m ? "18px" : "22px 24px", marginBottom: "14px" }}>
          <div style={{ ...mono, marginBottom: "16px" }}>RAKENNUS</div>
          <div style={{ display: "grid", gridTemplateColumns: m ? "1fr" : "1fr 1fr", gap: "14px" }}>
            <div>
              <label style={labelStyle}>NIMI</label>
              <input style={inputStyle} value={draft.building.name || ""} placeholder="esim. Toimisto — Bulevardi 1"
                onChange={(ev) => patch((d) => { d.building.name = ev.target.value.slice(0, 120); })} />
            </div>
            <div>
              <label style={labelStyle}>OSOITE</label>
              <input style={inputStyle} value={draft.building.address || ""} placeholder="Katuosoite"
                onChange={(ev) => patch((d) => { d.building.address = ev.target.value.slice(0, 200); })} />
            </div>
            <div>
              <label style={labelStyle}>HINTA / IKKUNA (€)</label>
              <input style={{ ...inputStyle, opacity: priceLocked ? 0.6 : 1, cursor: priceLocked ? "not-allowed" : "auto" }} type="number" min={0} step={1}
                value={priceLocked ? 37.5 : draft.pricePerWindow} disabled={priceLocked} readOnly={priceLocked}
                onChange={(ev) => patch((d) => { d.pricePerWindow = Math.max(0, Number(ev.target.value) || 0); })} />
              {priceLocked && (
                <p style={{ fontSize: "10.5px", color: "rgba(95,224,138,0.8)", marginTop: "6px", lineHeight: 1.5 }}>
                  🔒 Sovittu sopimuksessa: 37,50 € / punainen ikkuna, katto 6300 €. Ei muokattavissa.
                </p>
              )}
              {draft.p2?.enabled && (
                <p style={{ fontSize: "10.5px", color: "rgba(255,220,110,0.75)", marginTop: "6px", lineHeight: 1.5 }}>
                  P2: keltaiset ikkunat hinnoitellaan ikkunakohtaisesti projektinäkymässä (€ Hinnoittele).
                </p>
              )}
            </div>
            <div>
              <label style={labelStyle}>POHJAKUVAN POLKU (planBase)</label>
              <input style={inputStyle} value={draft.building.planBase || ""} placeholder="/fr8/plans/bp-"
                onChange={(ev) => patch((d) => { d.building.planBase = ev.target.value.slice(0, 200); })} />
              <p style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.35)", marginTop: "6px", lineHeight: 1.5 }}>
                Kerroksen kuva haetaan muodossa <code style={{ color: "rgba(255,255,255,0.55)" }}>{(draft.building.planBase || "/fr8/plans/bp-") + "<kerros>.png"}</code>
              </p>
            </div>
          </div>
        </div>

        {/* Floors */}
        <div className="anim-fadeUp-1" style={{ ...card, padding: m ? "18px" : "22px 24px", marginBottom: "14px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
            <span style={mono}>KERROKSET</span>
            <span style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "11px", color: "rgba(255,255,255,0.4)" }}>{draft.building.floors.length} kpl</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "14px" }}>
            {draft.building.floors.map((f, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: "9px" }}>
                <span style={{ width: "30px", height: "30px", flexShrink: 0, borderRadius: "8px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.09)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "12px", color: "rgba(255,255,255,0.55)" }}>{i + 1}</span>
                <input style={{ ...inputStyle, flex: 1 }} value={f} onChange={(ev) => renameFloor(i, ev.target.value)} />
                <button onClick={() => removeFloor(i)} title="Poista kerros"
                  style={{ flexShrink: 0, width: "42px", height: "42px", borderRadius: "12px", border: "1px solid rgba(255,120,120,0.2)", background: "rgba(255,80,80,0.08)", color: "rgb(255,150,150)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Trash2 style={{ width: 16, height: 16 }} />
                </button>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: "9px" }}>
            <input style={{ ...inputStyle, flex: 1 }} value={newFloor} placeholder="Lisää kerros (esim. 6 tai K)"
              onChange={(ev) => setNewFloor(ev.target.value)}
              onKeyDown={(ev) => { if (ev.key === "Enter") addFloor(); }} />
            <button onClick={addFloor}
              style={{ flexShrink: 0, padding: "0 18px", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.05)", color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: "14px", display: "flex", alignItems: "center", gap: "7px" }}>
              <Plus style={{ width: 16, height: 16 }} /> Lisää
            </button>
          </div>
        </div>

        {/* Import floor mappings */}
        <div className="anim-fadeUp-2" style={{ ...card, padding: m ? "18px" : "22px 24px", marginBottom: "14px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
            <span style={mono}>OMAT POHJAKARTAT (MERKINNÄT)</span>
            <span style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "11px", color: "rgba(255,255,255,0.4)" }}>{liveMarks} merkintää</span>
          </div>
          <p style={{ fontSize: "12px", color: "rgba(255,255,255,0.45)", marginBottom: "12px", lineHeight: 1.55 }}>
            Liitä ikkunamerkinnät JSON-muodossa: kerros → merkinnät, joista jokaisella on prioriteetti (p: 1/2) ja sijainti (x, y prosentteina 0–100).
          </p>
          <textarea
            value={marksText}
            onChange={(ev) => setMarksText(ev.target.value)}
            placeholder={`{\n  "K": { "marks": [{ "p": 1, "x": 24.5, "y": 60.1 }] },\n  "1": { "marks": [{ "p": 2, "x": 70, "y": 33 }] }\n}`}
            spellCheck={false}
            style={{ ...inputStyle, minHeight: "150px", resize: "vertical", fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "12px", lineHeight: 1.55 }}
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: "9px", marginTop: "12px" }}>
            <button onClick={importMarks} disabled={!marksText.trim()}
              style={{ padding: "11px 18px", borderRadius: "12px", border: "none", background: marksText.trim() ? "#fff" : "rgba(255,255,255,0.1)", color: marksText.trim() ? "#0a0a0c" : "rgba(255,255,255,0.4)", cursor: marksText.trim() ? "pointer" : "default", fontWeight: 600, fontSize: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
              <Upload style={{ width: 16, height: 16 }} /> Tuo merkinnät
            </button>
            <button onClick={clearMarks}
              style={{ padding: "11px 18px", borderRadius: "12px", border: "1px solid rgba(255,120,120,0.22)", background: "rgba(255,80,80,0.07)", color: "rgb(255,150,150)", cursor: "pointer", fontWeight: 600, fontSize: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
              <RotateCcw style={{ width: 16, height: 16 }} /> Tyhjennä merkinnät
            </button>
          </div>
        </div>

        {notice && (
          <div style={{ display: "flex", alignItems: "center", gap: "9px", padding: "12px 16px", borderRadius: "13px", marginBottom: "14px",
            background: notice.kind === "ok" ? "rgba(40,90,55,0.5)" : "rgba(90,45,45,0.5)",
            border: `1px solid ${notice.kind === "ok" ? "rgba(120,235,160,0.3)" : "rgba(255,140,140,0.3)"}`,
            color: notice.kind === "ok" ? "rgba(190,245,210,0.95)" : "rgba(255,200,200,0.95)", fontSize: "13px" }}>
            {notice.kind === "ok" ? <Check style={{ width: 16, height: 16, flexShrink: 0 }} /> : <AlertCircle style={{ width: 16, height: 16, flexShrink: 0 }} />}
            {notice.text}
          </div>
        )}
      </div>

      {/* Sticky save bar */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: m ? "14px 12px" : "16px 30px", background: "linear-gradient(0deg, rgba(6,6,7,0.95), rgba(6,6,7,0.0))", display: "flex", justifyContent: "center", pointerEvents: "none" }}>
        <div style={{ width: "100%", maxWidth: "820px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", pointerEvents: "auto" }}>
          <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.5)" }}>
            {saving ? "Tallennetaan…" : justSaved && !dirty ? "Tallennettu" : dirty ? "Tallentamattomia muutoksia" : "Ei muutoksia"}
          </span>
          <button onClick={save} disabled={!dirty || saving}
            style={{ padding: "12px 24px", borderRadius: "13px", border: "none", background: dirty && !saving ? "#fff" : "rgba(255,255,255,0.12)", color: dirty && !saving ? "#0a0a0c" : "rgba(255,255,255,0.4)", cursor: dirty && !saving ? "pointer" : "default", fontWeight: 700, fontSize: "14px", display: "flex", alignItems: "center", gap: "8px", boxShadow: dirty && !saving ? "0 8px 24px rgba(0,0,0,0.4)" : "none" }}>
            {justSaved && !dirty ? <Check style={{ width: 16, height: 16 }} /> : <Save style={{ width: 16, height: 16 }} />}
            {justSaved && !dirty ? "Tallennettu" : "Tallenna"}
          </button>
        </div>
      </div>
    </div>
  );
}
