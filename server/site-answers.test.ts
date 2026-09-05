import { describe, expect, it } from "vitest";
import { answerFromSite, resolvePublicReply, SITE_ANSWER_TOPIC_IDS } from "./site-answers";

/** Lyhenne: mikä aihe tunnistettiin, tai null. */
const id = (q: string) => answerFromSite(q)?.id ?? null;

describe("answerFromSite — oikeat asiakaskysymykset", () => {
  it.each([
    ["Paljonko maksaa omakotitalon ikkunanpesu?", "hinta"],
    ["mitä hinta on", "hinta"],
    ["How much does window cleaning cost?", "hinta"],
    ["Toimitteko Tapiolassa?", "alue"],
    ["tuletteko helsinkiin", "alue"],
    ["Mitä ikkunanpesuun kuuluu?", "ikkunanpesu"],
    ["Peseekö te talvella pakkasella?", "talvi"],
    ["onko tämä kotitalousvähennyskelpoista", "kotitalousvahennys"],
    ["Miten maksu onnistuu, käykö mobilepay?", "maksu"],
    ["Voinko peruuttaa tilauksen?", "peruutus"],
    ["entä jos en ole tyytyväinen lopputulokseen", "takuu"],
    ["Onko teillä vakuutus jos jotain rikkoutuu?", "vakuutus"],
    ["Pitääkö minun valmistautua jotenkin?", "valmistautuminen"],
    ["Kuinka nopeasti vastaatte?", "aikataulu"],
    ["Teettekö taloyhtiöille?", "taloyhtio"],
    ["Voinko tilata kotisiivouksen?", "siivous"],
    ["Mikä on teidän puhelinnumero?", "yhteystiedot"],
    ["Miten tilaan teiltä pesun?", "tilaus"],
    ["Onko kartoituskäynti ilmainen?", "kartoitus"],
    ["Keitä te olette?", "keita"],
  ])("%s → %s", (question, expected) => {
    expect(id(question)).toBe(expected);
  });
});

describe("answerFromSite — ei arvaa", () => {
  it.each([
    "Mikä on Suomen pääkaupunki?",
    "kirjoita minulle runo",
    "asdfgh",
    "Voitteko korjata autoni jarrut?",
    "",
    "   ",
  ])("ei vastaa kysymykseen %j", (question) => {
    expect(answerFromSite(question)).toBeNull();
  });

  it("ei tulkitse pelkkää vihjesanaa aiheeksi", () => {
    // "ikkuna" on hinta-aiheen VIHJE (1 piste), ei avainsana. Yksin se ei riitä.
    expect(answerFromSite("ikkuna")).toBeNull();
  });
});

describe("answerFromSite — tervehdys", () => {
  it.each(["Moi", "hei!", "Terve", "hello", "hi"])("%s tunnistetaan tervehdykseksi", (g) => {
    expect(id(g)).toBe("tervehdys");
  });

  it("tervehdys ei syrjäytä samassa viestissä olevaa kysymystä", () => {
    expect(id("Moi, paljonko ikkunanpesu maksaa?")).toBe("hinta");
  });
});

describe("answerFromSite — kieli", () => {
  it("vastaa suomeksi suomenkieliseen", () => {
    const a = answerFromSite("Paljonko ikkunanpesu maksaa?");
    expect(a?.reply).toContain("Hinta sovitaan");
  });

  it("vastaa englanniksi englanninkieliseen", () => {
    const a = answerFromSite("How much does it cost?");
    expect(a?.reply).toContain("agreed in advance");
  });

  it("ääkköset ratkaisevat kielen englanninkielisiltä näyttävistä sanoista huolimatta", () => {
    const a = answerFromSite("Mitä maksaa window cleaning?");
    expect(a?.reply).toContain("Hinta sovitaan");
  });
});

describe("answerFromSite — luvatut asiat pitävät", () => {
  it("ei lupaa siivouspalvelua tilattavaksi", () => {
    const a = answerFromSite("Voinko tilata siivouksen ensi viikolle?");
    expect(a?.id).toBe("siivous");
    expect(a?.reply).toMatch(/eikä sitä voi vielä tilata/i);
  });

  it("kertoo peruutusehdot samoin kuin sopimusehdot", () => {
    const a = answerFromSite("miten peruutus toimii");
    expect(a?.reply).toContain("48 tuntia");
    expect(a?.reply).toContain("50 %");
    expect(a?.reply).toContain("100 %");
  });

  it("ohjaa reklamaation oikeaan osoitteeseen ja määräaikaan", () => {
    const a = answerFromSite("en ollut tyytyväinen, mitä teen");
    expect(a?.reply).toContain("info@puuhapatet.fi");
    expect(a?.reply).toContain("kahden vuorokauden");
  });

  it("tarjoaa ihmistä silloin kun kysymys vaatii tarjouksen", () => {
    expect(answerFromSite("Paljonko maksaa?")?.offerHandoff).toBe(true);
    expect(answerFromSite("Teettekö taloyhtiöille?")?.offerHandoff).toBe(true);
    // Puhdas faktakysymys ei tarvitse ihmistä.
    expect(answerFromSite("Toimitteko Espoossa?")?.offerHandoff).toBe(false);
  });
});

describe("aiheluettelo", () => {
  it("on uniikki", () => {
    expect(new Set(SITE_ANSWER_TOPIC_IDS).size).toBe(SITE_ANSWER_TOPIC_IDS.length);
  });

  it("kattaa sivuston UKK:n aiheet", () => {
    for (const needed of ["hinta", "alue", "maksu", "talvi", "kotitalousvahennys", "taloyhtio", "vakuutus", "valmistautuminen", "aikataulu", "siivous"]) {
      expect(SITE_ANSWER_TOPIC_IDS).toContain(needed);
    }
  });
});

/**
 * Julkisen chatin päätöspuu. Tämä on se osa jonka rikkoutuminen näkyi
 * asiakkaalle: botti vastasi kaikkeen "en juuri nyt pysty vastaamaan".
 */
describe("resolvePublicReply", () => {
  const fallback = "VARAVASTAUS";

  it("käyttää mallin vastausta kun malli vastasi", () => {
    const r = resolvePublicReply({ aiReply: "Mallin vastaus", message: "Paljonko maksaa?", wantsHuman: false, fallback });
    expect(r.source).toBe("ai");
    expect(r.reply).toBe("Mallin vastaus");
  });

  it("vastaa sivuston tiedoilla kun mallia ei ole", () => {
    const r = resolvePublicReply({ aiReply: null, message: "Paljonko ikkunanpesu maksaa?", wantsHuman: false, fallback });
    expect(r.source).toBe("site");
    expect(r.reply).toContain("Hinta sovitaan");
    expect(r.reply).not.toBe(fallback);
  });

  it("ei enää vastaa varavastauksella tunnettuun kysymykseen", () => {
    // Juuri tämä oli tuotannon vika: AI_API_KEY puuttui ja jokainen kysymys
    // sai varavastauksen, vaikka vastaus luki sivun UKK:ssa.
    for (const q of [
      "Paljonko maksaa omakotitalon ikkunanpesu Espoossa?",
      "Toimitteko Tapiolassa?",
      "Peseekö te talvella?",
      "Onko tämä kotitalousvähennyskelpoista?",
      "Miten voin peruuttaa?",
    ]) {
      const r = resolvePublicReply({ aiReply: null, message: q, wantsHuman: false, fallback });
      expect(r.source, q).toBe("site");
    }
  });

  it("luovuttaa ihmiselle vasta kun aihetta ei tunnisteta", () => {
    const r = resolvePublicReply({ aiReply: null, message: "Osaatteko korjata pesukoneen?", wantsHuman: false, fallback });
    expect(r.source).toBe("fallback");
    expect(r.reply).toBe(fallback);
    expect(r.offerHandoff).toBe(true);
  });

  it("tarjoaa ihmistä kun kysyjä pyytää sitä, vaikka aihe tunnistuisi", () => {
    const r = resolvePublicReply({ aiReply: null, message: "Toimitteko Espoossa? Haluaisin puhua ihmiselle", wantsHuman: true, fallback });
    expect(r.source).toBe("site");
    expect(r.offerHandoff).toBe(true);
  });
});
