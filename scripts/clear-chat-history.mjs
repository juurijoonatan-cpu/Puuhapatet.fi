#!/usr/bin/env node
/**
 * Tyhjennä verkkochatin historia tietokannasta.
 *
 * Julkinen chat on nykyään tilaton: keskustelut elävät vain kävijän selaimen
 * istunnossa eikä niitä tallenneta. Tämä skripti poistaa kaikki AIEMMIN
 * tallennetut keskustelut + viestit, jotta vanhat istunnot eivät jää roikkumaan.
 *
 * Käyttö:
 *   DATABASE_URL=postgres://... node scripts/clear-chat-history.mjs
 *
 * Lipuke --public-only poistaa vain julkisen chatin rivit (source = 'public')
 * ja jättää mahdolliset admin-rivit rauhaan.
 */

import { Pool } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("Virhe: DATABASE_URL ei asetettu. Aja: DATABASE_URL=postgres://... node scripts/clear-chat-history.mjs");
  process.exit(1);
}

const publicOnly = process.argv.includes("--public-only");
const isLocal = /@(localhost|127\.0\.0\.1)/.test(DATABASE_URL);
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (publicOnly) {
      // Poista vain julkisen chatin viestit ja keskustelut.
      const msg = await client.query(
        `DELETE FROM chat_messages
           WHERE conversation_id IN (
             SELECT id FROM chat_conversations WHERE source = 'public'
           )`,
      );
      const convo = await client.query(`DELETE FROM chat_conversations WHERE source = 'public'`);
      console.log(`Poistettu ${msg.rowCount} viestiä ja ${convo.rowCount} keskustelua (vain public).`);
    } else {
      // Poista kaikki — nollaa myös ID-laskurit.
      await client.query(`TRUNCATE TABLE chat_messages, chat_conversations RESTART IDENTITY CASCADE`);
      console.log("Kaikki chat-historia poistettu ja ID-laskurit nollattu.");
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error("Tyhjennys epäonnistui:", e.message || e);
  process.exit(1);
});
