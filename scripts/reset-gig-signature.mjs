#!/usr/bin/env node
/**
 * Nollaa sopimuskeikan allekirjoitus tietokannasta.
 *
 * Käyttötapaus: asiakaslinkkiä testattaessa keikkaan on jäänyt manuaalinen
 * testiallekirjoitus ("random töherrys"). Ennen kuin linkki jaetaan oikealle
 * asiakkaalle, allekirjoitus + mahdollinen hyväksyntä pitää poistaa, jotta
 * asiakas pääsee allekirjoittamaan puhtaalta pöydältä (sign-reitti palauttaa
 * 409:n, jos allekirjoitus on jo olemassa).
 *
 * Skripti poistaa gigData-JSON:sta vain kentät `signature` ja `approval` sekä
 * allekirjoitukseen liittyvät loki-rivit. Mitään muuta keikan dataa
 * (sektorit, hinnat, kartta) ei kosketa.
 *
 * Käyttö (oletuksena DRY RUN — ei kirjoita mitään):
 *   DATABASE_URL=postgres://... node scripts/reset-gig-signature.mjs --desc=FR8
 *   DATABASE_URL=postgres://... node scripts/reset-gig-signature.mjs --token=<quoteToken>
 *
 * Kirjoita muutokset lisäämällä --commit:
 *   DATABASE_URL=postgres://... node scripts/reset-gig-signature.mjs --desc=FR8 --commit
 */

import { Pool } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("Virhe: DATABASE_URL ei asetettu. Aja: DATABASE_URL=postgres://... node scripts/reset-gig-signature.mjs --desc=FR8");
  process.exit(1);
}

const args = process.argv.slice(2);
const commit = args.includes("--commit");
const tokenArg = (args.find((a) => a.startsWith("--token=")) || "").split("=")[1] || "";
const descArg = (args.find((a) => a.startsWith("--desc=")) || "").split("=")[1] || "";

if (!tokenArg && !descArg) {
  console.error("Anna kohde: --token=<quoteToken> tai --desc=<kuvauksen osa, esim. FR8>");
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
    // Etsi vain custom gig -rivit, jotta emme vahingossa osu tavallisiin töihin.
    const where = tokenArg ? "quote_token = $1" : "description ILIKE $1";
    const param = tokenArg ? tokenArg : `%${descArg}%`;
    const { rows } = await client.query(
      `SELECT id, description, quote_token, gig_data
         FROM jobs
        WHERE is_custom_gig = true AND ${where}`,
      [param],
    );

    if (!rows.length) {
      console.log("Ei osumia annetulla kohteella.");
      return;
    }
    if (rows.length > 1) {
      console.log(`Löytyi ${rows.length} keikkaa — tarkenna kohdetta (--token=...) jotta nollataan vain oikea:`);
      for (const r of rows) console.log(`  • #${r.id} "${r.description}" token=${r.quote_token}`);
      return;
    }

    const row = rows[0];
    let gig;
    try { gig = JSON.parse(row.gig_data || "{}"); } catch { gig = {}; }

    const hadSignature = !!gig.signature;
    const hadApproval = !!gig.approval;
    if (!hadSignature && !hadApproval) {
      console.log(`Keikalla #${row.id} "${row.description}" ei ole allekirjoitusta — ei tehtävää.`);
      return;
    }

    // Poista allekirjoitus + hyväksyntä ja niihin liittyvät loki-rivit.
    gig.signature = null;
    gig.approval = null;
    if (Array.isArray(gig.log)) {
      gig.log = gig.log.filter(
        (l) => !/allekirjoit|hyväks/i.test(String(l?.text ?? "")),
      );
    }
    gig.updatedAt = Date.now();

    console.log(`Kohde: #${row.id} "${row.description}" token=${row.quote_token}`);
    console.log(`  allekirjoitus poistetaan: ${hadSignature ? "kyllä" : "ei"}`);
    console.log(`  hyväksyntä poistetaan:    ${hadApproval ? "kyllä" : "ei"}`);

    if (!commit) {
      console.log("\nDRY RUN — mitään ei kirjoitettu. Aja sama komento --commit-lipulla tehdäksesi muutokset.");
      return;
    }

    await client.query(
      `UPDATE jobs SET gig_data = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(gig), row.id],
    );
    console.log("\nAllekirjoitus nollattu. Linkki on nyt valmis jaettavaksi asiakkaalle.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error("Nollaus epäonnistui:", e.message || e);
  process.exit(1);
});
