/**
 * Virheiden luokittelu ja turvallinen vastaus.
 *
 * MIKSI TÄMÄ ON OLEMASSA: kirjautumissivu näytti kerran käyttäjälle tekstin
 *
 *   "Kirjautuminen epäonnistui — Your project has exceeded the data transfer
 *    quota. Upgrade your plan to increase limits."
 *
 * Se ei ollut kirjautumisvirhe eikä edes sovelluksen virhe: tietokannan
 * palveluntarjoaja oli ylittänyt siirtokiintiön ja palautti oman
 * englanninkielisen laskutusviestinsä. Se päätyi sanasta sanaan käyttäjän
 * ruudulle, koska jokainen reitti tekee `res.status(500).json({ error: e.message })`
 * ja client näyttää `error`-kentän suoraan.
 *
 * Kaksi ongelmaa yhdessä:
 *  1. Käyttäjä luuli salasanansa olevan väärin, vaikka vika oli infrassa.
 *  2. Sisäiset virheviestit (SQL-lauseet, tiedostopolut, palveluntarjoajan
 *     tilatiedot) vuotavat selaimeen — myös silloin kun kyse ei ole meistä.
 *
 * Tämä moduuli erottaa NÄKYVÄN viestin (suomeksi, toimintaohje) LOKIIN
 * kirjattavasta todellisesta syystä (koko virhe, reitti, koodi).
 */

/** Koneluettava syy — client voi haaroa tämän perusteella ilman tekstivertailua. */
export type ErrorCode =
  | "db_unavailable"   // tietokantaan ei saada yhteyttä (verkko, alhaalla, kiintiö)
  | "db_quota"         // palveluntarjoajan siirto-/tallennuskiintiö täynnä
  | "db_schema"        // taulua/saraketta ei ole (migraatio ajamatta)
  | "conflict"         // uniikkiehto tms. — pyyntö on jo tehty
  | "server_error";    // kaikki muu

export interface SafeError {
  status: number;
  code: ErrorCode;
  /** Suomenkielinen, käyttäjälle näytettävä viesti. Ei koskaan sisällä
   *  palveluntarjoajan, SQL:n tai tiedostojärjestelmän omaa tekstiä. */
  message: string;
}

/** Postgresin virhekoodit joita käsitellään erikseen. */
const PG_UNDEFINED_TABLE = "42P01";
const PG_UNDEFINED_COLUMN = "42703";
const PG_UNIQUE_VIOLATION = "23505";

/** Yhteysvirheiden verkkokoodit. */
const CONNECTION_CODES = new Set([
  "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "EHOSTUNREACH", "EPIPE",
  "57P01", // admin_shutdown
  "57P03", // cannot_connect_now
  "53300", // too_many_connections
]);

function textOf(e: unknown): string {
  if (!e) return "";
  if (typeof e === "string") return e;
  const m = (e as { message?: unknown }).message;
  return typeof m === "string" ? m : String(e);
}

/**
 * Tunnistaa palveluntarjoajan kiintiöviestin. Supabase palauttaa
 * "Your project has exceeded the data transfer quota. Upgrade your plan to
 * increase limits."; muut tarjoajat sanovat saman eri sanoin, joten haetaan
 * yhdistelmää "ylitetty" + "kiintiö/raja/käyttö" sen sijaan että lukittaisiin
 * yhteen merkkijonoon.
 */
function looksLikeQuota(msg: string): boolean {
  const m = msg.toLowerCase();
  if (!/exceed|over.?limit|quota|ylittyn/.test(m)) return false;
  return /quota|data transfer|bandwidth|egress|usage|plan|limit/.test(m);
}

/** Luokittelee minkä tahansa poikkeuksen näytettäväksi vastaukseksi. */
export function classifyError(e: unknown): SafeError {
  const msg = textOf(e);
  const code = String((e as { code?: unknown })?.code ?? "");

  if (looksLikeQuota(msg)) {
    return {
      status: 503,
      code: "db_quota",
      message: "Palvelun tietokanta on tilapäisesti käyttörajan takana. " +
        "Tiedot ovat tallessa — yritä hetken päästä uudelleen.",
    };
  }
  if (CONNECTION_CODES.has(code) || /connection (terminated|refused|reset)|timeout|ssl|socket hang up/i.test(msg)) {
    return {
      status: 503,
      code: "db_unavailable",
      message: "Palvelu ei juuri nyt saa yhteyttä tietokantaan. Yritä hetken päästä uudelleen.",
    };
  }
  if (code === PG_UNDEFINED_TABLE || code === PG_UNDEFINED_COLUMN) {
    return {
      status: 503,
      code: "db_schema",
      message: "Palvelun tietokanta on päivityksen tarpeessa. Ilmoita ylläpidolle.",
    };
  }
  if (code === PG_UNIQUE_VIOLATION) {
    return { status: 409, code: "conflict", message: "Tämä on jo tehty — päivitä sivu." };
  }
  return { status: 500, code: "server_error", message: "Palvelussa tapahtui virhe. Yritä uudelleen." };
}

/** Onko tämä "taulua ei ole" -virhe? Erillinen, koska osa reiteistä sietää sen
 *  hiljaa (erälaskut ennen db:push-ajoa) eikä halua vastata virheellä. */
export function isMissingTable(e: unknown): boolean {
  return String((e as { code?: unknown })?.code ?? "") === PG_UNDEFINED_TABLE;
}

/** Minimirajapinta Expressin `res`istä — pitää tämän moduulin testattavana. */
interface ResponseLike {
  status(code: number): { json(body: unknown): unknown };
}

/**
 * Kirjaa TODELLISEN virheen palvelimen lokiin ja vastaa turvallisella viestillä.
 *
 * ```ts
 * } catch (e) { return fail(res, e, "POST /api/admin/login"); }
 * ```
 */
export function fail(res: ResponseLike, e: unknown, context: string): unknown {
  const safe = classifyError(e);
  // Koko virhe lokiin — se on ainoa paikka jossa sen kuuluu näkyä.
  console.error(`[${safe.code}] ${context}:`, e);
  return res.status(safe.status).json({ error: safe.message, code: safe.code });
}
