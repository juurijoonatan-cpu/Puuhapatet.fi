/**
 * Worker dashboard — a custom-gig worker's private, link-gated view.
 *
 * Reached at /tyo/:token (the worker's private link). Flow:
 *   1. Optional PIN unlock (if the worker set one).
 *   2. InkReveal intro + onboarding gate: profile questionnaire + signing each
 *      required agreement (alihankkija etc.) + optional PIN — "the intro is the
 *      signing". Until done, the dashboard stays closed.
 *   3. Dashboard tabs: Kartta (mark your windows), Ansiot (live €), Tunnit
 *      (timer), Muistiinpanot (notes).
 *
 * Workers are paid €/window (their own rate) and NEVER see the gig price or cap.
 * Built mobile-first; works on phone and laptop.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRoute } from "wouter";
import { api, type WorkerView } from "@/lib/api";
import type { WindowStatus } from "@shared/project";
import {
  WORKER_AGREEMENTS, PROFILE_QUESTIONS, PROFILE_REQUIRED_IDS, WORKER_AGREEMENT_VERSION,
  type WorkerAgreement,
} from "@shared/worker-agreements";
import InkReveal from "@/components/InkReveal";
import SignaturePad from "@/components/SignaturePad";
import FloorView from "@/components/fr8/FloorView";

const T = { ink: "#1A1A1A", paper: "#F6F4EE", card: "#FFFFFF", hair: "#E4E1D7", muted: "#8C8A82", green: "#3E7C59", navy: "#1F3B57" };
const FONT = "'Poppins', ui-sans-serif, system-ui, -apple-system, sans-serif";

function euro(cents: number) {
  return (cents / 100).toLocaleString("fi-FI", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + " €";
}

export default function WorkerPage() {
  const [, params] = useRoute("/tyo/:token");
  const token = params?.token ?? "";
  const [view, setView] = useState<WorkerView | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error" | "locked">("loading");

  // Load Poppins once.
  useEffect(() => {
    const id = "poppins-font-link";
    if (!document.getElementById(id)) {
      const link = document.createElement("link");
      link.id = id; link.rel = "stylesheet";
      link.href = "https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap";
      document.head.appendChild(link);
    }
    document.title = "Puuhapatet — Työntekijä";
  }, []);

  const load = useCallback(async () => {
    if (!token) return;
    const res = await api.getCrewView(token);
    if (res.ok && res.data?.view) {
      const v = res.data.view;
      setView(v);
      const unlocked = sessionStorage.getItem(`pp_crew_${token}`) === "1";
      setStatus(v.worker.hasPin && !unlocked ? "locked" : "ok");
    } else {
      setStatus("error");
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  if (status === "loading") return <Centered>Ladataan…</Centered>;
  if (status === "error" || !view) return <Centered>Linkkiä ei löytynyt tai se on vanhentunut.</Centered>;
  if (status === "locked") return <PinGate token={token} onUnlock={() => { sessionStorage.setItem(`pp_crew_${token}`, "1"); setStatus("ok"); }} />;
  if (!view.worker.onboarded) return <Onboarding token={token} view={view} onDone={(v) => setView(v)} />;

  return <Dashboard token={token} view={view} setView={setView} reload={load} />;
}

// ─── PIN gate ───────────────────────────────────────────────────────────────

function PinGate({ token, onUnlock }: { token: string; onUnlock: () => void }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const submit = async () => {
    const res = await api.crewAuth(token, pin);
    if (res.ok && res.data?.ok) onUnlock();
    else setErr("Väärä PIN");
  };
  return (
    <Paper>
      <div style={{ maxWidth: 360, margin: "0 auto", textAlign: "center", paddingTop: 60 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>Puuhapatet</h1>
        <p style={{ color: T.muted, marginBottom: 24 }}>Syötä PIN-koodisi.</p>
        <input
          value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric" type="password" placeholder="••••"
          style={{ ...inputStyle, textAlign: "center", letterSpacing: 8, fontSize: 24 }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        {err && <p style={{ color: "#D9472B", fontSize: 13, marginTop: 8 }}>{err}</p>}
        <button onClick={submit} style={{ ...primaryBtn, marginTop: 16 }}>Avaa</button>
      </div>
    </Paper>
  );
}

// ─── Onboarding (intro + profile + agreements) ─────────────────────────────────

type Step = "intro" | "profile" | { agreementIndex: number } | "pin" | "submitting";

function Onboarding({ token, view, onDone }: { token: string; view: WorkerView; onDone: (v: WorkerView) => void }) {
  const required = WORKER_AGREEMENTS.filter((a) => view.requiredAgreementIds.includes(a.id));
  const [step, setStep] = useState<Step>("intro");
  const [answers, setAnswers] = useState<Record<string, string>>(() => ({
    fullName: view.worker.profile?.fullName ?? view.worker.name ?? "",
    phone: view.worker.profile?.phone ?? "",
    email: view.worker.profile?.email ?? "",
    ...(view.worker.profile?.answers ?? {}),
  }));
  const [sigs, setSigs] = useState<Record<string, { dataUrl: string; clauses: Record<string, boolean> }>>({});
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [introReady, setIntroReady] = useState(false);

  const setAnswer = (id: string, v: string) => setAnswers((a) => ({ ...a, [id]: v }));

  const submit = async () => {
    setStep("submitting");
    const agreements = required.map((a) => ({
      agreementId: a.id,
      version: WORKER_AGREEMENT_VERSION,
      signedAt: Date.now(),
      signerName: answers.fullName || view.worker.name,
      signatureDataUrl: sigs[a.id]?.dataUrl ?? "",
      acceptedClauseIds: a.clauses.filter((c) => sigs[a.id]?.clauses[c.id]).map((c) => c.id),
    }));
    const profile = {
      fullName: answers.fullName, phone: answers.phone, email: answers.email,
      city: answers.city, yTunnus: answers.yTunnus, iban: answers.iban,
      answers,
    };
    const res = await api.crewOnboard(token, { profile, agreements, pin: pin || undefined });
    if (res.ok && res.data?.view) onDone(res.data.view);
    else { setErr(res.error || "Tallennus epäonnistui"); setStep("pin"); }
  };

  // ── Intro ──
  if (step === "intro") {
    return (
      <div style={{ position: "fixed", inset: 0, background: "#0a0a0c", fontFamily: FONT, overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 24, zIndex: 0 }}>
          <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, letterSpacing: "0.18em", textTransform: "uppercase" }}>Puuhapatet</p>
          <h1 style={{ color: "#fff", fontSize: "clamp(28px, 7vw, 48px)", fontWeight: 800, margin: "10px 0", lineHeight: 1.1 }}>
            Tervetuloa tiimiin{view.worker.name ? `, ${view.worker.name.split(" ")[0]}` : ""}
          </h1>
          <p style={{ color: "rgba(255,255,255,0.7)", maxWidth: 440, fontSize: 15, lineHeight: 1.6 }}>
            Ennen kuin pääset omalle työpöydällesi, täytä lyhyt profiili ja allekirjoita sopimukset.
            Tienaat <strong style={{ color: "#fff" }}>{euro(view.worker.perWindowCents)}</strong> jokaisesta pesemästäsi ikkunasta.
          </p>
          <button
            onClick={() => setStep("profile")}
            style={{ ...primaryBtn, marginTop: 28, position: "relative", zIndex: 3, opacity: introReady ? 1 : 0, transform: introReady ? "translateY(0)" : "translateY(8px)", transition: "opacity .5s ease, transform .5s ease", pointerEvents: introReady ? "auto" : "none" }}
          >
            Aloita →
          </button>
        </div>
        {/* Cool ink reveal that plays itself and then dissolves — no swipe needed. */}
        <InkReveal maskColor={[10, 10, 12]} brushSize={150} fadeOutAfter={1300} fadeOutDuration={1000} onRevealed={() => setIntroReady(true)} />
      </div>
    );
  }

  // ── Profile ──
  if (step === "profile") {
    const missing = PROFILE_REQUIRED_IDS.filter((id) => !(answers[id] || "").trim());
    return (
      <Paper>
        <Wrap>
          <StepHeader title="Profiilisi" sub="Näitä tietoja käytetään laskutukseen ja työvuorojen suunnitteluun." n="1 / 3" />
          {PROFILE_QUESTIONS.map((q) => (
            <label key={q.id} style={{ display: "block", marginBottom: 14 }}>
              <span style={fieldLabel}>{q.label}{q.required ? " *" : ""}</span>
              {q.type === "textarea" ? (
                <textarea value={answers[q.id] ?? ""} onChange={(e) => setAnswer(q.id, e.target.value)} placeholder={q.placeholder} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
              ) : (
                <input value={answers[q.id] ?? ""} onChange={(e) => setAnswer(q.id, e.target.value)} placeholder={q.placeholder} type={q.type} style={inputStyle} />
              )}
              {q.help && <span style={{ fontSize: 11.5, color: T.muted }}>{q.help}</span>}
            </label>
          ))}
          <button
            disabled={missing.length > 0}
            onClick={() => setStep({ agreementIndex: 0 })}
            style={{ ...primaryBtn, opacity: missing.length ? 0.5 : 1, cursor: missing.length ? "not-allowed" : "pointer" }}
          >
            Jatka sopimuksiin →
          </button>
        </Wrap>
      </Paper>
    );
  }

  // ── Agreements ──
  if (typeof step === "object") {
    const idx = step.agreementIndex;
    const ag = required[idx];
    const cur = sigs[ag.id] ?? { dataUrl: "", clauses: {} };
    const allClauses = ag.clauses.every((c) => cur.clauses[c.id]);
    const canContinue = allClauses && !!cur.dataUrl;
    const isLast = idx === required.length - 1;
    return (
      <Paper>
        <Wrap>
          <StepHeader title={ag.title} sub={ag.tagline} n={`Sopimus ${idx + 1} / ${required.length}`} />
          <AgreementBody ag={ag} />
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${T.hair}` }}>
            {ag.clauses.map((c) => (
              <label key={c.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 10, cursor: "pointer", fontSize: 13.5, lineHeight: 1.5 }}>
                <input type="checkbox" checked={!!cur.clauses[c.id]} onChange={(e) => setSigs((s) => ({ ...s, [ag.id]: { ...cur, clauses: { ...cur.clauses, [c.id]: e.target.checked } } }))} style={{ marginTop: 3, width: 18, height: 18, flexShrink: 0 }} />
                <span>{c.text}</span>
              </label>
            ))}
          </div>
          <p style={{ fontSize: 13.5, fontWeight: 600, marginTop: 14, marginBottom: 8 }}>{ag.accept}</p>
          <SignaturePad onChange={(d) => setSigs((s) => ({ ...s, [ag.id]: { ...cur, dataUrl: d || "" } }))} />
          <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
            <button onClick={() => setStep(idx === 0 ? "profile" : { agreementIndex: idx - 1 })} style={secondaryBtn}>← Takaisin</button>
            <button
              disabled={!canContinue}
              onClick={() => setStep(isLast ? "pin" : { agreementIndex: idx + 1 })}
              style={{ ...primaryBtn, flex: 1, opacity: canContinue ? 1 : 0.5, cursor: canContinue ? "pointer" : "not-allowed" }}
            >
              {isLast ? "Viimeistele →" : "Seuraava sopimus →"}
            </button>
          </div>
        </Wrap>
      </Paper>
    );
  }

  // ── PIN + submit ──
  return (
    <Paper>
      <Wrap>
        <StepHeader title="Suojaa työpöytäsi" sub="Aseta halutessasi 4-numeroinen PIN. Linkkisi on henkilökohtainen — älä jaa sitä." n="Valmis" />
        <label style={{ display: "block", marginBottom: 14 }}>
          <span style={fieldLabel}>PIN-koodi (valinnainen)</span>
          <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" type="password" placeholder="esim. 1234" style={inputStyle} />
        </label>
        {err && <p style={{ color: "#D9472B", fontSize: 13 }}>{err}</p>}
        <button onClick={submit} disabled={step === "submitting"} style={primaryBtn}>
          {step === "submitting" ? "Tallennetaan…" : "Avaa työpöytä →"}
        </button>
      </Wrap>
    </Paper>
  );
}

function AgreementBody({ ag }: { ag: WorkerAgreement }) {
  return (
    <div style={{ fontSize: 13.5, lineHeight: 1.6, color: T.ink }}>
      <p style={{ color: T.muted, marginBottom: 14 }}>{ag.intro}</p>
      {ag.sections.map((s) => (
        <div key={s.no} style={{ marginBottom: 14 }}>
          <p style={{ fontWeight: 700, margin: "0 0 4px" }}><span style={{ color: T.muted, fontVariantNumeric: "tabular-nums" }}>{s.no}</span>&nbsp;&nbsp;{s.title}</p>
          {s.body.map((b, i) => <p key={i} style={{ margin: "0 0 5px", paddingLeft: 8 }}>• {b}</p>)}
        </div>
      ))}
    </div>
  );
}

// ─── Dashboard ──────────────────────────────────────────────────────────────

type Tab = "map" | "earnings" | "hours" | "notes";

function Dashboard({ token, view, setView, reload }: { token: string; view: WorkerView; setView: (v: WorkerView) => void; reload: () => void }) {
  const [tab, setTab] = useState<Tab>("map");

  // Lock page zoom so pinch zooms only the map (like the admin tool).
  useEffect(() => {
    const vp = document.querySelector('meta[name="viewport"]');
    const prev = vp?.getAttribute("content") ?? null;
    vp?.setAttribute("content", "width=device-width, initial-scale=1.0, maximum-scale=1, user-scalable=no");
    return () => { if (vp && prev != null) vp.setAttribute("content", prev); };
  }, []);

  const markWindow = useCallback(async (key: string, st: WindowStatus) => {
    const res = await api.crewMarkWindow(token, key, st);
    if (res.ok && res.data?.view) setView(res.data.view);
  }, [token, setView]);

  const noop = useCallback(() => {}, []);

  return (
    <div className="fr8-root" style={{ position: "fixed", inset: 0, background: "#060607", color: "#fff", display: "flex", flexDirection: "column", fontFamily: FONT, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ flexShrink: 0, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <div>
          <p style={{ margin: 0, fontWeight: 700, fontSize: 15 }}>{view.worker.name || "Työntekijä"}</p>
          <p style={{ margin: 0, fontSize: 11.5, color: "rgba(255,255,255,0.5)" }}>{view.building.name || "Puuhapatet"}{view.building.address ? ` · ${view.building.address}` : ""}</p>
        </div>
        <div style={{ textAlign: "right" }}>
          <p style={{ margin: 0, fontSize: 20, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: "#7CE0A6" }}>{euro(view.stats.earnedCents)}</p>
          <p style={{ margin: 0, fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{view.stats.washed} ikkunaa · {euro(view.worker.perWindowCents)}/kpl</p>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {tab === "map" && (
          <FloorView
            floors={view.building.floors}
            planBase={view.building.planBase || ""}
            pricePerWindow={view.pricePerWindow}
            marks={view.marks}
            statuses={view.statuses}
            posOverrides={view.posOverrides}
            customMarks={view.customMarks}
            deleted={view.deleted}
            initialFloor={view.building.floors[0] || "1"}
            onStatusChange={markWindow}
            onAddCustomMark={noop}
            onDeleteMark={noop}
            onMoveMark={noop}
            onMoveMarkCommit={noop}
            onResetFloor={noop}
            canEdit={false}
          />
        )}
        {tab === "earnings" && <EarningsTab view={view} />}
        {tab === "hours" && <HoursTab token={token} view={view} setView={setView} />}
        {tab === "notes" && <NotesTab token={token} view={view} setView={setView} />}
      </div>

      {/* Bottom nav */}
      <div style={{ flexShrink: 0, display: "flex", borderTop: "1px solid rgba(255,255,255,0.08)", background: "rgba(8,8,10,0.95)" }}>
        {([["map", "Kartta"], ["earnings", "Ansiot"], ["hours", "Tunnit"], ["notes", "Muistiinpanot"]] as [Tab, string][]).map(([id, label]) => (
          <button key={id} onClick={() => { setTab(id); if (id !== "map") reload(); }} style={{ flex: 1, padding: "12px 4px 16px", background: "none", border: "none", color: tab === id ? "#fff" : "rgba(255,255,255,0.45)", fontSize: 12, fontWeight: tab === id ? 700 : 500, fontFamily: FONT, cursor: "pointer" }}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function EarningsTab({ view }: { view: WorkerView }) {
  const potentialWindows = useMemo(() => {
    // total live windows × their rate = the most this worker could earn here.
    let total = 0;
    const floors = view.building.floors;
    for (const f of floors) {
      total += (view.marks[f]?.marks?.length || 0) + (view.customMarks[f]?.length || 0);
    }
    return total;
  }, [view]);
  const s = view.stats;
  return (
    <div style={{ height: "100%", overflowY: "auto", padding: 20 }}>
      <div style={{ textAlign: "center", padding: "30px 0" }}>
        <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase" }}>Kertynyt ansio</p>
        <p style={{ fontSize: 48, fontWeight: 800, margin: "6px 0", color: "#7CE0A6", fontVariantNumeric: "tabular-nums" }}>{euro(s.earnedCents)}</p>
        <p style={{ color: "rgba(255,255,255,0.6)" }}>{s.washed} pestyä ikkunaa × {euro(view.worker.perWindowCents)}</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Stat label="Tunteja" value={s.hours.toLocaleString("fi-FI", { maximumFractionDigits: 1 })} />
        <Stat label="€ / tunti" value={s.hours > 0 ? euro(Math.round(s.eurPerHour * 100)) : "—"} />
        <Stat label="Ikkunaa / tunti" value={s.hours > 0 ? s.windowsPerHour.toLocaleString("fi-FI", { maximumFractionDigits: 1 }) : "—"} />
        <Stat label="Ikkunoita kohteessa" value={String(potentialWindows)} />
      </div>
      <Leaderboard view={view} />
      <p style={{ marginTop: 20, fontSize: 12.5, color: "rgba(255,255,255,0.45)", lineHeight: 1.6 }}>
        Ansiosi päivittyy heti, kun merkitset ikkunan pestyksi kartalle. Laskutat kertyneen summan
        Puuhapatetilta oman Y-tunnuksesi kautta.
      </p>
    </div>
  );
}

/** Minimal, fun team standings (workers only — never shown to the customer). */
function Leaderboard({ view }: { view: WorkerView }) {
  const board = view.leaderboard ?? [];
  if (board.length < 2) return null; // no fun in a leaderboard of one
  const maxWashed = Math.max(1, ...board.map((b) => b.washed));
  // Efficiency leader: best windows/hour among those who have logged hours.
  const eligible = board.filter((b) => b.hours > 0);
  const effLeaderId = eligible.length
    ? eligible.reduce((a, b) => (b.windowsPerHour > a.windowsPerHour ? b : a)).id
    : null;
  const firstName = (n: string) => n.split(" ")[0] || n;
  return (
    <div style={{ marginTop: 26 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
        <p style={{ margin: 0, fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)" }}>Tiimin kärki</p>
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>pestyt ikkunat</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {board.slice(0, 8).map((b, i) => {
          const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
          const pct = (b.washed / maxWashed) * 100;
          return (
            <div key={b.id} style={{ position: "relative", display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 12, overflow: "hidden", background: b.isMe ? "rgba(124,224,166,0.12)" : "rgba(255,255,255,0.05)", border: `1px solid ${b.isMe ? "rgba(124,224,166,0.35)" : "rgba(255,255,255,0.08)"}` }}>
              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct}%`, background: b.isMe ? "rgba(124,224,166,0.10)" : "rgba(255,255,255,0.04)" }} />
              <span style={{ position: "relative", width: 22, textAlign: "center", fontSize: i < 3 ? 16 : 12, fontWeight: 700, color: "rgba(255,255,255,0.6)" }}>{medal}</span>
              <span style={{ position: "relative", flex: 1, fontSize: 14, fontWeight: b.isMe ? 700 : 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {b.isMe ? "Sinä" : firstName(b.name)}
                {b.id === effLeaderId && <span title="Tehokkain (ikkunaa/tunti)" style={{ marginLeft: 6, fontSize: 12 }}>⚡</span>}
              </span>
              <span style={{ position: "relative", fontSize: 15, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{b.washed}</span>
            </div>
          );
        })}
      </div>
      {board[0] && board[0].washed > 0 && (
        <p style={{ marginTop: 10, fontSize: 12, color: "rgba(255,255,255,0.5)", textAlign: "center" }}>
          {board[0].isMe ? "Sinä johdat — hieno suoritus! 🏆" : `${firstName(board[0].name)} johtaa. Kurot kiinni! 💪`}
        </p>
      )}
    </div>
  );
}

function HoursTab({ token, view, setView }: { token: string; view: WorkerView; setView: (v: WorkerView) => void }) {
  const [running, setRunning] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [manual, setManual] = useState("");
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (running) {
      tick.current = setInterval(() => setElapsed(Date.now() - running), 1000);
      return () => { if (tick.current) clearInterval(tick.current); };
    }
  }, [running]);

  const stop = async () => {
    if (!running) return;
    const hours = Math.round(((Date.now() - running) / 3600000) * 100) / 100;
    setRunning(null); setElapsed(0);
    if (hours > 0) {
      const res = await api.crewAddHours(token, hours);
      if (res.ok && res.data?.view) setView(res.data.view);
    }
  };

  const addManual = async () => {
    const h = parseFloat(manual.replace(",", "."));
    if (!Number.isFinite(h) || h === 0) return;
    const res = await api.crewAddHours(token, Math.round(h * 100) / 100);
    if (res.ok && res.data?.view) { setView(res.data.view); setManual(""); }
  };

  const mmss = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: 20 }}>
      <div style={{ textAlign: "center", padding: "20px 0" }}>
        <p style={{ fontSize: 40, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: running ? "#7CE0A6" : "#fff" }}>{mmss(elapsed)}</p>
        <button onClick={() => (running ? stop() : setRunning(Date.now()))} style={{ ...primaryBtn, width: "auto", padding: "12px 32px", background: running ? "#D9472B" : T.green, marginTop: 8 }}>
          {running ? "Lopeta vuoro" : "Aloita vuoro"}
        </button>
        <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, marginTop: 10 }}>Aloita ajanseuranta, kun saavut työmaalle.</p>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10 }}>
        <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Lisää tunteja käsin (esim. 2,5)" inputMode="decimal" style={{ ...inputStyle, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", color: "#fff" }} />
        <button onClick={addManual} style={{ ...secondaryBtn, color: "#fff", border: "1px solid rgba(255,255,255,0.2)", whiteSpace: "nowrap" }}>Lisää</button>
      </div>
      <div style={{ marginTop: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Stat label="Tunteja yhteensä" value={view.stats.hours.toLocaleString("fi-FI", { maximumFractionDigits: 1 })} />
        <Stat label="€ / tunti" value={view.stats.hours > 0 ? euro(Math.round(view.stats.eurPerHour * 100)) : "—"} />
      </div>
    </div>
  );
}

function NotesTab({ token, view, setView }: { token: string; view: WorkerView; setView: (v: WorkerView) => void }) {
  const [text, setText] = useState("");
  const add = async () => {
    const t = text.trim();
    if (!t) return;
    const res = await api.crewAddNote(token, t);
    if (res.ok && res.data?.view) { setView(res.data.view); setText(""); }
  };
  return (
    <div style={{ height: "100%", overflowY: "auto", padding: 20 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Kirjoita muistiinpano (esim. rikkinäinen ikkuna, puuttuva avain)…" style={{ ...inputStyle, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", color: "#fff", resize: "vertical" }} />
        <button onClick={add} style={{ ...primaryBtn, background: T.green }}>Lisää muistiinpano</button>
      </div>
      <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 8 }}>
        {view.worker.notes.length === 0 && <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 13 }}>Ei muistiinpanoja vielä.</p>}
        {view.worker.notes.map((n, i) => (
          <div key={i} style={{ padding: 12, borderRadius: 10, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5 }}>{n.text}</p>
            <p style={{ margin: "4px 0 0", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{new Date(n.t).toLocaleString("fi-FI", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Small shared bits ──────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: 14, borderRadius: 12, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <p style={{ margin: 0, fontSize: 11, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</p>
      <p style={{ margin: "4px 0 0", fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{value}</p>
    </div>
  );
}

function StepHeader({ title, sub, n }: { title: string; sub: string; n: string }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <p style={{ margin: 0, fontSize: 11, color: T.muted, letterSpacing: "0.1em", textTransform: "uppercase" }}>{n}</p>
      <h1 style={{ margin: "4px 0 4px", fontSize: 24, fontWeight: 800 }}>{title}</h1>
      <p style={{ margin: 0, fontSize: 13.5, color: T.muted }}>{sub}</p>
    </div>
  );
}

function Paper({ children }: { children: React.ReactNode }) {
  return <div style={{ minHeight: "100vh", background: T.paper, fontFamily: FONT, color: T.ink, padding: "24px 16px 60px" }}>{children}</div>;
}
function Wrap({ children }: { children: React.ReactNode }) {
  return <div style={{ maxWidth: 560, margin: "0 auto", background: T.card, border: `1px solid ${T.hair}`, borderRadius: 16, padding: 22 }}>{children}</div>;
}
function Centered({ children }: { children: React.ReactNode }) {
  return <div style={{ minHeight: "100vh", background: T.paper, fontFamily: FONT, color: T.muted, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" }}>{children}</div>;
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "11px 13px", borderRadius: 10, border: `1px solid ${T.hair}`,
  background: "#fff", color: T.ink, fontFamily: FONT, fontSize: 14, marginTop: 4, boxSizing: "border-box",
};
const fieldLabel: React.CSSProperties = { display: "block", fontSize: 12.5, fontWeight: 600, color: T.ink };
const primaryBtn: React.CSSProperties = {
  width: "100%", padding: "13px", borderRadius: 11, border: "none", background: T.navy, color: "#fff",
  fontFamily: FONT, fontSize: 15, fontWeight: 700, cursor: "pointer",
};
const secondaryBtn: React.CSSProperties = {
  padding: "13px 16px", borderRadius: 11, border: `1px solid ${T.hair}`, background: "transparent",
  color: T.ink, fontFamily: FONT, fontSize: 14, fontWeight: 600, cursor: "pointer",
};
