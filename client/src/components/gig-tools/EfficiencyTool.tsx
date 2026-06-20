/**
 * Gig tool — "Tehokkuus & tahti" (efficiency & pace).
 *
 * Read-only analytics derived from the project's window data and activity log:
 * completion, pace (windows/day), today & 7-day throughput, an ETA to finish,
 * projected final revenue and a €/h leaderboard. Complements the projektinäkymä
 * dashboard (which shows current state) by focusing on rate and projection.
 */
import { computeEfficiency, computeWorkerStats, fixedDealFor, computeDealBilling, type ProjectData } from "@shared/project";
import { useIsMobile } from "@/hooks/use-mobile";

interface Props {
  project: ProjectData;
  workerName: (id: string) => string;
}

function fmt(n: number) { return Math.round(n).toLocaleString("fi-FI"); }
function fmt1(n: number) { return (Math.round(n * 10) / 10).toLocaleString("fi-FI"); }
function euro(cents: number) { return fmt(cents / 100) + " €"; }

/** Add N working days (Mon–Fri) to today and return the target date. */
function addWorkingDays(days: number): Date {
  const d = new Date();
  let left = days;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) left -= 1;
  }
  return d;
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

export default function EfficiencyTool({ project, workerName }: Props) {
  const m = useIsMobile();
  const e = computeEfficiency(project);
  // A signed fixed-price deal (FR8) caps the contract value and bills only the
  // billable priority (red); otherwise the value is the open gig's contract.
  const deal = fixedDealFor(project);
  const billing = deal ? computeDealBilling(project, deal) : null;
  const accruedCents = billing ? billing.accruedCents : e.revenueCents;
  const contractCents = billing ? billing.capCents : e.contractCents;
  const remainingValueCents = billing ? Math.max(0, billing.capCents - billing.accruedCents) : e.remainingCents;
  const moneyPct = billing ? billing.pct : e.pct;
  const stats = computeWorkerStats(project)
    .filter((s) => s.washed > 0 || s.hours > 0)
    .sort((a, b) => b.eurPerHour - a.eurPerHour || b.washed - a.washed);

  const etaLabel =
    e.etaWorkingDays === 0 ? "Valmis" :
    e.etaWorkingDays == null ? "—" :
    `~${e.etaWorkingDays} työpäivää`;
  const etaDate = e.etaWorkingDays && e.etaWorkingDays > 0
    ? addWorkingDays(e.etaWorkingDays).toLocaleDateString("fi-FI", { day: "numeric", month: "numeric" })
    : null;

  const headline = [
    { label: "EDISTYMINEN", val: `${Math.round(e.pct)} %`, sub: `${e.washed} / ${e.total} ikkunaa` },
    { label: "TAHTI", val: e.perDay > 0 ? fmt1(e.perDay) : "—", sub: e.perDay > 0 ? "ikkunaa / työpäivä" : "ei dataa vielä" },
    { label: "ARVIO VALMIS", val: etaLabel, sub: etaDate ? `tavoite ~${etaDate}` : "nykytahdilla" },
    { label: "€ / TUNTI", val: e.eurPerHour > 0 ? euro(Math.round(e.eurPerHour * 100)) : "—", sub: e.totalHours > 0 ? `${fmt1(e.totalHours)} h tehty` : "kirjaa tunteja" },
  ];

  const throughput = [
    { label: "TÄNÄÄN", val: e.todayWashed, sub: `ikkunaa · ${euro(e.todayWashed * project.pricePerWindow * 100)}` },
    { label: "7 PÄIVÄÄ", val: e.weekWashed, sub: `ikkunaa · ${euro(e.weekWashed * project.pricePerWindow * 100)}` },
    { label: "JÄLJELLÄ", val: e.remaining, sub: `ikkunaa · ${euro(remainingValueCents)}` },
    { label: "PARAS PÄIVÄ", val: e.bestDay?.count ?? 0, sub: e.bestDay ? new Date(e.bestDay.ts).toLocaleDateString("fi-FI", { day: "numeric", month: "numeric" }) : "—" },
  ];

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: m ? "18px 12px 40px" : "26px 30px 44px" }}>
      <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: m ? "16px" : "22px" }}>
          <div style={{ ...mono, letterSpacing: "0.18em", marginBottom: "7px" }}>TEHOKKUUS &amp; TAHTI</div>
          <h1 style={{ margin: 0, fontSize: m ? "22px" : "30px", fontWeight: 700, letterSpacing: "-0.01em" }}>Edistymistahti ja arvio</h1>
        </div>

        {/* Headline metrics */}
        <div className="anim-fadeUp-0" style={{ display: "grid", gridTemplateColumns: m ? "1fr 1fr" : "repeat(4, 1fr)", gap: m ? "10px" : "14px", marginBottom: m ? "12px" : "16px" }}>
          {headline.map((c) => (
            <div key={c.label} style={{ ...card, padding: m ? "16px" : "20px 22px" }}>
              <div style={{ ...mono, fontSize: "9.5px", letterSpacing: "0.12em", marginBottom: "10px" }}>{c.label}</div>
              <div style={{ fontSize: m ? "23px" : "28px", fontWeight: 700, lineHeight: 1, letterSpacing: "-0.01em" }}>{c.val}</div>
              <div style={{ fontSize: "11.5px", color: "rgba(255,255,255,0.45)", marginTop: "6px" }}>{c.sub}</div>
            </div>
          ))}
        </div>

        {/* Progress bar + projected value */}
        <div className="anim-fadeUp-1" style={{ ...card, padding: m ? "20px" : "24px 28px", marginBottom: m ? "12px" : "16px" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "12px", flexWrap: "wrap", gap: "8px" }}>
            <div style={{ fontSize: m ? "30px" : "38px", fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1 }}>
              {euro(accruedCents)} <span style={{ fontSize: "15px", fontWeight: 500, color: "rgba(255,255,255,0.4)" }}>/ {euro(contractCents)}</span>
            </div>
            <div style={mono}>{deal ? `SOPIMUSKATTO · ${deal.pricePerWindow.toLocaleString("fi-FI", { minimumFractionDigits: 2 })} € / PUNAINEN` : `SOPIMUSARVO · ${project.pricePerWindow} € / IKKUNA`}</div>
          </div>
          <div style={{ height: "10px", borderRadius: "6px", background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
            <div style={{ width: `${moneyPct.toFixed(1)}%`, height: "100%", borderRadius: "6px", background: "linear-gradient(90deg,rgba(95,224,138,0.65),#5fe08a)", boxShadow: "0 0 12px rgba(95,224,138,0.5)", transition: "width .6s" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "9px", fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "10.5px", color: "rgba(255,255,255,0.45)" }}>
            <span>{e.washed} pesty · {e.kesken} kesken</span>
            <span>{euro(remainingValueCents)} kerättävää</span>
          </div>
        </div>

        {/* Throughput row */}
        <div className="anim-fadeUp-2" style={{ display: "grid", gridTemplateColumns: m ? "1fr 1fr" : "repeat(4, 1fr)", gap: m ? "10px" : "14px", marginBottom: m ? "12px" : "16px" }}>
          {throughput.map((c) => (
            <div key={c.label} style={{ ...card, padding: m ? "16px" : "18px 20px" }}>
              <div style={{ ...mono, fontSize: "9.5px", letterSpacing: "0.12em", marginBottom: "9px" }}>{c.label}</div>
              <div style={{ fontSize: m ? "22px" : "26px", fontWeight: 700, lineHeight: 1 }}>{c.val}</div>
              <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.42)", marginTop: "5px" }}>{c.sub}</div>
            </div>
          ))}
        </div>

        {/* Worker efficiency leaderboard */}
        <div className="anim-fadeUp-3" style={{ ...card, padding: m ? "18px" : "22px 24px" }}>
          <div style={{ ...mono, marginBottom: "16px" }}>TEKIJÄT · TUOTTAVUUS</div>
          {stats.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {stats.map((s, i) => (
                <div key={s.worker} style={{ display: "flex", alignItems: "center", gap: m ? "10px" : "14px", padding: m ? "11px 12px" : "13px 16px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "14px" }}>
                  <span style={{ width: "26px", height: "26px", flexShrink: 0, borderRadius: "8px", background: i === 0 ? "linear-gradient(140deg,#5fe08a,#2fae62)" : "rgba(255,255,255,0.06)", color: i === 0 ? "#06270f" : "rgba(255,255,255,0.65)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "12px" }}>{i + 1}</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: "15px", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{workerName(s.worker)}</span>
                  {!m && <span style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "12px", color: "rgba(255,255,255,0.5)", width: "96px", textAlign: "right" }}>{s.washed} ikkunaa</span>}
                  <span style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "12px", color: "rgba(255,255,255,0.5)", width: m ? "56px" : "72px", textAlign: "right" }}>{fmt1(s.hours)} h</span>
                  <span style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "13.5px", fontWeight: 700, width: m ? "70px" : "92px", textAlign: "right" }}>{s.eurPerHour > 0 ? euro(Math.round(s.eurPerHour * 100)) + "/h" : "—"}</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.35)", padding: "6px 0" }}>
              Ei vielä dataa. Merkitse ikkunoita pestyiksi ja kirjaa työtunteja projektinäkymässä — tahti ja €/h ilmestyvät tähän.
            </div>
          )}
        </div>

        <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", marginTop: "14px", textAlign: "center" }}>
          Tahti ja arvio perustuvat viimeisimpään toimintalokiin — suuntaa-antava.
        </p>
      </div>
    </div>
  );
}
