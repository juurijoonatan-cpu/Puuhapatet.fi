import { describe, expect, it } from "vitest";
import { emptyGigData, sanitizeGigData, signatureRequired, signaturePrompt, contractPending, hasContractDoc, sanitizeContractFile, type GigData } from "./gig";

/**
 * SOPIMUKSEN AJOITUS.
 *
 * Aiemmin asiakkaalle näytettävä sopimustila pääteltiin kahdesta kentästä
 * jokaisessa näkymässä erikseen, ja siitä syntyi kolme vikaa:
 *
 *   1. sopimustekstin liittäminen jälkikäteen käänsi koko sivun portin päälle ja
 *      heitti seurantaa katsovan asiakkaan takaisin lomakkeelle ilman selitystä,
 *   2. jos ylläpito otti portin pois mutta sopimus oli olemassa, asiakas ei
 *      nähnyt sopimusta MISSÄÄN eikä voinut allekirjoittaa sitä,
 *   3. rahaan vaikuttavat keltaisten toiminnot avautuivat heti kun portti oli
 *      pois päältä — myös silloin kun sopimus oli allekirjoittamatta.
 *
 * `signaturePrompt` on yksi vastaus, ja nämä testit pitävät sen kolme tilaa
 * erillään.
 */

const gig = (over: Partial<GigData>): GigData => ({ ...emptyGigData(), ...over });
const signed = { signedAt: 1, signerName: "Akseli", customer: { legalName: "Stuhi ry" }, signatureDataUrl: "x" } as any;

describe("signatureRequired", () => {
  it("ei sopimustekstiä, ei porttia", () => {
    expect(signatureRequired(gig({}))).toBe(false);
  });

  it("sopimusteksti kääntää portin päälle kun mitään ei ole valittu", () => {
    expect(signatureRequired(gig({ contractText: "Ehdot…" }))).toBe(true);
  });

  it("tyhjä sopimusteksti ei ole sopimus", () => {
    expect(signatureRequired(gig({ contractText: "   \n " }))).toBe(false);
  });

  it("nimenomainen valinta voittaa pääteltävän", () => {
    expect(signatureRequired(gig({ contractText: "Ehdot…", requireSignature: false }))).toBe(false);
    expect(signatureRequired(gig({ requireSignature: true }))).toBe(true);
  });

  it("contractLater voittaa KAIKEN — myös sopimustekstin ja nimenomaisen rastin", () => {
    // Tämä on koko pointti: kun sopimus tehdään myöhemmin, koko sivun portti ei
    // saa koskaan mennä päälle asiakkaan alta.
    expect(signatureRequired(gig({ contractLater: true, contractText: "Ehdot…" }))).toBe(false);
    expect(signatureRequired(gig({ contractLater: true, requireSignature: true }))).toBe(false);
  });
});

describe("signaturePrompt", () => {
  it("ei sopimusta = ei kehotetta", () => {
    expect(signaturePrompt(gig({}))).toBe("none");
    expect(signaturePrompt(gig({ contractLater: true }))).toBe("none");
  });

  it("sopimus ja portti = koko sivun portti", () => {
    expect(signaturePrompt(gig({ contractText: "Ehdot…" }))).toBe("gate");
    expect(signaturePrompt(gig({ contractText: "Ehdot…", requireSignature: true }))).toBe("gate");
  });

  it("sopimus ilman porttia = popup — ei enää näkymätön sopimus", () => {
    expect(signaturePrompt(gig({ contractText: "Ehdot…", contractLater: true }))).toBe("popup");
    expect(signaturePrompt(gig({ contractText: "Ehdot…", requireSignature: false }))).toBe("popup");
  });

  it("allekirjoitettu = ei kehotetta, missään muodossa", () => {
    for (const over of [
      { contractText: "Ehdot…" },
      { contractText: "Ehdot…", contractLater: true },
      { contractText: "Ehdot…", requireSignature: true },
    ]) {
      expect(signaturePrompt(gig({ ...over, signature: signed }))).toBe("none");
    }
  });
});

describe("sanitizeGigData", () => {
  it("säilyttää contractLaterin — kenttä katoaisi hiljaa jos se puuttuisi sanitoijasta", () => {
    // Sanitoija rakentaa palautuksen kenttä kerrallaan ilman spreadia, ja
    // allekirjoitusreitti tallentaa blobin sen läpi. Puuttuva kenttä olisi
    // kadonnut ensimmäisessä tallennuksessa.
    expect(sanitizeGigData({ ...emptyGigData(), contractLater: true }).contractLater).toBe(true);
    expect(sanitizeGigData({ ...emptyGigData(), contractLater: false }).contractLater).toBe(false);
    expect(sanitizeGigData({ ...emptyGigData() }).contractLater).toBeUndefined();
  });

  it("roska ei mene läpi lippuna", () => {
    expect(sanitizeGigData({ ...emptyGigData(), contractLater: "kyllä" as any }).contractLater).toBeUndefined();
  });
});

/**
 * SOPIMUS ON VALMISTELUSSA.
 *
 * Asiakkaan näkymässä lukee "sopimus valmistelussa · toimitetaan lähipäivinä".
 * Se on LUPAUS, joten se ei saa näkyä keikalla jolle sopimusta ei ole tarkoitus
 * tehdä lainkaan — pelkkä puuttuva sopimusteksti ei riitä ehdoksi.
 */
describe("contractPending", () => {
  const gig = (over: Partial<GigData>): GigData => ({ ...emptyGigData(), ...over });

  it("tosi vain kun sopimus on nimenomaisesti myöhemmin JA sitä ei vielä ole", () => {
    expect(contractPending(gig({ contractLater: true }))).toBe(true);
  });

  it("epätosi keikalla jolle sopimusta ei ole tarkoitus tehdä", () => {
    // Tämä on se väärä lupaus jota vältetään: ei sopimustekstiä, mutta ei myöskään
    // valintaa "tehdään myöhemmin" → sivulla ei saa lukea että sopimus on tulossa.
    expect(contractPending(gig({}))).toBe(false);
  });

  it("epätosi heti kun sopimusteksti on olemassa", () => {
    expect(contractPending(gig({ contractLater: true, contractText: "1 § Työn kohde…" }))).toBe(false);
    // Pelkkä välilyönti ei ole sopimus.
    expect(contractPending(gig({ contractLater: true, contractText: "   " }))).toBe(true);
  });

  it("epätosi kun sopimus on allekirjoitettu", () => {
    expect(contractPending(gig({
      contractLater: true,
      signature: { signerName: "Akseli Kettunen", signedAt: 1, signatureDataUrl: "x", customer: { legalName: "Stuhi ry" } },
    }))).toBe(false);
  });

  it("säilyy tallennuksen läpi (sanitizeGigData ei pudota lippua)", () => {
    const saved = sanitizeGigData({ ...emptyGigData(), contractLater: true });
    expect(contractPending(saved)).toBe(true);
  });
});

/**
 * SOPIMUS TIEDOSTONA (`contractFile`).
 *
 * Sopimus on käytännössä aina PDF. Ennen tätä kenttää järjestelmä tunsi vain
 * `contractText`in, ja jokainen sopimustilaa laskeva funktio kysyi sitä
 * erikseen. Nämä testit pitävät kiinni siitä että liitetty tiedosto on
 * asiakirja SAMALLA tavalla kuin teksti — ei puolittain:
 *
 *   - sen voi allekirjoittaa (`signaturePrompt` ≠ "none"),
 *   - se sammuttaa "sopimus valmistelussa" -lupauksen (`contractPending`),
 *   - se säilyy tallennuksen läpi (`sanitizeGigData`).
 *
 * Jos yksi näistä jää jälkeen, syntyy keikka jolla on sopimus mutta jota ei voi
 * allekirjoittaa — tai jonka asiakas näkee sopimuksensa ja sen vieressä
 * lupauksen että sopimus toimitetaan myöhemmin.
 */
describe("sopimus tiedostona", () => {
  const file = { assetId: 12, name: "STUHI_Ikkunanpesu_PT202604.pdf", mime: "application/pdf", bytes: 546_076, uploadedAt: 1 };
  const withFile = (over: Partial<GigData> = {}): GigData => ({ ...emptyGigData(), contractFile: file, ...over });

  it("tiedosto on asiakirja, ihan kuten teksti", () => {
    expect(hasContractDoc(withFile())).toBe(true);
    expect(hasContractDoc(gig({ contractText: "Ehdot…" }))).toBe(true);
    expect(hasContractDoc(gig({}))).toBe(false);
    // Tyhjä teksti EI ole asiakirja, mutta tiedosto tyhjän tekstin rinnalla on.
    expect(hasContractDoc(gig({ contractText: "   " }))).toBe(false);
    expect(hasContractDoc(withFile({ contractText: "   " }))).toBe(true);
  });

  it("pelkkä tiedosto riittää allekirjoitettavaksi", () => {
    // Ei sopimustekstiä lainkaan: ennen tätä portti oli pois ja popup ei
    // noussut, eli asiakas ei nähnyt sopimustaan missään.
    expect(signatureRequired(withFile())).toBe(true);
    expect(signaturePrompt(withFile())).toBe("gate");
    // "Sopimus tehdään myöhemmin" -keikalla sama tiedosto nousee popuppina eikä
    // heitä seurantaa katsovaa asiakasta lomakkeelle.
    expect(signaturePrompt(withFile({ contractLater: true }))).toBe("popup");
  });

  it("liitetty tiedosto sammuttaa 'sopimus valmistelussa' -lupauksen", () => {
    expect(contractPending(gig({ contractLater: true }))).toBe(true);
    expect(contractPending(withFile({ contractLater: true }))).toBe(false);
  });

  it("säilyy tallennuksen läpi", () => {
    const saved = sanitizeGigData(withFile({ contractLater: true }));
    expect(saved.contractFile).toEqual(file);
    expect(contractPending(saved)).toBe(false);
  });

  it("kelvoton viite pudotetaan kokonaan — luvattu sopimus jota ei ole on pahempi kuin ei sopimusta", () => {
    expect(sanitizeContractFile(undefined)).toBeUndefined();
    expect(sanitizeContractFile({ name: "sopimus.pdf" })).toBeUndefined();      // ei assetId:tä
    expect(sanitizeContractFile({ assetId: 0, name: "x.pdf" })).toBeUndefined();
    expect(sanitizeContractFile({ assetId: -3 })).toBeUndefined();
    expect(sanitizeContractFile({ assetId: 1.5 })).toBeUndefined();
    // Nimetön mutta kelvollinen viite saa oletusnimen — tiedosto on oikeasti olemassa.
    expect(sanitizeContractFile({ assetId: 7 })?.name).toBe("sopimus.pdf");
    // Ja liian pitkä nimi katkaistaan sen sijaan että rivi hylättäisiin.
    expect(sanitizeContractFile({ assetId: 7, name: "a".repeat(400) })?.name.length).toBe(200);
  });
});
