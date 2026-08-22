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

import { and, eq, notInArray, sql } from "drizzle-orm";
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
  | "observation" | "expense_receipt" | "payout_receipt" | "crew_document" | "floor_plan"
  /**
   * `contract_doc` on keikan sopimus PDF:nä (yksi per keikka, `refKey` =
   * "contract"). Kuuluu tähän tauluun samasta syystä kuin pohjakuva: gigData
   * luetaan joka kerta kun asiakas avaa seurannan, sopimus luetaan kerran.
   */
  | "contract_doc"
  /**
   * `contract_page` on sopimuksen yksi sivu KUVANA (`refKey` = "1".."N").
   *
   * Alkuperäinen PDF (`contract_doc`) säilytetään aina — se on se tiedosto
   * jonka asiakas lataa. Sivukuvat ovat lukupinta: `<object type="application/pdf">`
   * on selaimen liitännäinen, joka puhelimessa on kiinteän korkuinen
   * neulansilmä eikä monessa selaimessa vierity lainkaan. Kuvat piirtyvät joka
   * selaimessa samalla tavalla, ilman JS:ää ja ilman CORS-ehtoa.
   */
  | "contract_page";

/** Suurin talletettava pohjakuva (~2,5 MB data URL). Iso mutta kertaluonteinen:
 *  se ei ole blobissa eikä siis mukana karttapyynnöissä. */
export const MAX_PLAN_IMAGE_LEN = 3_500_000;

/**
 * Suurin talletettava sopimus-PDF: ~7 MB data URL ≈ 5 MB tiedosto.
 *
 * Sopimus on skannattuna ja allekirjoitettuna helposti megatavuja, ja sen
 * pienentäminen ennen latausta ei ole asia jota kenenkään pitäisi tehdä
 * sopimukselle. Sama perustelu kuin pohjakuvalla: tiedosto ei ole blobissa,
 * joten se maksaa vain silloin kun se luetaan.
 *
 * MIKSI EI 8 MB: `express.json` hyväksyy 8 MiB, ja data URL kulkee JSONin
 * sisällä (`{"dataUrl":"…","name":"…"}`). Tasan rajalla oleva tiedosto
 * kaatuisi bodyn kokorajaan ennen kuin tämä tarkistus ehtii vastata siitä
 * selkeästi — ja asiakas näkisi vain "413" ilman selitystä.
 */
export const MAX_CONTRACT_FILE_LEN = 7_000_000;

/** Keikan sopimustiedoston `refKey`: yksi sopimus per keikka. */
export const CONTRACT_REF_KEY = "contract";

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
  return putAssetWith(db, jobId, kind, refKey, dataUrl);
}

/** Sama kirjoitus annetulla yhteydellä — `db` tai transaktio. */
async function putAssetWith(
  conn: Pick<typeof db, "insert">,
  jobId: number, kind: AssetKind, refKey: string, dataUrl: string,
): Promise<number> {
  const row = {
    jobId, kind, refKey: refKey.slice(0, 200),
    mime: mimeOf(dataUrl), bytes: dataUrl.length, data: dataUrl,
  };
  const [saved] = await conn.insert(jobAssets).values(row)
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
  return rawAsset(jobId, "floor_plan", floor, "image/png", "plan");
}

/**
 * Keikan sopimus-PDF raakana tiedostona.
 *
 * SAMA POLKU KUIN POHJAKUVALLA, tarkoituksella: selain osaa näyttää PDF:n
 * `<object>`-upotuksessa vain jos se saa oikean `Content-Type`in ja bitit, ei
 * `{dataUrl}`-objektia. Yksi funktio molemmille, jotta base64:n purku,
 * ETag-muoto ja "ei löydy" -tila ovat samat kummallekin — kaksi kopiota
 * tarkoittaisi kaksi paikkaa jossa 304-vastaus voi mennä eri tavalla rikki.
 */
export async function getContractFile(
  jobId: number,
): Promise<{ body: Buffer; mime: string; etag: string } | null> {
  return rawAsset(jobId, "contract_doc", CONTRACT_REF_KEY, "application/pdf", "contract");
}

/**
 * Sopimuksen yksi sivu kuvana. Sama `rawAsset`-polku kuin PDF:llä ja
 * pohjakuvalla, joten base64:n purku, ETag-muoto ja "ei löydy" -tila ovat
 * kaikille samat.
 */
export async function getContractPage(
  jobId: number, page: number,
): Promise<{ body: Buffer; mime: string; etag: string } | null> {
  return rawAsset(jobId, "contract_page", String(page), "image/jpeg", "cpage");
}

/**
 * Talleta sopimuksen sivukuvat YHDESSÄ transaktiossa.
 *
 * MIKSI TRANSAKTIO: ilman sitä katkos kesken kirjoitusta (Neonin yhteys,
 * lauseen aikakatkos, palvelimen uudelleenkäynnistys) jättäisi kantaan kaksi
 * sopimusta limittäin — uuden alkusivut ja vanhan loppusivut — ja karsinta
 * ajamatta. Asiakas lukisi asiakirjaa jota ei ole koskaan ollut olemassa.
 *
 * Ylimääräiset sivut karsitaan "ei kuulu säilytettäviin" -ehdolla eikä
 * `refKey::int > N`:llä: cast kaataisi koko poiston jos tauluun olisi jostain
 * päätynyt ei-numeerinen `refKey`, eikä SQL takaa että `AND`in vasen ehto
 * suojaa oikeaa.
 */
export async function putContractPages(jobId: number, pageDataUrls: string[]): Promise<number> {
  await db.transaction(async (tx) => {
    for (let i = 0; i < pageDataUrls.length; i++) {
      await putAssetWith(tx, jobId, "contract_page", String(i + 1), pageDataUrls[i]);
    }
    const keep = pageDataUrls.map((_, i) => String(i + 1));
    await tx.delete(jobAssets).where(and(
      eq(jobAssets.jobId, jobId),
      eq(jobAssets.kind, "contract_page"),
      keep.length ? notInArray(jobAssets.refKey, keep) : sql`true`,
    ));
  });
  return pageDataUrls.length;
}

/** Poista sopimuksen sivukuvat. Palauttaa poistettujen määrän. */
export async function deleteContractPages(jobId: number): Promise<number> {
  const gone = await db.delete(jobAssets).where(and(
    eq(jobAssets.jobId, jobId),
    eq(jobAssets.kind, "contract_page"),
  )).returning({ id: jobAssets.id });
  return gone.length;
}

/**
 * Liitteen sisältö raakana: base64 purettuna, oikea mime ja ETag.
 *
 * ETag on rivin id + koko: liite on muuttumaton kunnes se korvataan, ja korvaus
 * muuttaa kokoa lähes aina. Riittää 304-vastauksiin.
 */
async function rawAsset(
  jobId: number, kind: AssetKind, refKey: string, fallbackMime: string, etagTag: string,
): Promise<{ body: Buffer; mime: string; etag: string } | null> {
  const [row] = await db.select({ id: jobAssets.id, mime: jobAssets.mime, data: jobAssets.data })
    .from(jobAssets)
    .where(and(
      eq(jobAssets.jobId, jobId),
      eq(jobAssets.kind, kind),
      eq(jobAssets.refKey, refKey.slice(0, 200)),
    ));
  if (!row?.data) return null;
  const comma = row.data.indexOf(",");
  if (comma < 0) return null;
  const body = Buffer.from(row.data.slice(comma + 1), "base64");
  return { body, mime: row.mime || fallbackMime, etag: `"${etagTag}-${row.id}-${body.length}"` };
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
 * Poista keikan sopimustiedosto JA sen sivukuvat. Palauttaa true jos PDF-rivi
 * oli olemassa.
 *
 * Sivut poistetaan samalla: jäljelle jäänyt sivujoukko olisi luettavissa
 * julkiselta reitiltä vielä senkin jälkeen kun sopimus on poistettu.
 */
export async function deleteContractFile(jobId: number): Promise<boolean> {
  const gone = await db.delete(jobAssets).where(and(
    eq(jobAssets.jobId, jobId),
    eq(jobAssets.kind, "contract_doc"),
    eq(jobAssets.refKey, CONTRACT_REF_KEY),
  )).returning({ id: jobAssets.id });
  await deleteContractPages(jobId);
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
