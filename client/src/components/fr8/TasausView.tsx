/**
 * FR8 — JOHTAJIEN TASAUS.
 *
 * Vastaa yhteen kysymykseen: **paljonko toisen johtajan pitää siirtää toiselle,
 * jotta jako on oikeasti oikein.**
 *
 * Näkymä on kolme kerrosta, ylhäältä alas:
 *
 *   1. LOPPUTULOS — yksi iso luku ja suunta. Tämä on se mitä pankissa liikkuu.
 *      Summan voi asettaa käsin, jos johtajat ovat sopineet toisin.
 *   2. KUMMANKIN TILANNE — mitä kuuluu (ansainta) vs. mitä on käsissä (kassa).
 *      Erotus on syy siihen mitä ylhäällä lukee.
 *   3. MISTÄ LUVUT TULEVAT — jokainen asiakaserä ja jokainen tekijämaksu
 *      rivinä, ja kummallekin voi vaihtaa kuka SAI tai kuka MAKSOI. Juuri
 *      tämä puuttui: paperilla erä 1 on Joonatanin, oikeasti sen sai Matias.
 *
 * Kaikki laskenta tulee palvelimelta yhdestä jaetusta moottorista
 * (`@shared/founder-settlement` + `@shared/fr8-tasaus`) — tässä komponentissa
 * ei ole yhtään rahakaavaa, vain esitys ja kirjaus.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type TasausBundleClient } from "@/lib/api";
import { getAdminProfile } from "@/lib/admin-profile";
import { T, card, inset, mono, statLabel, subLabel, button, input as inputStyle, chip, eur, win } from "./tokens";
import { Scale, RefreshCw, Check, Undo2, Plus, Info, FileText } from "lucide-react";

type Bundle = TasausBundleClient;

/** Lyhyt etunimi tiiviisiin riveihin. */
const first = (name: string) => name.trim().split(/\s+/)[0] || name;

/** Euroteksti sentiksi. Hyväksyy pilkun ja pisteen. */
function parseEur(v: string): number | null {
  const n = Number(v.trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** Kenen nimissä raha on / kuka maksoi — pieni segmenttivalitsin.
 *  Kolmas vaihtoehto "—" poistaa kirjauksen ja palauttaa sen mitä lasku sanoo. */
function PayerPicker({ founders, value, fallback, onPick, disabled }: {
  founders: { id: string; name: string }[];
  /** Valittu arvo (käsin kirjattu tai laskusta johdettu). */
  value: string | null;
  /** Mitä lasku itse sanoo — näytetään "oletus"-vihjeenä. */
  fallback: string | null;
  onPick: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <span style={{ display: "inline-flex", gap: 4, flexShrink: 0 }}>
      {founders.map((f) => {
        const active = value === f.id;
        return (
          <button
            key={f.id}
            type="button"
            disabled={disabled}
            onClick={() => onPick(active ? "" : f.id)}
            title={fallback === f.id ? `${f.name} (laskun mukaan)` : f.name}
            style={{
              minHeight: 32,
              padding: "5px 10px",
              borderRadius: T.radius.sm,
              cursor: disabled ? "default" : "pointer",
              border: active ? `1px solid ${T.tone.goodBorder}` : T.border.subtle,
              background: active ? T.tone.goodBg : "transparent",
              color: active ? T.tone.goodSoft : T.text.faint,
              fontFamily: T.font,
              fontSize: T.size.xs,
              fontWeight: active ? 700 : 500,
              opacity: disabled ? 0.5 : 1,
            }}
          >
            {first(f.name)}
          </button>
        );
      })}
    </span>
  );
}

/** Rivi jossa on nimi + aputeksti vasemmalla ja summa oikealla. Käytetään
 *  kaikissa erittelyissä, jotta luvut ovat aina samassa sarakkeessa. */
function Line({ label, sub, value, tone, strong }: {
  label: string; sub?: string; value: string; tone?: string; strong?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: T.space.md }}>
      <span style={{ minWidth: 0, fontFamily: T.font, fontSize: T.size.sm, color: strong ? T.text.secondary : T.text.muted, fontWeight: strong ? 600 : 400 }}>
        {label}
        {sub && <span style={{ color: T.text.faint }}> · {sub}</span>}
      </span>
      <span style={{
        flexShrink: 0, fontFamily: T.font, fontSize: T.size.sm, fontWeight: strong ? 700 : 600,
        color: tone || (strong ? T.text.primary : T.text.secondary), fontVariantNumeric: "tabular-nums",
      }}>
        {value}
      </span>
    </div>
  );
}

/** Euromäärän syöttö + tallennus. Sivun sisäinen lomake, EI window.prompt:
 *  asennetussa iOS-PWA:ssa natiivi prompt on epäluotettava (ks. yleiskuvadoc). */
function AmountEditor({ label, initialCents, onSave, onClear, clearLabel, busy }: {
  label: string;
  initialCents: number;
  onSave: (cents: number) => void | Promise<void>;
  onClear?: () => void | Promise<void>;
  clearLabel?: string;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const start = () => { setValue(String(initialCents / 100).replace(".", ",")); setOpen(true); };
  const parsed = parseEur(value);
  const canSave = value.trim() !== "" && parsed != null && parsed >= 0;

  if (!open) {
    return (
      <span style={{ display: "inline-flex", gap: T.space.sm, flexWrap: "wrap" }}>
        <button type="button" onClick={start} style={button()}>{label}</button>
        {onClear && (
          <button type="button" onClick={() => void onClear()} disabled={busy}
            style={{ ...button(), background: "transparent", color: T.text.muted }}>
            <Undo2 style={{ width: 13, height: 13 }} /> {clearLabel ?? "Palauta laskettu"}
          </button>
        )}
      </span>
    );
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: T.space.sm, flexWrap: "wrap" }}>
      <input
        type="text" inputMode="decimal" autoFocus value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && canSave) { void onSave(parsed!); setOpen(false); } }}
        aria-label={label}
        style={{ ...inputStyle, width: 116, textAlign: "right" }}
      />
      <span style={{ fontFamily: T.font, fontSize: T.size.body, color: T.text.muted }}>€</span>
      <button type="button" disabled={!canSave || busy}
        onClick={() => { void onSave(parsed!); setOpen(false); }}
        style={{ ...button("accent"), opacity: canSave ? 1 : 0.4 }}>
        {busy ? "Tallennetaan…" : "Tallenna"}
      </button>
      <button type="button" onClick={() => setOpen(false)} style={{ ...button(), background: "transparent", color: T.text.muted }}>
        Peru
      </button>
    </span>
  );
}

/** Eräpäivän oletusehdotus: 14 vrk tästä hetkestä ("YYYY-MM-DD"). Sama käytäntö
 *  kuin muissakin FR8-laskuissa; johtaja voi aina vaihtaa sen. */
function defaultDueDate(): string {
  return new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

export default function TasausView({ jobId, canEdit = true }: {
  jobId: number;
  /** Vain perustaja voi kirjata. Muille näkymä on lukutilassa. */
  canEdit?: boolean;
}) {
  const [data, setData] = useState<Bundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  // Tasauslaskun lähetys: eräpäivä + vahvistus samassa paikassa kuin summa.
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [dueDate, setDueDate] = useState(defaultDueDate);
  const [invoiceDone, setInvoiceDone] = useState<string | null>(null);
  const me = getAdminProfile()?.id?.toLowerCase() ?? "";

  const load = useCallback(async () => {
    const res = await api.getTasaus(jobId);
    if (res.ok && res.data) { setData(res.data.tasaus); setErr(null); }
    else setErr(res.error || "Tasauksen lataus epäonnistui");
    setLoading(false);
  }, [jobId]);

  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async (patch: Parameters<typeof api.saveTasaus>[1]) => {
    setBusy(true);
    const res = await api.saveTasaus(jobId, patch);
    setBusy(false);
    if (res.ok && res.data?.tasaus) { setData(res.data.tasaus); setErr(null); }
    else setErr(res.error || "Tallennus epäonnistui");
  }, [jobId]);

  const nameOf = useCallback(
    (id: string | null | undefined) => data?.founders.find((f) => f.id === id)?.name ?? id ?? "—",
    [data],
  );

  // Erät ja maksut ryhmiteltyinä niin, että kirjaamattomat nousevat ylös —
  // ne ovat ainoa asia jonka johtajan pitää tässä näkymässä oikeasti tehdä.
  const eras = useMemo(
    () => [...(data?.eras ?? [])].sort((a, b) => Number(!!a.receivedById) - Number(!!b.receivedById)),
    [data],
  );
  const payouts = useMemo(
    () => [...(data?.payouts ?? [])].sort((a, b) => Number(!!a.paidById) - Number(!!b.paidById) || b.amountCents - a.amountCents),
    [data],
  );

  if (loading) {
    return <p style={{ fontFamily: T.font, fontSize: T.size.sm, color: T.text.muted, margin: 0 }}>Ladataan tasausta…</p>;
  }
  if (err && !data) {
    return (
      <div style={{ ...card, padding: T.space.lg, borderColor: T.tone.badBorder }}>
        <p style={{ margin: 0, fontFamily: T.font, fontSize: T.size.sm, color: T.tone.bad }}>{err}</p>
      </div>
    );
  }
  if (!data) return null;

  const { result, founders } = data;
  const transfer = result.transfer;
  const recorded = data.input.transfers ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: T.space.md }}>

      {/* ── 1. LOPPUTULOS ─────────────────────────────────────────────────── */}
      <div style={{
        ...card,
        padding: T.space.xl - 4,
        background: transfer
          ? "linear-gradient(155deg, rgba(255,206,40,0.10), rgba(255,255,255,0.02))"
          : "linear-gradient(155deg, rgba(95,224,138,0.10), rgba(255,255,255,0.02))",
        borderColor: transfer ? T.tone.warnBorder : T.tone.goodBorder,
      }}>
        <div style={{ ...mono, marginBottom: T.space.sm }}>
          {transfer ? "Siirrettävä johtajalta toiselle" : "Johtajien välit"}
        </div>
        {transfer ? (
          <>
            <div style={{
              fontFamily: T.font, fontSize: T.size.hero, fontWeight: 800, lineHeight: 1,
              letterSpacing: "-0.02em", color: T.tone.warn, fontVariantNumeric: "tabular-nums",
            }}>
              {eur(transfer.cents)}
            </div>
            <p style={{ margin: `${T.space.sm}px 0 0`, fontFamily: T.font, fontSize: T.size.body, color: T.text.secondary }}>
              <strong style={{ color: T.text.primary }}>{nameOf(transfer.fromId)}</strong>
              {" → "}
              <strong style={{ color: T.text.primary }}>{nameOf(transfer.toId)}</strong>
            </p>
          </>
        ) : (
          <>
            <div style={{
              fontFamily: T.font, fontSize: T.size.display, fontWeight: 800, lineHeight: 1.1, color: T.tone.good,
            }}>
              Tasan ✓
            </div>
            <p style={{ ...subLabel, marginTop: T.space.sm }}>
              Kummankaan ei tarvitse siirtää toiselle mitään.
            </p>
          </>
        )}

        {result.overridden && (
          <p style={{ margin: `${T.space.sm}px 0 0`, fontFamily: T.font, fontSize: T.size.xs, color: T.tone.warn }}>
            Käsin asetettu summa — laskettu olisi {result.grossTransfer ? eur(Math.max(0, result.grossTransfer.cents - result.alreadyTransferredCents)) : eur(0)}.
          </p>
        )}
        {!result.overridden && result.alreadyTransferredCents !== 0 && result.grossTransfer && (
          <p style={{ ...subLabel }}>
            Kokonaisero {eur(result.grossTransfer.cents)}
            {result.alreadyTransferredCents > 0
              ? ` · jo siirretty ${eur(result.alreadyTransferredCents)}`
              : ` · toiseen suuntaan on jo siirretty ${eur(-result.alreadyTransferredCents)}`}
          </p>
        )}

        {canEdit && (
          <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap", marginTop: T.space.lg }}>
            <AmountEditor
              label={result.overridden ? "Muuta summaa" : "Aseta summa käsin"}
              initialCents={transfer?.cents ?? 0}
              busy={busy}
              onSave={(cents) => save({ overrideCents: cents, overrideFromId: transfer?.fromId ?? founders[0]?.id })}
              onClear={result.overridden ? () => save({ overrideCents: null }) : undefined}
            />
            {transfer && (
              <>
                <button type="button" disabled={busy} style={button("solid")}
                  onClick={() => save({ addTransfer: { fromId: transfer.fromId, toId: transfer.toId, cents: transfer.cents, note: "Kirjattu tasausnäkymästä" } })}>
                  <Check style={{ width: 14, height: 14 }} /> Merkitse siirretyksi
                </button>
                {/* LASKU TASAUKSESTA. Laskun lähettää se joka on saamassa
                    rahaa (velkoja), koska palvelin vaatii että lähettäjä on
                    kirjautunut johtaja itse. Jos katsoja on maksava osapuoli,
                    hänelle kerrotaan kumpi laskun lähettää — nappi ei jää
                    näyttämään siltä ettei se tee mitään. */}
                {me === transfer.toId ? (
                  <button type="button" style={button()} onClick={() => setInvoiceOpen((v) => !v)}>
                    <FileText style={{ width: 14, height: 14 }} /> Tee lasku tästä
                  </button>
                ) : (
                  // Oma rivinsä (flexBasis 100 %): nappirivin sisällä tämä
                  // näytti tyhjältä napilta kahden napin välissä.
                  <span style={{ ...subLabel, flexBasis: "100%", margin: 0 }}>
                    Laskun lähettää {nameOf(transfer.toId)}.
                  </span>
                )}
              </>
            )}
            {transfer && (
              <button type="button" disabled={busy} style={{ ...button(), background: "transparent", color: T.text.muted }}
                onClick={() => save({ overrideCents: 0 })}>
                Ei siirtoa
              </button>
            )}
          </div>
        )}

        {/* Laskulomake — auki vain kun velkoja itse on avannut sen. */}
        {canEdit && transfer && invoiceOpen && me === transfer.toId && (
          <div style={{ marginTop: T.space.lg, paddingTop: T.space.lg, borderTop: T.border.divider }}>
            {invoiceDone ? (
              <p style={{ margin: 0, fontFamily: T.font, fontSize: T.size.sm, color: T.tone.goodSoft }}>
                <Check style={{ width: 14, height: 14, display: "inline", verticalAlign: -2, marginRight: 5 }} />
                Lasku {invoiceDone} lähetetty ja lukittu · {eur(transfer.cents)} → {nameOf(transfer.fromId)}
              </p>
            ) : (
              <div style={{ display: "flex", alignItems: "flex-end", gap: T.space.sm, flexWrap: "wrap" }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontFamily: T.font, fontSize: T.size.xs, color: T.text.muted }}>Eräpäivä</span>
                  <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
                    style={{ ...inputStyle, fontWeight: 500 }} />
                </label>
                <button
                  type="button"
                  disabled={busy}
                  style={button("solid")}
                  onClick={async () => {
                    setBusy(true);
                    const res = await api.sendFounderEraInvoice(jobId, {
                      kind: "tasaus",
                      settlementCents: transfer.cents,
                      recipientId: transfer.fromId,
                      senderId: transfer.toId,
                      // Erävalinta on tasauslaskulla vain otsikko — summa ja
                      // suunta tulevat tasauksesta, eivät tästä.
                      eraNumbers: [1, 2, 3],
                      itsepestytIkkunat: 0, kokonaisikkunat: 0, totalCents: transfer.cents,
                      dueDate,
                    });
                    setBusy(false);
                    if (res.ok && res.data) {
                      setInvoiceDone(res.data.invoice.invoiceNumber || `#${res.data.invoice.id}`);
                      setErr(null);
                    } else {
                      setErr(res.error || "Laskun lähetys epäonnistui");
                    }
                  }}
                >
                  {busy ? "Lähetetään…" : `Lähetä lasku ${eur(transfer.cents)}`}
                </button>
                <button type="button" onClick={() => setInvoiceOpen(false)}
                  style={{ ...button(), background: "transparent", color: T.text.muted }}>
                  Peru
                </button>
              </div>
            )}
            <p style={{ ...subLabel }}>
              Lasku lukittuu heti ja kopio lähtee kummankin sähköpostiin. Se ei kirjaa maksua —
              merkitse siirto tehdyksi vasta kun raha on oikeasti liikkunut.
            </p>
          </div>
        )}
      </div>

      {/* Kirjaamatta olevat erät estävät oikean vastauksen — nosta se esiin,
          ei piiloon alaviitteeseen. */}
      {data.unassignedEraCount > 0 && (
        <div style={{ ...card, padding: T.space.md + 2, background: T.tone.warnBg, borderColor: T.tone.warnBorder }}>
          <p style={{ margin: 0, fontFamily: T.font, fontSize: T.size.sm, color: "rgba(255,225,150,0.95)", lineHeight: 1.5 }}>
            <strong>{data.unassignedEraCount}</strong>{" "}
            {data.unassignedEraCount === 1 ? "erällä" : "erällä"} ei ole merkintää siitä kuka rahat sai.
            Merkitse ne alta — muuten yllä oleva summa on väärä.
          </p>
        </div>
      )}
      {data.unattributedPaidCents > 0 && (
        <div style={{ ...card, padding: T.space.md + 2, background: T.tone.infoBg, borderColor: T.tone.infoBorder }}>
          <p style={{ margin: 0, fontFamily: T.font, fontSize: T.size.sm, color: "rgba(200,212,255,0.95)", lineHeight: 1.5 }}>
            Käsin kirjattuja tekijämaksuja <strong>{eur(data.unattributedPaidCents)}</strong> ilman maksajaa.
            Ne eivät ole kummankaan kassassa ennen kuin merkitset maksajan.
          </p>
        </div>
      )}

      {/* ── 2. KUMMANKIN TILANNE ──────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(260px, 1fr))`, gap: T.space.md }}>
        {result.rows.map((row) => {
          const owes = row.dueCents > 0;
          return (
            <div key={row.id} style={{ ...card, padding: T.space.lg + 2 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: T.space.sm, marginBottom: T.space.md }}>
                <span style={{ fontFamily: T.font, fontSize: T.size.title - 3, fontWeight: 700, color: T.text.primary }}>{row.name}</span>
                <span style={chip(
                  row.dueCents === 0 ? T.tone.goodSoft : owes ? T.tone.warn : T.tone.info,
                  row.dueCents === 0 ? T.tone.goodBg : owes ? T.tone.warnBg : T.tone.infoBg,
                )}>
                  {row.dueCents === 0 ? "tasan" : owes ? `maksaa ${eur(row.dueCents)}` : `saa ${eur(-row.dueCents)}`}
                </span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: T.space.xs + 1 }}>
                <Line label="Oma työ" sub={`${win(row.p1Windows)} punaista`} value={eur(row.ownWorkCents)} />
                {row.p2OwnCents !== 0 && <Line label="Omat keltaiset" value={eur(row.p2OwnCents)} tone={T.tone.warn} />}
                <Line label="Osuus katteesta" value={eur(row.kateShareCents)} />
                <div style={{ borderTop: T.border.divider, paddingTop: T.space.sm, marginTop: T.space.xs }}>
                  <Line label="Kuuluu yhteensä" value={eur(row.entitledCents)} strong />
                </div>
              </div>

              <div style={{ marginTop: T.space.md, paddingTop: T.space.md, borderTop: T.border.divider, display: "flex", flexDirection: "column", gap: T.space.xs + 1 }}>
                <Line label="Asiakkaalta saatu" value={eur(row.receivedCents)} tone={T.tone.goodSoft} />
                <Line label="Tekijöille maksettu" value={`−${eur(row.paidOutCents)}`} />
                {row.expensesCents !== 0 && <Line label="Omat kulut" value={`−${eur(row.expensesCents)}`} />}
                <div style={{ borderTop: T.border.divider, paddingTop: T.space.sm, marginTop: T.space.xs }}>
                  <Line label="Käsissä nyt" value={eur(row.holdsCents)} strong />
                </div>
              </div>

              {canEdit && (
                <div style={{ marginTop: T.space.md, paddingTop: T.space.md, borderTop: T.border.divider }}>
                  <AmountEditor
                    label={row.expensesCents ? "Muuta omia kuluja" : "Kirjaa omat kulut"}
                    initialCents={row.expensesCents}
                    busy={busy}
                    onSave={(cents) => save({ expensesCents: { [row.id]: cents } })}
                    onClear={row.expensesCents ? () => save({ expensesCents: { [row.id]: 0 } }) : undefined}
                    clearLabel="Poista"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Yhteenveto potista — miksi luvut ovat sen kokoisia kuin ovat. */}
      <div style={{ ...card, padding: T.space.lg }}>
        <div style={{ ...mono, marginBottom: T.space.md }}>Mistä jaettava koostuu</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: T.space.sm }}>
          {([
            ["Laskutettu", eur(data.input.p1PotCents + data.input.p2PotCents), T.text.primary],
            ["Tekijöiden palkat", `−${eur(data.input.workerP1EarnedCents + data.input.workerP2EarnedCents)}`, T.text.secondary],
            ["Jaettavaa", eur(result.distributableCents), T.tone.goodSoft],
            ["€ / punainen ikkuna", eur(result.xCents), T.text.primary],
          ] as [string, string, string][]).map(([label, value, tone]) => (
            <div key={label} style={inset}>
              <div style={statLabel}>{label}</div>
              <div style={{ fontFamily: T.font, fontSize: T.size.title - 2, fontWeight: 700, color: tone, fontVariantNumeric: "tabular-nums" }}>{value}</div>
            </div>
          ))}
        </div>
        <p style={{ ...subLabel, marginTop: T.space.md }}>
          {win(result.p1WindowsTotal)} pestyä punaista · kate {eur(result.founderKateCents)} jaetaan tasan
          {data.unattributedP1Windows > 0 ? ` · ${win(data.unattributedP1Windows)} ikkunaa ilman pesijää` : ""}
        </p>
        {result.reserveCents !== 0 && (
          <p style={{ margin: `${T.space.sm}px 0 0`, fontFamily: T.font, fontSize: T.size.xs, lineHeight: 1.5, color: T.tone.info }}>
            <Info style={{ width: 12, height: 12, display: "inline", verticalAlign: -2, marginRight: 4 }} />
            {/* Yksi rivi, ei kappaletta: luku + mitä se on. Selitys kuuluu
                dokumentaatioon, ei rahanäkymään. */}
            {result.reserveCents > 0
              ? <>Tekijöille kuuluvaa käsissä <strong>{eur(result.reserveCents)}</strong> · ei jaeta, kumpikin kantaa puolet</>
              : <>Laskutettu käsissä olevaa enemmän <strong>{eur(-result.reserveCents)}</strong> · siirto olettaa sen tulevan</>}
          </p>
        )}
      </div>

      {/* ── 3. MISTÄ LUVUT TULEVAT ────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setShowDetail((v) => !v)}
        aria-expanded={showDetail}
        style={{
          ...card, display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: T.space.md, width: "100%", padding: `${T.space.lg}px ${T.space.lg + 2}px`,
          cursor: "pointer", textAlign: "left", color: T.text.primary, fontFamily: T.font,
        }}
      >
        <span style={mono}>Mistä luvut tulevat</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: T.space.md, flexShrink: 0 }}>
          <span style={{ fontFamily: T.font, fontSize: T.size.sm, fontWeight: 600, color: T.text.secondary }}>
            {eras.length} erää · {payouts.length} maksua
          </span>
          <span aria-hidden style={{ color: T.text.faint, fontSize: T.size.label }}>{showDetail ? "▲" : "▾"}</span>
        </span>
      </button>

      {showDetail && (
        <>
          {/* Asiakkaalta saadut erät */}
          <div style={{ ...card, padding: T.space.lg }}>
            <div style={{ ...mono, marginBottom: T.space.md }}>Asiakkaalta — kuka sai rahat</div>
            {eras.length === 0 ? (
              <p style={{ ...subLabel, marginTop: 0 }}>Asiakkaalta ei ole vielä laskutettu mitään.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: T.space.sm }}>
                {eras.map((e) => (
                  <div key={e.index} style={{
                    ...inset,
                    borderColor: e.receivedById ? "rgba(255,255,255,0.06)" : T.tone.warnBorder,
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    gap: T.space.md, flexWrap: "wrap",
                  }}>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ fontFamily: T.font, fontSize: T.size.sm, fontWeight: 700, color: T.text.primary }}>
                        {e.label}
                      </span>
                      <span style={{ fontFamily: T.font, fontSize: T.size.xs, color: T.text.faint }}>
                        {e.dateMs ? ` · ${new Date(e.dateMs).toLocaleDateString("fi-FI")}` : ""}
                        {e.billerId ? ` · laskutti ${first(nameOf(e.billerId))}` : " · laskuttaja merkitsemättä"}
                        {e.overridden ? " · korjattu" : ""}
                      </span>
                    </span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: T.space.md, flexShrink: 0 }}>
                      <span style={{ fontFamily: T.font, fontSize: T.size.sm, fontWeight: 700, color: T.text.primary, fontVariantNumeric: "tabular-nums" }}>
                        {eur(e.amountCents)}
                      </span>
                      <PayerPicker
                        founders={founders}
                        value={e.receivedById}
                        fallback={e.billerId}
                        disabled={!canEdit || busy}
                        onPick={(id) => save({ receivedBy: { [String(e.index)]: id } })}
                      />
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Tekijöille maksetut */}
          <div style={{ ...card, padding: T.space.lg }}>
            <div style={{ ...mono, marginBottom: T.space.md }}>Tekijöille — kuka maksoi</div>
            {payouts.length === 0 ? (
              <p style={{ ...subLabel, marginTop: 0 }}>Tekijöille ei ole vielä maksettu mitään.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: T.space.sm }}>
                {payouts.map((p) => (
                  <div key={p.key} style={{
                    ...inset,
                    borderColor: p.paidById ? "rgba(255,255,255,0.06)" : T.tone.infoBorder,
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    gap: T.space.md, flexWrap: "wrap",
                  }}>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ fontFamily: T.font, fontSize: T.size.sm, fontWeight: 700, color: T.text.primary }}>
                        {p.workerName}
                      </span>
                      <span style={{ fontFamily: T.font, fontSize: T.size.xs, color: T.text.faint }}>
                        {p.scope === "p2" ? " · keltaiset" : p.eraNumbers.length ? ` · erät ${p.eraNumbers.join(", ")}` : ""}
                        {p.invoiceId == null ? " · käsin kirjattu" : ""}
                        {p.overridden ? " · korjattu" : ""}
                      </span>
                    </span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: T.space.md, flexShrink: 0 }}>
                      <span style={{ fontFamily: T.font, fontSize: T.size.sm, fontWeight: 700, color: T.text.primary, fontVariantNumeric: "tabular-nums" }}>
                        {eur(p.amountCents)}
                      </span>
                      <PayerPicker
                        founders={founders}
                        value={p.paidById}
                        fallback={p.recipientId}
                        disabled={!canEdit || busy}
                        onPick={(id) => save({ paidBy: { [p.key]: id } })}
                      />
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Kirjatut siirrot */}
          <div style={{ ...card, padding: T.space.lg }}>
            <div style={{ display: "flex", alignItems: "center", gap: T.space.sm, marginBottom: T.space.md }}>
              <span style={mono}>Jo tehdyt siirrot</span>
              {canEdit && founders.length >= 2 && (
                <span style={{ marginLeft: "auto" }}>
                  <AmountEditor
                    label="Kirjaa siirto"
                    initialCents={0}
                    busy={busy}
                    onSave={(cents) => save({
                      addTransfer: {
                        fromId: result.transfer?.fromId ?? founders[0].id,
                        toId: result.transfer?.toId ?? founders[1].id,
                        cents,
                      },
                    })}
                  />
                </span>
              )}
            </div>
            {recorded.length === 0 ? (
              <p style={{ ...subLabel, marginTop: 0 }}>
                Ei kirjattuja siirtoja. Kirjaa siirto kun raha on oikeasti liikkunut — silloin sitä ei
                lasketa toista kertaa.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: T.space.sm }}>
                {(data.input.transfers ?? []).map((t, i) => (
                  <div key={i} style={{ ...inset, display: "flex", alignItems: "center", justifyContent: "space-between", gap: T.space.md, flexWrap: "wrap" }}>
                    <span style={{ fontFamily: T.font, fontSize: T.size.sm, color: T.text.secondary }}>
                      {first(nameOf(t.fromId))} → {first(nameOf(t.toId))}
                    </span>
                    <span style={{ fontFamily: T.font, fontSize: T.size.sm, fontWeight: 700, color: T.tone.goodSoft, fontVariantNumeric: "tabular-nums" }}>
                      {eur(t.cents)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: T.space.sm, flexWrap: "wrap" }}>
        <button type="button" onClick={() => { setLoading(true); void load(); }} style={{ ...button(), background: "transparent", color: T.text.faint }}>
          <RefreshCw style={{ width: 13, height: 13 }} /> Päivitä
        </button>
        {err && <span style={{ fontFamily: T.font, fontSize: T.size.xs, color: T.tone.bad }}>{err}</span>}
      </div>
    </div>
  );
}

/** Ikoni-vientit pidetään käytössä, jotta osion otsikko voi käyttää samaa
 *  kuvaketta kuin Maksut-välilehden muut osiot. */
export { Scale as TasausIcon, Plus as TasausAddIcon };
