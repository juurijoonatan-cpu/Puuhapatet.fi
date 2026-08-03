/**
 * Tallennuksen kokomittari + liitteiden siirto.
 *
 * MIKSI TÄMÄ ON OLEMASSA: siirtokiintiö loppui kerran kesken työpäivän eikä
 * kukaan nähnyt sitä tulevan. Syy oli että kaikki liitteet — havaintokuvat,
 * kuitit, tekijöiden tositteet — asuivat karttablobin sisällä, ja se blobi
 * luetaan kannasta JOKAISELLA ikkunanapautuksella. Mittaria ei ollut, joten
 * kasvu oli näkymätöntä siihen asti kunnes tietokanta meni lukkoon.
 *
 * `perTapBytes` on se luku joka ratkaisee: montako tavua yksi tekijän
 * ikkunanapautus maksaa. Siirto pudottaa sen, ja tämä kortti näyttää
 * pudotuksen heti.
 *
 * Siirto on turvallinen: liite kirjoitetaan omaan tauluunsa ENNEN kuin se
 * poistetaan blobista, ajo on idempotentti ja keskeytynyt ajo ei hävitä
 * mitään. Lukupolut osaavat molemmat muodot koko ajan.
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { HardDrive, ArrowDownToLine, Loader2 } from "lucide-react";
import { T, card as tokenCard, mono, statLabel, subLabel, button as tokenButton } from "./tokens";

function mb(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${bytes} B`;
}

/** Karkea arvio: kaksi tekijää, sata napautusta kumpikin. */
function dayEstimate(perTap: number): string {
  const bytes = perTap * 200;
  return bytes >= 1024 * 1024 * 1024
    ? `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
    : `${Math.round(bytes / 1024 / 1024)} MB`;
}

type Stats = { count: number; bytes: number; blobBytes: number; gigBytes: number; perTapBytes: number };

export default function StorageCard({ jobId }: { jobId: number }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api.getAssetStats(jobId);
    if (r.ok && r.data) setStats(r.data);
  }, [jobId]);

  useEffect(() => { void load(); }, [load]);

  async function run(dryRun: boolean) {
    setBusy(true); setErr(null); setMsg(null);
    const r = await api.migrateAssets(dryRun);
    if (r.ok && r.data) {
      setMsg(r.data.summary);
      if (!dryRun) await load();
    } else {
      setErr(r.error || "Siirto epäonnistui.");
    }
    setBusy(false);
  }

  // Yli megatavun blobi on jo kallis: se luetaan joka napautuksella.
  const heavy = !!stats && stats.perTapBytes > 1_000_000;

  return (
    <div style={{ ...tokenCard, padding: T.space.lg, display: "grid", gap: T.space.md }}>
      <div style={{ display: "flex", alignItems: "center", gap: T.space.sm }}>
        <HardDrive size={15} color={T.text.muted} />
        <span style={{ ...statLabel }}>Tallennus ja siirto</span>
      </div>

      {!stats ? (
        <div style={{ ...subLabel }}>Luetaan…</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: T.space.md }}>
            <div>
              <div style={{ ...subLabel }}>Yksi ikkunanapautus</div>
              <div style={{ ...mono, fontSize: T.size.title, color: heavy ? "#ff9d6b" : "#7CE0A6" }}>
                {mb(stats.perTapBytes)}
              </div>
            </div>
            <div>
              <div style={{ ...subLabel }}>Arvio työpäivästä</div>
              <div style={{ ...mono, fontSize: T.size.lg, color: T.text.secondary }}>
                {dayEstimate(stats.perTapBytes)}
              </div>
              <div style={{ ...subLabel, fontSize: T.size.xs }}>2 tekijää × 100 merkintää</div>
            </div>
            <div>
              <div style={{ ...subLabel }}>Liitteet omassa taulussa</div>
              <div style={{ ...mono, fontSize: T.size.lg, color: T.text.secondary }}>
                {stats.count} kpl · {mb(stats.bytes)}
              </div>
              <div style={{ ...subLabel, fontSize: T.size.xs }}>ei maksa napautuksissa</div>
            </div>
          </div>

          {heavy && (
            <div style={{
              padding: T.space.md, borderRadius: T.radius.md,
              background: "rgba(255,157,107,0.10)", border: "1px solid rgba(255,157,107,0.30)",
              fontSize: T.size.sm, color: T.text.secondary, lineHeight: 1.55,
            }}>
              Liitteet ovat yhä kartan sisällä, joka luetaan joka napautuksella.
              Siirto vaihtaa niiden paikkaa — mitään ei poisteta.
            </div>
          )}

          <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap" }}>
            <button onClick={() => run(true)} disabled={busy}
              style={{ ...tokenButton("ghost"), opacity: busy ? 0.6 : 1 }}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : null} Näytä mitä siirtyisi
            </button>
            <button onClick={() => run(false)} disabled={busy}
              style={{ ...tokenButton(heavy ? "accent" : "ghost"), opacity: busy ? 0.6 : 1 }}>
              <ArrowDownToLine size={13} /> Siirrä liitteet pois blobista
            </button>
          </div>

          {msg && (
            <div style={{ ...subLabel, color: "#7CE0A6", fontSize: T.size.sm }}>{msg}</div>
          )}
          {err && (
            <div style={{ ...subLabel, color: "#ff8b8b", fontSize: T.size.sm }}>{err}</div>
          )}
        </>
      )}
    </div>
  );
}
