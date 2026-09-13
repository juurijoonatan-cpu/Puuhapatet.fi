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
import { computeEraBilling, P2_ERA_NUMBERS, HOURS_ERA_NUMBERS, SETTLE_ERA_NUMBERS, type TekijaPesu } from "@shared/era-billing";
import type { WorkerSettlement } from "@shared/worker-payouts";
import { fmtEurCents } from "@shared/tax";
import { useIsMobile } from "@/hooks/use-mobile";
import { Wallet, Check, X, AlertTriangle } from "lucide-react";

/** Punaisten erät, keltaisten (2. vaihe) potti tai tuntityö. */
type EraChoice = "kaikki" | "1-3" | "4" | "p2" | "tunnit";

interface WorkerRowState {
  /** Koko saldon maksu: yksi summa, esitäytettynä sillä mikä on maksamatta. */
  summa: string;
  pestytIkkunat: string;
  sovittuMuutosCents: string;
  ennakkoCents: string;
  /** Tuntityö: tunnit ja tuntipalkka. Molemmat muokattavissa — esitäyttö tulee
   *  kirjatuista vuoroista, mutta sovittu määrä voi olla toinen. */
  tunnit: string;
  tuntihinta: string;
}

const EMPTY_ROW: WorkerRowState = { summa: "", pestytIkkunat: "", sovittuMuutosCents: "", ennakkoCents: "", tunnit: "", tuntihinta: "" };

/** Eräpäivän oletusehdotus: 14 vrk tästä hetkestä ("YYYY-MM-DD"). Johtaja voi
 *  aina vaihtaa tämän — ei enää kiinteä oletus laskun lähetyshetkellä. */
function defaultDueDate(): string {
  return new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

const fmtWin = (n: number) => n.toLocaleString("fi-FI", { maximumFractionDigits: 1 });

/** Johtajat jotka voivat toimia maksajana (ostaja tekijän laskulla). */
const FOUNDER_PAYERS = [
  { id: "joonatan", name: "Joonatan Juuri" },
  { id: "matias", name: "Matias Pitkänen" },
];

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
  /** Maksaja. Oletus erän mukaan, mutta johtaja voi vaihtaa sen. */
  const [payerId, setPayerId] = useState<string>("joonatan");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentCount, setSentCount] = useState<number | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);

  // Erien 1-3 maksu on jo tehty jollekin → oletuserä on 4. Näin johtaja ei
  // vahingossa laskuta erää 1-3 uudelleen viimeisen erän kohdalla.
  const totalOpenP1 = workers.reduce((t, w) => t + w.openP1Cents, 0);
  const totalOpenP2 = workers.reduce((t, w) => t + w.openP2Cents, 0);
  const totalOpenHours = workers.reduce((t, w) => t + w.openHoursCents, 0);
  /** Ehdotus: se potti jossa on maksamatonta. Tuntityö ensin kun ikkunoista ei
   *  ole maksettavaa — tuntikeikalla se on ainoa potti, ja ilman tätä dialogi
   *  avautui aina "Erät 1-3" -välilehdelle jossa ei ole mitään. */
  const suggestedEra: EraChoice = useMemo(() => {
    // KOKO SALDO ON OLETUS. Maksaja ei maksa neljää kertaa: hän katsoo paljonko
    // tekijälle kuuluu ja siirtää sen. Erittelyvälilehdet ovat yhä olemassa
    // niitä tilanteita varten joissa maksu kohdistetaan yhteen pottiin.
    if (totalOpenP1 + totalOpenP2 + totalOpenHours > 0) return "kaikki";
    if (totalOpenHours > 0) return "tunnit";
    if (totalOpenP2 > 0) return "p2";
    return workers.some((w) => w.settledEras.includes(3) || w.settledEras.includes(1)) ? "4" : "1-3";
  }, [workers, totalOpenP1, totalOpenP2, totalOpenHours]);
  const isAll = era === "kaikki";
  const isP2 = era === "p2";
  const isHours = era === "tunnit";

  useEffect(() => {
    if (!open) return;
    setSentCount(null);
    setError(null);
    setSkipped([]);
    setDueDate(defaultDueDate());
    setEra(suggestedEra);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Oletusmaksaja seuraa erävalintaa (erä 4 → Matias, muut → Joonatan), kunnes
  // johtaja valitsee toisin.
  useEffect(() => {
    if (!open) return;
    setPayerId(era === "4" ? "matias" : "joonatan");
  }, [open, era]);

  // Esitäyttö AINA jäljellä olevasta työstä (ei koko keikasta) ja uudelleen kun
  // erävalinta vaihtuu — punaisilla ikkunamäärä, keltaisilla oma potti.
  useEffect(() => {
    if (!open) return;
    const p2 = era === "p2";
    const hrs = era === "tunnit";
    const all = era === "kaikki";
    setSelectedIds(workers.filter((w) => (
      all ? w.openTotalCents > 0
        : hrs ? w.openHoursCents > 0 : p2 ? w.openP2Cents > 0 : w.openP1Windows > 0 || w.openP1Cents > 0
    )).map((w) => w.workerId));
    // Tuntitila esitäyttää maksamattomista tunneista. Muulla keikalla tunteja
    // ei lasketa rahaksi lainkaan (ne ovat seurantaa), joten tämä välilehti on
    // silloin KÄSINSYÖTTÖ: tekijän ja tuntien valinta on johtajan, ja kentät
    // alkavat tyhjinä tuntipalkkaa lukuun ottamatta.
    const next: Record<string, WorkerRowState> = {};
    for (const w of workers) {
      /**
       * ESITÄYTTÖ EI SISÄLLÄ KUITTAUSTA ODOTTAVAA.
       *
       * `openTotalCents` on se mitä tekijälle on vielä siirrettävä; jo luotu
       * maksu on varannut oman osuutensa siitä pois. Jos odottava laskettaisiin
       * mukaan, dialogi tarjoaisi samaa summaa toiseen kertaan ja tekijä saisi
       * saman työn maksuna kahdesti.
       */
      const owed = w.openTotalCents;
      next[w.workerId] = {
        /**
         * ESITÄYTTÖ = SE SUMMA JOKA MAKSUT-KORTILLA LUKEE.
         *
         * Siihen sisältyy myös sovittu korjaus (`payoutFixCents`), joka koskee
         * tekijän KOKO saldoa eikä yhtäkään yksittäistä pottia. Juuri siksi
         * korjaukset eivät näkyneet maksussa lainkaan: neljä välilehteä
         * esitäyttyivät kukin omasta potistaan, eikä koko saldon korjaukselle
         * ollut paikkaa missään.
         */
        summa: all && owed > 0 ? String(owed / 100).replace(".", ",") : "",
        // Tuntimaksulla ikkunoita ei laskuteta lainkaan: sama työ ei saa mennä
        // kahdesti (kerran tunteina, kerran ikkunoina).
        tunnit: hrs && w.openHours > 0 ? String(w.openHours) : "",
        // Tuntipalkka esitäytetään aina kun tuntivälilehti on auki: se on keikan
        // sovittu taksa, ja ilman sitä käsinsyöttö vaatisi sen muistamista.
        tuntihinta: hrs && w.hourRateCents > 0 ? String(w.hourRateCents / 100).replace(".", ",") : "",
        // KELTAISET ESITÄYTTYVÄT MAKSAMATTOMISTA, EI KOKO KEIKASTA.
        // Ennen tässä oli `p2Washed` eli tekijän kaikki keltaiset, samalla kun
        // summa tuli avoimesta velasta: rivi väitti "5 kpl · 11,00 €" tekijälle
        // jolle neljä niistä oli jo maksettu, ja sama ikkuna kirjautui laskulle
        // toistamiseen.
        pestytIkkunat: hrs ? "" : p2
          ? (w.openP2Windows > 0 ? String(w.openP2Windows) : "")
          : (w.openP1Windows > 0 ? String(w.openP1Windows) : ""),
        // Tekijän kanssa sovittu vähennys esitäytetään laskun omalle "sovittu
        // muutos" -riville. Ilman tätä lasku olisi laskenut ikkunat × taksa eli
        // TÄYDEN summan, vaikka Maksut-välilehti näytti vähennetyn — ja velkaa
        // olisi jäänyt roikkumaan erotuksen verran. Näin vähennys näkyy myös
        // itse laskulla omana rivinään, kuten kuuluukin.
        sovittuMuutosCents: !p2 && !hrs && w.p1AdjustmentCents ? String(w.p1AdjustmentCents / 100) : "",
        ennakkoCents: "",
      };
    }
    setRows(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, era]);

  const eraNumbers = isAll ? SETTLE_ERA_NUMBERS : isP2 ? P2_ERA_NUMBERS : isHours ? HOURS_ERA_NUMBERS : era === "4" ? [4] : [1, 2, 3];
  const selectedWorkers = workers.filter((w) => selectedIds.includes(w.workerId));
  const toggleWorker = (id: string) => {
    setSelectedIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  };

  const parsedWorkers: TekijaPesu[] = selectedWorkers.map((w) => {
    const r = rows[w.workerId] || EMPTY_ROW;
    return {
      workerId: w.workerId,
      name: w.name,
      pestytIkkunat: isAll ? 0 : Math.max(0, parseFloat(r.pestytIkkunat.replace(",", ".")) || 0),
      sovittuMuutosCents: Math.round((parseFloat(r.sovittuMuutosCents.replace(",", ".")) || 0) * 100),
      ennakkoCents: Math.round((parseFloat(r.ennakkoCents.replace(",", ".")) || 0) * 100),
      // Tuntityö omana rivinään laskulle: tunnit × tuntipalkka. Nämä kulkevat
      // laskun `rivit.input`iin asti, joten tekijä, PDF ja siirtoraportti
      // näkevät saman erittelyn.
      tunnit: isAll ? 0 : Math.max(0, parseFloat(r.tunnit.replace(",", ".")) || 0),
      tuntihintaCents: Math.round((parseFloat(r.tuntihinta.replace(",", ".")) || 0) * 100),
      // Keltaisten palkkio tulee palkkiotaulukosta per ikkuna, ei 20 €/ikkuna —
      // siksi valmis summa ohittaa ikkunalaskennan.
      // Koko saldon maksu: summa on annettu suoraan, ei johdettu ikkunoista.
      ...(isAll ? { ansaittuOverrideCents: Math.max(0, Math.round((parseFloat(r.summa.replace(",", ".")) || 0) * 100)) } : {}),
      ...(isP2 ? { ansaittuOverrideCents: w.openP2Cents } : {}),
    };
  });
  const preview = computeEraBilling(0, parsedWorkers, []);

  // Varoita jos johtaja on nostanut ikkunamäärän yli sen mitä on maksamatta —
  // silloin samasta työstä maksettaisiin kahdesti.
  //
  // Tarkistus tehdään sekä ikkunoina ETTÄ euroina. Pelkkä ikkunavertailu ei
  // riitä: ikkunamäärä ja raha voivat erota (käsin kirjattu maksu ei kirjaa
  // ikkunoita), ja juuri se päästi läpi tapauksen jossa 60 € velasta olisi
  // laskutettu 440 €. Raha on lopullinen totuus — se on sama luku jonka
  // Maksut-välilehti näyttää siirrettävänä.
  const overBilled = isAll || isP2 || isHours ? [] : selectedWorkers.filter((w) => {
    const typed = Math.max(0, parseFloat((rows[w.workerId]?.pestytIkkunat || "").replace(",", ".")) || 0);
    if (typed > w.openP1Windows + 0.01) return true;
    const line = preview.workers.find((t) => t.workerId === w.workerId);
    return !!line && line.maksettavaCents > w.openP1Cents + 1;
  });
  // Onko tälle erälle jo tehty maksu jollekin valitulle tekijälle?
  const alreadyPaidEra = isAll || isP2 || isHours ? [] : selectedWorkers.filter((w) => eraNumbers.every((n) => w.settledEras.includes(n)));
  /**
   * Tuntimaksun ylilaskutus: enemmän kuin tunneista on maksamatta.
   *
   * Varoitus vain kun järjestelmä TIETÄÄ paljonko tunneista kuuluu maksaa, eli
   * kun tuntikertymää on olemassa. Käsin sovitulla tuntikorvauksella (keikka ei
   * ole tuntitilassa, kertymä on nolla) jokainen oikeakin summa olisi muuten
   * "ylilaskutusta" — varoitus joka palaa aina on varoitus jota ei lueta.
   */
  const overHours = !isHours ? [] : selectedWorkers.filter((w) => {
    if (w.hoursEarnedCents <= 0) return false;
    const line = preview.workers.find((t) => t.workerId === w.workerId);
    return !!line && line.ansaittuCents > w.openHoursCents + 1;
  });

  const setField = (id: string, field: keyof WorkerRowState, value: string) => {
    setRows((cur) => ({ ...cur, [id]: { ...cur[id], [field]: value } }));
  };

  const send = async () => {
    const activeWorkers = parsedWorkers.filter((w) => (w.ansaittuOverrideCents ?? 0) > 0 || w.pestytIkkunat > 0 || (w.tunnit ?? 0) > 0 || w.sovittuMuutosCents !== 0 || w.ennakkoCents !== 0);
    if (activeWorkers.length === 0) { setError("Valitse ainakin yksi tekijä ja täytä hänen tietonsa."); return; }
    // Tunnit ilman tuntipalkkaa olisi nollan euron lasku, jonka tunnit silti
    // kuittaisivat tuntikirjanpidon — velka jäisi auki ilman tuntimäärää.
    const missingRate = activeWorkers.filter((w) => (w.tunnit ?? 0) > 0 && (w.tuntihintaCents ?? 0) <= 0);
    if (missingRate.length > 0) {
      setError(`Täytä €/tunti: ${missingRate.map((w) => w.name).join(", ")}.`);
      return;
    }
    setBusy(true);
    setError(null);
    const res = await api.createWorkerEraInvoiceBatch(jobId, { eraNumbers, workers: activeWorkers, dueDate, recipientId: payerId });
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
                {totalOpenP1 + totalOpenP2 + totalOpenHours > 0 ? `Maksettavaa ${fmtEurCents(totalOpenP1 + totalOpenP2 + totalOpenHours)}` : "Kaikki maksettu"}
              </span>
            </span>
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">
            <Wallet className="h-4 w-4" /> Tekijöiden maksu{isAll ? "" : ` — ${isP2 ? "keltaiset" : isHours ? "tuntityö" : "punaiset"}`}
          </DialogTitle>
          <DialogDescription>
            {isAll
              ? "Summa on ehdotus — kirjoita päälle se minkä oikeasti maksat."
              : isP2
              ? "Keltaisista kertynyt palkkio palkkiotaulukon mukaan. Vain asiakkaan hyväksymät ikkunat."
              : isHours
              ? "Esitäyttö = maksamatta olevat tunnit × tekijän tuntipalkka. Molemmat kentät ovat muokattavissa."
              : "Esitäyttö = maksamatta oleva punainen ikkunamäärä (pestyt − aiemmin laskutetut)."}
          </DialogDescription>
        </DialogHeader>

        {/* VÄLILEHDET OVAT POIKKEUS, EIVÄT ETUSIVU.
            Viisi välilehteä kiersi puhelimella kahdelle riville ja vei
            ruudun yläosan — vaikka niistä neljä on niitä harvoja kertoja
            varten jolloin maksu kohdistetaan yhteen pottiin. Oletus on koko
            saldo; muut ovat linkin takana. */}
        {!isAll ? (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {([["kaikki", "Koko saldo"], ["1-3", "Erät 1-3"], ["4", "Erä 4"], ["p2", "Keltaiset"], ["tunnit", "Tunnit"]] as [EraChoice, string][]).map(([e, label]) => (
              <button key={e} onClick={() => setEra(e)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${era === e ? "border-primary bg-primary/10" : "border-border text-muted-foreground"}`}>
                {label}
              </button>
            ))}
          </div>
        ) : (
          <button type="button" onClick={() => setEra("1-3")}
            className="mb-3 text-[11px] text-muted-foreground underline underline-offset-2">
            Kohdista maksu yhteen pottiin
          </button>
        )}

        <div className="grid grid-cols-2 gap-2 mb-3">
          <label className="block text-[11px] text-muted-foreground">
            Eräpäivä
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-9 mt-0.5" />
          </label>
          {/* MAKSAJA = se johtaja jonka Y-tunnukselle tekijä laskuttaa, eli se joka
              oikeasti siirtää rahat. Oletus tuli ennen pelkästään erän numerosta
              (erät 1-3 Joonatan, erä 4 Matias) eikä sitä voinut vaihtaa — laskulle
              päätyi väärä nimi, ja korjaaminen jälkikäteen oli mahdotonta. */}
          <label className="block text-[11px] text-muted-foreground">
            Maksaja
            <select
              value={payerId}
              onChange={(e) => setPayerId(e.target.value)}
              className="h-9 mt-0.5 w-full rounded-md border border-input bg-background px-2 text-sm"
              aria-label="Maksaja"
            >
              {FOUNDER_PAYERS.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </label>
        </div>

        {/* Kenelle maksu lähetetään — vapaasti valittavissa. Chip näyttää heti
            paljonko tälle tekijälle on punaisista maksamatta. */}
        <p className="text-[11px] text-muted-foreground mb-1.5">Tekijät ({selectedWorkers.length}/{workers.length})</p>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {workers.map((w) => {
            const active = selectedIds.includes(w.workerId);
            return (
              <button key={w.workerId} type="button" onClick={() => toggleWorker(w.workerId)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${active ? "border-primary bg-primary/10" : "border-border text-muted-foreground hover:bg-muted/40"}`}>
                {active ? "✓ " : "+ "}{w.name}
                <span className="ml-1 font-normal tabular-nums opacity-70">{fmtEurCents(isAll ? w.openTotalCents : isP2 ? w.openP2Cents : isHours ? w.openHoursCents : w.openP1Cents)}</span>
                {isAll && w.pendingTotalCents > 0 && (
                  // Jo luotu maksu ei ole siirrettävää eikä sitä saa tarjota
                  // uudelleen — mutta se pitää näkyä, ettei johtaja luule sen
                  // kadonneen ja tee sitä toistamiseen.
                  <span className="ml-1 font-normal tabular-nums opacity-50">+ {fmtEurCents(w.pendingTotalCents)} odottaa tekijää</span>
                )}
              </button>
            );
          })}
        </div>

        {selectedWorkers.length === 0 ? (
          <p className="text-xs text-muted-foreground mb-3">
            {isHours && totalOpenHours <= 0
              ? "Tälle keikalle ei ole kertynyt maksamattomia tunteja. Valitse tekijä yllä ja kirjaa sovitut tunnit käsin."
              : "Ei valittuja tekijöitä — valitse yllä olevasta listasta."}
          </p>
        ) : (
        <div className="space-y-3">
          {selectedWorkers.map((w) => {
            const r = rows[w.workerId] || EMPTY_ROW;
            const row = preview.workers.find((pw) => pw.workerId === w.workerId);
            return (
              <div key={w.workerId} className="rounded-xl border p-2.5 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{w.name}</span>
                  <div className="flex items-center gap-2">
                    {/* Koko saldon maksussa tämä toisti kentän luvun kahdesti
                        samalla rivillä ("ansaittu 84 € · maksettava 84 €"),
                        kun kentässä lukee jo 84. */}
                    {row && !isAll && (
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
                {isAll ? (
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    {[
                      w.openP1Cents > 0 ? `punaiset ${fmtEurCents(w.openP1Cents)}` : "",
                      w.openP2Cents > 0 ? `keltaiset ${fmtEurCents(w.openP2Cents)}` : "",
                      w.openHoursCents > 0 ? `tunnit ${fmtEurCents(w.openHoursCents)}` : "",
                    ].filter(Boolean).join(" · ") || "ei avointa saldoa"}
                    {w.payoutFixCents !== 0 && (
                      <span className="block text-amber-600 dark:text-amber-400">
                        sisältää sovitun korjauksen {w.payoutFixCents < 0 ? "−" : "+"}{fmtEurCents(Math.abs(w.payoutFixCents))}
                      </span>
                    )}
                  </p>
                ) : isHours ? (
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    Tunteja kirjattu {fmtWin(w.hours)} h × {fmtEurCents(w.hourRateCents)} = {fmtEurCents(w.hoursEarnedCents)}
                    {" · jo maksettu "}{fmtEurCents(w.hoursSettledCents)}
                    {" · "}<strong className="text-foreground">maksamatta {fmtWin(w.openHours)} h · {fmtEurCents(w.openHoursCents)}</strong>
                    {/* Sama muistutus toisinpäin — ks. keltaisten haara. */}
                    {w.openP2Cents > 0 && (
                      <span className="block text-amber-600 dark:text-amber-400">
                        Myös keltaisia {fmtEurCents(w.openP2Cents)} maksamatta — tee se Keltaiset-välilehdeltä.
                      </span>
                    )}
                  </p>
                ) : isP2 ? (
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    Keltaisia pesty {fmtWin(w.p2Washed)} kpl · jo maksettu {fmtEurCents(w.p2SettledCents)}
                    {/* Kappaleet JA euro samasta lähteestä: "5 kpl · 11,00 €"
                        näytti 2,20 €/keltainen, koska kappaleet olivat koko
                        keikalta ja euro vain maksamattomasta osasta. */}
                    {" · "}<strong className="text-foreground">maksamatta {fmtWin(w.openP2Windows)} kpl · {fmtEurCents(w.openP2Cents)}</strong>
                    {w.p2PendingCents > 0 ? ` · odottaa asiakkaan hyväksyntää ${fmtEurCents(w.p2PendingCents)}` : ""}
                    {/* TOINEN POTTI EI SAA UNOHTUA. Keltaiset ja tunnit ovat
                        eri rahavirtoja eivätkä mahdu samalle laskulle (yksi
                        lasku = yksi virta), joten sama tekijä tarvitsee kaksi
                        maksua. Ilman tätä muistutusta toinen jäi helposti
                        tekemättä: siirtolistalla ne näkyvät yhtenä summana. */}
                    {w.openHoursCents > 0 && (
                      <span className="block text-amber-600 dark:text-amber-400">
                        Myös tuntityötä {fmtEurCents(w.openHoursCents)} maksamatta — tee se Tunnit-välilehdeltä.
                      </span>
                    )}
                  </p>
                ) : (
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    Punaisia pesty {fmtWin(w.p1Washed)} kpl · jo hoidettu {fmtEurCents(w.settledCents)}
                    {w.eraPendingCents > 0 ? ` · odottaa kuittausta ${fmtEurCents(w.eraPendingCents)}` : ""}
                    {" · "}<strong className="text-foreground">maksamatta {fmtWin(w.openP1Windows)} kpl · {fmtEurCents(w.openP1Cents)}</strong>
                    {/* Sentinel-erät (0, 8, 9) eivät ole urakan eriä eivätkä kuulu listaan. */}
                    {(() => { const e = w.settledEras.filter((n) => n >= 1 && n <= 4); return e.length ? ` · erät ${e.join(", ")}` : ""; })()}
                  </p>
                )}
                {isAll ? (
                  /* YKSI KENTTÄ. Ikkunat, tunnit, sovittu muutos ja ennakko ovat
                     erittelyvälilehtien työkaluja; koko saldon maksussa on vain
                     se luku joka siirretään. */
                  <label className="block text-[11px] text-muted-foreground">
                    Maksetaan (€)
                    <Input type="text" inputMode="decimal" value={r.summa}
                      onChange={(e) => setField(w.workerId, "summa", e.target.value)}
                      className="h-11 mt-0.5 text-base font-semibold tabular-nums" />
                  </label>
                ) : (
                <div className="grid grid-cols-3 gap-2">
                  {isHours ? (
                    <>
                      <label className="text-[11px] text-muted-foreground">
                        Tunnit
                        <Input type="text" inputMode="decimal" value={r.tunnit}
                          onChange={(e) => setField(w.workerId, "tunnit", e.target.value)}
                          className="h-9 mt-0.5 tabular-nums" />
                      </label>
                      <label className="text-[11px] text-muted-foreground">
                        €/tunti
                        <Input type="text" inputMode="decimal" value={r.tuntihinta}
                          onChange={(e) => setField(w.workerId, "tuntihinta", e.target.value)}
                          className="h-9 mt-0.5 tabular-nums" />
                      </label>
                    </>
                  ) : (
                  <label className="text-[11px] text-muted-foreground">
                    Ikkunat
                    <Input type="text" inputMode="decimal" value={r.pestytIkkunat}
                      readOnly={isP2}
                      onChange={(e) => setField(w.workerId, "pestytIkkunat", e.target.value)}
                      className={`h-9 mt-0.5 tabular-nums ${isP2 ? "opacity-60" : ""}`} />
                  </label>
                  )}
                  {!isHours && (
                    <label className="text-[11px] text-muted-foreground">
                      Sovittu muutos (€)
                      <Input type="text" inputMode="decimal" value={r.sovittuMuutosCents}
                        onChange={(e) => setField(w.workerId, "sovittuMuutosCents", e.target.value)}
                        className="h-9 mt-0.5 tabular-nums" />
                    </label>
                  )}
                  <label className="text-[11px] text-muted-foreground">
                    Ennakko (€)
                    <Input type="text" inputMode="decimal" value={r.ennakkoCents}
                      onChange={(e) => setField(w.workerId, "ennakkoCents", e.target.value)}
                      className="h-9 mt-0.5 tabular-nums" />
                  </label>
                </div>
                )}
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
        {overHours.length > 0 && (
          <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-snug text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
            Tuntimaksu ylittää maksamattoman tuntityön: {overHours.map((w) => `${w.name} (max ${fmtEurCents(w.openHoursCents)})`).join(", ")}.
          </p>
        )}
        {!isAll && !isP2 && totalOpenP2 > 0 && (
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
            Keltaisista odottaa {fmtEurCents(totalOpenP2)} — maksa ne "Keltaiset"-välilehdeltä.
          </p>
        )}
        {!isAll && !isHours && totalOpenHours > 0 && (
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
            Tuntityöstä odottaa {fmtEurCents(totalOpenHours)} — maksa ne "Tunnit"-välilehdeltä.
          </p>
        )}

        {/* ALAPALKKI PYSYY NÄKYVISSÄ.
            Ainoa ulospääsy oli X aivan ylhäällä, ja se vieri pois näkyvistä
            heti kun tekijöitä oli pari — dialogista ei siis päässyt pois
            ilman että selasi koko listan takaisin ylös. Lähetysnappi oli
            saman listan alimmaisena. Nyt molemmat ovat aina kädessä. */}
        {/* Alareunan täyte kotipalkin verran: ilman sitä Lähetä-nappi jäi
            iPhonen alapalkin alle juuri sen verran ettei siihen osunut. */}
        <div
          className="sticky bottom-0 -mx-6 mt-4 border-t border-border bg-background px-6 pt-3"
          style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              Yhteensä <strong className="tabular-nums text-foreground">{fmtEurCents(preview.tekijatAnsaittuYhtCents)}</strong>
            </span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setOpen(false)}
                className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground">
                Sulje
              </button>
              <button onClick={send} disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-4 py-2 text-xs font-semibold text-background disabled:opacity-40">
                {busy ? "Lähetetään…" : sentCount != null ? <><Check className="h-3.5 w-3.5" /> Lähetetty ({sentCount})</> : "Lähetä"}
              </button>
            </div>
          </div>
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
