/**
 * FR8 projektinäkymä — admin tool page (protected).
 *
 * Hosts the ported floor-plan window tool (dashboard + per-floor mapping +
 * work hours) and persists everything to the database via /api/jobs/:id/project.
 * Replaces the prototype's localStorage with debounced server autosave and adds
 * per-worker attribution so the dashboard can show window counts and €/h.
 */
import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useRoute, useLocation } from "wouter";
import { api } from "@/lib/api";
import { getAdminProfile, USERS, getPreferredWasher, setPreferredWasher } from "@/lib/admin-profile";
import { useCrewWorkerRedirect } from "@/lib/use-crew-redirect";
import {
  emptyProjectData, newGigProjectData, computeWorkerStats, isFr8Plans, fixedDealFor, allPoints, computeDealBilling,
  dealInternalRateCents, isCommunityGig,
  type ProjectData, type ProjMarksData, type WindowStatus, type ProjNoteKind, type ProjExpense, type LampStatus,
  type LampCondition, type DoorStatus, type FixtureOrder, type LampModel,
  billingModeOf, type BillingMode,
} from "@shared/project";
import { computeP2Billing, customerAddedKeys, p2FounderOpts, p2CustomerLocksSince, p2Itemisation, p2WashedYellows, p2WorkerSplit, p2WorkerPayoutCents, p2PendingPriceCents, DEFAULT_P2_WORKER_SHARE_PCT, DEFAULT_P2_PAYOUT_SCHEDULE, P2_PRICE_PRESETS_CENTS, type P2State, type P2PayoutRule, type P2WashedState } from "@shared/p2";
import { computeGuided, type GuidedWork } from "@shared/guided";
import Navbar, { type Fr8Tab } from "@/components/fr8/Navbar";
import { splitCentsEvenly, FOUNDER_IDS } from "@shared/team";
import { traineeForUserId, traineeForName } from "@shared/trainees";
import { DEFAULT_WORKER_PER_WINDOW_CENTS } from "@shared/crew";
import Dashboard from "@/components/fr8/Dashboard";
import HourlyPanel from "@/components/fr8/HourlyPanel";
import ModeChooser from "@/components/fr8/ModeChooser";
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
  /** Näytetäänkö tilanvalinta vaikka tila on jo valittu ("Vaihda tila"). */
  const [showModes, setShowModes] = useState(false);
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

  /**
   * NAPPI EI OSU — NELJÄS JA VIIMEINEN MEKANISMI: VIEWPORT-METAN UUDELLEENKIRJOITUS.
   * ("yläpalkin nappi ei rekisteröi ennen kuin käännän puhelimen vaakaan, ja
   *   aina heti näkymän avaamisen jälkeen")
   *
   * Tämä efekti kirjoitti auettuaan viewport-metan uudelleen lukitsemaan sivun
   * zoomin — ja pudotti samalla `viewport-fit=cover`in, joka on index.html:ssä.
   * Kaksi seurausta, jotka yhdessä selittävät oireen täsmälleen:
   *
   *   1. Ilman `viewport-fit=cover`ia `env(safe-area-inset-top)` on 0. Se on
   *      juuri se arvo josta yläpalkin korkeus ja yläpaddingi lasketaan
   *      (fr8/Navbar.tsx: `calc(58px + env(safe-area-inset-top))`). Yläpalkki
   *      on siis SIVUN AINOA elementti jonka geometria muuttuu tästä — ja
   *      nimenomaan sen napit olivat kuolleita.
   *   2. iOS ei ota ajonaikaista viewport-metan muutosta käyttöön heti vaan
   *      vasta seuraavassa täydessä uudelleenasettelussa. Siihen asti palkki
   *      PIIRRETÄÄN uudella ja OSUMATESTATAAN vanhalla geometrialla. Puhelimen
   *      kääntäminen pakottaa sen asettelun — siksi vaakataso "korjaa" vian.
   *
   * Tekijän näkymä (worker.tsx) säilytti `viewport-fit=cover`in eikä oireillut
   * samalla tavalla. Metaa ei kuitenkaan kirjoiteta enää kummassakaan: alla
   * oleva tarkoitus toteutuu jo ilman sitä.
   *
   * ZOOMIN LUKKO ILMAN METAA: `user-scalable=no` / `maximum-scale=1` ei tehoa
   * iOS Safarissa lainkaan (ohitettu iOS 10:stä), eli juuri sillä laitteella
   * jolla vika ilmeni override ei estänyt mitään. Sama asia tehdään nyt
   * CSS:llä: `.fr8-root { touch-action: pan-x pan-y }` (index.css) estää
   * nipistyszoomin kuoren sisällä, ja pohjakuva pitää oman
   * `touch-action: none`insa, joten kartan oma zoom toimii ennallaan.
   *
   * ÄLÄ palauta viewport-metan kirjoitusta tähän. Vartija:
   * client/src/fr8-shell-hygiene.test.ts.
   */
  useEffect(() => {
    // Lukitse dokumentin vieritys niin kauan kuin musta kuori on auki. Syy on
    // osumatestissä, ei ulkoasussa: iOS piirtää position:fixed -elementit
    // visuaalisen viewportin mukaan mutta osumatestaa layout-viewportin mukaan,
    // joten heti kun sivu on vierittynyt (vaikka vain osoitepalkin piiloutumisen
    // verran), nappi osuu vierityksen verran väärään paikkaan. Vieritys tapahtuu
    // .fr8-rootin sisällä, joten mitään ei menetetä. Ks. index.css `.fr8-lock`.
    window.scrollTo(0, 0);
    document.documentElement.classList.add("fr8-lock");
    return () => {
      document.documentElement.classList.remove("fr8-lock");
    };
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
        // A gig's FIRST project — stamp it as "not the FR8 contract" so it can
        // never inherit the signed 6300 € deal from its plan path later.
        const seeded: ProjectData = { ...newGigProjectData(), workers };
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

  /**
   * Pisteen raahaus.
   *
   * `FloorView` erottelee tarkoituksella esikatselun ja lopullisen sijainnin:
   * `onMoveMark` tulee JOKAISESTA pointermove-tapahtumasta (~60 Hz) ja
   * `onMoveMarkCommit` kerran kun sormi nousee. Tämä sivu oli kytkenyt
   * molempiin saman `mutate`n, joka syväkopioi koko karttablobin ja ajastaa
   * tallennuksen — eli raahaus kloonasi megatavuja 60 kertaa sekunnissa ja
   * jokainen yli 700 ms:n tauko kesken raahauksen lähetti koko blobin kantaan.
   *
   * Nyt liike päivittää vain paikallisen esikatselun (ei kloonia, ei
   * tallennusta) ja vasta sormen nosto kirjaa sijainnin.
   */
  const [dragPreview, setDragPreview] = useState<Record<string, { x: number; y: number }>>({});

  const onMoveMark = useCallback((key: string, x: number, y: number) => {
    setDragPreview((cur) => ({ ...cur, [key]: { x, y } }));
  }, []);

  /** Raahauksen aikainen sijainti näytetään esikatselusta; muuten tallennettu. */
  const livePosOverrides = useMemo(
    () => (Object.keys(dragPreview).length
      ? { ...(project?.posOverrides ?? {}), ...dragPreview }
      : (project?.posOverrides ?? {})),
    [project?.posOverrides, dragPreview],
  );

  const onMoveMarkCommit = useCallback((key: string, x: number, y: number) => {
    setDragPreview((cur) => {
      if (!(key in cur)) return cur;
      const next = { ...cur };
      delete next[key];
      return next;
    });
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

  // ── Lamput ───────────────────────────────────────────────────────────────────
  // Sama merkintälogiikka kuin ikkunoilla, mutta ei rahaa: lisää/poista/merkitse.
  const onAddLamp = useCallback((floor: string, x: number, y: number) => {
    mutate((d) => {
      const key = `${floor}#lamp${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
      if (!d.lamps) d.lamps = {};
      if (!d.lampAddedBy) d.lampAddedBy = {};
      d.lamps[floor] = [...(d.lamps[floor] || []), { key, x, y }];
      // Pelkkä jälki: kartoitus ei ole työsuoritus eikä se näy asiakkaalle.
      d.lampAddedBy[key] = { by: currentWorker, ts: Date.now() };
    });
  }, [mutate, currentWorker]);

  const onDeleteLamp = useCallback((key: string) => {
    mutate((d) => {
      const f = key.split("#")[0];
      if (d.lamps?.[f]) d.lamps[f] = d.lamps[f].filter((l) => l.key !== key);
      if (d.lampStatuses) delete d.lampStatuses[key];
      if (d.lampChangedBy) delete d.lampChangedBy[key];
      if (d.lampConditions) delete d.lampConditions[key];
      if (d.lampNotes) delete d.lampNotes[key];
      if (d.lampAddedBy) delete d.lampAddedBy[key];
      if (d.lampModelOf) delete d.lampModelOf[key];
    });
  }, [mutate]);

  const onSetLampStatus = useCallback((key: string, status: LampStatus, changedById?: string) => {
    const changer = changedById ?? defaultWasher ?? currentWorker;
    mutate((d) => {
      if (!d.lampStatuses) d.lampStatuses = {};
      if (!d.lampChangedBy) d.lampChangedBy = {};
      if (status === "vaihdettu") {
        d.lampStatuses[key] = "vaihdettu";
        d.lampChangedBy[key] = { by: changer, ts: Date.now() };
      } else {
        delete d.lampStatuses[key];
        delete d.lampChangedBy[key];
      }
    });
  }, [mutate, currentWorker, defaultWasher]);

  /** Toimiiko lamppu. `null` palauttaa "ei tarkastettu" -tilaan (kenttä pois). */
  const onSetLampCondition = useCallback((key: string, condition: LampCondition | null) => {
    mutate((d) => {
      if (!d.lampConditions) d.lampConditions = {};
      if (condition) d.lampConditions[key] = condition;
      else delete d.lampConditions[key];
    });
  }, [mutate]);

  /** Lampun huomautus. Tyhjä teksti poistaa sen — sama sääntö kuin havainnolla. */
  const onSetLampNote = useCallback((key: string, text: string) => {
    mutate((d) => {
      if (!d.lampNotes) d.lampNotes = {};
      const t = text.trim();
      if (t) d.lampNotes[key] = { text: t, by: currentWorker, ts: Date.now() };
      else delete d.lampNotes[key];
    });
  }, [mutate, currentWorker]);

  // ── Ovet ─────────────────────────────────────────────────────────────────────
  // Sama kevyt malli kuin lampuilla, mutta piste on tehtävä: nimi + tehty/ei.
  const onAddDoor = useCallback((floor: string, x: number, y: number) => {
    mutate((d) => {
      const key = `${floor}#door${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
      if (!d.doors) d.doors = {};
      if (!d.doorAddedBy) d.doorAddedBy = {};
      d.doors[floor] = [...(d.doors[floor] || []), { key, x, y }];
      d.doorAddedBy[key] = { by: currentWorker, ts: Date.now() };
    });
  }, [mutate, currentWorker]);

  const onDeleteDoor = useCallback((key: string) => {
    mutate((d) => {
      const f = key.split("#")[0];
      if (d.doors?.[f]) d.doors[f] = d.doors[f].filter((x) => x.key !== key);
      if (d.doorStatuses) delete d.doorStatuses[key];
      if (d.doorDoneBy) delete d.doorDoneBy[key];
      if (d.doorNotes) delete d.doorNotes[key];
      if (d.doorAddedBy) delete d.doorAddedBy[key];
    });
  }, [mutate]);

  const onSetDoorStatus = useCallback((key: string, status: DoorStatus, doneById?: string) => {
    const doer = doneById ?? defaultWasher ?? currentWorker;
    mutate((d) => {
      if (!d.doorStatuses) d.doorStatuses = {};
      if (!d.doorDoneBy) d.doorDoneBy = {};
      if (status === "tehty") {
        d.doorStatuses[key] = "tehty";
        d.doorDoneBy[key] = { by: doer, ts: Date.now() };
      } else {
        delete d.doorStatuses[key];
        delete d.doorDoneBy[key];
      }
    });
  }, [mutate, currentWorker, defaultWasher]);

  const onSetDoorNote = useCallback((key: string, text: string) => {
    mutate((d) => {
      if (!d.doorNotes) d.doorNotes = {};
      const t = text.trim();
      if (t) d.doorNotes[key] = { text: t, by: currentWorker, ts: Date.now() };
      else delete d.doorNotes[key];
    });
  }, [mutate, currentWorker]);

  /**
   * Ostotieto. Tyhjä kenttä POISTAA arvon eikä tallenna tyhjää merkkijonoa,
   * jotta "ei asetettu" ja "asetettu tyhjäksi" eivät eroa toisistaan kannassa —
   * ja jotta laskettu määrä palaa käyttöön kun käsin asetettu luku tyhjennetään.
   */
  const onSetFixtureOrder = useCallback((patch: Partial<FixtureOrder>) => {
    mutate((d) => {
      const next: FixtureOrder = { ...(d.fixtureOrder ?? {}) };
      for (const [k, v] of Object.entries(patch) as [keyof FixtureOrder, any][]) {
        const empty = v === undefined || v === null || (typeof v === "string" && !v.trim());
        if (empty) delete next[k];
        else (next as any)[k] = typeof v === "string" ? v.trim() : v;
      }
      if (Object.keys(next).length) d.fixtureOrder = next; else delete d.fixtureOrder;
    });
  }, [mutate]);

  // ── Lamppumallit ─────────────────────────────────────────────────────────────
  const onAddLampModel = useCallback((name: string) => {
    mutate((d) => {
      const t = name.trim();
      if (!t) return;
      if (!d.lampModels) d.lampModels = [];
      // Sama nimi kahdesti olisi kaksi riviä ostoslistalla samasta lampusta.
      if (d.lampModels.some((m) => m.name.toLowerCase() === t.toLowerCase())) return;
      const id = `m${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
      d.lampModels = [...d.lampModels, { id, name: t }];
    });
  }, [mutate]);

  const onRemoveLampModel = useCallback((id: string) => {
    mutate((d) => {
      d.lampModels = (d.lampModels ?? []).filter((m) => m.id !== id);
      // Mallia käyttäneet lamput palaavat "ei mallia" -tilaan. Roikkuva viite
      // olisi sama asia mutta hämärämpänä, ja sanitointi pudottaisi sen silti.
      if (d.lampModelOf) {
        for (const [k, v] of Object.entries(d.lampModelOf)) if (v === id) delete d.lampModelOf[k];
      }
      if (!d.lampModels.length) delete d.lampModels;
    });
  }, [mutate]);

  const onSetLampModel = useCallback((key: string, modelId: string | null) => {
    mutate((d) => {
      if (!d.lampModelOf) d.lampModelOf = {};
      if (modelId) d.lampModelOf[key] = modelId;
      else delete d.lampModelOf[key];
    });
  }, [mutate]);

  /**
   * KEIKAN LASKUTUSTILA. Valinta kirjoitetaan keikalle, jotta seuraava
   * avaaminen menee suoraan oikeaan näkymään — valikko joka kysyy saman asian
   * joka kerta olisi este, ei valinta.
   */
  const onSetBillingMode = useCallback((mode: BillingMode) => {
    mutate((d) => { d.billingMode = mode; });
  }, [mutate]);

  /**
   * KÄSIN TUNTIKORJAUS — vain perustajille (ks. `canAdjustHours` alla).
   *
   * Pyöristys on lähtökohta eikä viimeinen sana: ajastin voi jäädä päälle,
   * unohtua kokonaan, tai työ on tehty ennen kuin linkki otettiin käyttöön.
   * Korjaus kirjautuu `hourLog`iin kuten kaikki muukin, joten jälki säilyy.
   */
  const onAdjustHours = useCallback((workerId: string, delta: number) => {
    mutate((d) => {
      const cur = d.hours?.[workerId] ?? 0;
      const next = Math.max(0, Math.round((cur + delta) * 100) / 100);
      if (next === cur) return;
      d.hours = d.hours ?? {};
      d.hours[workerId] = next;
      d.hourLog = [{ worker: workerId, delta: next - cur, ts: Date.now(), by: currentWorker }, ...(d.hourLog ?? [])].slice(0, 200);
    });
  }, [mutate, currentWorker]);

  const onSetDoorLabel = useCallback((key: string, label: string) => {
    mutate((d) => {
      const f = key.split("#")[0];
      if (!d.doors?.[f]) return;
      const t = label.trim();
      d.doors[f] = d.doors[f].map((x) => (x.key === key ? { ...x, ...(t ? { label: t } : { label: undefined }) } : x));
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

  // Kartan kohdistus: kerros + valinnainen ikkuna-avain. Nonce pakottaa
  // hypyn myös silloin kun sama ikkuna avataan uudestaan.
  const [floorFocus, setFloorFocus] = useState<{ floor: string; key?: string; nonce: number } | null>(null);

  const onGoToFloor = useCallback((floor: string) => {
    setActiveFloor(floor);
    setTab("floor");
  }, []);

  // Hyppää kerrokselle JA avaa juuri sen ikkunan tiedot kartalla. Listan rivi
  // ilman tätä kertoisi vain numeron; tällä sen voi käydä katsomassa.
  const onGoToWindow = useCallback((floor: string, key: string) => {
    setActiveFloor(floor);
    setTab("floor");
    setFloorFocus((f) => ({ floor, key, nonce: (f?.nonce ?? 0) + 1 }));
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
  const onP2Propose = useCallback(async (keys: string[], priceCents: number, note?: string) => {
    const res = await api.p2Propose(jobId, { keys, priceCents, by: currentWorker, note });
    if (res.ok && res.data) applyP2(res.data.p2);
    else setError(res.error || "Hinnoittelu epäonnistui");
  }, [jobId, currentWorker, applyP2]);

  // ── Ohjattu eteneminen (guided) — perustajan kytkin + kerroksen ohitus ──────
  // Guided-tila on serverin omistama kuten p2 (geneerinen autosave ei koske
  // siihen). /guided-reitti palauttaa tallennetun kytkimen; päivitetään paikalliseen
  // projektiin. Johdettu tila (aktiivinen kerros, seuraava ikkuna) lasketaan
  // clientissä `computeGuided`illä suoraan kartasta, joten se pysyy aina synkassa.
  // HUOM: tämä hook on ennen early returneja (React #310).
  /** Palauttaa palvelimen tallentaman tilan, jotta kutsuja voi tarkistaa että
   *  pyydetty muutos OIKEASTI meni läpi — ei vain että pyyntö onnistui. */
  const onGuidedSet = useCallback(async (data: { enabled?: boolean; activeFloorOverride?: string | null; openFloors?: string[]; lockWindow?: string; unlockWindow?: string }) => {
    const res = await api.guidedSet(jobId, data);
    if (res.ok && res.data) {
      const guided = res.data.guided;
      setProject((cur) => (cur ? { ...cur, guided } : cur));
      latest.current = latest.current ? { ...latest.current, guided } : latest.current;
      return guided;
    }
    setError(res.error || "Tallennus epäonnistui");
    return null;
  }, [jobId]);

  /**
   * Kuittaus tehdystä toimenpiteestä. `error` on virheille; tämä on sille että
   * jokin ONNISTUI. Ilman tätä ikkunan piilotus oli täysin mykkä: valikko
   * sulkeutui ja piste himmeni jossain kartalla, mutta jos katse oli muualla,
   * mikään ei kertonut tapahtuiko mitään.
   */
  const [flash, setFlash] = useState<{ text: string; undo?: () => void } | null>(null);
  const flashTimer = useRef<number | null>(null);
  const showFlash = useCallback((text: string, undo?: () => void) => {
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    setFlash({ text, undo });
    flashTimer.current = window.setTimeout(() => setFlash(null), 6000);
  }, []);
  useEffect(() => () => { if (flashTimer.current) window.clearTimeout(flashTimer.current); }, []);

  // Kerroslukon saa asettaa vain perustaja — sama ehto kuin dashin
  // KERROSTEN LUKITUS -paneelilla, jotta kartta ei anna enempää oikeuksia.
  const canEditLocks = profile?.role === "HOST" || FOUNDER_IDS.includes(profile?.id || "");

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
  /**
   * Sama tieto muodossa jonka `shared/p2.ts` ymmärtää. Perustaja saa OMASTA
   * keltaisesta ikkunastaan koko hinnan (kuten punaisistakin), ei työntekijän
   * palkkiotaulukon mukaista osuutta — hänelle ei ole palkattavaa, joten
   * katetta ei jää jaettavaksi. Ks. shared/p2-founder-pay.test.ts.
   */
  const p2IsFounder = (id: string) => isFounder(id, crew.find((c) => c.id === id)?.role);
  const p2Opts = { isFounder: p2IsFounder };
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
  /**
   * Harjoittelija (esim. Milja) on RAHAN KANNALTA tavallinen tekijä:
   * hänen ikkunansa maksavat hänen oman taksansa, ja loppu jää katteeksi joka
   * jaetaan perustajien kesken — täsmälleen kuten Janin tai Oonan ikkunat.
   *
   * Aiemmin hänen ikkunansa ja eurot hyvitettiin vastuujohtajalle (Matias), joten
   * Matiaksen "oma työ" ja loppusumma sisälsivät Miljan työn. Se oli väärä kuva:
   * Matias ei tehnyt niitä ikkunoita eikä pidä sitä rahaa. Nyt hänen lukunsa ovat
   * vain hänen omiaan, ja Milja näkyy erikseen (koottuna kortin alle), koska
   * vastuu tilityksestä on silti Matiaksella.
   *
   * Ero tavalliseen tekijään on vain juridinen: harjoittelija ei laskuta meitä
   * eikä ole tekijöiden erämaksulistalla (`isTraineeMember`), vaan vastuujohtaja
   * tilittää hänelle ja kirjaa maksun Tiimi-sivulla.
   */
  const traineeByLeader: Record<string, { id: string; name: string; washed: number; cents: number; paidCents: number }[]> = {};
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
  // Keltaisen (P2) ikkunan palkkio tekijälle — palkkiotaulukko, ei punaisten
  // taksa. Kertyneet, odottavat ja odottavien lukumäärä tulevat yhdestä jaetusta
  // funktiosta: ne laskettiin ennen kolmena lähes identtisenä silmukkana, joista
  // yksi olisi jäänyt jälkeen heti kun ehto muuttuu.
  const p2Split = p2WorkerSplit(project, p2Opts);
  /** Yhden tekijän keltaisista kertynyt palkkio (0 kun vaihe 2 ei ole päällä). */
  const p2EarnedFor = (workerId: string): number => Math.round(p2Split.earnedCents[workerId] || 0);
  // Odottavat keltaiset (pesty, hinta ehdotettu mutta ei hyväksytty) — teoreettista
  // rahaa, ei koskaan mukana vahvistetuissa ansioissa.
  const p2PendingCentsFor = (workerId: string): number => Math.round(p2Split.pendingCents[workerId] || 0);
  // Profit pool = Σ over real workers (NOT founders, NOT trainees) of
  // (sisäinen kate − that worker's rate) per worker-washed RED window. Keltaiset
  // eivät kuulu tähän: niissä kate lasketaan omalla logiikallaan (computeP2Billing
  // marginCents) eikä punaisten sisäisellä katteella. Aiemmin tässä käytettiin
  // `st.washed`ia, joka sisälsi keltaiset → haamukatetta perustajille.
  let profitPoolCents = 0;
  for (const st of baseStatsRaw) {
    const mm = crew.find((c) => c.id === st.worker);
    // Harjoittelija on mukana: hänen ikkunansa tuottavat katetta samoin kuin
    // muidenkin tekijöiden (hänen taksansa erotus sisäiseen katteeseen).
    if (!isFounder(st.worker, mm?.role)) {
      profitPoolCents += st.washedP1 * Math.max(0, internalKateCents - rateOf(st.worker));
    }
  }
  /**
   * KELTAISTEN KATE perustajille. Tämä puuttui kokonaan perustajien ansioista,
   * vaikka dashin "KERTYNYT"-kortti näytti sen — siksi perustajan kortin summa
   * oli pienempi kuin ylälaidan luku. `computeP2Billing.marginCents` = pestyjen
   * SOVITTUJEN keltaisten asiakashinta − tekijöiden palkkiot, eli juuri se raha
   * joka jää perustajille. Jaetaan tasan, pariton sentti ensimmäiselle.
   */
  const p2Bill = computeP2Billing(project, p2Opts);
  const p2PendingMarginCents = Math.max(0, p2Bill.pendingEarnedCents - p2Bill.pendingWorkerCostCents);
  /**
   * KATE JAETAAN TASAN — JA TÄSMÄLLEEN.
   *
   * Kate on aina sama molemmille riippumatta siitä kumpi pesi enemmän: omasta
   * ikkunasta ei synny katetta lainkaan (koko hinta on jo tekijän), ja
   * työntekijöiden tuottama kate kuuluu perustajille tasan.
   *
   * Jako laskettiin `Math.floor`illa, jolloin pariton sentti katosi näkyvistä,
   * ja tuotto-osuus `Math.round`illa, joka on pahempi: 3 senttiä kahdelle
   * antaa 2 + 2 = 4, eli sentti syntyi tyhjästä. Kumpikaan ei ole iso raha,
   * mutta kun koko näkymän tarkoitus on että luvut täsmäävät, yksikin karkaava
   * sentti syö luottamuksen. `splitCentsEvenly` jakaa jäännössentit
   * järjestyksessä, joten summa on aina täsmälleen jaettava summa.
   */
  const founderIdsInOrder = (() => {
    const fromCrew = crew.filter((c) => isFounder(c.id, c.role)).map((c) => c.id);
    return (fromCrew.length ? Array.from(new Set(fromCrew)) : [...FOUNDER_IDS]).sort();
  })();
  const shareByFounder = (cents: number): Record<string, number> => {
    const parts = splitCentsEvenly(cents, founderIdsInOrder.length);
    const out: Record<string, number> = {};
    founderIdsInOrder.forEach((id, i) => { out[id] = parts[i] ?? 0; });
    return out;
  };
  const p2MarginBy = shareByFounder(p2Bill.marginCents);
  const p2PendingMarginBy = shareByFounder(p2PendingMarginCents);
  const founderProfitBy = shareByFounder(profitPoolCents);
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
      // Vain OMA punainen työ — harjoittelijan ikkunat eivät ole johtajan työtä.
      return Math.round(st.washedP1 * internalKateCents)
        + (founderProfitBy[st.worker] ?? 0)
        + p2Cents
        + (p2MarginBy[st.worker] ?? 0);
    }
    return Math.round(st.washedP1 * rateOf(st.worker)) + p2Cents;
  };
  const resolveName = (id: string): string => {
    const m = crew.find((c) => c.id === id);
    if (m?.name?.trim()) return m.name.trim().split(/\s+/)[0];
    return workerName(id);
  };

  // Harjoittelijat koottuna vastuujohtajan alle: ikkunamäärä + hänen oma summansa
  // + jo maksettu. EI osa johtajan lukuja — pelkkä vastuunäkymä, joka on kortilla
  // piilossa kunnes sen avaa.
  for (const st of baseStatsRaw) {
    const lead = leaderOf(st.worker);
    if (!lead) continue;
    const mm = crew.find((c) => c.id === st.worker);
    if (mm?.active === false) continue;
    const paidCents = (mm?.payouts || []).filter((pay) => pay.status === "maksettu").reduce((sum, pay) => sum + pay.amountCents, 0);
    (traineeByLeader[lead] ||= []).push({
      id: st.worker,
      name: resolveName(st.worker),
      washed: st.washedP1 + st.washedP2,
      cents: Math.round(st.washedP1 * rateOf(st.worker)) + p2EarnedFor(st.worker),
      paidCents,
    });
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
  // Montako pestyä keltaista odottaa vielä asiakkaan hyväksyntää, per tekijä.
  // Ilman tätä kortti ei voi kertoa MIKSI ansio per ikkuna näyttää matalalta.
  const workerStats = baseStats.filter((s) => !inactiveIds.has(s.worker)).map((s) => {
    const cents = earningsFor(s);
    const mm = crew.find((c) => c.id === s.worker);
    return {
      ...s,
      revenueCents: cents,
      windowsPerHour: s.hours > 0 ? s.washed / s.hours : 0,
      eurPerHour: s.hours > 0 ? cents / 100 / s.hours : 0,
      // Ansion osat kortille — punaiset omalla taksalla, keltaiset erikseen,
      // ja hyväksyntää odottavat omanaan koska niistä ei vielä makseta.
      p2Cents: p2EarnedFor(s.worker),
      p2PendingCents: p2PendingCentsFor(s.worker),
      p2PendingCount: p2Split.pendingCount[s.worker] || 0,
      rateCents: isFounder(s.worker, mm?.role) ? internalKateCents : rateOf(s.worker),
    };
  });
  // ── Perustajien (bossien) ansioerittely dashboardille ───────────────────────
  // Perustajan ansio = oma PUNAINEN työ × sisäinen kate + harjoittelijan osuus
  // + tuotto-osuus työntekijöiden punaisista + oma keltainen palkkio + osuus
  // keltaisten katteesta. Harjoittelija ei ole mukana missään näistä.
  const founderEarnings = workerStats
    .filter((s) => isFounder(s.worker, crew.find((c) => c.id === s.worker)?.role))
    .map((s) => {
      const mm = crew.find((c) => c.id === s.worker);
      // VAIN oma punainen työ. Harjoittelijan ikkunat eivät ole johtajan työtä
      // eivätkä hänen rahaansa — ne näkyvät kortilla erikseen (`trainees`).
      const ownWashed = s.washedP1;
      const manual = mm?.manualEarningsCents != null;
      const p2Cents = p2EarnedFor(s.worker);
      return {
        id: s.worker,
        name: resolveName(s.worker),
        ownWashed,
        ownCents: Math.round(ownWashed * internalKateCents),
        shareCents: founderProfitBy[s.worker] ?? 0,
        p2Cents,
        p2Washed: s.washedP2,
        /** Osuus SOVITTUJEN keltaisten katteesta. */
        p2MarginCents: p2MarginBy[s.worker] ?? 0,
        /** Teoreettinen lisä: oma palkkio + kate ikkunoista jotka on JO PESTY mutta
         *  joiden hintaa asiakas ei ole vielä hyväksynyt. Ei vahvistettua rahaa. */
        theoreticalCents: p2PendingCentsFor(s.worker) + (p2PendingMarginBy[s.worker] ?? 0),
        trainees: traineeByLeader[s.worker] ?? [],
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
    // Harjoittelija mukaan: hänen palkkansa on työvoimakulua kuten muidenkin.
    return !isFounder(s.worker, mm?.role);
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

  /**
   * TILAN VALINTA ON NÄKYMÄN ENSIMMÄINEN KYSYMYS.
   *
   * Valikko näkyy kun keikalla EI OLE valittua tilaa — silloin emme tiedä
   * kumpaa näkymää hän on tullut katsomaan. Kun tila on valittu, avaaminen
   * menee suoraan siihen: valikko joka kysyy saman asian joka kerta olisi este.
   *
   * FR8 ja kaikki olemassa olevat keikat ovat ilman merkintää "targeted"
   * (`billingModeOf`), joten ne eivät näe valikkoa lainkaan eivätkä muutu.
   * Valikkoon pääsee takaisin `showModes`-tilalla.
   */
  const mode = billingModeOf(project);
  const modeChosen = !!project.billingMode;
  const canAdjustHours = isFounderView;

  if (!modeChosen || showModes) {
    return shell(
      <ModeChooser
        gigName={project.building.name || gigName || undefined}
        current={modeChosen ? mode : null}
        onChoose={(next) => { onSetBillingMode(next); setShowModes(false); }}
        onCancel={modeChosen ? () => setShowModes(false) : undefined}
      />,
    );
  }

  /**
   * TUNTITILA ON OMA NÄKYMÄNSÄ, EI DASHIN VÄLILEHTI.
   *
   * Kohdennetun tilan navigaatio (kartta, ansiot, maksut, tasaus) vastaa
   * kysymyksiin joita tuntikeikalla ei ole. Sen näyttäminen tyhjänä olisi
   * juuri sitä sekaannusta jota tämä tila välttää, joten tuntikeikalla on oma
   * kevyt kuorensa: yksi paluu, yksi tilanvaihto, yksi lista.
   */
  if (mode === "hourly") {
    return shell(
      <div style={{ maxWidth: 860, margin: "0 auto", padding: 20, paddingTop: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
          <button onClick={backToGig}
            style={{ background: "transparent", border: "none", padding: 0, color: "rgba(255,255,255,0.5)", fontFamily: "var(--font-onest, system-ui, sans-serif)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            ← Takaisin
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: 10, letterSpacing: "0.12em", color: "rgba(255,255,255,0.38)" }}>TUNTIHINNOITTELU</div>
            <div style={{ fontFamily: "var(--font-onest, system-ui, sans-serif)", fontSize: 19, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {project.building.name || gigName || "Keikka"}
            </div>
          </div>
          <button onClick={() => setShowModes(true)}
            style={{ flexShrink: 0, padding: "8px 14px", borderRadius: 11, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.7)", fontFamily: "var(--font-onest, system-ui, sans-serif)", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
            Vaihda tila
          </button>
        </div>
        <HourlyPanel
          project={project}
          workerName={resolveName}
          crew={crew}
          onAdjustHours={canAdjustHours ? onAdjustHours : undefined}
        />
      </div>,
    );
  }

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
      {/* KUITTAUS. `error` on virheille, tämä sille että jokin onnistui.
          Ilman tätä ikkunan piilotus oli täysin mykkä: valikko sulkeutui ja
          piste himmeni jossain kartalla, mutta jos katse oli muualla, mikään
          ei kertonut tapahtuiko mitään — eikä siitä että toiminto ei
          tallentunut lainkaan. Kumoa-nappi on tässä koska piilotus on helppo
          osua vahingossa (valikossa se on Poista-kohdan vieressä). */}
      {flash && (
        <div
          data-fr8-bg
          style={{
            position: "fixed", top: "calc(70px + env(safe-area-inset-top))", left: "50%",
            transform: "translateX(-50%)", zIndex: 61,
            maxWidth: "min(92vw, 560px)", padding: "9px 14px", borderRadius: 11,
            background: "rgba(18,44,30,0.92)", border: "1px solid rgba(124,224,166,0.4)",
            color: "rgba(214,247,228,0.98)", fontSize: 12.5, textAlign: "center",
            display: "flex", alignItems: "center", gap: 12, boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
          }}
        >
          <span>{flash.text}</span>
          {flash.undo && (
            <button
              type="button"
              onClick={() => { const u = flash.undo!; setFlash(null); u(); }}
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "#7CE0A6", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, textDecoration: "underline", textUnderlineOffset: 2, flexShrink: 0 }}
            >
              Kumoa
            </button>
          )}
        </div>
      )}

      {error && (
        // data-fr8-bg: keltainen on virheen väri. Ilman merkintää mobiilisääntö
        // ylikirjoitti sen 5,5 %:n valkoiseksi juuri silloin kun palkin pitää
        // erottua. Ja `top` seuraa turva-aluetta, koska yläpalkki tekee niin —
        // muuten palkki tuli asennetussa PWA:ssa navin alle.
        <div
          data-fr8-bg
          style={{
            position: "fixed", top: "calc(70px + env(safe-area-inset-top))", left: "50%",
            transform: "translateX(-50%)", zIndex: 60,
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
            /* Lamppu- ja ovimerkinnät suoraan dashista — sama data kuin
               kartalla, jotta huomautuksen voi kirjoittaa etsimättä pistettä. */
            onSetLampStatus={onSetLampStatus}
            onSetLampCondition={onSetLampCondition}
            onSetLampNote={onSetLampNote}
            onSetDoorStatus={onSetDoorStatus}
            onSetDoorNote={onSetDoorNote}
            onSetFixtureOrder={onSetFixtureOrder}
            onAddLampModel={onAddLampModel}
            onRemoveLampModel={onRemoveLampModel}
            p2Slot={deal ? (
              <P2AdminPanel
                project={project}
                jobId={jobId}
                by={currentWorker}
                onP2={applyP2}
                onGoToFloor={onGoToFloor}
                onGoToWindow={onGoToWindow}
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
          <MaksutView
            jobId={jobId}
            project={project}
            billing={billing}
            onOpenGig={backToGig}
            canEditTasaus={isFounderView}
            onSetAdjustment={async (workerId, cents) => {
              // Sovittu vähennys tallentuu crew-riville, joten se pysyy ja näkyy
              // kaikkialla samana (Maksut, Tiimi, maksudialogin esitäyttö).
              const res = await api.updateCrewMember(jobId, workerId, { payAdjustmentCents: cents });
              if (res.ok && res.data) {
                setProject((cur) => (cur ? { ...cur, crew: res.data!.crew } : cur));
              } else {
                setError(res.error || "Vähennyksen tallennus epäonnistui");
              }
            }}
          />
        )}
        {tab === "floor" && (
          <FloorView
            floors={project.building.floors}
            planBase={project.building.planBase || ""}
            building={project.building}
            planUrlBase={api.planUrlBaseForJob(jobId)}
            planAuthed
            pricePerWindow={effectivePrice}
            marks={project.marks}
            statuses={project.statuses}
            posOverrides={livePosOverrides}
            customMarks={project.customMarks}
            deleted={project.deleted}
            initialFloor={activeFloor}
            onStatusChange={onStatusChange}
            onAddCustomMark={onAddCustomMark}
            onDeleteMark={onDeleteMark}
            onMoveMark={onMoveMark}
            onMoveMarkCommit={onMoveMarkCommit}
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
            lamps={project.lamps}
            lampStatuses={project.lampStatuses}
            lampChangedBy={project.lampChangedBy ? Object.fromEntries(Object.entries(project.lampChangedBy).map(([k, v]) => [k, v.by])) : undefined}
            onAddLamp={onAddLamp}
            onDeleteLamp={onDeleteLamp}
            onSetLampStatus={onSetLampStatus}
            lampConditions={project.lampConditions}
            lampNotes={project.lampNotes}
            onSetLampCondition={onSetLampCondition}
            onSetLampNote={onSetLampNote}
            lampModels={project.lampModels}
            lampModelOf={project.lampModelOf}
            onSetLampModel={onSetLampModel}
            doors={project.doors}
            doorStatuses={project.doorStatuses}
            doorDoneBy={project.doorDoneBy ? Object.fromEntries(Object.entries(project.doorDoneBy).map(([k, v]) => [k, v.by])) : undefined}
            doorNotes={project.doorNotes}
            onAddDoor={onAddDoor}
            onDeleteDoor={onDeleteDoor}
            onSetDoorStatus={onSetDoorStatus}
            onSetDoorNote={onSetDoorNote}
            onSetDoorLabel={onSetDoorLabel}
            deal={deal}
            p2={project.p2 ? { enabled: project.p2.enabled, offers: project.p2.offers } : null}
            /* Keltaisten hinnoittelu ei kuulu yhteisökeikalle: siinä ei ole
               hintaa neuvoteltavaksi, joten "€ Hinnoittele" oli nappi joka ei
               voi johtaa mihinkään. Ilman `onP2Propose`ia FloorView jättää sen
               piirtämättä. */
            onP2Propose={isCommunityGig(project) ? undefined : onP2Propose}
            /* Asiakkaan laajuusvastaukset kartalle. Yhteisökeikalla asiakas
               vastaa keltaisiin "pestään / ei pestä" omasta linkistään, ja se
               vastaus ohjaa työtä — joten sen on näyttävä siellä missä työ
               tehdään. */
            scopeVotes={project.scope ? Object.fromEntries(Object.entries(project.scope.votes).map(([k, v]) => [k, v.answer])) : null}
            /* Kartta tarvitsee vain tiedon avoimista kerroksista — "seuraava ikkuna"
               -ohjaus on poistettu. */
            guided={project.guided?.enabled ? (() => { const g = computeGuided(project); return { enabled: true, activeFloor: g.activeFloor, activeFloors: g.activeFloors, lockedFloors: g.lockedFloors, nextKey: null }; })() : null}
            /* Kerroslukko suoraan kartalta. Sama `onGuidedSet` jota dashin
               KERROSTEN LUKITUS -paneeli käyttää, joten totuus on yksi:
               avoimien kerrosten lista. Jos lukitus ei ole vielä päällä,
               ensimmäinen lukitus kytkee sen ja jättää kaikki muut auki —
               muuten yksi napautus sulkisi vahingossa koko talon. */
            floorFocus={floorFocus}
            onToggleFloorLock={canEditLocks ? (f, lock) => {
              const floors = project.building.floors;
              const open = project.guided?.enabled
                ? (project.guided.openFloors ?? floors)
                : floors;
              const next = lock ? open.filter((x) => x !== f) : Array.from(new Set([...open, f]));
              void onGuidedSet({ enabled: true, openFloors: floors.filter((x) => next.includes(x)) });
            } : undefined}
            /* Yhden ikkunan piilotus kartalta. EI kytke ohjattua etenemistä
               päälle: yhden pisteen piilottaminen on pieni arkinen teko, eikä
               sen pidä muuttaa jokaisen kerroksen käyttäytymistä kerralla. */
            onToggleWindowLock={canEditLocks
              ? (key, lock) => {
                  void (async () => {
                    const saved = await onGuidedSet(lock ? { lockWindow: key } : { unlockWindow: key });
                    if (!saved) return;                       // virhe näytettiin jo
                    const nowLocked = (saved.lockedKeys ?? []).includes(key);
                    if (nowLocked !== lock) {
                      // Pyyntö onnistui mutta tila ei muuttunut. Käytännössä
                      // tämä tarkoittaa että palvelin ei vielä tunne
                      // lockWindow-kenttää (julkaisu tekemättä). Sanotaan se
                      // suoraan sen sijaan että toiminto olisi hiljaa mykkä.
                      setError(lock
                        ? "Piilotus ei tallentunut — palvelimen päivitys puuttuu."
                        : "Avaus ei tallentunut — palvelimen päivitys puuttuu.");
                      return;
                    }
                    const n = (saved.lockedKeys ?? []).length;
                    showFlash(
                      lock
                        ? `Ikkuna piilotettu tekijöiltä · ${n} piilossa`
                        : `Ikkuna näkyy taas tekijöille · ${n} piilossa`,
                      () => { void onGuidedSet(lock ? { unlockWindow: key } : { lockWindow: key }); },
                    );
                  })();
                }
              : undefined}
            lockedWindowKeys={project.guided?.lockedKeys ?? []}
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
      data-fr8-bg
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

/** Pestyn keltaisen hintatila — sama sanasto ruudussa ja rivilistassa. */
const WASHED_STATES: { id: P2WashedState; label: string; color: string }[] = [
  { id: "locked", label: "sovittu", color: "#7CE0A6" },
  { id: "pending", label: "odottaa", color: "rgb(150,175,255)" },
  { id: "unpriced", label: "ei hintaa", color: "rgb(255,205,40)" },
];
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
function P2AdminPanel({ project, jobId, by, onP2, onGoToFloor, onGoToWindow, canSend, p2InvoicedCents = 0 }: {
  project: ProjectData;
  jobId: number;
  by: string;
  onP2: (p2: P2State) => void;
  onGoToFloor: (floor: string) => void;
  onGoToWindow: (floor: string, key: string) => void;
  canSend: boolean;
  /** €-cents of P2 already invoiced (scope:"p2" payments) — from the server. */
  p2InvoicedCents?: number;
}) {
  const p2 = project.p2;
  // Sama perustajasääntö kuin perustajien ansioissa: perustajan itse pesemä
  // keltainen maksaa hänelle koko hinnan, joten siitä ei jää katetta. Ilman
  // tätä KATE-tiili näyttäisi eri luvun kuin perustajien kortit.
  const b = computeP2Billing(project, p2FounderOpts(project));
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
  // ASIAKKAAN EHDOTTAMAT IKKUNAT — TOIMENPIDELISTA, EI LUKU.
  // Tässä oli "💡 asiakas ehdotti N", jossa N laski KAIKKI add_point-tapahtumat
  // ikuisuudesta: myös ne jotka asiakas oli sittemmin poistanut ja ne jotka oli
  // jo hinnoiteltu. Luku ei siis vastannut mihinkään tekemättömään työhön eikä
  // siitä päässyt mihinkään. Nyt jäljellä on se mikä oikeasti odottaa meitä:
  // asiakkaan lisäämä ikkuna joka on yhä kartalla ja jolla EI ole hintaa.
  const customerPending = useMemo(() => {
    const keys = customerAddedKeys(project);
    return keys.filter((k) => !project.p2?.offers[k]);
  }, [project]);
  /** Asiakkaan saate ehdotukselleen: hinta-arvio ja/tai viesti. Ei tarjous. */
  const wishes = project.p2?.wishes ?? {};

  // Peruttavat hyväksynnät kahdella aikarajalla. `since` lasketaan vasta
  // napautuksen hetkellä, jotta "viimeinen tunti" tarkoittaa tuntia taaksepäin
  // siitä hetkestä eikä siitä kun näkymä avattiin.
  // Laskun erittely: mistä ikkunoista laskutettava kertymä koostuu.
  const item = useMemo(() => p2Itemisation(project), [project]);
  const [showItems, setShowItems] = useState(false);
  // Pestyt keltaiset rivi riviltä — avataan PESTY-ruudusta.
  const washedList = useMemo(() => p2WashedYellows(project), [project]);
  const [showWashed, setShowWashed] = useState(false);
  // Valitut hylätyt jotka palautetaan odottamaan hyväksyntää.
  const [restorePick, setRestorePick] = useState<Set<string>>(new Set());

  const [revertArmed, setRevertArmed] = useState<string | null>(null);
  const hourAgo = () => Date.now() - 60 * 60 * 1000;
  const todayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const revertScopes = [
    { id: "hour", label: "Viimeinen tunti", since: hourAgo },
    { id: "today", label: "Tänään", since: todayStart },
  ].map((s) => {
    const locks = p2CustomerLocksSince(p2, s.since());
    return { ...s, locks, sumCents: locks.reduce((n, l) => n + l.lockedCents, 0) };
  });
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
      // Kun vaihe 2 on päällä, tämä ON näkymä eikä liite: se aukeaa itsestään.
      // Suljettuna se oli sivun kahdeksas palkki, ja kaikki mitä siitä näki oli
      // otsikkorivin summa.
      defaultOpen={countered.length > 0 || !!p2?.enabled}
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
          {/* SOVITTU ja PESTY leikkaavat kahdesta eri suunnasta: tämä on
              hyväksytty (pesty tai ei), tuo on pesty (hyväksytty tai ei).
              Yhteinen osa on `earnedCents`. Ilman alariviä ne näyttävät
              kahdelta erilliseltä potilta, ja niiden yhteenlasku antaa summan
              jota ei ole missään — juuri se sai perustajan laskemaan
              1 438,50 + 1 603,50 = 3 042,00 ja epäilemään että 282,50 € on
              hukassa. Erotus on tässä nimeltä mainittuna. */}
          <div style={tile}>
            <span style={tileLabel}>SOVITTU</span>
            <span style={{ ...tileVal, color: "#7CE0A6" }}>{b.lockedCount} kpl · {p2eur(b.lockedSumCents)}</span>
            <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.45)", display: "block", marginTop: 2 }}>
              {b.lockedWashedCount} pesty
              {b.lockedCount > b.lockedWashedCount
                ? ` · ${b.lockedCount - b.lockedWashedCount} pesemättä ${p2eur(b.lockedSumCents - b.earnedCents)}`
                : " · kaikki pesty ✓"}
            </span>
          </div>
          {/* PESTY = kaikki pestyt keltaiset. Tiili näytti ennen pelkkää
              lukittua osajoukkoa (lockedWashedCount), joten kun luvun vähensi
              kokonaismäärästä, erotus oli aivan liian suuri — ja tekijän
              sovellus näytti samasta asiasta eri luvun. Nyt iso luku on koko
              totuus ja erittely kertoo missä raha on menossa. */}
          {/* PESTY-ruutu aukeaa: sen takana on jokainen pesty keltainen omana
              rivinään hintoineen. Loppuluku ei ole tarkistettavissa — rivilista
              on, ja siitä näkee kerros kerrallaan mistä määrä koostuu. */}
          <button
            onClick={() => setShowWashed((v) => !v)}
            aria-expanded={showWashed}
            style={{ ...tile, textAlign: "left", cursor: "pointer", fontFamily: "inherit", border: `1px solid ${showWashed ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.08)"}` }}
          >
            <span style={tileLabel}>PESTY</span>
            <span style={tileVal}>{b.washedTotal} kpl · {p2eur(b.earnedCents + b.pendingEarnedCents)}</span>
            <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.45)", display: "block", marginTop: 2 }}>
              {b.lockedWashedCount} hyväksytty
              {b.pendingWashedCount > 0 ? ` · ${b.pendingWashedCount} odottaa` : ""}
              {/* Hylätty on oma asiansa: työ tehty, asiakas sanoi ei. Se luki
                  ennen "ilman hintaa", jolloin sama ikkuna näkyi kahdella eri
                  nimellä ja näytti tehtävältä jota ei ole. */}
              {b.unpricedWashedCount > 0 ? ` · ${b.unpricedWashedCount} ilman hintaa` : ""}
            </span>
            <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.35)", display: "block", marginTop: 4 }}>
              {showWashed ? "▴ piilota ikkunat" : "▾ näytä kaikki ikkunat"}
            </span>
          </button>
          {b.pendingWashedCount > 0 && (
            <div style={{ ...tile, borderColor: "rgba(150,175,255,0.35)" }}>
              <span style={tileLabel}>ODOTTAA HYVÄKSYNTÄÄ</span>
              <span style={{ ...tileVal, color: "rgb(150,175,255)" }}>{b.pendingWashedCount} kpl · {p2eur(b.pendingEarnedCents)}</span>
              <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.45)", display: "block", marginTop: 2 }}>
                mukana pestyjen summassa
              </span>
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

        {/* PESTYT KELTAISET RIVI RIVILTÄ. Käy kerros kerrallaan läpi: jokainen
            ikkuna, sen numero kartalla, tila ja mitä se tuo summaan. Rivien
            summa lasketaan riveistä ja verrataan ruudun lukuun. */}
        {showWashed && (
          <div style={{ padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,0.03)", border: `1px solid ${washedList.matchesBilling ? "rgba(255,255,255,0.09)" : "rgba(255,120,120,0.5)"}` }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: "12.5px", fontWeight: 700 }}>Pestyt keltaiset</span>
              <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.55)", fontVariantNumeric: "tabular-nums" }}>
                <b style={{ color: "#fff" }}>{washedList.count} kpl</b> · {p2eur(washedList.sumCents)}
              </span>
            </div>
            {!washedList.matchesBilling && (
              <div style={{ marginTop: 6, fontSize: "11.5px", color: "#ff9b9b", lineHeight: 1.5 }}>
                ⚠ Rivien summa ei täsmää ruudun lukuun. Ilmoita tästä ennen laskutusta.
              </div>
            )}

            {/* Tilojen jakauma: näistä osista määrä ja summa koostuvat. */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 9 }}>
              {WASHED_STATES.map(({ id, label, color }) => {
                const st = washedList.byState[id];
                if (st.count === 0) return null;
                return (
                  <span key={id} style={{ display: "inline-flex", alignItems: "baseline", gap: 5, padding: "4px 10px", borderRadius: 999, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", fontSize: "11.5px", fontVariantNumeric: "tabular-nums" }}>
                    <b style={{ color }}>{st.count}</b>
                    <span style={{ color: "rgba(255,255,255,0.7)" }}>{label}</span>
                    <span style={{ color: "rgba(255,255,255,0.35)" }}>{st.sumCents > 0 ? p2eur(st.sumCents) : "0 €"}</span>
                  </span>
                );
              })}
            </div>

            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              {washedList.byFloor.map((g) => (
                <div key={g.floor}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: "12px", fontWeight: 700, paddingBottom: 4, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                    <span>{g.floor === "K" ? "Kellari" : `${g.floor}. kerros`} · {g.count} kpl</span>
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>{p2eur(g.sumCents)}</span>
                  </div>
                  {g.lines.map((l) => {
                    const st = WASHED_STATES.find((w) => w.id === l.state)!;
                    const picked = restorePick.has(l.key);
                    return (
                      <div key={l.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "11.5px", color: "rgba(255,255,255,0.6)", padding: "2px 0" }}>
                        {/* Rivi avaa ikkunan kartalla — sen voi käydä katsomassa. */}
                        <button
                          onClick={() => onGoToWindow(l.floor, l.key)}
                          title="Näytä kartalla"
                          style={{ flex: 1, minWidth: 0, textAlign: "left", background: "transparent", border: "none", padding: "4px 0", color: "inherit", font: "inherit", cursor: "pointer" }}
                        >
                          Keltainen {l.number} <span style={{ color: st.color }}>· {st.label}</span>
                          {l.wasDeclined && <span style={{ color: "rgba(255,255,255,0.3)" }}> · torjuttu kerran</span>}
                        </button>
                        {/* Hylätty voidaan palauttaa odottamaan hyväksyntää:
                            "Ei" on asiakkaan näkymässä hyväksynnän vieressä ja
                            osuu vahingossa, eikä asiakas voi perua sitä itse. */}
                        {l.wasDeclined && (
                          <button
                            onClick={() => setRestorePick((s2) => { const n = new Set(s2); n.has(l.key) ? n.delete(l.key) : n.add(l.key); return n; })}
                            style={{ flexShrink: 0, padding: "3px 9px", borderRadius: 999, cursor: "pointer", fontFamily: "inherit", fontSize: "11px", fontWeight: 600,
                              border: `1px solid ${picked ? "#7CE0A6" : "rgba(255,255,255,0.18)"}`,
                              background: picked ? "rgba(124,224,166,0.16)" : "transparent",
                              color: picked ? "#7CE0A6" : "rgba(255,255,255,0.55)" }}
                          >
                            {picked ? "✓ palautetaan" : "palauta"}
                          </button>
                        )}
                        <span style={{ flexShrink: 0, minWidth: 62, textAlign: "right", fontVariantNumeric: "tabular-nums", color: l.priceCents > 0 ? "#fff" : "rgba(255,255,255,0.3)" }}>
                          {l.priceCents > 0 ? p2eur(l.priceCents) : "—"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: "13px", fontWeight: 700, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.14)" }}>
                <span>Yhteensä {washedList.count} kpl</span>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{p2eur(washedList.sumCents)}</span>
              </div>
              {restorePick.size > 0 && (
                <button
                  disabled={busy}
                  onClick={() => {
                    const keys = Array.from(restorePick);
                    setRestorePick(new Set());
                    void run(() => api.p2RestoreDeclined(jobId, { keys, by }), `Palautettu odottamaan hyväksyntää: ${keys.length} kpl`);
                  }}
                  style={{ ...btn, marginTop: 4, border: "none", background: "#3E7C59", color: "#fff", fontWeight: 700 }}
                >
                  Palauta {restorePick.size} ikkunaa odottamaan hyväksyntää
                </button>
              )}
            </div>
          </div>
        )}

        {/* LASKUN ERITTELY. Ennen ensimmäistä keltaisten laskua pitää nähdä
            mistä ikkunoista summa koostuu — ei pelkkää loppusummaa. Erittely
            lasketaan eri funktiossa kuin laskutusperusta, ja niiden täsmäävyys
            tarkistetaan: jos ne eroavat sentinkin, tässä lukee punaisella eikä
            laskua pidä lähettää. */}
        {item.lines.length > 0 && (
          <div style={{ padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,0.03)", border: `1px solid ${item.matchesBilling ? "rgba(255,255,255,0.09)" : "rgba(255,120,120,0.5)"}` }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: "12.5px", fontWeight: 700 }}>Laskun erittely</span>
              <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.55)", fontVariantNumeric: "tabular-nums" }}>
                {item.lines.length} ikkunaa · <b style={{ color: "#fff" }}>{p2eur(item.totalCents)}</b>
              </span>
              <button style={{ ...btn, marginLeft: "auto", minHeight: 36, padding: "8px 12px", fontSize: "12px" }} onClick={() => setShowItems((v) => !v)}>
                {showItems ? "Piilota" : "Näytä ikkunat"}
              </button>
            </div>
            <div style={{ fontSize: "11.5px", lineHeight: 1.6, marginTop: 6, color: item.matchesBilling ? "rgba(255,255,255,0.5)" : "#ff9b9b" }}>
              {item.matchesBilling
                ? <>Pesty ja hinta sovittu. Täsmää laskutusperustaan ✓ {p2InvoicedCents > 0 ? `· aiemmin laskutettu ${p2eur(p2InvoicedCents)} · laskutettavaa ${p2eur(p2Remaining)}` : "· ei vielä laskutettu"}</>
                : <>⚠ Erittely {p2eur(item.totalCents)} ≠ laskutusperusta {p2eur(item.earnedCents)}. Älä lähetä laskua ennen kuin ero on selvitetty.</>}
            </div>

            {/* HINTAJAKAUMA. Keltaisten hinnat sovitaan ikkunakohtaisesti, joten
                loppusumma ei kerro hinnoista mitään eikä summa/ikkunamäärä ole
                kenenkään hyväksymä hinta. Tässä näkyvät todelliset hinnat — ja
                yksikin näppäilyvirhe erottuu omana portaanaan. */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 9 }}>
              {item.byPrice.map((b) => (
                <span key={b.priceCents} style={{ display: "inline-flex", alignItems: "baseline", gap: 5, padding: "4px 10px", borderRadius: 999, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", fontSize: "11.5px", fontVariantNumeric: "tabular-nums" }}>
                  <b style={{ color: "#fff" }}>{b.count} ×</b>
                  <span style={{ color: "rgba(255,255,255,0.75)" }}>{p2eur(b.priceCents)}</span>
                  <span style={{ color: "rgba(255,255,255,0.35)" }}>= {p2eur(b.sumCents)}</span>
                </span>
              ))}
            </div>

            {showItems && (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                {item.byFloor.map((g) => (
                  <div key={g.floor}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: "12px", fontWeight: 700, paddingBottom: 4, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                      <span>{g.floor === "K" ? "Kellari" : `${g.floor}. kerros`} · {g.count} kpl</span>
                      <span style={{ fontVariantNumeric: "tabular-nums" }}>{p2eur(g.sumCents)}</span>
                    </div>
                    {g.lines.map((l) => (
                      <div key={l.key} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: "11.5px", color: "rgba(255,255,255,0.6)", padding: "3px 0" }}>
                        <span>
                          Ikkuna {l.number}
                          <span style={{ color: "rgba(255,255,255,0.35)" }}>
                            {" · "}{l.lockedBy === "admin" ? "me hyväksyimme" : "asiakas hyväksyi"}
                            {l.lockedAt ? ` ${new Date(l.lockedAt).toLocaleString("fi-FI", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}
                          </span>
                        </span>
                        <span style={{ fontVariantNumeric: "tabular-nums", color: "#fff" }}>{p2eur(l.priceCents)}</span>
                      </div>
                    ))}
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: "13px", fontWeight: 700, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.14)" }}>
                  <span>Yhteensä</span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>{p2eur(item.totalCents)}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* HÄTÄPERUUTUS. Hyväksyntänappi on asiakkaan näkymässä, ja sitä voi
            painaa vahingossa — esimerkiksi kun keikkaa testataan asiakkaan
            linkillä. Tämä rivi ilmestyy vain jos peruttavaa on, ja se kertoo
            tarkalleen mitä se peruu ennen kuin mitään tapahtuu. */}
        {revertScopes.some((s) => s.locks.length > 0) && (
          <div style={{ padding: "12px 14px", borderRadius: 12, background: "rgba(255,205,40,0.07)", border: "1px solid rgba(255,205,40,0.3)" }}>
            <div style={{ fontSize: "12.5px", fontWeight: 700, color: "#ffce28" }}>Peru asiakkaan hyväksyntä</div>
            <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.6)", lineHeight: 1.55, marginTop: 4 }}>
              Palauttaa ikkunat odottamaan hyväksyntää alkuperäisellä hinnalla. Koskee vain
              asiakkaan itsensä hyväksymiä — meidän hyväksymämme vastatarjoukset eivät lähde mukaan.
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              {revertScopes.filter((s) => s.locks.length > 0).map((s) => (
                <button
                  key={s.id}
                  disabled={busy}
                  onClick={() => {
                    if (revertArmed !== s.id) { setRevertArmed(s.id); return; }
                    setRevertArmed(null);
                    void run(
                      () => api.p2RevertAccepts(jobId, { since: s.since(), by }),
                      `Palautettu odottamaan hyväksyntää: ${s.locks.length} kpl`,
                    );
                  }}
                  style={{
                    ...btn,
                    border: `1px solid ${revertArmed === s.id ? "#ffce28" : "rgba(255,206,40,0.35)"}`,
                    background: revertArmed === s.id ? "rgba(255,205,40,0.18)" : "rgba(255,255,255,0.05)",
                    color: "#ffce28",
                  }}
                >
                  {revertArmed === s.id
                    ? `Vahvista — palauta ${s.locks.length} kpl (${p2eur(s.sumCents)})`
                    : `${s.label} · ${s.locks.length} kpl · ${p2eur(s.sumCents)}`}
                </button>
              ))}
              {revertArmed && (
                <button style={btn} onClick={() => setRevertArmed(null)}>Peru</button>
              )}
            </div>
          </div>
        )}

        {/* Yksi tilarivi: hinnoittelematta / odottaa asiakasta / asiakkaan lisäämät. */}
        <div style={{ fontSize: "12.5px", color: "rgba(255,255,255,0.6)", display: "flex", gap: 14, flexWrap: "wrap" }}>
          {/* Osien on summauduttava kokonaismäärään. Ennen tästä puuttuivat
              vastatarjoukset ja hylätyt, joten rivi näytti kadottavan ikkunoita. */}
          <span><b style={{ color: "#fff" }}>{b.yellowTotal}</b> keltaista</span>
          <span><b style={{ color: "#7CE0A6" }}>{b.lockedCount}</b> sovittu</span>
          <span><b style={{ color: "rgb(150,175,255)" }}>{b.proposedCount}</b> odottaa asiakasta</span>
          {b.counteredCount > 0 && <span><b style={{ color: "rgb(255,205,40)" }}>{b.counteredCount}</b> vastatarjous</span>}
          {b.declinedCount > 0 && <span><b style={{ color: "rgba(255,150,150,0.9)" }}>{b.declinedCount}</b> hylätty</span>}
          {b.yellowTotal - b.pricedCount > 0 && <span><b style={{ color: "rgb(255,205,40)" }}>{b.yellowTotal - b.pricedCount}</b> ilman hintaa</span>}
        </div>

        {/* ASIAKKAAN EHDOTTAMAT — sama muoto kuin hinnoittelemattomilla pestyillä,
            koska se on sama tehtävä: avaa kerros ja anna hinta. Asiakas on
            merkinnyt ikkunan itse ja odottaa meiltä hintaa; ilman tätä listaa
            se hukkui muiden hinnoittelemattomien joukkoon eikä mikään kertonut
            että joku odottaa vastausta. */}
        {customerPending.length > 0 && (
          <div style={{ padding: "10px 13px", borderRadius: 11, background: "rgba(150,175,255,0.09)", border: "1px solid rgba(150,175,255,0.32)", fontSize: "12.5px", color: "rgba(205,220,255,0.95)" }}>
            <div style={{ marginBottom: 7 }}>
              💡 Asiakas ehdotti {customerPending.length} {customerPending.length === 1 ? "ikkunaa" : "ikkunaa"} — anna hinta:
            </div>
            {/* ASIAKKAAN SAATE NÄKYVIIN. Hinta-arvio ja viesti ovat juuri se
                tieto jonka varassa hinnoittelu tehdään — ilman niitä piste on
                pelkkä koordinaatti ja hinta arvaus. Rivi näyttää ne suoraan,
                ei linkin takana. */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {customerPending.slice(0, 24).map((k) => {
                const fl = k.split("#")[0];
                const w = wishes[k];
                return (
                  <button key={k} onClick={() => onGoToFloor(fl)}
                    title={`Avaa kerros ${fl} — ikkuna ${k}`}
                    style={{ display: "flex", alignItems: "baseline", gap: 8, textAlign: "left", width: "100%", padding: "6px 10px", borderRadius: 9, border: "1px solid rgba(150,175,255,0.35)", background: "rgba(150,175,255,0.10)", color: "rgba(215,228,255,0.98)", fontFamily: "var(--font-onest, system-ui, sans-serif)", fontSize: "11.5px", fontWeight: 600, cursor: "pointer" }}>
                    <span style={{ flexShrink: 0 }}>Krs {fl}</span>
                    {w?.cents ? (
                      <span style={{ flexShrink: 0, color: "rgb(255,205,40)", fontWeight: 700 }}>toivoo {p2eur(w.cents)}</span>
                    ) : null}
                    {w?.note ? (
                      <span style={{ minWidth: 0, opacity: 0.85, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>”{w.note}”</span>
                    ) : null}
                    {!w?.cents && !w?.note && (
                      <span style={{ opacity: 0.5, fontWeight: 500 }}>ei saatetta</span>
                    )}
                  </button>
                );
              })}
              {customerPending.length > 24 && (
                <span style={{ opacity: 0.8 }}>+{customerPending.length - 24}</span>
              )}
            </div>
          </div>
        )}

        {/* Pesty ilman hintaa — perustajan tehtävälista, ei varoitusseinä. */}
        {/* HINNOITTELEMATTOMAT: KERRO MITKÄ, ÄLÄ VAIN MONTAKO.
            Tässä luki "3 pesty ilman hintaa — hinnoittele ne kartalla", eikä
            mikään kertonut MITKÄ kolme. Kun kaikki näyttää hinnoitellulta,
            luvusta tulee väite jota ei voi tarkistaa — ja silloin uskotaan
            että järjestelmä on väärässä. Avaimet ovat olleet laskennassa koko
            ajan (`washedUnlockedKeys`), niitä ei vain näytetty. Nyt jokaisesta
            pääsee suoraan sen kerroksen kartalle. */}
        {b.unpricedWashedCount > 0 && (
          <div style={{ padding: "10px 13px", borderRadius: 11, background: "rgba(255,176,72,0.08)", border: "1px solid rgba(255,176,72,0.3)", fontSize: "12.5px", color: "rgba(255,220,160,0.95)" }}>
            <div style={{ marginBottom: 7 }}>
              {b.unpricedWashedCount} pesty keltainen ilman hintaa — avaa ja hinnoittele:
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {b.washedUnlockedKeys.slice(0, 24).map((k) => {
                const fl = k.split("#")[0];
                return (
                  <button key={k} onClick={() => onGoToFloor(fl)}
                    title={`Avaa kerros ${fl} — ikkuna ${k}`}
                    style={{ padding: "4px 10px", borderRadius: 999, border: "1px solid rgba(255,176,72,0.45)", background: "rgba(255,176,72,0.12)", color: "rgba(255,225,175,0.98)", fontFamily: "var(--font-onest, system-ui, sans-serif)", fontSize: "11.5px", fontWeight: 600, cursor: "pointer" }}>
                    Krs {fl}
                  </button>
                );
              })}
              {b.washedUnlockedKeys.length > 24 && (
                <span style={{ alignSelf: "center", opacity: 0.8 }}>+{b.washedUnlockedKeys.length - 24}</span>
              )}
            </div>
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
            {/* Taulukon rivit ovat ANKKUREITA: niiden välissä palkkio kulkee
                suoraan, joten väliin osuva hinta ei enää pudota palkkiota.
                Sanotaan se tässä, koska se on koko taulukon lukuohje. */}
            <div style={{ fontSize: "11.5px", color: "rgba(255,255,255,0.45)", lineHeight: 1.55, paddingTop: 4 }}>
              Rivien välissä palkkio kulkee suoraan: 36,00 € → {p2eur(p2WorkerPayoutCents(3600, sharePct, p2?.payoutSchedule))}.
              Alimman ja ylimmän rivin ulkopuolella käytetään lähimmän rivin osuutta.
              Kalliimpi ikkuna ei voi maksaa tekijälle vähemmän kuin halvempi.
            </div>
            {/* Prosentti pätee vain jos taulukko on tyhjä — sanotaan se, ettei
                kenttä lupaa vaikutusta jota sillä ei ole. */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.07)" }}>
              <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.5)" }}>Jos taulukko on tyhjä</span>
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
  onGuidedSet: (data: { enabled?: boolean; activeFloorOverride?: string | null; openFloors?: string[] }) => Promise<unknown>;
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
                  {/* data-fr8-pop: leijuva selite, tarvitsee peittävän taustan. */}
                  <div data-fr8-pop style={{ position: "absolute", left: 0, top: "calc(100% + 6px)", zIndex: 50, width: "min(320px, calc(100vw - 32px))", padding: "14px 16px", borderRadius: "12px", background: "rgba(18,18,22,0.97)", border: "1px solid rgba(255,255,255,0.14)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", boxShadow: "0 16px 40px rgba(0,0,0,0.65)" }}>
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
