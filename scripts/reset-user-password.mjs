#!/usr/bin/env node
/**
 * Nollaa YHDEN käyttäjän salasanan (esim. kun tekijä on unohtanut omansa).
 *
 * Mitä tapahtuu nollauksen jälkeen: käyttäjä kirjautuu jaetulla aloituskoodilla
 * (ADMIN_DEFAULT_PASSWORD), ja kirjautumissivu pyytää häntä heti asettamaan
 * uuden oman salasanan — se on siitä eteenpäin hänen ainoa salasanansa.
 * (server/routes.ts: /api/admin/login palauttaa mustChangePassword, kun
 * tilillä ei ole tallennettua salasanaa.)
 *
 * Kenenkään muun tiliin ei kosketa, eikä aloituskoodi muutu.
 *
 * Käyttö (oletuksena DRY RUN — ei kirjoita mitään):
 *   DATABASE_URL=postgres://... node scripts/reset-user-password.mjs --user=selma
 *
 * Kirjoita muutos lisäämällä --commit:
 *   DATABASE_URL=postgres://... node scripts/reset-user-password.mjs --user=selma --commit
 */

import { Pool } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("Virhe: DATABASE_URL ei asetettu. Aja: DATABASE_URL=postgres://... node scripts/reset-user-password.mjs --user=selma");
  process.exit(1);
}

const args = process.argv.slice(2);
const commit = args.includes("--commit");
const user = (args.find((a) => a.startsWith("--user=")) || "").split("=")[1]?.trim().toLowerCase() || "";

if (!user) {
  console.error("Anna kohde: --user=<käyttäjätunnus, esim. selma>");
  process.exit(1);
}

const isLocal = /@(localhost|127\.0\.0\.1)/.test(DATABASE_URL);
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

async function main() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT id, username, name, password_hash FROM users WHERE username = $1`,
      [user],
    );

    if (!rows.length) {
      console.log(`Käyttäjää "${user}" ei löydy users-taulusta — hän on jo "ensikirjautumistilassa":`);
      console.log("aloituskoodi kelpaa ja kirjautuminen pyytää asettamaan oman salasanan. Ei tehtävää.");
      return;
    }

    const row = rows[0];
    if (!row.password_hash) {
      console.log(`Käyttäjällä ${row.username} (${row.name}) ei ole tallennettua salasanaa — ei tehtävää.`);
      console.log("Aloituskoodi kelpaa ja kirjautuminen pyytää asettamaan oman salasanan.");
      return;
    }

    console.log(`Kohde: ${row.username} (${row.name}) — tallennettu salasana nollataan.`);

    if (!commit) {
      console.log("\nDRY RUN — mitään ei kirjoitettu. Aja sama komento --commit-lipulla tehdäksesi muutoksen.");
      return;
    }

    await client.query(`UPDATE users SET password_hash = '' WHERE username = $1`, [user]);
    console.log(`\nValmis. ${row.name} kirjautuu seuraavaksi aloituskoodilla ja asettaa heti uuden oman salasanan.`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error("Nollaus epäonnistui:", e.message || e);
  process.exit(1);
});
