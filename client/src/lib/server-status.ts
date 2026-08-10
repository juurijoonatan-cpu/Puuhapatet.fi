/**
 * ONKO PALVELIN HEREILLÄ?
 *
 * Render nukuttaa ilmaisen instanssin ~15 minuutin hiljaisuuden jälkeen, ja
 * ensimmäinen pyyntö sen jälkeen odottaa herätyksen ~50 sekuntia. Kirjautuja ei
 * nähnyt tästä mitään: hän painoi "Kirjaudu", mitään ei tapahtunut lähes
 * minuuttiin, ja ainoa johtopäätös oli että sovellus on rikki.
 *
 * Tila johdetaan yhdestä paikasta, koska "nukkuu" ja "ei vastaa" näyttävät
 * verkosta katsottuna melkein samalta ja ero on juuri se mikä kirjautujaa
 * kiinnostaa:
 *
 *   · PYYNTÖ VENYY  → palvelin herää. Se tulee kyllä, odota.
 *   · PYYNTÖ KAATUU → palvelin ei vastaa. Odottaminen ei auta.
 *
 * Siksi hidas vastaus EI ole virhe eikä epäonnistuminen ole hitautta.
 */

export type ServerPhase = "checking" | "waking" | "up" | "down";

/** Tätä pidempi kysely tarkoittaa käytännössä kylmäkäynnistystä. Nopea vastaus
 *  hereillä olevalta Renderiltä on kymmeniä millisekunteja; sekunnin ylitys ei
 *  ole enää verkkoviive vaan herääminen. */
export const WAKE_AFTER_MS = 1200;
/** Yksi epäonnistuminen voi olla ohimenevä katko (tunneli, wifi-vaihto).
 *  Kahdesta peräkkäisestä uskotaan. */
export const DOWN_AFTER_FAILURES = 2;

export interface ProbeState {
  /** Onko kysely juuri nyt kesken? */
  probing: boolean;
  /** Kuinka kauan KESKEN OLEVA kysely on jo kestänyt (ms). */
  probeElapsedMs: number;
  /** Peräkkäiset epäonnistumiset. Nollautuu onnistumisesta. */
  consecutiveFailures: number;
  /** Viimeisimmän onnistuneen kyselyn kesto, tai null jos onnistumista ei ole. */
  lastLatencyMs: number | null;
}

export function serverPhase(s: ProbeState): ServerPhase {
  // Venyvä kysely on herääminen, ei virhe — myös silloin kun edellinen yritys
  // kaatui. Nukkuva Render EI palauta virhettä, se vain ei vastaa, joten
  // "kesken ja hidas" voittaa aiemman epäonnistumisen.
  if (s.probing && s.probeElapsedMs >= WAKE_AFTER_MS) return "waking";
  if (s.consecutiveFailures >= DOWN_AFTER_FAILURES) return "down";
  // Tunnetusti hereillä olevaa ei merkitä epävarmaksi joka taustakyselyn
  // ajaksi — muuten palkki välkkyisi vihreän ja harmaan väliä minuutin välein.
  if (s.lastLatencyMs !== null) return "up";
  return "checking";
}

/** Palkin teksti. Odotusaika näkyy vain herätessä, jolloin se on ainoa asia
 *  jolla on merkitystä: kirjautuja haluaa tietää kannattaako jäädä odottamaan. */
export function serverLabel(phase: ServerPhase, s: Pick<ProbeState, "probeElapsedMs" | "lastLatencyMs">): string {
  switch (phase) {
    case "up": return `Palvelin valmis · ${formatLatency(s.lastLatencyMs ?? 0)}`;
    case "waking": return `Palvelin herää… ${Math.round(s.probeElapsedMs / 1000)} s`;
    case "down": return "Palvelin ei vastaa";
    default: return "Tarkistetaan…";
  }
}

function formatLatency(ms: number): string {
  // Desimaalipilkku kuten kaikkialla muualla sovelluksessa.
  return ms >= 1000
    ? `${(ms / 1000).toLocaleString("fi-FI", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`
    : `${Math.round(ms)} ms`;
}
