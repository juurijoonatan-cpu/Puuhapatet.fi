import { describe, expect, it } from "vitest";
import {
  computeEraBilling, sumWindows, TEKIJA_HINTA_CENTS, normalizeEraNumbers, eraRecipientFounderId,
  type JohtajaPesu, type TekijaPesu,
} from "./era-billing";

// Speksin kohta 7 — käytä yksikkötestinä. Ks. docs/fr8-era-laskutus-plan.md.
describe("computeEraBilling — kohdan 7 testitapaus (erät 1-3, S=4725€)", () => {
  const workers: TekijaPesu[] = [
    { workerId: "jani", name: "Jani", pestytIkkunat: 31, sovittuMuutosCents: 0, ennakkoCents: 38000 },
    { workerId: "milja", name: "Milja", pestytIkkunat: 16, sovittuMuutosCents: 2000, ennakkoCents: 0 },
    { workerId: "oliver", name: "Oliver", pestytIkkunat: 15, sovittuMuutosCents: 0, ennakkoCents: 0 },
    { workerId: "petra", name: "Petra", pestytIkkunat: 11, sovittuMuutosCents: 0, ennakkoCents: 0 },
    { workerId: "oona", name: "Oona", pestytIkkunat: 11, sovittuMuutosCents: 0, ennakkoCents: 0 },
    { workerId: "dom", name: "Dom", pestytIkkunat: 5, sovittuMuutosCents: 0, ennakkoCents: 0 },
  ];
  const founders: JohtajaPesu[] = [
    { founderId: "joonatan", name: "Joonatan", pestytIkkunat: 13.5 },
    { founderId: "matias", name: "Matias", pestytIkkunat: 24.5 },
  ];

  const result = computeEraBilling(472500, workers, founders);

  it("ikkunat yhteensä on 127, ei 128 (off-by-one)", () => {
    expect(result.kokonaisikkunat).toBe(127);
  });

  it("x pyöristetään 2 desimaaliin: 37,20 €", () => {
    expect(result.xCents).toBe(3720);
  });

  it("tekijät ansaittu yhteensä sisältää Miljan +20 €: 1800,00 €", () => {
    expect(result.tekijatAnsaittuYhtCents).toBe(180000);
  });

  it("Jani maksettava nyt = 620 - 380 = 240,00 € (ennakko ei vaikuta katteeseen)", () => {
    const jani = result.workers.find((w) => w.workerId === "jani")!;
    expect(jani.ansaittuCents).toBe(62000);
    expect(jani.maksettavaCents).toBe(24000);
  });

  it("johtajien omat: J 502,20 €, M 911,40 €", () => {
    const j = result.founders.find((f) => f.founderId === "joonatan")!;
    const m = result.founders.find((f) => f.founderId === "matias")!;
    expect(j.omatCents).toBe(50220);
    expect(m.omatCents).toBe(91140);
  });

  it("kate lasketaan jäännöksenä: 1511,40 €", () => {
    expect(result.kateCents).toBe(151140);
  });

  it("kate/2 = 755,70 € per johtaja", () => {
    for (const f of result.founders) expect(f.katePerJohtajaCents).toBe(75570);
  });

  it("loppusummat: J 1257,90 €, M 1667,10 €", () => {
    const j = result.founders.find((f) => f.founderId === "joonatan")!;
    const m = result.founders.find((f) => f.founderId === "matias")!;
    expect(j.loppusummaCents).toBe(125790);
    expect(m.loppusummaCents).toBe(166710);
  });

  it("tarkistus: tekijät + J + M loppusummat = S, ero 0", () => {
    const sum = result.tekijatAnsaittuYhtCents + result.founders.reduce((s, f) => s + f.loppusummaCents, 0);
    expect(sum).toBe(472500);
    expect(result.tarkistusEroCents).toBe(0);
  });
});

describe("sumWindows", () => {
  it("summaa desimaali-ikkunat tarkasti ilman rivikohtaista pyöristystä", () => {
    expect(sumWindows([13.5, 24.5, 31, 16, 15, 11, 11, 5])).toBe(127);
  });

  it("ei heitä yhdellä vaikka rivit olisivat .5-desimaalisia", () => {
    // Regressio: jos jokainen rivi pyöristettäisiin ennen summausta (13.5→14, 24.5→25 tms.)
    // summa heittäisi. Tarkka summaus ei saa tehdä näin.
    expect(sumWindows([0.5, 0.5, 0.5])).toBe(1.5);
  });

  it("tyhjä lista summautuu nollaksi", () => {
    expect(sumWindows([])).toBe(0);
  });
});

describe("computeEraBilling — reunatapaukset", () => {
  it("nolla ikkunaa ei kaadu (x=0, koko S menee katteeseen)", () => {
    const result = computeEraBilling(100000, [], [
      { founderId: "joonatan", name: "Joonatan", pestytIkkunat: 0 },
      { founderId: "matias", name: "Matias", pestytIkkunat: 0 },
    ]);
    expect(result.xCents).toBe(0);
    expect(result.kateCents).toBe(100000);
    expect(result.tarkistusEroCents).toBe(0);
  });

  it("negatiivinen sovittu muutos pienentää ansaittua ja katetta", () => {
    const workers: TekijaPesu[] = [
      { workerId: "a", name: "A", pestytIkkunat: 10, sovittuMuutosCents: -500, ennakkoCents: 0 },
    ];
    const founders: JohtajaPesu[] = [
      { founderId: "joonatan", name: "Joonatan", pestytIkkunat: 5 },
      { founderId: "matias", name: "Matias", pestytIkkunat: 5 },
    ];
    const result = computeEraBilling(50000, workers, founders);
    expect(result.workers[0].ansaittuCents).toBe(10 * TEKIJA_HINTA_CENTS - 500);
    expect(result.tarkistusEroCents).toBe(0);
  });

  it("pariton kate-senttimäärä jaetaan niin että summa täsmää S:ään sentilleen", () => {
    const founders: JohtajaPesu[] = [
      { founderId: "joonatan", name: "Joonatan", pestytIkkunat: 1 },
      { founderId: "matias", name: "Matias", pestytIkkunat: 1 },
    ];
    // x = 10001/2 -> rounded to nearest cent per window; pick totals that force an odd kate.
    const result = computeEraBilling(10001, [], founders);
    const founderSum = result.founders.reduce((s, f) => s + f.loppusummaCents, 0);
    expect(founderSum).toBe(result.totalCents);
    expect(result.tarkistusEroCents).toBe(0);
  });
});

// Vaihe 2: reititys- ja erävalinta-apufunktiot (server/routes.ts + dialogit
// käyttävät näitä molempia; kohta 1 + käyttäjän vahvistama "vapaa erävalinta,
// mutta vain 1-3 yhdessä tai 4 yksin" -sääntö).
describe("normalizeEraNumbers", () => {
  it("hyväksyy erät 1-3 yhdessä, missä tahansa syötejärjestyksessä", () => {
    expect(normalizeEraNumbers([3, 1, 2])).toEqual([1, 2, 3]);
    expect(normalizeEraNumbers([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("hyväksyy erän 4 yksin", () => {
    expect(normalizeEraNumbers([4])).toEqual([4]);
  });

  it("hylkää osajoukot, sekoitukset ja virheelliset syötteet", () => {
    expect(normalizeEraNumbers([1, 2])).toBeNull();
    expect(normalizeEraNumbers([1, 4])).toBeNull();
    expect(normalizeEraNumbers([1, 2, 3, 4])).toBeNull();
    expect(normalizeEraNumbers([5])).toBeNull();
    expect(normalizeEraNumbers([])).toBeNull();
    expect(normalizeEraNumbers("erä 1")).toBeNull();
    expect(normalizeEraNumbers(null)).toBeNull();
  });
});

describe("eraRecipientFounderId", () => {
  it("erät 1-3 -> joonatan, erä 4 -> matias", () => {
    expect(eraRecipientFounderId([1, 2, 3])).toBe("joonatan");
    expect(eraRecipientFounderId([4])).toBe("matias");
  });
});
