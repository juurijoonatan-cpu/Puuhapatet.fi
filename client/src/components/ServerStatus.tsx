/**
 * PALVELIMEN TILAPALKKI — kirjautumissivun yksi rivi totuutta.
 *
 * Render nukuttaa ilmaisen instanssin ~15 minuutin hiljaisuuden jälkeen.
 * Kirjautuja ei nähnyt siitä mitään: hän painoi "Kirjaudu", mitään ei tapahtunut
 * lähes minuuttiin, ja ainoa johtopäätös oli että sovellus on rikki. Nyt tila
 * lukee ruudulla ennen kuin salasanaa on edes kirjoitettu.
 *
 * Kysely on samalla HERÄTYS: `/api/health` on kevyt eikä koske kantaan (sama
 * reitti jota `warmBackend()` käyttää muualla), joten palvelin on jo hereillä
 * siihen mennessä kun salasana on kirjoitettu. Kirjautumissivulla ei ollut
 * ennen herätystä lainkaan, joten tämä poistaa samalla sen odotuksen.
 *
 * Visuaalinen linja: yksi piste, yksi rivi tekstiä, ei kehyksiä eikä laatikoita.
 * Väri kertoo tilan, teksti tarkentaa. Kun kaikki on kunnossa se on harmaa ja
 * lähes näkymätön; huomion se vie vain silloin kun jotain on kesken.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "@/lib/api";
import { serverPhase, serverLabel, type ServerPhase } from "@/lib/server-status";

/** Kuinka usein tilaa päivitetään kun sivulla vain istutaan. Riittävän harvoin
 *  ettei se ole liikennettä, riittävän usein että nukahtaminen näkyy. */
const POLL_MS = 20_000;
/** Herätys kestää Renderillä ~50 s. Aikakatkaisu on sen yli, jottei oma
 *  katkaisu näyttäisi katkokselta juuri ennen kuin palvelin ehtii vastata. */
const TIMEOUT_MS = 70_000;

const TONE: Record<ServerPhase, { dot: string; text: string; glow: string }> = {
  up:       { dot: "#3fbf7f", text: "hsl(var(--muted-foreground))", glow: "rgba(63,191,127,0.55)" },
  waking:   { dot: "#e0a800", text: "#a37a00",                      glow: "rgba(224,168,0,0.6)" },
  down:     { dot: "#e05252", text: "#c04040",                      glow: "rgba(224,82,82,0.55)" },
  checking: { dot: "hsl(var(--muted-foreground))", text: "hsl(var(--muted-foreground))", glow: "transparent" },
};

export default function ServerStatus({ className }: { className?: string }) {
  const [probing, setProbing] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [failures, setFailures] = useState(0);
  const [latency, setLatency] = useState<number | null>(null);
  const startedAt = useRef(0);
  const alive = useRef(true);

  const probe = useCallback(async () => {
    startedAt.current = performance.now();
    setProbing(true);
    setElapsed(0);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${API_BASE}/api/health`, { method: "GET", mode: "cors", signal: ctl.signal, cache: "no-store" });
      if (!alive.current) return;
      if (!res.ok) throw new Error(String(res.status));
      setLatency(Math.round(performance.now() - startedAt.current));
      setFailures(0);
    } catch {
      if (!alive.current) return;
      // Epäonnistuminen EI nollaa viimeisintä vasteaikaa: yksi katko ei tee
      // tyhjäksi sitä että palvelin vastasi äsken (ks. serverPhase).
      setFailures((n) => n + 1);
    } finally {
      clearTimeout(timer);
      if (alive.current) setProbing(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void probe();
    const poll = setInterval(() => { void probe(); }, POLL_MS);
    return () => { alive.current = false; clearInterval(poll); };
  }, [probe]);

  // Kello käy VAIN kyselyn ollessa kesken. Odotusaika on ainoa muuttuva luku
  // heräämisen aikana, ja ilman sitä palkki näyttäisi jumittuneelta juuri
  // silloin kun käyttäjä eniten miettii onko mitään tapahtumassa.
  useEffect(() => {
    if (!probing) return;
    const t = setInterval(() => setElapsed(performance.now() - startedAt.current), 250);
    return () => clearInterval(t);
  }, [probing]);

  const state = { probing, probeElapsedMs: elapsed, consecutiveFailures: failures, lastLatencyMs: latency };
  const phase = serverPhase(state);
  const tone = TONE[phase];
  const pulsing = phase === "waking" || phase === "checking";

  return (
    <div
      className={className}
      role="status"
      aria-live="polite"
      data-testid="server-status"
      style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 11.5, lineHeight: 1, color: tone.text, fontVariantNumeric: "tabular-nums" }}
    >
      <style>{`
        @keyframes ppStatusPulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .45; transform: scale(.82); } }
        @media (prefers-reduced-motion: reduce) { [data-pp-status-dot] { animation: none !important; } }
      `}</style>
      <span
        aria-hidden
        data-pp-status-dot
        style={{
          width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
          background: tone.dot,
          boxShadow: tone.glow === "transparent" ? undefined : `0 0 7px ${tone.glow}`,
          animation: pulsing ? "ppStatusPulse 1.5s ease-in-out infinite" : undefined,
        }}
      />
      <span>{serverLabel(phase, state)}</span>
      {phase === "down" && (
        <button
          type="button"
          onClick={() => { setFailures(0); void probe(); }}
          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "inherit", fontSize: "inherit", fontFamily: "inherit", textDecoration: "underline", textUnderlineOffset: 2 }}
        >
          yritä uudelleen
        </button>
      )}
    </div>
  );
}
