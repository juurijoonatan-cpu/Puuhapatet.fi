/**
 * FR8 projektinäkymä — overview dashboard (ported from fr8-ikkunat prototype).
 * Adds a per-worker "TEKIJÄT" strip (window counts + €/h optimisation).
 */
import { allPoints, computeDealBilling, checkWindowAttribution, type ProjectData, type WindowStatus, type WorkerStat, type FixedDeal } from "@shared/project";
import { computeP2Billing } from "@shared/p2";
import type { GigBillingState } from "@/lib/api";
import { useIsMobile } from "@/hooks/use-mobile";
import { useState, useEffect } from "react";
import Section from "./Section";
import Toggle from "./Toggle";
import {
  T, card as tokenCard, inset, mono as tokenMono, statLabel, subLabel,
  button as tokenButton, input as tokenInput,
} from "./tokens";

/**
 * Tekijän luvut kortille. Perus-`WorkerStat`in päälle ne osat joista ansio
 * OIKEASTI koostuu, koska yksi keskiarvo ei kelpaa: kortilla luki "€ / ikkuna",
 * joka oli ansio jaettuna KAIKILLA pestyillä ikkunoilla — myös niillä
 * keltaisilla joista asiakas ei ole vielä hyväksynyt hintaa ja joista ei siis
 * makseta vielä mitään. Kaksi tekijää samalla taksalla näyttivät siksi
 * ansaitsevan eri verran ikkunaa kohti, ja enemmän pessyt näytti tienaavan
 * vähemmän. Luku ei ollut väärin laskettu, se oli väärä luku.
 */
export interface DashWorkerStat extends WorkerStat {
  /** Sovituista keltaisista kertynyt palkkio (senttiä). */
  p2Cents?: number;
  /** Pestyjä keltaisia joiden hintaa asiakas ei ole hyväksynyt — ei vielä rahaa. */
  p2PendingCents?: number;
  p2PendingCount?: number;
  /** Tekijän oma €/punainen ikkuna (perustajalla sisäinen kate). */
  rateCents?: number;
}

interface Props {
  project: ProjectData;
  workerStats: DashWorkerStat[];
  workerName: (id: string) => string;
  onGoToFloor: (floor: string) => void;
  /** When set, a signed fixed-price deal drives the money figures (FR8). */
  deal?: FixedDeal | null;
  /** Manually set/clear a person's earnings (founders' agreed split). */
  onSetEarnings?: (id: string, cents: number | null) => void;
  /** Per-founder (boss) earnings breakdown — own work + profit share from the
   *  workers' windows. Only set for a signed deal; drives the "bossien ansiot" card. */
  founderEarnings?: {
    id: string; name: string; ownWashed: number; ownCents: number; shareCents: number;
    p2Cents?: number; p2Washed?: number;
    /** Osuus SOVITTUJEN keltaisten katteesta (computeP2Billing.marginCents / n). */
    p2MarginCents?: number;
    /** Teoreettinen lisä: jo pesty, mutta asiakas ei ole hyväksynyt hintaa. */
    theoreticalCents?: number;
    /** Vastuulla olevat harjoittelijat — EI osa yllä olevia lukuja. */
    trainees?: { id: string; name: string; washed: number; cents: number; paidCents: number }[];
    totalCents: number; manual: boolean; hours: number;
  }[];
  /** Total paid to the real workers for RED windows (labour cost) — the other side
   *  of the red contract margin. Keltaisten tekijäkulu on erikseen alla. */
  workerLaborCents?: number;
  /** Työntekijöiden KELTAISISTA (2. vaihe) kertynyt palkkio — oma rahansa, ei osa
   *  punaisten sopimushinnan jakoa. */
  workerLaborP2Cents?: number;
  /** FR8 erälaskutus (kohta 3C.1): renderöi "Maksut"-toiminnon TOISEN johtajan
   *  kortille perustajien osiossa — omalle kortille palautetaan null. Slotina,
   *  koska vain project.tsx tietää kuka katsoo (getAdminProfile). */
  founderInvoiceSlot?: (founderId: string) => React.ReactNode;
  /** Asiakaslaskutuksen tila (punaisten 4 erää + keltaiset) serveriltä. Ajaa
   *  LASKUTUS & MAKSUT -statsipalkin. Ei toimintoja täällä — lasku lähetetään
   *  keikkanäkymästä ja tekijöille maksetaan Maksut-välilehdeltä. */
  gigBilling?: GigBillingState | null;
  /** Paljonko tekijöille on PUNAISISTA vielä siirtämättä (shared/worker-payouts). */
  workerOpenP1Cents?: number;
  /** Hyppy Maksut-välilehdelle, jossa tekijöille maksetaan. */
  onGoToMaksut?: () => void;
  /** Dynamic per-window rate for founders (sisäinen kate = capCents / totalRedWindows).
   *  Replaces the nominal deal.pricePerWindow in the footer explanation text. */
  founderRateEur?: number;
  /** Total of project expenses in cents — drives the collapsed KULUT bar summary. */
  expensesTotalCents?: number;
  /** Rendered <ExpensesView>, shown inside the collapsible KULUT section (no longer
   *  its own tab). Handlers/data stay owned by the project page. */
  expensesSlot?: React.ReactNode;
  /** P2 (keltaiset ikkunat) — per-window pricing admin panel. Rendered as a slot
   *  because only project.tsx owns the API handlers. */
  p2Slot?: React.ReactNode;
  /** Apuasetukset (kerrosten lukitus) — dashin alalaitaan, pois päänäkymästä. */
  settingsSlot?: React.ReactNode;
}

function fmt(n: number) { return Math.round(n).toLocaleString("fi-FI"); }
function euro(n: number) { return n.toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "\u00a0€"; }
/** Per-window price — keeps cents (e.g. "37,50 €") so 37.5 never rounds to 38. */
function euroUnit(n: number) {
  return n.toLocaleString("fi-FI", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }) + "\u00a0€";
}
function ago(ts: number) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return "juuri nyt";
  if (s < 3600) return Math.floor(s / 60) + " min";
  if (s < 86400) return Math.floor(s / 3600) + " h";
  return Math.floor(s / 86400) + " pv";
}
function statusLabel(s: WindowStatus) { return s === "pesty" ? "Pesty" : s === "kesken" ? "Kesken" : "Ei pesty"; }
function colorRgb(p: 1 | 2, status: WindowStatus) {
  if (status === "pesty") return p === 1 ? "255,72,72" : "255,205,40";
  if (status === "kesken") return "188,150,255";
  return p === 1 ? "255,140,178" : "240,226,150";
}

/** Kortti, tiili, mono-etiketti ja nappi tulevat nyt jaetuista poleteista
 *  (`./tokens`), jotta dash ja Maksut-välilehti näyttävät samalta. Aiemmin
 *  samasta kortista oli neljä eri versiota (reunus 0,08 vs 0,09, pyöristys
 *  16/20/22) ja mono-etiketistä yhdeksän. */
const card = tokenCard;
const mono = tokenMono;

export default function Dashboard({ project, workerStats, workerName, onGoToFloor, deal, onSetEarnings, founderEarnings, workerLaborCents, founderRateEur, expensesTotalCents, expensesSlot, founderInvoiceSlot, gigBilling, workerLaborP2Cents, workerOpenP1Cents, onGoToMaksut, p2Slot, settingsSlot }: Props) {
  const m = useIsMobile();
  const [editId, setEditId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");
  const [openSessions, setOpenSessions] = useState<string | null>(null);
  // Kumman perustajan harjoittelijalista on auki (oletuksena piilossa).
  const [openTrainees, setOpenTrainees] = useState<string | null>(null);
  // Workers strip: false = show everyone assigned (incl. 0-activity like Oona),
  // true = only people who've washed a window or logged hours.
  const [showActiveOnly, setShowActiveOnly] = useState(false);
  // €/h + tunnit are hidden by default — too much info, and hours are rarely logged.
  const [showTeho, setShowTeho] = useState(false);
  // Kulut live in a popup, off the main view (rarely used right now).
  const [showExpenses, setShowExpenses] = useState(false);
  const crewMemberOf = (id: string) => (project.crew || []).find((c) => c.id === id);
  // Live clock for "shift running" indicators (ticks once a minute).
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  const shiftStartFor = (id: string) => (project.crew || []).find((c) => c.id === id)?.activeShiftAt;
  const fmtDur = (ms: number) => {
    const min = Math.max(0, Math.floor(ms / 60000)), h = Math.floor(min / 60), mm = min % 60;
    return h > 0 ? `${h} t ${mm} min` : `${mm} min`;
  };
  const FLOORS = project.building.floors;
  const PRICE = deal ? deal.pricePerWindow : project.pricePerWindow;
  const CIRC = 2 * Math.PI * 80;
  // Money model: a signed deal accrues only on the billable priority (red) and
  // is capped at the agreed total; an open gig bills every washed window.
  const billing = deal ? computeDealBilling(project, deal) : null;
  const capEur = billing ? billing.capCents / 100 : 0;
  const all = allPoints(project);
  const log = project.log;
  // Kohta 6.1: kokonaistilanteen ikkunamäärän pitää täsmätä tekijöiden/johtajien
  // attribuoitujen ikkunoiden tarkkaan summaan. Elävä tarkistus (ei vain
  // yksikkötesti) — jos joku pesty ikkuna jää ilman attribuutiota, näytetään
  // hienovarainen varoitus johtajille sen sijaan että virhe jäisi huomaamatta.
  const attributionCheck = checkWindowAttribution(project);

  const total = all.length;
  const washed = all.filter((a) => a.status === "pesty").length;
  // Kerroksittain-osion otsikko laskee samaa asiaa kuin sen rivit: punaiset.
  const redPoints = all.filter((a) => a.p === 1);
  const redTotal = redPoints.length;
  const redDone = redPoints.filter((a) => a.status === "pesty").length;
  const kesken = all.filter((a) => a.status === "kesken").length;

  const grp = (p: 1 | 2) => {
    const arr = all.filter((a) => a.p === p);
    const w = arr.filter((a) => a.status === "pesty").length;
    const k = arr.filter((a) => a.status === "kesken").length;
    const pc = arr.length > 0 ? (w / arr.length) * 100 : 0;
    return { total: arr.length, washed: w, kesken: k, pctStr: Math.round(pc) + " %", pct: pc, revStr: euro(w * PRICE) };
  };
  const p1 = grp(1), p2 = grp(2);

  // ── P2 (keltaiset) ────────────────────────────────────────────────────────────
  // Lukitut keltaiset = asiakkaan hyväksymät hinnat → ne KUULUVAT työn piiriin
  // aivan kuten punaiset. Sen takia ne lasketaan mukaan edistymiseen alla.
  const p2On = !!project.p2?.enabled;
  const p2b = computeP2Billing(project);
  const lockedYellowKeys = new Set<string>(
    p2On
      ? Object.entries(project.p2?.offers ?? {})
          .filter(([, o]) => o.status === "locked" && !!o.lockedCents)
          .map(([k]) => k)
      : [],
  );

  // ── Hero scope ────────────────────────────────────────────────────────────────
  // For a signed deal (FR8) the first view is about the CONTRACT windows, not the
  // full dot count on the map. Alkuperäisessä mallissa se tarkoitti VAIN punaisia
  // — mutta kun 2. vaihe on avattu ja asiakas on hyväksynyt keltaisia hintoja, ne
  // ovat osa sovittua työtä. Siksi piiri on nyt **punaiset + lukitut keltaiset**:
  // prosentti ei enää näytä 100 % silloin kun sovittuja keltaisia on pesemättä.
  // Hinnoittelemattomat/lukitsemattomat keltaiset EIVÄT ole piirissä (niistä ei
  // ole sovittu mitään), joten ne eivät voi jumittaa lukua alas.
  const inScope = deal
    ? all.filter((a) => a.p === deal.billablePriority || lockedYellowKeys.has(a.key))
    : all;
  const scopeWashed = inScope.filter((a) => a.status === "pesty").length;
  const scopeKesken = inScope.filter((a) => a.status === "kesken").length;
  const billGrp = deal ? grp(deal.billablePriority) : null;
  const heroTotal = deal ? inScope.length : total;
  const heroWashed = deal ? scopeWashed : washed;
  const heroKesken = deal ? scopeKesken : kesken;
  const heroUnwashed = heroTotal - heroWashed - heroKesken;
  const heroPct = heroTotal > 0 ? (heroWashed / heroTotal) * 100 : 0;
  const heroPctStr = Math.round(heroPct) + " %";
  // Onko piirissä keltaisia? Ohjaa otsikkoa ja erittelyriviä.
  const scopeHasYellow = p2b.lockedCount > 0 && p2On;
  // Internal per-window margin for the bosses: the FIXED agreed total spread over the
  // live billable windows. Deleting red dots raises this (fewer windows for the same
  // €6300), while the worker's own €/window rate is unchanged. Never shown to workers
  // or the customer — this is the founders' admin overview only.
  const internalPerWindowEur = billing && billing.billableTotal > 0 ? capEur / billing.billableTotal : 0;

  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  const todaySet = new Set<string>();
  const inScopeKeys = new Set(inScope.map((a) => a.key));
  // TÄNÄÄN TEHTY = KAIKKI TÄNÄÄN PESTY, EI VAIN SOVITTU.
  // Tämä suodatti ennen `inScopeKeys`illä eli punaisiin + LUKITTUIHIN
  // keltaisiin. Kun päivä koostui keltaisista joiden hintaa asiakas ei ollut
  // vielä hyväksynyt, kortti näytti "1 ikkunaa" vaikka lokissa oli viisi —
  // ja päivän työ näytti katoavan. "Tänään tehty" on kysymys tehdystä työstä,
  // ei sopimuksen laajuudesta: se laskee kaiken.
  const todayAll = new Set<string>();
  log.forEach((l) => {
    if (l.status !== "pesty" || l.ts < startToday.getTime()) return;
    todayAll.add(l.key);
    if (!deal || inScopeKeys.has(l.key)) todaySet.add(l.key);
  });
  // Vauhtiarvio käyttää sovittua piiriä, koska "jäljellä" on sopimuksen
  // jäljellä — muuten päivät ja jäljellä olevat mittaisivat eri asiaa.
  const todayWindows = todaySet.size;
  const todayAllWindows = todayAll.size;
  // Remaining + day estimate track the SAME scope as the hero, "today" and the
  // pay-progress: for a signed deal that's the billable (red) set, otherwise all
  // windows. (Previously this always used the full map total, so a deal's "days
  // left" divided red-per-day into all-windows-left — an inconsistent estimate.)
  const estTotal = deal ? heroTotal : total;
  const estWashed = deal ? heroWashed : washed;
  const remaining = Math.max(0, estTotal - estWashed);
  const estStr = remaining === 0 && estTotal > 0 ? "valmis" : todayWindows > 0 ? "~" + Math.ceil(remaining / todayWindows) + " työpv" : "—";

  const activity = log.slice(0, 5).map((l) => {
    const rgb = colorRgb(l.p, l.status);
    const num = l.key.includes("#c") ? " (lisätty)" : " " + (parseInt(l.key.split("#")[1], 10) + 1);
    const who = l.by ? " · " + workerName(l.by) : "";
    return { color: `rgb(${rgb})`, glow: `rgba(${rgb},0.7)`, title: "Ikkuna" + num + " — " + statusLabel(l.status), sub: "Kerros " + l.floor + " · P" + l.p + who, time: ago(l.ts) };
  });

  // Full crew for the strip: every worker with stats PLUS any assigned crew member
  // who hasn't done anything yet (e.g. Oona) so they're visible from day one. The
  // "Vain aktiiviset" toggle narrows this to people with windows/hours.
  //
  // Admin-linkitetyt tekijät (esim. Petrus Aalto, joka on myös Puuhapatet-admin)
  // kuuluvat listaan siinä missä muutkin — heidät jätettiin aiemmin pois, joten
  // Petrus katosi rankingista kokonaan jos hänellä ei vielä ollut pesyjä ikkunoita.
  // Sama joukko kuin Tiimi-sivulla (/api/jobs/:id/crew näyttää admin-linkitetyt).
  const statIds = new Set(workerStats.map((s) => s.worker));
  const zeroStats = (project.crew || [])
    .filter((c) => c.active !== false && c.role === "worker" && !statIds.has(c.id))
    .map((c): DashWorkerStat => ({ worker: c.id, washed: 0, washedP1: 0, washedP2: 0, revenueCents: 0, hours: 0, windowsPerHour: 0, eurPerHour: 0 }));
  const allWorkers: DashWorkerStat[] = [...workerStats, ...zeroStats].sort((a, b) => b.washed - a.washed);
  const activeWorkers = allWorkers.filter((s) => s.washed > 0 || s.hours > 0);
  const shownWorkers = showActiveOnly ? activeWorkers : allWorkers;

  // Founders' combined earnings — shown as the collapsed summary on the
  // "PERUSTAJIEN ANSIOT" bar so the headline figure is glanceable while folded.
  const foundersTotalCents = (founderEarnings ?? []).reduce((s, f) => s + f.totalCents, 0);
  // Kolmen tiilen rivi (Sopimushinta / Työntekijöille / Perustajille) on PUNAISTEN
  // jako, joten perustajien luvusta erotetaan heidän keltainen palkkionsa. Keltaiset
  // näytetään omana rivinä tiilien alla.
  const foundersP2Cents = (founderEarnings ?? []).reduce((s, f) => s + (f.p2Cents ?? 0) + (f.p2MarginCents ?? 0), 0);
  const foundersRedCents = foundersTotalCents - foundersP2Cents;
  /** Teoreettinen kokonaisluku: vahvistettu + jo tehty mutta hyväksymätön. */
  const foundersTheoreticalCents = foundersTotalCents + (founderEarnings ?? []).reduce((s, f) => s + (f.theoreticalCents ?? 0), 0);
  const laborCents = workerLaborCents ?? 0;

  // Crew on the clock right now — drives the "KÄYNNISSÄ NYT" strip pinned under the
  // hero. Read straight from the crew so someone who just started (0 windows yet)
  // still shows. The strip is hidden entirely when nobody is working.
  const runningShifts = (project.crew || [])
    .filter((c) => c.activeShiftAt)
    .map((c) => ({ id: c.id, name: workerName(c.id), since: c.activeShiftAt as number }))
    .sort((a, b) => a.since - b.since);


  return (
    <div
      data-fr8-pane
      style={{
        height: "100%", overflowY: "auto", overflowX: "hidden", overscrollBehavior: "contain",
        boxSizing: "border-box",
        // Alalaidan 96 px oli kopioitu FloorView'stä, jossa on kelluva
        // alapalkki. Dashissa ei ole mitään kiinteää alareunassa, joten se oli
        // pelkkää tyhjää vieritystä sivun lopussa.
        padding: m
          ? `${T.space.lg}px ${T.space.md}px calc(${T.space.xl}px + env(safe-area-inset-bottom))`
          : `${T.space.xl}px ${T.space.xxl - 2}px ${T.space.xl}px`,
      }}
    >
      {/* YKSI pystyrytmi: kaikki lohkot ovat saman flex-pinon lapsia ja
          väli tulee yhdestä `gap`ista. Aiemmin ylälohkot käyttivät omia
          `marginBottom`-arvojaan (14/20/22 px) ja alaosa erillistä gapia —
          viisi mekanismia samalle välille. */}
      <div style={{
        maxWidth: 1400, margin: "0 auto", width: "100%", boxSizing: "border-box",
        display: "flex", flexDirection: "column", gap: m ? T.space.md : T.space.lg,
      }}>

        {/* Header */}
        <div style={{ display: "flex", flexDirection: m ? "column" : "row", alignItems: m ? "center" : "flex-end", justifyContent: "space-between", gap: m ? T.space.xs + 2 : T.space.md, textAlign: m ? "center" : "left" }}>
          <div>
            <div style={{ ...mono, marginBottom: T.space.sm - 1 }}>KOKONAISTILANNE</div>
            <h1 style={{ margin: 0, fontFamily: T.font, fontSize: m ? T.size.title + 3 : T.size.display, fontWeight: 700, letterSpacing: "-0.01em" }}>Projektin yleiskatsaus</h1>
          </div>
          <div style={{ ...mono, textAlign: "right", flexShrink: 0 }}>
            {deal
              ? <>{FLOORS.length} KERROSTA · {heroTotal > 0 ? heroTotal : "…"} SOVITTUA IKKUNAA{scopeHasYellow ? ` (${billGrp?.total ?? 0} + ${p2b.lockedCount} KELT.)` : ""}</>
              : <>{FLOORS.length} KERROSTA · {total > 0 ? total : "…"} IKKUNAA</>}
          </div>
        </div>

        {/* Row 1: ring + revenue */}
        <div style={{ display: "grid", gridTemplateColumns: m ? "1fr" : "minmax(0, 1.35fr) minmax(0, 1fr)", gap: T.space.md + 2 }}>
          <div className="anim-fadeUp-0" style={{ ...card, minWidth: 0, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: m ? T.space.lg + 4 : T.space.xl, alignItems: "center", padding: m ? T.space.xl - 4 : T.space.xl + 4 }}>
            <div style={{ position: "relative", width: "184px", height: "184px", flexShrink: 0 }}>
              <svg width="184" height="184" viewBox="0 0 184 184" style={{ transform: "rotate(-90deg)" }}>
                <circle cx="92" cy="92" r="80" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="11" />
                <circle cx="92" cy="92" r="80" fill="none" stroke="#ffffff" strokeWidth="11" strokeLinecap="round"
                  strokeDasharray={`${((heroPct / 100) * CIRC).toFixed(1)} ${CIRC.toFixed(1)}`}
                  style={{ transition: "stroke-dasharray .7s cubic-bezier(.2,.8,.2,1)" }} />
              </svg>
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                <div style={{ fontFamily: T.font, fontSize: T.size.hero, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1 }}>{heroPctStr}</div>
                <div style={{ ...mono, marginTop: T.space.xs - 1 }}>VALMIS</div>
              </div>
            </div>
            <div style={{ flex: "1 1 230px", minWidth: 0, textAlign: m ? "center" : "left" }}>
              <div style={{ ...mono, marginBottom: T.space.sm + 2 }}>
                {deal ? (scopeHasYellow ? "SOVITTU TYÖ · PUNAISET + KELTAISET" : "SOPIMUSIKKUNAT (PUNAISET)") : "KOKONAISEDISTYMINEN"}
              </div>
              <div style={{ fontFamily: T.font, fontSize: T.size.display + 6, fontWeight: 700, letterSpacing: "-0.01em", marginBottom: 2 }}>
                {heroWashed} <span style={{ color: T.text.faint, fontWeight: 500 }}>/ {heroTotal}</span>
              </div>
              <div style={{ fontFamily: T.font, fontSize: T.size.sm, color: T.text.muted, marginBottom: scopeHasYellow ? T.space.sm + 2 : T.space.lg + 4 }}>
                {deal ? (scopeHasYellow ? "sovittua ikkunaa pesty" : "punaista ikkunaa pesty") : "ikkunaa pesty"}
              </div>
              {/* Erittely: kun keltaiset ovat mukana piirissä, kokonaisprosentti ei
                  enää kerro yksin missä mennään — punaiset voivat olla valmiit
                  vaikka keltaisia on kesken. Näytetään molemmat rinnakkain. */}
              {deal && scopeHasYellow && billGrp && (
                <div style={{ display: "flex", gap: T.space.md + 2, flexWrap: "wrap", justifyContent: m ? "center" : "flex-start", marginBottom: T.space.lg + 2 }}>
                  {([
                    ["Punaiset", "rgb(255,72,72)", billGrp.washed, billGrp.total],
                    ["Keltaiset (sovitut)", T.tone.warn, p2b.lockedWashedCount, p2b.lockedCount],
                  ] as [string, string, number, number][]).map(([label, color, w, t]) => (
                    <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: T.space.sm - 1, fontFamily: T.font, fontSize: T.size.sm, color: T.text.secondary }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, boxShadow: `0 0 7px ${color}`, flexShrink: 0 }} />
                      {label} <b style={{ color: T.text.primary, fontWeight: 700 }}>{w}/{t}</b>
                      <span style={{ color: T.text.faint }}>{t > 0 ? Math.round((w / t) * 100) : 0} %</span>
                    </span>
                  ))}
                </div>
              )}
              {/* PESTY MUTTA HYVÄKSYMÄTÖN EI SAA OLLA NÄKYMÄTÖN.
                  Hero laskee sovittua työtä = punaiset + LUKITUT keltaiset.
                  Pesty keltainen jonka hintaa asiakas ei ole vielä hyväksynyt
                  ei ole kummassakaan — ei osoittajassa eikä nimittäjässä.
                  Työ on siis tehty mutta se puuttuu ruudulta kokonaan, ja
                  juuri siitä syntyy tunne että luvut heittävät. Se ei kuulu
                  sovittuun piiriin ennen hyväksyntää, joten se ei mene heroon
                  — mutta se sanotaan tässä ääneen. */}
              {p2b.washedTotal > p2b.lockedWashedCount && (
                <div style={{
                  display: "inline-flex", alignItems: "center", gap: T.space.sm,
                  padding: `${T.space.xs + 2}px ${T.space.md}px`, borderRadius: T.radius.sm,
                  background: T.tone.infoBg, border: `1px solid ${T.tone.infoBorder}`,
                  fontFamily: T.font, fontSize: T.size.sm, color: T.tone.info,
                  marginBottom: T.space.lg,
                }}>
                  + {p2b.washedTotal - p2b.lockedWashedCount} pestyä keltaista odottaa asiakkaan hyväksyntää
                </div>
              )}
              {!attributionCheck.matches && (
                <div style={{
                  marginBottom: T.space.lg, padding: `${T.space.sm + 1}px ${T.space.md}px`,
                  borderRadius: T.radius.sm, background: T.tone.warnBg, border: `1px solid ${T.tone.warnBorder}`,
                  fontFamily: T.font, fontSize: T.size.xs, color: "rgba(255,206,80,0.95)",
                  textAlign: "left", lineHeight: 1.45,
                }}>
                  Ikkunamäärä ei täsmää: {attributionCheck.dotCount} pestyä vs. {attributionCheck.attributedSum} attribuoitua
                  {" "}(ero {attributionCheck.diff > 0 ? "+" : ""}{attributionCheck.diff}) — pesijä puuttuu.
                </div>
              )}
              <div style={{ display: "flex", gap: T.space.sm + 2 }}>
                {([["kesken", "rgb(188,150,255)", "rgba(188,150,255,0.7)", heroKesken], ["Pesemättä", T.text.faint, undefined, heroUnwashed]] as [string, string, string|undefined, number][]).map(([label, bg, shadow, val]) => (
                  <div key={label} style={{ ...inset, flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: m ? "center" : "flex-start", gap: T.space.sm - 1, marginBottom: T.space.xs + 1 }}>
                      <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: bg, boxShadow: shadow ? `0 0 7px ${shadow}` : undefined, flexShrink: 0 }} />
                      <span style={{ fontFamily: T.font, fontSize: T.size.xs, color: T.text.muted }}>{label === "kesken" ? "Kesken" : label}</span>
                    </div>
                    <div style={{ fontFamily: T.font, fontSize: T.size.title, fontWeight: 700 }}>{val}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Money card — the accumulated internal margin. PUNAISET lasketaan
              sisäisellä katteella (pesty punainen × kate/ikkuna) ja KELTAISET
              omalla P2-katteellaan (computeP2Billing.marginCents) — keltaista
              ikkunaa ei saa koskaan arvottaa punaisten taksalla. */}
          <div className="anim-fadeUp-1" style={{ ...card, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: T.space.sm + 2, padding: m ? `${T.space.xl}px ${T.space.xl - 2}px` : T.space.xl + 4, background: "linear-gradient(155deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))" }}>
            <div style={mono}>{deal ? "KERTYNYT · VAIN PERUSTAJILLE" : "LIIKEVAIHTO"}</div>
            <div style={{ fontFamily: T.font, fontSize: `clamp(${T.size.display}px, 5.5vw, ${T.size.hero}px)`, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.05 }}>
              {euro(deal ? (billGrp ? billGrp.washed : 0) * internalPerWindowEur + p2b.marginCents / 100 : washed * PRICE)}
            </div>
            {deal && p2b.marginCents > 0 && (
              <div style={{ ...subLabel, marginTop: 0 }}>
                punaiset {euro((billGrp ? billGrp.washed : 0) * internalPerWindowEur)} · keltaisten kate {euro(p2b.marginCents / 100)}
              </div>
            )}
          </div>
        </div>

        {/* LASKUTUS & MAKSUT — rahan tilannekuva heti heron alla, koska tämä on se
            mitä perustaja tulee dashiin katsomaan. Pelkkiä lukuja: laskun lähetys
            tapahtuu keikkanäkymässä ja tekijöille maksetaan Maksut-välilehdellä,
            joten samaa toimintoa ei ole kahdessa paikassa. */}
        {deal && gigBilling && (
          <div className="anim-fadeUp-2" style={{ ...card, padding: m ? T.space.lg : T.space.xl - 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: T.space.sm + 2, marginBottom: T.space.md, flexWrap: "wrap" }}>
              <span style={mono}>LASKUTUS &amp; MAKSUT</span>
              {onGoToMaksut && (
                <button
                  type="button"
                  onClick={onGoToMaksut}
                  style={{ ...tokenButton(), marginLeft: "auto" }}
                >
                  Avaa Maksut →
                </button>
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(148px, 1fr))", gap: m ? T.space.sm : T.space.md }}>
              {([
                {
                  label: "Laskutettu",
                  val: euro(gigBilling.p1InvoicedCents / 100),
                  sub: `${Math.min(4, gigBilling.p1PayCount)}/4 erää · ${euro(gigBilling.agreedTotalCents / 100)}`,
                  tone: T.tone.goodSoft,
                },
                {
                  label: "Laskuttamatta",
                  val: euro(Math.max(0, gigBilling.agreedTotalCents - gigBilling.p1InvoicedCents) / 100),
                  sub: gigBilling.p1PayCount >= 4 ? "kaikki erät lähetetty ✓" : `seuraava ${euro(gigBilling.nextInstalmentCents / 100)}`,
                  tone: T.text.primary,
                },
                {
                  label: "Keltaiset",
                  val: euro(gigBilling.p2InvoicedCents / 100),
                  sub: gigBilling.p2RemainingCents > 0
                    ? `laskuttamatta ${euro(gigBilling.p2RemainingCents / 100)}`
                    : p2b.lockedCount > 0 ? "ei laskuttamatonta" : "ei sovittuja vielä",
                  tone: gigBilling.p2RemainingCents > 0 ? T.tone.warn : T.text.primary,
                },
                {
                  label: "Tekijöille",
                  val: euro((workerOpenP1Cents ?? 0) / 100),
                  sub: (workerOpenP1Cents ?? 0) > 0 ? "punaisista siirrettävä" : "kaikki maksettu ✓",
                  tone: (workerOpenP1Cents ?? 0) > 0 ? T.tone.warn : T.text.primary,
                },
              ]).map((t) => (
                <div key={t.label} style={inset}>
                  <div style={statLabel}>{t.label}</div>
                  <div style={{ fontFamily: T.font, fontSize: m ? T.size.lg : T.size.title, fontWeight: 700, color: t.tone }}>{t.val}</div>
                  <div style={subLabel}>{t.sub}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* KÄYNNISSÄ NYT — live shift strip, pinned under the hero ONLY while someone
            is on the clock (otherwise the top stays minimal). */}
        {runningShifts.length > 0 && (
          <div className="anim-fadeUp-1" style={{ ...card, padding: `${T.space.md}px ${T.space.lg + 2}px`, display: "flex", alignItems: "center", gap: m ? T.space.sm : T.space.md, flexWrap: "wrap" }}>
            <span style={{ ...mono, display: "inline-flex", alignItems: "center", gap: T.space.sm, color: T.text.muted }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#5fe08a", boxShadow: "0 0 8px rgba(95,224,138,0.9)", animation: "fr8-zonePulse 1.8s ease-in-out infinite" }} />
              KÄYNNISSÄ NYT
            </span>
            {runningShifts.map((s) => (
              <span key={s.id} style={{ display: "inline-flex", alignItems: "center", gap: T.space.sm, padding: `${T.space.xs + 1}px ${T.space.md - 1}px`, borderRadius: T.radius.pill, background: T.tone.goodBg, border: `1px solid ${T.tone.goodBorder}` }}>
                <span style={{ fontFamily: T.font, fontSize: T.size.sm, fontWeight: 600 }}>{s.name}</span>
                <span style={{ fontFamily: T.mono, fontSize: T.size.xs, color: T.tone.goodSoft }}>{fmtDur(now - s.since)}</span>
              </span>
            ))}
          </div>
        )}

        {/* Collapsible "dropdown bar" sections — everything below the hero folds
            away, each bar keeping its headline figure visible while closed. */}
        <div style={{ display: "flex", flexDirection: "column", gap: m ? T.space.md : T.space.md + 2 }}>

        {/* Perustajien ansiot — bosses' earnings: own washed windows at the full
            contract rate + the profit share earned on every worker's window. Gives
            the founders a clear, fair "how much have we made" view. Founders only. */}
        {deal && founderEarnings && founderEarnings.length > 0 && (
            <Section
              id="founders"
              label="PERUSTAJIEN ANSIOT · VAIN PERUSTAJILLE"
              summary={foundersTheoreticalCents > foundersTotalCents
                ? `${euro(foundersTotalCents / 100)} · teor. ${euro(foundersTheoreticalCents / 100)}`
                : euro(foundersTotalCents / 100)}
              animClass="anim-fadeUp-1"
            >

              {/* Gig money split: contract value → workers' labour vs founders' share. */}
              {/* Kolme lukua mahtuu työpöydällä rinnakkain; puhelimessa kaksi + yksi,
                  ettei 19px euro murru kolmeen riviin kapealla näytöllä. */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: m ? T.space.sm : T.space.md, marginBottom: T.space.lg }}>
                {[
                  { label: "Sopimushinta", val: euro(capEur), tone: T.text.primary },
                  { label: "Työntekijöille", val: euro(laborCents / 100), tone: T.text.secondary },
                  { label: "Perustajille yht.", val: euro(foundersRedCents / 100), tone: T.tone.goodSoft },
                ].map((b) => (
                  <div key={b.label} style={inset}>
                    <div style={statLabel}>{b.label}</div>
                    <div style={{ fontFamily: T.font, fontSize: m ? T.size.lg : T.size.title, fontWeight: 700, color: b.tone }}>{b.val}</div>
                  </div>
                ))}
              </div>

              {/* Per-founder breakdown: own work + profit share = total. */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: m ? T.space.sm + 2 : T.space.md }}>
                {founderEarnings.map((f) => {
                  return (
                  <div key={f.id} style={{ ...inset, padding: T.space.lg + 2 }}>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: T.space.sm, marginBottom: T.space.sm }}>
                      <span style={{ fontFamily: T.font, fontSize: T.size.body, fontWeight: 700 }}>{f.name}</span>
                      <span style={mono}>PERUSTAJA</span>
                    </div>
                    <div style={{ fontFamily: T.font, fontSize: T.size.display, fontWeight: 700, lineHeight: 1, marginBottom: T.space.sm + 2 }}>{euro(f.totalCents / 100)}</div>
                    {f.manual ? (
                      <div style={{ fontFamily: T.font, fontSize: T.size.sm, color: T.tone.goodSoft }}>Käsin asetettu ansio</div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: T.space.xs + 1, fontFamily: T.font, fontSize: T.size.sm, color: T.text.muted }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <span>Oma työ · {f.ownWashed.toLocaleString("fi-FI", { maximumFractionDigits: 1 })} ikkunaa</span>
                          <b style={{ color: T.text.secondary, fontWeight: 700 }}>{euro(f.ownCents / 100)}</b>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <span>Tuotto-osuus työntekijöistä</span>
                          <b style={{ color: T.text.secondary, fontWeight: 700 }}>{euro(f.shareCents / 100)}</b>
                        </div>
                        {/* Keltaiset (2. vaihe) ovat oma palkkionsa palkkiotaulukosta,
                            eivät osa punaisten sisäistä katetta — siksi oma rivi. */}
                        {!!f.p2Cents && (
                          <div style={{ display: "flex", justifyContent: "space-between", gap: T.space.sm, color: T.tone.warn }}>
                            <span>Keltaiset · {(f.p2Washed ?? 0).toLocaleString("fi-FI", { maximumFractionDigits: 1 })} ikkunaa</span>
                            <b style={{ fontWeight: 600 }}>{euro(f.p2Cents / 100)}</b>
                          </div>
                        )}
                        {/* Osuus keltaisten katteesta. Tämä puuttui aiemmin kortilta
                            kokonaan, joten kortti näytti vähemmän kuin ylälaidan
                            KERTYNYT-luku. */}
                        {!!f.p2MarginCents && (
                          <div style={{ display: "flex", justifyContent: "space-between", gap: T.space.sm, color: T.tone.warn }}>
                            <span>Osuus keltaisten katteesta</span>
                            <b style={{ fontWeight: 600 }}>{euro(f.p2MarginCents / 100)}</b>
                          </div>
                        )}
                      </div>
                    )}
                    {/* TEOREETTINEN TUOTTO — vahvistettu + jo tehty työ jonka hintaa
                        asiakas ei ole vielä hyväksynyt. Erillään, koska tämä ei ole
                        vielä varmaa rahaa; mutta työ on tehty, joten se kuuluu
                        näkyviin eikä pelkkä vahvistettu luku kerro koko kuvaa. */}
                    {!!f.theoreticalCents && (
                      <div style={{ marginTop: T.space.md, paddingTop: T.space.sm + 2, borderTop: `1px dashed ${T.tone.infoBorder}` }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: T.space.sm, fontFamily: T.font, fontSize: T.size.sm }}>
                          <span style={{ color: "rgba(190,205,255,0.9)" }}>Teoreettinen tuotto</span>
                          <b style={{ color: T.tone.info, fontWeight: 700, fontSize: T.size.body }}>{euro((f.totalCents + f.theoreticalCents) / 100)}</b>
                        </div>
                        <div style={subLabel}>
                          sis. {euro(f.theoreticalCents / 100)} hyväksymättömistä keltaisista
                        </div>
                      </div>
                    )}

                    {/* Vastuulla olevat harjoittelijat — koottuna piiloon, koska nämä
                        EIVÄT ole johtajan lukuja. Avaamalla näkee kenelle ja paljonko
                        hän tilittää. */}
                    {(f.trainees?.length ?? 0) > 0 && (() => {
                      const open = openTrainees === f.id;
                      const t = f.trainees!;
                      const owed = t.reduce((sum, x) => sum + Math.max(0, x.cents - x.paidCents), 0);
                      return (
                        <div style={{ marginTop: T.space.sm + 2, paddingTop: T.space.sm + 2, borderTop: T.border.divider }}>
                          <button
                            onClick={() => setOpenTrainees(open ? null : f.id)}
                            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: T.space.sm, width: "100%", padding: 0, background: "transparent", border: "none", color: "rgba(156,193,255,0.95)", fontFamily: T.font, fontSize: T.size.xs, fontWeight: 600, cursor: "pointer", textAlign: "left" }}
                          >
                            <span>Vastuullasi {t.length} harjoittelija{t.length === 1 ? "" : "a"}{owed > 0 ? ` · tilitä ${euro(owed / 100)}` : " · tilitetty ✓"}</span>
                            <span aria-hidden>{open ? "▲" : "▾"}</span>
                          </button>
                          {open && (
                            <div style={{ display: "flex", flexDirection: "column", gap: T.space.xs + 1, marginTop: T.space.sm }}>
                              {t.map((x) => (
                                <div key={x.id} style={{ display: "flex", justifyContent: "space-between", gap: T.space.sm, fontFamily: T.font, fontSize: T.size.xs, color: T.text.secondary }}>
                                  <span>{x.name} · {x.washed.toLocaleString("fi-FI", { maximumFractionDigits: 1 })} ikkunaa</span>
                                  <span style={{ textAlign: "right" }}>
                                    <b style={{ color: T.text.secondary, fontWeight: 700 }}>{euro(x.cents / 100)}</b>
                                    {x.paidCents > 0 && <span style={{ color: T.tone.goodSoft, marginLeft: T.space.xs + 2 }}>maksettu {euro(x.paidCents / 100)}</span>}
                                  </span>
                                </div>
                              ))}
                              <span style={{ ...subLabel, marginTop: T.space.xs }}>Kirjaa maksu Tiimi-sivulla.</span>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* Johtaja-välinen erälasku (kohta 3C.1) — vain toisen johtajan kortilla. */}
                    {(() => {
                      const slot = founderInvoiceSlot?.(f.id);
                      return slot ? <div style={{ marginTop: T.space.md }}>{slot}</div> : null;
                    })()}
                  </div>
                  );
                })}
              </div>
              {/* Keltaiset (2. vaihe) ovat oma rahansa: ne EIVÄT kuulu yllä olevaan
                  punaisten sopimushinnan jakoon, joten ne eritellään omalle riville. */}
              {p2On && (p2b.earnedCents > 0 || (workerLaborP2Cents ?? 0) > 0 || foundersP2Cents > 0) && (
                <div style={{ ...inset, marginTop: T.space.md + 2, background: T.tone.warnBg, border: `1px solid ${T.tone.warnBorder}` }}>
                  <div style={{ ...statLabel, color: "rgba(255,220,140,0.8)" }}>
                    Keltaiset · 2. vaihe (ei sopimushinnassa)
                  </div>
                  {/* Ruudukko, ei rivittyvä inline-jono: neljä label/value-paria
                      katkesi ennen puhelimessa satunnaisista kohdista ja arvot
                      päätyivät eri sarakkeisiin joka rivillä. */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: `${T.space.xs}px ${T.space.lg}px`, fontFamily: T.font, fontSize: T.size.xs, color: T.text.muted }}>
                    {([
                      ["Kertymä (pesty)", euro(p2b.earnedCents / 100)],
                      ["Työntekijöille", euro((workerLaborP2Cents ?? 0) / 100)],
                      ["Perustajille", euro(foundersP2Cents / 100)],
                      ["Kate", euro(p2b.marginCents / 100)],
                    ] as [string, string][]).map(([lbl, val]) => (
                      <span key={lbl}>
                        {lbl}: <b style={{ color: T.text.primary, fontWeight: 700 }}>{val}</b>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {/* Ennen tässä oli ~250 merkkiä 11 px harmaata kaavatekstiä, joka
                  puhelimessa oli seitsemän rivin muuri tärkeimmän kortin lopussa.
                  Luku jonka perustaja oikeasti lukee on €/ikkuna; johtaminen
                  kuuluu selitteeseen, ei näkymään. */}
              <p style={{ ...subLabel, marginTop: T.space.md }} title="Sisäinen kate = efektiivinen sopimussumma ÷ punaiset ikkunat. Lisäksi osuus katteesta jokaisesta työntekijän punaisesta ikkunasta. Keltaiset maksetaan palkkiotaulukon mukaan erikseen.">
                Sisäinen kate <b style={{ color: T.text.secondary, fontWeight: 700 }}>{euroUnit(founderRateEur ?? PRICE)}</b> / punainen ikkuna
              </p>
            </Section>
        )}

        {/* Row 2: P1 + P2 + mini cards */}
        <Section
          id="priority"
          label="PRIORITEETIT & TAHTI"
          summary={scopeHasYellow
            ? `P1 ${p1.pctStr} · P2 ${p2b.lockedCount > 0 ? Math.round((p2b.lockedWashedCount / p2b.lockedCount) * 100) : 0} % · tänään ${todayAllWindows}`
            : `P1 ${p1.pctStr} · tänään ${todayAllWindows}`}
          animClass="anim-fadeUp-3"
          defaultOpen
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: m ? T.space.sm + 2 : T.space.lg }}>
          {[{ label: "Prioriteetti 1", rgb: "255,72,72", data: p1, p: 1 }, { label: "Prioriteetti 2", rgb: "255,205,40", data: p2, p: 2 }].map((g, gi) => {
            // Punaiset kuuluvat kiinteään urakkaan. Keltaiset EIVÄT kuulu siihen —
            // mutta kun 2. vaihe on avattu, ne laskutetaan ikkunakohtaisesti sovitulla
            // hinnalla. Aiemmin tämä kortti sanoi keltaisista "— ei laskuteta" myös
            // silloin kun niistä oli jo sovittu tuhansia euroja; nyt keltaisen kortin
            // luvut tulevat P2-moottorista (sovitut/pestyt/kertymä).
            const isYellowPriced = g.p === 2 && p2On;
            const outOfDeal = !!deal && g.p !== deal.billablePriority && !isYellowPriced;
            return (
            <div key={g.label} className={`anim-fadeUp-${gi + 2}`} style={{ ...card, padding: T.space.xl - 2, opacity: outOfDeal ? 0.72 : 1, minWidth: 0 }}>
              <div style={{ marginBottom: T.space.lg }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: T.space.sm }}>
                  <div style={{ display: "flex", alignItems: "center", gap: T.space.sm + 1, minWidth: 0 }}>
                    <span style={{ width: 11, height: 11, borderRadius: "50%", flexShrink: 0, background: `rgb(${g.rgb})`, boxShadow: `0 0 10px rgba(${g.rgb},0.8)` }} />
                    <span style={{ fontFamily: T.font, fontSize: T.size.body, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.label}</span>
                  </div>
                  <span style={{ ...mono, flexShrink: 0 }}>
                    {isYellowPriced
                      ? `${p2b.lockedCount > 0 ? Math.round((p2b.lockedWashedCount / p2b.lockedCount) * 100) : 0} %`
                      : g.data.pctStr}
                  </span>
                </div>
                {(() => {
                  // Yksi merkkikapselin muoto, kolme sävyä — aiemmin nämä olivat
                  // kolme erillistä inline-objektia joissa vain väri erosi.
                  const pill = (color: string, bg: string, border: string, text: string) => (
                    <span style={{
                      display: "inline-block", marginTop: T.space.sm - 1,
                      fontFamily: T.font, fontSize: T.size.label, fontWeight: 700,
                      padding: `2px ${T.space.sm - 1}px`, borderRadius: T.radius.sm - 4,
                      color, background: bg, border: `1px solid ${border}`,
                    }}>{text}</span>
                  );
                  if (outOfDeal) return pill(T.text.muted, "transparent", "rgba(255,255,255,0.14)", "ei sopimuksessa");
                  if (isYellowPriced) return pill("rgb(255,220,110)", T.tone.warnBg, T.tone.warnBorder, "2. vaihe · ikkunakohtainen");
                  if (deal) return pill(T.tone.goodSoft, T.tone.goodBg, T.tone.goodBorder, "sopimus");
                  return null;
                })()}
              </div>
              {/* Keltaisen kortin luvut ovat SOVITUT (lukitut) ikkunat, ei kaikki
                  kartan keltaiset — hinnoittelemattomasta ei ole sovittu mitään,
                  joten se ei kuulu edistymisen nimittäjään. */}
              <div style={{ fontFamily: T.font, fontSize: T.size.display, fontWeight: 700, marginBottom: 2 }}>
                {isYellowPriced ? p2b.lockedWashedCount : g.data.washed}
                <span style={{ color: T.text.faint, fontWeight: 500, fontSize: T.size.title }}> / {isYellowPriced ? p2b.lockedCount : g.data.total}</span>
              </div>
              {isYellowPriced && (
                <div style={{ ...subLabel, marginTop: 0 }}>
                  sovittua pesty · {p2b.proposedCount} odottaa asiakasta
                </div>
              )}
              {(() => {
                const pct = isYellowPriced
                  ? (p2b.lockedCount > 0 ? (p2b.lockedWashedCount / p2b.lockedCount) * 100 : 0)
                  : g.data.pct;
                return (
                  <div style={{ height: 6, borderRadius: T.radius.xs, background: "rgba(255,255,255,0.08)", overflow: "hidden", margin: `${T.space.md + 2}px 0 ${T.space.md + 2}px` }}>
                    <div style={{ width: `${pct.toFixed(1)}%`, height: "100%", borderRadius: T.radius.xs, background: `rgb(${g.rgb})`, boxShadow: `0 0 10px rgba(${g.rgb},0.6)`, transition: "width .6s" }} />
                  </div>
                );
              })()}
              <div style={{ display: "flex", justifyContent: "space-between", gap: T.space.sm, fontFamily: T.font, fontSize: T.size.sm, color: T.text.muted }}>
                <span>Kesken <b style={{ color: T.text.primary, fontWeight: 700 }}>{g.data.kesken}</b></span>
                <span>{isYellowPriced ? euro(p2b.earnedCents / 100) : outOfDeal ? "— ei laskuteta" : g.data.revStr}</span>
              </div>
            </div>
            );
          })}

          <div style={{ display: "flex", flexDirection: m ? "row" : "column", gap: m ? T.space.sm + 2 : T.space.md, gridColumn: m ? "1 / -1" : undefined, minWidth: 0 }}>
            {[{
              label: "Tänään tehty",
              val: todayAllWindows,
              // Euro koskee sovittuja ikkunoita; jos päivässä oli myös
              // hyväksymättömiä keltaisia, se sanotaan ääneen eikä luku jää
              // näyttämään siltä että työtä tehtiin vähemmän kuin tehtiin.
              sub: todayAllWindows > todayWindows
                ? `ikkunaa · ${euro(todayWindows * PRICE)} sovittua · ${todayAllWindows - todayWindows} odottaa hyväksyntää`
                : `ikkunaa · ${euro(todayWindows * PRICE)}`,
              cls: "anim-fadeUp-4",
            }, { label: "Arvio jäljellä", val: remaining, sub: `ikkunaa · ${estStr}`, cls: "anim-fadeUp-5" }].map((mc) => (
              <div key={mc.label} className={mc.cls} style={{ ...card, flex: 1, padding: T.space.lg + 2, minWidth: 0 }}>
                <div style={{ ...mono, marginBottom: T.space.sm + 1 }}>{mc.label}</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: T.space.sm, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: T.font, fontSize: T.size.display, fontWeight: 700 }}>{mc.val}</span>
                  <span style={{ fontFamily: T.font, fontSize: T.size.sm, color: T.text.faint }}>{mc.sub}</span>
                </div>
              </div>
            ))}
          </div>
          </div>
        </Section>

        {/* Workers strip — per-worker window counts & €/h optimisation */}
        {allWorkers.length > 0 && (
          <Section id="workers" label="TEKIJÄT" summary={`${shownWorkers.length} tekijää`} animClass="anim-fadeUp-5" defaultOpen>
            {/* Controls: show-all-vs-active + reveal €/h teho */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: T.space.lg + 2, marginBottom: T.space.md, flexWrap: "wrap" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: T.space.sm + 2 }}>
                <span style={{ fontFamily: T.font, fontSize: T.size.sm, color: T.text.muted }}>Näytä teho (€/h)</span>
                <Toggle checked={showTeho} onChange={setShowTeho} ariaLabel="Näytä €/h ja tunnit" />
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: T.space.sm + 2 }}>
                <span style={{ fontFamily: T.font, fontSize: T.size.sm, color: T.text.muted }}>Vain aktiiviset</span>
                <Toggle checked={showActiveOnly} onChange={setShowActiveOnly} ariaLabel="Näytä vain aktiiviset tekijät" />
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${m ? 150 : 210}px, 1fr))`, gap: m ? T.space.sm + 2 : T.space.md }}>
              {shownWorkers.map((s) => {
                const share = washed > 0 ? (s.washed / washed) * 100 : 0;
                const rate = s.washed > 0 ? s.revenueCents / s.washed / 100 : 0; // €/ikkuna (personal pay)
                const shiftStart = shiftStartFor(s.worker);
                const cm = crewMemberOf(s.worker);
                const canEditPay = !!onSetEarnings && cm?.role === "host"; // founders adjust own split
                const overridden = cm?.manualEarningsCents != null;
                const editing = editId === s.worker;
                return (
                  <div key={s.worker} style={{ ...inset, padding: T.space.lg + 2, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: T.space.sm + 2, gap: T.space.sm }}>
                      <span style={{ display: "flex", alignItems: "center", gap: T.space.xs + 2, minWidth: 0 }}>
                        <span style={{ fontFamily: T.font, fontSize: T.size.body, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{workerName(s.worker)}</span>
                      </span>
                      <span style={{ ...mono, flexShrink: 0 }}>{Math.round(share)} %</span>
                    </div>
                    <div style={{ fontFamily: T.font, fontSize: T.size.display, fontWeight: 700, lineHeight: 1 }}>
                      {s.washed.toLocaleString("fi-FI", { maximumFractionDigits: 1 })} <span style={{ fontSize: T.size.sm, fontWeight: 500, color: T.text.faint }}>ikkunaa</span>
                    </div>
                    {shiftStart && (
                      <div style={{ display: "inline-flex", alignItems: "center", gap: T.space.xs + 2, marginTop: T.space.sm + 2, padding: `3px ${T.space.sm + 1}px`, borderRadius: T.radius.pill, background: T.tone.goodBg, border: `1px solid ${T.tone.goodBorder}` }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#5fe08a", boxShadow: "0 0 8px rgba(95,224,138,0.9)", animation: "fr8-zonePulse 1.8s ease-in-out infinite" }} />
                        <span style={{ fontFamily: T.font, fontSize: T.size.xs, fontWeight: 600, color: T.tone.goodSoft }}>Vuoro käynnissä · {fmtDur(now - shiftStart)}</span>
                      </div>
                    )}
                    <div style={{ height: 6, borderRadius: T.radius.xs, background: "rgba(255,255,255,0.08)", overflow: "hidden", margin: `${T.space.md}px 0` }}>
                      <div style={{ width: `${share.toFixed(1)}%`, height: "100%", borderRadius: T.radius.xs, background: "linear-gradient(90deg,rgba(255,255,255,0.5),#fff)", transition: "width .6s" }} />
                    </div>
                    {/* Stacked label/value rows so the euro, rate and €/h figures never
                        overlap each other when they wrap on a narrow card. */}
                    <div style={{ display: "flex", flexDirection: "column", gap: T.space.xs + 1, fontFamily: T.font, fontSize: T.size.sm, color: T.text.muted }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: T.space.sm + 2 }}>
                        <span>Ansio</span>
                        <span style={{ textAlign: "right" }}>
                          <b style={{ color: T.text.secondary, fontWeight: 700 }}>{euro(s.revenueCents / 100)}</b>
                          {overridden && <span style={{ marginLeft: T.space.xs + 2, color: T.tone.goodSoft, fontSize: T.size.xs }}>muokattu</span>}
                        </span>
                      </div>
                      {/* ANSION OSAT, EI KESKIARVOA. Punaiset maksavat tekijän
                          oman taksan, keltaiset palkkiotaulukon mukaan ja vasta
                          kun asiakas on hyväksynyt hinnan. Yksi jaettu luku
                          sekoitti nämä keskenään ja näytti siltä että sama
                          taksa maksaa eri verran eri ihmisille. */}
                      {cm?.role === "host" ? (
                        <div style={{ display: "flex", justifyContent: "space-between", gap: T.space.sm + 2 }}>
                          <span>Hinnoittelu</span>
                          <span style={{ textAlign: "right", color: T.text.faint }}>sis. tuotto-osuus</span>
                        </div>
                      ) : (
                        <>
                          {s.washedP1 > 0 && (
                            <div style={{ display: "flex", justifyContent: "space-between", gap: T.space.sm + 2 }}>
                              <span>Punaiset {s.washedP1.toLocaleString("fi-FI", { maximumFractionDigits: 1 })} × {euroUnit((s.rateCents ?? 0) / 100)}</span>
                              <span style={{ textAlign: "right", color: T.text.secondary }}>{euro(s.washedP1 * (s.rateCents ?? 0) / 100)}</span>
                            </div>
                          )}
                          {(s.washedP2 > 0 || (s.p2Cents ?? 0) > 0) && (
                            <div style={{ display: "flex", justifyContent: "space-between", gap: T.space.sm + 2 }}>
                              <span>Keltaiset {(s.washedP2 - (s.p2PendingCount ?? 0)).toLocaleString("fi-FI", { maximumFractionDigits: 1 })} sovittu</span>
                              <span style={{ textAlign: "right", color: T.text.secondary }}>{euro((s.p2Cents ?? 0) / 100)}</span>
                            </div>
                          )}
                          {(s.p2PendingCount ?? 0) > 0 && (
                            <div style={{ display: "flex", justifyContent: "space-between", gap: T.space.sm + 2, color: T.text.faint }}>
                              <span>Odottaa asiakasta {(s.p2PendingCount ?? 0).toLocaleString("fi-FI", { maximumFractionDigits: 1 })}</span>
                              <span style={{ textAlign: "right" }}>+{euro((s.p2PendingCents ?? 0) / 100)} myöhemmin</span>
                            </div>
                          )}
                        </>
                      )}
                      {showTeho && (
                        <div style={{ display: "flex", justifyContent: "space-between", gap: T.space.sm + 2 }}>
                          <span>Teho</span>
                          <span style={{ textAlign: "right", color: T.text.secondary }}>{s.hours > 0 ? `${euro(s.eurPerHour)} / h · ${s.hours.toLocaleString("fi-FI", { maximumFractionDigits: 1 })} h` : "0 h"}</span>
                        </div>
                      )}
                    </div>
                    {canEditPay && !editing && (
                      <button onClick={() => { setEditId(s.worker); setEditVal(overridden ? String(Math.round((cm!.manualEarningsCents! / 100))) : String(Math.round(s.revenueCents / 100))); }}
                        style={{ ...tokenButton(), marginTop: T.space.sm + 2, width: "100%" }}>
                        Muokkaa ansiota
                      </button>
                    )}
                    {canEditPay && editing && (
                      <div style={{ marginTop: T.space.sm + 2, display: "flex", gap: T.space.xs + 2, alignItems: "center", flexWrap: "wrap" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: T.space.xs + 2, flex: "1 1 100px", minWidth: 0 }}>
                          <input value={editVal} onChange={(e) => setEditVal(e.target.value)} inputMode="decimal" autoFocus
                            aria-label={`Ansio — ${workerName(s.worker)}`}
                            style={{ ...tokenInput, flex: 1, minWidth: 0, textAlign: "right" }} />
                          <span style={{ fontFamily: T.font, fontSize: T.size.sm, color: T.text.muted }}>€</span>
                        </span>
                        <button onClick={() => { const v = parseFloat(editVal.replace(",", ".")); onSetEarnings!(s.worker, Number.isFinite(v) ? Math.round(v * 100) : null); setEditId(null); }}
                          style={{ ...tokenButton("solid"), flex: "1 1 84px" }}>Tallenna</button>
                        {overridden && (
                          <button onClick={() => { onSetEarnings!(s.worker, null); setEditId(null); }} title="Palauta laskettu"
                            style={{ ...tokenButton(), background: "transparent", color: T.text.muted, flexShrink: 0 }}>↺</button>
                        )}
                      </div>
                    )}
                    {/* Per-worker session / day log (managers only) */}
                    {(cm?.sessions?.length ?? 0) > 0 && (
                      <>
                        <button onClick={() => setOpenSessions(openSessions === s.worker ? null : s.worker)}
                          style={{ ...tokenButton(), marginTop: T.space.sm + 2, width: "100%", border: "none", background: "transparent", fontFamily: T.mono, fontSize: T.size.label, letterSpacing: "0.12em", color: T.text.faint }}>
                          PÄIVÄKIRJA ({cm!.sessions!.length}) {openSessions === s.worker ? "▲" : "▾"}
                        </button>
                        {openSessions === s.worker && (
                          <div style={{ display: "flex", flexDirection: "column", gap: T.space.xs + 2, marginTop: T.space.xs + 2 }}>
                            {[...cm!.sessions!].reverse().slice(0, 10).map(( se, i) => (
                              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: T.space.sm, fontFamily: T.font, fontSize: T.size.xs, color: T.text.secondary, padding: `${T.space.xs + 1}px ${T.space.sm}px`, background: T.surface.inset, borderRadius: T.radius.sm }}>
                                <span>{new Date(se.end).toLocaleDateString("fi-FI", { day: "numeric", month: "numeric" })} · {se.windows} ikk · {fmtDur(se.minutes * 60000)}</span>
                                <span style={{ fontWeight: 700, color: T.text.secondary, flexShrink: 0 }}>{euro(se.earnedCents / 100)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {/* P2 — keltaisten ikkunoiden hinnoittelu & neuvottelu (lisätyö) */}
        {p2Slot && <div className="anim-fadeUp-6">{p2Slot}</div>}

        {/* Row 3: floor breakdown + activity log */}
        <Section id="floors" label="KERROKSITTAIN" summary={`${washed}/${total}`} animClass="anim-fadeUp-6">
            <div style={{ display: "flex", flexDirection: "column", gap: T.space.xs }}>
              {FLOORS.map((f) => {
                // KERROKSEN PALKKI LASKEE KAIKKI PISTEET.
                // Rajasin tämän kertaalleen punaisiin, koska luin pyynnön
                // väärinpäin. Kerroksen mittarin kuuluu vastata sitä mitä
                // kerroksessa on: jos siellä on pesemättömiä keltaisia, palkki
                // ei saa väittää sataa prosenttia. Punaisten oma tilanne
                // näkyy erikseen rivin alla.
                const onFloor = all.filter((a) => a.floor === f);
                const arr = onFloor;
                const w = arr.filter((a) => a.status === "pesty").length;
                const pc = arr.length > 0 ? (w / arr.length) * 100 : 0;
                const red = onFloor.filter((a) => a.p === 1);
                const redDoneOnFloor = red.filter((a) => a.status === "pesty").length;
                return (
                  <button key={f} className="floor-row-btn" onClick={() => onGoToFloor(f)}>
                    <span style={{ width: 34, height: 34, flexShrink: 0, borderRadius: T.radius.sm, background: T.surface.raised, border: T.border.normal, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: T.font, fontWeight: 700, fontSize: T.size.body }}>{f}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ height: 6, borderRadius: T.radius.xs, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                        <div style={{ width: `${pc.toFixed(1)}%`, height: "100%", borderRadius: T.radius.xs, background: "linear-gradient(90deg,rgba(255,255,255,0.5),#fff)", transition: "width .6s" }} />
                      </div>
                    </div>
                    <span style={{ fontFamily: T.mono, fontSize: T.size.sm, color: T.text.secondary, width: 74, textAlign: "right", flexShrink: 0 }}>
                      {w}/{arr.length}
                      {red.length > 0 && red.length !== arr.length && (
                        <span style={{ display: "block", fontSize: T.size.label, color: "rgba(255,120,120,0.75)" }}>
                          {redDoneOnFloor}/{red.length} sopimus
                        </span>
                      )}
                    </span>
                    <span style={{ fontFamily: T.mono, fontSize: T.size.sm, fontWeight: 700, width: 50, textAlign: "right", flexShrink: 0 }}>{Math.round(pc)} %</span>
                  </button>
                );
              })}
            </div>
          </Section>


          {activity.length > 0 && (
            <Section id="activity" label="VIIMEISIN TOIMINTA" summary={activity[0]?.time} animClass="anim-fadeUp-8">
                <div style={{ display: "flex", flexDirection: "column", gap: T.space.md }}>
                  {activity.map((a, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: T.space.md - 1 }}>
                      <span style={{ width: 10, height: 10, borderRadius: "50%", flexShrink: 0, background: a.color, boxShadow: `0 0 8px ${a.glow}` }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: T.font, fontSize: T.size.sm, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.title}</div>
                        <div style={{ fontFamily: T.font, fontSize: T.size.xs, color: T.text.faint }}>{a.sub}</div>
                      </div>
                      <span style={{ fontFamily: T.mono, fontSize: T.size.label, color: T.text.faint, flexShrink: 0 }}>{a.time}</span>
                    </div>
                  ))}
                </div>
            </Section>
          )}
          {settingsSlot && <div className="anim-fadeUp-8">{settingsSlot}</div>}
        </div>

        {/* Kulut — tucked away off the main view. A quiet link opens the expense
            form/list in a popup, for the rare time something needs logging. */}
        {expensesSlot && (
          <div style={{ display: "flex", justifyContent: "center", marginTop: T.space.sm }}>
            <button
              type="button"
              onClick={() => setShowExpenses(true)}
              style={{ ...tokenButton(), background: "transparent", color: T.text.faint }}
            >
              Kulut{expensesTotalCents ? ` · ${euro(expensesTotalCents / 100)}` : ""}
            </button>
          </div>
        )}
      </div>

      {/* Kulut popup */}
      {expensesSlot && showExpenses && (
        // data-fr8-bg: himmennys on mustaa 60 %. Ilman merkintää mobiilisääntö
        // vaihtoi sen 5,5 %:n valkoiseen, jolloin lomake leijui kirkkaan dashin
        // päällä eikä katse löytänyt kumpaakaan.
        <div
          data-fr8-bg
          onClick={() => setShowExpenses(false)}
          style={{ position: "fixed", inset: 0, zIndex: 80, display: "flex", alignItems: m ? "flex-end" : "center", justifyContent: "center", padding: m ? "0" : "24px", background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "100%", maxWidth: 640, maxHeight: m ? "88vh" : "86vh", overflowY: "auto", background: "#0c0c0e", border: T.border.normal, borderRadius: m ? `${T.radius.xl}px ${T.radius.xl}px 0 0` : T.radius.xl, padding: m ? `${T.space.lg + 2}px ${T.space.lg}px calc(${T.space.lg + 4}px + env(safe-area-inset-bottom))` : `${T.space.xl - 2}px ${T.space.xl - 2}px ${T.space.xl}px`, boxShadow: "0 24px 60px rgba(0,0,0,0.6)" }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: T.space.md, marginBottom: T.space.md + 2 }}>
              <span style={{ ...mono, color: T.text.muted }}>KULUT{expensesTotalCents ? ` · ${euro(expensesTotalCents / 100)}` : ""}</span>
              <button
                type="button"
                onClick={() => setShowExpenses(false)}
                aria-label="Sulje"
                style={{ ...tokenButton(), width: 40, height: 40, padding: 0, fontSize: T.size.lg, lineHeight: 1, flexShrink: 0 }}
              >×</button>
            </div>
            {expensesSlot}
          </div>
        </div>
      )}
    </div>
  );
}
