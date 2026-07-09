/**
 * FR8 erälaskutus — "Maksut"-kokonaistilannesivu (kohta 3D).
 *
 * Projektinäkymän kolmas välilehti (vain johtajille, ks. Navbar.showMaksutTab):
 *  1. Johtajien väliset laskut (lähetetyt ristiinlaskut, kohta 3C).
 *  2. KAIKKI tekijöille lähetetyt maksut tiloineen (luonnos = odottaa tekijää,
 *     hyväksytty = tekijä lähettänyt, hylätty).
 *  3. Tekijöiden kuittaamat laskut (hyväksytyt — laskunumero + viite + pvm).
 * Jokaisen johtaja-välisen laskun kohdalla näytetään sähköpostikopioiden tila
 * (sähköposti_loki) — rivit syntyvät vaiheesta 4 alkaen.
 */
import { useCallback, useEffect, useState } from "react";
import { api, type EraInvoiceClient } from "@/lib/api";
import { summarizeEraInvoices } from "@shared/era-billing";
import { fmtEurCents } from "@shared/tax";
import { BRAND_BILLERS } from "@shared/billers";
import { RefreshCw, Wallet, Users, CheckCircle2, Mail } from "lucide-react";

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
  return nums.length === 1 ? `Erä ${nums[0]}` : `Erät ${nums[0]}–${nums[nums.length - 1]}`;
}

function fiDate(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString("fi-FI") : "—";
}

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

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "26px 0 10px" }}>
      {icon}
      <h2 style={{ margin: 0, fontFamily: FONT, fontSize: 15, fontWeight: 700, color: "#fff", letterSpacing: "0.01em" }}>{children}</h2>
    </div>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ ...card, flex: 1, minWidth: 150 }}>
      <p style={{ margin: 0, fontFamily: MONO, fontSize: 10, letterSpacing: "0.1em", color: "rgba(255,255,255,0.45)", textTransform: "uppercase" }}>{label}</p>
      <p style={{ margin: "6px 0 0", fontFamily: FONT, fontSize: 22, fontWeight: 800, color: "#fff", fontVariantNumeric: "tabular-nums" }}>{value}</p>
      {sub && <p style={{ margin: "2px 0 0", fontFamily: FONT, fontSize: 11.5, color: "rgba(255,255,255,0.5)" }}>{sub}</p>}
    </div>
  );
}

/** Sähköpostikopioiden tila johtaja-väliselle laskulle (kohta 3D viimeinen
 *  luetelmakohta). Loki alkaa täyttyä vaiheessa 4 — siihen asti kerrotaan
 *  rehellisesti ettei kopioita ole vielä lähetetty. */
function EmailCopies({ inv }: { inv: EraInvoiceClient }) {
  const emails = inv.emails || [];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
      <Mail style={{ width: 12, height: 12, color: "rgba(255,255,255,0.35)", flexShrink: 0 }} />
      {emails.length === 0 ? (
        <span style={{ fontFamily: FONT, fontSize: 11.5, color: "rgba(255,255,255,0.4)" }}>
          Ei sähköpostikopioita vielä — automaattinen lähetys molemmille johtajille tulee vaiheessa 4.
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

export default function MaksutView({ jobId }: { jobId: number }) {
  const [invoices, setInvoices] = useState<EraInvoiceClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api.getEraInvoices(jobId);
    if (res.ok && res.data) { setInvoices(res.data.invoices); setErr(null); }
    else setErr(res.error || "Lataus epäonnistui");
    setLoading(false);
  }, [jobId]);

  useEffect(() => { void load(); }, [load]);

  const s = summarizeEraInvoices(invoices);

  return (
    <div style={{ height: "100%", overflowY: "auto", WebkitOverflowScrolling: "touch", padding: "20px 16px 40px", maxWidth: 860, margin: "0 auto", width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontFamily: FONT, fontSize: 20, fontWeight: 800, color: "#fff" }}>Maksut — kokonaistilanne</h1>
          <p style={{ margin: "4px 0 0", fontFamily: FONT, fontSize: 12.5, color: "rgba(255,255,255,0.5)" }}>
            FR8-erälaskutus: johtajien väliset laskut ja tekijöille lähetetyt maksut tiloineen.
          </p>
        </div>
        <button onClick={() => { setLoading(true); void load(); }} title="Päivitä"
          style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, padding: "8px 12px", borderRadius: 10, cursor: "pointer", border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.75)", fontFamily: FONT, fontSize: 12, fontWeight: 600 }}>
          <RefreshCw style={{ width: 13, height: 13 }} /> Päivitä
        </button>
      </div>

      {loading && <p style={{ fontFamily: FONT, fontSize: 13, color: "rgba(255,255,255,0.5)", marginTop: 24 }}>Ladataan…</p>}
      {err && !loading && (
        <div style={{ ...card, marginTop: 20, borderColor: "rgba(224,59,59,0.4)" }}>
          <p style={{ margin: 0, fontFamily: FONT, fontSize: 13, color: "#ff8a8a" }}>{err}</p>
        </div>
      )}

      {!loading && !err && (
        <>
          {/* Yhteenveto */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 18 }}>
            <StatTile label="Johtajien väliset" value={fmtEurCents(s.founderSumCents)} sub={`${s.founderInvoices.length} laskua`} />
            <StatTile label="Odottaa tekijää" value={fmtEurCents(s.workerPendingSumCents)} sub={`${s.workerPending.length} maksua`} />
            <StatTile label="Tekijät kuitanneet" value={fmtEurCents(s.workerAcceptedSumCents)} sub={`${s.workerAccepted.length} laskua`} />
          </div>

          {/* 1. Johtajien väliset laskut (kohta 3C:n tulokset) */}
          <SectionTitle icon={<Wallet style={{ width: 15, height: 15, color: "rgba(255,255,255,0.6)" }} />}>
            Johtajien väliset laskut
          </SectionTitle>
          {s.founderInvoices.length === 0 ? (
            <div style={card}>
              <p style={{ margin: 0, fontFamily: FONT, fontSize: 12.5, color: "rgba(255,255,255,0.5)" }}>
                Ei vielä johtajien välisiä laskuja. Lasku luodaan Tiimi-sivulla toisen johtajan rivin "Maksut"-painikkeesta.
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
                  </div>
                );
              })}
            </div>
          )}

          {/* 2. Kaikki tekijöille lähetetyt maksut (kohta 3A:n luonnokset + tilat) */}
          <SectionTitle icon={<Users style={{ width: 15, height: 15, color: "rgba(255,255,255,0.6)" }} />}>
            Tekijöille lähetetyt maksut
          </SectionTitle>
          {s.workerInvoices.length === 0 ? (
            <div style={card}>
              <p style={{ margin: 0, fontFamily: FONT, fontSize: 12.5, color: "rgba(255,255,255,0.5)" }}>
                Ei vielä tekijöille lähetettyjä maksuja. Maksu luodaan Kokonaistilanne-välilehden "Maksu"-painikkeesta.
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

          {/* 3. Tekijöiden kuittaamat laskut (kohta 3D kolmas luetelmakohta) */}
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
                <div key={inv.id} style={{ ...card, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
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
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
