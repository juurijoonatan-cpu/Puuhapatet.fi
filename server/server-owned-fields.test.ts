import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * VARTIJA — serverin omistamat projektikentät suojataan KAHDESSA paikassa.
 *
 * `ProjectData`ssa on kenttiä joita selaimen kopio ei koskaan omista:
 * `p2` (asiakkaan lukitsemat hinnat), `guided` (perustajan ohjausasetus),
 * `settlement` (kuka sai erän, kuka maksoi tekijän), `building.planImages`
 * (ladatut pohjakuvat) ja `scope` (asiakkaan laajuusvastaukset). Niitä
 * mutatoidaan vain omilta reiteiltään, ja jokainen geneerinen blob-tallennus
 * lukee kannan tuoreimman arvon juuri ennen kirjoitusta.
 *
 * MIKSI TÄMÄ TESTI ON: suojauksia on KAKSI TOISISTAAN RIIPPUMATONTA polkua.
 *
 *   1. `saveProject()` — tekijän merkinnät ja kaikki reittien tallennukset.
 *   2. `PATCH /api/jobs/:id/project` — adminin karttanäkymän autosave, joka
 *      EI kutsu `saveProject`ia vaan kirjoittaa itse.
 *
 * Kun `scope` lisättiin, se suojattiin vain polussa 1. Polku 2 lähettää koko
 * blobin 700 ms jokaisen kartan muutoksen jälkeen, joten adminin yksi
 * pistesiirto olisi pyyhkinyt asiakkaan juuri antamat vastaukset. Vika ei näy
 * missään yksikkötestissä, koska molemmat polut "toimivat" — ne vain
 * kirjoittavat eri totuuden.
 *
 * Jos tämä kaatuu: lisää kenttä siihen polkuun josta se puuttuu. Älä poista
 * kenttää listalta.
 */

const SRC = readFileSync(join(process.cwd(), "server/routes.ts"), "utf8");

/** Serverin omistamat kentät ja se `stored?.x` -muoto jolla ne palautetaan. */
const OWNED = ["p2", "guided", "settlement", "scope"] as const;

/** `PATCH /api/jobs/:id/project` -käsittelijän runko. */
function adminProjectPatchBody(): string {
  const start = SRC.indexOf('app.patch("/api/jobs/:id/project"');
  expect(start).toBeGreaterThan(0);
  // Käsittelijä päättyy seuraavaan reittirekisteröintiin.
  const next = SRC.indexOf("\n  app.", start + 10);
  return SRC.slice(start, next > 0 ? next : SRC.length);
}

/** `saveProject`-funktion runko. */
function saveProjectBody(): string {
  const start = SRC.indexOf("async function saveProject(");
  expect(start).toBeGreaterThan(0);
  const next = SRC.indexOf("\n  async function ", start + 10);
  const alt = SRC.indexOf("\n  function ", start + 10);
  const end = [next, alt].filter((n) => n > 0).sort((a, b) => a - b)[0] ?? SRC.length;
  return SRC.slice(start, end);
}

describe("serverin omistamat projektikentät on suojattu molemmissa tallennuspoluissa", () => {
  const patchBody = adminProjectPatchBody();
  const saveBody = saveProjectBody();

  it("kumpikin runko löytyi (testi itse ei saa olla tyhjä lupaus)", () => {
    expect(patchBody.length).toBeGreaterThan(500);
    expect(saveBody.length).toBeGreaterThan(500);
    expect(patchBody).toContain("sanitizeProjectData");
    expect(saveBody).toContain("sanitizeProjectData");
  });

  it.each(OWNED)("adminin autosave palauttaa talletetun arvon: %s", (field) => {
    // `const storedX = stored?.<field>` + sijoitus takaisin.
    expect(patchBody).toMatch(new RegExp(`stored\\?\\.${field}\\b`));
    expect(patchBody).toMatch(new RegExp(`project\\.${field}\\s*=`));
    // Ja puuttuva arvo POISTETAAN — muuten selaimen vanhentunut kopio jäisi.
    expect(patchBody).toMatch(new RegExp(`delete project\\.${field}\\b`));
  });

  it.each(OWNED)("saveProject palauttaa talletetun arvon ellei se ole tämän reitin mutaatio: %s", (field) => {
    expect(saveBody).toMatch(new RegExp(`opts\\?\\.${field}Mutation`));
    expect(saveBody).toMatch(new RegExp(`clean\\.${field}\\s*=`));
    expect(saveBody).toMatch(new RegExp(`delete clean\\.${field}\\b`));
  });

  it.each(OWNED)("kenttä poimitaan kannasta alipuuna eikä koko blobina: %s", (field) => {
    // Rajaamaton `select project_data` olisi megatavuja verkon yli joka
    // ikkunanapautuksella — sama vika joka poltti kuukauden siirtokiintiön.
    expect(saveBody).toContain(`project_data::jsonb -> '${field}'`);
  });

  it("pohjakuvien viitteet on suojattu molemmissa", () => {
    expect(patchBody).toContain("stored?.building?.planImages");
    expect(saveBody).toMatch(/opts\?\.planMutation/);
  });
});

/**
 * VARTIJA — SOPIMUSTIEDOSTO on serverin omistama gigDatassa.
 *
 * `GigData.contractFile` on viite `job_assets`-riviin, ja se syntyy vain
 * `/contract-file`-reiteillä. Adminin sopimuslomake lähettää oman kopionsa koko
 * gigDatasta joka kerta kun tunnus, ALV-teksti tai sopimusteksti tallennetaan —
 * ja siinä kopiossa EI ole `contractFile`ä, koska lomake ei koske siihen.
 *
 * Ilman tätä suojausta liitetty sopimus katosi asiakkaan näkymästä seuraavalla
 * "Tallenna sopimus" -painalluksella: tiedosto jäi kantaan, mutta viite pyyhkiytyi
 * ja asiakkaan sivulle palasi "sopimus valmistelussa". Sama vika kuin projektin
 * `scope`-kentässä, eri blobissa.
 *
 * Jos tämä kaatuu: palauta talletettu arvo `PATCH /api/jobs/:id/gig`issä. Älä
 * poista kenttää tältä listalta.
 */
describe("sopimustiedosto on suojattu geneerisessä gigData-tallennuksessa", () => {
  /** `PATCH /api/jobs/:id/gig` -käsittelijän runko. */
  function gigPatchBody(): string {
    const start = SRC.indexOf('app.patch("/api/jobs/:id/gig"');
    expect(start).toBeGreaterThan(0);
    const next = SRC.indexOf("\n  app.", start + 10);
    return SRC.slice(start, next > 0 ? next : SRC.length);
  }

  const body = gigPatchBody();

  it("runko löytyi (testi itse ei saa olla tyhjä lupaus)", () => {
    expect(body.length).toBeGreaterThan(300);
    expect(body).toContain("sanitizeGigData");
  });

  it("talletettu viite luetaan ja palautetaan", () => {
    expect(body).toMatch(/parseGig\(job\.gigData\)/);
    expect(body).toMatch(/gig\.contractFile = storedGig\.contractFile/);
  });

  it("puuttuva viite POISTETAAN — selaimen vanhentunut kopio ei saa jäädä", () => {
    expect(body).toMatch(/delete gig\.contractFile/);
  });

  it("tiedosto itse ei ole blobissa vaan liitetaulussa", () => {
    // `putAsset(..., "contract_doc", ...)` on ainoa tapa jolla sisältö tallentuu.
    expect(SRC).toMatch(/putAsset\(\s*id,\s*"contract_doc"/);
    // Ja blobiin kirjoitetaan vain viite: assetId, nimi, koko, aika.
    expect(SRC).toMatch(/gig\.contractFile = \{/);
  });

  it("allekirjoitettua sopimusta ei voi vaihtaa eikä poistaa", () => {
    // Asiakas on allekirjoittanut juuri sen asiakirjan joka silloin näkyi.
    const uploads = SRC.split('app.post("/api/jobs/:id/contract-file"')[1] ?? "";
    const removes = SRC.split('app.delete("/api/jobs/:id/contract-file"')[1] ?? "";
    for (const [name, chunk] of [["POST", uploads], ["DELETE", removes]] as const) {
      expect(chunk.slice(0, 2000), `${name} /contract-file: allekirjoitusportti puuttuu`)
        .toMatch(/gig\.signature\?\.signedAt/);
    }
  });
});
