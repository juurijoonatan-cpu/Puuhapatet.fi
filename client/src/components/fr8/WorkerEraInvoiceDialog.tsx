/**
 * FR8 erälaskutus — johtajan "Maksu"-toiminto tekijöille (kohta 3A).
 *
 * Johtaja valitsee erät 1-3 tai erä 4 ja näkee jokaiselle tekijälle esitäytetyn
 * rivin. TÄRKEÄ: esitäyttö on **jäljellä oleva punainen ikkunamäärä**, ei
 * tekijän koko keikan pesty-määrä:
 *
 *   jäljellä = punaiset pestyt ikkunat − aiemmilla erälaskuilla jo katetut
 *
 * Aiemmin esitäyttö oli koko keikan `washed`, JOKA SISÄLSI KELTAISET (P2) ja
 * kaikki jo maksetut erät — eli erän 4 maksu olisi laskuttanut koko keikan
 * uudelleen ja vielä keltaiset punaisten 20 €/ikkuna taksalla. Laskenta tulee nyt
 * yhdestä paikasta: `computeWorkerSettlements` (shared/worker-payouts.ts).
 *
 * Keltaiset (P2) EI kuulu tähän maksuun lainkaan — ne laskutetaan asiakkaalta
 * erikseen (`scope:"p2"`) ja maksetaan vasta sen jälkeen. Keltainen palkkio
 * näytetään rivillä harmaana muistutuksena, ei koskaan summassa.
 */
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { computeEraBilling, P2_ERA_NUMBERS, type TekijaPesu } from "@shared/era-billing";
import type { WorkerSettlement } from "@shared/worker-payouts";
import { fmtEurCents } from "@shared/tax";
import { useIsMobile } from "@/hooks/use-mobile";
import { Wallet, Check, X, AlertTriangle } from "lucide-react";

/** Punaisten erät tai keltaisten (2. vaihe) potti. */
type EraChoice = "1-3" | "4" | "p2";

interface WorkerRowState {
  pestytIkkunat: string;
  sovittuMuutosCents: string;
  ennakkoCents: string;
}

/** Eräpäivän oletusehdotus: 14 vrk tästä hetkestä ("YYYY-MM-DD"). Johtaja voi
 *  aina vaihtaa tämän — ei enää kiinteä oletus laskun lähetyshetkellä. */
function defaultDueDate(): string {
  return new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

const fmtWin = (n: number) => n.toLocaleString("fi-FI", { maximumFractionDigits: 1 });

export default function WorkerEraInvoiceDialog({ workers, jobId, onSent, variant = "bar" }: {
  jobId: number;
  /** Tekijöiden maksutilanne — `computeWorkerSettlements`in tulos. */
  workers: WorkerSettlement[];
  onSent?: () => void;
  /** "bar" = leveä osiopalkki (tumma dash), "button" = tavallinen nappi. */
  variant?: "bar" | "button";
}) {
  const m = useIsMobile();
  const [open, setOpen] = useState(false);
  const [era, setEra] = useState<EraChoice>("1-3");
  const [rows, setRows] = useState<Record<string, WorkerRowState>>({});
  // Kenelle maksu koskee. Oletuksena esivalitaan tekijät joilla on vielä
  // maksamatonta punaista työtä — täsmälleen ne joille maksu pitää tehdä.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState(defaultDueDate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentCount, setSentCount] = useState<number | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);

  // Erien 1-3 maksu on jo tehty jollekin → oletuserä on 4. Näin johtaja ei
  // vahingossa laskuta erää 1-3 uudelleen viimeisen erän kohdalla.
  const totalOpenP1 = workers.reduce((t, w) => t + w.openP1Cents, 0);
  const totalOpenP2 = workers.reduce((t, w) => t + w.openP2Cents, 0);
  /** Ehdotus: punaiset ensin. Kun punaisista ei ole enää maksettavaa mutta
   *  keltaisista on, ehdotetaan keltaisia — järjestelmä siirtyy itse eteenpäin. */
  const suggestedEra: EraChoice = useMemo(() => {
    if (totalOpenP1 <= 0 && totalOpenP2 > 0) return "p2";
    return workers.some((w) => w.settledEras.includes(3) || w.settledEras.includes(1)) ? "4" : "1-3";
  }, [workers, totalOpenP1, totalOpenP2]);
  const isP2 = era === "p2";

  useEffect(() => {
    if (!open) return;
    setSentCount(null);
    setError(null);
    setSkipped([]);
    setDueDate(defaultDueDate());
    setEra(suggestedEra);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Esitäyttö AINA jäljellä olevasta työstä (ei koko keikasta) ja uudelleen kun
  // erävalinta vaihtuu — punaisilla ikkunamäärä, keltaisilla oma potti.
  useEffect(() => {
    if (!open) return;
    const p2 = era === "p2";
    setSelectedIds(workers.filter((w) => (p2 ? w.openP2Cents > 0 : w.openP1Windows > 0 || w.openP1Cents > 0)).map((w) => w.workerId));
    const next: Record<string, WorkerRowState> = {};
    for (const w of workers) {
      next[w.workerId] = {
        pestytIkkunat: p2
          ? (w.p2Washed > 0 ? String(w.p2Washed) : "")
          : (w.openP1Windows > 0 ? String(w.openP1Windows) : ""),
        // Tekijän kanssa sovittu vähennys esitäytetään laskun omalle "sovittu
        // muutos" -riville. Ilman tätä lasku olisi laskenut ikkunat × taksa eli
        // TÄYDEN summan, vaikka Maksut-välilehti näytti vähennetyn — ja velkaa
        // olisi jäänyt roikkumaan erotuksen verran. Näin vähennys näkyy myös
        // itse laskulla omana rivinään, kuten kuuluukin.
        sovittuMuutosCents: !p2 && w.p1AdjustmentCents ? String(w.p1AdjustmentCents / 100) : "",
        ennakkoCents: "",
      };
    }
    setRows(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, era]);

  const eraNumbers = isP2 ? P2_ERA_NUMBERS : era === "4" ? [4] : [1, 2, 3];
  const selectedWorkers = workers.filter((w) => selectedIds.includes(w.workerId));
  const toggleWorker = (id: string) => {
    setSelectedIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  };

  const parsedWorkers: TekijaPesu[] = selectedWorkers.map((w) => {
    const r = rows[w.workerId] || { pestytIkkunat: "", sovittuMuutosCents: "", ennakkoCents: "" };
    return {
      workerId: w.workerId,
      name: w.name,
      pestytIkkunat: Math.max(0, parseFloat(r.pestytIkkunat.replace(",", ".")) || 0),
      sovittuMuutosCents: Math.round((parseFloat(r.sovittuMuutosCents.replace(",", ".")) || 0) * 100),
      ennakkoCents: Math.round((parseFloat(r.ennakkoCents.replace(",", ".")) || 0) * 100),
      // Keltaisten palkkio tulee palkkiotaulukosta per ikkuna, ei 20 €/ikkuna —
      // siksi valmis summa ohittaa ikkunalaskennan.
      ...(isP2 ? { ansaittuOverrideCents: w.openP2Cents } : {}),
    };
  });
  const preview = computeEraBilling(0, parsedWorkers, []);

  // Varoita jos johtaja on nostanut ikkunamäärän yli sen mitä on maksamatta —
  // silloin samasta työstä maksettaisiin kahdesti.
  const overBilled = isP2 ? [] : selectedWorkers.filter((w) => {
    const typed = Math.max(0, parseFloat((rows[w.workerId]?.pestytIkkunat || "").replace(",", ".")) || 0);
    return typed > w.openP1Windows + 0.01;
  });
  // Onko tälle erälle jo tehty maksu jollekin valitulle tekijälle?
  const alreadyPaidEra = isP2 ? [] : selectedWorkers.filter((w) => eraNumbers.every((n) => w.settledEras.includes(n)));

  const setField = (id: string, field: keyof WorkerRowState, value: string) => {
    setRows((cur) => ({ ...cur, [id]: { ...cur[id], [field]: value } }));
  };

  const send = async () => {
    const activeWorkers = parsedWorkers.filter((w) => (w.ansaittuOverrideCents ?? 0) > 0 || w.pestytIkkunat > 0 || w.sovittuMuutosCents !== 0 || w.ennakkoCents !== 0);
    if (activeWorkers.length === 0) { setError("Valitse ainakin yksi tekijä ja täytä hänen tietonsa."); return; }
    setBusy(true);
    setError(null);
    const res = await api.createWorkerEraInvoiceBatch(jobId, { eraNumbers, workers: activeWorkers, dueDate });
    setBusy(false);
    if (res.ok && res.data) {
      setSentCount(res.data.invoices.length);
      setSkipped(res.data.skipped ?? []);
      onSent?.();
    } else {
      setError(res.error || "Lähetys epäonnistui");
    }
  };


  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {variant === "button" ? (
          <button
            type="button"
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0,
              padding: "8px 13px", borderRadius: 10, cursor: "pointer",
              border: "none", background: "#fff", color: "#0a0a0c",
              fontFamily: "var(--font-onest, system-ui, sans-serif)", fontSize: 12, fontWeight: 700,
            }}
          >
            <Wallet style={{ width: 13, height: 13 }} /> Maksa tekijöille
          </button>
        ) : (
          /* Sama "alaotsikko"-tyyli kuin Section.tsx:n palkeilla. Värit kovakoodattu
             tumman lasin sävyihin (ei shadcn-teemamuuttujia), koska tämä painike
             renderöityy aina project.tsx:n aina-tumman .fr8-root-kuoren sisällä. */
          <button
            type="button"
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px",
              width: "100%", padding: m ? "15px 16px" : "17px 22px",
              background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "20px", backdropFilter: "blur(22px)", WebkitBackdropFilter: "blur(22px)",
              cursor: "pointer", color: "#fff", textAlign: "left",
              fontFamily: "var(--font-onest, system-ui, sans-serif)",
            }}
          >
            <span style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "11px", letterSpacing: "0.14em", color: "rgba(255,255,255,0.55)" }}>
              MAKSU TEKIJÖILLE
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
              <Wallet className="h-4 w-4" style={{ opacity: 0.85 }} />
              <span style={{ fontSize: m ? "12px" : "13px", fontWeight: 600, color: "rgba(255,255,255,0.85)" }}>
                {totalOpenP1 + totalOpenP2 > 0 ? `Maksettavaa ${fmtEurCents(totalOpenP1 + totalOpenP2)}` : "Kaikki maksettu"}
              </span>
            </span>
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">
            <Wallet className="h-4 w-4" /> Tekijöiden maksu — {isP2 ? "keltaiset" : "punaiset"}
          </DialogTitle>
          <DialogDescription>
            {isP2
              ? "Keltaisista kertynyt palkkio palkkiotaulukon mukaan. Vain asiakkaan hyväksymät ikkunat."
              : "Esitäyttö = maksamatta oleva punainen ikkunamäärä (pestyt − aiemmin laskutetut)."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2 mb-4">
          {([["1-3", "Erät 1-3"], ["4", "Erä 4"], ["p2", "Keltaiset"]] as [EraChoice, string][]).map(([e, label]) => (
            <button key={e} onClick={() => setEra(e)}
              className={`flex-1 rounded-xl border px-2.5 py-2.5 text-sm font-semibold ${era === e ? "border-primary bg-primary/10" : "border-border"}`}>
              {label}
              {suggestedEra === e && <span className="block text-[10px] font-normal text-muted-foreground">ehdotus</span>}
            </button>
          ))}
        </div>

        <label className="block text-[11px] text-muted-foreground mb-4">
          Eräpäivä
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-9 mt-0.5" />
        </label>

        {/* Kenelle maksu lähetetään — vapaasti valittavissa. Chip näyttää heti
            paljonko tälle tekijälle on punaisista maksamatta. */}
        <p className="text-[11px] text-muted-foreground mb-1.5">Tekijät ({selectedWorkers.length}/{workers.length})</p>
        <div className="flex flex-wrap gap-1.5 mb-4">
          {workers.map((w) => {
            const active = selectedIds.includes(w.workerId);
            return (
              <button key={w.workerId} type="button" onClick={() => toggleWorker(w.workerId)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${active ? "border-primary bg-primary/10" : "border-border text-muted-foreground hover:bg-muted/40"}`}>
                {active ? "✓ " : "+ "}{w.name}
                <span className="ml-1 font-normal tabular-nums opacity-70">{fmtEurCents(isP2 ? w.openP2Cents : w.openP1Cents)}</span>
              </button>
            );
          })}
        </div>

        {selectedWorkers.length === 0 ? (
          <p className="text-xs text-muted-foreground mb-3">Ei valittuja tekijöitä — valitse yllä olevasta listasta.</p>
        ) : (
        <div className="space-y-3">
          {selectedWorkers.map((w) => {
            const r = rows[w.workerId] || { pestytIkkunat: "", sovittuMuutosCents: "", ennakkoCents: "" };
            const row = preview.workers.find((pw) => pw.workerId === w.workerId);
            return (
              <div key={w.workerId} className="rounded-xl border p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{w.name}</span>
                  <div className="flex items-center gap-2">
                    {row && (
                      <span className="text-xs tabular-nums text-muted-foreground">
                        ansaittu {fmtEurCents(row.ansaittuCents)} · maksettava {fmtEurCents(row.maksettavaCents)}
                      </span>
                    )}
                    <button type="button" onClick={() => toggleWorker(w.workerId)} aria-label={`Poista ${w.name}`}
                      className="shrink-0 rounded-full p-0.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {/* Läpinäkyvä tilanne: mistä esitäyttö tulee ja mitä on jo hoidettu. */}
                {isP2 ? (
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    Keltaisia pesty {fmtWin(w.p2Washed)} kpl · jo maksettu {fmtEurCents(w.p2SettledCents)}
                    {" · "}<strong className="text-foreground">maksamatta {fmtEurCents(w.openP2Cents)}</strong>
                    {w.p2PendingCents > 0 ? ` · odottaa asiakkaan hyväksyntää ${fmtEurCents(w.p2PendingCents)}` : ""}
                  </p>
                ) : (
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    Punaisia pesty {fmtWin(w.p1Washed)} kpl · jo hoidettu {fmtEurCents(w.settledCents)}
                    {w.eraPendingCents > 0 ? ` · odottaa kuittausta ${fmtEurCents(w.eraPendingCents)}` : ""}
                    {" · "}<strong className="text-foreground">maksamatta {fmtWin(w.openP1Windows)} kpl · {fmtEurCents(w.openP1Cents)}</strong>
                    {w.settledEras.length > 0 ? ` · erät ${w.settledEras.join(", ")}` : ""}
                  </p>
                )}
                <div className="grid grid-cols-3 gap-2">
                  <label className="text-[11px] text-muted-foreground">
                    Ikkunat
                    <Input type="text" inputMode="decimal" value={r.pestytIkkunat}
                      readOnly={isP2}
                      onChange={(e) => setField(w.workerId, "pestytIkkunat", e.target.value)}
                      className={`h-9 mt-0.5 tabular-nums ${isP2 ? "opacity-60" : ""}`} />
                  </label>
                  <label className="text-[11px] text-muted-foreground">
                    Sovittu muutos (€)
                    <Input type="text" inputMode="decimal" value={r.sovittuMuutosCents}
                      onChange={(e) => setField(w.workerId, "sovittuMuutosCents", e.target.value)}
                      className="h-9 mt-0.5 tabular-nums" />
                  </label>
                  <label className="text-[11px] text-muted-foreground">
                    Ennakko (€)
                    <Input type="text" inputMode="decimal" value={r.ennakkoCents}
                      onChange={(e) => setField(w.workerId, "ennakkoCents", e.target.value)}
                      className="h-9 mt-0.5 tabular-nums" />
                  </label>
                </div>
              </div>
            );
          })}
        </div>
        )}

        {/* Varoitukset ennen lähetystä — ei estä, mutta ei myöskään anna maksaa
            kahdesti vahingossa. */}
        {overBilled.length > 0 && (
          <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-snug text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
            Ikkunamäärä ylittää maksamattoman työn: {overBilled.map((w) => `${w.name} (max ${fmtWin(w.openP1Windows)})`).join(", ")}.
            Tarkista ettet maksa samasta työstä kahdesti.
          </p>
        )}
        {alreadyPaidEra.length > 0 && (
          <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
            {era === "4" ? "Erä 4" : "Erät 1-3"} on jo laskutettu: {alreadyPaidEra.map((w) => w.name).join(", ")}.
          </p>
        )}
        {!isP2 && totalOpenP2 > 0 && (
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
            Keltaisista odottaa {fmtEurCents(totalOpenP2)} — maksa ne "Keltaiset"-välilehdeltä.
          </p>
        )}

        <div className="flex items-center justify-between gap-3 mt-4 pt-3 border-t border-border">
          <span className="text-xs text-muted-foreground">
            Tekijät ansaittu yhteensä: <strong className="tabular-nums">{fmtEurCents(preview.tekijatAnsaittuYhtCents)}</strong>
          </span>
          <button onClick={send} disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-4 py-2 text-xs font-semibold text-background disabled:opacity-40">
            {busy ? "Lähetetään…" : sentCount != null ? <><Check className="h-3.5 w-3.5" /> Lähetetty ({sentCount})</> : "Lähetä tekijöille"}
          </button>
        </div>
        {skipped.length > 0 && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2">
            Ohitettu (maksu tälle erälle oli jo tehty): {skipped.join(", ")}
          </p>
        )}
        {error && <p className="text-xs text-destructive mt-2">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
