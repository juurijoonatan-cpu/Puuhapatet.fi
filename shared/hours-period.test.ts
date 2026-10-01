import { describe, expect, it } from "vitest";
import {
  computeHoursPeriod, buildHoursCover, inferHoursCover, hoursPeriodLines, lastHoursInvoiceAt,
  isHoursStreamPayment, hoursStreamCents, type HoursPaymentLike,
} from "./hours-period";
import {
  addShiftEntry, emptyProjectData, DEFAULT_PRICE_PER_WINDOW,
  type ProjectData, type ProjExpense, type ProjShift,
} from "./project";
import { sanitizeGigData, emptyGigData } from "./gig";

/**
 * TUNTILASKUTUKSEN KAUSI.
 *
 * Nämä testit ovat olemassa kahden ruudulla näkyneen vian takia:
 *
 *   1. Laskun jälkeen tuntinäkymä näytti yhä koko keikan tunnit — luku ei
 *      nollautunut, eikä edellisen laskun jälkeen tehtyjä tunteja nähnyt
 *      mistään.
 *   2. Jokainen kulu näkyi "takaisin maksajalle" vielä senkin jälkeen kun
 *      lasku oli perinyt sen ja se oli maksettu takaisin.
 */

const T0 = 1_800_000_000_000;
const RATE = 2600;
const WAGE = 1500;

let n = 0;
function shift(worker: string, hours: number, at: number, day = "2026-09-01", extra?: Partial<ProjShift>): ProjShift {
  n += 1;
  return { id: `s${n}`, worker, day, hours, at, ...extra };
}

let e = 0;
function expense(over: Partial<ProjExpense>): ProjExpense {
  e += 1;
  return {
    id: `e${e}`, by: "joonatan", kind: "materials", desc: "kulu", forCustomer: true,
    amountCents: 1000, ts: T0, ...over,
  } as ProjExpense;
}

function gig(shifts: ProjShift[], expenses: ProjExpense[] = [], over?: Partial<ProjectData>): ProjectData {
  return { ...emptyProjectData(), billingMode: "hourly", shifts, expenses, ...over } as ProjectData;
}

/** Lähetys kuten palvelin sen tekee: summa = jäljellä oleva, kattavuus talteen. */
function send(project: ProjectData, payments: HoursPaymentLike[], at: number, uninvoicedWindows = 0): HoursPaymentLike {
  const p = computeHoursPeriod(project, payments, { uninvoicedWindows });
  return {
    t: at, amountCents: p.remainingCents, scope: "hours",
    cover: buildHoursCover(project, { windowsCents: p.lifetime.windowsCents }),
  };
}

const linesSum = (p: ReturnType<typeof computeHoursPeriod>) =>
  hoursPeriodLines(p).reduce((s, l) => s + (l.cents ?? 0), 0);

describe("kausi ilman laskua", () => {
  it("on koko keikka: kaikki tunnit ja kulut ovat laskuttamatta", () => {
    const d = gig([shift("joonatan", 4, T0), shift("jani", 3, T0)], [expense({ amountCents: 4500 })]);
    const p = computeHoursPeriod(d, []);
    expect(p.last).toBeNull();
    expect(p.invoiceCount).toBe(0);
    expect(p.openHours).toBe(7);
    expect(p.openExpenseIds).toHaveLength(1);
    expect(p.invoicedExpenseIds).toEqual([]);
    expect(p.remainingCents).toBe(p.lifetime.customerTotalCents);
    expect(p.money.customerTotalCents).toBe(p.lifetime.customerTotalCents);
    expect(p.adjustmentCents).toBe(0);
    expect(linesSum(p)).toBe(p.remainingCents);
  });
});

describe("laskun jälkeen luku alkaa nollasta", () => {
  it("lähetyksen jälkeen avoimia tunteja ja kuluja on nolla", () => {
    const d = gig([shift("joonatan", 4, T0), shift("jani", 3, T0)], [expense({ amountCents: 4500 })]);
    const inv = send(d, [], T0 + 1000);
    expect(inv.amountCents).toBe(7 * RATE + 4500);
    const p = computeHoursPeriod(d, [inv]);
    expect(p.last).toEqual({ at: T0 + 1000, amountCents: 7 * RATE + 4500, exact: true });
    expect(p.openHours).toBe(0);
    expect(p.openByWorker).toEqual([]);
    expect(p.invoicedHours).toBe(7);
    expect(p.openExpenseIds).toEqual([]);
    expect(p.remainingCents).toBe(0);
    expect(p.money.customerTotalCents).toBe(0);
    expect(p.adjustmentCents).toBe(0);
  });

  it("laskun jälkeen kirjatut tunnit ovat kausi, tekijä kerrallaan", () => {
    const before = [shift("joonatan", 4, T0), shift("jani", 3, T0)];
    const d0 = gig(before);
    const inv = send(d0, [], T0 + 1000);
    const d = gig([...before, shift("joonatan", 2, T0 + 2000, "2026-09-03"), shift("jani", 1, T0 + 2000, "2026-09-03")]);
    const p = computeHoursPeriod(d, [inv]);
    expect(p.openByWorker).toEqual([{ id: "joonatan", hours: 2 }, { id: "jani", hours: 1 }]);
    expect(p.openHours).toBe(3);
    // Perustajan tunti täydellä hinnalla, työntekijän tunnista palkka + kate.
    expect(p.money.billableCents).toBe(3 * RATE);
    expect(p.money.workerCostCents).toBe(1 * WAGE);
    expect(p.money.founderWageCents).toBe(2 * RATE);
    expect(p.remainingCents).toBe(3 * RATE);
    expect(p.adjustmentCents).toBe(0);
    expect(linesSum(p)).toBe(p.remainingCents);
    expect(hoursPeriodLines(p)[0].label).toMatch(/^Tuntityö 3 h × 26,00 € · 2 tekijää$/);
  });

  it("käsin lisätty tunti vanhalle päivälle on kauden tunti, vaikka rivi yhdistyisi", () => {
    // Tallennettu kattavuus on tekijän SUMMA, joten yhdistyminen vanhaan
    // riviin ei vaikuta: avoin = nyt − laskutettu.
    const old = shift("joonatan", 4, T0, "2026-09-01");
    const inv = send(gig([old]), [], T0 + 1000);
    const merged = addShiftEntry([old], { id: "x", worker: "joonatan", hours: 1.5, day: "2026-09-01", at: T0 + 5000 });
    expect(merged).toHaveLength(1); // yhdistyi samaan riviin
    const p = computeHoursPeriod(gig(merged), [inv]);
    expect(p.openHours).toBe(1.5);
    expect(p.adjustmentCents).toBe(0);
  });
});

describe("kulut: laskutettu ja uusi erottuvat", () => {
  it("vain uudet kulut ovat takaisin maksettavia", () => {
    const a = expense({ amountCents: 4500, by: "matias", ts: T0 });
    const d0 = gig([], [a]);
    const inv = send(d0, [], T0 + 1000);
    const b = expense({ amountCents: 1200, by: "joonatan", ts: T0 + 2000 });
    const d = gig([], [a, b]);
    const p = computeHoursPeriod(d, [inv]);
    expect(p.invoicedExpenseIds).toEqual([a.id]);
    expect(p.openExpenseIds).toEqual([b.id]);
    // Koko keikan luku sisältää molemmat; kausi vain uuden.
    expect(p.lifetime.reimbursementCents).toBe(5700);
    expect(p.money.reimbursementCents).toBe(1200);
    expect(p.money.byPayer).toEqual([{ id: "joonatan", cents: 1200 }]);
    expect(p.remainingCents).toBe(1200);
    expect(p.adjustmentCents).toBe(0);
    expect(linesSum(p)).toBe(1200);
  });

  it("sisäinen kulu (ei asiakkaalle) ei ole kummassakaan listassa", () => {
    const own = expense({ forCustomer: false, amountCents: 900 });
    const p = computeHoursPeriod(gig([], [own]), []);
    expect(p.openExpenseIds).toEqual([]);
    expect(p.invoicedExpenseIds).toEqual([]);
  });

  it("asiakkaalle merkitty jälkikäteen = uusi kulu, vaikka se on kirjattu ennen laskua", () => {
    const inv = send(gig([], []), [], T0 + 1000);
    const late = expense({ forCustomer: true, amountCents: 800, ts: T0 }); // merkintä tehty laskun jälkeen
    const p = computeHoursPeriod(gig([], [late]), [inv]);
    expect(p.openExpenseIds).toEqual([late.id]);
    expect(p.remainingCents).toBe(800);
    expect(p.adjustmentCents).toBe(0);
  });
});

describe("vanha lasku ilman kattavuutta", () => {
  it("päätellään aikaleimoista: ennen lähetystä kirjattu oli laskulla", () => {
    const a = expense({ amountCents: 4500, ts: T0 });
    const before = [shift("joonatan", 4, T0), shift("jani", 3, T0)];
    // Vanha maksurivi: pelkkä summa, ei kattavuutta.
    const legacy: HoursPaymentLike = { t: T0 + 1000, amountCents: 7 * RATE + 4500, scope: "hours" };
    const b = expense({ amountCents: 1200, ts: T0 + 2000 });
    const d = gig([...before, shift("jani", 2, T0 + 3000, "2026-09-04")], [a, b]);
    const p = computeHoursPeriod(d, [legacy]);
    expect(p.last?.exact).toBe(false);
    expect(p.openByWorker).toEqual([{ id: "jani", hours: 2 }]);
    expect(p.openExpenseIds).toEqual([b.id]);
    expect(p.invoicedExpenseIds).toEqual([a.id]);
    expect(p.remainingCents).toBe(2 * RATE + 1200);
    expect(p.adjustmentCents).toBe(0);
  });

  it("laskutettuun riviin ei enää yhdistetä, joten päättely pysyy oikeana", () => {
    const old = shift("joonatan", 4, T0, "2026-09-01");
    const legacy: HoursPaymentLike = { t: T0 + 1000, amountCents: 4 * RATE, scope: "hours" };
    const lockedAt = lastHoursInvoiceAt([legacy]);
    const next = addShiftEntry([old], { id: "x", worker: "joonatan", hours: 1, day: "2026-09-01", at: T0 + 5000 }, { lockedAt });
    // Uusi rivi, vanha koskematon.
    expect(next).toHaveLength(2);
    expect(next[0]).toEqual(old);
    const p = computeHoursPeriod(gig(next), [legacy]);
    expect(p.openHours).toBe(1);
    expect(p.adjustmentCents).toBe(0);
  });

  it("inferHoursCover lukee vain lähetystä edeltävät rivit", () => {
    const d = gig(
      [shift("jani", 3, T0), shift("jani", 2, T0 + 5000)],
      [expense({ id: "vanha", ts: T0 }), expense({ id: "uusi", ts: T0 + 5000 })],
    );
    const c = inferHoursCover(d, T0 + 1000);
    expect(c.hours).toEqual({ jani: { "2026-09-01": 3 } });
    expect(c.expenseIds).toEqual(["vanha"]);
    expect(c.windowsCents).toBe(0);
  });
});

describe("jo laskutettua muutetaan jälkikäteen", () => {
  it("laskutetun tunnin vähennys näkyy korjauksena, ja rivit täsmäävät yhä summaan", () => {
    const old = shift("joonatan", 4, T0, "2026-09-01");
    const inv = send(gig([old]), [], T0 + 1000);
    // Tunti pois laskutetulta päivältä, sitten 2 h uutta työtä.
    const cut = addShiftEntry([old], { id: "c", worker: "joonatan", hours: -1, day: "2026-09-01", at: T0 + 2000 });
    const d = gig([...cut, shift("joonatan", 2, T0 + 3000, "2026-09-05")]);
    const p = computeHoursPeriod(d, [inv]);
    expect(p.reducedHours).toBe(1);
    expect(p.openHours).toBe(2);
    // Lasku perii kertymä − laskutettu: 5 h − 4 h = 1 h. Kausi on 2 h.
    expect(p.remainingCents).toBe(1 * RATE);
    expect(p.money.customerTotalCents).toBe(2 * RATE);
    expect(p.adjustmentCents).toBe(-1 * RATE);
    const lines = hoursPeriodLines(p);
    expect(lines[lines.length - 1]).toEqual({ label: "Korjaus aiemmin laskutettuun", cents: -1 * RATE });
    expect(linesSum(p)).toBe(p.remainingCents);
  });

  it("hinnanmuutos koskee myös laskutettuja tunteja — ero on näkyvä rivi", () => {
    const old = shift("joonatan", 4, T0);
    const inv = send(gig([old]), [], T0 + 1000);
    const d = gig([old, shift("joonatan", 1, T0 + 2000, "2026-09-02")], [], { hourRateCents: 3000 });
    const p = computeHoursPeriod(d, [inv]);
    expect(p.money.customerTotalCents).toBe(3000);
    expect(p.remainingCents).toBe(5 * 3000 - 4 * RATE);
    expect(p.adjustmentCents).toBe(4 * (3000 - RATE));
    expect(linesSum(p)).toBe(p.remainingCents);
  });
});

describe("laskurivit", () => {
  it("mitätöity lasku ei ole lasku", () => {
    const d = gig([shift("jani", 3, T0)]);
    const inv = { ...send(d, [], T0 + 1000), voided: true };
    const p = computeHoursPeriod(d, [inv]);
    expect(p.last).toBeNull();
    expect(p.openHours).toBe(3);
    expect(p.remainingCents).toBe(3 * RATE);
  });

  it("yhdistetyn laskun tuntiosuus on parts.hours, ei koko summa", () => {
    const d0 = gig([shift("jani", 4, T0)]);
    const cover = buildHoursCover(d0, { windowsCents: 0 });
    const all: HoursPaymentLike = { t: T0 + 1000, amountCents: 4 * RATE + 9600, scope: "all", parts: { hours: 4 * RATE, p2: 9600 }, cover };
    expect(isHoursStreamPayment(all)).toBe(true);
    expect(hoursStreamCents(all)).toBe(4 * RATE);
    const p = computeHoursPeriod(gig([shift("jani", 4, T0), shift("jani", 1, T0 + 2000, "2026-09-02")]), [all]);
    expect(p.invoicedCents).toBe(4 * RATE);
    expect(p.openHours).toBe(1);
    expect(p.remainingCents).toBe(RATE);
    expect(p.adjustmentCents).toBe(0);
  });

  it("urakan ja keltaisten laskut eivät ole tuntivirtaa", () => {
    expect(isHoursStreamPayment({ t: 1, amountCents: 157500 })).toBe(false);
    expect(isHoursStreamPayment({ t: 1, amountCents: 157500, scope: "p1" })).toBe(false);
    expect(isHoursStreamPayment({ t: 1, amountCents: 9600, scope: "p2" })).toBe(false);
    expect(isHoursStreamPayment({ t: 1, amountCents: 9600, scope: "all", parts: { p2: 9600 } })).toBe(false);
  });

  it("osalasku ei siirrä kauden alkua", () => {
    const d0 = gig([shift("jani", 4, T0)]);
    const full = send(d0, [], T0 + 1000);
    const d1 = gig([shift("jani", 4, T0), shift("jani", 2, T0 + 2000, "2026-09-02")]);
    const partial: HoursPaymentLike = {
      t: T0 + 3000, amountCents: RATE, scope: "hours",
      cover: buildHoursCover(d1, { windowsCents: 0, partial: true }),
    };
    const p = computeHoursPeriod(d1, [full, partial]);
    expect(p.last?.at).toBe(T0 + 1000);
    expect(p.openHours).toBe(2);
    expect(p.remainingCents).toBe(RATE);
    expect(p.adjustmentCents).toBe(-RATE);
    expect(lastHoursInvoiceAt([full, partial])).toBe(T0 + 1000);
  });

  it("lastHoursInvoiceAt: uusin elävä tuntilasku", () => {
    expect(lastHoursInvoiceAt([])).toBeUndefined();
    expect(lastHoursInvoiceAt([
      { t: 10, amountCents: 1, scope: "hours" },
      { t: 30, amountCents: 1, scope: "p2" },
      { t: 20, amountCents: 1, scope: "all", parts: { hours: 1 } },
      { t: 40, amountCents: 1, scope: "hours", voided: true },
    ])).toBe(20);
  });
});

/**
 * IKKUNAT. Lasku joka veloitti ikkunat siirsi niiden merkinnän laskutetuksi,
 * jolloin ne putosivat kertymästä — mutta niiden euro jäi "jo laskutettuun".
 * Seuraava lasku jäi juuri niiden hinnan verran vajaaksi.
 */
describe("ikkunat tuntilaskulla", () => {
  function mapGig(): ProjectData {
    const d = gig([shift("petrus", 1, T0)]);
    d.marks = { K: { marks: [{ p: 1, x: 0, y: 0 }, { p: 1, x: 1, y: 0 }, { p: 1, x: 2, y: 0 }] } } as never;
    for (const k of ["K#0", "K#1", "K#2"]) { d.statuses[k] = "pesty"; d.washedBy[k] = "jani"; }
    return d;
  }
  const price = Math.round(DEFAULT_PRICE_PER_WINDOW * 100);

  it("veloitettu ikkuna ei vähennä seuraavaa laskua", () => {
    const d0 = mapGig();
    const inv = send(d0, [], T0 + 1000, 3);
    expect(inv.amountCents).toBe(RATE + 3 * price);
    expect(inv.cover?.windowsCents).toBe(3 * price);
    // Lähetys siirsi merkinnän: laskuttamattomia ikkunoita on nyt nolla.
    const d1 = { ...d0, shifts: [...(d0.shifts ?? []), shift("petrus", 1, T0 + 2000, "2026-09-02")] };
    const p = computeHoursPeriod(d1, [inv], { uninvoicedWindows: 0 });
    expect(p.remainingCents).toBe(RATE);
    expect(p.adjustmentCents).toBe(0);
  });

  it("uudet pestyt ikkunat tulevat seuraavalle laskulle", () => {
    const d0 = mapGig();
    const inv = send(d0, [], T0 + 1000, 3);
    const p = computeHoursPeriod(d0, [inv], { uninvoicedWindows: 1 });
    expect(p.remainingCents).toBe(price);
    expect(p.money.windowsCents).toBe(price);
    expect(p.adjustmentCents).toBe(0);
    expect(hoursPeriodLines(p).some((l) => /^Ikkunanpesu 1 ikkunaa/.test(l.label) && l.cents === price)).toBe(true);
  });

  it("vanha lasku ilman ikkunaosuutta laskee kuten ennenkin", () => {
    const d0 = mapGig();
    const legacy: HoursPaymentLike = { t: T0 + 1000, amountCents: RATE + 3 * price, scope: "hours" };
    const p = computeHoursPeriod(d0, [legacy], { uninvoicedWindows: 0 });
    // Ennen muutosta: max(0, kertymä − laskutettu).
    expect(p.remainingCents).toBe(Math.max(0, p.lifetime.customerTotalCents - (RATE + 3 * price)));
  });
});

describe("kattavuus säilyy tallennuksessa", () => {
  it("sanitizeGigData pitää kattavuuden ja siivoaa roskan", () => {
    const g = emptyGigData();
    const clean = sanitizeGigData({
      ...g,
      payments: [
        { t: 5, countThrough: 0, amountCents: 100, scope: "hours", cover: { hours: { jani: { "2026-09-01": 3.456, "eilen": 2 }, "": { "2026-09-01": 2 }, matias: { "2026-09-01": -1 } }, expenseIds: ["a", "a", "", 7], windowsCents: 250, partial: true } },
        { t: 6, countThrough: 0, amountCents: 100, scope: "hours", cover: "rikki" },
        { t: 7, countThrough: 0, amountCents: 100, scope: "hours" },
      ],
    });
    expect(clean.payments[0].cover).toEqual({ hours: { jani: { "2026-09-01": 3.46 } }, expenseIds: ["a", "7"], windowsCents: 250, partial: true });
    expect(clean.payments[1].cover).toBeUndefined();
    expect(clean.payments[2].cover).toBeUndefined();
    // Toinen kierros ei muuta mitään.
    expect(sanitizeGigData(clean).payments).toEqual(clean.payments);
  });
});

describe("addShiftEntry: laskutettu rivi", () => {
  const old = (): ProjShift => ({ id: "o", worker: "jani", day: "2026-09-01", hours: 4, at: 100 });

  it("ilman lukkoa yhdistää kuten ennenkin", () => {
    const next = addShiftEntry([old()], { id: "n", worker: "jani", hours: 1, day: "2026-09-01", at: 300 });
    expect(next).toEqual([{ ...old(), hours: 5, at: 300 }]);
  });

  it("lukon jälkeen kirjattuun riviin yhdistetään yhä", () => {
    const fresh: ProjShift = { id: "f", worker: "jani", day: "2026-09-01", hours: 1, at: 250 };
    const next = addShiftEntry([old(), fresh], { id: "n", worker: "jani", hours: 0.5, day: "2026-09-01", at: 300 }, { lockedAt: 200 });
    expect(next).toEqual([old(), { ...fresh, hours: 1.5, at: 300 }]);
  });

  it("vähennys purkaa ensin laskuttamattoman rivin", () => {
    const fresh: ProjShift = { id: "f", worker: "jani", day: "2026-09-01", hours: 1, at: 250, startedAt: 240 };
    const next = addShiftEntry([old(), fresh], { id: "n", worker: "jani", hours: -1, day: "2026-09-01", at: 300 }, { lockedAt: 200 });
    // Ajastimen vuoro laskun jälkeen kutistui, laskutettu käsin kirjattu rivi ei.
    expect(next).toEqual([old()]);
  });
});

/**
 * SATUNNAISAJO. Sata satunnaista keikkaa: tunteja eri tekijöille ja päiville
 * (myös jälkikäteen vanhoille päiville), kuluja, pestyjä ikkunoita ja laskuja
 * väliin. Joka askeleella:
 *
 *   · erittely summautuu täsmälleen seuraavan laskun summaan;
 *   · ilman jälkikäteistä korjausta korjausriviä ei ole;
 *   · laskun jälkeen avoinna on nolla — tunteja, kuluja ja euroja;
 *   · kaikki laskut + seuraava lasku = kaikki tehty työ, sentilleen.
 */
describe("satunnaisajo: raha täsmää joka askeleella", () => {
  function rng(seed: number) {
    let x = seed >>> 0;
    return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 2 ** 32; };
  }
  const WORKERS = ["joonatan", "matias", "jani", "oona"];
  const DAYS = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"];
  const price = Math.round(DEFAULT_PRICE_PER_WINDOW * 100);

  for (let seed = 1; seed <= 100; seed++) {
    it(`keikka #${seed}`, () => {
      const r = rng(seed);
      const d = gig([]);
      d.marks = { K: { marks: Array.from({ length: 20 }, (_, i) => ({ p: 1, x: i, y: 0 })) } } as never;
      let clock = T0;
      let washed = 0;
      let uninvoicedWindows = 0;
      const payments: HoursPaymentLike[] = [];
      let lockedAt: number | undefined;
      // Kaikki tehty työ euroina: tunnit + kulut nykyhinnalla, ikkunat pesuhetken hinnalla.
      const workCents = () => {
        const m = computeHoursPeriod(d, [], { uninvoicedWindows: 0 }).lifetime;
        return m.billableCents + m.customerCostCents + m.subcontractCostCents + m.subcontractMarginCents + washed * price;
      };

      for (let step = 0; step < 40; step++) {
        clock += 1000;
        const roll = r();
        if (roll < 0.45) {
          const worker = WORKERS[Math.floor(r() * WORKERS.length)];
          const day = DAYS[Math.floor(r() * DAYS.length)];
          const hours = (Math.floor(r() * 8) + 1) / 2;
          const timer = r() < 0.4;
          d.shifts = addShiftEntry(d.shifts ?? [], {
            id: `r${seed}-${step}`, worker, hours, day, at: clock, ...(timer ? { startedAt: clock - 1 } : {}),
          }, { lockedAt });
        } else if (roll < 0.6) {
          const kind = r() < 0.3 ? "subcontract" : "materials";
          d.expenses = [...(d.expenses ?? []), expense({
            kind, forCustomer: kind === "materials" ? r() < 0.7 : undefined,
            amountCents: 100 * (Math.floor(r() * 50) + 1), ...(kind === "subcontract" ? { marginCents: 500 } : {}),
            by: WORKERS[Math.floor(r() * WORKERS.length)], ts: clock,
          })] as ProjExpense[];
        } else if (roll < 0.72 && washed < 20) {
          d.statuses[`K#${washed}`] = "pesty";
          d.washedBy[`K#${washed}`] = WORKERS[Math.floor(r() * WORKERS.length)];
          washed += 1;
          uninvoicedWindows += 1;
        } else if (roll < 0.85) {
          // Lähetys: koko jäljellä oleva, kattavuus talteen, ikkunat laskutetuiksi.
          const before = computeHoursPeriod(d, payments, { uninvoicedWindows });
          if (before.remainingCents > 0) {
            payments.push(send(d, payments, clock, uninvoicedWindows));
            uninvoicedWindows = 0;
            lockedAt = clock;
            const after = computeHoursPeriod(d, payments, { uninvoicedWindows });
            expect(after.openHours).toBe(0);
            expect(after.openExpenseIds).toEqual([]);
            expect(after.remainingCents).toBe(0);
            expect(after.adjustmentCents).toBe(0);
          }
        }

        const p = computeHoursPeriod(d, payments, { uninvoicedWindows });
        expect(linesSum(p)).toBe(p.remainingCents);
        // Ei jälkikäteisiä korjauksia tässä ajossa → kausi on koko totuus.
        expect(p.adjustmentCents).toBe(0);
        expect(p.reducedHours).toBe(0);
        expect(p.invoicedCents + p.remainingCents).toBe(workCents());
      }
    });
  }
});

/**
 * SATUNNAISAJO KORJAUKSILLA. Sama kuin yllä, mutta laskun jälkeen myös
 * vähennetään jo laskutettuja tunteja, poistetaan laskutettuja kuluja ja
 * vaihdetaan tuntihintaa. Silloin kausi ja lasku eroavat — ja ero on AINA
 * oma rivinsä: erittely summautuu laskun summaan joka askeleella.
 */
describe("satunnaisajo korjauksilla: ero on aina näkyvä rivi", () => {
  function rng(seed: number) {
    let x = seed >>> 0;
    return () => { x = (x * 1103515245 + 12345) >>> 0; return x / 2 ** 32; };
  }
  const WORKERS = ["joonatan", "jani", "oona"];
  const DAYS = ["2026-09-01", "2026-09-02", "2026-09-03"];

  for (let seed = 1; seed <= 60; seed++) {
    it(`keikka #${seed}`, () => {
      const r = rng(seed);
      const d = gig([]);
      let clock = T0;
      const payments: HoursPaymentLike[] = [];
      let lockedAt: number | undefined;
      for (let step = 0; step < 40; step++) {
        clock += 1000;
        const roll = r();
        const worker = WORKERS[Math.floor(r() * WORKERS.length)];
        const day = DAYS[Math.floor(r() * DAYS.length)];
        if (roll < 0.4) {
          d.shifts = addShiftEntry(d.shifts ?? [], { id: `a${seed}-${step}`, worker, hours: (Math.floor(r() * 6) + 1) / 2, day, at: clock }, { lockedAt });
        } else if (roll < 0.55) {
          d.shifts = addShiftEntry(d.shifts ?? [], { id: `c${seed}-${step}`, worker, hours: -0.5, day, at: clock }, { lockedAt });
        } else if (roll < 0.65) {
          d.expenses = [...(d.expenses ?? []), expense({ amountCents: 100 * (Math.floor(r() * 30) + 1), ts: clock })] as ProjExpense[];
        } else if (roll < 0.7 && (d.expenses ?? []).length) {
          d.expenses = (d.expenses ?? []).slice(1);
        } else if (roll < 0.75) {
          d.hourRateCents = r() < 0.5 ? 2600 : 3000;
        } else if (roll < 0.9) {
          const before = computeHoursPeriod(d, payments);
          if (before.remainingCents > 0) {
            payments.push(send(d, payments, clock));
            lockedAt = clock;
          }
        }
        const p = computeHoursPeriod(d, payments);
        expect(linesSum(p)).toBe(p.remainingCents);
        expect(p.remainingCents).toBeGreaterThanOrEqual(0);
        expect(p.openHours).toBeGreaterThanOrEqual(0);
      }
    });
  }
});
