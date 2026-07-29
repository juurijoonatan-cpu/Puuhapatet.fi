/**
 * FR8 — "Maksut": KAIKKI keikan rahaliikenne yhdessä paikassa.
 *
 * Projektinäkymän kolmas välilehti (vain johtajille, ks. Navbar.showMaksutTab).
 * Järjestys on tarkoituksella "mitä minun pitää tehdä" → "mitä on tehty":
 *
 *  0. ASIAKKAALTA — punaisten 4 erää + keltaisten laskutus (vain tilannekuva;
 *     laskun lähetys tapahtuu keikkanäkymän Laskutus-kortissa, ei täällä).
 *  1. TEKIJÖILLE MAKSETTAVAA — per tekijä: punaisista ansaittu, hoidettu ja
 *     **vielä siirtämättä**, + "Maksa tekijöille" -toiminto. Tämä on se näkymä
 *     jonka perustaja avaa saatuaan erän rahat tilille. Keltaiset näkyvät omana
 *     rivinä, koska niitä EI makseta ennen kuin asiakas on maksanut ne.
 *  2. Johtajien väliset laskut.
 *  3. Tekijöille lähetetyt maksut tiloineen + kuittaukset.
 *
 * Kaikki summat tulevat jaetusta `shared/worker-payouts.ts`:stä — sama laskenta
 * kuin Tiimi-sivun palkkayhteenvedossa ja maksudialogin esitäytössä.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type EraInvoiceClient } from "@/lib/api";
import { summarizeEraInvoices } from "@shared/era-billing";
import {
  computeWorkerSettlements, eraSettlementByWorker, sumWorkerSettlements,
} from "@shared/worker-payouts";
import type { ProjectData } from "@shared/project";
import { fmtEurCents } from "@shared/tax";
import { BRAND_BILLERS } from "@shared/billers";
import { RefreshCw, Wallet, Users, CheckCircle2, Mail, FileDown, Receipt, HandCoins } from "lucide-react";
import SendInvoiceEmailDialog from "./SendInvoiceEmailDialog";
import WorkerEraInvoiceDialog from "./WorkerEraInvoiceDialog";

const FONT = "var(--font-onest, system-ui, sans-serif)";
const MONO = "var(--font-jetbrains-mono, monospace)";

const card: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 16,
  padding: 16,
};

function founderName(id: string): string {
  return BRAND_BILLERS.find((b) => b.id === id)?.name || id;
}

function eraLabel(nums: number[]): string {
  if (nums.length === 0) return "Erä —";
  return nums.length === 1 ? `Erä ${nums[0]}` : `Erät ${nums[0]}–${nums[nums.length - 1]}`;
}

function fiDate(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString("fi-FI") : "—";
}

const fmtWin = (n: number) => n.toLocaleString("fi-FI", { maximumFractionDigits: 1 });

const TILA_CHIP: Record<string, { label: string; color: string; bg: string }> = {
  luonnos: { label: "Odottaa tekijää", color: "#ffce28", bg: "rgba(255,206,40,0.12)" },
  "lähetetty": { label: "Lähetetty · lukittu", color: "#5fe08a", bg: "rgba(95,224,138,0.12)" },
  "hyväksytty": { label: "Tekijä lähettänyt ✓", color: "#5fe08a", bg: "rgba(95,224,138,0.12)" },
  "hylätty": { label: "Hylätty", color: "#ff8a8a", bg: "rgba(224,59,59,0.14)" },
};

function TilaChip({ tila }: { tila: string }) {
  const c = TILA_CHIP[tila] || TILA_CHIP.luonnos;
  return (
    <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, fontFamily: FONT, color: c.color, background: c.bg, borderRadius: 999, padding: "4px 10px", whiteSpace: "nowrap" }}>
      {c.label}
    </span>
  );
}

function SectionTitle({ icon, children, right }: { icon: React.ReactNode; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "26px 0 10px" }}>
      {icon}
      <h2 style={{ margin: 0, fontFamily: FONT, fontSize: 15, fontWeight: 700, color: "#fff", letterSpacing: "0.01em" }}>{children}</h2>
      {right && <span style={{ marginLeft: "auto", flexShrink: 0 }}>{right}</span>}
    </div>
  );
}

function StatTile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div style={{ ...card, flex: 1, minWidth: 150 }}>
      <p style={{ margin: 0, fontFamily: MONO, fontSize: 10, letterSpacing: "0.1em", color: "rgba(255,255,255,0.45)", textTransform: "uppercase" }}>{label}</p>
      <p style={{ margin: "6px 0 0", fontFamily: FONT, fontSize: 22, fontWeight: 800, color: tone || "#fff", fontVariantNumeric: "tabular-nums" }}>{value}</p>
      {sub && <p style={{ margin: "2px 0 0", fontFamily: FONT, fontSize: 11.5, color: "rgba(255,255,255,0.5)" }}>{sub}</p>}
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
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
      <Mail style={{ width: 12, height: 12, color: "rgba(255,255,255,0.35)", flexShrink: 0 }} />
      {emails.length === 0 ? (
        <span style={{ fontFamily: FONT, fontSize: 11.5, color: "rgba(255,255,255,0.4)" }}>
          {inv.tila === "luonnos" ? "Ei vielä lähetetty — odottaa tekijää." : "Ei sähköpostikopioita (RESEND_API_KEY puuttuu tässä ympäristössä?)."}
        </span>
      ) : (
        <span style={{ fontFamily: FONT, fontSize: 11.5, color: "rgba(255,255,255,0.55)" }}>
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
      style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 8, padding: "5px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.75)", fontFamily: FONT, fontSize: 11, fontWeight: 600, cursor: "pointer", opacity: busy ? 0.5 : 1 }}>
      <FileDown style={{ width: 12, height: 12 }} /> {busy ? "Avataan…" : "Lataa PDF"}
    </button>
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

export default function MaksutView({ jobId, project, billing, onOpenGig }: {
  jobId: number;
  /** Karttatila — tarvitaan tekijöiden maksettavan laskentaan. */
  project: ProjectData | null;
  /** Asiakaslaskutuksen tila serveriltä (GET /project → billing). */
  billing?: MaksutBilling | null;
  /** Hyppy keikkanäkymään, jossa asiakaslaskut lähetetään. */
  onOpenGig?: () => void;
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
    () => (project ? computeWorkerSettlements(project, { era: eraSettlementByWorker(invoices) }) : []),
    [project, invoices],
  );
  const payable = useMemo(() => settlements.filter((r) => r.active || r.earnedCents > 0), [settlements]);
  const totals = useMemo(() => sumWorkerSettlements(payable), [payable]);

  return (
    <div style={{ height: "100%", overflowY: "auto", WebkitOverflowScrolling: "touch", padding: "20px 16px 40px", maxWidth: 860, margin: "0 auto", width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontFamily: FONT, fontSize: 20, fontWeight: 800, color: "#fff" }}>Maksut</h1>
          <p style={{ margin: "4px 0 0", fontFamily: FONT, fontSize: 12.5, color: "rgba(255,255,255,0.5)" }}>
            Mitä asiakkaalta on laskutettu ja paljonko kullekin tekijälle pitää vielä siirtää.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <SendInvoiceEmailDialog />
          <button onClick={() => { setLoading(true); void load(); }} title="Päivitä"
            style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, padding: "8px 12px", borderRadius: 10, cursor: "pointer", border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.75)", fontFamily: FONT, fontSize: 12, fontWeight: 600 }}>
            <RefreshCw style={{ width: 13, height: 13 }} /> Päivitä
          </button>
        </div>
      </div>

      {loading && <p style={{ fontFamily: FONT, fontSize: 13, color: "rgba(255,255,255,0.5)", marginTop: 24 }}>Ladataan…</p>}
      {err && !loading && (
        <div style={{ ...card, marginTop: 20, borderColor: "rgba(224,59,59,0.4)" }}>
          <p style={{ margin: 0, fontFamily: FONT, fontSize: 13, color: "#ff8a8a" }}>{err}</p>
        </div>
      )}

      {!loading && !err && (
        <>
          {/* ── 0. ASIAKKAALTA — tilannekuva. Laskun lähetys on keikkanäkymässä,
                 ei tässä: sama toiminto ei ole kahdessa paikassa. */}
          {billing && (
            <>
              <SectionTitle
                icon={<Receipt style={{ width: 15, height: 15, color: "rgba(255,255,255,0.6)" }} />}
                right={onOpenGig ? (
                  <button onClick={onOpenGig}
                    style={{ padding: "6px 11px", borderRadius: 9, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.75)", fontFamily: FONT, fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}>
                    Lähetä lasku →
                  </button>
                ) : undefined}
              >
                Asiakkaalta laskutettu
              </SectionTitle>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                <StatTile
                  label="Punaiset (4 erää)"
                  value={fmtEurCents(billing.p1InvoicedCents)}
                  sub={`${Math.min(4, billing.p1PayCount)}/4 erää · sopimus ${fmtEurCents(billing.agreedTotalCents)}`}
                  tone="#5fe08a"
                />
                <StatTile
                  label="Punaisia jäljellä"
                  value={fmtEurCents(Math.max(0, billing.agreedTotalCents - billing.p1InvoicedCents))}
                  sub={billing.p1PayCount >= 4 ? "kaikki erät lähetetty ✓" : `seuraava erä ${fmtEurCents(billing.nextInstalmentCents)}`}
                />
                <StatTile
                  label="Keltaiset (2. vaihe)"
                  value={fmtEurCents(billing.p2InvoicedCents)}
                  sub={billing.p2RemainingCents > 0 ? `laskuttamatta ${fmtEurCents(billing.p2RemainingCents)}` : "ei laskuttamatonta"}
                  tone={billing.p2InvoicedCents > 0 ? "#5fe08a" : undefined}
                />
              </div>
            </>
          )}

          {/* ── 1. TEKIJÖILLE MAKSETTAVAA — päänäkymä. */}
          <SectionTitle
            icon={<HandCoins style={{ width: 15, height: 15, color: "rgba(255,255,255,0.6)" }} />}
            right={payable.length > 0 ? <WorkerEraInvoiceDialog jobId={jobId} workers={payable} variant="button" onSent={() => void load()} /> : undefined}
          >
            Tekijöille maksettavaa
          </SectionTitle>
          {payable.length === 0 ? (
            <div style={card}>
              <p style={{ margin: 0, fontFamily: FONT, fontSize: 12.5, color: "rgba(255,255,255,0.5)" }}>
                Ei tekijöitä tällä keikalla. Lisää tekijät Tiimi-sivulla.
              </p>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
                <StatTile label="Punaisista ansaittu" value={fmtEurCents(totals.p1EarnedCents)} sub={`${fmtWin(totals.p1Washed)} punaista ikkunaa`} />
                <StatTile label="Hoidettu" value={fmtEurCents(totals.settledCents)} sub={totals.eraPendingCents > 0 ? `+ ${fmtEurCents(totals.eraPendingCents)} odottaa kuittausta` : "maksut + erälaskut"} tone="#5fe08a" />
                <StatTile
                  label="Siirrettävä nyt"
                  value={fmtEurCents(totals.openP1Cents)}
                  sub={`${fmtWin(totals.openP1Windows)} ikkunaa maksamatta`}
                  tone={totals.openP1Cents > 0 ? "#ffce28" : "rgba(255,255,255,0.5)"}
                />
              </div>
              {/* Keltaiset ODOTTAVAT — tarkoituksella oma, korostettu rivi ettei
                  niitä vahingossa maksettaisi punaisten mukana. */}
              {totals.openP2Cents > 0 && (
                <div style={{ ...card, marginBottom: 12, borderColor: "rgba(255,206,40,0.3)", background: "rgba(255,206,40,0.06)" }}>
                  <p style={{ margin: 0, fontFamily: FONT, fontSize: 12.5, color: "rgba(255,220,140,0.95)", lineHeight: 1.55 }}>
                    <strong>Keltaisista odottaa {fmtEurCents(totals.openP2Cents)}</strong> ({fmtWin(totals.p2Washed)} ikkunaa).
                    Näitä ei makseta vielä — ne maksetaan omana eränään sen jälkeen kun asiakas on maksanut keltaisten
                    laskun. Yllä oleva "Siirrettävä nyt" sisältää vain punaiset.
                  </p>
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {payable.map((r) => (
                  <div key={r.workerId} style={{ ...card, padding: "12px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ minWidth: 0 }}>
                        <p style={{ margin: 0, fontFamily: FONT, fontSize: 13.5, fontWeight: 700, color: "#fff" }}>{r.name}</p>
                        <p style={{ margin: "2px 0 0", fontFamily: FONT, fontSize: 11.5, color: "rgba(255,255,255,0.5)" }}>
                          punaiset {fmtWin(r.p1Washed)} kpl · ansaittu {fmtEurCents(r.p1EarnedCents)} · hoidettu {fmtEurCents(r.settledCents)}
                          {r.eraPendingCents > 0 ? ` · odottaa kuittausta ${fmtEurCents(r.eraPendingCents)}` : ""}
                          {r.settledEras.length > 0 ? ` · erät ${r.settledEras.join(", ")}` : ""}
                        </p>
                        {r.openP2Cents > 0 && (
                          <p style={{ margin: "2px 0 0", fontFamily: FONT, fontSize: 11.5, color: "rgb(255,206,40)" }}>
                            keltaisista {fmtEurCents(r.openP2Cents)} ({fmtWin(r.p2Washed)} kpl) — odottaa keltaisten laskua
                          </p>
                        )}
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <p style={{ margin: 0, fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.1em", color: "rgba(255,255,255,0.4)" }}>SIIRRETTÄVÄ</p>
                        <p style={{ margin: "2px 0 0", fontFamily: FONT, fontSize: 17, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: r.openP1Cents > 0 ? "#ffce28" : "rgba(255,255,255,0.35)" }}>
                          {fmtEurCents(r.openP1Cents)}
                        </p>
                        {r.openP1Windows > 0 && (
                          <p style={{ margin: 0, fontFamily: FONT, fontSize: 11, color: "rgba(255,255,255,0.45)" }}>{fmtWin(r.openP1Windows)} ikkunaa</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ── 2. Johtajien väliset laskut (kohta 3C:n tulokset) */}
          <SectionTitle icon={<Wallet style={{ width: 15, height: 15, color: "rgba(255,255,255,0.6)" }} />}>
            Johtajien väliset laskut
          </SectionTitle>
          {s.founderInvoices.length === 0 ? (
            <div style={card}>
              <p style={{ margin: 0, fontFamily: FONT, fontSize: 12.5, color: "rgba(255,255,255,0.5)" }}>
                Ei vielä johtajien välisiä laskuja. Lasku luodaan Tilanne-välilehden "Perustajien ansiot" -osiossa
                toisen johtajan kortin Maksut-painikkeesta.
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {s.founderInvoices.map((inv) => {
                const computed = inv.rivit?.computed;
                return (
                  <div key={inv.id} style={card}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ minWidth: 0 }}>
                        <p style={{ margin: 0, fontFamily: FONT, fontSize: 14.5, fontWeight: 700, color: "#fff" }}>
                          {founderName(inv.senderId)} → {founderName(inv.recipientId)}
                        </p>
                        <p style={{ margin: "2px 0 0", fontFamily: FONT, fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
                          {eraLabel(inv.eraNumbers)} · {fiDate(inv.sentAt)}
                          {inv.invoiceNumber ? <> · <span style={{ fontFamily: MONO }}>{inv.invoiceNumber}</span></> : null}
                          {inv.referenceNumber ? <> · viite <span style={{ fontFamily: MONO }}>{inv.referenceNumber}</span></> : null}
                        </p>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <TilaChip tila={inv.tila} />
                        <span style={{ fontFamily: FONT, fontSize: 19, fontWeight: 800, color: "#5fe08a", fontVariantNumeric: "tabular-nums" }}>
                          {fmtEurCents(inv.totalCents)}
                        </span>
                      </div>
                    </div>
                    {computed && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 18px", marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                        {([
                          ["S (erän summa)", fmtEurCents(computed.totalCents)],
                          ["x €/ikkuna", inv.xCents != null ? fmtEurCents(inv.xCents) : "—"],
                          ["Kate", inv.kateCents != null ? fmtEurCents(inv.kateCents) : "—"],
                          ["Kate / 2", inv.katePerJohtajaCents != null ? fmtEurCents(inv.katePerJohtajaCents) : "—"],
                          ...(inv.manualAdjustmentCents ? [["Vapaa muokkaus", (inv.manualAdjustmentCents > 0 ? "+" : "−") + fmtEurCents(Math.abs(inv.manualAdjustmentCents))]] : []),
                        ] as [string, string][]).map(([lbl, val]) => (
                          <span key={lbl} style={{ fontFamily: FONT, fontSize: 11.5, color: "rgba(255,255,255,0.55)" }}>
                            {lbl}: <strong style={{ color: "rgba(255,255,255,0.85)", fontVariantNumeric: "tabular-nums" }}>{val}</strong>
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

          {/* ── 3. Kaikki tekijöille lähetetyt maksut (kohta 3A:n luonnokset + tilat) */}
          <SectionTitle icon={<Users style={{ width: 15, height: 15, color: "rgba(255,255,255,0.6)" }} />}>
            Tekijöille lähetetyt maksut
          </SectionTitle>
          {s.workerInvoices.length === 0 ? (
            <div style={card}>
              <p style={{ margin: 0, fontFamily: FONT, fontSize: 12.5, color: "rgba(255,255,255,0.5)" }}>
                Ei vielä tekijöille lähetettyjä maksuja. Luo maksu yllä olevasta "Maksa tekijöille" -painikkeesta.
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {s.workerInvoices.map((inv) => {
                const input = inv.rivit?.input || {};
                const ikkunat = Number(input.pestytIkkunat) || 0;
                const sovittu = Number(input.sovittuMuutosCents) || 0;
                const ennakko = Number(input.ennakkoCents) || 0;
                return (
                  <div key={inv.id} style={{ ...card, padding: "12px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ minWidth: 0 }}>
                        <p style={{ margin: 0, fontFamily: FONT, fontSize: 13.5, fontWeight: 700, color: "#fff" }}>
                          {input.name || inv.senderId}
                          <span style={{ fontWeight: 500, color: "rgba(255,255,255,0.5)" }}> → {founderName(inv.recipientId)}</span>
                        </p>
                        <p style={{ margin: "2px 0 0", fontFamily: FONT, fontSize: 11.5, color: "rgba(255,255,255,0.5)" }}>
                          {eraLabel(inv.eraNumbers)} · {ikkunat.toLocaleString("fi-FI", { maximumFractionDigits: 1 })} ikkunaa
                          {sovittu !== 0 ? ` · sovittu muutos ${sovittu > 0 ? "+" : "−"}${fmtEurCents(Math.abs(sovittu))}` : ""}
                          {ennakko > 0 ? ` · ennakko ${fmtEurCents(ennakko)}` : ""}
                          {" · luotu "}{fiDate(inv.createdAt)}
                        </p>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <TilaChip tila={inv.tila} />
                        <span style={{ fontFamily: FONT, fontSize: 16, fontWeight: 800, color: inv.tila === "hylätty" ? "rgba(255,255,255,0.35)" : "#5fe08a", fontVariantNumeric: "tabular-nums", textDecoration: inv.tila === "hylätty" ? "line-through" : undefined }}>
                          {fmtEurCents(inv.totalCents)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── 4. Tekijöiden kuittaamat laskut (kohta 3D kolmas luetelmakohta) */}
          <SectionTitle icon={<CheckCircle2 style={{ width: 15, height: 15, color: "rgba(255,255,255,0.6)" }} />}>
            Tekijöiden kuittaamat laskut
          </SectionTitle>
          {s.workerAccepted.length === 0 ? (
            <div style={card}>
              <p style={{ margin: 0, fontFamily: FONT, fontSize: 12.5, color: "rgba(255,255,255,0.5)" }}>
                Yksikään tekijä ei ole vielä lähettänyt laskuaan. Kuitatut laskut ilmestyvät tähän laskunumeroineen.
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {s.workerAccepted.map((inv) => (
                <div key={inv.id} style={{ ...card, padding: "12px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ margin: 0, fontFamily: FONT, fontSize: 13.5, fontWeight: 700, color: "#fff" }}>
                        {inv.rivit?.input?.name || inv.senderId}
                      </p>
                      <p style={{ margin: "2px 0 0", fontFamily: FONT, fontSize: 11.5, color: "rgba(255,255,255,0.5)" }}>
                        {eraLabel(inv.eraNumbers)} · lähetetty {fiDate(inv.sentAt)}
                        {inv.invoiceNumber ? <> · <span style={{ fontFamily: MONO }}>{inv.invoiceNumber}</span></> : null}
                        {inv.referenceNumber ? <> · viite <span style={{ fontFamily: MONO }}>{inv.referenceNumber}</span></> : null}
                      </p>
                    </div>
                    <span style={{ fontFamily: FONT, fontSize: 16, fontWeight: 800, color: "#5fe08a", fontVariantNumeric: "tabular-nums" }}>
                      {fmtEurCents(inv.totalCents)}
                    </span>
                  </div>
                  <DownloadPdfButton jobId={jobId} invoiceId={inv.id} />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
