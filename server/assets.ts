/**
 * Liitteiden varasto — kuvat ja tositteet pois karttablobista.
 *
 * MIKSI: `jobs.project_data` luetaan jokaisella ikkunanapautuksella, jokaisella
 * asiakkaan seurantasivun kierroksella ja jokaisella adminin tallennuksella.
 * Kartan piirtämiseen tarvittava osa on noin 31 kB — mutta blobin sisällä oli
 * myös jokainen havaintokuva (700 kB), kulukuitti (700 kB), maksukuitti
 * (700 kB) ja tekijän tosite (1,5 MB). Neon laskee liikenteeksi datan joka
 * lähtee kannasta ulos, joten ne kuvat maksoivat joka kerta kun kartta luettiin,
 * vaikkei niitä katsonut kukaan.
 *
 * Tositteita ei myöskään poisteta koskaan (6 vuoden säilytys), joten blobi
 * kasvoi pysyvästi ja jokainen napautus maksoi ensi kuussa enemmän kuin tänään.
 *
 * PERIAATE: blobiin jää viite (`...AssetId`) ja metatieto. Liite haetaan tästä
 * taulusta vasta kun sitä katsotaan. **Karttapyyntö ei koske tähän tauluun.**
 *
 * YHTEENSOPIVUUS: vanhat liitteet ovat yhä blobin sisällä. Lukupolut osaavat
 * molemmat muodot (`resolveAsset`), eikä olemassa olevaa dataa siirretä
 * automaattisesti — siirto on erillinen, ajettava toimenpide (`migrateJobAssets`).
 * Näin julkaisu ei koskaan liikuta dataa itsestään.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { jobAssets } from "@shared/schema";
import type { ProjectData } from "@shared/project";

/**
 * `floor_plan` on keikan pohjakuva (kerros → kuva). Se kuuluu tähän tauluun
 * samasta syystä kuin muut liitteet: kuva on satoja kilotavuja, karttablobi
 * luetaan joka ikkunanapautuksella, ja pohjakuvaa katsotaan kerran per
 * sivunlataus. Blobiin jää vain `building.planImages[kerros]` = tämän rivin id.
 */
export type AssetKind =
  | "observation" | "expense_receipt" | "payout_receipt" | "crew_document" | "floor_plan";

/** Suurin talletettava pohjakuva (~2,5 MB data URL). Iso mutta kertaluonteinen:
 *  se ei ole blobissa eikä siis mukana karttapyynnöissä. */
export const MAX_PLAN_IMAGE_LEN = 3_500_000;

/** Data URL:n mime-tyyppi, esim. "image/jpeg". Tuntematon → "application/octet-stream". */
function mimeOf(dataUrl: string): string {
  const m = /^data:([^;,]+)[;,]/.exec(dataUrl);
  return m ? m[1] : "application/octet-stream";
}

/**
 * Tallenna yksi liite ja palauta sen id. Idempotentti: sama (jobId, kind,
 * refKey) päivittää olemassa olevan rivin sen sijaan että loisi kaksoiskappaleen
 * — niin siirron voi ajaa uudestaan pelkäämättä.
 */
export async function putAsset(
  jobId: number, kind: AssetKind, refKey: string, dataUrl: string,
): Promise<number> {
  const row = {
    jobId, kind, refKey: refKey.slice(0, 200),
    mime: mimeOf(dataUrl), bytes: dataUrl.length, data: dataUrl,
  };
  const [saved] = await db.insert(jobAssets).values(row)
    .onConflictDoUpdate({
      target: [jobAssets.jobId, jobAssets.kind, jobAssets.refKey],
      set: { mime: row.mime, bytes: row.bytes, data: row.data },
    })
    .returning({ id: jobAssets.id });
  return saved.id;
}

/** Hae yhden liitteen data URL. Palauttaa null jos sitä ei ole. */
export async function getAsset(jobId: number, id: number): Promise<string | null> {
  const [row] = await db.select({ data: jobAssets.data }).from(jobAssets)
    .where(and(eq(jobAssets.id, id), eq(jobAssets.jobId, jobId)));
  return row?.data ?? null;
}

/**
 * Liitteen sisältö riippumatta siitä kummassa muodossa se on.
 *
 * Tämä on se funktio jota lukupolkujen kuuluu kutsua: se piilottaa sen että
 * osa liitteistä on jo omassa taulussaan ja osa vielä blobin sisällä. Kun
 * siirto on ajettu kaikille, inline-haara jää yksinkertaisesti käyttämättä.
 */
export async function resolveAsset(
  jobId: number, ref: { assetId?: number; inline?: string },
): Promise<string | null> {
  if (ref.assetId) return getAsset(jobId, ref.assetId);
  return ref.inline ?? null;
}

/**
 * Kerroksen pohjakuva raakana kuvana, ei JSONina.
 *
 * MIKSI OMA FUNKTIO: `<img src>` tarvitsee oikean `Content-Type`in ja bittejä,
 * ei `{dataUrl}`-objektia. Data URL puretaan tässä takaisin binääriksi, jotta
 * selain voi välimuistittaa kuvan normaalisti — muuten se kulkisi base64:na
 * (33 % isompana) joka sivunlatauksella.
 *
 * Palauttaa null jos kuvaa ei ole tai se ei ole tämän keikan.
 */
export async function getPlanImage(
  jobId: number, floor: string,
): Promise<{ body: Buffer; mime: string; etag: string } | null> {
  const [row] = await db.select({ id: jobAssets.id, mime: jobAssets.mime, data: jobAssets.data })
    .from(jobAssets)
    .where(and(
      eq(jobAssets.jobId, jobId),
      eq(jobAssets.kind, "floor_plan"),
      eq(jobAssets.refKey, floor.slice(0, 200)),
    ));
  if (!row?.data) return null;
  const comma = row.data.indexOf(",");
  if (comma < 0) return null;
  const body = Buffer.from(row.data.slice(comma + 1), "base64");
  // ETag on rivin id + koko: kuva on muuttumaton kunnes se korvataan, ja
  // korvaus muuttaa kokoa lähes aina. Riittää 304-vastauksiin.
  return { body, mime: row.mime || "image/png", etag: `"plan-${row.id}-${body.length}"` };
}

/** Poista kerroksen pohjakuva. Palauttaa true jos rivi oli olemassa. */
export async function deletePlanImage(jobId: number, floor: string): Promise<boolean> {
  const gone = await db.delete(jobAssets).where(and(
    eq(jobAssets.jobId, jobId),
    eq(jobAssets.kind, "floor_plan"),
    eq(jobAssets.refKey, floor.slice(0, 200)),
  )).returning({ id: jobAssets.id });
  return gone.length > 0;
}

/**
 * Yhden keikan kokomittari — ilman että mitään dataa ladataan.
 *
 * Tämä on se luku jota ei ollut olemassa kun kiintiö loppui: kukaan ei nähnyt
 * että karttablobi oli kasvanut kymmeniin megatavuihin. `blobBytes` on se mikä
 * luetaan kannasta JOKAISELLA ikkunanapautuksella, joten se on suoraan
 * kulutuksen mittari. `assetBytes` on se mikä on jo siirretty pois blobista
 * eikä siis enää maksa mitään karttapyynnössä.
 */
export async function assetStats(jobId: number): Promise<{
  count: number; bytes: number; blobBytes: number; gigBytes: number; perTapBytes: number;
}> {
  // Taulua ei ehkä ole vielä luotu (migraatio ei ole päässyt ajoon esim.
  // kiintiökatkon takia). Mittari ei saa siitä kaatua — se on juuri se työkalu
  // jolla tilannetta selvitetään, joten sen pitää vastata aina.
  let row: { count: number; bytes: number } | undefined;
  try {
    [row] = await db.select({
      count: sql<number>`count(*)::int`,
      bytes: sql<number>`coalesce(sum(${jobAssets.bytes}), 0)::int`,
    }).from(jobAssets).where(eq(jobAssets.jobId, jobId));
  } catch { row = undefined; }

  // `pg_column_size` antaa PAKATUN koon levyllä; `octet_length` antaa sen mikä
  // oikeasti siirtyy verkon yli. Siirtomittari kiinnostaa, joten jälkimmäinen.
  let blobBytes = 0, gigBytes = 0;
  try {
    const r: any = await db.execute(sql`
      select coalesce(octet_length(project_data), 0)::int as blob,
             coalesce(octet_length(gig_data), 0)::int     as gig
      from jobs where id = ${jobId}
    `);
    const s = (r?.rows ?? r)?.[0];
    blobBytes = Number(s?.blob ?? 0);
    gigBytes = Number(s?.gig ?? 0);
  } catch { /* mittari ei saa kaataa mitään */ }

  return {
    count: Number(row?.count ?? 0),
    bytes: Number(row?.bytes ?? 0),
    blobBytes,
    gigBytes,
    // Yksi tekijän ikkunanapautus lukee karttablobin + gig-blobin.
    perTapBytes: blobBytes + gigBytes,
  };
}

export interface MigrationResult {
  jobId: number;
  moved: number;
  bytesFreed: number;
  /** Muuttuiko `project` — jos ei, kutsujan ei tarvitse kirjoittaa blobia. */
  changed: boolean;
}

/**
 * Siirrä YHDEN keikan inline-liitteet omaan tauluunsa ja korvaa ne viitteillä.
 *
 * Muokkaa annettua `project`-objektia paikallaan. Kutsuja vastaa tallennuksesta,
 * jotta siirto ja kirjoitus tapahtuvat kutsujan omassa transaktiologiikassa.
 *
 * Idempotentti: jo siirretyt (joilla on `...AssetId`) ohitetaan, joten ajon voi
 * toistaa. Ei koskaan poista dataa ennen kuin se on tallessa uudessa taulussa —
 * `putAsset` ajetaan ensin ja inline-kenttä tyhjennetään vasta sen jälkeen.
 */
export async function migrateJobAssets(jobId: number, project: ProjectData): Promise<MigrationResult> {
  let moved = 0;
  let bytesFreed = 0;

  // 1. Havaintokuvat.
  for (const [key, obs] of Object.entries(project.observations ?? {})) {
    if (!obs?.imageDataUrl || obs.imageAssetId) continue;
    const id = await putAsset(jobId, "observation", key, obs.imageDataUrl);
    bytesFreed += obs.imageDataUrl.length;
    obs.imageAssetId = id;
    delete obs.imageDataUrl;
    moved++;
  }

  // 2. Kulukuitit.
  for (const exp of project.expenses ?? []) {
    const e = exp as any;
    if (!e.receipt || e.receiptAssetId) continue;
    const id = await putAsset(jobId, "expense_receipt", String(e.id ?? `exp_${moved}`), e.receipt);
    bytesFreed += String(e.receipt).length;
    e.receiptAssetId = id;
    delete e.receipt;
    moved++;
  }

  // 3. Tekijöiden tositteet ja maksukuitit.
  for (const member of project.crew ?? []) {
    for (const doc of member.documents ?? []) {
      if (!doc.fileDataUrl || doc.fileAssetId) continue;
      const id = await putAsset(jobId, "crew_document", `${member.id}:${doc.id}`, doc.fileDataUrl);
      bytesFreed += doc.fileDataUrl.length;
      doc.fileAssetId = id;
      doc.fileBytes = doc.fileDataUrl.length;
      delete doc.fileDataUrl;
      moved++;
    }
    for (const payout of member.payouts ?? []) {
      for (const exp of (payout as any).expenses ?? []) {
        if (!exp?.receiptDataUrl || exp.receiptAssetId) continue;
        const id = await putAsset(
          jobId, "payout_receipt", `${member.id}:${payout.id}:${exp.id ?? "0"}`, exp.receiptDataUrl,
        );
        bytesFreed += String(exp.receiptDataUrl).length;
        exp.receiptAssetId = id;
        delete exp.receiptDataUrl;
        moved++;
      }
    }
  }

  return { jobId, moved, bytesFreed, changed: moved > 0 };
}
