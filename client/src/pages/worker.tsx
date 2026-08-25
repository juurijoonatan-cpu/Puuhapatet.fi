/**
 * Worker dashboard — a custom-gig worker's private, link-gated view.
 *
 * Reached at /tyo/:token (the worker's private link). Flow:
 *   1. InkReveal intro + onboarding gate: profile questionnaire + signing each
 *      required agreement (alihankkija etc.) — "the intro is the signing".
 *      Until done, the dashboard stays closed. No PINs or extra codes: the
 *      personal link is the only key.
 *   2. Dashboard tabs: Kartta (mark your windows), Ansiot (live €), Tunnit
 *      (timer), Muistiinpanot (notes).
 *
 * Workers are paid €/window (their own rate) and NEVER see the gig price or cap.
 * Built mobile-first; works on phone and laptop.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRoute } from "wouter";
import { api, warmBackend, type WorkerView, type GuidedWorkerView } from "@/lib/api";
import type { WindowStatus, LampStatus, LampCondition, DoorStatus } from "@shared/project";
import {
  ALL_AGREEMENTS, PROFILE_QUESTIONS, PROFILE_REQUIRED_IDS, WORKER_AGREEMENT_VERSION,
  INSURANCE_QUESTION, INSURANCE_LATER_NOTE, RISK_ACK_TEXT, INSURANCE_ANSWER_KEY, RISK_ACK_KEY,
  YTUNNUS_STATUS_KEY,
  type WorkerAgreement,
} from "@shared/worker-agreements";
import InkReveal from "@/components/InkReveal";
import { Shine } from "@/components/animate-ui/primitives/effects/shine";
import SignaturePad from "@/components/SignaturePad";
import FloorView from "@/components/fr8/FloorView";
import { useEaseTo } from "@/hooks/use-ease-to";
import LoadingOrb from "@/components/LoadingOrb";
import {
  computeTax, readVatStatus, readInPrepaymentRegister, readPayeeType, fmtPct, fmtEurCents,
  VAT_STATUS_KEY, PREPAYMENT_REGISTER_KEY, type VatStatus,
} from "@shared/tax";
import { computePayProgress } from "@shared/payprogress";
import { MAX_PHOTO_DATAURL_LEN, MAX_PAYOUT_RECEIPT_LEN } from "@shared/crew";
import { BRAND_BILLERS } from "@shared/billers";
import { FOUNDER_IDS } from "@shared/team";
import { isValidYTunnus } from "@shared/y-tunnus";
// Sama dokumenttirakentaja jota johtajan Tiimi-sivu käyttää — molemmat
// osapuolet saavat tismalleen saman tiedoston, ei kahta eri totuutta.
import { downloadWorkerContract, openWorkerContractForPrint } from "@/lib/worker-contract-doc";

const T = { ink: "#1A1A1A", paper: "#F6F4EE", card: "#FFFFFF", hair: "#E4E1D7", muted: "#8C8A82", green: "#3E7C59", navy: "#1F3B57" };
const FONT = "'Poppins', ui-sans-serif, system-ui, -apple-system, sans-serif";

function euro(cents: number) {
  return (cents / 100).toLocaleString("fi-FI", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + " €";
}

/** Ikkunamäärä. Kahdestaan pesty ikkuna on 0,5 kummallekin, joten desimaali on
 *  todellinen — mutta vain silloin kun sellainen on, ei "12,0". */
function fmtWindows(n: number): string {
  return n.toLocaleString("fi-FI", { maximumFractionDigits: 1 });
}

export default function WorkerPage() {
  const [, params] = useRoute("/tyo/:token");
  const token = params?.token ?? "";
  const [view, setView] = useState<WorkerView | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  // Distinguishes a transient connection problem (worth retrying — the Render
  // free tier can take ~50s to wake) from a genuinely missing/expired link.
  const [loadErr, setLoadErr] = useState<string | null>(null);

  // Wake the (possibly sleeping) backend the instant the page opens, so the
  // worker's first real request isn't the one paying the cold-start penalty —
  // this is the main cause of the app appearing to "jam" on open.
  useEffect(() => { warmBackend(); }, []);

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
    setStatus("loading");
    setLoadErr(null);
    // One automatic retry: a cold start or a dropped mobile connection usually
    // recovers on the second try, so the worker rarely has to tap "retry".
    // (LoadingOrb itself explains a slow cold start with staged copy.)
    let res = await api.getCrewView(token);
    if (!res.ok) res = await api.getCrewView(token);
    if (res.ok && res.data?.view) {
      setView(res.data.view);
      setStatus("ok");
    } else {
      setLoadErr(res.error ?? null);
      setStatus("error");
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // Sign out — the link is personal, so leaving the page is all there is to it.
  const logout = useCallback(() => {
    window.location.href = "/";
  }, []);

  if (status === "loading") {
    return <LoadingOrb label="Ladataan työpöytää" theme="light" />;
  }
  if (status === "error" || !view) {
    // A timeout / network error is transient (offer retry); anything else is
    // most likely a wrong or expired link.
    const transient = !loadErr || /aikakatkais|network|verkko|failed|fetch/i.test(loadErr);
    return (
      <Centered>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, maxWidth: 320 }}>
          <p style={{ margin: 0, fontSize: 14.5, color: T.ink, fontWeight: 600 }}>
            {transient ? "Yhteys ei juuri nyt onnistunut" : "Linkkiä ei löytynyt tai se on vanhentunut."}
          </p>
          {transient && (
            <p style={{ margin: 0, fontSize: 13, color: T.muted, lineHeight: 1.5 }}>
              Tarkista verkkoyhteys ja yritä uudelleen. Palvelin saattaa juuri herätä lepotilasta.
            </p>
          )}
          {transient && (
            <button onClick={() => load()} style={{ ...primaryBtn, width: "auto", padding: "11px 28px" }}>
              Yritä uudelleen
            </button>
          )}
        </div>
      </Centered>
    );
  }
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
 *  client/public/fr8/ (e.g. jani.jpg). Match is by first name, case-insensitive.
 *  Optional flair: `tagline` (small kicker above the title) and `accent` (drives
 *  the glow/CTA tint) let a single worker's welcome stand out from the default. */
type WorkerIntro = {
  photo: string;
  greeting: string;
  line: string;
  tagline?: string;
  accent?: string;
};
const WORKER_INTROS: Record<string, WorkerIntro> = {
  jani: {
    photo: "/fr8/jani.jpg",
    greeting: "Tervetuloa, Jani 👋",
    line: "Mahtavaa saada sut mukaan ekalle keikalle. Tehdään tästä yhdessä siistiä jälkeä — työpöytäsi odottaa.",
  },
  oona: {
    photo: "/fr8/oona.jpg",
    tagline: "Uusi tekijä · FR8",
    greeting: "Tervetuloa tiimiin, Oona ✨",
    line: "Tosi kiva että lähdit mukaan — ja heti meidän isoimmalle keikalle! Tää on sun oma työpöytä: täältä näät oman duunisi etenevän pitkin päivää. Otetaan rennosti ja tehdään yhdessä hyvää jälkeä. Nähdään keikalla! 🚀",
    accent: "#7CE0A6",
  },
  // Doma — kokenut ammattilainen ja oma yrittäjä, tulossa aluksi auttamaan. Sävy
  // on tekijää kunnioittava (ei "eka keikka" -aloittelijapuhe), ovi jatkolle auki.
  // Kuva näytetään vain jos hän lataa oman kuvan tai lisäät /public/fr8/doma.jpg.
  doma: {
    photo: "/fr8/doma.jpg",
    tagline: "Kokenut tekijä · tervetuloa",
    greeting: "Tervetuloa mukaan, Doma 🙌",
    line: "Hienoa saada kokenut ikkunanpesijä tiimiin. Tässä on sinun oma työpöytäsi — näet työsi ja ansiosi kertyvän reaaliajassa. Laskutat omalla Y-tunnuksellasi ja hoidat verosi itse, me tuomme keikat ja maksamme ajallaan. Tehdään yhdessä siistiä jälkeä — ja katsotaan mihin tästä jatketaan. 💪",
    accent: "#7CE0A6",
  },
  selma: {
    photo: "/fr8/selma.jpg",
    tagline: "Uusi tekijä",
    greeting: "Tervetuloa tiimiin, Selma ✨",
    line: "Kiva että lähdit mukaan! Tää on sun oma työpöytä: täältä näät oman duunisi ja ansiosi etenevän pitkin päivää. Otetaan rennosti ja tehdään yhdessä hyvää jälkeä. Nähdään keikalla! 🚀",
    accent: "#7CE0A6",
  },
};
function introFor(name: string) {
  const first = (name || "").trim().split(/\s+/)[0]?.toLowerCase();
  return first ? WORKER_INTROS[first] : undefined;
}

/** Read an image File, centre-crop to a square ~256 px avatar and return a JPEG
 *  data URL kept comfortably under the server's size cap. Keeps project_data small
 *  so a worker's photo travels with their profile without bloating the gig JSON. */
async function fileToAvatarDataUrl(file: File, size = 256): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error("read"));
    fr.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("img"));
    im.src = dataUrl;
  });
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  const min = Math.min(img.width, img.height);
  ctx.drawImage(img, (img.width - min) / 2, (img.height - min) / 2, min, min, 0, 0, size, size);
  for (const q of [0.82, 0.7, 0.6, 0.5]) {
    const out = canvas.toDataURL("image/jpeg", q);
    if (out.length <= MAX_PHOTO_DATAURL_LEN) return out;
  }
  return canvas.toDataURL("image/jpeg", 0.4);
}

/** Read a receipt photo, scale to fit within `maxDim` (preserving aspect ratio —
 *  receipts are documents, never square-crop) and return a JPEG data URL kept under
 *  the server's size cap. */
async function fileToReceiptDataUrl(file: File, maxDim = 1100): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error("read"));
    fr.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("img"));
    im.src = dataUrl;
  });
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  for (const q of [0.8, 0.68, 0.55, 0.45, 0.35]) {
    const out = canvas.toDataURL("image/jpeg", q);
    if (out.length <= MAX_PAYOUT_RECEIPT_LEN) return out;
  }
  return canvas.toDataURL("image/jpeg", 0.3);
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
          <p style={{ ...rise(0), color: personal?.tagline ? (personal.accent ?? T.green) : "rgba(255,255,255,0.5)", fontSize: 13, letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: personal?.tagline ? 700 : 400 }}>{personal?.tagline ?? "Puuhapatet"}</p>
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
            <Shine loop duration={2.2} loopDelay={1.6} deg={120}>
              <button onClick={enter} disabled={busy} style={{ ...primaryBtn, background: personal?.accent ?? T.green, color: personal?.accent ? "#06210f" : "#fff", opacity: busy ? 0.6 : 1 }}>{busy ? "Avataan…" : "Aloita →"}</button>
            </Shine>
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

// ─── Onboarding (intro + profile + agreements) ─────────────────────────────────

type Step = "intro" | "profile" | { agreementIndex: number } | "sign" | "submitting";

function Onboarding({ token, view, onDone, resign }: { token: string; view: WorkerView; onDone: (v: WorkerView) => void; resign?: boolean }) {
  const required = ALL_AGREEMENTS.filter((a) => view.requiredAgreementIds.includes(a.id));
  const isTrainee = !!view.worker.trainee;
  // A trainee (harjoittelija) is unpaid & not an alihankkija: skip the billing /
  // insurance / risk fields and ask only the basics.
  const profileQuestions = isTrainee
    ? PROFILE_QUESTIONS.filter((q) => ["fullName", "phone", "email", "address"].includes(q.id))
    // Y-tunnus is asked inside the dedicated Y-tunnus toggle below (only when the
    // worker already has one), so drop it from the generic question list here.
    : PROFILE_QUESTIONS.filter((q) => q.id !== "yTunnus");
  // resign = an already-entered worker completing the now-required info + signing.
  // Start straight at the profile ("lisätiedot") step.
  const [step, setStep] = useState<Step>(resign ? "profile" : "intro");
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    // An established entrepreneur (e.g. added with a Y-tunnus already on file) should
    // land on "On jo" with his Y-tunnus prefilled, not on the newbie "Tulossa" option.
    const knownYtunnus = view.worker.profile?.yTunnus ?? view.worker.profile?.answers?.yTunnus ?? "";
    return {
      fullName: view.worker.profile?.fullName ?? view.worker.name ?? "",
      phone: view.worker.profile?.phone ?? "",
      email: view.worker.profile?.email ?? "",
      yTunnus: knownYtunnus,
      // Y-tunnus status: default to "on" when one is already known (pre-filled by an
      // admin for an experienced hire), otherwise "tulossa" so a first-timer's form
      // starts clean until they flip the toggle to "On jo".
      [YTUNNUS_STATUS_KEY]: view.worker.profile?.answers?.[YTUNNUS_STATUS_KEY] ?? (knownYtunnus ? "on" : "tulossa"),
      // Ennakkoperintärekisteri: varovainen oletus "ei" (pidätys), koska
      // pidättämättä jättäminen on Puuhapatetin oma vastuu jos tekijä ei
      // lopulta olekaan rekisterissä. Tekijä vahvistaa itse "Kyllä", jos on.
      [PREPAYMENT_REGISTER_KEY]: view.worker.profile?.answers?.[PREPAYMENT_REGISTER_KEY] ?? "ei",
      ...(view.worker.profile?.answers ?? {}),
    };
  });
  // Per-agreement clause acceptance (each contract is read + accepted), but the
  // worker draws their signature ONCE at the end — that single signature then
  // applies to every agreement.
  const [accepts, setAccepts] = useState<Record<string, Record<string, boolean>>>({});
  const [signature, setSignature] = useState("");
  const [err, setErr] = useState("");
  const [introReady, setIntroReady] = useState(false);
  const [photoDataUrl, setPhotoDataUrl] = useState(view.worker.profile?.photoDataUrl ?? "");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoOk, setPhotoOk] = useState(true);

  // Personal touches for the welcome (photo / tagline / accent), matched by first
  // name. The worker's own uploaded photo always wins over any static fallback.
  const personal = introFor(view.worker.name);
  const firstName = view.worker.name ? view.worker.name.split(" ")[0] : "";
  const introPhoto = photoDataUrl || personal?.photo || "";

  const setAnswer = (id: string, v: string) => setAnswers((a) => ({ ...a, [id]: v }));

  const onPickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    setPhotoBusy(true);
    try { setPhotoDataUrl(await fileToAvatarDataUrl(file)); }
    catch { /* ignore unreadable image */ }
    setPhotoBusy(false);
    input.value = ""; // allow re-selecting the same file (re-crop)
  };

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
      photoDataUrl: photoDataUrl || undefined,
      answers,
    };
    const res = await api.crewOnboard(token, { profile, agreements });
    if (res.ok && res.data?.view) onDone(res.data.view);
    else { setErr(res.error || "Tallennus epäonnistui"); setStep("sign"); }
  };

  // ── Intro ──
  if (step === "intro") {
    const accent = personal?.accent;
    return (
      <div style={{ position: "fixed", inset: 0, background: "radial-gradient(120% 120% at 50% 0%, #14223a 0%, #0a0a0c 60%)", fontFamily: FONT, overflow: "hidden" }}>
        <style>{`
          @keyframes pp-pop { 0%{opacity:0;transform:scale(.6)} 60%{opacity:1;transform:scale(1.06)} 100%{opacity:1;transform:scale(1)} }
          @keyframes pp-float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-7px)} }
          @keyframes pp-ring { to { transform: rotate(360deg) } }
        `}</style>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 24, zIndex: 0 }}>
          <p style={{ color: personal?.tagline ? (accent ?? T.green) : "rgba(255,255,255,0.5)", fontSize: 13, letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: personal?.tagline ? 700 : 400 }}>{personal?.tagline ?? "Puuhapatet"}</p>
          {introPhoto && photoOk && (
            <div style={{ position: "relative", width: 120, height: 120, margin: "16px 0 6px", animation: introReady ? "pp-float 5s ease-in-out infinite 1s" : "none" }}>
              <div style={{ position: "absolute", inset: -7, borderRadius: "50%", background: "conic-gradient(from 0deg, #7CE0A6, #4aa6ff, #b98bff, #7CE0A6)", filter: "blur(2px)", animation: introReady ? "pp-ring 6s linear infinite" : "none", opacity: introReady ? 0.9 : 0 }} />
              <img src={introPhoto} alt={firstName} onError={() => setPhotoOk(false)}
                style={{ position: "relative", width: 120, height: 120, borderRadius: "50%", objectFit: "cover", border: "3px solid rgba(10,10,12,1)", boxShadow: "0 10px 40px rgba(0,0,0,0.55)", animation: introReady ? "pp-pop .8s cubic-bezier(.2,.9,.3,1.2) both" : "none", opacity: introReady ? 1 : 0 }} />
            </div>
          )}
          <h1 style={{ color: "#fff", fontSize: "clamp(28px, 7vw, 48px)", fontWeight: 800, margin: "10px 0", lineHeight: 1.1 }}>
            {personal?.greeting ?? `Tervetuloa tiimiin${firstName ? `, ${firstName}` : ""}`}
          </h1>
          {personal?.line && (
            <p style={{ color: "rgba(255,255,255,0.78)", maxWidth: 460, fontSize: 15.5, lineHeight: 1.65 }}>{personal.line}</p>
          )}
          <p style={{ color: "rgba(255,255,255,0.6)", maxWidth: 440, fontSize: 14, lineHeight: 1.6, marginTop: personal?.line ? 12 : 0 }}>
            {isTrainee ? (
              <>Ennen kuin pääset omalle työpöydällesi, täytä lyhyt profiili ja allekirjoita työharjoittelusopimus. Olet harjoittelijana{view.worker.trainee ? ` ${view.worker.trainee.responsibleLeaderName}n` : ""} vastuulla — turvallisuus aina edellä.</>
            ) : (
              <>Hoidetaan ensin pari pikkujuttua kuntoon — lyhyt profiili ja sopparit — niin pääset omalle työpöydällesi.
              {/* Yhteisökeikalla ei luvata ikkunakohtaista korvausta: siitä ei
                  liiku rahaa, ja väärä lupaus on pahempi kuin ei lupausta. */}
              {view.isCommunity
                ? <> Tämä on <strong style={{ color: "#fff" }}>yhteisökeikka</strong> — teemme sen veloituksetta.</>
                : <> Saat <strong style={{ color: "#fff" }}>{euro(view.worker.perWindowCents)}</strong> jokaisesta pesemästäsi ikkunasta.</>}</>
            )}
          </p>
          <div style={{ width: "100%", maxWidth: 320, marginTop: 28, position: "relative", zIndex: 3, opacity: introReady ? 1 : 0, transform: introReady ? "translateY(0)" : "translateY(8px)", transition: "opacity .5s ease, transform .5s ease", pointerEvents: introReady ? "auto" : "none" }}>
            <Shine loop duration={2.2} loopDelay={1.6} deg={120}>
              <button
                onClick={() => setStep("profile")}
                style={{ ...primaryBtn, background: accent ?? T.green, color: accent ? "#06210f" : "#fff" }}
              >
                Aloita →
              </button>
            </Shine>
          </div>
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
    // Y-tunnus status drives the tax fields. Our workers don't add VAT, so we
    // never ask about ALV. The prepayment-register detail is only relevant once a
    // Y-tunnus actually exists ("On jo"); "Tulossa" workers skip it and we add it
    // before the first invoice. (computeTax defaults: no VAT + withholding applied.)
    const ytStatus = answers[YTUNNUS_STATUS_KEY] || "tulossa";
    const hasYtunnus = ytStatus === "on";
    // Vain muodon tarkistus jos jotain on kirjoitettu — tyhjänä saa yhä jatkaa
    // (Y-tunnus voi tulla ennen ensimmäistä laskua), mutta väärää muotoa ei.
    const ytunnusInput = (answers.yTunnus || "").trim();
    const ytunnusOk = !ytunnusInput || isValidYTunnus(ytunnusInput);
    // Trainees skip the insurance/risk acknowledgement (their leader carries it).
    const canContinue = missing.length === 0 && (isTrainee || (!!insurance && riskOk)) && ytunnusOk;
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

          {/* Profile picture — shown on your own welcome/dashboard. Optional, but a
              friendly touch; downscaled in the browser before it's saved. */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 20 }}>
            <label style={{ cursor: "pointer", position: "relative", display: "inline-block" }}>
              <input type="file" accept="image/*" onChange={onPickPhoto} style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" }} />
              {photoDataUrl ? (
                <img src={photoDataUrl} alt="Profiilikuva" style={{ width: 100, height: 100, borderRadius: "50%", objectFit: "cover", border: `2px solid ${T.hair}` }} />
              ) : (
                <div style={{ width: 100, height: 100, borderRadius: "50%", background: T.paper, border: `2px dashed ${T.hair}`, display: "flex", alignItems: "center", justifyContent: "center", color: T.muted, fontSize: 13, textAlign: "center", padding: 10, boxSizing: "border-box" }}>
                  {photoBusy ? "Käsitellään…" : "Lisää kuva"}
                </div>
              )}
              <span style={{ position: "absolute", right: -2, bottom: -2, width: 30, height: 30, borderRadius: "50%", background: T.green, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, border: "2px solid #fff", lineHeight: 1 }}>+</span>
            </label>
            <p style={{ fontSize: 12, color: T.muted, marginTop: 10 }}>
              {photoDataUrl ? "Vaihda profiilikuvaa" : "Profiilikuva (näkyy omassa näkymässäsi)"}
            </p>
          </div>

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

          {/* Y-tunnus — simple toggle: do you already have one, or is it coming?
              We don't ask about ALV (our tekijät don't add VAT). Only "On jo"
              shows the Y-tunnus field + ennakkoperintärekisteri; "Tulossa" keeps
              onboarding light and we sort the Y-tunnus out before the first lasku. */}
          {!isTrainee && (
          <div style={{ marginTop: 6, marginBottom: 14, padding: 14, borderRadius: 12, background: T.paper, border: `1px solid ${T.hair}` }}>
            <p style={{ ...fieldLabel, marginBottom: 8 }}>Onko sinulla Y-tunnus? *</p>
            <div style={{ display: "flex", gap: 8 }}>
              {([["on", "On jo"], ["tulossa", "Tulossa"]] as [string, string][]).map(([val, lbl]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setAnswer(YTUNNUS_STATUS_KEY, val)}
                  style={{
                    flex: 1, padding: "11px", borderRadius: 10, cursor: "pointer", fontFamily: FONT, fontSize: 14, fontWeight: 600,
                    border: `1.5px solid ${ytStatus === val ? T.green : T.hair}`,
                    background: ytStatus === val ? "rgba(62,124,89,0.10)" : "#fff",
                    color: ytStatus === val ? T.green : T.ink,
                  }}
                >
                  {ytStatus === val ? "✓ " : ""}{lbl}
                </button>
              ))}
            </div>

            {hasYtunnus ? (
              <>
                <label style={{ display: "block", marginTop: 14 }}>
                  <span style={fieldLabel}>Y-tunnus</span>
                  <input
                    value={answers.yTunnus ?? ""}
                    onChange={(e) => setAnswer("yTunnus", e.target.value)}
                    placeholder="1234567-8"
                    style={{ ...inputStyle, ...(ytunnusInput && !ytunnusOk ? { borderColor: "#D9472B" } : {}) }}
                  />
                  {ytunnusInput && !ytunnusOk && (
                    <span style={{ display: "block", marginTop: 4, fontSize: 12, color: "#D9472B" }}>
                      Tarkista Y-tunnus — muoto on 1234567-8, eikä tämä täsmää.
                    </span>
                  )}
                </label>

                {/* ALV-asema — lisätäänkö laskulle 25,5 % ALV. Oletuksena ei valittu
                    (ei ALV:tä); ALV-velvollinen yrittäjä valitsee "ALV-rekisterissä". */}
                <p style={{ ...fieldLabel, marginTop: 16, marginBottom: 8 }}>Arvonlisävero (ALV)</p>
                <div style={{ display: "flex", gap: 8 }}>
                  {([["vahainen_toiminta", "Ei ALV:tä", "vähäinen toiminta"], ["alv_rekisterissa", "ALV-rekisterissä", "lisää 25,5 %"]] as [string, string, string][]).map(([val, lbl, sub]) => {
                    const active = answers[VAT_STATUS_KEY] === val;
                    return (
                      <button key={val} type="button" onClick={() => setAnswer(VAT_STATUS_KEY, val)}
                        style={{ flex: 1, padding: "11px", borderRadius: 10, cursor: "pointer", fontFamily: FONT, fontSize: 13.5, fontWeight: 600, lineHeight: 1.3,
                          border: `1.5px solid ${active ? T.green : T.hair}`, background: active ? "rgba(62,124,89,0.10)" : "#fff", color: active ? T.green : T.ink }}>
                        {active ? "✓ " : ""}{lbl}<br /><span style={{ fontWeight: 400, fontSize: 11, opacity: 0.85 }}>{sub}</span>
                      </button>
                    );
                  })}
                </div>

                <p style={{ fontSize: 11.5, color: T.muted, margin: "12px 0 0", lineHeight: 1.5 }}>
                  Laskutat työsi omalla Y-tunnuksellasi ja hoidat verosi itse. Maksu tehdään aina
                  täysimääräisenä (bruttona) — ei ennakonpidätystä. Voit muuttaa näitä myöhemmin
                  työpöydältä. Tarkista tarvittaessa vero.fi.
                </p>
              </>
            ) : (
              <p style={{ fontSize: 11.5, color: T.muted, margin: "10px 0 0", lineHeight: 1.5 }}>
                Ei hätää — voit hankkia Y-tunnuksen ja täydentää sen myöhemmin ennen ensimmäistä laskua. Hoidetaan loput sitten yhdessä.
              </p>
            )}
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
          {err && <p style={{ color: "#D9472B", fontSize: 13, marginTop: 10 }}>{err}</p>}
          <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
            <button onClick={() => setStep({ agreementIndex: required.length - 1 })} style={secondaryBtn}>← Takaisin</button>
            <button
              disabled={!canSign}
              onClick={submit}
              style={{ ...primaryBtn, flex: 1, opacity: canSign ? 1 : 0.5, cursor: canSign ? "pointer" : "not-allowed" }}
            >
              {resign ? "Vahvista ja allekirjoita →" : "Avaa työpöytä →"}
            </button>
          </div>
        </Wrap>
      </Paper>
    );
  }

  // ── Submitting ──
  // Signing submits directly — no PIN or extra codes; the personal link is the
  // only key to the dashboard.
  return <Centered>Tallennetaan…</Centered>;
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

type Tab = "home" | "map" | "hours";

const NAV_ITEMS: [Tab, string][] = [
  ["home", "Koti"],
  ["map", "Kartta"],
];

/** Stroke icons for the bottom nav (inline so the dark worker theme stays self-contained). */
function NavIcon({ name, color }: { name: Tab; color: string }) {
  const p = { width: 23, height: 23, viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (name) {
    case "home":
      return <svg {...p}><path d="M3 10.5 12 4l9 6.5" /><path d="M5 9.5V20h14V9.5" /></svg>;
    case "map":
      return <svg {...p}><path d="M9 20 3 17V4l6 3 6-3 6 3v13l-6-3-6 3Z" /><path d="M9 7v13M15 4v13" /></svg>;
    case "hours":
      return <svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 1.8" /></svg>;
  }
}

/** Kerroksen selkokielinen nimi ("Kellari" / "3. kerros"). */
/**
 * Tekijän kartalla EI ole ohjauskorttia. Aiempi "Seuraavaksi"-popup peitti kartan
 * alalaidan, ohjasi yksittäisiin ikkunoihin ja selitti lukittuja kerroksia
 * pitkästi. Kerroslukko riittää: lukitut kerrokset eivät näy kartalla lainkaan
 * (restrictFloors), joten tekijä näkee vain sen mitä hän saa pestä.
 */

function Dashboard({ token, view, setView, reload, onLogout }: { token: string; view: WorkerView; setView: (v: WorkerView) => void; reload: () => void; onLogout: () => void }) {
  // Sama vierityslukko kuin perustajan näkymässä: fixed-kuori + vierittynyt sivu
  // siirtää iOS:llä nappien osumaruudut. Ks. index.css `.fr8-lock`.
  useEffect(() => {
    window.scrollTo(0, 0);
    document.documentElement.classList.add("fr8-lock");
    return () => document.documentElement.classList.remove("fr8-lock");
  }, []);
  const [tab, setTab] = useState<Tab>("home");
  // Maksut + Info aren't bottom-nav tabs anymore — they open as sub-screens from
  // Koti, keeping the nav to three simple destinations.
  const [sub, setSub] = useState<null | "payouts" | "notes">(null);
  const pwa = usePwaInstall();
  const [showInstall, setShowInstall] = useState(false);
  // Oman kirjautumissalasanan asetus (myös "unohdin salasanani" -reitti):
  // linkki on henkilökohtainen avain, joten vanhaa salasanaa ei kysytä.
  const [showPassword, setShowPassword] = useState(false);
  // Ohjattu eteneminen: "Vie minut seuraavaan" -napin kohdennusnonce.
  const [floorFocusNonce, setFloorFocusNonce] = useState(0);
  /**
   * TYÖPÖYDÄN AINOA ILMOITUSKANAVA.
   *
   * Ennen tämä oli `guidedNote` ja se piirtyi VAIN karttavälilehdellä. Sinne
   * ohjattiin kerroslukon esto — mutta jos sama esto (tai mikä tahansa
   * verkkovirhe) osui tuntikirjaukseen, kuluihin tai maksuihin, viesti meni
   * näkymään jota ei ollut ruudulla. Nyt kanava on yksi ja se piirtyy
   * välilehdestä riippumatta, joten yksikään merkintä ei voi epäonnistua
   * äänettömästi.
   */
  const [notice, setNotice] = useState("");
  const noticeTimer = useRef<number | null>(null);
  const showNotice = useCallback((text: string) => {
    setNotice(text);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(""), 5200);
  }, []);
  useEffect(() => () => { if (noticeTimer.current) window.clearTimeout(noticeTimer.current); }, []);
  // Juhla jokaisesta pestystä ikkunasta. `n` on juokseva numero, jotta kahden
  // peräkkäisen merkinnän animaatio käynnistyy varmasti uudelleen.
  const [burst, setBurst] = useState<{ n: number; key: string } | null>(null);
  const burstSeq = useRef(0);
  const guided = view.guided;
  // Toimintaa odottavat: perinteiset payoutit + FR8 erälaskuluonnokset (kohta 3B)
  // — molemmat aukeavat samasta "Maksut"-alanäkymästä.
  const pendingPayouts =
    (view.payouts || []).filter((p) => p.status === "ilmoitettu").length +
    (view.eraInvoices || []).filter((inv) => inv.tila === "luonnos").length;

  // Sivun zoomin lukko tehdään CSS:llä (`.fr8-root { touch-action: pan-x pan-y }`),
  // ei kirjoittamalla viewport-metaa uudelleen: ajonaikainen metan muutos otetaan
  // iOS:llä käyttöön vasta seuraavassa uudelleenasettelussa, jolloin turva-alueesta
  // laskettu yläpalkki piirtyy ja osumatestataan eri geometrialla — se oli
  // projektinäkymän "nappi ei rekisteröi ennen kuin käännän puhelimen" -vika.
  // `viewport-fit=cover` tulee index.html:stä, joten tumma käyttöliittymä ulottuu
  // loveuksen alle ilman erillistä asetusta. Ks. admin/project.tsx.



  // Paint the page (html/body) dark while the worker app is open, so no white
  // strip shows behind the fixed app in the home-indicator / overscroll area.
  useEffect(() => {
    const html = document.documentElement, body = document.body;
    const prev = { htmlBg: html.style.background, bodyBg: body.style.background };
    html.style.background = "#060607";
    body.style.background = "#060607";
    return () => { html.style.background = prev.htmlBg; body.style.background = prev.bodyBg; };
  }, []);

  /**
   * YKSI PORTTI KAIKILLE TYÖPÖYDÄN MERKINNÖILLE.
   *
   * Jokainen merkintä teki ennen saman kolmen rivin kuvion — `if (res.ok &&
   * res.data?.view) setView(...)` — ja jokaisessa oli samat kolme vikaa.
   * Tekijät sanoivat että työpöytä "ei välillä toimi"; se oli tämä.
   *
   * 1. VIRHE KATOSI HILJAA. Epäonnistunut pyyntö putosi tyhjään else-haaraan:
   *    napautus ei tehnyt mitään eikä kertonut mitään. Työmaalla yhteys
   *    pätkii, joten tämä oli täsmälleen se "välillä ei toimi" — eikä tekijä
   *    voinut tietää pitikö yrittää uudelleen.
   *
   * 2. VASTAUKSET SAATTOIVAT MENNÄ RISTIIN. Jokainen vastaus korvaa KOKO
   *    näkymän. Kaksi nopeaa napautusta lähtee rinnakkain, ja jos vanhempi
   *    vastaus laskeutuu uudemman jälkeen, se kirjoittaa näkymän tilaan jossa
   *    jälkimmäistä merkintää ei ole — piste katosi ruudulta vaikka se oli
   *    kannassa. Juoksevalla numerolla vain tuorein vastaus saa kirjoittaa.
   *
   * 3. KATKENNUT YHTEYS EI SAANUT TOISTA MAHDOLLISUUTTA. Yksi uusinta vain
   *    verkkovirheelle ja 5xx:lle: 4xx on palvelimen PÄÄTÖS (lukittu kerros,
   *    allekirjoittamaton sopimus), ja sen toistaminen antaisi saman vastauksen
   *    ja piilottaisi syyn.
   */
  const mutSeq = useRef(0);
  const runMark = useCallback(async (
    what: string,
    call: () => Promise<{ ok: boolean; data?: { view: WorkerView }; error?: string; status?: number }>,
  ): Promise<boolean> => {
    const seq = ++mutSeq.current;
    let res = await call();
    if (!res.ok && (res.status === undefined || res.status >= 500)) res = await call();
    // Vanhentunut vastaus ei saa kirjoittaa näkymää — ks. kohta 2 yllä.
    if (seq !== mutSeq.current) return res.ok;
    if (res.ok && res.data?.view) { setView(res.data.view); setNotice(""); return true; }
    showNotice(res.error || `${what} ei onnistunut. Tarkista yhteys ja yritä uudelleen.`);
    return false;
  }, [setView]);

  const markWindow = useCallback(async (key: string, st: WindowStatus) => {
    const ok = await runMark("Merkintä", () => api.crewMarkWindow(token, key, st));
    // Pieni juhla jokaisesta pestystä ikkunasta. Näkymä on jo päivittynyt,
    // joten prosentti ja määrä nousevat serpentiinien alla.
    if (ok && st === "pesty") setBurst({ n: burstSeq.current++, key });
  }, [token, runMark]);

  // Lamppu — sama merkintä kuin ikkunalla, mutta ei rahaa eikä pesuporttia.
  const markLamp = useCallback(async (key: string, status: LampStatus) => {
    await runMark("Lampun merkintä", () => api.crewMarkLamp(token, key, status));
  }, [token, runMark]);

  // Toimiiko lamppu — oma kysymyksensä vaihtamisen rinnalla.
  const setLampCondition = useCallback(async (key: string, condition: LampCondition | null) => {
    await runMark("Kunnon merkintä", () => api.crewSetLampCondition(token, key, condition));
  }, [token, runMark]);

  const setLampNote = useCallback(async (key: string, text: string) => {
    await runMark("Huomautuksen tallennus", () => api.crewSetLampNote(token, key, text));
  }, [token, runMark]);

  // Lampun malli — tekijä näkee kohteen ja tietää mikä lamppu siinä on, joten
  // hän on oikea merkitsemään sen. Mallilistan ylläpito on johtajan puolella.
  const setLampModel = useCallback(async (key: string, modelId: string | null) => {
    await runMark("Mallin merkintä", () => api.crewSetLampModel(token, key, modelId));
  }, [token, runMark]);

  // Ovi — tehtäväpiste: tekijä kuittaa tehdyksi ja voi huomauttaa siitä.
  const markDoor = useCallback(async (key: string, status: DoorStatus) => {
    await runMark("Oven merkintä", () => api.crewMarkDoor(token, key, status));
  }, [token, runMark]);

  const setDoorNote = useCallback(async (key: string, text: string) => {
    await runMark("Huomautuksen tallennus", () => api.crewSetDoorNote(token, key, text));
  }, [token, runMark]);

  // Per-window observation (text + optional photo) the worker leaves on a window.
  const setObservation = useCallback(async (key: string, text: string, imageDataUrl?: string) => {
    await runMark("Havainnon tallennus", () => api.crewSetWindowObservation(token, key, text, imageDataUrl));
  }, [token, runMark]);

  // Havaintokuva haetaan vasta napautuksesta — ks. stripObservationImages.
  const loadObservationImage = useCallback(async (key: string) => {
    const res = await api.crewObservationImage(token, key);
    return res.ok ? res.data?.imageDataUrl : undefined;
  }, [token]);

  // Worker map notes — add a "huomio" / "tikkaat" marker, edit or delete own.
  const addNote = useCallback((floor: string, x: number, y: number, kind: string): void => {
    void runMark("Merkinnän lisäys", () => api.crewAddMapNote(token, floor, x, y, kind));
  }, [token, runMark]);
  const updateNote = useCallback(async (floor: string, key: string, text: string) => {
    await runMark("Merkinnän tallennus", () => api.crewUpdateMapNote(token, floor, key, text));
  }, [token, runMark]);
  const deleteNote = useCallback(async (floor: string, key: string) => {
    await runMark("Merkinnän poisto", () => api.crewDeleteMapNote(token, floor, key));
  }, [token, runMark]);

  const noop = useCallback(() => {}, []);

  return (
    <div className="fr8-root" style={{ position: "fixed", inset: 0, background: "#060607", color: "#fff", display: "flex", flexDirection: "column", fontFamily: FONT, overflow: "hidden", overscrollBehavior: "none", WebkitTapHighlightColor: "transparent", WebkitUserSelect: "none", userSelect: "none" }}>
      {/* Header */}
      <div style={{ flexShrink: 0, padding: "calc(12px + env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) 12px max(16px, env(safe-area-inset-left))", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <p style={{ margin: 0, fontWeight: 700, fontSize: 15 }}>{view.worker.name || "Työntekijä"}</p>
          <p style={{ margin: 0, fontSize: 11.5, color: "rgba(255,255,255,0.5)" }}>{view.building.name || "Puuhapatet"}{view.building.address ? ` · ${view.building.address}` : ""}</p>
          <div style={{ marginTop: 3, display: "flex", alignItems: "center", gap: 12 }}>
            <button
              onClick={onLogout}
              style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.35)", fontSize: 10.5, fontFamily: FONT, padding: 0 }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
              Kirjaudu ulos
            </button>
            <button
              onClick={() => setShowPassword(true)}
              style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.35)", fontSize: 10.5, fontFamily: FONT, padding: 0 }}
              data-testid="btn-open-password"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" /></svg>
              Salasana
            </button>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <p style={{ margin: 0, fontSize: 20, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: "#7CE0A6" }}>{euro(view.stats.earnedCents)}</p>
          {/* "N ikkunaa · 20,00 €/kpl" oli peruja punaisesta urakasta: N sisälsi
              keltaiset, mutta taksa oli punaisten oma. Keltaiset maksetaan
              palkkiotaulukon mukaan (36 € → 19 €), joten yhtä ikkunahintaa ei
              ole olemassa — se luku oli väärä heti ensimmäisestä keltaisesta.
              Nyt kumpikin väri kertoo oman lukunsa, eikä kumpaakaan lasketa
              toisen taksalla. */}
          <p style={{ margin: 0, fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
            {view.stats.p2Washed > 0
              ? <>{fmtWindows(view.stats.p1Washed)} punaista · {fmtWindows(view.stats.p2Washed)} keltaista</>
              : view.isCommunity
                ? <>{fmtWindows(view.stats.washed)} ikkunaa · yhteisökeikka</>
                : <>{fmtWindows(view.stats.washed)} ikkunaa · {euro(view.worker.perWindowCents)}/kpl</>}
          </p>
        </div>
      </div>

      {/* Juhla pestystä ikkunasta — serpentiinit + "+1 pesty" -merkki. Ei estä
          käyttöä (pointerEvents: none) eikä peitä karttaa, katoaa itsestään. */}
      {burst && <WindowDoneBurst key={burst.n} onDone={() => setBurst(null)} />}

      {/* Install nudge — only when not yet running as an installed app */}
      <InstallBanner pwa={pwa} onOpen={() => setShowInstall(true)} />

      {/* Content */}
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {!sub && tab === "map" && (
          <FloorView
            floors={view.building.floors}
            planBase={view.building.planBase || ""}
            building={view.building}
            planUrlBase={api.planUrlBaseForCrew(token)}
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
            onLoadObservationImage={loadObservationImage}
            activeZone={view.activeZone}
            lamps={view.lamps}
            lampStatuses={view.lampStatuses}
            lampChangedBy={view.lampChangedBy}
            onSetLampStatus={markLamp}
            lampConditions={view.lampConditions}
            lampNotes={view.lampNotes}
            lampModels={view.lampModels}
            lampModelOf={view.lampModelOf}
            onSetLampModel={setLampModel}
            onSetLampCondition={setLampCondition}
            onSetLampNote={setLampNote}
            doors={view.doors}
            doorStatuses={view.doorStatuses}
            doorDoneBy={view.doorDoneBy}
            doorNotes={view.doorNotes}
            onSetDoorStatus={markDoor}
            onSetDoorNote={setDoorNote}
            p2={view.p2 ? { enabled: view.p2.enabled, lockedKeys: view.p2.lockedKeys, payoutByKey: view.p2.payoutByKey } : null}
            /* Asiakkaan laajuusvastaukset keltaisiin. Ilman näitä tekijä pesisi
               yhteisökeikan keltaisia arvaamalla, vaikka asiakas on jo kertonut
               mitkä pestään. */
            scopeVotes={view.scopeVotes ?? null}
            guided={guided ? { enabled: guided.enabled, activeFloor: guided.activeFloor, activeFloors: guided.activeFloors, lockedFloors: guided.lockedFloors, nextKey: guided.nextKey } : null}
            /* Johtajan piilottamat ikkunat katoavat tekijän kartalta kokonaan.
               Piste jota ei voi painaa näyttäisi rikkinäiseltä sovellukselta,
               ei päätökseltä. */
            lockedWindowKeys={view.lockedWindowKeys ?? []}
            floorFocus={guided?.activeFloor ? { floor: guided.activeFloor, nonce: floorFocusNonce } : null}
            /* Discreet map: regular workers see ONLY the opened floors; founders
               (role "host") see every floor. Falls back to the single guide floor
               for older payloads without activeFloors. */
            restrictFloors={
              guided?.enabled && view.worker.role !== "host" && !FOUNDER_IDS.includes(view.worker.id)
                ? (guided.activeFloors && guided.activeFloors.length
                    ? guided.activeFloors
                    : (guided.activeFloor ? [guided.activeFloor] : null))
                : null
            }
          />
        )}
        {/* Ilmoitus lyhyenä toastina alalaidassa — KAIKILLA välilehdillä ja myös
            alanäkymien päällä, koska merkintä voi epäonnistua missä tahansa.
            Siksi myös zIndex on alanäkymien yläpuolella. */}
        {notice && (
          <div style={{ position: "absolute", left: 12, right: 12, bottom: 14, zIndex: 90, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
            <span style={{ maxWidth: 420, padding: "9px 13px", borderRadius: 11, background: "rgba(28,22,8,0.95)", border: "1px solid rgba(255,205,40,0.4)", color: "#ffe08a", fontSize: 12.5, lineHeight: 1.4, textAlign: "center" }}>
              {notice}
            </span>
          </div>
        )}
        {!sub && tab === "home" && (
          <HomeTab
            view={view}
            setTab={setTab}
            pendingPayouts={pendingPayouts}
            onOpenPayouts={() => setSub("payouts")}
            onOpenInfo={() => setSub("notes")}
          />
        )}
        {!sub && tab === "hours" && <HoursTab token={token} view={view} setView={setView} notify={showNotice} />}

        {/* Maksut / Info as full-screen sub-views with a back header */}
        {sub && (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", background: "#060607" }}>
            <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
              <button onClick={() => setSub(null)} aria-label="Takaisin" style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#fff", cursor: "pointer", fontFamily: FONT, fontSize: 14, fontWeight: 600, padding: 0 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
                {sub === "payouts" ? "Maksut" : "Info & ohjeet"}
              </button>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              {sub === "payouts" ? <PayoutsTab token={token} view={view} setView={setView} /> : <NotesTab token={token} view={view} setView={setView} />}
            </div>
          </div>
        )}
      </div>

      {/* Bottom nav — three simple destinations */}
      <div style={{ flexShrink: 0, display: "flex", justifyContent: "space-around", alignItems: "stretch", gap: 2, borderTop: "1px solid rgba(255,255,255,0.08)", background: "#0b0b0d", padding: "8px 6px calc(8px + env(safe-area-inset-bottom))" }}>
        {NAV_ITEMS.map(([id, label]) => {
          const active = !sub && tab === id;
          return (
            <button
              key={id}
              onClick={() => { setSub(null); setTab(id); if (id !== "map") reload(); }}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              style={{ position: "relative", flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "8px 2px", background: "none", border: "none", cursor: "pointer", fontFamily: FONT, color: active ? "#fff" : "rgba(255,255,255,0.5)", transition: "color .2s" }}
            >
              <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 52, height: 30, borderRadius: 999, background: active ? "rgba(124,224,166,0.16)" : "transparent", transition: "background .2s" }}>
                <NavIcon name={id} color={active ? "#7CE0A6" : "rgba(255,255,255,0.55)"} />
              </span>
              <span style={{ fontSize: 11, fontWeight: active ? 700 : 500, letterSpacing: "0.01em", whiteSpace: "nowrap" }}>{label}</span>
            </button>
          );
        })}
      </div>

      {showInstall && <InstallModal pwa={pwa} onClose={() => setShowInstall(false)} />}
      {showPassword && <PasswordModal token={token} name={view.worker.name} onClose={() => setShowPassword(false)} />}
    </div>
  );
}

/** Set (or replace) the worker's puuhapatet.fi login password straight from
 *  their personal link. The link IS the identity, so no old password is asked
 *  — this doubles as the "unohdin salasanani" route. The new password replaces
 *  every previous one; nothing else ever needs remembering. */
function PasswordModal({ token, name, onClose }: { token: string; name: string; onClose: () => void }) {
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const firstName = name ? name.split(" ")[0] : "";
  const darkInput: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", padding: "12px 14px", borderRadius: 12, fontSize: 15, fontFamily: FONT,
    background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.18)", color: "#fff", outline: "none",
  };
  const save = async () => {
    if (pw1.length < 4) { setErr("Vähintään 4 merkkiä."); return; }
    if (pw1 !== pw2) { setErr("Salasanat eivät täsmää."); return; }
    setBusy(true); setErr("");
    const res = await api.crewSetPassword(token, pw1);
    setBusy(false);
    if (res.ok) setDone(true);
    else setErr(res.error || "Tallennus epäonnistui — yritä uudelleen.");
  };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} onClick={onClose}>
      <div style={{ width: "100%", maxWidth: 340, background: "#141416", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 18, padding: 20 }} onClick={(e) => e.stopPropagation()}>
        {done ? (
          <>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 16 }}>Salasana tallennettu ✓</p>
            <p style={{ margin: "8px 0 16px", fontSize: 13, color: "rgba(255,255,255,0.6)", lineHeight: 1.55 }}>
              Kun kirjaudut puuhapatet.fi:ssä, valitse <b style={{ color: "#fff" }}>{firstName || "oma nimesi"}</b> ja
              käytä tätä salasanaa. Vanhat salasanat eivät enää toimi — tämä on ainoa.
            </p>
            <button onClick={onClose} style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: "none", cursor: "pointer", fontFamily: FONT, fontSize: 14.5, fontWeight: 700, background: T.green, color: "#fff" }}>Valmis</button>
          </>
        ) : (
          <>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 16 }}>Aseta kirjautumissalasana</p>
            <p style={{ margin: "6px 0 14px", fontSize: 12.5, color: "rgba(255,255,255,0.55)", lineHeight: 1.55 }}>
              Tällä kirjaudut puuhapatet.fi:ssä omalla nimelläsi. Uusi salasana korvaa kaikki vanhat —
              jos vanha on unohtunut, aseta tästä vain uusi.
            </p>
            <input type="password" value={pw1} onChange={(e) => setPw1(e.target.value)} placeholder="Uusi salasana (väh. 4 merkkiä)" autoComplete="new-password" autoFocus style={{ ...darkInput, marginBottom: 8 }} />
            <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Uusi salasana uudelleen" autoComplete="new-password" style={darkInput} onKeyDown={(e) => e.key === "Enter" && save()} />
            {err && <p style={{ color: "#FF9A9A", fontSize: 12.5, margin: "8px 0 0" }}>{err}</p>}
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button onClick={onClose} style={{ flex: 1, padding: "12px 14px", borderRadius: 12, cursor: "pointer", fontFamily: FONT, fontSize: 14.5, fontWeight: 600, background: "none", border: "1px solid rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.75)" }}>Peruuta</button>
              <button onClick={save} disabled={busy || !pw1 || !pw2} style={{ flex: 1.4, padding: "12px 14px", borderRadius: 12, border: "none", cursor: "pointer", fontFamily: FONT, fontSize: 14.5, fontWeight: 700, background: T.green, color: "#fff", opacity: busy || !pw1 || !pw2 ? 0.55 : 1 }} data-testid="btn-save-password">
                {busy ? "Tallennetaan…" : "Tallenna"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Lyhyt juhla kun tekijä merkitsee ikkunan pestyksi.
 *
 * Miksi: merkintä oli aiemmin täysin äänetön — ruutu vain päivittyi. Pieni
 * palkinto tekee etenemisestä näkyvää ja saa prosentin nousun huomatuksi.
 * Kevyt tarkoituksella: ei kirjastoa, samat CSS-serpentiinit kuin perustajien
 * juhlassa (index.css: fr8-confetti-fall), ei klikkien estoa, katoaa 1,6 s:ssa.
 */
function WindowDoneBurst({ onDone }: { onDone: () => void }) {
  const strips = useState(() => {
    const colors = ["255,72,72", "255,206,40", "124,224,166", "255,255,255"];
    return Array.from({ length: 18 }, (_, i) => ({
      left: 12 + Math.round(Math.random() * 76),
      color: colors[i % colors.length],
      delay: Math.round(Math.random() * 260) / 1000,
      dur: 1.0 + Math.round(Math.random() * 500) / 1000,
      w: i % 3 === 0 ? 5 : 3,
      h: 10 + (i % 4) * 4,
    }));
  })[0];
  useEffect(() => {
    const t = window.setTimeout(onDone, 1600);
    return () => window.clearTimeout(t);
  }, [onDone]);
  return (
    <div className="fr8-confetti" style={{ position: "fixed", inset: 0, zIndex: 70, pointerEvents: "none", overflow: "hidden" }}>
      {strips.map((s, i) => (
        <span key={i} style={{
          position: "absolute", top: "18%", left: `${s.left}%`, width: s.w, height: s.h,
          borderRadius: 2, background: `rgb(${s.color})`,
          animation: `fr8-confetti-fall ${s.dur}s linear ${s.delay}s 1 both`,
        }} />
      ))}
      <div style={{
        position: "absolute", top: "34%", left: "50%", transform: "translateX(-50%)",
        padding: "9px 18px", borderRadius: 999,
        background: "rgba(124,224,166,0.16)", border: "1px solid rgba(124,224,166,0.45)",
        color: "#9ff0bd", fontSize: 14.5, fontWeight: 800, whiteSpace: "nowrap",
        animation: "fr8-burst-pop 1.6s ease-out 1 both",
      }}>
        +1 pesty ✓
      </div>
    </div>
  );
}

/** Worker home / overview — the motivating landing screen: clear team progress on
 *  the contract (red) windows, your own windows + earnings, quick actions, and the
 *  team standings. Replaces "just a map" as the first thing a worker sees. */
function HomeTab({ view, setTab, pendingPayouts, onOpenPayouts, onOpenInfo }: {
  view: WorkerView; setTab: (t: Tab) => void;
  pendingPayouts: number; onOpenPayouts: () => void; onOpenInfo: () => void;
}) {
  const s = view.stats;
  const todayWashed = view.todayWashed ?? 0;
  // Live progress from the worker's OWN map data, so it always matches what they
  // see on the map. Punaiset (sopimus) ja keltaiset (lisätyöt) erikseen — mutta
  // iso prosentti lasketaan MOLEMMISTA. Aiemmin luku katsoi vain punaisia, joten
  // se jäi jumiin 100 %:iin heti kun sopimusikkunat olivat valmiit, vaikka
  // lisätöitä oli vielä kymmeniä pesemättä. Tekijälle se näytti siltä ettei
  // työtä ole enää jäljellä.
  const prog = useMemo(() => {
    let red = 0, redDone = 0, yellow = 0, yellowDone = 0;
    const add = (p: number, done: boolean) => {
      if (p === 1) { red += 1; if (done) redDone += 1; }
      else { yellow += 1; if (done) yellowDone += 1; }
    };
    for (const f of view.building.floors) {
      (view.marks[f]?.marks || []).forEach((m, idx) => {
        const key = `${f}#${idx}`;
        if (view.deleted[key]) return;
        add(m.p, view.statuses[key] === "pesty");
      });
      (view.customMarks[f] || []).forEach((cm) => {
        if (view.deleted[cm.key]) return;
        add(cm.p, view.statuses[cm.key] === "pesty");
      });
    }
    const total = red + yellow;
    const done = redDone + yellowDone;
    return {
      red, redDone, yellow, yellowDone, total, done,
      pct: total > 0 ? (done / total) * 100 : 0,
      redPct: red > 0 ? (redDone / red) * 100 : 0,
      /** Osuus KOKO ympyrästä: kaaret piirretään peräkkäin, punainen ensin. */
      redArc: total > 0 ? (redDone / total) * 100 : 0,
      yellowArc: total > 0 ? (yellowDone / total) * 100 : 0,
      redFull: red > 0 && redDone >= red,
      allDone: total > 0 && done >= total,
    };
  }, [view]);

  const CIRC = 2 * Math.PI * 52;
  // ANIMOITU EDISTYMINEN. Kaaret ja prosentti kasvavat samasta arvosta, joten
  // ne eivät voi olla eri kohdassa — CSS-siirtymä kaarelle ja erillinen laskuri
  // numerolle ajautuvat aina erilleen. `useEaseTo` kunnioittaa
  // `prefers-reduced-motion`ia, jolloin arvo on heti lopussa.
  const grow = useEaseTo(1);
  const redArcLive = prog.redArc * grow;
  const yellowArcLive = prog.yellowArc * grow;
  const pctLive = prog.pct * grow;
  const doneLive = prog.done * grow;
  return (
    <div style={{ height: "100%", overflowY: "auto", WebkitOverflowScrolling: "touch", padding: 20 }}>
      {/* Koko keikan edistyminen — punainen kaari + keltainen kaari samassa
          ympyrässä, iso prosentti molemmista. Kun sopimusikkunat ovat valmiit,
          punainen saa oman "tehty"-merkkinsä eikä luku jää jumiin sataan. */}
      <div style={{ display: "flex", alignItems: "center", gap: 18, padding: 18, borderRadius: 18,
        background: prog.yellow > 0
          ? "linear-gradient(155deg, rgba(255,72,72,0.09), rgba(255,206,40,0.08), rgba(255,255,255,0.03))"
          : "linear-gradient(155deg, rgba(255,72,72,0.10), rgba(255,255,255,0.03))",
        border: `1px solid ${prog.yellow > 0 ? "rgba(255,206,40,0.22)" : "rgba(255,72,72,0.22)"}` }}>
        <div style={{ position: "relative", width: 116, height: 116, flexShrink: 0 }}>
          <svg width="116" height="116" viewBox="0 0 116 116" style={{ transform: "rotate(-90deg)" }}>
            <circle cx="58" cy="58" r="52" fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth="8" />
            {/* Keltainen kaari piirretään ensin punaisen JÄLKEEN alkavaksi
                (dashoffset), jotta segmentit eivät mene päällekkäin. */}
            {prog.yellowArc > 0 && (
              <circle cx="58" cy="58" r="52" fill="none" stroke="#ffce28" strokeWidth="8" strokeLinecap="round"
                strokeDasharray={`${((yellowArcLive / 100) * CIRC).toFixed(1)} ${CIRC.toFixed(1)}`}
                strokeDashoffset={`${(-(redArcLive / 100) * CIRC).toFixed(1)}`} />
            )}
            <circle cx="58" cy="58" r="52" fill="none" stroke="#ff6b6b" strokeWidth="8" strokeLinecap="round"
              strokeDasharray={`${((redArcLive / 100) * CIRC).toFixed(1)} ${CIRC.toFixed(1)}`} />
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 26, fontWeight: 800, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{Math.round(pctLive)}%</span>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>pesty</span>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <p style={{ margin: 0, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.55)" }}>
              {prog.yellow > 0 ? "Koko keikka" : "Sopimusikkunat (punaiset)"}
            </p>
            {/* Päivän oma saldo. Tekijän ainoa palaute päivän aikana oli pisteen
                värin vaihtuminen kartalla; tämä kertoo mitä tänään on saatu aikaan. */}
            {todayWashed > 0 && (
              <span style={{ marginLeft: "auto", flexShrink: 0, fontSize: 10.5, fontWeight: 700, color: "#7CE0A6", background: "rgba(124,224,166,0.13)", border: "1px solid rgba(124,224,166,0.3)", borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }}>
                tänään {todayWashed}
              </span>
            )}
          </div>
          <p style={{ margin: "4px 0 0", fontSize: 30, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
            {Math.round(doneLive)}<span style={{ color: "rgba(255,255,255,0.4)", fontWeight: 600 }}> / {prog.total}</span>
          </p>
          {/* Punaiset ja keltaiset omina pikkuriveinään — tekijä näkee heti
              kummasta on kyse ilman että hänen tarvitsee tulkita mitään. */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 7 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 999, fontSize: 11.5, fontWeight: 600,
              background: prog.redFull ? "rgba(255,72,72,0.10)" : "rgba(255,72,72,0.16)", border: "1px solid rgba(255,107,107,0.35)", color: "#ffb3b3" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#ff6b6b" }} />
              {prog.redFull ? `Punaiset tehty ✓ ${prog.red}` : `Punaiset ${prog.redDone}/${prog.red}`}
            </span>
            {prog.yellow > 0 && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 999, fontSize: 11.5, fontWeight: 600,
                background: "rgba(255,206,40,0.14)", border: "1px solid rgba(255,206,40,0.35)", color: "#ffe08a" }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#ffce28" }} />
                Lisätyöt {prog.yellowDone}/{prog.yellow}
              </span>
            )}
          </div>
          <p style={{ margin: "7px 0 0", fontSize: 12.5, color: "rgba(255,255,255,0.6)" }}>
            {prog.allDone
              ? "Kaikki pesty! 🎉"
              : prog.redFull && prog.yellow - prog.yellowDone > 0
                ? `Vielä ${prog.yellow - prog.yellowDone} lisätyöikkunaa`
                : `Vielä ${prog.total - prog.done} ikkunaa pestävänä`}
          </p>
        </div>
      </div>

      {/* Your own contribution + earnings */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <div style={{ padding: 16, borderRadius: 14, background: "rgba(124,224,166,0.10)", border: "1px solid rgba(124,224,166,0.22)" }}>
          <p style={{ margin: 0, fontSize: 11, color: "rgba(255,255,255,0.55)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Sinun ansiosi</p>
          {/* Ansio nousee samalla rytmillä kuin kaari — se on päivän luku,
              ja sen ilmestyminen valmiina ei tunnu miltään. */}
          <p style={{ margin: "4px 0 0", fontSize: 26, fontWeight: 800, color: "#7CE0A6", fontVariantNumeric: "tabular-nums" }}>{euro(Math.round(s.earnedCents * grow))}</p>
          {(s.p2EarnedCents ?? 0) > 0 && (
            <p style={{ margin: "3px 0 0", fontSize: 11, color: "rgba(255,220,110,0.85)", fontVariantNumeric: "tabular-nums" }}>
              sis. keltaiset {euro(s.p2EarnedCents)}
            </p>
          )}
          {/* HYVÄKSYMÄTÖN TYÖ NÄKYY NYT.
              Tässä luki aiemmin että odottavaa summaa EI näytetä tekijälle:
              hinnan hyväksyy asiakas, joten luku olisi vain hämmentävä eikä
              sille voi tehdä mitään. Käytäntö osoitti päättelyn vääräksi —
              hämmennyksen aiheutti nimenomaan sen PUUTTUMINEN. Tekijä näkee
              pesseensä esimerkiksi 40 keltaista mutta summa vastaa vain
              kahtakymmentä, eikä mikään kerro miksi. Nyt kerrotaan. */}
          {(s.p2PendingCents ?? 0) > 0 && (
            <p style={{ margin: "3px 0 0", fontSize: 11, color: "rgba(160,185,255,0.9)", fontVariantNumeric: "tabular-nums" }}>
              + {euro(s.p2PendingCents)} odottaa asiakkaan hyväksyntää
              {(s.p2PendingWashed ?? 0) > 0 ? ` (${s.p2PendingWashed.toLocaleString("fi-FI", { maximumFractionDigits: 1 })} ikkunaa)` : ""}
            </p>
          )}
        </div>
        <div style={{ padding: 16, borderRadius: 14, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <p style={{ margin: 0, fontSize: 11, color: "rgba(255,255,255,0.55)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Sinun ikkunasi</p>
          <p style={{ margin: "4px 0 0", fontSize: 26, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{s.washed.toLocaleString("fi-FI", { maximumFractionDigits: 1 })}</p>
        </div>
      </div>

      {/* Quick actions */}
      <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
        <button onClick={() => setTab("map")} style={{ ...primaryBtn, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.14)", color: "#fff" }}>Avaa kartta →</button>
        <button onClick={() => setTab("hours")} style={{ ...primaryBtn, background: T.green }}>Kirjaa tunnit →</button>
      </div>

      {/* Pending payment — needs the worker's action */}
      {pendingPayouts > 0 && (
        <button onClick={onOpenPayouts} style={{ width: "100%", marginTop: 12, display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderRadius: 14, background: "rgba(224,168,0,0.14)", border: "1px solid rgba(224,168,0,0.35)", cursor: "pointer", fontFamily: FONT, textAlign: "left" }}>
          <span style={{ fontSize: 20 }}>💸</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: "#F4D58A" }}>Sinulla on {pendingPayouts} maksu{pendingPayouts > 1 ? "a" : ""} hyväksyttävänä</span>
            <span style={{ display: "block", fontSize: 12, color: "rgba(255,255,255,0.6)" }}>Avaa ja vahvista laskutustietosi →</span>
          </span>
        </button>
      )}

      {/* Maksut + Info — folded off the bottom nav into the home screen */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <button onClick={onOpenPayouts} style={{ position: "relative", display: "flex", flexDirection: "column", gap: 6, padding: 16, borderRadius: 14, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", cursor: "pointer", fontFamily: FONT, textAlign: "left", color: "#fff" }}>
          <span style={{ fontSize: 20 }}>💳</span>
          <span style={{ fontSize: 14, fontWeight: 700 }}>Maksut</span>
          <span style={{ fontSize: 11.5, color: "rgba(255,255,255,0.5)" }}>Hyväksy ja seuraa maksuja</span>
          {pendingPayouts > 0 && <span style={{ position: "absolute", top: 12, right: 12, minWidth: 18, height: 18, padding: "0 5px", borderRadius: 999, background: "#E03B3B", color: "#fff", fontSize: 11, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{pendingPayouts}</span>}
        </button>
        <button onClick={onOpenInfo} style={{ display: "flex", flexDirection: "column", gap: 6, padding: 16, borderRadius: 14, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", cursor: "pointer", fontFamily: FONT, textAlign: "left", color: "#fff" }}>
          <span style={{ fontSize: 20 }}>ℹ️</span>
          <span style={{ fontSize: 14, fontWeight: 700 }}>Info & ohjeet</span>
          <span style={{ fontSize: 11.5, color: "rgba(255,255,255,0.5)" }}>Ovikoodi, säännöt, vakuutukset</span>
        </button>
      </div>

      {/* Total hours only — no €/h average (the per-hour read-out isn't shown to workers).
          TUNTITILASSA EI EDES TÄTÄ: siellä tunnit ovat palkka, ja johtajat
          päättävät luvun (pyöristys + käsin korjaus). Jos tekijä näkisi
          juoksevan summan, hän tekisi siitä omat johtopäätöksensä ennen kuin
          johtaja on sen tarkistanut. Ks. `BillingMode`. */}
      {view.billingMode !== "hourly" && (
        <div style={{ marginTop: 16 }}>
          <Stat label="Tunteja" value={s.hours.toLocaleString("fi-FI", { maximumFractionDigits: 1 })} />
        </div>
      )}
      {/* Vain keikalla jolla on erälaskutus. Ennen tämä näytti "Maksuerä 1/4"
          jokaisella keikalla — luku oli FR8:n rakenne, ei tämän keikan. */}
      {view.hasInstalments && (
        <PaydateProgress total={view.windowsTotal} washed={view.windowsWashed} workerId={view.worker.id} />
      )}
      <Leaderboard view={view} />
      {!view.worker.trainee && <PathCard />}
      <InstallHint />
      {/* Yksi rivi: MITEN palkka tulee. Aiempi kahden lauseen kappale selitti
          myös sen että luku päivittyy merkinnästä — sen tekijä näkee itse. */}
      <p style={{ marginTop: 20, fontSize: 12.5, color: "rgba(255,255,255,0.45)", lineHeight: 1.6 }}>
        {view.worker.trainee
          ? `Korvaus tiimin kautta · ${view.worker.trainee.responsibleLeaderName}`
          : "Laskutus omalla Y-tunnuksellasi"}
      </p>
    </div>
  );
}

/** The "first gig → subcontractor → into the brand" path. Shown to FR8 workers
 *  so they know this is the start of something, not a one-off. */
function PathCard() {
  const steps: { n: string; title: string; body: string }[] = [
    { n: "1", title: "Tämä on ensimmäinen keikka", body: "Tämä on ensimmäinen yhteinen keikkamme. Tee laadukasta ja luotettavaa jälkeä — sillä on merkitystä siihen, mitä seuraavaksi." },
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
        {(() => {
          const meIdx = board.findIndex((b) => b.isMe);
          // Always show the current worker, even if ranked outside the top 8, so a
          // worker never "disappears" from the standings — pin their own row below.
          const rows = board.slice(0, 8).map((b) => ({ b, rank: board.indexOf(b) }));
          const showMeBelow = meIdx >= 8;
          const rendered = showMeBelow ? [...rows, { b: board[meIdx], rank: meIdx }] : rows;
          return rendered.map(({ b, rank }, pos) => {
            const medal = rank === 0 ? "🥇" : rank === 1 ? "🥈" : rank === 2 ? "🥉" : `${rank + 1}.`;
            const pct = (b.washed / maxWashed) * 100;
            const gap = showMeBelow && pos === rendered.length - 1;
            return (
              <div key={b.id} style={{ position: "relative", display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 12, overflow: "hidden", marginTop: gap ? 4 : 0, background: b.isMe ? "rgba(124,224,166,0.12)" : "rgba(255,255,255,0.05)", border: `1px solid ${b.isMe ? "rgba(124,224,166,0.35)" : "rgba(255,255,255,0.08)"}` }}>
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct}%`, background: b.isMe ? "rgba(124,224,166,0.10)" : "rgba(255,255,255,0.04)" }} />
                <span style={{ position: "relative", width: 22, textAlign: "center", fontSize: rank < 3 ? 16 : 12, fontWeight: 700, color: "rgba(255,255,255,0.6)" }}>{medal}</span>
                <span style={{ position: "relative", flex: 1, fontSize: 14, fontWeight: b.isMe ? 700 : 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {b.isMe ? "Sinä" : firstName(b.name)}
                  {b.id === effLeaderId && <span title="Tehokkain (ikkunaa/tunti)" style={{ marginLeft: 6, fontSize: 12 }}>⚡</span>}
                </span>
                <span style={{ position: "relative", fontSize: 15, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{b.washed}</span>
              </div>
            );
          });
        })()}
      </div>
      {board[0] && board[0].washed > 0 && (
        <p style={{ marginTop: 10, fontSize: 12, color: "rgba(255,255,255,0.5)", textAlign: "center" }}>
          {board[0].isMe ? "Sinä johdat — hieno suoritus! 🏆" : `${firstName(board[0].name)} johtaa. Kurot kiinni! 💪`}
        </p>
      )}
    </div>
  );
}

/** FR8 erälaskut (kohta 3B): johtajan luonnostama lasku ilmestyy tähän, ja
 *  tekijä joko hyväksyy ja LÄHETTÄÄ sen ("Lähetä lasku" — toimii tasan kerran,
 *  minkä jälkeen lasku on lukittu) tai hylkää sen. Hylkäys on lopullinen, mutta
 *  johtaja voi aina lähettää uuden maksun tilalle (kohta 3B.4). Kummankin
 *  painikkeen alla on vahvistusaskel, ettei peruuttamatonta valintaa tehdä
 *  vahingossa yhdellä näpäytyksellä. */
function EraInvoiceSection({ token, view, setView }: { token: string; view: WorkerView; setView: (v: WorkerView) => void }) {
  const invoices = view.eraInvoices || [];
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<{ id: number; action: "send" | "reject" } | null>(null);
  const [err, setErr] = useState("");
  // Harjoittelija ei voi laskuttaa alihankkijana (sama sääntö palvelimella,
  // joka torjuu 400:lla) — piilota "Lähetä"-vaihtoehto ettei nappi näytä
  // toimivalta kun se aina epäonnistuu.
  const isTrainee = !!view.worker.trainee;

  if (invoices.length === 0) return null;

  const respond = async (id: number, action: "send" | "reject") => {
    setErr("");
    setBusyId(id);
    const res = action === "send" ? await api.crewSendEraInvoice(token, id) : await api.crewRejectEraInvoice(token, id);
    setBusyId(null);
    setConfirm(null);
    if (res.ok && res.data?.view) {
      setView(res.data.view);
    } else if (res.ok && res.data?.invoice) {
      // Näkymän uudelleenrakennus epäonnistui serverillä (harvinainen, siihen
      // liittymätön virhe) mutta tilasiirtymä on jo tallessa — päivitä
      // ainakin tämä yksi rivi paikallisesti, ettei kortti jää vanhentuneeksi
      // näyttämään aktiivisia "Lähetä"/"Hylkää"-painikkeita.
      const updated = res.data.invoice;
      setView({ ...view, eraInvoices: (view.eraInvoices || []).map((inv) => (inv.id === updated.id ? updated : inv)) });
    } else {
      setErr(res.error || "Toiminto epäonnistui. Yritä uudelleen.");
    }
  };

  const STATUS: Record<string, { label: string; color: string; bg: string }> = {
    luonnos: { label: "Odottaa lähetystäsi", color: "#E0A800", bg: "rgba(224,168,0,0.14)" },
    hyväksytty: { label: "Lähetetty · lukittu", color: "#7CE0A6", bg: "rgba(124,224,166,0.14)" },
    hylätty: { label: "Hylätty", color: "#FF8A8A", bg: "rgba(224,59,59,0.14)" },
  };
  // Etunimi BRAND_BILLERS:stä (sama lähde kuin MaksutView.tsx:ssä) — pysyy
  // ajan tasalla jos johtajan nimi joskus muuttuu, sen sijaan että se olisi
  // kovakoodattu tänne erikseen.
  const founderName = (id: string) => BRAND_BILLERS.find((b) => b.id === id)?.name.split(" ")[0] || id;
  const eraLabel = (nums: number[]) => (nums.length === 1 ? `Erä ${nums[0]}` : `Erät ${nums[0]}–${nums[nums.length - 1]}`);
  const fiDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fi-FI") : "");

  return (
    <div style={{ marginBottom: 18 }}>
      <p style={{ margin: "0 0 8px", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)" }}>
        FR8-erälaskut
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {invoices.map((inv) => {
          const st = STATUS[inv.tila] || STATUS.luonnos;
          const input = inv.rivit?.input || {};
          const computed = inv.rivit?.computed || {};
          const ikkunat = Number(input.pestytIkkunat) || 0;
          const sovittuMuutos = Number(input.sovittuMuutosCents) || 0;
          const ennakko = Number(input.ennakkoCents) || 0;
          const ansaittu = Number(computed.ansaittuCents) || 0;
          // Sama vero-erittely kuin PayoutsTabissa (ja PDF:ssä, ks. kohta 4:
          // server/routes.ts buildEraInvoicePdfParams) — vero lasketaan koko
          // ansaitusta summasta, ennakko vähennetään sen jälkeen omana rivinään,
          // jotta tekijä näkee saman lopullisen summan kuin laskun PDF:llä.
          // ALV pakotettu pois (ei Puuhapatet eikä yksikään FR8-tekijä ole
          // ALV-rekisterissä) — ennakonpidätys luetaan silti normaalisti.
          const tx = computeTax({
            laborCents: ansaittu,
            vatStatus: "vahainen_toiminta",
            inPrepaymentRegister: readInPrepaymentRegister(view.worker.profile?.answers),
            payeeType: readPayeeType(view.worker.profile?.answers),
          });
          const maksetaanTilille = tx.payableCents - ennakko;
          const confirming = confirm?.id === inv.id ? confirm.action : null;
          const busy = busyId === inv.id;
          return (
            <div key={inv.id} style={{ padding: 16, borderRadius: 14, background: "rgba(255,255,255,0.05)", border: `1px solid ${inv.tila === "luonnos" ? "rgba(224,168,0,0.35)" : "rgba(255,255,255,0.08)"}` }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <div>
                  <p style={{ margin: 0, fontSize: 24, fontWeight: 800, color: "#7CE0A6", fontVariantNumeric: "tabular-nums" }}>{fmtEurCents(maksetaanTilille)}</p>
                  <p style={{ margin: "2px 0 0", fontSize: 12.5, color: "rgba(255,255,255,0.55)" }}>
                    {eraLabel(inv.eraNumbers)} · lasku {founderName(inv.recipientId)}lle
                  </p>
                </div>
                <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, color: st.color, background: st.bg, borderRadius: 999, padding: "5px 10px", whiteSpace: "nowrap" }}>{st.label}</span>
              </div>

              {/* Erittely: mistä maksettava summa muodostuu (kohta 2, kaava 1) +
                  vero (ALV/ennakonpidätys, sama malli kuin PayoutsTab ja PDF). */}
              <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 10, background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.06)", fontSize: 12.5 }}>
                {([
                  // Ei "× 20 €": lasku voi sisältää sekä punaisia omalla
                  // taksallaan että keltaisia palkkiotaulukon mukaan, jolloin
                  // yhtä kerrointa ei ole. Rivi kertoo määrän ja summan; keksitty
                  // yksikköhinta ei tekisi siitä tarkistettavampaa vaan väärän.
                  [`Pestyt ikkunat ${ikkunat.toLocaleString("fi-FI", { maximumFractionDigits: 1 })}`, fmtEurCents(ansaittu - sovittuMuutos), "rgba(255,255,255,0.7)"],
                  ...(sovittuMuutos !== 0 ? [["Sovittu muutos", `${sovittuMuutos > 0 ? "+ " : "− "}${fmtEurCents(Math.abs(sovittuMuutos))}`, "rgba(255,255,255,0.7)"]] : []),
                  ...(tx.vatRegistered ? [[`ALV ${fmtPct(tx.vatRate)}`, "+ " + fmtEurCents(tx.vatCents), "rgba(255,255,255,0.7)"]] : []),
                  ...(tx.withheld ? [[`Ennakonpidätys ${fmtPct(tx.withholdingRate)}`, "− " + fmtEurCents(tx.withholdingCents), "#E0A800"]] : []),
                  ...(ennakko > 0 ? [["Ennakko / jo maksettu", "− " + fmtEurCents(ennakko), "#E0A800"]] : []),
                ] as [string, string, string][]).map(([lbl, val, col]) => (
                  <div key={lbl} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", color: col }}>
                    <span>{lbl}</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{val}</span>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0 0", marginTop: 4, borderTop: "1px solid rgba(255,255,255,0.1)", fontWeight: 700, color: "#7CE0A6" }}>
                  <span>Maksetaan tilillesi</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{fmtEurCents(maksetaanTilille)}</span>
                </div>
                {tx.withheld && (
                  <p style={{ margin: "8px 0 0", fontSize: 11, color: "rgba(255,255,255,0.45)", lineHeight: 1.5 }}>
                    Et ole ennakkoperintärekisterissä, joten pidätämme veron ja tilitämme sen Verolle. Rekisteröidy maksutta{" "}
                    <a href="https://www.ytj.fi" target="_blank" rel="noreferrer" style={{ color: "#E0A800" }}>ytj.fi</a>ssä saadaksesi koko summan tilille.
                  </p>
                )}
              </div>

              {inv.tila === "hyväksytty" && (
                <>
                  <p style={{ margin: "10px 0 0", fontSize: 11.5, color: "rgba(255,255,255,0.45)" }}>
                    Lähetetty {fiDate(inv.sentAt)}{inv.invoiceNumber ? ` · laskunumero ${inv.invoiceNumber}` : ""}{inv.referenceNumber ? ` · viite ${inv.referenceNumber}` : ""}.
                    Lasku on lukittu — sitä ei voi lähettää uudelleen.
                  </p>
                  <a href={api.crewEraInvoicePdfUrl(token, inv.id)} target="_blank" rel="noreferrer"
                    style={{ display: "inline-block", marginTop: 8, fontSize: 12, fontWeight: 600, color: "#7CE0A6", textDecoration: "underline" }}>
                    Lataa lasku (PDF)
                  </a>
                </>
              )}
              {/* "hylätty" tarkoittaa KAHTA eri tapahtumaa, ja ne erottaa
                  laskunumero: luonnoksella ei ole numeroa (tekijä hylkäsi sen
                  ennen lähetystä), lähetetyllä on (johtaja mitätöi sen jälkikäteen).
                  Aiemmin molemmille luki "Hylkäsit tämän laskun" — mikä oli
                  suorastaan väärin siinä tapauksessa jossa tekijä oli itse
                  lähettänyt laskun ja johtaja mitätöi sen. Mitätöity lasku on
                  yhä tosite, joten sen PDF pysyy ladattavissa. */}
              {inv.tila === "hylätty" && (
                inv.invoiceNumber ? (
                  <>
                    <p style={{ margin: "10px 0 0", fontSize: 11.5, color: "rgba(255,255,255,0.45)" }}>
                      Johtaja mitätöi tämän laskun {fiDate(inv.respondedAt)} — sitä ei makseta.
                      Lasku {inv.invoiceNumber} säilyy silti kirjanpidon tositteena, ja korvaava lasku tulee omanaan.
                    </p>
                    <a href={api.crewEraInvoicePdfUrl(token, inv.id)} target="_blank" rel="noreferrer"
                      style={{ display: "inline-block", marginTop: 8, fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.55)", textDecoration: "underline" }}>
                      Lataa mitätöity lasku (PDF)
                    </a>
                  </>
                ) : (
                  <p style={{ margin: "10px 0 0", fontSize: 11.5, color: "rgba(255,255,255,0.45)" }}>
                    Hylkäsit tämän laskun {fiDate(inv.respondedAt)}. Johtaja voi lähettää uuden tilalle.
                  </p>
                )
              )}

              {inv.tila === "luonnos" && (
                <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
                  {confirming === "send" ? (
                    <>
                      <button disabled={busy} onClick={() => respond(inv.id, "send")}
                        style={{ flex: 1, padding: "12px 14px", borderRadius: 12, border: "none", cursor: "pointer", fontFamily: FONT, fontSize: 13.5, fontWeight: 700, background: "#7CE0A6", color: "#06231A", opacity: busy ? 0.5 : 1 }}>
                        {busy ? "Lähetetään…" : "Vahvista — lähetä lasku"}
                      </button>
                      <button disabled={busy} onClick={() => setConfirm(null)}
                        style={{ padding: "12px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.14)", cursor: "pointer", fontFamily: FONT, fontSize: 13.5, fontWeight: 600, background: "none", color: "rgba(255,255,255,0.7)" }}>
                        Peruuta
                      </button>
                    </>
                  ) : confirming === "reject" ? (
                    <>
                      <button disabled={busy} onClick={() => respond(inv.id, "reject")}
                        style={{ flex: 1, padding: "12px 14px", borderRadius: 12, border: "none", cursor: "pointer", fontFamily: FONT, fontSize: 13.5, fontWeight: 700, background: "#E03B3B", color: "#fff", opacity: busy ? 0.5 : 1 }}>
                        {busy ? "Hylätään…" : "Vahvista — hylkää lasku"}
                      </button>
                      <button disabled={busy} onClick={() => setConfirm(null)}
                        style={{ padding: "12px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.14)", cursor: "pointer", fontFamily: FONT, fontSize: 13.5, fontWeight: 600, background: "none", color: "rgba(255,255,255,0.7)" }}>
                        Peruuta
                      </button>
                    </>
                  ) : (
                    <>
                      {!isTrainee && (
                        <button onClick={() => setConfirm({ id: inv.id, action: "send" })}
                          style={{ flex: 1, padding: "12px 14px", borderRadius: 12, border: "none", cursor: "pointer", fontFamily: FONT, fontSize: 13.5, fontWeight: 700, background: "#7CE0A6", color: "#06231A" }}>
                          Lähetä lasku
                        </button>
                      )}
                      <button onClick={() => setConfirm({ id: inv.id, action: "reject" })}
                        style={{ flex: isTrainee ? 1 : undefined, padding: "12px 14px", borderRadius: 12, border: "1px solid rgba(224,59,59,0.5)", cursor: "pointer", fontFamily: FONT, fontSize: 13.5, fontWeight: 600, background: "none", color: "#FF8A8A" }}>
                        Hylkää
                      </button>
                    </>
                  )}
                </div>
              )}
              {inv.tila === "luonnos" && isTrainee && (
                <p style={{ margin: "8px 0 0", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
                  Harjoittelijana et voi laskuttaa itse — maksu hoidetaan tiimin kautta.
                </p>
              )}
            </div>
          );
        })}
      </div>
      {err && <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "#FF8A8A" }}>{err}</p>}
      <p style={{ margin: "14px 0 0", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)" }}>
        Muut maksut
      </p>
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
  const payeeType = readPayeeType(answers);
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: b.name || "", yTunnus: b.yTunnus || "", iban: b.iban || "", address: b.address || "" });
  // Worker's own deductible kulut entered while approving — optional. These never
  // change what Puuhapatet pays; they're recorded on the invoice so the worker can
  // deduct them in their own taxation.
  const [exp, setExp] = useState<{ id: string; desc: string; amount: string; receiptDataUrl?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const newExpId = () => `pe_${Math.random().toString(36).slice(2, 9)}`;
  const addExpRow = () => setExp((xs) => [...xs, { id: newExpId(), desc: "", amount: "" }]);
  const setExpAt = (id: string, patch: Partial<{ desc: string; amount: string; receiptDataUrl?: string }>) =>
    setExp((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const removeExp = (id: string) => setExp((xs) => xs.filter((x) => x.id !== id));
  const pickReceipt = async (id: string, file?: File) => {
    if (!file) return;
    try { setExpAt(id, { receiptDataUrl: await fileToReceiptDataUrl(file) }); }
    catch { /* ignore bad image */ }
  };

  const approve = async (id: string) => {
    setErr("");
    if (!form.name.trim()) return setErr("Täytä laskuttajan nimi.");
    if (!form.iban.trim()) return setErr("Täytä IBAN, jolle maksu maksetaan.");
    // Only keep complete kulut rows (description + a positive amount).
    const expenses = exp
      .map((x) => ({ id: x.id, desc: x.desc.trim(), amountCents: Math.round(parseFloat(x.amount.replace(",", ".")) * 100), receiptDataUrl: x.receiptDataUrl }))
      .filter((x) => x.desc && Number.isFinite(x.amountCents) && x.amountCents > 0);
    setBusy(true);
    const res = await api.crewApprovePayout(token, id, {
      name: form.name.trim(), yTunnus: form.yTunnus.trim() || undefined,
      iban: form.iban.trim(), address: form.address.trim() || undefined,
    }, expenses.length ? expenses : undefined);
    setBusy(false);
    if (res.ok && res.data?.view) { setView(res.data.view); setOpenId(null); setExp([]); }
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

      {/* FR8 erälaskut ensin — luonnokset odottavat tekijän omaa toimintaa. */}
      <EraInvoiceSection token={token} view={view} setView={setView} />

      {payouts.length === 0 && (view.eraInvoices || []).length === 0 && (
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
          const tx = p.tax ?? computeTax({ laborCents: p.amountCents, vatStatus, inPrepaymentRegister: inRegister, payeeType });
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

              {(p.expenses || []).length > 0 && (() => {
                const expTotal = (p.expenses || []).reduce((s, e) => s + e.amountCents, 0);
                const taxableAfter = Math.max(0, tx.laborCents - expTotal);
                return (
                  <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 10, background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.06)", fontSize: 12.5 }}>
                    <p style={{ margin: "0 0 6px", fontSize: 11, letterSpacing: "0.04em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)" }}>Vähennyskelpoiset kulut</p>
                    {(p.expenses || []).map((e) => (
                      <div key={e.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "3px 0", color: "rgba(255,255,255,0.7)" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          {e.receiptDataUrl && <img src={e.receiptDataUrl} alt="" style={{ width: 22, height: 22, borderRadius: 4, objectFit: "cover" }} />}
                          {e.desc}
                        </span>
                        <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmtEurCents(e.amountCents)}</span>
                      </div>
                    ))}
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0 0", marginTop: 4, borderTop: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.85)" }}>
                      <span>Verotettava kulujen jälkeen (arvio)</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{fmtEurCents(taxableAfter)}</span>
                    </div>
                    <p style={{ margin: "8px 0 0", fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.5 }}>
                      Ei vaikuta maksettavaan summaan. Näkyvät laskullasi, jotta voit vähentää ne omassa verotuksessasi. Säilytä kuitit.
                    </p>
                  </div>
                );
              })()}

              {p.status === "maksettu" && p.invoiceNo && (
                <div style={{ margin: "12px 0 0" }}>
                  <p style={{ margin: 0, fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
                    Laskusi {p.invoiceNo} luotu{p.paidAt ? ` · ${new Date(p.paidAt).toLocaleDateString("fi-FI")}` : ""}.
                  </p>
                  <a
                    href={`/api/crew/${token}/payout/${p.id}/invoice.pdf`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ display: "inline-flex", alignItems: "center", gap: 7, marginTop: 9, padding: "8px 13px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.16)", background: "rgba(255,255,255,0.05)", color: "#fff", fontSize: 12.5, fontWeight: 600, textDecoration: "none" }}
                  >
                    Lataa lasku (PDF)
                  </a>
                </div>
              )}

              {p.status === "ilmoitettu" && !open && (
                <button onClick={() => { setOpenId(p.id); setErr(""); setExp([]); }} style={{ ...primaryBtn, background: T.green, marginTop: 14 }}>
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

                  {/* Optional deductible kulut — added to the worker's invoice so
                      they can deduct them in their own taxation. Does NOT change
                      the paid amount. */}
                  <div style={{ marginTop: 6, marginBottom: 4, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                    <p style={{ margin: "0 0 3px", fontSize: 12, color: "rgba(255,255,255,0.55)" }}>Vähennyskelpoiset kulut (valinnainen)</p>
                    <p style={{ margin: "0 0 10px", fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.5 }}>
                      Omat työhön liittyvät kulusi (esim. tarvikkeet, matkat). Lisätään laskullesi vähennyksiä varten — ei vaikuta maksettavaan summaan.
                    </p>
                    {exp.map((x) => (
                      <div key={x.id} style={{ marginBottom: 10, padding: 10, borderRadius: 10, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}>
                        <div style={{ display: "flex", gap: 8 }}>
                          <input
                            value={x.desc}
                            onChange={(e) => setExpAt(x.id, { desc: e.target.value })}
                            placeholder="Kulun nimi (esim. lasinpesuaine)"
                            style={{ ...inputStyle, flex: 1, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", color: "#fff" }}
                          />
                          <input
                            value={x.amount}
                            onChange={(e) => setExpAt(x.id, { amount: e.target.value })}
                            inputMode="decimal"
                            placeholder="€"
                            style={{ ...inputStyle, width: 76, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", color: "#fff", textAlign: "right" }}
                          />
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                          <label style={{ display: "inline-flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: 12, color: "rgba(255,255,255,0.6)" }}>
                            {x.receiptDataUrl ? (
                              <img src={x.receiptDataUrl} alt="kuitti" style={{ width: 34, height: 34, borderRadius: 6, objectFit: "cover", border: "1px solid rgba(255,255,255,0.15)" }} />
                            ) : (
                              <span style={{ display: "inline-flex", width: 34, height: 34, borderRadius: 6, border: "1px dashed rgba(255,255,255,0.25)", alignItems: "center", justifyContent: "center" }}>📷</span>
                            )}
                            {x.receiptDataUrl ? "Vaihda kuitti" : "Lisää kuitti (valinn.)"}
                            <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => pickReceipt(x.id, e.target.files?.[0])} />
                          </label>
                          <button onClick={() => removeExp(x.id)} style={{ marginLeft: "auto", background: "transparent", border: "none", color: "rgba(255,154,154,0.9)", fontSize: 12, cursor: "pointer" }}>Poista</button>
                        </div>
                      </div>
                    ))}
                    <button onClick={addExpRow} style={{ ...secondaryBtn, width: "100%", fontSize: 12.5 }}>+ Lisää kulu</button>
                  </div>

                  {err && <p style={{ margin: "0 0 8px", fontSize: 12.5, color: "#FF9A9A" }}>{err}</p>}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => approve(p.id)} disabled={busy} style={{ ...primaryBtn, background: T.green, flex: 1, opacity: busy ? 0.6 : 1 }}>
                      {busy ? "Hyväksytään…" : "Hyväksy maksu"}
                    </button>
                    <button onClick={() => { setOpenId(null); setExp([]); }} style={{ ...secondaryBtn, flex: "0 0 auto" }}>Peruuta</button>
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

function HoursTab({ token, view, setView, notify }: { token: string; view: WorkerView; setView: (v: WorkerView) => void; notify: (t: string) => void }) {
  // Deliberately simple: this view only tracks PRESENCE at the job site for the
  // bosses (total time on location). No running clock, no windows, no €/h — the
  // worker just presses "Aloita työaika" when they arrive, can pause for a break,
  // and "Päätä työaika" when they leave. Pay is shown elsewhere; the live
  // pay-per-hour read-out was removed on purpose.
  const breakKey = `pp_shift_break_${token}`;

  // The running shift's start lives on the SERVER (view.worker.activeShiftAt) so it
  // survives a refresh / reopen. Break time is local-only and mirrored to
  // localStorage so a mid-shift refresh keeps the break deduction.
  const [running, setRunning] = useState<number | null>(view.worker.activeShiftAt ?? null);
  const [breakMs, setBreakMs] = useState(0);          // accumulated break time this shift
  const [onBreak, setOnBreak] = useState<number | null>(null); // break start ms, if paused
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);          // brief "tallennettu" confirmation
  const hourly = view.billingMode === "hourly";
  /** Tuntitilassa: montako tuntia palvelin kirjasi juuri päättyneestä vuorosta. */
  const [credited, setCredited] = useState<number | null>(null);
  const [targetBusy, setTargetBusy] = useState(false);
  const target = view.worker.shiftTargetHours ?? null;
  /**
   * Kello tikittää minuutin välein VAIN tavoitteen tarkistusta varten — tekijä
   * ei näe kuluvaa aikaa (ks. `BillingMode`), joten tiheämpi päivitys ei
   * hyödyttäisi mitään ja söisi akkua työmaalla.
   */
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!running || !target) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 60_000);
    return () => window.clearInterval(t);
  }, [running, target]);
  /** Tavoite täynnä? Tauot eivät kerrytä työaikaa, joten ne vähennetään. */
  const targetReached = (() => {
    void tick;
    if (!running || !target) return false;
    const worked = Date.now() - running - (breakMs + (onBreak ? Date.now() - onBreak : 0));
    return worked >= target * 3_600_000;
  })();

  const setTargetHours = async (h: number | null) => {
    setTargetBusy(true);
    const res = await api.crewSetShiftTarget(token, h);
    setTargetBusy(false);
    if (res.ok && res.data?.view) setView(res.data.view);
    else notify(res.error || "Tavoitteen tallennus ei onnistunut.");
  };

  // Keep the running flag in sync with the server (shift started/ended elsewhere,
  // and a clean reset once work is ended).
  useEffect(() => { setRunning(view.worker.activeShiftAt ?? null); }, [view.worker.activeShiftAt]);

  // Restore saved break state on mount — only if it belongs to the shift that's
  // still running on the server (otherwise it's stale and ignored).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(breakKey);
      if (!raw) return;
      const savedState = JSON.parse(raw) as { start?: number; breakMs?: number; onBreak?: number | null };
      if (savedState.start && view.worker.activeShiftAt && savedState.start === view.worker.activeShiftAt) {
        setBreakMs(savedState.breakMs ?? 0);
        setOnBreak(savedState.onBreak ?? null);
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror break state to localStorage while a shift runs; clear it otherwise.
  useEffect(() => {
    try {
      if (running) localStorage.setItem(breakKey, JSON.stringify({ start: running, breakMs, onBreak }));
      else localStorage.removeItem(breakKey);
    } catch { /* private mode */ }
  }, [running, breakMs, onBreak, breakKey]);

  const start = async () => {
    if (busy) return;
    const now = Date.now();
    setRunning(now); setBreakMs(0); setOnBreak(null); setSaved(false);
    const res = await api.crewShift(token, true);
    if (res.ok && res.data?.view) setView(res.data.view);
    else {
      // Palvelin ei kirjannut vuoroa → älä näytä haamukelloa. Ennen tämä
      // peruuntui äänettömästi: kello ilmestyi ja katosi, eikä tekijä tiennyt
      // alkoiko työaika vai ei.
      setRunning(null);
      notify(res.error || "Työajan aloitus ei onnistunut. Tarkista yhteys ja yritä uudelleen.");
    }
  };

  const toggleBreak = () => {
    if (onBreak) { setBreakMs((b) => b + (Date.now() - onBreak)); setOnBreak(null); }
    else setOnBreak(Date.now());
  };

  /**
   * TYÖAJAN PÄÄTÖS — EI SAA NOLLATA KELLOA ENNEN KUIN PALVELIN ON KIRJANNUT SEN.
   *
   * Tämä nollasi ennen paikallisen tilan JA pyyhki taukotiedon localStoragesta
   * ehdoitta, ennen kuin vastausta oli katsottu. Kahdeksan tunnin vuoron
   * päättäminen katkenneella yhteydellä hävitti siis koko vuoron: palvelin ei
   * kirjannut mitään, kello nollautui, eikä mikään kertonut siitä. Se on
   * maksamatta jäänyt työpäivä, ei käyttöliittymäongelma.
   *
   * Nyt kello ja tauot jäävät paikalleen kunnes kirjaus on varmasti mennyt
   * läpi, ja epäonnistuminen sanotaan ääneen — vuoron voi päättää uudelleen.
   * Tuntikirjaus tarkistetaan myös: se meni ennen samaan tyhjyyteen.
   */
  const endWork = async () => {
    if (!running || busy) return;
    setBusy(true);
    const totalBreak = breakMs + (onBreak ? Date.now() - onBreak : 0);
    const minutes = Math.max(0, Math.round((Date.now() - running - totalBreak) / 60000));
    const hours = Math.round((minutes / 60) * 100) / 100;
    /**
     * TUNTITILASSA TUNNIT SYNTYVÄT PALVELIMELLA, EI TÄÄLLÄ.
     *
     * Ne ovat siellä palkka, ja palkan perusteeksi ei kelpaa selaimen lähettämä
     * luku — eikä kaksi erillistä pyyntöä, joista toinen voi onnistua ja toinen
     * ei (vuoro kirjautuisi ilman tunteja). Vuoron päätös kirjaa molemmat
     * samassa tallennuksessa ja pyöristää lähimpään täyteen tuntiin.
     *
     * Kohdennetussa tilassa käytös on ennallaan: tarkat tunnit omalla
     * pyynnöllään, seurantatietona.
     */
    const hoursRes = !hourly && hours > 0 ? await api.crewAddHours(token, hours) : null;
    const res = await api.crewShift(token, false, minutes);                    // vuoro + kesto
    setBusy(false);
    if (!res.ok || !res.data?.view) {
      notify(res.error || "Työajan päätös ei tallentunut. Kello jää käyntiin — yritä uudelleen.");
      return;
    }
    setView(res.data.view);
    setRunning(null); setOnBreak(null); setBreakMs(0);
    try { localStorage.removeItem(breakKey); } catch { /* */ }
    if (hoursRes && !hoursRes.ok) {
      // Vuoro kirjattiin mutta tunnit eivät. Kerro se: johtajan tuntilista
      // jäisi muuten vajaaksi kenenkään huomaamatta.
      notify("Vuoro päättyi, mutta tunnit eivät kirjautuneet. Lisää ne käsin tuntinäkymästä.");
      return;
    }
    setSaved(true);
    setCredited(hourly ? (res.data.creditedHours ?? 0) : null);
    setTimeout(() => { setSaved(false); setCredited(null); }, 6000);
  };

  const statusLabel = onBreak ? "Tauolla" : running ? "Työaika käynnissä" : "Et ole töissä";
  const statusColor = onBreak ? "#E0A800" : running ? "#7CE0A6" : "rgba(255,255,255,0.55)";

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: 20 }}>
      <div style={{ padding: "26px 20px", borderRadius: 18, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", textAlign: "center" }}>
        {/* Status — a label + dot, never a running clock */}
        <div style={{ display: "inline-flex", alignItems: "center", gap: 9, padding: "8px 16px", borderRadius: 999, background: "rgba(255,255,255,0.05)", border: `1px solid ${running ? (onBreak ? "rgba(224,168,0,0.35)" : "rgba(124,224,166,0.35)") : "rgba(255,255,255,0.12)"}` }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: statusColor, boxShadow: running && !onBreak ? "0 0 9px rgba(124,224,166,0.9)" : undefined, animation: running && !onBreak ? "ppPulse 1.8s ease-in-out infinite" : undefined }} />
          <span style={{ fontSize: 15, fontWeight: 700, color: statusColor }}>{statusLabel}</span>
        </div>
        <style>{`@keyframes ppPulse{0%,100%{opacity:1}50%{opacity:.35}}`}</style>

        {/* Big primary action */}
        <div style={{ marginTop: 22 }}>
          {!running ? (
            <button onClick={start} disabled={busy} style={{ ...primaryBtn, background: T.green, fontSize: 17, padding: "16px", opacity: busy ? 0.6 : 1 }}>
              Aloita työaika
            </button>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <button onClick={toggleBreak} disabled={busy} style={{ ...primaryBtn, fontSize: 16, padding: "15px", color: "#fff", background: onBreak ? "rgba(224,168,0,0.18)" : "rgba(255,255,255,0.07)", border: `1px solid ${onBreak ? "rgba(224,168,0,0.4)" : "rgba(255,255,255,0.18)"}` }}>
                {onBreak ? "Jatka työtä" : "Pidä tauko"}
              </button>
              <button onClick={endWork} disabled={busy} style={{ ...primaryBtn, fontSize: 17, padding: "16px", background: "#D9472B", opacity: busy ? 0.6 : 1 }}>
                {busy ? "Päätetään…" : "Päätä työaika"}
              </button>
            </div>
          )}
        </div>

        {/* OMA TAVOITE. Tuntitilassa tekijä ei näe kertyneitä tunteja, joten
            päivällä ei olisi mittaria lainkaan. Tavoite on se mittari: se ei
            rajoita mitään eikä vaikuta palkkaan — se vain sanoo kun sovittu
            määrä on täynnä. Näkyy vain vuoron ollessa käynnissä, koska se
            koskee tätä vuoroa eikä ole pysyvä asetus. */}
        {hourly && running && (
          <div style={{ marginTop: 20, paddingTop: 18, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
            {targetReached ? (
              <div style={{ padding: "12px 14px", borderRadius: 12, background: "rgba(124,224,166,0.12)", border: "1px solid rgba(124,224,166,0.4)" }}>
                <p style={{ margin: 0, color: "#7CE0A6", fontSize: 14.5, fontWeight: 700 }}>✓ Tavoite saavutettu</p>
                <p style={{ margin: "4px 0 0", color: "rgba(255,255,255,0.55)", fontSize: 12.5, lineHeight: 1.5 }}>
                  {target} h täynnä. Voit jatkaa tai päättää työajan.
                </p>
              </div>
            ) : (
              <>
                <p style={{ margin: "0 0 10px", color: "rgba(255,255,255,0.5)", fontSize: 12.5 }}>
                  {target ? `Tavoite tälle päivälle: ${target} h` : "Aseta tavoite tälle päivälle (vapaaehtoinen)"}
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                  {[2, 3, 4, 6, 8].map((h) => {
                    const on = target === h;
                    return (
                      <button key={h} disabled={targetBusy}
                        onClick={() => setTargetHours(on ? null : h)}
                        style={{
                          padding: "8px 15px", borderRadius: 999, cursor: "pointer",
                          fontFamily: FONT, fontSize: 13.5, fontWeight: 700,
                          border: `1px solid ${on ? "rgba(124,224,166,0.5)" : "rgba(255,255,255,0.16)"}`,
                          background: on ? "rgba(124,224,166,0.14)" : "rgba(255,255,255,0.04)",
                          color: on ? "#7CE0A6" : "rgba(255,255,255,0.7)",
                          opacity: targetBusy ? 0.6 : 1,
                        }}>
                        {h} h
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        <p style={{ color: "rgba(255,255,255,0.45)", fontSize: 12.5, marginTop: 18, lineHeight: 1.55 }}>
          Aloita työaika kun saavut työmaalle ja päätä se kun lähdet. Pidä tauko esimerkiksi
          ruokatauon ajaksi — tauot eivät kerry työaikaan. Aika tallentuu automaattisesti.
          {hourly && " Työaika pyöristetään lähimpään täyteen tuntiin."}
        </p>
        {saved && (
          <p style={{ color: "#7CE0A6", fontSize: 13, fontWeight: 700, marginTop: 12 }}>
            ✓ Työaika tallennettu
            {credited != null && (credited > 0
              ? ` — ${credited} h kirjattu`
              : " — alle puoli tuntia, ei kirjattua tuntia")}
          </p>
        )}
      </div>

      <WorkerExpenses token={token} view={view} setView={setView} />
    </div>
  );
}

/** Expense logger for workers/subcontractors — shown below shift controls. */
function WorkerExpenses({ token, view, setView }: { token: string; view: WorkerView; setView: (v: WorkerView) => void }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("transport");
  const [desc, setDesc] = useState("");
  const [euros, setEuros] = useState("");
  const [busy, setBusy] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);
  const expenses = view.expenses ?? [];

  const KINDS: [string, string][] = [
    ["transport", "Kuljetus"],
    ["materials", "Tarvikkeet"],
    ["equipment", "Kalusto"],
    ["other", "Muu"],
  ];

  const add = async () => {
    const cents = Math.round(parseFloat(euros.replace(",", ".")) * 100);
    if (!cents || cents <= 0) return;
    setBusy(true);
    const res = await api.crewAddExpense(token, { kind, desc: desc.trim(), amountCents: cents });
    setBusy(false);
    if (res.ok && res.data?.expenses) {
      setView({ ...view, expenses: res.data.expenses });
      setDesc(""); setEuros(""); setKind("transport");
    }
  };

  const del = async (id: string) => {
    if (!confirm("Poistetaanko kulumerkintä?")) return;
    const res = await api.crewDeleteExpense(token, id);
    if (res.ok && res.data?.expenses) setView({ ...view, expenses: res.data.expenses });
  };

  const fmtDate = (ts: number) => new Date(ts).toLocaleDateString("fi-FI", { day: "numeric", month: "numeric" });
  const totalCents = expenses.reduce((s, e) => s + e.amountCents, 0);

  return (
    <div style={{ marginTop: 16, padding: "18px 18px", borderRadius: 18, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: open || expenses.length > 0 ? 12 : 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.85)" }}>Kulut</span>
          {expenses.length > 0 && (
            <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.55)" }}>
              {expenses.length} · {(totalCents / 100).toFixed(2)} €
            </span>
          )}
          <button
            type="button"
            onClick={() => setTipOpen((v) => !v)}
            style={{ width: 18, height: 18, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.06)", cursor: "pointer", fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.55)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontFamily: FONT }}
          >?</button>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{ fontSize: 12.5, fontWeight: 600, padding: "6px 13px", borderRadius: 10, cursor: "pointer", border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.75)", fontFamily: FONT }}
        >
          {open ? "Sulje" : "+ Lisää kulu"}
        </button>
      </div>

      {tipOpen && (
        <div style={{ marginBottom: 12, padding: "12px 14px", borderRadius: 12, background: "rgba(62,124,89,0.12)", border: "1px solid rgba(62,124,89,0.3)", fontSize: 12.5, color: "rgba(255,255,255,0.7)", lineHeight: 1.55, fontFamily: FONT }}>
          <strong style={{ color: "rgba(255,255,255,0.9)" }}>Mitä voi merkitä kuluksi?</strong>
          <ul style={{ margin: "6px 0 0 16px", padding: 0 }}>
            <li><b>Kuljetus</b> — polttoaine, parkkimaksut, tietullit (keikan vuoksi)</li>
            <li><b>Tarvikkeet</b> — pesuaineet, mikrokuitu, muu materiaali (keikalle ostettu)</li>
            <li><b>Kalusto</b> — vuokrakalusto tai laitteet keikan tarpeisiin</li>
            <li><b>Muu</b> — muut suorat kulut, joista on tai tulee tosite</li>
          </ul>
          <p style={{ margin: "6px 0 0", fontSize: 11.5, color: "rgba(255,255,255,0.45)" }}>Henkilökohtaiset kulut (ruoka, puhelin jne.) eivät kuulu tähän.</p>
        </div>
      )}

      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 9, marginBottom: 14 }}>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            style={{ width: "100%", padding: "10px 12px", borderRadius: 11, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.06)", color: "#fff", fontSize: 14, fontFamily: FONT, cursor: "pointer" }}
          >
            {KINDS.map(([v, l]) => <option key={v} value={v} style={{ background: "#1a1a1a" }}>{l}</option>)}
          </select>
          <input
            placeholder="Kuvaus (esim. polttoaine Bulevardi)"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            style={{ width: "100%", padding: "10px 12px", borderRadius: 11, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.06)", color: "#fff", fontSize: 14, fontFamily: FONT, boxSizing: "border-box" }}
          />
          <div style={{ display: "flex", gap: 9 }}>
            <input
              placeholder="Summa €"
              type="text"
              inputMode="decimal"
              value={euros}
              onChange={(e) => setEuros(e.target.value)}
              style={{ flex: 1, padding: "10px 12px", borderRadius: 11, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.06)", color: "#fff", fontSize: 14, fontFamily: FONT }}
            />
            <button
              onClick={add}
              disabled={busy || !euros}
              style={{ padding: "10px 20px", borderRadius: 11, cursor: "pointer", border: "none", background: T.green, color: "#fff", fontSize: 14, fontWeight: 700, fontFamily: FONT, opacity: busy || !euros ? 0.5 : 1 }}
            >
              {busy ? "…" : "Lisää"}
            </button>
          </div>
        </div>
      )}

      {expenses.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {expenses.slice().sort((a, b) => b.ts - a.ts).map((e) => {
            const kindLabel = KINDS.find(([v]) => v === e.kind)?.[1] ?? e.kind;
            return (
              <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 12px", borderRadius: 11, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 6, background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.55)", flexShrink: 0 }}>{kindLabel}</span>
                <span style={{ flex: 1, fontSize: 13, color: "rgba(255,255,255,0.8)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.desc || "—"}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.85)", flexShrink: 0 }}>{(e.amountCents / 100).toFixed(2)} €</span>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", flexShrink: 0 }}>{fmtDate(e.ts)}</span>
                <button onClick={() => del(e.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.3)", fontSize: 16, lineHeight: 1, padding: "0 2px", flexShrink: 0 }}>×</button>
              </div>
            );
          })}
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
      <p style={{ margin: "0 0 4px", fontSize: 11.5, color: "rgba(255,255,255,0.4)", lineHeight: 1.5 }}>
        Jos liikevaihtosi on alle ~20 000 € / kalenterivuosi, voit toimia ilman ALV:tä (AVL 3 §). Tarkista vero.fi.
      </p>
      <p style={{ margin: "0", fontSize: 11.5, color: "rgba(255,255,255,0.4)", lineHeight: 1.5 }}>
        Saat koko summan tilillesi ja hoidat verosi itse — Puuhapatet ei pidätä veroa maksusta.
      </p>
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

/**
 * "Oma sopimus" — tekijän pääsy siihen mitä hän allekirjoitti.
 *
 * MIKSI TÄMÄ PUUTTUI JA MIKSI SE ON ONGELMA: tekijä piirtää allekirjoituksensa
 * onboardingissa, ja sen jälkeen sopimus katoaa hänen ulottuviltaan kokonaan.
 * Onboarding-näkymä renderöityy vain kun `!onboarded || needsToSign`, eikä
 * työpöydällä ollut yhtään linkkiä sopimustekstiin. Palvelin ei edes lähettänyt
 * allekirjoitusta takaisin — workerView tarjosi vain `signedAgreementIds`, eli
 * listan id-merkkijonoja. Tekijä oli siis sitoutunut kilpailukieltoon,
 * sopimussakkoon ja asiakassuojaan pystymättä lukemaan niistä sanaakaan.
 *
 * Sama dokumentti on ollut olemassa koko ajan — johtaja on voinut ladata sen
 * Tiimi-sivulta (`buildWorkerContractHtml`). Vain toinen osapuoli näki
 * sopimuksen. Nyt molemmat näkevät saman tiedoston, samasta rakentajasta.
 *
 * HAKU ON LAISKA. Allekirjoitus on PNG data URL, enintään 300 kB kappale, ja
 * niitä on yksi per sopimus. Jos ne olisivat workerView'ssä, ne latautuisivat
 * uudestaan joka kerta kun tekijä avaa työpöydän — satoja megatavuja päivässä
 * asiasta jota katsotaan ehkä kerran. Haku tapahtuu vasta napin painalluksesta.
 */
function ContractCard({ token, view }: { token: string; view: WorkerView }) {
  const [busy, setBusy] = useState<"" | "download" | "print">("");
  const [err, setErr] = useState<string | null>(null);
  const signedCount = view.worker.signedAgreementIds?.length ?? 0;

  // Ei allekirjoitusta → ei mitään näytettävää. Kortti ei ilmesty tyhjänä.
  if (signedCount === 0) return null;

  const run = async (mode: "download" | "print") => {
    setBusy(mode); setErr(null);
    const res = await api.getCrewContract(token);
    setBusy("");
    if (!res.ok || !res.data?.member) {
      setErr(res.error || "Sopimusta ei saatu haettua.");
      return;
    }
    const input = {
      member: res.data.member,
      buildingName: res.data.buildingName,
      buildingAddress: res.data.buildingAddress,
    };
    if (mode === "download") downloadWorkerContract(input);
    else openWorkerContractForPrint(input);
  };

  return (
    <div style={{ padding: 16, borderRadius: 16, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", marginBottom: 18 }}>
      <p style={{ margin: "0 0 4px", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)" }}>Oma sopimus</p>
      <p style={{ margin: "0 0 12px", fontSize: 13, lineHeight: 1.5, color: "rgba(255,255,255,0.75)" }}>
        Allekirjoitit {signedCount === 1 ? "yhden sopimuksen" : `${signedCount} sopimusta`}. Koko teksti,
        hyväksymäsi kohdat ja allekirjoituksesi ovat tallessa — saat ne itsellesi milloin tahansa.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          onClick={() => void run("download")}
          disabled={!!busy}
          style={{ ...secondaryBtn, flex: 1, minWidth: 130, borderColor: "rgba(255,255,255,0.22)", color: "#fff", opacity: busy ? 0.6 : 1 }}
        >
          {busy === "download" ? "Haetaan…" : "Lataa sopimus"}
        </button>
        <button
          onClick={() => void run("print")}
          disabled={!!busy}
          style={{ ...secondaryBtn, flex: 1, minWidth: 130, borderColor: "rgba(255,255,255,0.22)", color: "rgba(255,255,255,0.7)", opacity: busy ? 0.6 : 1 }}
        >
          {busy === "print" ? "Haetaan…" : "Avaa luettavaksi"}
        </button>
      </div>
      {err && <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "#ffb0b0" }}>{err}</p>}
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
      <ContractCard token={token} view={view} />
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
