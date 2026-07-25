/**
 * P2 hinta-arviokysely tekijälle — "paljonko haluaisit tästä ikkunasta?"
 *
 * Perustaja hinnoittelee keltaisia ikkunoita pohjakuvasta; tekijä seisoo talossa
 * ja NÄKEE ikkunan. Tämä popup kysyy häneltä ikkuna kerrallaan:
 *
 *   • ei vielä hinnoiteltu → paljonko haluaisit saada tästä ikkunasta
 *   • jo hinnoiteltu       → "Tämä ikkuna on jo hinnoiteltu" + kyllä/ei
 *
 * Arvio on tekijän OMA palkkio, ei asiakashinta — tekijä ei näe asiakashintoja
 * missään vaiheessa (ks. docs/fr8-tyo-logiikka.md, rahan yksityisyys).
 *
 * Realismi on rakennettu sisään: jokainen summa mitataan keikan tavallista tasoa
 * (`referenceCents`) vasten ja liian korkea arvio saa varoituksen jo ennen
 * lähetystä — ja merkitään serverillä perustajille näkyväksi poikkeamaksi.
 */
import { useMemo, useRef, useState } from "react";
import type { P2AskItem, P2AskView } from "@/lib/api";

const FONT = "'Poppins', ui-sans-serif, system-ui, -apple-system, sans-serif";
const YELLOW = "rgb(255,205,40)";

function eur(cents: number): string {
  const v = cents / 100;
  return v.toLocaleString("fi-FI", {
    minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
    maximumFractionDigits: 2,
  }) + " €";
}

function floorName(floor: string): string {
  return floor === "K" ? "Kellari" : `${floor}. kerros`;
}

/** "3#12" → "3. kerros · ikkuna 12", "1#cab3" → "1. kerros · lisätty ikkuna". */
function windowLabel(key: string): string {
  const [floor, rest = ""] = key.split("#");
  return `${floorName(floor)} · ${rest.startsWith("c") ? "lisätty ikkuna" : `ikkuna ${rest}`}`;
}

/** Cents → a clean input string ("20", "17,50"). */
function centsToInput(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2).replace(".", ",");
}

function parseEuroInput(raw: string): number | null {
  const v = Number(raw.replace(",", "."));
  if (!Number.isFinite(v) || v <= 0) return null;
  return Math.round(v * 100);
}

/** Neljä nappia tämän keikan tavallisen tason ympärille, 0,50 € tarkkuudella. */
function presetsFor(referenceCents: number): number[] {
  const round = (c: number) => Math.max(50, Math.round(c / 50) * 50);
  return Array.from(new Set([0.75, 1, 1.25, 1.5].map((m) => round(referenceCents * m))));
}

/** Unanswered unpriced first (what the founders are waiting on), then unanswered
 *  priced, then everything already answered — so the queue always opens on real
 *  work but a worker can still scroll back and change their mind. */
function buildOrder(items: P2AskItem[], floor: string): string[] {
  const rank = (i: P2AskItem) => (i.mine ? 2 : i.priced ? 1 : 0);
  return items
    .filter((i) => floor === "all" || i.floor === floor)
    .slice()
    .sort((a, b) =>
      rank(a) - rank(b) ||
      a.floor.localeCompare(b.floor, "fi", { numeric: true }) ||
      a.key.localeCompare(b.key, "fi", { numeric: true }))
    .map((i) => i.key);
}

export interface P2EstimateSubmit {
  key: string;
  payoutCents?: number;
  vote?: "yes" | "no";
}

export default function P2EstimateModal({ ask, onSubmit, onClose, onShowOnMap }: {
  ask: P2AskView;
  onSubmit: (data: P2EstimateSubmit) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
  /** Jump the map to this floor (closes the popup) so the worker can find the dot. */
  onShowOnMap?: (floor: string) => void;
}) {
  const [showRules, setShowRules] = useState(true);
  const [floor, setFloor] = useState<string>("all");
  const [idx, setIdx] = useState(0);
  const [draft, setDraft] = useState("");
  const [declining, setDeclining] = useState(false);   // "Ei sovi" → mikä olisi reilu
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(0);

  // The queue order is frozen per floor selection: answering an item must not
  // reshuffle the list under the worker's thumb mid-tap.
  const itemsRef = useRef(ask.items);
  itemsRef.current = ask.items;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const order = useMemo(() => buildOrder(itemsRef.current, floor), [floor]);

  const floors = useMemo(
    () => Array.from(new Set(ask.items.map((i) => i.floor)))
      .sort((a, b) => a.localeCompare(b, "fi", { numeric: true })),
    [ask.items],
  );

  const item = ask.items.find((i) => i.key === order[idx]) ?? null;
  const ref = ask.referenceCents;
  const draftCents = parseEuroInput(draft);
  const overMax = draftCents != null && draftCents > ask.maxCents;
  const wayOver = draftCents != null && draftCents > ref * 2;
  const over = draftCents != null && !wayOver && draftCents > ref * 1.5;

  const resetCard = () => { setDraft(""); setDeclining(false); setErr(null); };
  const advance = () => { resetCard(); setIdx((n) => n + 1); };

  async function send(data: P2EstimateSubmit) {
    setBusy(true); setErr(null);
    const res = await onSubmit(data);
    setBusy(false);
    if (!res.ok) { setErr(res.error || "Arvion lähetys ei onnistunut"); return; }
    setSent((n) => n + 1);
    advance();
  }

  const card: React.CSSProperties = {
    padding: "14px 15px", borderRadius: 14,
    background: "rgba(255,255,255,0.045)", border: "1px solid rgba(255,255,255,0.09)",
  };
  const btn: React.CSSProperties = {
    padding: "11px 15px", borderRadius: 11, border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(255,255,255,0.06)", color: "#fff", fontFamily: FONT,
    fontSize: 13.5, fontWeight: 600, cursor: "pointer",
  };
  const primary: React.CSSProperties = {
    ...btn, border: "none", background: YELLOW, color: "#0a0a0c", fontWeight: 800,
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Hinta-arvio"
      style={{
        position: "fixed", inset: 0, zIndex: 90, display: "flex", alignItems: "flex-end",
        justifyContent: "center", background: "rgba(0,0,0,0.72)",
        backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", fontFamily: FONT,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          width: "min(100%, 480px)", maxHeight: "92vh", display: "flex", flexDirection: "column",
          background: "#0c0c0f", borderTop: `2px solid ${YELLOW}`,
          borderRadius: "18px 18px 0 0", boxShadow: "0 -20px 60px rgba(0,0,0,0.6)",
          padding: "16px 16px calc(16px + env(safe-area-inset-bottom))",
          overflowY: "auto", overscrollBehavior: "contain",
        }}
      >
        {/* Otsikkorivi */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 15.5, fontWeight: 800, color: "#fff" }}>
              Mitä tästä ikkunasta pitäisi maksaa?
            </p>
            <p style={{ margin: "3px 0 0", fontSize: 11.5, color: "rgba(255,255,255,0.5)" }}>
              {ask.pendingUnpriced > 0
                ? `${ask.pendingUnpriced} hinnoittelematonta ikkunaa odottaa arviotasi`
                : "Kaikki hinnoittelemattomat arvioitu — kiitos!"}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Sulje"
            data-testid="btn-close-p2-estimate"
            style={{ ...btn, padding: "6px 11px", fontSize: 13, color: "rgba(255,255,255,0.6)" }}
          >
            Sulje
          </button>
        </div>

        {showRules ? (
          /* ── Pelisäännöt: näytetään ennen ensimmäistä arviota ─────────────── */
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: "rgba(255,255,255,0.8)" }}>
              Sinä olet paikan päällä ja näet ikkunat — me hinnoittelemme niitä pohjakuvasta.
              Kävele rauhassa, katso pistettä kartalla ja kerro, <b style={{ color: "#fff" }}>paljonko
              haluaisit saada juuri siitä ikkunasta</b>.
            </p>
            <div style={{ ...card, background: "rgba(255,205,40,0.07)", border: `1px solid rgba(255,205,40,0.3)` }}>
              <p style={{ margin: "0 0 7px", fontSize: 12, fontWeight: 800, letterSpacing: "0.06em", color: YELLOW }}>
                OLE OPTIMISTINEN MUTTA REALISTINEN
              </p>
              <ul style={{ margin: 0, paddingLeft: 17, fontSize: 12.5, lineHeight: 1.65, color: "rgba(255,236,190,0.92)" }}>
                <li>Arvio on lupaus: hinta, jolla oikeasti teet sen ikkunan.</li>
                <li>Älä pyydä liikaa. Jokainen arvio vertautuu jo sovittuihin hintoihin ja muiden
                  tekijöiden arvioihin — <b>ylihinnoittelu näkyy meille heti</b>.</li>
                <li>Vaikea ikkuna saa maksaa enemmän. Kerro se summalla, älä varmuuden vuoksi -lisällä.</li>
              </ul>
            </div>
            <div style={{ ...card, display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 11.5, color: "rgba(255,255,255,0.5)" }}>Tavallinen taso tällä keikalla</span>
              <span style={{ marginLeft: "auto", fontSize: 17, fontWeight: 800, color: "#7CE0A6", fontVariantNumeric: "tabular-nums" }}>
                {eur(ref)}
              </span>
              <span style={{ fontSize: 11.5, color: "rgba(255,255,255,0.5)" }}>/ ikkuna</span>
            </div>
            <button onClick={() => setShowRules(false)} style={primary} data-testid="btn-start-p2-estimate">
              Selvä — aloitetaan
            </button>
          </div>
        ) : !item ? (
          /* ── Jono käyty läpi ──────────────────────────────────────────────── */
          <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "10px 0 4px" }}>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#fff" }}>
              {sent > 0 ? `Kiitos — ${sent} arvio${sent === 1 ? "" : "ta"} lähetetty.` : "Ei arvioitavaa juuri nyt."}
            </p>
            <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, color: "rgba(255,255,255,0.6)" }}>
              Arviosi menevät suoraan hinnoitteluun. Voit palata tähän milloin vain työpöydältä.
            </p>
            {floor !== "all" && (
              <button onClick={() => { setFloor("all"); setIdx(0); resetCard(); }} style={btn}>
                Näytä kaikki kerrokset
              </button>
            )}
            <button onClick={onClose} style={primary}>Valmis</button>
          </div>
        ) : (
          /* ── Yksi ikkuna kerrallaan ───────────────────────────────────────── */
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

            {/* Kerrossuodatin — tekijä valitsee sen kerroksen jossa seisoo */}
            <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
              {["all", ...floors].map((f) => (
                <button
                  key={f}
                  onClick={() => { setFloor(f); setIdx(0); resetCard(); }}
                  style={{
                    ...btn, flexShrink: 0, padding: "6px 11px", fontSize: 12,
                    border: f === floor ? "none" : "1px solid rgba(255,255,255,0.14)",
                    background: f === floor ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.05)",
                    color: f === floor ? "#0a0a0c" : "rgba(255,255,255,0.7)",
                  }}
                >
                  {f === "all" ? "Kaikki" : f === "K" ? "Kellari" : `${f}. krs`}
                </button>
              ))}
            </div>

            {/* Ikkunan tunniste + eteneminen */}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#fff" }}>{windowLabel(item.key)}</p>
                <p style={{ margin: "2px 0 0", fontSize: 11, color: "rgba(255,255,255,0.45)", fontVariantNumeric: "tabular-nums" }}>
                  {idx + 1} / {order.length}{item.washed ? " · jo pesty" : ""}
                  {item.mine ? " · vastasit jo — voit muuttaa" : ""}
                </p>
              </div>
              {onShowOnMap && (
                <button
                  onClick={() => onShowOnMap(item.floor)}
                  style={{ ...btn, padding: "7px 11px", fontSize: 12 }}
                  data-testid="btn-p2-estimate-map"
                >
                  Näytä kartalla
                </button>
              )}
            </div>

            {item.priced ? (
              /* Jo hinnoiteltu → pelkkä mielipide, kyllä vai ei */
              <>
                <div style={{ ...card, background: "rgba(124,224,166,0.06)", border: "1px solid rgba(124,224,166,0.25)" }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#9ff0bd" }}>
                    Tämä ikkuna on jo hinnoiteltu.
                  </p>
                  {item.payoutCents != null && (
                    <p style={{ margin: "6px 0 0", fontSize: 13, color: "rgba(255,255,255,0.85)" }}>
                      Sinulle tästä ikkunasta:{" "}
                      <b style={{ fontSize: 17, color: "#7CE0A6", fontVariantNumeric: "tabular-nums" }}>{eur(item.payoutCents)}</b>
                    </p>
                  )}
                  <p style={{ margin: "7px 0 0", fontSize: 12, color: "rgba(255,255,255,0.6)" }}>
                    Kerro mielipiteesi: onko se reilu tästä ikkunasta?
                  </p>
                </div>

                {!declining ? (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      disabled={busy}
                      onClick={() => void send({ key: item.key, vote: "yes" })}
                      style={{ ...primary, flex: 1, background: "rgba(95,224,138,0.92)" }}
                      data-testid="btn-p2-vote-yes"
                    >
                      Kyllä, sopii
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => setDeclining(true)}
                      style={{ ...btn, flex: 1 }}
                      data-testid="btn-p2-vote-no"
                    >
                      Ei sovi
                    </button>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                    <p style={{ margin: 0, fontSize: 12.5, color: "rgba(255,255,255,0.7)" }}>
                      Mikä olisi reilu tästä ikkunasta? (voit myös jättää tyhjäksi)
                    </p>
                    <AmountInput value={draft} onChange={setDraft} />
                    <RealismNote cents={draftCents} refCents={ref} maxCents={ask.maxCents} />
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        disabled={busy || overMax}
                        onClick={() => void send({ key: item.key, vote: "no", payoutCents: draftCents ?? undefined })}
                        style={{ ...primary, flex: 1, opacity: overMax ? 0.5 : 1 }}
                      >
                        Lähetä
                      </button>
                      <button disabled={busy} onClick={() => { setDeclining(false); setDraft(""); }} style={btn}>
                        Peru
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              /* Ei vielä hinnoiteltu → paljonko haluaisit tästä saada */
              <>
                <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: "#fff" }}>
                  Paljonko haluaisit saada tästä ikkunasta?
                </p>
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                  {presetsFor(ref).map((c) => (
                    <button
                      key={c}
                      onClick={() => setDraft(centsToInput(c))}
                      style={{
                        ...btn, padding: "9px 13px",
                        border: draftCents === c ? "none" : "1px solid rgba(255,205,40,0.35)",
                        background: draftCents === c ? YELLOW : "rgba(255,205,40,0.08)",
                        color: draftCents === c ? "#0a0a0c" : "rgba(255,220,110,0.95)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {eur(c)}
                    </button>
                  ))}
                </div>
                <AmountInput value={draft} onChange={setDraft} />
                <RealismNote cents={draftCents} refCents={ref} maxCents={ask.maxCents} />
                <button
                  disabled={busy || draftCents == null || overMax}
                  onClick={() => draftCents != null && void send({ key: item.key, payoutCents: draftCents })}
                  style={{ ...primary, opacity: busy || draftCents == null || overMax ? 0.5 : 1 }}
                  data-testid="btn-p2-send-estimate"
                >
                  {wayOver ? "Lähetä silti" : "Lähetä arvio"}
                </button>
              </>
            )}

            {err && (
              <p style={{ margin: 0, fontSize: 12.5, color: "rgba(255,170,170,0.95)" }}>{err}</p>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                disabled={busy || idx === 0}
                onClick={() => { resetCard(); setIdx((n) => Math.max(0, n - 1)); }}
                style={{ ...btn, padding: "8px 12px", fontSize: 12, opacity: idx === 0 ? 0.35 : 1 }}
              >
                Edellinen
              </button>
              <button
                disabled={busy}
                onClick={advance}
                style={{ ...btn, marginLeft: "auto", padding: "8px 12px", fontSize: 12, color: "rgba(255,255,255,0.65)" }}
                data-testid="btn-p2-skip"
              >
                Ohita tämä
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Euromääräkenttä — mobiilinäppäimistö numeroille, pilkku sallittu. */
function AmountInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ""))}
        placeholder="oma summa"
        aria-label="Oma hinta-arvio euroina"
        data-testid="input-p2-estimate"
        style={{
          flex: 1, minWidth: 0, padding: "12px 13px", borderRadius: 11,
          border: "1px solid rgba(255,255,255,0.16)", background: "rgba(0,0,0,0.4)",
          color: "#fff", fontSize: 17, fontWeight: 700, fontVariantNumeric: "tabular-nums",
          outline: "none", fontFamily: FONT,
        }}
      />
      <span style={{ fontSize: 17, fontWeight: 700, color: "rgba(255,255,255,0.55)" }}>€</span>
    </div>
  );
}

/**
 * Rehellisyyspalaute jo ennen lähetystä: sama raja kuin serverillä (2 × keikan
 * tavallinen taso), joten tekijä tietää etukäteen mikä nousee tarkistukseen.
 */
function RealismNote({ cents, refCents, maxCents }: { cents: number | null; refCents: number; maxCents: number }) {
  if (cents == null) {
    return (
      <p style={{ margin: 0, fontSize: 11.5, color: "rgba(255,255,255,0.4)" }}>
        Tavallinen taso tällä keikalla {eur(refCents)} / ikkuna.
      </p>
    );
  }
  if (cents > maxCents) {
    return <Note color="rgba(255,150,150,0.95)">Enimmäisarvio on {eur(maxCents)} / ikkuna.</Note>;
  }
  if (cents > refCents * 2) {
    return (
      <Note color="rgba(255,150,150,0.95)">
        Yli kaksinkertainen tavalliseen ({eur(refCents)}) nähden — tämä merkitään heti
        tarkistettavaksi. Lähetä vain jos ikkuna todella on tätä vaativampi.
      </Note>
    );
  }
  if (cents > refCents * 1.5) {
    return (
      <Note color="rgba(255,220,150,0.95)">
        Reilusti yli tavallisen ({eur(refCents)}). Varmista, että ikkuna on oikeasti hankalampi.
      </Note>
    );
  }
  if (cents < refCents * 0.5) {
    return (
      <Note color="rgba(255,255,255,0.55)">
        Selvästi alle tavallisen ({eur(refCents)}) — älä aliarvioi omaa työtäsi.
      </Note>
    );
  }
  return <Note color="rgba(159,240,189,0.95)">Realistinen — tällä tasolla työt tehdään.</Note>;
}

function Note({ color, children }: { color: string; children: React.ReactNode }) {
  return <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.5, color }}>{children}</p>;
}
