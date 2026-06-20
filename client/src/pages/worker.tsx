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
    document.title = "Puuhapatet — Työpöytä";
  }, []);

  // Make this page installable to the phone home screen AS THE WORKER'S OWN
  // DASHBOARD — not the Puuhapatet admin. The site-wide manifest's start_url is
  // /admin/dashboard, so without this an "Add to Home Screen" would open the
  // admin. Here we swap in a per-worker manifest scoped to /tyo/ that launches
  // straight back to this private link, and restore the original on unmount.
  useWorkerInstall(token);

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
  if (!view.worker.onboarded) {
    // Soft start (now): one-tap intro. Gated (later): the full sign flow.
    return view.agreementsGated
      ? <Onboarding token={token} view={view} onDone={(v) => setView(v)} />
      : <QuickStart token={token} view={view} onDone={(v) => setView(v)} />;
  }

  // Hard gate: once signing is required, an already-entered worker must read +
  // sign before the dashboard is reachable at all (whole view locked).
  if (view.worker.needsToSign) {
    return <Onboarding token={token} view={view} resign onDone={(v) => setView(v)} />;
  }

  return <Dashboard token={token} view={view} setView={setView} reload={load} />;
}

// ─── Install as a phone app (PWA), scoped to the worker dashboard ─────────────

/**
 * While the worker page is open, point the document's manifest + theme at a
 * dashboard-only install. start_url launches straight back to this private link
 * and scope is "/tyo/", so a home-screen icon opens the worker's own dashboard
 * (standalone, dark) instead of the Puuhapatet admin. On iOS, "Add to Home
 * Screen" captures the current tokened URL anyway; this fixes Android/Chrome
 * (which honour start_url) and gives both a dark, app-like launch.
 */
function useWorkerInstall(token: string) {
  useEffect(() => {
    if (!token || typeof document === "undefined") return;
    const head = document.head;

    // Snapshot what we override so we can restore it when leaving the page.
    const linkEl = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const prevManifestHref = linkEl?.getAttribute("href") ?? null;
    const themeEl = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const prevTheme = themeEl?.getAttribute("content") ?? null;
    const titleEl = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
    const prevAppleTitle = titleEl?.getAttribute("content") ?? null;

    const manifest = {
      name: "Puuhapatet — Työpöytä",
      short_name: "Työpöytä",
      description: "Oma työpöytäsi: kartta, ansiot, tunnit ja maksut.",
      start_url: `/tyo/${token}`,
      scope: "/tyo/",
      display: "standalone",
      background_color: "#060607",
      theme_color: "#060607",
      orientation: "portrait-primary",
      lang: "fi",
      icons: [
        { src: "/favicon.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
        { src: "/favicon.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
      ],
    };
    const blob = new Blob([JSON.stringify(manifest)], { type: "application/manifest+json" });
    const blobUrl = URL.createObjectURL(blob);

    let createdLink = false;
    let link = linkEl;
    if (!link) {
      link = document.createElement("link");
      link.rel = "manifest";
      head.appendChild(link);
      createdLink = true;
    }
    link.setAttribute("href", blobUrl);
    if (themeEl) themeEl.setAttribute("content", "#060607");
    if (titleEl) titleEl.setAttribute("content", "Työpöytä");

    return () => {
      URL.revokeObjectURL(blobUrl);
      if (createdLink) link?.remove();
      else if (link && prevManifestHref != null) link.setAttribute("href", prevManifestHref);
      if (themeEl && prevTheme != null) themeEl.setAttribute("content", prevTheme);
      if (titleEl && prevAppleTitle != null) titleEl.setAttribute("content", prevAppleTitle);
    };
  }, [token]);
}

// ─── Quick start (soft launch) — intro + name only, then straight in ──────────

/** Per-worker personal touches for the welcome intro. Keep the photo files in
 *  client/public/fr8/ (e.g. jani.jpg). Match is by first name, case-insensitive. */
const WORKER_INTROS: Record<string, { photo: string; greeting: string; line: string }> = {
  jani: {
    photo: "/fr8/jani.jpg",
    greeting: "Tervetuloa, Jani 👋",
    line: "Mahtavaa saada sut mukaan ekalle keikalle. Tehdään tästä yhdessä siistiä jälkeä — työpöytäsi odottaa.",
  },
};
function introFor(name: string) {
  const first = (name || "").trim().split(/\s+/)[0]?.toLowerCase();
  return first ? WORKER_INTROS[first] : undefined;
}

/**
 * Phase-A onboarding: the worker opens their link, sees a warm one-screen intro
 * and taps once to enter. Workers are pre-named in the admin, so we ask nothing —
 * no name, no profile, no agreements yet — the dashboard opens straight away so
 * work can start. Some workers get a personalised intro (photo + animation) via
 * WORKER_INTROS. Once signing is gated (WORKER_AGREEMENTS_GATED), the dashboard
 * shows the full sign flow instead (see Dashboard).
 */
function QuickStart({ token, view, onDone }: { token: string; view: WorkerView; onDone: (v: WorkerView) => void }) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [photoOk, setPhotoOk] = useState(true);
  const personal = introFor(view.worker.name);
  const firstName = view.worker.name ? view.worker.name.split(" ")[0] : "";

  const start = async () => {
    setBusy(true); setErr("");
    // No fields to collect — this just records entry, keeping the name the host set.
    const res = await api.crewOnboard(token, { agreements: [] });
    setBusy(false);
    if (res.ok && res.data?.view) onDone(res.data.view);
    else setErr(res.error || "Avaaminen epäonnistui. Yritä uudelleen.");
  };

  // Staggered reveal: each element fades/rises once the ink reveal finishes.
  const rise = (i: number): React.CSSProperties => ({
    opacity: ready ? 1 : 0,
    transform: ready ? "translateY(0)" : "translateY(12px)",
    transition: `opacity .6s ease ${i * 0.12}s, transform .6s cubic-bezier(.2,.8,.2,1) ${i * 0.12}s`,
  });

  return (
    <div style={{ position: "fixed", inset: 0, background: "radial-gradient(120% 120% at 50% 0%, #14223a 0%, #0a0a0c 60%)", fontFamily: FONT, overflow: "hidden" }}>
      <style>{`
        @keyframes pp-pop { 0%{opacity:0;transform:scale(.6)} 60%{opacity:1;transform:scale(1.06)} 100%{opacity:1;transform:scale(1)} }
        @keyframes pp-float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-7px)} }
        @keyframes pp-ring { to { transform: rotate(360deg) } }
      `}</style>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 24, zIndex: 3 }}>
        <p style={{ ...rise(0), color: "rgba(255,255,255,0.5)", fontSize: 13, letterSpacing: "0.18em", textTransform: "uppercase" }}>Puuhapatet</p>

        {/* Personalised photo (e.g. Jani) — pops in, then gently floats. */}
        {personal && photoOk && (
          <div style={{ position: "relative", width: 132, height: 132, margin: "18px 0 6px", animation: ready ? "pp-float 5s ease-in-out infinite 1s" : "none" }}>
            <div style={{ position: "absolute", inset: -7, borderRadius: "50%", background: "conic-gradient(from 0deg, #7CE0A6, #4aa6ff, #b98bff, #7CE0A6)", filter: "blur(2px)", animation: ready ? "pp-ring 6s linear infinite" : "none", opacity: ready ? 0.9 : 0 }} />
            <img
              src={personal.photo}
              alt={firstName}
              onError={() => setPhotoOk(false)}
              style={{ position: "relative", width: 132, height: 132, borderRadius: "50%", objectFit: "cover", border: "3px solid rgba(10,10,12,1)", boxShadow: "0 10px 40px rgba(0,0,0,0.55)", animation: ready ? "pp-pop .8s cubic-bezier(.2,.9,.3,1.2) both" : "none", opacity: ready ? 1 : 0 }}
            />
          </div>
        )}

        <h1 style={{ ...rise(1), color: "#fff", fontSize: "clamp(28px, 7vw, 46px)", fontWeight: 800, margin: "10px 0", lineHeight: 1.1 }}>
          {personal ? personal.greeting : `Tervetuloa tiimiin${firstName ? `, ${firstName}` : ""}`}
        </h1>
        <p style={{ ...rise(2), color: "rgba(255,255,255,0.72)", maxWidth: 460, fontSize: 15.5, lineHeight: 1.65 }}>
          {personal
            ? personal.line
            : "Hienoa saada sinut mukaan. Tämä on ensimmäinen yhteinen keikkamme — pääset suoraan omalle työpöydällesi, jossa näet työsi ja edistymisesi reaaliajassa."}
        </p>
        <p style={{ ...rise(3), color: "rgba(255,255,255,0.42)", maxWidth: 440, fontSize: 12.5, lineHeight: 1.6, marginTop: 12 }}>
          Sopimukset viimeistellään pian — saat ilmoituksen työpöydällesi, kun ne pitää lukea ja allekirjoittaa.
        </p>
        <div style={{ ...rise(4), width: "100%", maxWidth: 320, marginTop: 24, pointerEvents: ready ? "auto" : "none" }}>
          {err && <p style={{ color: "#FF9A9A", fontSize: 13, marginBottom: 8 }}>{err}</p>}
          <button onClick={start} disabled={busy} style={{ ...primaryBtn, background: T.green, opacity: busy ? 0.6 : 1 }}>
            {busy ? "Avataan…" : "Avaa työpöytä →"}
          </button>
        </div>
      </div>
      <InkReveal maskColor={[10, 10, 12]} brushSize={150} fadeOutAfter={1300} fadeOutDuration={1000} onRevealed={() => setReady(true)} />
    </div>
  );
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

type Step = "intro" | "profile" | { agreementIndex: number } | "sign" | "pin" | "submitting";

function Onboarding({ token, view, onDone, resign }: { token: string; view: WorkerView; onDone: (v: WorkerView) => void; resign?: boolean }) {
  const required = WORKER_AGREEMENTS.filter((a) => view.requiredAgreementIds.includes(a.id));
  // resign = an already-entered worker completing the now-required info + signing.
  // Start at the profile ("lisätiedot") step and skip the optional PIN step.
  const [step, setStep] = useState<Step>(resign ? "profile" : "intro");
  const [answers, setAnswers] = useState<Record<string, string>>(() => ({
    fullName: view.worker.profile?.fullName ?? view.worker.name ?? "",
    phone: view.worker.profile?.phone ?? "",
    email: view.worker.profile?.email ?? "",
    ...(view.worker.profile?.answers ?? {}),
  }));
  // Per-agreement clause acceptance (each contract is read + accepted), but the
  // worker draws their signature ONCE at the end — that single signature then
  // applies to every agreement.
  const [accepts, setAccepts] = useState<Record<string, Record<string, boolean>>>({});
  const [signature, setSignature] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [introReady, setIntroReady] = useState(false);

  const setAnswer = (id: string, v: string) => setAnswers((a) => ({ ...a, [id]: v }));

  const submit = async () => {
    setStep("submitting");
    const signedAt = Date.now();
    const agreements = required.map((a) => ({
      agreementId: a.id,
      version: WORKER_AGREEMENT_VERSION,
      signedAt,
      signerName: answers.fullName || view.worker.name,
      signatureDataUrl: signature, // one signature applies to all agreements
      acceptedClauseIds: a.clauses.filter((c) => accepts[a.id]?.[c.id]).map((c) => c.id),
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
          <StepHeader title={resign ? "Täydennä tietosi" : "Profiilisi"} sub={resign ? "Sopimukset on nyt viimeistelty. Täydennä tiedot, lue ja allekirjoita — sen jälkeen voit jatkaa työtä." : "Näitä tietoja käytetään laskutukseen ja työvuorojen suunnitteluun."} n="1 / 3" />
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

  // ── Agreements (read + accept; signing happens once at the end) ──
  if (typeof step === "object") {
    const idx = step.agreementIndex;
    const ag = required[idx];
    const cur = accepts[ag.id] ?? {};
    const allClauses = ag.clauses.every((c) => cur[c.id]);
    const canContinue = allClauses;
    const isLast = idx === required.length - 1;
    return (
      <Paper>
        <Wrap>
          <StepHeader title={ag.title} sub={ag.tagline} n={`Sopimus ${idx + 1} / ${required.length}`} />
          <AgreementBody ag={ag} />
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${T.hair}` }}>
            {ag.clauses.map((c) => (
              <label key={c.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 10, cursor: "pointer", fontSize: 13.5, lineHeight: 1.5 }}>
                <input type="checkbox" checked={!!cur[c.id]} onChange={(e) => setAccepts((s) => ({ ...s, [ag.id]: { ...cur, [c.id]: e.target.checked } }))} style={{ marginTop: 3, width: 18, height: 18, flexShrink: 0 }} />
                <span>{c.text}</span>
              </label>
            ))}
          </div>
          <p style={{ fontSize: 13.5, fontWeight: 600, marginTop: 14, marginBottom: 4 }}>{ag.accept}</p>
          <p style={{ fontSize: 12.5, color: T.muted, marginTop: 0, marginBottom: 8 }}>
            Allekirjoitat kaikki sopimukset kerralla viimeisellä sivulla — sama allekirjoitus pätee jokaiseen.
          </p>
          <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
            <button onClick={() => setStep(idx === 0 ? "profile" : { agreementIndex: idx - 1 })} style={secondaryBtn}>← Takaisin</button>
            <button
              disabled={!canContinue}
              onClick={() => setStep(isLast ? "sign" : { agreementIndex: idx + 1 })}
              style={{ ...primaryBtn, flex: 1, opacity: canContinue ? 1 : 0.5, cursor: canContinue ? "pointer" : "not-allowed" }}
            >
              {isLast ? "Allekirjoita sopimukset →" : "Seuraava sopimus →"}
            </button>
          </div>
        </Wrap>
      </Paper>
    );
  }

  // ── Single signature for all agreements ──
  if (step === "sign") {
    const allAccepted = required.every((a) => a.clauses.every((c) => accepts[a.id]?.[c.id]));
    const canSign = allAccepted && !!signature;
    return (
      <Paper>
        <Wrap>
          <StepHeader
            title="Allekirjoita sopimukset"
            sub="Olet lukenut ja hyväksynyt kaikki sopimukset. Yksi allekirjoitus vahvistaa ne kaikki."
            n="Allekirjoitus"
          />
          <div style={{ marginBottom: 16 }}>
            {required.map((a, i) => {
              const ok = a.clauses.every((c) => accepts[a.id]?.[c.id]);
              return (
                <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: i < required.length - 1 ? `1px solid ${T.hair}` : "none" }}>
                  <span style={{ width: 22, height: 22, borderRadius: 999, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: ok ? T.green : T.hair, color: "#fff", fontSize: 13, fontWeight: 700 }}>{ok ? "✓" : "!"}</span>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{a.title}</p>
                    <p style={{ margin: 0, fontSize: 12, color: T.muted }}>{ok ? "Luettu ja hyväksytty" : "Hyväksy ehdot ensin"}</p>
                  </div>
                  {!ok && (
                    <button onClick={() => setStep({ agreementIndex: required.findIndex((r) => r.id === a.id) })} style={{ ...secondaryBtn, marginLeft: "auto", padding: "6px 12px", fontSize: 12 }}>Avaa</button>
                  )}
                </div>
              );
            })}
          </div>
          <p style={{ fontSize: 13.5, fontWeight: 600, marginTop: 6, marginBottom: 8 }}>
            Allekirjoituksellani hyväksyn kaikki yllä olevat sopimukset sitovasti.
          </p>
          <SignaturePad onChange={(d) => setSignature(d || "")} />
          <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
            <button onClick={() => setStep({ agreementIndex: required.length - 1 })} style={secondaryBtn}>← Takaisin</button>
            <button
              disabled={!canSign}
              onClick={() => (resign ? submit() : setStep("pin"))}
              style={{ ...primaryBtn, flex: 1, opacity: canSign ? 1 : 0.5, cursor: canSign ? "pointer" : "not-allowed" }}
            >
              {resign ? "Vahvista ja allekirjoita →" : "Viimeistele →"}
            </button>
          </div>
        </Wrap>
      </Paper>
    );
  }

  // ── PIN + submit ──
  // In resign mode we skip the PIN step entirely; the only way here is the brief
  // "submitting" state after the worker confirms their signature.
  if (resign) return <Centered>Tallennetaan…</Centered>;
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

type Tab = "map" | "earnings" | "hours" | "payouts" | "notes";

function Dashboard({ token, view, setView, reload }: { token: string; view: WorkerView; setView: (v: WorkerView) => void; reload: () => void }) {
  const [tab, setTab] = useState<Tab>("map");

  // Lock page zoom so pinch zooms only the map (like the admin tool), and let the
  // dark UI extend under the notch / home indicator (viewport-fit=cover) — the
  // header and bottom nav below add safe-area padding so nothing is clipped.
  useEffect(() => {
    const vp = document.querySelector('meta[name="viewport"]');
    const prev = vp?.getAttribute("content") ?? null;
    vp?.setAttribute("content", "width=device-width, initial-scale=1.0, maximum-scale=1, user-scalable=no, viewport-fit=cover");
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
      <div style={{ flexShrink: 0, padding: "calc(12px + env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) 12px max(16px, env(safe-area-inset-left))", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
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
        {tab === "payouts" && <PayoutsTab token={token} view={view} setView={setView} />}
        {tab === "notes" && <NotesTab token={token} view={view} setView={setView} />}
      </div>

      {/* Bottom nav */}
      <div style={{ flexShrink: 0, display: "flex", borderTop: "1px solid rgba(255,255,255,0.08)", background: "rgba(8,8,10,0.95)", paddingBottom: "env(safe-area-inset-bottom)" }}>
        {([["map", "Kartta"], ["earnings", "Ansiot"], ["hours", "Tunnit"], ["payouts", "Maksut"], ["notes", "Muistiinpanot"]] as [Tab, string][]).map(([id, label]) => {
          const pending = id === "payouts" ? (view.payouts || []).filter((p) => p.status === "ilmoitettu").length : 0;
          return (
            <button key={id} onClick={() => { setTab(id); if (id !== "map") reload(); }} style={{ position: "relative", flex: 1, padding: "12px 4px 16px", background: "none", border: "none", color: tab === id ? "#fff" : "rgba(255,255,255,0.45)", fontSize: 11.5, fontWeight: tab === id ? 700 : 500, fontFamily: FONT, cursor: "pointer" }}>
              {label}
              {pending > 0 && (
                <span style={{ position: "absolute", top: 6, left: "calc(50% + 16px)", minWidth: 16, height: 16, padding: "0 4px", borderRadius: 999, background: "#E03B3B", color: "#fff", fontSize: 10, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{pending}</span>
              )}
            </button>
          );
        })}
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
      <PathCard />
      <InstallHint />
      <p style={{ marginTop: 20, fontSize: 12.5, color: "rgba(255,255,255,0.45)", lineHeight: 1.6 }}>
        Ansiosi päivittyy heti, kun merkitset ikkunan pestyksi kartalle. Laskutat kertyneen summan
        Puuhapatetilta oman Y-tunnuksesi kautta.
      </p>
    </div>
  );
}

/** The "first gig → subcontractor → into the brand" path. Shown to FR8 workers
 *  so they know this is the start of something, not a one-off. */
function PathCard() {
  const steps: { n: string; title: string; body: string }[] = [
    { n: "1", title: "Tämä on ensimmäinen keikka", body: "FR8 on ensimmäinen yhteinen keikkamme. Tee laadukasta ja luotettavaa jälkeä — sillä on merkitystä siihen, mitä seuraavaksi." },
    { n: "2", title: "Hyvästä jäljestä jatkoon", body: "Jos työ näyttää hyvältä, voit jatkaa alihankkijana suoraan Puuhapatet-brändin alla — lisää keikkoja, etusija ja mahdollisuus parempaan korvaukseen." },
    { n: "3", title: "Mukaan järjestelmiin", body: "Silloin pääset kunnolla mukaan Puuhapatet-adminiin ja muihin järjestelmiin — et enää yhden keikan näkymään vaan koko tiimin työkaluihin." },
  ];
  return (
    <div style={{ marginTop: 26, padding: 18, borderRadius: 16, background: "linear-gradient(155deg, rgba(124,224,166,0.10), rgba(255,255,255,0.03))", border: "1px solid rgba(124,224,166,0.22)" }}>
      <p style={{ margin: "0 0 4px", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "#7CE0A6" }}>Polku jatkoon</p>
      <p style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 700, color: "#fff" }}>Mihin tämä johtaa</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {steps.map((s) => (
          <div key={s.n} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <span style={{ flexShrink: 0, width: 24, height: 24, borderRadius: 999, background: "rgba(124,224,166,0.18)", border: "1px solid rgba(124,224,166,0.4)", color: "#7CE0A6", fontSize: 12.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{s.n}</span>
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: "#fff" }}>{s.title}</p>
              <p style={{ margin: "2px 0 0", fontSize: 12.5, lineHeight: 1.55, color: "rgba(255,255,255,0.6)" }}>{s.body}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Gentle nudge to install the dashboard to the phone home screen. The actual
 *  install is OS-driven (Add to Home Screen); thanks to the per-worker manifest
 *  the icon opens straight back to this dashboard, not the admin. */
function InstallHint() {
  const isStandalone = typeof window !== "undefined" &&
    (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem("pp_tyo_install_hint") === "1"; } catch { return false; }
  });
  if (isStandalone || dismissed) return null;
  const dismiss = () => { try { localStorage.setItem("pp_tyo_install_hint", "1"); } catch {} setDismissed(true); };
  return (
    <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", display: "flex", gap: 10, alignItems: "flex-start" }}>
      <span style={{ fontSize: 18, lineHeight: 1.2 }}>📲</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#fff" }}>Lisää työpöytä puhelimeen</p>
        <p style={{ margin: "2px 0 0", fontSize: 12, lineHeight: 1.5, color: "rgba(255,255,255,0.55)" }}>
          Avaa selaimen valikko → <b>Lisää aloitusnäyttöön</b>. Kuvake avaa juuri tämän työpöydän — ei muuta.
        </p>
      </div>
      <button onClick={dismiss} aria-label="Sulje" style={{ flexShrink: 0, background: "none", border: "none", color: "rgba(255,255,255,0.4)", fontSize: 16, cursor: "pointer", fontFamily: FONT, lineHeight: 1 }}>✕</button>
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

/** Payouts (Puuhapatet → you). Approve the amount + confirm billing details;
 *  Puuhapatet then pays manually and your invoice is generated automatically. */
function PayoutsTab({ token, view, setView }: { token: string; view: WorkerView; setView: (v: WorkerView) => void }) {
  const payouts = view.payouts || [];
  const b = view.worker.billing;
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: b.name || "", yTunnus: b.yTunnus || "", iban: b.iban || "", address: b.address || "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const approve = async (id: string) => {
    setErr("");
    if (!form.name.trim()) return setErr("Täytä laskuttajan nimi.");
    if (!form.iban.trim()) return setErr("Täytä IBAN, jolle maksu maksetaan.");
    setBusy(true);
    const res = await api.crewApprovePayout(token, id, {
      name: form.name.trim(), yTunnus: form.yTunnus.trim() || undefined,
      iban: form.iban.trim(), address: form.address.trim() || undefined,
    });
    setBusy(false);
    if (res.ok && res.data?.view) { setView(res.data.view); setOpenId(null); }
    else setErr(res.error || "Hyväksyntä epäonnistui.");
  };

  const STATUS: Record<string, { label: string; color: string; bg: string }> = {
    ilmoitettu: { label: "Odottaa hyväksyntää", color: "#E0A800", bg: "rgba(224,168,0,0.14)" },
    hyvaksytty: { label: "Hyväksytty · maksetaan", color: "#7CE0A6", bg: "rgba(124,224,166,0.14)" },
    maksettu: { label: "Maksettu", color: "#7CE0A6", bg: "rgba(124,224,166,0.18)" },
  };

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: 20 }}>
      <p style={{ margin: "0 0 4px", fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)" }}>Maksut sinulle</p>
      <p style={{ margin: "0 0 18px", fontSize: 13, color: "rgba(255,255,255,0.55)", lineHeight: 1.6 }}>
        Puuhapatet maksaa työstäsi. Hyväksy summa ja vahvista laskutustietosi — maksu tehdään tilillesi,
        ja sinun laskusi Puuhapatetille luodaan automaattisesti.
      </p>

      {payouts.length === 0 && (
        <div style={{ padding: 18, borderRadius: 12, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.6)", fontSize: 13.5, textAlign: "center" }}>
          Ei vielä maksuja. Näet täällä maksuilmoitukset, kun ne luodaan.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {payouts.map((p) => {
          const st = STATUS[p.status] || STATUS.ilmoitettu;
          const open = openId === p.id;
          return (
            <div key={p.id} style={{ padding: 16, borderRadius: 14, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <div>
                  <p style={{ margin: 0, fontSize: 24, fontWeight: 800, color: "#7CE0A6", fontVariantNumeric: "tabular-nums" }}>{euro(p.amountCents)}</p>
                  <p style={{ margin: "2px 0 0", fontSize: 12.5, color: "rgba(255,255,255,0.55)" }}>
                    {p.note || "Ikkunanpesutyö"}{p.windows ? ` · ${p.windows} ikkunaa` : ""}
                  </p>
                </div>
                <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, color: st.color, background: st.bg, borderRadius: 999, padding: "5px 10px", whiteSpace: "nowrap" }}>{st.label}</span>
              </div>

              {p.status === "maksettu" && p.invoiceNo && (
                <p style={{ margin: "12px 0 0", fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
                  Laskusi {p.invoiceNo} luotu{p.paidAt ? ` · ${new Date(p.paidAt).toLocaleDateString("fi-FI")}` : ""}.
                </p>
              )}

              {p.status === "ilmoitettu" && !open && (
                <button onClick={() => { setOpenId(p.id); setErr(""); }} style={{ ...primaryBtn, background: T.green, marginTop: 14 }}>
                  Hyväksy ja vahvista tiedot
                </button>
              )}

              {p.status === "ilmoitettu" && open && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                  <p style={{ margin: "0 0 10px", fontSize: 12, color: "rgba(255,255,255,0.55)" }}>Laskutustietosi (näkyvät laskullasi Puuhapatetille):</p>
                  {([["name", "Nimi / toiminimi *"], ["yTunnus", "Y-tunnus"], ["iban", "IBAN *"], ["address", "Osoite"]] as [keyof typeof form, string][]).map(([k, lbl]) => (
                    <div key={k} style={{ marginBottom: 10 }}>
                      <label style={{ display: "block", fontSize: 11, color: "rgba(255,255,255,0.5)", marginBottom: 4 }}>{lbl}</label>
                      <input
                        value={form[k]}
                        onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                        style={{ ...inputStyle, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", color: "#fff" }}
                      />
                    </div>
                  ))}
                  {err && <p style={{ margin: "0 0 8px", fontSize: 12.5, color: "#FF9A9A" }}>{err}</p>}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => approve(p.id)} disabled={busy} style={{ ...primaryBtn, background: T.green, flex: 1, opacity: busy ? 0.6 : 1 }}>
                      {busy ? "Hyväksytään…" : "Hyväksy maksu"}
                    </button>
                    <button onClick={() => setOpenId(null)} style={{ ...secondaryBtn, flex: "0 0 auto" }}>Peruuta</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
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
