/**
 * FR8 — "Maksut": KAIKKI keikan rahaliikenne yhdessä paikassa.
 *
 * Projektinäkymän kolmas välilehti (vain johtajille, ks. Navbar.showMaksutTab).
 * Järjestys on tarkoituksella "mitä minun pitää tehdä" → "mitä on tehty":
 *
 *  0. ASIAKKAALTA — punaisten 4 erää + keltaisten laskutus (vain tilannekuva;
 *     laskun lähetys tapahtuu keikkanäkymän Laskutus-kortissa, ei täällä).
 *  1. JOHTAJIEN TASAUS — kumpi on velkaa kummalle ja paljonko (`TasausView`).
 *     Tämä on heti laskutuksen alla, koska se on ainoa luku jota ei näe
 *     mistään muualta: laskut kertovat mitä on laskutettu, tasaus sen kenen
 *     taskussa raha oikeasti on.
 *  2. TEKIJÖILLE MAKSETTAVAA — per tekijä: punaisista ansaittu, hoidettu ja
 *     **vielä siirtämättä**, + "Maksa tekijöille" -toiminto. Tämä on se näkymä
 *     jonka perustaja avaa saatuaan erän rahat tilille. Keltaiset näkyvät omana
 *     rivinä, koska niitä EI makseta ennen kuin asiakas on maksanut ne.
 *  3. Johtajien väliset laskut.
 *  4.–5. Tekijöille lähetetyt maksut tiloineen + kuittaukset.
 *
 * Kaikki summat tulevat jaetusta `shared/worker-payouts.ts`:stä — sama laskenta
 * kuin Tiimi-sivun palkkayhteenvedossa ja maksudialogin esitäytössä.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type EraInvoiceClient } from "@/lib/api";
import { summarizeEraInvoices, isP2EraSelection } from "@shared/era-billing";
import {
  computeWorkerSettlements, eraSettlementByWorker, sumWorkerSettlements,
} from "@shared/worker-payouts";
import type { ProjectData } from "@shared/project";
import { fmtEurCents } from "@shared/tax";
import { BRAND_BILLERS } from "@shared/billers";
import { RefreshCw, Wallet, Users, CheckCircle2, Mail, FileDown, Receipt, HandCoins, Scale } from "lucide-react";
import { T, card as tokenCard, mono, statLabel, subLabel, button as tokenButton, input as tokenInput, chip } from "./tokens";
import SendInvoiceEmailDialog from "./SendInvoiceEmailDialog";
import WorkerEraInvoiceDialog from "./WorkerEraInvoiceDialog";
import TasausView from "./TasausView";

/** Sama polettilähde kuin dashissa (`./tokens`). Aiemmin tämä näkymä käytti
 *  omaa korttiaan (pyöristys 16 vs. dashin 20/22, tausta 0,04 vs. 0,035) ja
 *  omaa vihreäänsä (#5fe08a vs. dashin #9ff0bd) — kaksi välilehteä samasta
 *  rahasta näyttivät kahdelta eri sovellukselta. */
const FONT = T.font;
const MONO = T.mono;

const card: React.CSSProperties = { ...tokenCard, padding: T.space.lg };

function founderName(id: string): string {
  return BRAND_BILLERS.find((b) => b.id === id)?.name || id;
}

function eraLabel(nums: number[]): string {
  if (isP2EraSelection(nums)) return "Keltaiset";
  if (nums.length === 0) return "Erä —";
  return nums.length === 1 ? `Erä ${nums[0]}` : `Erät ${nums[0]}–${nums[nums.length - 1]}`;
}

function fiDate(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString("fi-FI") : "—";
}

const fmtWin = (n: number) => n.toLocaleString("fi-FI", { maximumFractionDigits: 1 });

const TILA_CHIP: Record<string, { label: string; color: string; bg: string }> = {
  luonnos: { label: "Odottaa tekijää", color: T.tone.warn, bg: T.tone.warnBg },
  "lähetetty": { label: "Lähetetty · lukittu", color: T.tone.good, bg: T.tone.goodBg },
  "hyväksytty": { label: "Tekijä lähettänyt ✓", color: T.tone.good, bg: T.tone.goodBg },
  "hylätty": { label: "Hylätty", color: T.tone.bad, bg: T.tone.badBg },
};

function TilaChip({ tila }: { tila: string }) {
  const c = TILA_CHIP[tila] || TILA_CHIP.luonnos;
  return <span style={chip(c.color, c.bg)}>{c.label}</span>;
}

function SectionTitle({ icon, children, right }: { icon: React.ReactNode; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: T.space.sm, margin: `${T.space.xl}px 0 ${T.space.md}px` }}>
      {icon}
      <h2 style={{ margin: 0, fontFamily: FONT, fontSize: T.size.body, fontWeight: 700, color: T.text.primary, letterSpacing: "0.01em" }}>{children}</h2>
      {right && <span style={{ marginLeft: "auto", flexShrink: 0 }}>{right}</span>}
    </div>
  );
}

function StatTile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div style={{ ...card, flex: 1, minWidth: 150 }}>
      <p style={{ ...statLabel, margin: 0 }}>{label}</p>
      <p style={{ margin: `${T.space.xs + 2}px 0 0`, fontFamily: FONT, fontSize: T.size.title, fontWeight: 700, color: tone || T.text.primary }}>{value}</p>
      {sub && <p style={subLabel}>{sub}</p>}
    </div>
  );
}

/**
 * Sovitun vähennyksen (tai lisän) säädin yhdelle tekijälle.
 *
 * Oma pieni lomake eikä `window.prompt`: kotivalikkoon asennetussa iOS-PWA:ssa
 * natiivi prompt on epäluotettava — nappi näyttää siltä ettei se tee mitään.
 * Tässä syöttö on osa sivua, numeronäppäimistöllä ja isoilla painikkeilla.
 *
 * Syöte on POSITIIVINEN euromäärä = vähennys, koska johtaja ajattelee
 * "vähennetään 10 €". Tallennukseen se kääntyy negatiiviseksi sentiksi.
 */
function AdjustmentControl({ name, cents, onSave }: {
  name: string;
  /** Nykyinen sovittu muutos sentteinä, etumerkillinen (0 = ei muutosta). */
  cents: number;
  onSave: (cents: number | null) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const start = () => {
    // Näytä nykyinen vähennys positiivisena, samassa muodossa kuin se syötetään.
    setValue(cents ? String(Math.abs(cents) / 100).replace(".", ",") : "");
    setOpen(true);
  };
  const commit = async (next: number | null) => {
    setBusy(true);
    await onSave(next);
    setBusy(false);
    setOpen(false);
  };
  const parsed = Number(value.trim().replace(",", "."));
  const canSave = value.trim() !== "" && Number.isFinite(parsed) && parsed > 0;

  const btn = tokenButton();

  return (
    <div style={{ marginTop: T.space.sm, paddingTop: T.space.sm, borderTop: T.border.divider }}>
      {!open ? (
        <div style={{ display: "flex", alignItems: "center", gap: T.space.sm, flexWrap: "wrap" }}>
          <button onClick={start} style={btn}>
            {cents !== 0 ? "Muuta vähennystä" : "Sovittu vähennys"}
          </button>
          {cents !== 0 && (
            <button onClick={() => void commit(null)} disabled={busy} style={{ ...btn, background: "transparent", color: T.text.muted }}>
              Poista
            </button>
          )}
        </div>
      ) : (
        <div>
          <p style={{ margin: `0 0 ${T.space.xs + 2}px`, fontFamily: FONT, fontSize: T.size.xs, color: T.text.muted }}>
            Paljonko {name.split(/\s+/)[0]}lta vähennetään?
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: T.space.sm, flexWrap: "wrap" }}>
            <input
              type="text"
              inputMode="decimal"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && canSave) void commit(-Math.round(parsed * 100)); }}
              placeholder="10"
              aria-label={`Sovittu vähennys — ${name}`}
              style={{ ...tokenInput, width: 90, textAlign: "right" }}
            />
            <span style={{ fontFamily: FONT, fontSize: T.size.body, color: T.text.muted }}>€</span>
            <button
              onClick={() => void commit(-Math.round(parsed * 100))}
              disabled={!canSave || busy}
              style={canSave ? tokenButton("accent") : { ...btn, opacity: 0.45 }}
            >
              {busy ? "Tallennetaan…" : "Tallenna"}
            </button>
            <button onClick={() => setOpen(false)} disabled={busy} style={{ ...btn, background: "transparent", color: T.text.muted }}>
              Peru
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Sähköpostikopioiden tila johtaja-väliselle laskulle (kohta 3D viimeinen
 *  luetelmakohta). Lokitetaan lähetyksen yhteydessä (kohta 4); luonnostila
 *  (esim. tekijän vielä käsittelemättä oleva luonnos) ei koskaan lähetä
 *  sähköpostia, joten tyhjä loki on siihen asti odotettu, ei virhe. */
function EmailCopies({ inv }: { inv: EraInvoiceClient }) {
  const emails = inv.emails || [];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: T.space.xs + 2, marginTop: T.space.sm }}>
      <Mail style={{ width: 12, height: 12, color: T.text.faint, flexShrink: 0 }} />
      {emails.length === 0 ? (
        <span style={{ fontFamily: FONT, fontSize: T.size.xs, color: T.text.faint }}>
          {/* EI palvelimen ympäristömuuttujan nimeä käyttöliittymään — se ei
              kerro johtajalle mitään ja näyttää rikkoutuneelta. */}
          {inv.tila === "luonnos" ? "Ei vielä lähetetty — odottaa tekijää." : "Ei sähköpostikopioita."}
        </span>
      ) : (
        <span style={{ fontFamily: FONT, fontSize: T.size.xs, color: T.text.muted }}>
          {emails.map((e, i) => (
            <span key={i}>
              {i > 0 && " · "}
              {e.success ? "✓" : "✗"} {e.recipients.join(", ")} ({fiDate(e.sentAt)})
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

/** PDF-lataus (kohta 4) — admin-Bearer-autentikoitu, joten haetaan blobina ja
 *  avataan uuteen välilehteen sen sijaan että linkitettäisiin suoraan. */
function DownloadPdfButton({ jobId, invoiceId }: { jobId: number; invoiceId: number }) {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    const res = await api.downloadEraInvoicePdf(jobId, invoiceId);
    setBusy(false);
    if (res.ok && res.blob) {
      const url = URL.createObjectURL(res.blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  };
  return (
    <button onClick={download} disabled={busy}
      style={{ ...tokenButton(), opacity: busy ? 0.5 : 1 }}>
      <FileDown style={{ width: 12, height: 12 }} /> {busy ? "Avataan…" : "Lataa PDF"}
    </button>
  );
}

/**
 * Mitätöi tekijälasku (väärä summa tai väärä maksaja).
 *
 * Tekijä voi hylätä vain LUONNOKSEN omalta linkiltään. Kun johtaja huomaa virheen
 * vasta lähetyksen jälkeen, ilman tätä ei ollut mitään reittiä takaisin: velka jäi
 * kuitatuksi väärällä summalla eikä oikeaa laskua voinut tehdä. Hylätty lasku ei
 * kuittaa mitään, joten summa palaa avoimeksi heti.
 */
function VoidInvoiceButton({ jobId, invoiceId, name, onDone }: {
  jobId: number; invoiceId: number; name: string; onDone: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  // minHeight tulee poletista (40) — inline-36 oli ainoa kohta joka ohitti
  // dokumentoidun osumakokosäännön, ja se näkyi: viereinen "Lataa PDF" oli 40.
  const btn: React.CSSProperties = { ...tokenButton(), background: "transparent", color: T.text.muted };
  if (!confirming) {
    return <button onClick={() => setConfirming(true)} style={btn}>Mitätöi</button>;
  }
  // Kysymys omalle rivilleen ja napit sen alle: yhdellä rivillä tämä katkesi
  // puhelimessa kolmelle riville, joista kaksi oli nappeja eri kohdissa.
  return (
    <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: T.space.sm }}>
      <span style={{ fontFamily: FONT, fontSize: T.size.xs, color: "rgba(255,160,160,0.95)" }}>
        Mitätöidäänkö {name}n lasku? Summa palaa siirrettäväksi.
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: T.space.sm, flexWrap: "wrap" }}>
      <button
        disabled={busy}
        onClick={async () => { setBusy(true); await api.voidEraInvoice(jobId, invoiceId); setBusy(false); setConfirming(false); onDone(); }}
        style={tokenButton("danger")}
      >
        {busy ? "Mitätöidään…" : "Kyllä, mitätöi"}
      </button>
      <button disabled={busy} onClick={() => setConfirming(false)} style={btn}>Peru</button>
      </span>
    </span>
  );
}

export interface MaksutBilling {
  p1PayCount: number;
  p1InvoicedCents: number;
  p2InvoicedCents: number;
  p2RemainingCents: number;
  agreedTotalCents: number;
  nextInstalmentCents: number;
}

export default function MaksutView({ jobId, project, billing, onOpenGig, onSetAdjustment, canEditTasaus = true }: {
  jobId: number;
  /** Karttatila — tarvitaan tekijöiden maksettavan laskentaan. */
  project: ProjectData | null;
  /** Asiakaslaskutuksen tila serveriltä (GET /project → billing). */
  billing?: MaksutBilling | null;
  /** Hyppy keikkanäkymään, jossa asiakaslaskut lähetetään. */
  onOpenGig?: () => void;
  /** Sovittu vähennys/lisä tekijän punaisten palkkaan (senttiä, etumerkillinen;
   *  null poistaa). Tallentuu crew-riville, joten se pysyy. */
  onSetAdjustment?: (workerId: string, cents: number | null) => Promise<void> | void;
  /** Saako katsoja kirjata tasauksen (vain perustaja). */
  canEditTasaus?: boolean;
}) {
  const [invoices, setInvoices] = useState<EraInvoiceClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api.getEraInvoices(jobId);
    // Puolustava luku: vaikka status olisi 2xx, runko voi olla odottamaton
    // (proxy, vanha buildi) — silloin näytetään tyhjä lista, ei kaadeta sivua.
    if (res.ok && Array.isArray(res.data?.invoices)) { setInvoices(res.data.invoices); setErr(null); }
    else if (res.ok) { setInvoices([]); setErr(null); }
    else setErr(res.error || "Lataus epäonnistui");
    setLoading(false);
  }, [jobId]);

  useEffect(() => { void load(); }, [load]);

  const s = summarizeEraInvoices(invoices);

  // Tekijöiden maksettava — yksi jaettu laskenta. Muistetaan invoices/project
  // muuttuessa, koska tämä käy koko karttadatan läpi per tekijä.
  const settlements = useMemo(
    () => (project ? computeWorkerSettlements(project, {
      era: eraSettlementByWorker(invoices, "p1"),
      p2Era: eraSettlementByWorker(invoices, "p2"),
    }) : []),
    [project, invoices],
  );
  const payable = useMemo(() => settlements.filter((r) => r.active || r.earnedCents > 0), [settlements]);
  const totals = useMemo(() => sumWorkerSettlements(payable), [payable]);

  return (
    <div
      data-fr8-pane
      style={{
        height: "100%", overflowY: "auto", overflowX: "hidden", overscrollBehavior: "contain",
        boxSizing: "border-box",
        padding: `${T.space.lg + 4}px ${T.space.lg}px calc(${T.space.xl}px + env(safe-area-inset-bottom))`,
        maxWidth: 980, margin: "0 auto", width: "100%",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: T.space.sm + 2 }}>
        <h1 style={{ margin: 0, fontFamily: FONT, fontSize: T.size.display, fontWeight: 700, color: T.text.primary, letterSpacing: "-0.01em" }}>Maksut</h1>
        <div style={{ display: "flex", alignItems: "center", gap: T.space.sm, flexShrink: 0 }}>
          <SendInvoiceEmailDialog />
          <button onClick={() => { setLoading(true); void load(); }} title="Päivitä" style={tokenButton()}>
            <RefreshCw style={{ width: 13, height: 13 }} /> Päivitä
          </button>
        </div>
      </div>

      {loading && <p style={{ fontFamily: FONT, fontSize: T.size.sm, color: T.text.muted, marginTop: T.space.xl }}>Ladataan…</p>}
      {err && !loading && (
        <div style={{ ...card, marginTop: T.space.lg, borderColor: T.tone.badBorder }}>
          <p style={{ margin: 0, fontFamily: FONT, fontSize: T.size.sm, color: T.tone.bad }}>{err}</p>
        </div>
      )}

      {!loading && !err && (
        <>
          {/* ── 0. ASIAKKAALTA — tilannekuva. Laskun lähetys on keikkanäkymässä,
                 ei tässä: sama toiminto ei ole kahdessa paikassa. */}
          {billing && (
            <>
              <SectionTitle
                icon={<Receipt style={{ width: 15, height: 15, color: T.text.secondary }} />}
                right={onOpenGig ? (
                  <button onClick={onOpenGig}
                    style={tokenButton()}>
                    Lähetä lasku →
                  </button>
                ) : undefined}
              >
                Asiakkaalta laskutettu
              </SectionTitle>
              {/* Punaiset romahtavat yhdelle riville kun kaikki 4 erää on lähetetty —
                  silloin niissä ei ole enää mitään tehtävää. Kesken oleva laskutus
                  saa oman tiilensä. */}
              {billing.p1PayCount >= 4 ? (
                <div style={{ ...card, display: "flex", alignItems: "center", gap: T.space.sm + 2, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: FONT, fontSize: T.size.sm, color: T.tone.good, fontWeight: 700 }}>✓ Punaiset laskutettu</span>
                  <span style={{ fontFamily: FONT, fontSize: T.size.sm, color: T.text.muted }}>4/4 erää · {fmtEurCents(billing.p1InvoicedCents)}</span>
                  <span style={{ marginLeft: "auto", fontFamily: FONT, fontSize: T.size.sm, color: billing.p2RemainingCents > 0 ? T.tone.warn : T.text.muted }}>
                    Keltaiset: {billing.p2InvoicedCents > 0 ? `laskutettu ${fmtEurCents(billing.p2InvoicedCents)}` : "ei laskutettu"}
                    {billing.p2RemainingCents > 0 ? ` · laskuttamatta ${fmtEurCents(billing.p2RemainingCents)}` : ""}
                  </span>
                </div>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: T.space.sm + 2 }}>
                  <StatTile
                    label="Punaiset laskutettu"
                    value={fmtEurCents(billing.p1InvoicedCents)}
                    sub={`${Math.min(4, billing.p1PayCount)}/4 erää · sopimus ${fmtEurCents(billing.agreedTotalCents)}`}
                    tone={T.tone.good}
                  />
                  <StatTile
                    label="Seuraava erä"
                    value={fmtEurCents(billing.nextInstalmentCents)}
                    sub={`jäljellä ${fmtEurCents(Math.max(0, billing.agreedTotalCents - billing.p1InvoicedCents))}`}
                  />
                  <StatTile
                    label="Keltaiset"
                    value={fmtEurCents(billing.p2InvoicedCents)}
                    sub={billing.p2RemainingCents > 0 ? `laskuttamatta ${fmtEurCents(billing.p2RemainingCents)}` : "ei laskuttamatonta"}
                    tone={billing.p2InvoicedCents > 0 ? T.tone.good : undefined}
                  />
                </div>
              )}
            </>
          )}

          {/* ── 1. JOHTAJIEN TASAUS — kuka on velkaa kenelle.
                 Tämä on heti asiakaslaskutuksen alla, koska se on ainoa luku
                 jota ei saa mistään muualta: erälaskut kertovat mitä on
                 laskutettu, tasaus kertoo kenen taskussa raha oikeasti on. */}
          <SectionTitle icon={<Scale style={{ width: 15, height: 15, color: T.text.secondary }} />}>
            Johtajien tasaus
          </SectionTitle>
          <TasausView jobId={jobId} canEdit={canEditTasaus} />

          {/* ── 2. TEKIJÖILLE MAKSETTAVAA — päänäkymä. */}
          <SectionTitle
            icon={<HandCoins style={{ width: 15, height: 15, color: T.text.secondary }} />}
            right={payable.length > 0 ? <WorkerEraInvoiceDialog jobId={jobId} workers={payable} variant="button" onSent={() => void load()} /> : undefined}
          >
            Tekijöille maksettavaa
          </SectionTitle>
          {payable.length === 0 ? (
            <div style={card}>
              <p style={{ margin: 0, fontFamily: FONT, fontSize: T.size.sm, color: T.text.muted }}>
                Ei tekijöitä tällä keikalla. Lisää tekijät Tiimi-sivulla.
              </p>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: T.space.sm + 2, marginBottom: T.space.md }}>
                <StatTile
                  label="Punaisista siirrettävä"
                  value={fmtEurCents(totals.openP1Cents)}
                  sub={totals.openP1Cents > 0 ? `${fmtWin(totals.openP1Windows)} ikkunaa · ansaittu ${fmtEurCents(totals.p1EarnedCents)}` : "kaikki maksettu ✓"}
                  tone={totals.openP1Cents > 0 ? T.tone.warn : T.text.muted}
                />
                <StatTile
                  label="Keltaisista siirrettävä"
                  value={fmtEurCents(totals.openP2Cents)}
                  sub={totals.openP2Cents > 0 ? `${fmtWin(totals.p2Washed)} ikkunaa · sovitut hinnat` : "ei maksettavaa"}
                  tone={totals.openP2Cents > 0 ? T.tone.warn : T.text.muted}
                />
                <StatTile
                  label="Hoidettu"
                  value={fmtEurCents(totals.settledCents)}
                  sub={totals.eraPendingCents > 0 ? `+ ${fmtEurCents(totals.eraPendingCents)} odottaa kuittausta` : "maksut + erälaskut"}
                  tone={T.tone.good}
                />
              </div>
              {/* Hyväksymättömät keltaiset: työ tehty, hinta kesken. */}
              {totals.p2PendingCents > 0 && (
                <div style={{ ...card, marginBottom: T.space.md, borderColor: "rgba(150,175,255,0.3)", background: "rgba(120,150,255,0.06)" }}>
                  <p style={{ margin: 0, fontFamily: FONT, fontSize: T.size.sm, color: "rgba(190,205,255,0.95)", lineHeight: 1.5 }}>
                    Odottaa asiakkaan hyväksyntää: <strong>{fmtEurCents(totals.p2PendingCents)}</strong> keltaisista.
                  </p>
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: T.space.sm }}>
                {payable.map((r) => (
                  <div key={r.workerId} style={{ ...card, padding: `${T.space.md}px ${T.space.lg}px` }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: T.space.sm + 2, flexWrap: "wrap" }}>
                      <div style={{ minWidth: 0 }}>
                        <p style={{ margin: 0, fontFamily: FONT, fontSize: T.size.sm, fontWeight: 700, color: T.text.primary }}>{r.name}</p>
                        <p style={{ margin: "2px 0 0", fontFamily: FONT, fontSize: T.size.xs, color: T.text.muted }}>
                          punaiset {fmtWin(r.p1Washed)} · hoidettu {fmtEurCents(r.settledCents)}
                          {r.eraPendingCents > 0 ? ` · kuittaamatta ${fmtEurCents(r.eraPendingCents)}` : ""}
                          {r.settledEras.length > 0 ? ` · erät ${r.settledEras.join(", ")}` : ""}
                        </p>
                        {r.p1AdjustmentCents !== 0 && (
                          <p style={{ margin: "2px 0 0", fontFamily: FONT, fontSize: T.size.xs, color: "rgb(255,150,150)" }}>
                            sovittu {r.p1AdjustmentCents < 0 ? "vähennys" : "lisä"} {r.p1AdjustmentCents < 0 ? "−" : "+"}{fmtEurCents(Math.abs(r.p1AdjustmentCents))}
                            {" · brutto "}{fmtEurCents(r.p1EarnedCents)}
                          </p>
                        )}
                        {(r.openP2Cents > 0 || r.p2PendingCents > 0) && (
                          <p style={{ margin: "2px 0 0", fontFamily: FONT, fontSize: T.size.xs, color: r.openP2Cents > 0 ? T.tone.warn : "rgb(150,175,255)" }}>
                            keltaiset {fmtWin(r.p2Washed)}
                            {r.openP2Cents > 0 ? ` · siirrettävä ${fmtEurCents(r.openP2Cents)}` : ""}
                            {r.p2PendingCents > 0 ? ` · odottaa hyväksyntää ${fmtEurCents(r.p2PendingCents)}` : ""}
                          </p>
                        )}
                      </div>
                      {/* SIIRRETTÄVÄ = VAIN PUNAISET. Erän 4 rahoista siirretään
                          punaisten palkat; keltaiset odottavat oman laskunsa rahoja
                          ja näkyvät omana pienempänä rivinä alla. Aiemmin nämä
                          summattiin yhteen, jolloin luku ei vastannut sitä mitä
                          erästä oikeasti siirretään. */}
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <p style={{ margin: 0, fontFamily: MONO, fontSize: T.size.label, letterSpacing: "0.1em", color: T.text.faint }}>SIIRRETTÄVÄ · PUNAISET</p>
                        <p style={{ margin: "2px 0 0", fontFamily: FONT, fontSize: T.size.title, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: r.openP1Cents > 0 ? T.tone.warn : T.text.faint }}>
                          {fmtEurCents(r.openP1Cents)}
                        </p>
                        {r.openP2Cents > 0 && (
                          <p style={{ margin: "1px 0 0", fontFamily: FONT, fontSize: T.size.xs, color: T.text.faint, fontVariantNumeric: "tabular-nums" }}>
                            + keltaiset {fmtEurCents(r.openP2Cents)}
                          </p>
                        )}
                      </div>
                    </div>
                    {/* Sovittu vähennys/lisä. Käytetään kun tekijän kanssa on
                        sovittu ettei koko summaa makseta (esim. yksi ikkuna jäi
                        kesken) — ilman tätä summa jäisi ikuisesti "siirrettävänä"
                        eikä sitä voisi kuitata pois. Peruttavissa. */}
                    {onSetAdjustment && (
                      <AdjustmentControl
                        name={r.name}
                        cents={r.p1AdjustmentCents}
                        onSave={(c) => onSetAdjustment(r.workerId, c)}
                      />
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ── 3. Johtajien väliset laskut (kohta 3C:n tulokset) */}
          <SectionTitle icon={<Wallet style={{ width: 15, height: 15, color: T.text.secondary }} />}>
            Johtajien väliset laskut
          </SectionTitle>
          {s.founderInvoices.length === 0 ? (
            <div style={card}>
              <p style={{ margin: 0, fontFamily: FONT, fontSize: T.size.sm, color: T.text.muted }}>
                Ei vielä johtajien välisiä laskuja.
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: T.space.sm + 2 }}>
              {s.founderInvoices.map((inv) => {
                const computed = inv.rivit?.computed;
                return (
                  <div key={inv.id} style={card}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: T.space.sm + 2, flexWrap: "wrap" }}>
                      <div style={{ minWidth: 0 }}>
                        <p style={{ margin: 0, fontFamily: FONT, fontSize: T.size.body, fontWeight: 700, color: T.text.primary }}>
                          {founderName(inv.senderId)} → {founderName(inv.recipientId)}
                        </p>
                        <p style={{ margin: "2px 0 0", fontFamily: FONT, fontSize: T.size.sm, color: T.text.muted }}>
                          {eraLabel(inv.eraNumbers)} · {fiDate(inv.sentAt)}
                          {inv.invoiceNumber ? <> · <span style={{ fontFamily: MONO }}>{inv.invoiceNumber}</span></> : null}
                          {inv.referenceNumber ? <> · viite <span style={{ fontFamily: MONO }}>{inv.referenceNumber}</span></> : null}
                        </p>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: T.space.sm + 2 }}>
                        <TilaChip tila={inv.tila} />
                        <span style={{ fontFamily: FONT, fontSize: T.size.title, fontWeight: 700, color: T.tone.good, fontVariantNumeric: "tabular-nums" }}>
                          {fmtEurCents(inv.totalCents)}
                        </span>
                      </div>
                    </div>
                    {computed && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: `${T.space.xs}px ${T.space.lg + 2}px`, marginTop: T.space.sm + 2, paddingTop: T.space.sm + 2, borderTop: T.border.divider }}>
                        {([
                          ["S (erän summa)", fmtEurCents(computed.totalCents)],
                          ["x €/ikkuna", inv.xCents != null ? fmtEurCents(inv.xCents) : "—"],
                          ["Kate", inv.kateCents != null ? fmtEurCents(inv.kateCents) : "—"],
                          ["Kate / 2", inv.katePerJohtajaCents != null ? fmtEurCents(inv.katePerJohtajaCents) : "—"],
                          ...(inv.manualAdjustmentCents ? [["Vapaa muokkaus", (inv.manualAdjustmentCents > 0 ? "+" : "−") + fmtEurCents(Math.abs(inv.manualAdjustmentCents))]] : []),
                        ] as [string, string][]).map(([lbl, val]) => (
                          <span key={lbl} style={{ fontFamily: FONT, fontSize: T.size.xs, color: T.text.muted }}>
                            {lbl}: <strong style={{ color: T.text.secondary, fontVariantNumeric: "tabular-nums" }}>{val}</strong>
                          </span>
                        ))}
                      </div>
                    )}
                    <EmailCopies inv={inv} />
                    <DownloadPdfButton jobId={jobId} invoiceId={inv.id} />
                  </div>
                );
              })}
            </div>
          )}

          {/* ── 4. Kaikki tekijöille lähetetyt maksut (kohta 3A:n luonnokset + tilat) */}
          <SectionTitle icon={<Users style={{ width: 15, height: 15, color: T.text.secondary }} />}>
            Tekijöille lähetetyt maksut
          </SectionTitle>
          {s.workerInvoices.length === 0 ? (
            <div style={card}>
              <p style={{ margin: 0, fontFamily: FONT, fontSize: T.size.sm, color: T.text.muted }}>
                Ei vielä tekijöille lähetettyjä maksuja.
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: T.space.sm }}>
              {s.workerInvoices.map((inv) => {
                const input = inv.rivit?.input || {};
                const ikkunat = Number(input.pestytIkkunat) || 0;
                const sovittu = Number(input.sovittuMuutosCents) || 0;
                const ennakko = Number(input.ennakkoCents) || 0;
                return (
                  <div key={inv.id} style={{ ...card, padding: `${T.space.md}px ${T.space.lg}px` }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: T.space.sm + 2, flexWrap: "wrap" }}>
                      <div style={{ minWidth: 0 }}>
                        <p style={{ margin: 0, fontFamily: FONT, fontSize: T.size.sm, fontWeight: 700, color: T.text.primary }}>
                          {input.name || inv.senderId}
                          <span style={{ fontWeight: 500, color: T.text.muted }}> → {founderName(inv.recipientId)}</span>
                        </p>
                        <p style={{ margin: "2px 0 0", fontFamily: FONT, fontSize: T.size.xs, color: T.text.muted }}>
                          {eraLabel(inv.eraNumbers)} · {ikkunat.toLocaleString("fi-FI", { maximumFractionDigits: 1 })} ikkunaa
                          {sovittu !== 0 ? ` · sovittu muutos ${sovittu > 0 ? "+" : "−"}${fmtEurCents(Math.abs(sovittu))}` : ""}
                          {ennakko > 0 ? ` · ennakko ${fmtEurCents(ennakko)}` : ""}
                          {" · luotu "}{fiDate(inv.createdAt)}
                        </p>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: T.space.sm + 2 }}>
                        <TilaChip tila={inv.tila} />
                        <span style={{ fontFamily: FONT, fontSize: T.size.lg, fontWeight: 700, color: inv.tila === "hylätty" ? T.text.faint : T.tone.good, fontVariantNumeric: "tabular-nums", textDecoration: inv.tila === "hylätty" ? "line-through" : undefined }}>
                          {fmtEurCents(inv.totalCents)}
                        </span>
                      </div>
                    </div>
                    {/* MITÄTÖITY LASKU ON YHÄ TOSITE.
                        Rivi ei koskaan katoa kannasta (mitätöinti on tilamuutos,
                        ei poisto) ja PDF regeneroituu siitä milloin tahansa —
                        mutta latausnappi puuttui tästä osiosta kokonaan, joten
                        lähetetyn ja sitten mitätöidyn laskun tositteeseen ei
                        päässyt käsiksi mistään. Kirjanpitolaki vaatii tositteen
                        säilyttämisen 6 vuotta, joten sen pitää myös löytyä.

                        Näytetään PDF vain kun lasku on oikeasti ollut lähetetty
                        (laskunumero annettu). Tekijän hylkäämä LUONNOS ei ole
                        tosite eikä siitä ole PDF:ää. */}
                    {(inv.tila !== "hylätty" || inv.invoiceNumber) && (
                      <div style={{ marginTop: T.space.sm, paddingTop: T.space.sm, borderTop: T.border.divider, display: "flex", alignItems: "center", gap: T.space.sm + 2, flexWrap: "wrap" }}>
                        {inv.invoiceNumber && <DownloadPdfButton jobId={jobId} invoiceId={inv.id} />}
                        {inv.tila !== "hylätty" && (
                          <VoidInvoiceButton jobId={jobId} invoiceId={inv.id} name={input.name || inv.senderId} onDone={load} />
                        )}
                        {inv.tila === "hylätty" && inv.invoiceNumber && (
                          <span style={{ fontFamily: FONT, fontSize: T.size.xs, color: T.text.faint }}>
                            Mitätöity · lasku {inv.invoiceNumber} säilyy tositteena
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── 5. Tekijöiden kuittaamat laskut (kohta 3D kolmas luetelmakohta) */}
          <SectionTitle icon={<CheckCircle2 style={{ width: 15, height: 15, color: T.text.secondary }} />}>
            Tekijöiden kuittaamat laskut
          </SectionTitle>
          {s.workerAccepted.length === 0 ? (
            <div style={card}>
              <p style={{ margin: 0, fontFamily: FONT, fontSize: T.size.sm, color: T.text.muted }}>
                Yksikään tekijä ei ole vielä lähettänyt laskuaan.
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: T.space.sm }}>
              {s.workerAccepted.map((inv) => (
                <div key={inv.id} style={{ ...card, padding: `${T.space.md}px ${T.space.lg}px` }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: T.space.sm + 2, flexWrap: "wrap" }}>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ margin: 0, fontFamily: FONT, fontSize: T.size.sm, fontWeight: 700, color: T.text.primary }}>
                        {inv.rivit?.input?.name || inv.senderId}
                      </p>
                      <p style={{ margin: "2px 0 0", fontFamily: FONT, fontSize: T.size.xs, color: T.text.muted }}>
                        {eraLabel(inv.eraNumbers)} · lähetetty {fiDate(inv.sentAt)}
                        {inv.invoiceNumber ? <> · <span style={{ fontFamily: MONO }}>{inv.invoiceNumber}</span></> : null}
                        {inv.referenceNumber ? <> · viite <span style={{ fontFamily: MONO }}>{inv.referenceNumber}</span></> : null}
                      </p>
                    </div>
                    <span style={{ fontFamily: FONT, fontSize: T.size.lg, fontWeight: 700, color: T.tone.good, fontVariantNumeric: "tabular-nums" }}>
                      {fmtEurCents(inv.totalCents)}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: T.space.sm + 2, flexWrap: "wrap" }}>
                    <DownloadPdfButton jobId={jobId} invoiceId={inv.id} />
                    <VoidInvoiceButton jobId={jobId} invoiceId={inv.id} name={inv.rivit?.input?.name || inv.senderId} onDone={load} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
