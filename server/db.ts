import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL puuttuu — tarkista ympäristömuuttujat");
}

// Hosted Postgres (Render/Supabase) requires SSL; a local dev database does not.
const isLocal = /@(localhost|127\.0\.0\.1)/.test(process.env.DATABASE_URL);

/**
 * Yhteyspooli on säädetty niin että tietokanta pääsee NUKKUMAAN.
 *
 * Neonin compute laskutetaan tunneittain ja se sammuu itsestään vasta kun
 * yhteyksiä ei ole. Jos pooli pitää yhtäkään yhteyttä auki, compute pysyy
 * hereillä ympäri vuorokauden vaikka kukaan ei käytä sovellusta — ja se
 * on juuri se "pyörii hiljaa päällä ja kuluttaa" -tilanne.
 *
 *  • `idleTimeoutMillis` 10 s -> 3 s: jouten oleva yhteys suljetaan nopeasti,
 *    jolloin Neonin oma lepotila-ajastin pääsee käyntiin heti käytön jälkeen.
 *  • `max` 10 -> 5: Render-instanssi on pieni eikä tarvitse kymmentä yhteyttä;
 *    pienempi pooli tarkoittaa myös vähemmän yhteyksiä jotka pitäisi sulkea.
 *  • `allowExitOnIdle`: prosessi ei jää roikkumaan avoimen poolin takia.
 *  • `connectionTimeoutMillis`: kylmä Neon-compute herää ~1 s:ssä, mutta
 *    oletusarvo 0 tarkoittaa "odota ikuisesti" — 15 s antaa herätykselle
 *    reilusti aikaa ja katkaisee silti jumiin jääneen yhteydenoton.
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 3_000,
  connectionTimeoutMillis: 15_000,
  allowExitOnIdle: true,
});

// Jouten olevan yhteyden virhe (Neon katkaisee sen lepotilaan mennessään) ei
// saa kaataa prosessia. Ilman tätä kuuntelijaa Node lopettaa koko palvelimen
// käsittelemättömään 'error'-tapahtumaan.
pool.on("error", (err) => {
  console.warn("Postgres-poolin jouten oleva yhteys katkesi:", err.message);
});

export const db = drizzle(pool, { schema });
