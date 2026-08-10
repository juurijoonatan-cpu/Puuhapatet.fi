import { describe, expect, it } from "vitest";
import { customerProgress, getPoints, type CustomerMap } from "./customer-progress";
import type { P2PublicOffer, P2PublicView } from "@/lib/api";

/**
 * VARTIJA. Asiakkaan kokonaisluku on sovittu tarkkaan:
 *
 *   · mukaan KAIKKI ikkunat, myös keltaiset joiden hintaa ei ole hyväksytty
 *     (työ on tehty, joten se näkyy edistymisenä);
 *   · pois HYLÄTYT keltaiset, sekä osoittajasta että nimittäjästä (muuten
 *     prosentti jäisi ikuisesti vajaaksi kun asiakas sanoo ei).
 *
 * Luku näkyy sivun pääkortissa ja se laskettiin ennen kartan sisällä. Kun
 * laskenta siirtyi omaan tiedostoonsa, tämä testi pitää säännön paikallaan.
 */

function mapWith(
  marks: { p: 1 | 2 }[],
  statuses: Record<string, "ei" | "kesken" | "pesty">,
  extra: Partial<CustomerMap> = {},
): CustomerMap {
  return {
    building: { name: null, address: null, floors: ["1"], planBase: "/x/" },
    marks: { "1": { marks: marks.map((m, i) => ({ p: m.p, x: i, y: i })) } } as CustomerMap["marks"],
    statuses,
    customMarks: {},
    posOverrides: {},
    deleted: {},
    ...extra,
  } as CustomerMap;
}

function offers(byKey: Record<string, P2PublicOffer["status"]>): P2PublicView {
  const offers: Record<string, P2PublicOffer> = {};
  for (const [key, status] of Object.entries(byKey)) {
    // Lukitulla tarjouksella on aina lockedCents — niin palvelin sen kirjoittaa.
    offers[key] = {
      status, priceCents: 3400, counterCents: null,
      lockedCents: status === "locked" ? 3400 : null, version: 1,
    } as P2PublicOffer;
  }
  return {
    enabled: true, termsAccepted: true, termsAcceptorName: null, termsAcceptedAt: null,
    termsText: null, offers, customerAddedKeys: [],
    billing: { lockedCount: 0, lockedWashedCount: 0, lockedSumCents: 0, proposedCount: 0 },
  } as unknown as P2PublicView;
}

describe("customerProgress", () => {
  it("vaiheessa 2 lasketaan kaikki pisteet, ei vain punaisia", () => {
    const map = mapWith(
      [{ p: 1 }, { p: 1 }, { p: 2 }, { p: 2 }],
      { "1#0": "pesty", "1#1": "pesty", "1#2": "pesty" },
    );
    expect(customerProgress(map, offers({}))).toMatchObject({ total: 4, done: 3, pct: 75 });
  });

  it("ennen vaihetta 2 keltaiset eivät ole mukana — ne eivät kuulu sopimukseen", () => {
    const map = mapWith(
      [{ p: 1 }, { p: 1 }, { p: 2 }, { p: 2 }],
      { "1#0": "pesty", "1#1": "pesty", "1#2": "pesty" },
    );
    // Punaiset 2/2 = 100 %. Keltainen ei nosta eikä laske lukua, eikä siitä
    // väitetä "odottaa hyväksyntääsi" kun neuvottelua ei ole olemassa.
    expect(customerProgress(map, null)).toEqual({ total: 2, done: 2, awaiting: 0, pct: 100, p2AccruedCents: 0, p2AccruedCount: 0 });
  });

  it("hyväksymätön keltainen on mukana sekä pestynä että kokonaismäärässä", () => {
    const map = mapWith([{ p: 1 }, { p: 2 }], { "1#0": "pesty", "1#1": "pesty" });
    const p2 = offers({ "1#1": "proposed" });
    // 2/2 = 100 %: työ on tehty vaikka hinnasta ei ole vielä sovittu.
    expect(customerProgress(map, p2)).toMatchObject({ total: 2, done: 2, pct: 100, awaiting: 1 });
  });

  it("PESEMÄTÖN hylätty keltainen katoaa kokonaan — myös nimittäjästä", () => {
    const map = mapWith([{ p: 1 }, { p: 2 }], { "1#0": "pesty" });
    expect(customerProgress(map, offers({}))).toMatchObject({ total: 2, done: 1, pct: 50 });
    expect(customerProgress(map, offers({ "1#1": "declined" }))).toMatchObject({ total: 1, done: 1, pct: 100 });
  });

  it("PESTY hylätty keltainen EI katoa — se on yhä odottava, aivan kuten ehdotettu", () => {
    // VIKA JOTA TÄMÄ VARTIOI: kun hylätystä tuli tavallinen odottava
    // (`shared/p2.ts`, p2PendingPriceCents), tätä tiedostoa ei päivitetty.
    // Samalla ruudulla luki yhtä aikaa "12 ikkunaa odottaa hyväksyntääsi" ja
    // edistymisprosentti josta ne 3 hylättyä puuttuivat — sekä osoittajasta
    // että nimittäjästä. Tehtyä työtä ei voi perua asiakkaan painalluksella.
    const map = mapWith([{ p: 2 }, { p: 2 }], { "1#0": "pesty", "1#1": "pesty" });
    const both = customerProgress(map, offers({ "1#0": "proposed", "1#1": "declined" }));
    expect(both).toMatchObject({ total: 2, done: 2, pct: 100, awaiting: 2 });
  });

  it("hylätty ei saa laskea prosenttia pesemällä lisää", () => {
    // Sama kerros ennen ja jälkeen hylkäyksen: pesty ikkuna on pesty. Vanhalla
    // säännöllä hylkäys pudotti ikkunan pois molemmista luvuista, jolloin
    // 2/3 = 67 % muuttui 1/2 = 50 % — prosentti LASKI ilman että mitään
    // muuttui työmaalla. Juuri se romuttaa luottamuksen lukuun.
    const map = mapWith([{ p: 2 }, { p: 2 }, { p: 2 }], { "1#0": "pesty", "1#1": "pesty" });
    const before = customerProgress(map, offers({ "1#0": "proposed", "1#1": "proposed", "1#2": "proposed" }));
    const after = customerProgress(map, offers({ "1#0": "proposed", "1#1": "declined", "1#2": "proposed" }));
    expect(before).toMatchObject({ total: 3, done: 2, pct: 67 });
    expect(after).toMatchObject({ total: 3, done: 2, pct: 67 });
  });

  it("sovittu (locked) keltainen ei odota hyväksyntää", () => {
    const map = mapWith([{ p: 2 }, { p: 2 }], { "1#0": "pesty", "1#1": "pesty" });
    const p2 = offers({ "1#0": "locked", "1#1": "proposed" });
    expect(customerProgress(map, p2).awaiting).toBe(1);
  });

  it("KERTYNYT on vain pesty JA sovittu — ei sovittua pesemätöntä", () => {
    const map = mapWith(
      [{ p: 2 }, { p: 2 }, { p: 2 }],
      { "1#0": "pesty", "1#2": "pesty" },      // 1#1 sovittu mutta pesemättä
    );
    const p2 = offers({ "1#0": "locked", "1#1": "locked", "1#2": "proposed" });
    const r = customerProgress(map, p2);
    // Sovittuja on kaksi (68,00 €) mutta kertynyt vain yksi: se joka on pesty.
    expect(r.p2AccruedCount).toBe(1);
    expect(r.p2AccruedCents).toBe(3400);
    // Pesty mutta hyväksymätön on "odottaa", ei "kertynyt".
    expect(r.awaiting).toBe(1);
  });

  it("KERTYNYT käyttää lukittua hintaa, ei alkuperäistä ehdotusta", () => {
    const map = mapWith([{ p: 2 }], { "1#0": "pesty" });
    const p2 = offers({ "1#0": "locked" });
    p2.offers["1#0"].lockedCents = 2800;      // asiakkaan vastatarjous voitti
    expect(customerProgress(map, p2).p2AccruedCents).toBe(2800);
  });

  it("lukittu ilman lukittua hintaa ei ole kertynyt vaan yhä avoin", () => {
    // Sama tulkinta kuin shared/p2.ts:ssä — muuten asiakkaan näkymä ja
    // laskentakone kertoisivat eri summan samasta ikkunasta.
    const map = mapWith([{ p: 2 }], { "1#0": "pesty" });
    const p2 = offers({ "1#0": "locked" });
    p2.offers["1#0"].lockedCents = null;
    expect(customerProgress(map, p2)).toMatchObject({ p2AccruedCents: 0, p2AccruedCount: 0, awaiting: 1 });
  });

  it("pesemätön keltainen ei odota hyväksyntää (mitään ei ole vielä tehty)", () => {
    const map = mapWith([{ p: 2 }], {});
    expect(customerProgress(map, offers({ "1#0": "proposed" }))).toMatchObject({ total: 1, done: 0, awaiting: 0, pct: 0 });
  });

  it("poistetut pisteet eivät ole mukana, siirretyt ovat", () => {
    const map = mapWith([{ p: 1 }, { p: 1 }], { "1#1": "pesty" }, {
      deleted: { "1#0": true },
      posOverrides: { "1#1": { x: 50, y: 50 } },
    });
    expect(customerProgress(map, offers({}))).toMatchObject({ total: 1, done: 1, pct: 100 });
    expect(getPoints("1", map)).toEqual([{ key: "1#1", p: 1, x: 50, y: 50 }]);
  });

  it("tyhjä kartta ei kaadu eikä jaa nollalla", () => {
    expect(customerProgress(null, null)).toEqual({ total: 0, done: 0, awaiting: 0, pct: 0, p2AccruedCents: 0, p2AccruedCount: 0 });
    expect(customerProgress(mapWith([], {}), null)).toMatchObject({ total: 0, pct: 0 });
  });
});
