import { describe, expect, it } from "vitest";
import { sanitizeProjectData } from "./project";

/**
 * "KESKEN JÄTTÄNYT TEKIJÄ" katosi joka tallennuksessa.
 *
 * Palvelin kirjoitti `project.keskenBy[key] = member.id` aina kun tekijä
 * merkitsi ikkunan keskeneräiseksi, mutta `sanitizeProjectData` ei tuntenut
 * kenttää — ja mitä se ei nimeä, sitä ei kirjoiteta. Kartan ikkunavalikossa
 * oli valmis rivi "Kesken: <nimi>", joka ei voinut koskaan näyttää mitään.
 */
const base = (over: any = {}) => sanitizeProjectData({
  version: 1,
  building: { floors: ["1"] },
  statuses: { "1#0": "kesken", "1#1": "pesty", "1#2": "kesken" },
  washedBy: { "1#1": "jani" },
  ...over,
});

describe("keskenBy säilyy tallennuksessa", () => {
  it("säilyttää merkinnän kesken olevalle ikkunalle", () => {
    const p = base({ keskenBy: { "1#0": "selma" } });
    expect(p.keskenBy).toEqual({ "1#0": "selma" });
  });

  it("kaatuisi ennen korjausta: kenttä katosi kokonaan", () => {
    // Sama syöte kuin yllä — ennen korjausta tulos oli undefined.
    expect(base({ keskenBy: { "1#0": "selma" } }).keskenBy).toBeDefined();
  });

  it("ei säilytä merkintää pestylle ikkunalle", () => {
    // Pesty ikkuna ei ole kesken; muuten vanha merkintä jäisi roikkumaan.
    expect(base({ keskenBy: { "1#1": "selma" } }).keskenBy).toEqual({});
  });

  it("ei säilytä merkintää ikkunalle jolla ei ole tilaa", () => {
    expect(base({ keskenBy: { "1#9": "selma" } }).keskenBy).toEqual({});
  });

  it("kestää useamman keskeneräisen ja katkaisee liian pitkän id:n", () => {
    const p = base({ keskenBy: { "1#0": "selma", "1#2": "x".repeat(80) } });
    expect(Object.keys(p.keskenBy ?? {}).sort()).toEqual(["1#0", "1#2"]);
    expect(p.keskenBy!["1#2"]).toHaveLength(40);
  });

  it("sietää roskasyötteen", () => {
    expect(base({ keskenBy: null }).keskenBy).toEqual({});
    expect(base({ keskenBy: "ei objekti" }).keskenBy).toEqual({});
    expect(base({ keskenBy: { "1#0": "" } }).keskenBy).toEqual({});
  });
});
