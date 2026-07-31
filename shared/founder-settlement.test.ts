import { describe, expect, it } from "vitest";
import { computeTasaus, splitEvenCents, type TasausFounderInput } from "./founder-settlement";

/**
 * TÄRKEIN TESTI: tasausmoottorin ANSAINTA-puolen pitää tuottaa TÄSMÄLLEEN samat
 * luvut kuin `computeEraBilling` (docs/fr8-era-laskutus-plan.md kohta 7). Jos
 * nämä eroavat, meillä on kaksi eri totuutta siitä mitä johtaja ansaitsee.
 *
 * Kohdan 7 syöte: S = 4725 €, tekijät 89 ikkunaa / 1800 € (sis. Miljan +20 €),
 * johtajat J 13,5 ja M 24,5 → kokonaisikkunat 127.
 */
describe("computeTasaus — ansainta täsmää speksin kohdan 7 lukuihin", () => {
  const founders: TasausFounderInput[] = [
    { id: "joonatan", name: "Joonatan", p1Windows: 13.5, p2OwnCents: 0, receivedCents: 0, paidOutCents: 0 },
    { id: "matias", name: "Matias", p1Windows: 24.5, p2OwnCents: 0, receivedCents: 0, paidOutCents: 0 },
  ];
  const res = computeTasaus({
    founders,
    p1PotCents: 472_500,
    p2PotCents: 0,
    workerP1EarnedCents: 180_000,
    workerP2EarnedCents: 0,
    p1WindowsTotal: 127,
  });
  const j = res.rows.find((r) => r.id === "joonatan")!;
  const m = res.rows.find((r) => r.id === "matias")!;

  it("x = 37,20 € / ikkuna", () => {
    expect(res.xCents).toBe(3720);
  });

  it("omat ansiot: J 502,20 € ja M 911,40 €", () => {
    expect(j.ownWorkCents).toBe(50_220);
    expect(m.ownWorkCents).toBe(91_140);
  });

  it("kate jäännöksenä = 1511,40 €, puolikas 755,70 €", () => {
    expect(res.founderKateCents).toBe(151_140);
    expect(j.kateShareCents).toBe(75_570);
    expect(m.kateShareCents).toBe(75_570);
  });

  it("loppusummat: J 1257,90 € ja M 1667,10 €", () => {
    expect(j.entitledCents).toBe(125_790);
    expect(m.entitledCents).toBe(166_710);
  });

  it("tarkistus: tekijät + molempien ansainta === S (ero 0)", () => {
    expect(180_000 + j.entitledCents + m.entitledCents).toBe(472_500);
  });
});

/**
 * TODELLINEN TILANNE: Matias sai erän 1 rahat (1575 €) ja maksoi niistä
 * tekijöitä, Joonatan sai erät 2–3 (3150 €) ja maksoi loput. Kummankin
 * ansainta on sama kuin yllä — vain kassa on eri. Siirron pitää palauttaa
 * kumpikin täsmälleen omaan ansaintaansa.
 */
describe("computeTasaus — kassa vs. ansainta, kun raha liikkui toisin kuin paperilla", () => {
  const res = computeTasaus({
    founders: [
      // Joonatan laskutti ja sai erät 2–3, maksoi tekijöille 800 €.
      { id: "joonatan", name: "Joonatan", p1Windows: 13.5, p2OwnCents: 0, receivedCents: 315_000, paidOutCents: 80_000 },
      // Matias sai erän 1 ja maksoi tekijöille 1000 €, loput jäi hänelle.
      { id: "matias", name: "Matias", p1Windows: 24.5, p2OwnCents: 0, receivedCents: 157_500, paidOutCents: 100_000 },
    ],
    p1PotCents: 472_500,
    p2PotCents: 0,
    workerP1EarnedCents: 180_000,
    workerP2EarnedCents: 0,
    p1WindowsTotal: 127,
  });
  const j = res.rows.find((r) => r.id === "joonatan")!;
  const m = res.rows.find((r) => r.id === "matias")!;

  it("kassa: J pitää 2350 €, M pitää 575 €", () => {
    expect(j.holdsCents).toBe(235_000);
    expect(m.holdsCents).toBe(57_500);
  });

  it("varaus on 0 kun tekijät on maksettu täysin ja kaikki erät saatu", () => {
    expect(res.reserveCents).toBe(0);
  });

  it("Joonatan siirtää Matiakselle 1092,10 €", () => {
    expect(res.transfer).toEqual({ fromId: "joonatan", toId: "matias", cents: 109_210 });
  });

  it("siirron jälkeen molemmat pitävät täsmälleen ansaintansa", () => {
    expect(j.holdsCents - res.transfer!.cents).toBe(j.entitledCents);
    expect(m.holdsCents + res.transfer!.cents).toBe(m.entitledCents);
  });
});

/**
 * Kun tekijöille on vielä maksamatta, johtajien käsissä on rahaa joka ei kuulu
 * kummallekaan. Sitä EI jaeta — siirto tasaa vain johtajien keskinäisen eron,
 * ja varaus jää molemmille yhtä suurena.
 */
describe("computeTasaus — maksamaton tekijävelka jää yhteiseksi varaukseksi", () => {
  const res = computeTasaus({
    founders: [
      { id: "joonatan", name: "Joonatan", p1Windows: 13.5, p2OwnCents: 0, receivedCents: 315_000, paidOutCents: 30_000 },
      { id: "matias", name: "Matias", p1Windows: 24.5, p2OwnCents: 0, receivedCents: 157_500, paidOutCents: 100_000 },
    ],
    p1PotCents: 472_500,
    p2PotCents: 0,
    workerP1EarnedCents: 180_000,
    workerP2EarnedCents: 0,
    p1WindowsTotal: 127,
  });
  const j = res.rows.find((r) => r.id === "joonatan")!;
  const m = res.rows.find((r) => r.id === "matias")!;

  it("varaus = tekijöille vielä maksamatta oleva 500 €", () => {
    expect(res.reserveCents).toBe(50_000);
  });

  it("nettojen summa === varaus (täsmäytys)", () => {
    expect(j.netCents + m.netCents).toBe(res.checkCents);
  });

  it("siirto tasaa nettoerot: 1342,10 € Joonatanilta Matiakselle", () => {
    expect(res.transfer).toEqual({ fromId: "joonatan", toId: "matias", cents: 134_210 });
  });

  it("siirron jälkeen kumpikin kantaa TASAN puolet varauksesta", () => {
    const jAfter = j.holdsCents - res.transfer!.cents - j.entitledCents;
    const mAfter = m.holdsCents + res.transfer!.cents - m.entitledCents;
    expect(jAfter).toBe(25_000);
    expect(mAfter).toBe(25_000);
  });
});

describe("computeTasaus — keltaiset (P2) mukana", () => {
  const res = computeTasaus({
    founders: [
      { id: "joonatan", name: "Joonatan", p1Windows: 10, p2OwnCents: 4_000, receivedCents: 200_000, paidOutCents: 0 },
      { id: "matias", name: "Matias", p1Windows: 10, p2OwnCents: 0, receivedCents: 0, paidOutCents: 60_000 },
    ],
    p1PotCents: 200_000,
    p2PotCents: 50_000,
    workerP1EarnedCents: 60_000,
    workerP2EarnedCents: 20_000,
    p1WindowsTotal: 40, // 20 tekijöiltä + 20 johtajilta
  });

  it("x lasketaan VAIN punaisista (2000,00 € / 40 ikkunaa = 50,00 €)", () => {
    expect(res.xCents).toBe(5_000);
  });

  it("keltaisten oma palkkio on osa ansaintaa, ei osa x:ää", () => {
    const j = res.rows.find((r) => r.id === "joonatan")!;
    expect(j.ownWorkCents).toBe(50_000);
    expect(j.p2OwnCents).toBe(4_000);
  });

  it("jaettava = potit − tekijät = 1700,00 €, ja rivit summautuvat siihen", () => {
    expect(res.distributableCents).toBe(170_000);
    const sum = res.rows.reduce((s, r) => s + r.entitledCents, 0);
    expect(sum).toBe(170_000);
  });
});

describe("computeTasaus — kulut", () => {
  it("omasta pussista maksettu kulu pienentää jaettavaa ja palautuu maksajalle", () => {
    const res = computeTasaus({
      founders: [
        { id: "joonatan", name: "Joonatan", p1Windows: 10, p2OwnCents: 0, receivedCents: 100_000, paidOutCents: 0, expensesCents: 10_000 },
        { id: "matias", name: "Matias", p1Windows: 10, p2OwnCents: 0, receivedCents: 0, paidOutCents: 0 },
      ],
      p1PotCents: 100_000, p2PotCents: 0,
      workerP1EarnedCents: 0, workerP2EarnedCents: 0,
      p1WindowsTotal: 20,
    });
    // Jaettava 1000 − 100 kulut = 900. Molemmat pesivät 10/20 → x = 50 €/ikkuna,
    // omat 500 kummallekin, kate = 900 − 1000 = −100 → −50 kummallekin.
    expect(res.distributableCents).toBe(90_000);
    const j = res.rows.find((r) => r.id === "joonatan")!;
    const m = res.rows.find((r) => r.id === "matias")!;
    expect(j.entitledCents).toBe(45_000);
    expect(m.entitledCents).toBe(45_000);
    // J:llä on kassassa 1000 − 100 (oma kulu) = 900; hänen kuuluu 450 → siirtää 450.
    expect(j.holdsCents).toBe(90_000);
    expect(res.transfer).toEqual({ fromId: "joonatan", toId: "matias", cents: 45_000 });
  });
});

describe("computeTasaus — jo tehdyt siirrot ja käsin asetettu summa", () => {
  const base = {
    founders: [
      { id: "joonatan", name: "Joonatan", p1Windows: 13.5, p2OwnCents: 0, receivedCents: 315_000, paidOutCents: 80_000 },
      { id: "matias", name: "Matias", p1Windows: 24.5, p2OwnCents: 0, receivedCents: 157_500, paidOutCents: 100_000 },
    ],
    p1PotCents: 472_500, p2PotCents: 0,
    workerP1EarnedCents: 180_000, workerP2EarnedCents: 0,
    p1WindowsTotal: 127,
  };

  it("jo siirretty raha vähennetään jäljellä olevasta", () => {
    const res = computeTasaus({ ...base, transfers: [{ fromId: "joonatan", toId: "matias", cents: 91_170 }] });
    expect(res.grossTransfer!.cents).toBe(109_210);
    expect(res.alreadyTransferredCents).toBe(91_170);
    expect(res.transfer).toEqual({ fromId: "joonatan", toId: "matias", cents: 18_040 });
  });

  it("väärään suuntaan tehty siirto KASVATTAA jäljellä olevaa", () => {
    const res = computeTasaus({ ...base, transfers: [{ fromId: "matias", toId: "joonatan", cents: 10_000 }] });
    expect(res.alreadyTransferredCents).toBe(-10_000);
    expect(res.transfer).toEqual({ fromId: "joonatan", toId: "matias", cents: 119_210 });
  });

  it("liikaa siirretty kääntää siirron suunnan takaisin", () => {
    const res = computeTasaus({ ...base, transfers: [{ fromId: "joonatan", toId: "matias", cents: 150_000 }] });
    expect(res.transfer).toEqual({ fromId: "matias", toId: "joonatan", cents: 40_790 });
  });

  it("käsin asetettu summa ohittaa lasketun ja merkitään ohitetuksi", () => {
    const res = computeTasaus({ ...base, overrideCents: 100_000 });
    expect(res.overridden).toBe(true);
    expect(res.transfer).toEqual({ fromId: "joonatan", toId: "matias", cents: 100_000 });
  });

  it("käsin asetettu suunta kääntää maksajan", () => {
    const res = computeTasaus({ ...base, overrideCents: 5_000, overrideFromId: "matias" });
    expect(res.transfer).toEqual({ fromId: "matias", toId: "joonatan", cents: 5_000 });
  });

  it("käsin asetettu nolla tarkoittaa: ei siirtoa", () => {
    const res = computeTasaus({ ...base, overrideCents: 0 });
    expect(res.overridden).toBe(true);
    expect(res.transfer).toBeNull();
  });
});

describe("computeTasaus — reunatapaukset", () => {
  it("kun laskettu ero on nolla mutta rahaa on silti siirretty, se palautetaan", () => {
    const res = computeTasaus({
      founders: [
        { id: "joonatan", name: "Joonatan", p1Windows: 10, p2OwnCents: 0, receivedCents: 50_000, paidOutCents: 0 },
        { id: "matias", name: "Matias", p1Windows: 10, p2OwnCents: 0, receivedCents: 50_000, paidOutCents: 0 },
      ],
      p1PotCents: 100_000, p2PotCents: 0,
      workerP1EarnedCents: 0, workerP2EarnedCents: 0,
      p1WindowsTotal: 20,
      transfers: [{ fromId: "matias", toId: "joonatan", cents: 7_000 }],
    });
    expect(res.grossTransfer).toBeNull();
    expect(res.transfer).toEqual({ fromId: "joonatan", toId: "matias", cents: 7_000 });
  });

  it("nolla ikkunaa ei kaadu eikä jaa mitään x:n kautta", () => {
    const res = computeTasaus({
      founders: [
        { id: "joonatan", name: "Joonatan", p1Windows: 0, p2OwnCents: 0, receivedCents: 0, paidOutCents: 0 },
        { id: "matias", name: "Matias", p1Windows: 0, p2OwnCents: 0, receivedCents: 0, paidOutCents: 0 },
      ],
      p1PotCents: 0, p2PotCents: 0,
      workerP1EarnedCents: 0, workerP2EarnedCents: 0,
      p1WindowsTotal: 0,
    });
    expect(res.xCents).toBe(0);
    expect(res.transfer).toBeNull();
    expect(res.checkCents).toBe(0);
  });

  it("pariton kate jakautuu niin että rivit summautuvat jaettavaan sentilleen", () => {
    const res = computeTasaus({
      founders: [
        { id: "joonatan", name: "Joonatan", p1Windows: 1, p2OwnCents: 0, receivedCents: 0, paidOutCents: 0 },
        { id: "matias", name: "Matias", p1Windows: 1, p2OwnCents: 0, receivedCents: 0, paidOutCents: 0 },
      ],
      p1PotCents: 1_001, p2PotCents: 0,
      workerP1EarnedCents: 0, workerP2EarnedCents: 0,
      p1WindowsTotal: 2,
    });
    const sum = res.rows.reduce((s, r) => s + r.entitledCents, 0);
    expect(sum).toBe(res.distributableCents);
    expect(sum).toBe(1_001);
  });
});

describe("splitEvenCents", () => {
  it("jakaa parittoman sentin ensimmäisille", () => {
    expect(splitEvenCents(101, 2)).toEqual([51, 50]);
    expect(splitEvenCents(100, 3)).toEqual([34, 33, 33]);
  });

  it("säilyttää etumerkin ja summan negatiivisella", () => {
    const parts = splitEvenCents(-101, 2);
    expect(parts).toEqual([-51, -50]);
    expect(parts.reduce((s, p) => s + p, 0)).toBe(-101);
  });

  it("nolla jakajaa palauttaa tyhjän listan", () => {
    expect(splitEvenCents(500, 0)).toEqual([]);
  });
});

/**
 * MITÄTÖITY LASKUTUSERÄ säilyy tositteena mutta ei ole kenenkään rahaa.
 * Testi elää täällä koska tasaus on herkin paikka jossa virhe näkyisi:
 * mitätöity erä nostaisi pottia ja siirtäisi väärän summan johtajien välillä.
 */
describe("mitätöity erä ei ole rahaa", () => {
  it("p2InvoiceState ohittaa mitätöidyn erän", async () => {
    const { p2InvoiceState } = await import("./worker-payouts");
    const withVoid = p2InvoiceState(0, [
      { amountCents: 157_500 },
      { amountCents: 157_500, voided: true },
      { amountCents: 84_000, scope: "p2" },
    ]);
    expect(withVoid.p1InvoicedCents).toBe(157_500);
    expect(withVoid.p1Payments).toBe(1);
    expect(withVoid.invoicedCents).toBe(84_000);
  });

  it("buildTasaus ei laske mitätöityä erää pottiin", async () => {
    const { buildTasaus } = await import("./fr8-tasaus");
    const project = {
      version: 1 as const,
      building: { name: "T", address: "", floors: ["1"], planBase: "/fr8/plans/bp-" },
      pricePerWindow: 37.5,
      marks: { "1": { marks: [{ p: 1 as const, x: 1, y: 1 }, { p: 1 as const, x: 2, y: 2 }] } },
      statuses: { "1#0": "pesty" as const, "1#1": "pesty" as const },
      washedBy: { "1#0": "joonatan", "1#1": "matias" },
      customMarks: {}, posOverrides: {}, deleted: {}, log: [], hours: {}, hourLog: [],
      workers: [],
      crew: [
        { id: "joonatan", name: "Joonatan", token: "a", role: "host" as const, perWindowCents: 2000, active: true },
        { id: "matias", name: "Matias", token: "b", role: "host" as const, perWindowCents: 2000, active: true },
      ] as any,
      updatedAt: Date.now(),
    } as any;
    const live = buildTasaus(project, [
      { amountCents: 100_000, biller: { id: "joonatan" } },
      { amountCents: 100_000, biller: { id: "matias" }, voided: true },
    ], []);
    expect(live.input.p1PotCents).toBe(100_000);
    // Mitätöity rivi näkyy yhä historiassa.
    expect(live.eras).toHaveLength(2);
    expect(live.eras[1].voided).toBe(true);
    // Eikä sen rahaa lasketa Matiaksen kassaan.
    expect(live.result.rows.find((r) => r.id === "matias")!.receivedCents).toBe(0);
  });
});
