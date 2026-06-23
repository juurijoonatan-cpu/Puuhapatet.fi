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
  ALL_AGREEMENTS, PROFILE_QUESTIONS, PROFILE_REQUIRED_IDS, WORKER_AGREEMENT_VERSION,
  INSURANCE_QUESTION, INSURANCE_LATER_NOTE, RISK_ACK_TEXT, INSURANCE_ANSWER_KEY, RISK_ACK_KEY,
  type WorkerAgreement,
} from "@shared/worker-agreements";
import InkReveal from "@/components/InkReveal";
import SignaturePad from "@/components/SignaturePad";
import FloorView from "@/components/fr8/FloorView";
import {
  computeTax, readVatStatus, readInPrepaymentRegister, fmtPct, fmtEurCents,
  VAT_STATUS_KEY, PREPAYMENT_REGISTER_KEY, type VatStatus,
} from "@shared/tax";
import { computePayProgress } from "@shared/payprogress";

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

  const logout = useCallback(() => {
    try { sessionStorage.removeItem(`pp_crew_${token}`); } catch {}
    if (view?.worker.hasPin) {
      setStatus("locked");
    } else {
      window.location.href = "/";
    }
  }, [token, view]);

  if (status === "loading") return <Centered>Ladataan…</Centered>;
  if (status === "error" || !view) return <Centered>Linkkiä ei löytynyt tai se on vanhentunut.</Centered>;
  if (status === "locked") return <PinGate token={token} view={view} onUnlock={() => { sessionStorage.setItem(`pp_crew_${token}`, "1"); setStatus("ok"); }} />;
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

  return <Dashboard token={token} view={view} setView={setView} reload={load} onLogout={logout} />;
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

// ─── PWA install detection ────────────────────────────────────────────────────

type InstallPlatform = "ios" | "android" | "desktop";
interface PwaInstall {
  standalone: boolean;        // already launched as an installed app → fullscreen, no chrome
  platform: InstallPlatform;
  inAppBrowser: boolean;      // opened inside an app's webview (IG/FB/etc.) — can't install here
  canPrompt: boolean;         // Android/Chrome native install prompt is available
  promptInstall: () => void;  // trigger the native prompt (Android/Chrome)
}

/**
 * Detect how the worker is viewing the dashboard so we can guide them to a
 * proper full-screen install. On iOS the only way to lose Safari's chrome (the
 * tool buttons + bands in the screenshot) is "Lisää Koti-valikkoon"; in-app
 * browsers (Instagram/Facebook/…) can't install at all and must be reopened in
 * Safari/Chrome. Android/Chrome exposes a one-tap native prompt.
 */
function usePwaInstall(): PwaInstall {
  const detect = (): Omit<PwaInstall, "canPrompt" | "promptInstall"> => {
    if (typeof window === "undefined") return { standalone: true, platform: "desktop", inAppBrowser: false };
    const ua = navigator.userAgent || "";
    const standalone = window.matchMedia?.("(display-mode: standalone)").matches
      || window.matchMedia?.("(display-mode: fullscreen)").matches
      || (navigator as any).standalone === true;
    const isIOS = /iphone|ipad|ipod/i.test(ua)
      || (navigator.platform === "MacIntel" && (navigator as any).maxTouchPoints > 1);
    const isAndroid = /android/i.test(ua);
    const inAppBrowser = /FBAN|FBAV|Instagram|Line\/|Messenger|MicroMessenger|Snapchat|Pinterest|Twitter|TikTok|GSA\//i.test(ua);
    return { standalone: !!standalone, platform: isIOS ? "ios" : isAndroid ? "android" : "desktop", inAppBrowser };
  };

  const [state, setState] = useState(detect);
  const deferredRef = useRef<any>(null);
  const [canPrompt, setCanPrompt] = useState(false);

  useEffect(() => {
    const onBeforeInstall = (e: Event) => { e.preventDefault(); deferredRef.current = e; setCanPrompt(true); };
    const onInstalled = () => { deferredRef.current = null; setCanPrompt(false); setState(detect()); };
    const mq = window.matchMedia?.("(display-mode: standalone)");
    const onChange = () => setState(detect());
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    mq?.addEventListener?.("change", onChange);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      mq?.removeEventListener?.("change", onChange);
    };
  }, []);

  const promptInstall = useCallback(() => {
    const d = deferredRef.current;
    if (!d) return;
    d.prompt();
    d.userChoice?.finally?.(() => { deferredRef.current = null; setCanPrompt(false); });
  }, []);

  return { ...state, canPrompt, promptInstall };
}

/** Sticky bar under the header that drives workers to a full-screen install.
 *  Only shown when NOT already running as an installed app. */
function InstallBanner({ pwa, onOpen }: { pwa: PwaInstall; onOpen: () => void }) {
  const [hidden, setHidden] = useState(() => {
    try { return sessionStorage.getItem("pp_tyo_install_bar") === "1"; } catch { return false; }
  });
  if (pwa.standalone || hidden) return null;
  const hide = () => { try { sessionStorage.setItem("pp_tyo_install_bar", "1"); } catch {} setHidden(true); };
  const label = pwa.inAppBrowser ? "Avaa oikeassa selaimessa" : "Asenna koko ruudun sovellus";
  return (
    <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 10, padding: "9px max(14px, env(safe-area-inset-right)) 9px max(14px, env(safe-area-inset-left))", background: "linear-gradient(90deg, rgba(124,224,166,0.16), rgba(124,224,166,0.06))", borderBottom: "1px solid rgba(124,224,166,0.25)" }}>
      <span style={{ fontSize: 17, lineHeight: 1 }}>📲</span>
      <button onClick={onOpen} style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: FONT }}>
        <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: "#fff" }}>{label}</span>
        <span style={{ display: "block", fontSize: 11, color: "rgba(255,255,255,0.6)" }}>Pois selaimen palkit — näytä ohjeet</span>
      </button>
      <button onClick={onOpen} style={{ flexShrink: 0, padding: "7px 12px", borderRadius: 999, background: "#7CE0A6", color: "#06210f", border: "none", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: FONT }}>Näytä</button>
      <button onClick={hide} aria-label="Myöhemmin" style={{ flexShrink: 0, background: "none", border: "none", color: "rgba(255,255,255,0.45)", fontSize: 16, cursor: "pointer", fontFamily: FONT, lineHeight: 1 }}>✕</button>
    </div>
  );
}

/** Step-by-step install guide, tailored to how the worker is viewing the page. */
function InstallModal({ pwa, onClose }: { pwa: PwaInstall; onClose: () => void }) {
  const steps: { icon: string; text: React.ReactNode }[] = pwa.inAppBrowser
    ? [
        { icon: "①", text: <>Avaa tämä sivu <b>Safarissa</b> (iPhone) tai <b>Chromessa</b> (Android) — ei sovelluksen sisäisessä selaimessa.</> },
        { icon: "②", text: <>Paina oikean yläkulman <b>•••</b>-valikkoa → <b>Avaa selaimessa</b>.</> },
        { icon: "③", text: <>Tee sitten alla olevat vaiheet aloitusnäyttöön lisäämiseksi.</> },
      ]
    : pwa.platform === "ios"
    ? [
        { icon: "①", text: <>Paina alapalkin <b>Jaa-painiketta</b> <span style={{ fontSize: 15 }}>􀈂</span> (neliö, jossa nuoli ylös).</> },
        { icon: "②", text: <>Valitse <b>Lisää Koti-valikkoon</b>.</> },
        { icon: "③", text: <>Paina <b>Lisää</b>. Työpöytä avautuu nyt omana sovelluksenaan — koko ruudulla, ilman selaimen palkkeja.</> },
      ]
    : [
        { icon: "①", text: <>Paina oikean yläkulman <b>⋮</b>-valikkoa.</> },
        { icon: "②", text: <>Valitse <b>Asenna sovellus</b> tai <b>Lisää aloitusnäyttöön</b>.</> },
        { icon: "③", text: <>Vahvista. Kuvake avaa työpöydän koko ruudulla, ilman selainpalkkeja.</> },
      ];
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(0,0,0,0.66)", display: "flex", alignItems: "flex-end", justifyContent: "center", padding: "0", backdropFilter: "blur(2px)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 480, background: "#101216", borderRadius: "20px 20px 0 0", border: "1px solid rgba(255,255,255,0.1)", borderBottom: "none", padding: "22px 20px calc(24px + env(safe-area-inset-bottom))", boxShadow: "0 -20px 60px rgba(0,0,0,0.5)" }}>
        <div style={{ width: 40, height: 4, borderRadius: 999, background: "rgba(255,255,255,0.18)", margin: "0 auto 16px" }} />
        <p style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 800, color: "#fff" }}>Asenna työpöytä puhelimeen</p>
        <p style={{ margin: "0 0 18px", fontSize: 13, lineHeight: 1.5, color: "rgba(255,255,255,0.6)" }}>
          Selaimen ylä- ja alapalkit katoavat, ja työpöytä täyttää koko ruudun. Kuvake avaa juuri tämän näkymän — ei mitään muuta.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {steps.map((s, i) => (
            <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <span style={{ flexShrink: 0, width: 26, height: 26, borderRadius: 999, background: "rgba(124,224,166,0.16)", border: "1px solid rgba(124,224,166,0.4)", color: "#7CE0A6", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span>
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: "rgba(255,255,255,0.85)" }}>{s.text}</p>
            </div>
          ))}
        </div>
        {pwa.canPrompt && (
          <button onClick={() => { pwa.promptInstall(); onClose(); }} style={{ width: "100%", marginTop: 18, padding: "13px", borderRadius: 13, background: "#7CE0A6", color: "#06210f", border: "none", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: FONT }}>
            Asenna nyt
          </button>
        )}
        <button onClick={onClose} style={{ width: "100%", marginTop: 10, padding: "12px", borderRadius: 13, background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.12)", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: FONT }}>
          Jatka tästä selaimessa
        </button>
      </div>
    </div>
  );
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

/** Returns the right "add to home screen" instructions for the device. */
function installSteps(): { os: "ios" | "android" | "muu"; steps: string[] } {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/iPhone|iPad|iPod/i.test(ua)) {
    return { os: "ios", steps: ["Paina selaimen alapalkin Jaa-kuvaketta (neliö ja nuoli ⬆️).", "Valitse “Lisää Koti-valikkoon”.", "Vahvista “Lisää”. Kuvake ilmestyy kotinäytölle."] };
  }
  if (/Android/i.test(ua)) {
    return { os: "android", steps: ["Avaa selaimen valikko (kolme pistettä ⋮ oikeassa yläkulmassa).", "Valitse “Lisää aloitusnäyttöön” / “Asenna sovellus”.", "Vahvista. Kuvake ilmestyy kotinäytölle."] };
  }
  return { os: "muu", steps: ["Avaa selaimen valikko.", "Valitse “Lisää aloitusnäyttöön” tai “Asenna sovellus”."] };
}

/**
 * Phase-A onboarding for a worker opening their private link:
 *   1. Welcome (personalised photo + animation for some workers).
 *   2. "Add to home screen" tip, so the icon opens straight to this dashboard.
 * No password — the private link itself is the key. After this the dashboard
 * opens directly. Once signing is gated (WORKER_AGREEMENTS_GATED) the full sign
 * flow runs instead (see Dashboard).
 */
function QuickStart({ token, view, onDone }: { token: string; view: WorkerView; onDone: (v: WorkerView) => void }) {
  const [step, setStep] = useState<"welcome" | "install">("welcome");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [photoOk, setPhotoOk] = useState(true);
  const [savedView, setSavedView] = useState<WorkerView | null>(null);
  const personal = introFor(view.worker.name);
  const firstName = view.worker.name ? view.worker.name.split(" ")[0] : "";

  const enter = async () => {
    setBusy(true); setErr("");
    // No fields — record entry, keeping the name the host set; link is the key.
    const res = await api.crewOnboard(token, { agreements: [] });
    setBusy(false);
    if (res.ok && res.data?.view) { setSavedView(res.data.view); setStep("install"); }
    else setErr(res.error || "Avaaminen epäonnistui. Yritä uudelleen.");
  };

  const finish = () => onDone(savedView ?? view);

  // Staggered reveal: each element fades/rises once the ink reveal finishes.
  const rise = (i: number): React.CSSProperties => ({
    opacity: ready ? 1 : 0,
    transform: ready ? "translateY(0)" : "translateY(12px)",
    transition: `opacity .6s ease ${i * 0.12}s, transform .6s cubic-bezier(.2,.8,.2,1) ${i * 0.12}s`,
  });
  const card: React.CSSProperties = { width: "100%", maxWidth: 360, marginTop: 22, textAlign: "left" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "radial-gradient(120% 120% at 50% 0%, #14223a 0%, #0a0a0c 60%)", fontFamily: FONT, overflow: "auto" }}>
      <style>{`
        @keyframes pp-pop { 0%{opacity:0;transform:scale(.6)} 60%{opacity:1;transform:scale(1.06)} 100%{opacity:1;transform:scale(1)} }
        @keyframes pp-float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-7px)} }
        @keyframes pp-ring { to { transform: rotate(360deg) } }
      `}</style>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "32px 24px", zIndex: 3 }}>

        {step === "welcome" && (<>
          <p style={{ ...rise(0), color: "rgba(255,255,255,0.5)", fontSize: 13, letterSpacing: "0.18em", textTransform: "uppercase" }}>Puuhapatet</p>
          {personal && photoOk && (
            <div style={{ position: "relative", width: 132, height: 132, margin: "18px 0 6px", animation: ready ? "pp-float 5s ease-in-out infinite 1s" : "none" }}>
              <div style={{ position: "absolute", inset: -7, borderRadius: "50%", background: "conic-gradient(from 0deg, #7CE0A6, #4aa6ff, #b98bff, #7CE0A6)", filter: "blur(2px)", animation: ready ? "pp-ring 6s linear infinite" : "none", opacity: ready ? 0.9 : 0 }} />
              <img src={personal.photo} alt={firstName} onError={() => setPhotoOk(false)}
                style={{ position: "relative", width: 132, height: 132, borderRadius: "50%", objectFit: "cover", border: "3px solid rgba(10,10,12,1)", boxShadow: "0 10px 40px rgba(0,0,0,0.55)", animation: ready ? "pp-pop .8s cubic-bezier(.2,.9,.3,1.2) both" : "none", opacity: ready ? 1 : 0 }} />
            </div>
          )}
          <h1 style={{ ...rise(1), color: "#fff", fontSize: "clamp(28px, 7vw, 46px)", fontWeight: 800, margin: "10px 0", lineHeight: 1.1 }}>
            {personal ? personal.greeting : `Tervetuloa tiimiin${firstName ? `, ${firstName}` : ""}`}
          </h1>
          <p style={{ ...rise(2), color: "rgba(255,255,255,0.72)", maxWidth: 460, fontSize: 15.5, lineHeight: 1.65 }}>
            {personal ? personal.line : "Hienoa saada sinut mukaan. Tämä on ensimmäinen yhteinen keikkamme — pääset omalle työpöydällesi, jossa näet työsi ja edistymisesi reaaliajassa."}
          </p>
          <p style={{ ...rise(3), color: "rgba(255,255,255,0.42)", maxWidth: 440, fontSize: 12.5, lineHeight: 1.6, marginTop: 12 }}>
            Näytän seuraavaksi, miten lisäät työpöydän puhelimen kotinäytölle — sitten pääset suoraan töihin.
          </p>
          <div style={{ ...rise(4), width: "100%", maxWidth: 320, marginTop: 24, pointerEvents: ready ? "auto" : "none" }}>
            {err && <p style={{ color: "#FF9A9A", fontSize: 13, marginBottom: 8 }}>{err}</p>}
            <button onClick={enter} disabled={busy} style={{ ...primaryBtn, background: T.green, opacity: busy ? 0.6 : 1 }}>{busy ? "Avataan…" : "Aloita →"}</button>
          </div>
        </>)}

        {step === "install" && (() => {
          const ins = installSteps();
          return (<>
            <span style={{ fontSize: 40 }}>📲</span>
            <h1 style={{ color: "#fff", fontSize: "clamp(24px, 6vw, 34px)", fontWeight: 800, margin: "10px 0 8px" }}>Lisää työpöytä kotinäyttöön</h1>
            <p style={{ color: "rgba(255,255,255,0.65)", maxWidth: 400, fontSize: 14, lineHeight: 1.6 }}>
              Näin saat Puuhapatet-työpöydän omaksi kuvakkeeksi puhelimeen — se avautuu aina suoraan tähän näkymään.
            </p>
            <div style={{ ...card, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 14, padding: 16, marginTop: 18 }}>
              <p style={{ margin: "0 0 10px", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)" }}>
                {ins.os === "ios" ? "iPhone / iPad" : ins.os === "android" ? "Android" : "Ohjeet"}
              </p>
              {ins.steps.map((s, i) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 10 }}>
                  <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 999, background: "rgba(124,224,166,0.18)", border: "1px solid rgba(124,224,166,0.4)", color: "#7CE0A6", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span>
                  <span style={{ fontSize: 13.5, lineHeight: 1.5, color: "rgba(255,255,255,0.85)" }}>{s}</span>
                </div>
              ))}
            </div>
            <div style={{ width: "100%", maxWidth: 360, marginTop: 18 }}>
              <button onClick={finish} style={{ ...primaryBtn, background: T.green }}>Avaa työpöytä →</button>
              <button onClick={finish} style={{ ...primaryBtn, background: "transparent", border: "1px solid rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.7)", marginTop: 10 }}>Teen tämän myöhemmin</button>
            </div>
          </>);
        })()}
      </div>
      {step === "welcome" && <InkReveal maskColor={[10, 10, 12]} brushSize={150} fadeOutAfter={1300} fadeOutDuration={1000} onRevealed={() => setReady(true)} />}
    </div>
  );
}

// ─── PIN gate ───────────────────────────────────────────────────────────────

function PinGate({ token, view, onUnlock }: { token: string; view: WorkerView; onUnlock: () => void }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const firstName = view.worker.name ? view.worker.name.split(" ")[0] : "";
  const submit = async () => {
    if (!pin) return;
    setBusy(true); setErr("");
    const res = await api.crewAuth(token, pin);
    setBusy(false);
    if (res.ok && res.data?.ok) onUnlock();
    else setErr("Väärä salasana.");
  };
  return (
    <div style={{ position: "fixed", inset: 0, background: "radial-gradient(120% 120% at 50% 0%, #14223a 0%, #0a0a0c 60%)", fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 340, textAlign: "center" }}>
        <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, letterSpacing: "0.18em", textTransform: "uppercase" }}>Puuhapatet</p>
        <h1 style={{ color: "#fff", fontSize: 26, fontWeight: 800, margin: "8px 0 4px" }}>Tervetuloa takaisin{firstName ? `, ${firstName}` : ""}</h1>
        <p style={{ color: "rgba(255,255,255,0.6)", marginBottom: 22, fontSize: 14 }}>Syötä salasanasi avataksesi työpöydän.</p>
        <input
          value={pin} onChange={(e) => setPin(e.target.value)}
          type="password" placeholder="Salasana" autoFocus autoComplete="current-password"
          style={{ ...inputStyle, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.2)", color: "#fff", textAlign: "center", fontSize: 16 }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        {err && <p style={{ color: "#FF9A9A", fontSize: 13, marginTop: 8 }}>{err}</p>}
        <button onClick={submit} disabled={busy} style={{ ...primaryBtn, background: T.green, marginTop: 16, opacity: busy ? 0.6 : 1 }}>{busy ? "Avataan…" : "Avaa työpöytä →"}</button>
      </div>
    </div>
  );
}

// ─── Onboarding (intro + profile + agreements) ─────────────────────────────────

type Step = "intro" | "profile" | { agreementIndex: number } | "sign" | "pin" | "submitting";

function Onboarding({ token, view, onDone, resign }: { token: string; view: WorkerView; onDone: (v: WorkerView) => void; resign?: boolean }) {
  const required = ALL_AGREEMENTS.filter((a) => view.requiredAgreementIds.includes(a.id));
  const isTrainee = !!view.worker.trainee;
  // A trainee (harjoittelija) is unpaid & not an alihankkija: skip the billing /
  // insurance / risk fields and ask only the basics.
  const profileQuestions = isTrainee
    ? PROFILE_QUESTIONS.filter((q) => ["fullName", "phone", "email", "address"].includes(q.id))
    : PROFILE_QUESTIONS;
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
      version: view.agreementVersion || WORKER_AGREEMENT_VERSION,
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
            {isTrainee ? (
              <>Ennen kuin pääset omalle työpöydällesi, täytä lyhyt profiili ja allekirjoita työharjoittelusopimus. Olet harjoittelijana{view.worker.trainee ? ` ${view.worker.trainee.responsibleLeaderName}n` : ""} vastuulla — turvallisuus aina edellä.</>
            ) : (
              <>Ennen kuin pääset omalle työpöydällesi, täytä lyhyt profiili ja allekirjoita sopimukset.
              Tienaat <strong style={{ color: "#fff" }}>{euro(view.worker.perWindowCents)}</strong> jokaisesta pesemästäsi ikkunasta.</>
            )}
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
    const insurance = answers[INSURANCE_ANSWER_KEY] || "";
    const riskOk = answers[RISK_ACK_KEY] === "1";
    // Trainees skip the insurance/risk acknowledgement (their leader carries it).
    const canContinue = missing.length === 0 && (isTrainee || (!!insurance && riskOk));
    return (
      <Paper>
        <Wrap>
          <StepHeader
            title={resign ? "Täydennä tietosi" : "Profiilisi"}
            sub={isTrainee
              ? "Lue ja allekirjoita seuraavaksi työharjoittelusopimus. Täydennä ensin yhteystietosi."
              : resign ? "Sopimukset on nyt viimeistelty. Täydennä tiedot, lue ja allekirjoita — sen jälkeen voit jatkaa työtä." : "Näitä tietoja käytetään laskutukseen ja työvuorojen suunnitteluun."}
            n="1 / 3"
          />
          {profileQuestions.map((q) => (
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

          {/* Insurance status (can update later) + risk acknowledgement — alihankkija only */}
          {!isTrainee && (
          <div style={{ marginTop: 6, marginBottom: 14, padding: 14, borderRadius: 12, background: T.paper, border: `1px solid ${T.hair}` }}>
            <p style={{ ...fieldLabel, marginBottom: 8 }}>{INSURANCE_QUESTION} *</p>
            <div style={{ display: "flex", gap: 8 }}>
              {([["kylla", "Kyllä"], ["ei", "Ei vielä"]] as [string, string][]).map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setAnswer(INSURANCE_ANSWER_KEY, val)}
                  style={{
                    flex: 1, padding: "11px", borderRadius: 10, cursor: "pointer", fontFamily: FONT, fontSize: 14, fontWeight: 600,
                    border: `1.5px solid ${insurance === val ? T.green : T.hair}`,
                    background: insurance === val ? "rgba(62,124,89,0.10)" : "#fff",
                    color: insurance === val ? T.green : T.ink,
                  }}
                >
                  {insurance === val ? "✓ " : ""}{label}
                </button>
              ))}
            </div>
            <p style={{ fontSize: 11.5, color: T.muted, margin: "8px 0 0", lineHeight: 1.5 }}>{INSURANCE_LATER_NOTE}</p>
            <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 12, cursor: "pointer", fontSize: 13, lineHeight: 1.5 }}>
              <input type="checkbox" checked={riskOk} onChange={(e) => setAnswer(RISK_ACK_KEY, e.target.checked ? "1" : "")} style={{ marginTop: 3, width: 18, height: 18, flexShrink: 0 }} />
              <span>{RISK_ACK_TEXT}</span>
            </label>
          </div>
          )}

          <button
            disabled={!canContinue}
            onClick={() => setStep({ agreementIndex: 0 })}
            style={{ ...primaryBtn, opacity: canContinue ? 1 : 0.5, cursor: canContinue ? "pointer" : "not-allowed" }}
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

type Tab = "map" | "earnings" | "hours" | "payouts" | "notes" | "summary";

const NAV_ITEMS: [Tab, string][] = [
  ["map", "Kartta"],
  ["earnings", "Ansiot"],
  ["hours", "Tunnit"],
  ["payouts", "Maksut"],
  ["notes", "Info"],
  ["summary", "Kokonaisuus"],
];

/** Stroke icons for the bottom nav (inline so the dark worker theme stays self-contained). */
function NavIcon({ name, color }: { name: Tab; color: string }) {
  const p = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (name) {
    case "map":
      return <svg {...p}><path d="M9 20 3 17V4l6 3 6-3 6 3v13l-6-3-6 3Z" /><path d="M9 7v13M15 4v13" /></svg>;
    case "earnings":
      return <svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M14.5 9.3a3.6 3.6 0 1 0 0 5.4" /><path d="M7.5 11h5M7.5 13h4.5" /></svg>;
    case "hours":
      return <svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 1.8" /></svg>;
    case "payouts":
      return <svg {...p}><rect x="3" y="6" width="18" height="12.5" rx="2.5" /><path d="M3 10.5h18" /><path d="M16 14.5h2" /></svg>;
    case "notes":
      return <svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5" /><path d="M12 8h.01" /></svg>;
    case "summary":
      return <svg {...p}><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" /></svg>;
  }
}

function Dashboard({ token, view, setView, reload, onLogout }: { token: string; view: WorkerView; setView: (v: WorkerView) => void; reload: () => void; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>("map");
  const pwa = usePwaInstall();
  const [showInstall, setShowInstall] = useState(false);

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

  // Per-window observation (text + optional photo) the worker leaves on a window.
  const setObservation = useCallback(async (key: string, text: string, imageDataUrl?: string) => {
    const res = await api.crewSetWindowObservation(token, key, text, imageDataUrl);
    if (res.ok && res.data?.view) setView(res.data.view);
  }, [token, setView]);

  // Worker map notes — add a "huomio" / "tikkaat" marker, edit or delete own.
  const addNote = useCallback((floor: string, x: number, y: number, kind: string): void => {
    (async () => {
      const res = await api.crewAddMapNote(token, floor, x, y, kind);
      if (res.ok && res.data?.view) setView(res.data.view);
    })();
  }, [token, setView]);
  const updateNote = useCallback(async (floor: string, key: string, text: string) => {
    const res = await api.crewUpdateMapNote(token, floor, key, text);
    if (res.ok && res.data?.view) setView(res.data.view);
  }, [token, setView]);
  const deleteNote = useCallback(async (floor: string, key: string) => {
    const res = await api.crewDeleteMapNote(token, floor, key);
    if (res.ok && res.data?.view) setView(res.data.view);
  }, [token, setView]);

  const noop = useCallback(() => {}, []);

  return (
    <div className="fr8-root" style={{ position: "fixed", inset: 0, background: "#060607", color: "#fff", display: "flex", flexDirection: "column", fontFamily: FONT, overflow: "hidden", overscrollBehavior: "none", WebkitTapHighlightColor: "transparent", WebkitUserSelect: "none", userSelect: "none" }}>
      {/* Header */}
      <div style={{ flexShrink: 0, padding: "calc(12px + env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) 12px max(16px, env(safe-area-inset-left))", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <p style={{ margin: 0, fontWeight: 700, fontSize: 15 }}>{view.worker.name || "Työntekijä"}</p>
          <p style={{ margin: 0, fontSize: 11.5, color: "rgba(255,255,255,0.5)" }}>{view.building.name || "Puuhapatet"}{view.building.address ? ` · ${view.building.address}` : ""}</p>
          <button
            onClick={onLogout}
            style={{ marginTop: 3, alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.35)", fontSize: 10.5, fontFamily: FONT, padding: 0 }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
            Kirjaudu ulos
          </button>
        </div>
        <div style={{ textAlign: "right" }}>
          <p style={{ margin: 0, fontSize: 20, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: "#7CE0A6" }}>{euro(view.stats.earnedCents)}</p>
          <p style={{ margin: 0, fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{view.stats.washed} ikkunaa · {euro(view.worker.perWindowCents)}/kpl</p>
        </div>
      </div>

      {/* Install nudge — only when not yet running as an installed app */}
      <InstallBanner pwa={pwa} onOpen={() => setShowInstall(true)} />

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
            canAddNotes
            hideMoney
            washedBy={view.washedBy}
            keskenBy={view.keskenBy}
            workerNames={view.workerNames}
            currentWorkerId={view.worker.id}
            notes={view.notes}
            onAddNote={addNote}
            onUpdateNote={updateNote}
            onDeleteNote={deleteNote}
            observations={view.observations}
            canObserve
            onSetObservation={setObservation}
            activeZone={view.activeZone}
          />
        )}
        {tab === "earnings" && <EarningsTab view={view} />}
        {tab === "hours" && <HoursTab token={token} view={view} setView={setView} />}
        {tab === "payouts" && <PayoutsTab token={token} view={view} setView={setView} />}
        {tab === "notes" && <NotesTab token={token} view={view} setView={setView} />}
        {tab === "summary" && <SummaryTab view={view} />}
      </div>

      {/* Bottom nav — icons, active pill, mobile-friendly */}
      <div style={{ flexShrink: 0, display: "flex", justifyContent: "space-around", alignItems: "stretch", gap: 2, borderTop: "1px solid rgba(255,255,255,0.08)", background: "rgba(8,8,10,0.96)", backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)", padding: "8px 6px calc(8px + env(safe-area-inset-bottom))" }}>
        {NAV_ITEMS.map(([id, label]) => {
          const active = tab === id;
          const pending = id === "payouts" ? (view.payouts || []).filter((p) => p.status === "ilmoitettu").length : 0;
          return (
            <button
              key={id}
              onClick={() => { setTab(id); if (id !== "map") reload(); }}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              style={{ position: "relative", flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "8px 2px", background: "none", border: "none", cursor: "pointer", fontFamily: FONT, color: active ? "#fff" : "rgba(255,255,255,0.5)", transition: "color .2s" }}
            >
              <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 46, height: 30, borderRadius: 999, background: active ? "rgba(124,224,166,0.16)" : "transparent", transition: "background .2s" }}>
                <NavIcon name={id} color={active ? "#7CE0A6" : "rgba(255,255,255,0.55)"} />
                {pending > 0 && (
                  <span style={{ position: "absolute", top: 4, left: "calc(50% + 8px)", minWidth: 15, height: 15, padding: "0 4px", borderRadius: 999, background: "#E03B3B", color: "#fff", fontSize: 9.5, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", border: "1.5px solid #08080a" }}>{pending}</span>
                )}
              </span>
              <span style={{ fontSize: 10.5, fontWeight: active ? 700 : 500, letterSpacing: "0.01em", whiteSpace: "nowrap" }}>{label}</span>
            </button>
          );
        })}
      </div>

      {showInstall && <InstallModal pwa={pwa} onClose={() => setShowInstall(false)} />}
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
      <PaydateProgress total={view.windowsTotal} washed={view.windowsWashed} workerId={view.worker.id} />
      <Leaderboard view={view} />
      {!view.worker.trainee && <PathCard />}
      <InstallHint />
      <p style={{ marginTop: 20, fontSize: 12.5, color: "rgba(255,255,255,0.45)", lineHeight: 1.6 }}>
        {view.worker.trainee
          ? `Ansiosi päivittyy heti, kun merkitset ikkunan pestyksi kartalle. ${view.worker.trainee.responsibleLeaderName} hoitaa korvauksesi tiimin kautta — et laskuta itse.`
          : "Ansiosi päivittyy heti, kun merkitset ikkunan pestyksi kartalle. Laskutat kertyneen summan Puuhapatetilta oman Y-tunnuksesi kautta."}
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
  const pwa = usePwaInstall();
  const [open, setOpen] = useState(false);
  if (pwa.standalone) return null;
  return (
    <>
      <button onClick={() => setOpen(true)} style={{ width: "100%", marginTop: 14, padding: "12px 14px", borderRadius: 12, background: "rgba(124,224,166,0.08)", border: "1px solid rgba(124,224,166,0.22)", display: "flex", gap: 10, alignItems: "center", cursor: "pointer", fontFamily: FONT, textAlign: "left" }}>
        <span style={{ fontSize: 18, lineHeight: 1.2 }}>📲</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#fff" }}>Asenna koko ruudun sovellus</p>
          <p style={{ margin: "2px 0 0", fontSize: 12, lineHeight: 1.5, color: "rgba(255,255,255,0.55)" }}>
            Pois selaimen palkit — työpöytä täyttää ruudun. Näytä ohjeet →
          </p>
        </div>
      </button>
      {open && <InstallModal pwa={pwa} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Important work rules for this gig — which windows to wash, which to leave. */
function InfoNotice() {
  return (
    <div style={{ padding: 16, borderRadius: 16, background: "linear-gradient(155deg, rgba(255,180,90,0.12), rgba(255,255,255,0.03))", border: "1px solid rgba(255,180,90,0.28)", marginBottom: 14 }}>
      <p style={{ margin: "0 0 12px", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "#FFC56B" }}>⚠️ Tärkeää — lue ennen aloitusta</p>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 12 }}>
        <span style={{ flexShrink: 0, marginTop: 3, width: 14, height: 14, borderRadius: "50%", background: "rgb(255,140,178)", boxShadow: "0 0 8px rgba(255,140,178,0.7)" }} />
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: "rgba(255,255,255,0.85)" }}>
          <b>Pinkit pisteet (Prioriteetti 1) pestään ensin.</b> Aloita aina näistä — ne ovat sopimuksen mukaiset ikkunat.
        </p>
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <span style={{ flexShrink: 0, marginTop: 3, width: 14, height: 14, borderRadius: "50%", background: "rgb(240,226,150)", boxShadow: "0 0 8px rgba(240,226,150,0.7)" }} />
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: "rgba(255,255,255,0.85)" }}>
          <b>Keltaisiin ikkunoihin ei kosketa — niitä ei pestä.</b> Niistä ei ole vielä tehty sopimusta, joten jätä ne rauhaan.
        </p>
      </div>
    </div>
  );
}

/** Building access info — door code + who to call if there's a problem. */
const HELP_NUMBERS = ["+358 400 389 999", "+358 44 235 0881"];
const DOOR_CODE = "284284";
function AccessCard() {
  return (
    <div style={{ padding: 16, borderRadius: 16, background: "linear-gradient(155deg, rgba(124,180,255,0.12), rgba(255,255,255,0.03))", border: "1px solid rgba(124,180,255,0.25)", marginBottom: 18 }}>
      <p style={{ margin: "0 0 10px", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "#9cc4ff" }}>Pääsy rakennukseen</p>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 26 }}>🔑</span>
        <div>
          <p style={{ margin: 0, fontSize: 12, color: "rgba(255,255,255,0.55)" }}>Ovikoodi</p>
          <p style={{ margin: "1px 0 0", fontSize: 28, fontWeight: 800, letterSpacing: "0.12em", fontVariantNumeric: "tabular-nums", color: "#fff" }}>{DOOR_CODE}</p>
        </div>
      </div>
      <p style={{ margin: "14px 0 8px", fontSize: 12.5, color: "rgba(255,255,255,0.6)", lineHeight: 1.5 }}>
        Jos ovi ei aukea tai tulee muita ongelmia, soita:
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {HELP_NUMBERS.map((n) => (
          <a key={n} href={`tel:${n.replace(/\s/g, "")}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 13px", borderRadius: 11, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#fff", textDecoration: "none", fontSize: 15, fontWeight: 600 }}>
            <span style={{ fontSize: 16 }}>📞</span>
            <span style={{ flex: 1 }}>{n}</span>
            <span style={{ fontSize: 12, color: "#9cc4ff", fontWeight: 600 }}>Soita</span>
          </a>
        ))}
      </div>
    </div>
  );
}

/** Shared "paydate progress" — how far the team is toward the next payment
 *  milestone (the gig is billed/paid in PAY_PERIODS instalments). Window counts
 *  only; 1575 € per period shown only to joonatan/matias. */
function PaydateProgress({ total, washed, workerId }: { total: number; washed: number; workerId?: string }) {
  const p = computePayProgress(total, washed);
  if (p.total <= 0) return null;
  const showEuro = workerId === "joonatan" || workerId === "matias";
  return (
    <div style={{ marginTop: 26, padding: 16, borderRadius: 16, background: "linear-gradient(155deg, rgba(124,224,166,0.10), rgba(255,255,255,0.03))", border: "1px solid rgba(124,224,166,0.22)" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
        <p style={{ margin: 0, fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "#7CE0A6" }}>
          Maksuerä {p.currentPeriod}/{p.periods}{showEuro ? " · 1 575 €" : ""}
        </p>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", fontVariantNumeric: "tabular-nums" }}>{p.washed}/{p.total} ikkunaa</span>
      </div>
      <div style={{ position: "relative", height: 12, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, width: `${Math.round(p.pct * 100)}%`, background: "linear-gradient(90deg,#5fe08a,#7CE0A6)", borderRadius: 999, transition: "width .5s ease" }} />
      </div>
      <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "rgba(255,255,255,0.65)", lineHeight: 1.5 }}>
        {p.done
          ? "Koko keikka pesty — huikeaa työtä! 🎉"
          : <>Vielä <b style={{ color: "#fff" }}>{p.toNext} ikkunaa</b> seuraavaan maksuun · {p.inPeriod}/{p.perPeriod} tässä erässä</>}
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

/** Payouts (Puuhapatet → you). Approve the amount + confirm billing details;
 *  Puuhapatet then pays manually and your invoice is generated automatically. */
function PayoutsTab({ token, view, setView }: { token: string; view: WorkerView; setView: (v: WorkerView) => void }) {
  const payouts = view.payouts || [];
  const b = view.worker.billing;
  const answers = view.worker.profile?.answers;
  const vatStatus = readVatStatus(answers);
  const inRegister = readInPrepaymentRegister(answers);
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

  const trainee = view.worker.trainee;
  return (
    <div style={{ height: "100%", overflowY: "auto", padding: 20 }}>
      <p style={{ margin: "0 0 4px", fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)" }}>Maksut sinulle</p>
      {trainee ? (
        <p style={{ margin: "0 0 18px", fontSize: 13, color: "rgba(255,255,255,0.55)", lineHeight: 1.6 }}>
          Olet harjoittelija — {trainee.responsibleLeaderName} hoitaa korvauksesi tiimin kautta.
          Et laskuta itse etkä tarvitse omaa Y-tunnusta. Näet täällä tehdyn työsi.
        </p>
      ) : (
        <p style={{ margin: "0 0 18px", fontSize: 13, color: "rgba(255,255,255,0.55)", lineHeight: 1.6 }}>
          Puuhapatet maksaa työstäsi. Hyväksy summa ja vahvista laskutustietosi — maksu tehdään tilillesi,
          ja sinun laskusi Puuhapatetille luodaan automaattisesti.
        </p>
      )}

      {payouts.length === 0 && (
        <div style={{ padding: 18, borderRadius: 12, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.6)", fontSize: 13.5, textAlign: "center" }}>
          Ei vielä maksuja. Näet täällä maksuilmoitukset, kun ne luodaan.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {payouts.map((p) => {
          const st = STATUS[p.status] || STATUS.ilmoitettu;
          const open = openId === p.id;
          // Paid payouts carry a tax snapshot; for pending ones preview from the
          // worker's current declared status so they see what they'll receive.
          const tx = p.tax ?? computeTax({ laborCents: p.amountCents, vatStatus, inPrepaymentRegister: inRegister });
          const showBreakdown = tx.vatRegistered || tx.withheld;
          return (
            <div key={p.id} style={{ padding: 16, borderRadius: 14, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <div>
                  <p style={{ margin: 0, fontSize: 24, fontWeight: 800, color: "#7CE0A6", fontVariantNumeric: "tabular-nums" }}>{euro(tx.payableCents)}</p>
                  <p style={{ margin: "2px 0 0", fontSize: 12.5, color: "rgba(255,255,255,0.55)" }}>
                    {p.note || "Ikkunanpesutyö"}{p.windows ? ` · ${p.windows} ikkunaa` : ""}
                  </p>
                  {p.buyer?.name && (
                    <p style={{ margin: "2px 0 0", fontSize: 11.5, color: "rgba(255,255,255,0.4)" }}>Laskutat: {p.buyer.name}{p.buyer.yTunnus ? ` · ${p.buyer.yTunnus}` : ""}</p>
                  )}
                </div>
                <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, color: st.color, background: st.bg, borderRadius: 999, padding: "5px 10px", whiteSpace: "nowrap" }}>{st.label}</span>
              </div>

              {showBreakdown && (
                <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 10, background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.06)", fontSize: 12.5 }}>
                  {([
                    ["Työkorvaus (veroton)", fmtEurCents(tx.laborCents), "rgba(255,255,255,0.7)"],
                    ...(tx.vatRegistered ? [[`ALV ${fmtPct(tx.vatRate)}`, "+ " + fmtEurCents(tx.vatCents), "rgba(255,255,255,0.7)"]] : []),
                    ...(tx.withheld ? [[`Ennakonpidätys ${fmtPct(tx.withholdingRate)}`, "− " + fmtEurCents(tx.withholdingCents), "#E0A800"]] : []),
                  ] as [string, string, string][]).map(([lbl, val, col]) => (
                    <div key={lbl} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", color: col }}>
                      <span>{lbl}</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{val}</span>
                    </div>
                  ))}
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0 0", marginTop: 4, borderTop: "1px solid rgba(255,255,255,0.1)", fontWeight: 700, color: "#7CE0A6" }}>
                    <span>Maksetaan tilillesi</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{fmtEurCents(tx.payableCents)}</span>
                  </div>
                  {tx.withheld && (
                    <p style={{ margin: "8px 0 0", fontSize: 11, color: "rgba(255,255,255,0.45)", lineHeight: 1.5 }}>
                      Pidätetty vero tilitetään Verolle ja luetaan hyväksesi verotuksessasi. Rekisteröitymällä
                      ennakkoperintärekisteriin (ytj.fi) saat koko summan ja hoidat verot itse.
                    </p>
                  )}
                </div>
              )}

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

function fmtDuration(min: number) {
  const h = Math.floor(min / 60), mm = Math.round(min % 60);
  return h > 0 ? `${h} t ${mm} min` : `${mm} min`;
}

function HoursTab({ token, view, setView }: { token: string; view: WorkerView; setView: (v: WorkerView) => void }) {
  // Resume a running shift from the server (so it survives reload / reopen).
  const [running, setRunning] = useState<number | null>(view.worker.activeShiftAt ?? null);
  const [breakMs, setBreakMs] = useState(0);          // accumulated break time this shift
  const [onBreak, setOnBreak] = useState<number | null>(null); // break start ms, if paused
  const [tickNow, setTickNow] = useState(Date.now());
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  const [recap, setRecap] = useState<WorkerView["worker"]["sessions"][number] | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (running) {
      tick.current = setInterval(() => setTickNow(Date.now()), 1000);
      return () => { if (tick.current) clearInterval(tick.current); };
    }
  }, [running]);

  // Worked time = elapsed − breaks (pauses while on break).
  const workedMs = running ? Math.max(0, tickNow - running - breakMs - (onBreak ? tickNow - onBreak : 0)) : 0;
  // Windows washed during this session (live).
  const sessionWindows = running ? Math.max(0, view.stats.washed - (view.worker.shiftStartWashed ?? view.stats.washed)) : 0;
  const sessionEarnedCents = sessionWindows * view.worker.perWindowCents;

  const start = async () => {
    setRunning(Date.now()); setBreakMs(0); setOnBreak(null); setTickNow(Date.now());
    const res = await api.crewShift(token, true);
    if (res.ok && res.data?.view) setView(res.data.view);
  };

  const toggleBreak = () => {
    if (onBreak) { setBreakMs((b) => b + (Date.now() - onBreak)); setOnBreak(null); }
    else setOnBreak(Date.now());
  };

  const endDay = async () => {
    if (!running || busy) return;
    setBusy(true);
    const totalBreak = breakMs + (onBreak ? Date.now() - onBreak : 0);
    const minutes = Math.max(0, Math.round((Date.now() - running - totalBreak) / 60000));
    const hours = Math.round((minutes / 60) * 100) / 100;
    if (hours > 0) await api.crewAddHours(token, hours);            // hours ledger
    const res = await api.crewShift(token, false, minutes);          // record session
    setBusy(false); setRunning(null); setOnBreak(null); setBreakMs(0);
    if (res.ok && res.data?.view) {
      setView(res.data.view);
      setRecap(res.data.view.worker.sessions[0] ?? null);           // newest-first → recap
    }
  };

  const addManual = async () => {
    const h = parseFloat(manual.replace(",", "."));
    if (!Number.isFinite(h) || h <= 0 || busy) return;
    setBusy(true);
    const res = await api.crewManualShift(token, Math.round(h * 100) / 100);
    setBusy(false);
    if (res.ok && res.data?.view) {
      setView(res.data.view);
      setManual("");
      setRecap(res.data.view.worker.sessions[0] ?? null); // show the logged day
    }
  };

  const mmss = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };
  const dayMonth = (ts: number) => new Date(ts).toLocaleDateString("fi-FI", { day: "numeric", month: "numeric" });

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: 20 }}>
      <div style={{ textAlign: "center", padding: "16px 0 6px" }}>
        <p style={{ margin: 0, fontSize: 40, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: onBreak ? "#E0A800" : running ? "#7CE0A6" : "#fff" }}>{mmss(workedMs)}</p>
        {running && (
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "rgba(255,255,255,0.6)" }}>
            {onBreak ? "Tauolla" : "Vuoro käynnissä"} · {sessionWindows} ikkunaa · {euro(sessionEarnedCents)}
          </p>
        )}
        {!running ? (
          <button onClick={start} style={{ ...primaryBtn, width: "auto", padding: "13px 36px", background: T.green, marginTop: 12 }}>Aloita vuoro</button>
        ) : (
          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 14, flexWrap: "wrap" }}>
            <button onClick={toggleBreak} style={{ ...secondaryBtn, color: "#fff", border: "1px solid rgba(255,255,255,0.25)", background: onBreak ? "rgba(224,168,0,0.15)" : "transparent" }}>
              {onBreak ? "Jatka työtä" : "Tauko"}
            </button>
            <button onClick={endDay} disabled={busy} style={{ ...primaryBtn, width: "auto", padding: "13px 28px", background: "#D9472B", opacity: busy ? 0.6 : 1 }}>
              {busy ? "Päätetään…" : "Päätä päivä"}
            </button>
          </div>
        )}
        <p style={{ color: "rgba(255,255,255,0.45)", fontSize: 12, marginTop: 12, lineHeight: 1.5 }}>
          Aloita kun saavut työmaalle. Pidä tauko ruokatauon ajaksi — tauot eivät kerrytä tunteja. "Päätä päivä" kokoaa yhteenvedon.
        </p>
      </div>

      <div style={{ marginTop: 6 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input value={manual} onChange={(e) => setManual(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addManual()} placeholder="Kirjaa työpäivä käsin (esim. 2,5 h)" inputMode="decimal" style={{ ...inputStyle, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", color: "#fff" }} />
          <button onClick={addManual} disabled={busy} style={{ ...secondaryBtn, color: "#fff", border: "1px solid rgba(255,255,255,0.2)", whiteSpace: "nowrap", opacity: busy ? 0.6 : 1 }}>Kirjaa</button>
        </div>
        <p style={{ margin: "6px 0 0", fontSize: 11.5, color: "rgba(255,255,255,0.4)", lineHeight: 1.5 }}>
          Unohtuiko vuoron aloitus? Kirjaa tehdyt tunnit käsin — päivä tallentuu päiväkirjaan.
        </p>
      </div>

      <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Stat label="Tunteja yhteensä" value={view.stats.hours.toLocaleString("fi-FI", { maximumFractionDigits: 1 })} />
        <Stat label="€ / tunti" value={view.stats.hours > 0 ? euro(Math.round(view.stats.eurPerHour * 100)) : "—"} />
      </div>

      {/* Session log */}
      {view.worker.sessions.length > 0 && (
        <div style={{ marginTop: 26 }}>
          <p style={{ margin: "0 0 10px", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)" }}>Päiväkirja</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {view.worker.sessions.map((s, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div>
                  <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600 }}>{dayMonth(s.end)}</p>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{s.manual ? `Käsin kirjattu · ${fmtDuration(s.minutes)}` : `${s.windows} ikkunaa · ${fmtDuration(s.minutes)}`}</p>
                </div>
                {s.manual
                  ? <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.55)", fontVariantNumeric: "tabular-nums" }}>{fmtDuration(s.minutes)}</span>
                  : <span style={{ fontSize: 15, fontWeight: 700, color: "#7CE0A6", fontVariantNumeric: "tabular-nums" }}>{euro(s.earnedCents)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* End-of-day recap */}
      {recap && (
        <div onClick={() => setRecap(null)} style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 340, background: "#0f1216", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 18, padding: 24, textAlign: "center" }}>
            <div style={{ fontSize: 40 }}>{recap.manual ? "📝" : "🎉"}</div>
            <h2 style={{ margin: "8px 0 2px", fontSize: 22, fontWeight: 800, color: "#fff" }}>{recap.manual ? "Päivä kirjattu" : "Hyvää työtä!"}</h2>
            <p style={{ margin: "0 0 18px", fontSize: 13.5, color: "rgba(255,255,255,0.6)" }}>{recap.manual ? "Käsin kirjattu työpäivä" : "Päivän yhteenveto"}</p>
            {recap.manual ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10, marginBottom: 16 }}>
                <Stat label="Kesto" value={fmtDuration(recap.minutes)} />
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
                <Stat label="Ikkunaa" value={String(recap.windows)} />
                <Stat label="Ansio" value={euro(recap.earnedCents)} />
                <Stat label="Kesto" value={fmtDuration(recap.minutes)} />
                <Stat label="€ / tunti" value={recap.minutes > 0 ? euro(Math.round((recap.earnedCents / (recap.minutes / 60)))) : "—"} />
              </div>
            )}
            <button onClick={() => setRecap(null)} style={{ ...primaryBtn, background: T.green }}>Valmis</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Update insurance status later, once the worker has obtained the policies. */
function InsuranceCard({ token, view, setView }: { token: string; view: WorkerView; setView: (v: WorkerView) => void }) {
  const profile = view.worker.profile;
  const current = (profile?.answers?.[INSURANCE_ANSWER_KEY] as string) || "";
  const [busy, setBusy] = useState(false);
  const valid = current === "kylla";

  const setStatus = async (val: string) => {
    if (busy || val === current) return;
    setBusy(true);
    const merged = { ...(profile ?? {}), answers: { ...(profile?.answers ?? {}), [INSURANCE_ANSWER_KEY]: val } };
    const res = await api.crewOnboard(token, { profile: merged, agreements: [] });
    setBusy(false);
    if (res.ok && res.data?.view) setView(res.data.view);
  };

  return (
    <div style={{ padding: 16, borderRadius: 16, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", marginBottom: 14 }}>
      <p style={{ margin: "0 0 4px", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)" }}>Vakuutukset</p>
      <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "rgba(255,255,255,0.6)", lineHeight: 1.5 }}>
        {valid
          ? "Olet ilmoittanut vakuutukset voimassa oleviksi."
          : "Vakuutuksia ei ole vielä merkitty voimassa oleviksi. Voit päivittää tiedon tästä, kun hankit ne."}
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        {([["kylla", "Voimassa"], ["ei", "Ei vielä"]] as [string, string][]).map(([val, label]) => (
          <button key={val} onClick={() => setStatus(val)} disabled={busy}
            style={{ flex: 1, padding: "10px", borderRadius: 10, cursor: "pointer", fontFamily: FONT, fontSize: 13.5, fontWeight: 600,
              border: `1.5px solid ${current === val ? "#7CE0A6" : "rgba(255,255,255,0.18)"}`,
              background: current === val ? "rgba(124,224,166,0.14)" : "transparent",
              color: current === val ? "#7CE0A6" : "rgba(255,255,255,0.7)", opacity: busy ? 0.6 : 1 }}>
            {current === val ? "✓ " : ""}{label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Tax status the worker self-declares — drives VAT on their invoice and whether
 *  Puuhapatet must withhold ennakonpidätys (not in the prepayment register). */
function TaxStatusCard({ token, view, setView }: { token: string; view: WorkerView; setView: (v: WorkerView) => void }) {
  const answers = view.worker.profile?.answers;
  const vat = readVatStatus(answers);
  const inRegister = readInPrepaymentRegister(answers);
  const declaredRegister = answers?.[PREPAYMENT_REGISTER_KEY] === "kylla" || answers?.[PREPAYMENT_REGISTER_KEY] === "ei";
  const [busy, setBusy] = useState(false);

  const save = async (key: string, val: string) => {
    if (busy) return;
    setBusy(true);
    const profile = view.worker.profile ?? {};
    const merged = { ...profile, answers: { ...(profile.answers ?? {}), [key]: val } };
    const res = await api.crewOnboard(token, { profile: merged, agreements: [] });
    setBusy(false);
    if (res.ok && res.data?.view) setView(res.data.view);
  };

  const opt = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: "10px", borderRadius: 10, cursor: busy ? "default" : "pointer", fontFamily: FONT,
    fontSize: 13, fontWeight: 600, lineHeight: 1.3,
    border: `1.5px solid ${active ? "#7CE0A6" : "rgba(255,255,255,0.18)"}`,
    background: active ? "rgba(124,224,166,0.14)" : "transparent",
    color: active ? "#7CE0A6" : "rgba(255,255,255,0.7)", opacity: busy ? 0.6 : 1,
  });

  return (
    <div style={{ padding: 16, borderRadius: 16, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", marginBottom: 14 }}>
      <p style={{ margin: "0 0 4px", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)" }}>Verotiedot</p>
      <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "rgba(255,255,255,0.6)", lineHeight: 1.5 }}>
        Nämä määräävät, miten laskusi muodostuu. Vaikuttavat ALV:hen ja ennakonpidätykseen.
      </p>

      {/* ALV-status */}
      <p style={{ margin: "0 0 6px", fontSize: 12.5, fontWeight: 600, color: "rgba(255,255,255,0.85)" }}>Arvonlisävero (ALV)</p>
      <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
        <button onClick={() => save(VAT_STATUS_KEY, "vahainen_toiminta")} disabled={busy} style={opt(vat === "vahainen_toiminta")}>Ei ALV:tä<br/><span style={{ fontWeight: 400, fontSize: 11, opacity: 0.85 }}>vähäinen toiminta</span></button>
        <button onClick={() => save(VAT_STATUS_KEY, "alv_rekisterissa")} disabled={busy} style={opt(vat === "alv_rekisterissa")}>ALV-rekisterissä<br/><span style={{ fontWeight: 400, fontSize: 11, opacity: 0.85 }}>lisää 25,5 %</span></button>
      </div>
      <p style={{ margin: "0 0 14px", fontSize: 11.5, color: "rgba(255,255,255,0.4)", lineHeight: 1.5 }}>
        Jos liikevaihtosi on alle ~15 000 € / 12 kk, voit toimia ilman ALV:tä (AVL 3 §). Tarkista vero.fi.
      </p>

      {/* Ennakkoperintärekisteri */}
      <p style={{ margin: "0 0 6px", fontSize: 12.5, fontWeight: 600, color: "rgba(255,255,255,0.85)" }}>Ennakkoperintärekisteri</p>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => save(PREPAYMENT_REGISTER_KEY, "kylla")} disabled={busy} style={opt(inRegister)}>Kyllä, olen</button>
        <button onClick={() => save(PREPAYMENT_REGISTER_KEY, "ei")} disabled={busy} style={opt(declaredRegister && !inRegister)}>En / en tiedä</button>
      </div>
      {!inRegister && (
        <p style={{ margin: "10px 0 0", fontSize: 11.5, color: "#E0A800", lineHeight: 1.55 }}>
          ⚠️ Jos et ole ennakkoperintärekisterissä, Puuhapatetin on pidätettävä verosi maksusta (oletus 60 %).
          Rekisteröidy maksutta osoitteessa <b>ytj.fi</b> — silloin saat koko summan ja hoidat verot itse.
        </p>
      )}
    </div>
  );
}

/** Trainee status — shown instead of the alihankkija tax/insurance cards.
 *  A trainee works under a leader's responsibility: no own Y-tunnus, no
 *  self-invoicing, earnings handled by the team. */
function TraineeCard({ leader }: { leader: string }) {
  return (
    <div style={{ padding: 16, borderRadius: 16, background: "linear-gradient(155deg, rgba(124,180,255,0.12), rgba(255,255,255,0.03))", border: "1px solid rgba(124,180,255,0.25)", marginBottom: 14 }}>
      <p style={{ margin: "0 0 4px", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "#9cc4ff" }}>Harjoittelija</p>
      <p style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 700, color: "#fff" }}>Olet harjoittelija — {leader} vastaa sinusta</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {[
          `Teet keikkaa ${leader}n vastuulla. Et toimi itsenäisenä alihankkijana.`,
          "Et tarvitse omaa Y-tunnusta etkä laskuta itse — korvauksesi hoidetaan tiimin kautta.",
          "Keskity hyvään ja turvalliseen työhön. Kysy aina, jos jokin on epäselvää.",
        ].map((t, i) => (
          <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <span style={{ flexShrink: 0, marginTop: 6, width: 6, height: 6, borderRadius: "50%", background: "#9cc4ff" }} />
            <span style={{ fontSize: 13, lineHeight: 1.55, color: "rgba(255,255,255,0.8)" }}>{t}</span>
          </div>
        ))}
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
  const trainee = view.worker.trainee;
  return (
    <div style={{ height: "100%", overflowY: "auto", padding: 20 }}>
      <InfoNotice />
      {/* Trainees work under a leader's responsibility — they see a simple status
          note instead of the alihankkija tax/insurance self-liability cards. */}
      {trainee ? (
        <TraineeCard leader={trainee.responsibleLeaderName} />
      ) : (
        <>
          <InsuranceCard token={token} view={view} setView={setView} />
          <TaxStatusCard token={token} view={view} setView={setView} />
        </>
      )}
      <AccessCard />
      <p style={{ margin: "4px 0 10px", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)" }}>Omat muistiinpanot</p>
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

function SummaryTab({ view }: { view: WorkerView }) {
  const { redTotal, redWashed, myRedWashed } = useMemo(() => {
    let redTotal = 0;
    let redWashed = 0;
    let myRedWashed = 0;
    const floors = view.building.floors;
    for (const f of floors) {
      const seeded = view.marks[f]?.marks ?? [];
      const custom = view.customMarks[f] ?? [];
      const allMarks = [
        ...seeded.map((mk, idx) => ({ key: `${f}#${idx}`, p: mk.p })),
        ...custom.map((cm) => ({ key: cm.key, p: cm.p })),
      ].filter(({ key }) => !view.deleted[key]);
      for (const { key, p } of allMarks) {
        if (p !== 1) continue;
        redTotal++;
        const status = view.statuses[key] ?? "ei";
        if (status === "pesty") {
          redWashed++;
          if (view.washedBy[key] === view.worker.id) myRedWashed++;
        }
      }
    }
    return { redTotal, redWashed, myRedWashed };
  }, [view]);

  const pct = redTotal > 0 ? (redWashed / redTotal) * 100 : 0;
  const myEarnedCents = myRedWashed * view.worker.perWindowCents;

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: 20 }}>
      <p style={{ margin: "0 0 20px", fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(255,255,255,0.4)" }}>Kokonaisuus</p>

      {/* Red window progress */}
      <div style={{ padding: 20, borderRadius: 16, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", marginBottom: 16 }}>
        <p style={{ margin: "0 0 4px", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,72,72,0.8)" }}>Punaiset ikkunat (P1)</p>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "8px 0 14px" }}>
          <span style={{ fontSize: 40, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: "#fff" }}>{redWashed}</span>
          <span style={{ fontSize: 22, color: "rgba(255,255,255,0.35)", fontWeight: 500 }}>/ {redTotal}</span>
          <span style={{ marginLeft: "auto", fontSize: 28, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "rgb(255,72,72)" }}>{Math.round(pct)} %</span>
        </div>
        <div style={{ position: "relative", height: 10, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, right: `${100 - pct}%`, background: "linear-gradient(90deg, rgb(255,72,72), rgb(255,120,90))", borderRadius: 999, transition: "right 0.6s ease" }} />
        </div>
        <p style={{ margin: "8px 0 0", fontSize: 12, color: "rgba(255,255,255,0.4)" }}>{redTotal - redWashed} jäljellä</p>
      </div>

      {/* Worker's own contribution */}
      <div style={{ padding: 20, borderRadius: 16, background: "linear-gradient(155deg, rgba(124,224,166,0.10), rgba(255,255,255,0.03))", border: "1px solid rgba(124,224,166,0.22)", marginBottom: 16 }}>
        <p style={{ margin: "0 0 4px", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "#7CE0A6" }}>Oma osuus punaisia</p>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "8px 0 4px" }}>
          <span style={{ fontSize: 36, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: "#7CE0A6" }}>{myRedWashed}</span>
          <span style={{ fontSize: 16, color: "rgba(255,255,255,0.45)" }}>kpl</span>
        </div>
        <p style={{ margin: "6px 0 0", fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{myRedWashed} × {euro(view.worker.perWindowCents)} = <strong style={{ color: "#7CE0A6", fontWeight: 700 }}>{euro(myEarnedCents)}</strong></p>
      </div>
    </div>
  );
}

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
