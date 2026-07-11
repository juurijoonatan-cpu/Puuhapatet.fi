#!/usr/bin/env node
/**
 * Nollaa KAIKKIEN käyttäjien salasanat (host, myynti, tekijät).
 *
 * Tausta: porukalla oli kasautunut useita vanhoja salasanoja (osa asetettu
 * ennen palvelinpuolen suojausta, osa sen jälkeen), eikä kukaan enää
 * muistanut kumpaa käyttää — kirjautumiset jumittuivat ja päätyivät rate
 * limitiin. Tämän skriptin jälkeen KAIKKI kirjautuvat jaetulla
 * aloituskoodilla (ADMIN_DEFAULT_PASSWORD, esim. 0000), ja järjestelmä pyytää
 * heti sen jälkeen asettamaan oman, ainoan salasanan (server/routes.ts:
 * /api/admin/login, mustChangePassword).
 *
 * Käyttö (oletuksena DRY RUN — ei kirjoita mitään):
 *   DATABASE_URL=postgres://... node scripts/reset-all-passwords.mjs
 *
 * Kirjoita muutokset lisäämällä --commit:
 *   DATABASE_URL=postgres://... node scripts/reset-all-passwords.mjs --commit
 */

import { Pool } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("Virhe: DATABASE_URL ei asetettu. Aja: DATABASE_URL=postgres://... node scripts/reset-all-passwords.mjs");
  process.exit(1);
}

const commit = process.argv.slice(2).includes("--commit");

const isLocal = /@(localhost|127\.0\.0\.1)/.test(DATABASE_URL);
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

async function main() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT id, username, name FROM users WHERE password_hash <> '' ORDER BY username`,
    );

    if (!rows.length) {
      console.log("Kaikkien käyttäjien salasanat ovat jo tyhjät — ei tehtävää.");
      return;
    }

    console.log(`${rows.length} käyttäjän salasana nollataan:`);
    for (const r of rows) console.log(`  • ${r.username} (${r.name})`);

    if (!commit) {
      console.log("\nDRY RUN — mitään ei kirjoitettu. Aja sama komento --commit-lipulla tehdäksesi muutokset.");
      return;
    }

    await client.query(`UPDATE users SET password_hash = ''`);
    console.log("\nValmis. Kaikki kirjautuvat seuraavaksi aloituskoodilla ja asettavat heti oman uuden salasanan.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error("Nollaus epäonnistui:", e.message || e);
  process.exit(1);
});
