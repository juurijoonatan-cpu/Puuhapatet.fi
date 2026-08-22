/**
 * LAMPUT JA OVET — asiakkaan seurantasivun osio.
 *
 * Kolme kysymystä, tässä järjestyksessä:
 *   1. Montako lamppua ei toimi, ja montako on jo vaihdettu.
 *   2. Missä kerroksissa ne ovat (`LampFloorChart`).
 *   3. Mitä pitää ostaa — ja mitä asiakas olisi valmis maksamaan.
 *
 * Kohta 3 on se joka tekee tästä muutakin kuin raportin: asiakas kirjoittaa
 * oman hintaehdotuksensa per polttimo ja per ovi, ja se näkyy meidän
 * dashissamme. Ei sitova tarjous eikä lasku — hinnasta sovitaan erikseen, ja
 * lomake sanoo sen ääneen, jottei kenttään kirjoitettu luku tunnu tilaukselta.
 *
 * Tekijöiden nimiä ei ole missään: asiakkaalle kerrotaan mitä tehtiin, ei kuka.
 */
import { useState } from "react";
import type { GigPublicView } from "@/lib/api";
import { eurFromCents } from "@shared/project";
import { CFONT, type CustomerTheme } from "@/lib/customer-theme";
import LampFloorChart, { type LampChartTheme } from "@/components/LampFloorChart";

type Fixtures = NonNullable<GigPublicView["fixtures"]>;

/** Onko pinta tumma? Luetaan paletista, ei teeman nimestä — sama tapa kuin
 *  `CustomerFloorMap`issa, jotta mahdollinen kolmas teema toimii itsestään. */
function isDark(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}

/**
 * Kuvion sävyt — kumpikin joukko MITATTU sitä pintaa vasten jolla se piirtyy.
 *
 * Vaalea: CVD-erottelu 16,0 ΔE ja normaalinäön erottelu 16,4 ΔE pahimmalla
 * vierekkäisellä parilla. Amber (2,15:1) ja neutraali (1,61:1) jäävät alle
 * 3:1 valkoista vasten — siksi kuviossa on aina selite, suora luku rivin
 * päässä ja "Luvut"-taulukko: väri ei kanna merkitystä yksin.
 *
 * Tumma: samat merkitykset teknisen teeman pinnalle (#101215) steppeinä,
 * kaikki neljä yli 3:1.
 */
const CHART_LIGHT: Omit<LampChartTheme, "text" | "muted" | "surface"> = {
  broken: "#C0392B", unchecked: "#E0A800", working: "#CFCCC2", changed: "#3E7C59", font: CFONT,
};
const CHART_DARK: Omit<LampChartTheme, "text" | "muted" | "surface"> = {
  broken: "#ff7474", unchecked: "#ffc45a", working: "#969baa", changed: "#7ce0a6", font: CFONT,
};

/** "12,50" → 1250 senttiä. Tyhjä → undefined (kenttä jätetään pois). */
function parseEuro(v: string): number | undefined {
  const t = v.replace(",", ".").trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined;
}

function fmtEuroInput(cents?: number | null): string {
  return cents == null ? "" : (cents / 100).toFixed(2).replace(".", ",");
}

interface Props {
  fixtures: Fixtures;
  theme: CustomerTheme;
  floorLabel: (floor: string) => string;
  /** Tallenna asiakkaan hintaehdotus. Palauttaa virheen tekstinä tai null. */
  onSaveQuote: (body: { bulbPriceCents?: number; doorPriceCents?: number; note?: string }) => Promise<string | null>;
}

export default function FixturesPanel({ fixtures, theme: T, floorLabel, onSaveQuote }: Props) {
  const dark = isDark(T.card);
  const base = dark ? CHART_DARK : CHART_LIGHT;
  const chartTheme: LampChartTheme = { ...base, surface: T.fill, text: T.ink, muted: T.muted };

  const { lamps, doors, order, quote, quotedTotalCents } = fixtures;
  const [bulb, setBulb] = useState(() => fmtEuroInput(quote?.bulbPriceCents));
  const [doorPrice, setDoorPrice] = useState(() => fmtEuroInput(quote?.doorPriceCents));
  const [note, setNote] = useState(quote?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Elävä summa kirjoittaessa — asiakas näkee heti mitä ehdotus tarkoittaa.
  const liveTotal = (() => {
    const b = parseEuro(bulb), d = parseEuro(doorPrice);
    if (b == null && d == null) return null;
    return order.bulbs * (b ?? 0) + order.doorCount * (d ?? 0);
  })();

  async function save() {
    setBusy(true); setErr(null); setMsg(null);
    const error = await onSaveQuote({
      bulbPriceCents: parseEuro(bulb),
      doorPriceCents: parseEuro(doorPrice),
      note: note.trim() || undefined,
    });
    setBusy(false);
    if (error) setErr(error);
    else setMsg("Ehdotus tallennettu — näemme sen heti.");
  }

  const label: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.muted, fontFamily: CFONT,
  };
  const field: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10,
    border: `1px solid ${T.hair}`, background: T.card, color: T.ink, fontFamily: CFONT, fontSize: 14, outline: "none",
  };

  return (
    <div style={{ fontFamily: CFONT, color: T.ink }}>
      {/* 1. LUVUT. Iso luku on se joka koskee asiakasta: montako ei toimi. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(124px, 1fr))", gap: 10, marginBottom: 18 }}>
        {([
          ["Ei toimi", `${lamps.needsBulbs}`, "lamppua", lamps.needsBulbs > 0 ? (dark ? "#ff7474" : "#C0392B") : T.muted],
          ["Vaihdettu", `${lamps.fixed}`, "tähän mennessä", T.green],
          ["Kunnossa", `${lamps.functional}`, `${lamps.total} merkitystä`, T.ink],
          ...(doors.total > 0 ? [["Ovet", `${doors.done}/${doors.total}`, "tehty", T.ink] as [string, string, string, string]] : []),
        ] as [string, string, string, string][]).map(([l, v, sub, tone]) => (
          <div key={l} style={{ padding: "12px 14px", borderRadius: 12, background: T.fill }}>
            <div style={label}>{l}</div>
            <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.15, color: tone }}>{v}</div>
            <div style={{ fontSize: 12, color: T.muted }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* MITÄ LUVUT KOSKEVAT. Ilman tätä lausetta "5 lamppua" luetaan "talossa
          on 5 lamppua" — ja se on lupaus jota emme ole antaneet: merkitsemätön
          lamppu ei ole näissä luvuissa lainkaan. */}
      <p style={{ margin: "0 0 18px", fontSize: 12.5, color: T.muted, lineHeight: 1.6 }}>
        Luvut koskevat kartalle merkittyjä lamppuja ({lamps.total} kpl). Kaikkia kiinteistön
        lamppuja ei välttämättä ole vielä käyty läpi.
      </p>

      {/* 2. KERROKSITTAIN. */}
      {lamps.byFloor.length > 0 && (
        <div style={{ padding: 14, borderRadius: 12, background: T.fill, marginBottom: 18 }}>
          <LampFloorChart rows={lamps.byFloor} theme={chartTheme} title="Merkityt lamput kerroksittain" floorLabel={floorLabel} />
        </div>
      )}

      {/* 3. OSTETTAVAA + HINTAEHDOTUS. */}
      <div style={{ padding: 16, borderRadius: 12, border: `1px solid ${T.hair}`, background: T.card }}>
        <div style={{ ...label, marginBottom: 10 }}>Ostettavaa</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 20px", fontSize: 14, marginBottom: 4 }}>
          <span>
            <b style={{ fontWeight: 700 }}>{order.bulbs}</b> polttimoa
            {order.lampModel && <span style={{ color: T.muted }}> · {order.lampModel}</span>}
          </span>
          {doors.total > 0 && (
            <span>
              <b style={{ fontWeight: 700 }}>{order.doorCount}</b> ovea
              {order.doorMaterial && <span style={{ color: T.muted }}> · {order.doorMaterial}</span>}
            </span>
          )}
        </div>
        {order.note && <p style={{ margin: "8px 0 0", fontSize: 13.5, color: T.muted, lineHeight: 1.6 }}>{order.note}</p>}

        <div style={{ height: 1, background: T.hair, margin: "16px 0" }} />

        <div style={{ ...label, marginBottom: 4 }}>Hintaehdotuksesi</div>
        <p style={{ margin: "0 0 12px", fontSize: 13, color: T.muted, lineHeight: 1.6 }}>
          Kerro mitä olisit valmis maksamaan. Tämä ei ole tilaus eikä sitova sopimus —
          hinnasta sovitaan erikseen, ja näemme ehdotuksesi heti.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: doors.total > 0 ? "repeat(auto-fit, minmax(150px, 1fr))" : "1fr", gap: 12 }}>
          <label style={{ display: "block" }}>
            <span style={{ display: "block", fontSize: 12.5, color: T.muted, marginBottom: 5 }}>€ / polttimo</span>
            <input value={bulb} onChange={(e) => setBulb(e.target.value)} inputMode="decimal" placeholder="0,00" style={field} />
          </label>
          {doors.total > 0 && (
            <label style={{ display: "block" }}>
              <span style={{ display: "block", fontSize: 12.5, color: T.muted, marginBottom: 5 }}>€ / ovi</span>
              <input value={doorPrice} onChange={(e) => setDoorPrice(e.target.value)} inputMode="decimal" placeholder="0,00" style={field} />
            </label>
          )}
        </div>

        <label style={{ display: "block", marginTop: 12 }}>
          <span style={{ display: "block", fontSize: 12.5, color: T.muted, marginBottom: 5 }}>Viesti (vapaaehtoinen)</span>
          <textarea
            value={note} onChange={(e) => setNote(e.target.value.slice(0, 500))} rows={3}
            placeholder="Esim. ”Käykö tämä hinta, jos hoidatte myös asennuksen?”"
            style={{ ...field, resize: "vertical" }}
          />
        </label>

        {liveTotal != null && (
          <p style={{ margin: "12px 0 0", fontSize: 13.5, color: T.ink }}>
            Tällä hinnalla yhteensä <b style={{ fontWeight: 700 }}>{eurFromCents(liveTotal)}</b>
            <span style={{ color: T.muted }}> ({order.bulbs} polttimoa{doors.total > 0 ? `, ${order.doorCount} ovea` : ""})</span>
          </p>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14, flexWrap: "wrap" }}>
          <button
            onClick={save} disabled={busy}
            style={{ padding: "11px 18px", borderRadius: 10, border: "none", background: T.navy, color: dark ? "#0b0d10" : "#fff", fontFamily: CFONT, fontSize: 13.5, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}
          >
            {busy ? "Tallennetaan…" : quote ? "Päivitä ehdotus" : "Lähetä ehdotus"}
          </button>
          {msg && <span style={{ fontSize: 13, color: T.green, fontWeight: 600 }}>{msg}</span>}
          {err && <span style={{ fontSize: 13, color: dark ? "#ff7474" : "#C0392B", fontWeight: 600 }}>{err}</span>}
          {quote && !msg && !err && (
            <span style={{ fontSize: 12.5, color: T.muted }}>
              Ehdotettu aiemmin{quotedTotalCents != null ? ` · ${eurFromCents(quotedTotalCents)}` : ""}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
