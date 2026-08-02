/**
 * Tasauksen LÄHTÖLUKUJEN käsinsyöttö.
 *
 * MIKSI: laskenta johtaa kaiken kartasta, ja se on oikein niin kauan kuin
 * kartta kertoo totuuden. Mutta kartta voidaan nollata maksujen jälkeen, osa
 * työstä on voitu tehdä ennen järjestelmän käyttöönottoa, tai johtaja
 * yksinkertaisesti tietää luvun paremmin. Silloin automatiikka ei auta vaan
 * haittaa: se kertoo itsevarmasti nollaa, ja kaikki sen päälle laskettu on
 * väärin.
 *
 * PERIAATE: kenttä kerrallaan. Tyhjä kenttä = laske kartasta kuten ennenkin.
 * Käsinsyöttö voi siis olla osittainen — esimerkiksi vain johtajien
 * ikkunamäärät, muu kartasta. Jokaisen kentän alla lukee mitä kartta sanoo,
 * jotta ero on näkyvissä eikä piilossa.
 */

import { useState } from "react";
import { SlidersHorizontal, RotateCcw } from "lucide-react";
import { T, mono, subLabel, button as tokenButton, input as tokenInput } from "./tokens";

const eur = (c: number) => (c / 100).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

/** Euroa (käyttäjän kieli) → senttiä. Tyhjä → null = "laske kartasta". */
function toCents(v: string): number | null | undefined {
  const s = v.trim().replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined;
}
function toInt(v: string): number | null | undefined {
  const s = v.trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
}

interface Props {
  founders: { id: string; name: string }[];
  /** Käsin annetut arvot, jos niitä on. */
  active?: {
    p1PotCents?: number | null;
    p1WindowsTotal?: number | null;
    workerP1EarnedCents?: number | null;
    p1WindowsByFounder?: Record<string, number>;
  };
  /** Sama tieto kartasta johdettuna — näytetään vertailuksi. */
  derived: {
    p1PotCents: number;
    p1WindowsTotal: number;
    workerP1EarnedCents: number;
    p1WindowsByFounder: Record<string, number>;
  };
  busy?: boolean;
  onSave: (manual: Record<string, unknown>) => void;
}

function Field({ label, hint, value, onChange, suffix }: {
  label: string; hint: string; value: string;
  onChange: (v: string) => void; suffix?: string;
}) {
  return (
    <label style={{ display: "grid", gap: 4 }}>
      <span style={{ ...subLabel, margin: 0 }}>{label}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input value={value} onChange={(e) => onChange(e.target.value)}
          inputMode="decimal" placeholder="kartasta"
          style={{ ...tokenInput, width: "100%", textAlign: "right" }} />
        {suffix && <span style={{ ...subLabel, margin: 0, flexShrink: 0 }}>{suffix}</span>}
      </span>
      <span style={{ ...subLabel, margin: 0, fontSize: T.size.xs }}>{hint}</span>
    </label>
  );
}

export default function ManualInputs({ founders, active, derived, busy, onSave }: Props) {
  const [open, setOpen] = useState(false);
  const [pot, setPot] = useState(active?.p1PotCents != null ? String(active.p1PotCents / 100) : "");
  const [total, setTotal] = useState(active?.p1WindowsTotal != null ? String(active.p1WindowsTotal) : "");
  const [worker, setWorker] = useState(active?.workerP1EarnedCents != null ? String(active.workerP1EarnedCents / 100) : "");
  const [byF, setByF] = useState<Record<string, string>>(() =>
    Object.fromEntries(founders.map((f) => [f.id, active?.p1WindowsByFounder?.[f.id] != null
      ? String(active.p1WindowsByFounder[f.id]) : ""])));

  const anyActive = !!active && (
    active.p1PotCents != null || active.p1WindowsTotal != null
    || active.workerP1EarnedCents != null || !!active.p1WindowsByFounder
  );

  function submit() {
    onSave({
      p1PotCents: toCents(pot) ?? null,
      p1WindowsTotal: toInt(total) ?? null,
      workerP1EarnedCents: toCents(worker) ?? null,
      p1WindowsByFounder: Object.fromEntries(
        founders.map((f) => [f.id, byF[f.id]?.trim() === "" ? null : toInt(byF[f.id] ?? "") ?? null]),
      ),
    });
    setOpen(false);
  }

  function clearAll() {
    setPot(""); setTotal(""); setWorker("");
    setByF(Object.fromEntries(founders.map((f) => [f.id, ""])));
    onSave({
      p1PotCents: null, p1WindowsTotal: null, workerP1EarnedCents: null,
      p1WindowsByFounder: Object.fromEntries(founders.map((f) => [f.id, null])),
    });
    setOpen(false);
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{ ...tokenButton(anyActive ? "accent" : "ghost") }}>
        <SlidersHorizontal size={13} />
        {anyActive ? "Lähtöluvut käsin — muokkaa" : "Syötä lähtöluvut käsin"}
      </button>
    );
  }

  return (
    <div style={{
      display: "grid", gap: T.space.md, padding: T.space.md,
      borderRadius: T.radius.md, border: T.border.divider, background: "rgba(255,255,255,0.03)",
    }}>
      <p style={{ ...subLabel, margin: 0, lineHeight: 1.55 }}>
        Tyhjä kenttä = laske kartasta. Täytä vain ne jotka kartta saa väärin —
        esimerkiksi jos kartta on nollattu maksujen jälkeen, riittää että
        syötät johtajien ikkunamäärät.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: T.space.md }}>
        <Field label="Punaisten potti" suffix="€" value={pot} onChange={setPot}
          hint={`kartasta ${eur(derived.p1PotCents)}`} />
        <Field label="Punaisia yhteensä" suffix="kpl" value={total} onChange={setTotal}
          hint={`kartasta ${derived.p1WindowsTotal}`} />
        <Field label="Tekijöille yhteensä" suffix="€" value={worker} onChange={setWorker}
          hint={`kartasta ${eur(derived.workerP1EarnedCents)}`} />
        {founders.map((f) => (
          <Field key={f.id} label={`${f.name} — punaisia`} suffix="kpl"
            value={byF[f.id] ?? ""}
            onChange={(v) => setByF((cur) => ({ ...cur, [f.id]: v }))}
            hint={`kartasta ${derived.p1WindowsByFounder[f.id] ?? 0}`} />
        ))}
      </div>

      <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap" }}>
        <button onClick={submit} disabled={busy} style={{ ...tokenButton("accent"), opacity: busy ? 0.6 : 1 }}>
          Tallenna lähtöluvut
        </button>
        <button onClick={() => setOpen(false)} style={tokenButton("ghost")}>Peruuta</button>
        {anyActive && (
          <button onClick={clearAll} disabled={busy} style={{ ...tokenButton("ghost"), marginLeft: "auto" }}>
            <RotateCcw size={13} /> Takaisin karttaan
          </button>
        )}
      </div>
    </div>
  );
}

export { eur as manualEur };
