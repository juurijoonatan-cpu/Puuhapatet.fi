import { describe, expect, it } from "vitest";
import { computeP2Billing, p2Itemisation, p2ExtraCharges, p2ExtraChargesCents, p2BillableCents, type P2Offer, type P2State } from "./p2";
import type { ProjectData, WindowStatus } from "./project";

/**
 * VARTIJA. Tämä on laskun perusta.
 *
 * Erittely ja laskutettava summa lasketaan eri funktioissa. Jos ne eroavat
 * sentinkin, lasku on väärä eikä kukaan huomaa — asiakas saa laskun rivistä
 * jota ei ole tai jää saamatta laskua tehdystä työstä. Nämä testit pitävät ne
 * yhdessä ja lukitsevat säännön: mukaan PESTY + SOVITTU, ei muuta.
 */

function project(
  perFloor: Record<string, { p: 1 | 2; status?: WindowStatus }[]>,
  offers: Record<string, P2Offer>,
): ProjectData {
  const marks: ProjectData["marks"] = {};
  const statuses: Record<string, WindowStatus> = {};
  for (const [f, pts] of Object.entries(perFloor)) {
    marks[f] = { marks: pts.map((pt, i) => ({ p: pt.p, x: i, y: i })) };
    pts.forEach((pt, i) => { if (pt.status) statuses[`${f}#${i}`] = pt.status; });
  }
  const p2: P2State = { enabled: true, workerSharePct: 50, offers, events: [] };
  return {
    building: { name: null, address: null, floors: Object.keys(perFloor), planBase: "/x/" },
    marks, statuses, washedBy: {}, customMarks: {}, posOverrides: {}, deleted: {},
    log: [], hours: {}, hourLog: [], workers: [], p2,
  } as unknown as ProjectData;
}

function locked(cents: number, by: "customer" | "admin" = "customer", at = 1_700_000_000_000): P2Offer {
  return { status: "locked", priceCents: cents, lockedCents: cents, lockedBy: by, lockedAt: at, version: 2, updatedAt: at };
}
function proposed(cents: number): P2Offer {
  return { status: "proposed", priceCents: cents, version: 1, updatedAt: 0 };
}

describe("p2Itemisation", () => {
  it("erittely täsmää laskutusperustaan sentilleen", () => {
    const data = project(
      { "1": [{ p: 2, status: "pesty" }, { p: 2, status: "pesty" }], "2": [{ p: 2, status: "pesty" }] },
      { "1#0": locked(3400), "1#1": locked(3750), "2#0": locked(3400) },
    );
    const it2 = p2Itemisation(data);
    expect(it2.totalCents).toBe(10550);
    expect(it2.earnedCents).toBe(computeP2Billing(data).earnedCents);
    expect(it2.matchesBilling).toBe(true);
  });

  it("sovittu mutta PESEMÄTÖN ei ole laskussa — työtä ei ole tehty", () => {
    const data = project({ "1": [{ p: 2, status: "pesty" }, { p: 2 }] }, { "1#0": locked(3400), "1#1": locked(3400) });
    const it2 = p2Itemisation(data);
    expect(it2.lines).toHaveLength(1);
    expect(it2.totalCents).toBe(3400);
    // Sovittu kokonaissumma on suurempi — juuri siksi laskuperusta on eri luku.
    expect(computeP2Billing(data).lockedSumCents).toBe(6800);
    expect(it2.matchesBilling).toBe(true);
  });

  it("pesty mutta HYVÄKSYMÄTÖN ei ole laskussa — hinnasta ei ole sovittu", () => {
    const data = project({ "1": [{ p: 2, status: "pesty" }, { p: 2, status: "pesty" }] },
      { "1#0": locked(3400), "1#1": proposed(3400) });
    const it2 = p2Itemisation(data);
    expect(it2.lines.map((l) => l.key)).toEqual(["1#0"]);
    expect(it2.matchesBilling).toBe(true);
  });

  it("punaiset eivät ole mukana", () => {
    const data = project({ "1": [{ p: 1, status: "pesty" }, { p: 2, status: "pesty" }] }, { "1#1": locked(3400) });
    expect(p2Itemisation(data).lines).toHaveLength(1);
  });

  it("numero on kerroksen KAIKKIEN keltaisten juokseva numero, ei laskurivien", () => {
    // Kerroksen 1. keltainen on hyväksymätön, 2. on laskussa → numeron on
    // oltava 2, koska asiakkaan kartalla se on ikkuna 2.
    const data = project({ "1": [{ p: 1 }, { p: 2, status: "pesty" }, { p: 2, status: "pesty" }] },
      { "1#1": proposed(3400), "1#2": locked(3750) });
    const [line] = p2Itemisation(data).lines;
    expect(line.number).toBe(2);
    expect(line.floor).toBe("1");
  });

  it("ryhmittelee kerroksittain ja kerrossummat summautuvat kokonaissummaan", () => {
    const data = project(
      { "1": [{ p: 2, status: "pesty" }, { p: 2, status: "pesty" }], "4": [{ p: 2, status: "pesty" }] },
      { "1#0": locked(3400), "1#1": locked(3400), "4#0": locked(3750) },
    );
    const it2 = p2Itemisation(data);
    expect(it2.byFloor.map((g) => [g.floor, g.count, g.sumCents])).toEqual([["1", 2, 6800], ["4", 1, 3750]]);
    expect(it2.byFloor.reduce((n, g) => n + g.sumCents, 0)).toBe(it2.totalCents);
  });

  it("hintajakauma näyttää TODELLISET hinnat, ei keskiarvoa", () => {
    // Keskiarvo on tässä tasan 34,00 € vaikka yksikään ikkuna ei maksa 34,00 €.
    // Juuri tästä syystä loppusummasta ei saa päätellä hintoja.
    const data = project(
      { "1": [{ p: 2, status: "pesty" }, { p: 2, status: "pesty" }] },
      { "1#0": locked(3000), "1#1": locked(3800) },
    );
    const it2 = p2Itemisation(data);
    expect(it2.totalCents / it2.lines.length).toBe(3400);   // harhaanjohtava keskiarvo
    expect(it2.byPrice).toEqual([
      { priceCents: 3800, count: 1, sumCents: 3800 },
      { priceCents: 3000, count: 1, sumCents: 3000 },
    ]);
  });

  it("hintajakauma ryhmittelee samat hinnat ja summautuu kokonaissummaan", () => {
    const data = project(
      { "1": [{ p: 2, status: "pesty" }, { p: 2, status: "pesty" }, { p: 2, status: "pesty" }] },
      { "1#0": locked(3400), "1#1": locked(3400), "1#2": locked(2700) },
    );
    const it2 = p2Itemisation(data);
    expect(it2.byPrice).toEqual([
      { priceCents: 3400, count: 2, sumCents: 6800 },
      { priceCents: 2700, count: 1, sumCents: 2700 },
    ]);
    expect(it2.byPrice.reduce((n, b) => n + b.sumCents, 0)).toBe(it2.totalCents);
    expect(it2.byPrice.reduce((n, b) => n + b.count, 0)).toBe(it2.lines.length);
  });

  it("kertoo kuka hinnan hyväksyi ja milloin", () => {
    const data = project({ "1": [{ p: 2, status: "pesty" }] }, { "1#0": locked(3400, "admin", 123) });
    expect(p2Itemisation(data).lines[0]).toMatchObject({ lockedBy: "admin", lockedAt: 123 });
  });

  it("poistettu piste katoaa erittelystä ja laskutusperustasta yhdessä", () => {
    const data = project({ "1": [{ p: 2, status: "pesty" }, { p: 2, status: "pesty" }] },
      { "1#0": locked(3400), "1#1": locked(3400) });
    (data as { deleted: Record<string, boolean> }).deleted["1#1"] = true;
    const it2 = p2Itemisation(data);
    expect(it2.lines).toHaveLength(1);
    expect(it2.matchesBilling).toBe(true);
  });

  it("ilman vaihetta 2 erittely on tyhjä eikä kaadu", () => {
    const data = project({ "1": [{ p: 2, status: "pesty" }] }, {});
    (data as { p2?: P2State }).p2 = undefined;
    expect(p2Itemisation(data)).toMatchObject({ lines: [], totalCents: 0, earnedCents: 0, matchesBilling: true });
  });
});

/**
 * LISÄTYÖLASKU KANTAA KAIKEN — EI VAIN KELTAISIA IKKUNOITA.
 *
 * Tämä oli aito rahavika ja sama luokka kuin tuntikeikan laskuttamattomat
 * ikkunat, käännettynä: kohdennetulla keikalla asiakkaalle ostetut tarvikkeet
 * ja alihankinta katteineen eivät päätyneet YHDELLEKÄÄN laskulle. Urakan erä
 * on kiinteä 25 % sopimuksesta, eikä keltaisten lasku tuntenut kuluja
 * lainkaan. Kulu kirjattiin, se näkyi asiakkaan seurantasivulla, ja siihen se
 * jäi.
 */
describe("lisätyölaskun kulut", () => {
  const withExpenses = (base: ProjectData, expenses: any[]): ProjectData =>
    ({ ...base, expenses } as ProjectData);

  const plain = () => project({ K: [{ p: 2, status: "pesty" }] }, {
    "K#0": { status: "locked", lockedCents: 3000, lockedAt: 1 } as P2Offer,
  });

  it("asiakkaalle merkityt tarvikkeet ja alihankinta tulevat laskulle", () => {
    const d = withExpenses(plain(), [
      { id: "e1", by: "joonatan", kind: "materials", desc: "Polttimot", amountCents: 4500, ts: 1, forCustomer: true },
      { id: "e2", by: "petrus", kind: "transport", desc: "Bussilippu", amountCents: 620, ts: 2 },
      { id: "e3", by: "joonatan", kind: "subcontract", desc: "Mika, valot 300 €",
        customerDesc: "Valotyöt", amountCents: 30000, marginCents: 7000, ts: 3 },
    ]);
    const it0 = p2Itemisation(d);
    expect(it0.windowsCents).toBe(3000);
    // 45 € tarvikkeet + 370 € alihankinta katteineen. Bussilippu EI ole mukana.
    expect(it0.extrasCents).toBe(4500 + 37000);
    expect(it0.totalCents).toBe(3000 + 4500 + 37000);
    expect(it0.matchesBilling).toBe(true);
    expect(p2BillableCents(d)).toBe(it0.totalCents);
  });

  /** Alihankkijan nimi ja ostohinta eivät kulje laskulle täälläkään. */
  it("alihankinta on yksi rivi ja asiakkaan oma teksti", () => {
    const d = withExpenses(plain(), [
      { id: "e1", by: "joonatan", kind: "subcontract", desc: "Mika Virtanen, ostohinta 300 €",
        customerDesc: "Valotyöt", amountCents: 30000, marginCents: 7000, ts: 1 },
    ]);
    const x = p2ExtraCharges(d);
    expect(x).toHaveLength(1);
    expect(x[0].customerLabel).toBe("Valotyöt");
    expect(x[0].customerCents).toBe(37000);
    expect(JSON.stringify(x.map((l) => l.customerLabel))).not.toMatch(/Mika|300/);
  });

  it("ilman asiakastekstiä alihankinta on neutraali eikä sisäinen kuvaus", () => {
    const d = withExpenses(plain(), [
      { id: "e1", by: "joonatan", kind: "subcontract", desc: "Mika", amountCents: 20000, marginCents: 5000, ts: 1 },
    ]);
    expect(p2ExtraCharges(d)[0].customerLabel).toBe("Työsuoritus");
  });

  /**
   * TUNTIKEIKALLA NOLLA. Siellä samat kulut ovat jo tuntilaskulla, ja kahdesti
   * laskuttaminen olisi pahempi vika kuin se jota tässä korjataan.
   */
  it("tuntikeikalla kulut EIVÄT ole lisätyölaskulla", () => {
    const d = withExpenses(plain(), [
      { id: "e1", by: "joonatan", kind: "subcontract", desc: "Mika", amountCents: 20000, marginCents: 5000, ts: 1 },
    ]);
    const hourly = { ...d, billingMode: "hourly" } as ProjectData;
    expect(p2ExtraChargesCents(hourly)).toBe(0);
    expect(p2Itemisation(hourly).extrasCents).toBe(0);
    expect(p2BillableCents(hourly)).toBe(computeP2Billing(hourly).earnedCents);
  });

  it("ilman kuluja mikään ei muutu", () => {
    const d = plain();
    const it0 = p2Itemisation(d);
    expect(it0.extras).toEqual([]);
    expect(it0.extrasCents).toBe(0);
    expect(it0.totalCents).toBe(it0.windowsCents);
    expect(it0.earnedCents).toBe(computeP2Billing(d).earnedCents);
    expect(it0.matchesBilling).toBe(true);
  });

  /** Keikka jolla on VAIN kuluja on silti laskutettava. */
  it("pelkkä kulu ilman keltaisia on laskutettavaa", () => {
    const base = project({ K: [{ p: 2 }] }, {});
    const d = withExpenses(base, [
      { id: "e1", by: "joonatan", kind: "materials", desc: "Polttimot", amountCents: 4500, ts: 1, forCustomer: true },
    ]);
    expect(computeP2Billing(d).earnedCents).toBe(0);
    expect(p2BillableCents(d)).toBe(4500);
    expect(p2Itemisation(d).matchesBilling).toBe(true);
  });
});
