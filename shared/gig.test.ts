import { describe, expect, it } from "vitest";
import { emptyGigData, sanitizeGigData, signatureRequired, signaturePrompt, contractPending, type GigData } from "./gig";

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
