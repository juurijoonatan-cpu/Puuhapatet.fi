/**
 * Lisää ennalta sovitut tekijät FR8-keikan tekijälistalle käynnistyksessä.
 *
 * Tekijät elävät keikan project_data-blobin `crew`-taulukossa, ei omassa
 * taulussaan, joten lisäys on JSON-muokkaus. Se tehdään yhtenä atomisena
 * UPDATE-lauseena ehdolla "tätä id:tä ei vielä ole", jolloin:
 *  - ajo on idempotentti (toinen käynnistys ei tee mitään),
 *  - rinnakkainen tekijän tallennus ei voi jäädä väliin (rivi luetaan ja
 *    kirjoitetaan samassa lauseessa), ja
 *  - jo olemassa olevaa id:tä ei ylikirjoiteta.
 *
 * Rivillä ei ole `onboardedAt`ia eikä allekirjoituksia: tunnit voi kirjata
 * ennen sopimuksia (johtajan kirjaus ei tarkista allekirjoituksia).
 */

import { sql } from "drizzle-orm";
import { db } from "./db";
import {
  FR8_PRESEEDED_CREW, DEFAULT_WORKER_PER_WINDOW_CENTS, newCrewToken, sanitizeCrewMember,
} from "@shared/crew";

const rowsOf = (r: any): any[] => (r?.rows ?? r) as any[];

export async function ensureFr8Crew(): Promise<void> {
  for (const want of FR8_PRESEEDED_CREW) {
    // Vain ne FR8-keikat joilta tekijä puuttuu — ja vain id, ei blobia. Normaali
    // käynnistys (tekijä jo listalla) ei siis lue kannasta kuin tyhjän tuloksen.
    const missing = rowsOf(await db.execute(sql`
      select id from jobs
       where is_custom_gig = true
         and project_data is not null
         and project_data::jsonb -> 'building' ->> 'planBase' like '%/fr8/%'
         and not exists (
           select 1 from jsonb_array_elements(coalesce(project_data::jsonb -> 'crew', '[]'::jsonb)) c
            where c ->> 'id' = ${want.id})
    `));
    if (!missing.length) continue;

    // Tokenin pitää olla uniikki KAIKKIEN keikkojen yli (ks. collectAllCrewTokens).
    const taken = new Set<string>(rowsOf(await db.execute(sql`
      select c ->> 'token' as token
        from jobs, jsonb_array_elements(coalesce(project_data::jsonb -> 'crew', '[]'::jsonb)) c
       where is_custom_gig = true and project_data is not null
    `)).map((r) => String(r.token)));

    for (const { id } of missing) {
      let token = newCrewToken();
      while (taken.has(token)) token = newCrewToken();
      taken.add(token);
      const member = sanitizeCrewMember({
        id: want.id, token, name: want.name, role: "worker",
        perWindowCents: DEFAULT_WORKER_PER_WINDOW_CENTS,
        active: true, agreements: [], notes: [], createdAt: Date.now(),
      });
      if (!member) continue;
      await db.execute(sql`
        update jobs
           set project_data = jsonb_set(
                 project_data::jsonb, '{crew}',
                 coalesce(project_data::jsonb -> 'crew', '[]'::jsonb) || ${JSON.stringify([member])}::jsonb
               )::text,
               updated_at = now()
         where id = ${id}
           and not exists (
             select 1 from jsonb_array_elements(coalesce(project_data::jsonb -> 'crew', '[]'::jsonb)) c
              where c ->> 'id' = ${want.id})
      `);
      console.log(`[crew] lisättiin ${want.name} FR8-keikalle (#${id})`);
    }
  }
}
