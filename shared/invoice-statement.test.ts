import { describe, expect, it } from "vitest";
import { computeHoursPeriod } from "./hours-period";
import { buildHoursStatement } from "./invoice-statement";
import { emptyProjectData, type ProjectData, type ProjExpense, type ProjShift } from "./project";

/**
 * Luvut ovat se lasku joka lähti asiakkaalle: seuraavalle laskulle 9 031,74 €
 * = 300,5 h × 26 € + tarvikkeet 654,79 € + alihankinta 563,95 €, jaettuna
 * Joonatanin (4 329,54 €) ja Matiaksen (4 702,20 €) laskuun.
 */

let n = 0;
function shift(worker: string, day: string, hours: number): ProjShift {
  n += 1;
  return { id: `s${n}`, worker, day, hours, at: 1_800_000_000_000 + n };
}

/** Tekijä → päivät; tunnit jaetaan päiville annetuilla paloilla. */
function shiftsFor(worker: string, parts: [string, number][]): ProjShift[] {
  return parts.map(([day, h]) => shift(worker, day, h));
}

let e = 0;
function expense(over: Partial<ProjExpense>): ProjExpense {
  e += 1;
  return { id: `e${e}`, by: "joonatan", kind: "materials", desc: "kulu", forCustomer: true, amountCents: 100, ts: 1, ...over } as ProjExpense;
}

function fixture(): ProjectData {
  const shifts: ProjShift[] = [
    // Joonatan 92 h (71 + 21), Matias 76, Selma 46,5, Oona 31, Ida 31, Jani 14 (6 + 8), Petrus 10 (6 + 4)
    ...shiftsFor("joonatan", [["2026-09-08", 40], ["2026-09-15", 30], ["2026-10-01", 22]]),
    ...shiftsFor("matias", [["2026-09-08", 40], ["2026-10-02", 36]]),
    ...shiftsFor("selma", [["2026-09-09", 30], ["2026-09-16", 16.5]]),
    ...shiftsFor("oona", [["2026-09-09", 31]]),
    ...shiftsFor("ida", [["2026-09-10", 31]]),
    ...shiftsFor("jani", [["2026-09-11", 8], ["2026-09-18", 6]]),
    ...shiftsFor("petrus", [["2026-09-12", 4], ["2026-09-19", 6]]),
  ];
  const expenses: ProjExpense[] = [
    // Joonatanin maksamat
    expense({ by: "joonatan", kind: "subcontract", desc: "Sähkömies Oy", customerDesc: "Sähkökytkennät", amountCents: 32590, marginCents: 0 }),
    expense({ by: "joonatan", desc: "Valot", amountCents: 24515 }),
    expense({ by: "joonatan", desc: "Säilytyslaatikot", amountCents: 23761 }),
    expense({ by: "joonatan", desc: "Lamput ja hanskaparit", amountCents: 11028 }),
    expense({ by: "joonatan", desc: "Wispr Flow", amountCents: 1500 }),
    expense({ by: "joonatan", kind: "transport", desc: "Matka: Onninen Express 1", amountCents: 1430 }),
    expense({ by: "joonatan", kind: "transport", desc: "Matka: Onninen Express 2", amountCents: 1430 }),
    // Matiaksen maksamat
    expense({ by: "matias", kind: "subcontract", desc: "Sähkö Ky", customerDesc: "Sähkötyöt – ensimmäinen työ", amountCents: 23805, marginCents: 0 }),
    expense({ by: "matias", kind: "transport", desc: "Matka: K-Rauta Ruoholahti – Merituuli", amountCents: 1650 }),
    expense({ by: "matias", kind: "transport", desc: "Matka: K-Rauta Ruoholahti, laatikot", amountCents: 165 }),
  ];
  return { ...emptyProjectData(), billingMode: "hourly", shifts, expenses } as ProjectData;
}

const FIRST = { joonatan: 71, selma: 46.5, jani: 6, petrus: 6 } as Record<string, number>;

describe("erittely asiakkaalle", () => {
  const project = fixture();
  const period = computeHoursPeriod(project, [], { uninvoicedWindows: 0, today: "2026-10-24" });
  const st = buildHoursStatement(project, period, { billers: ["joonatan", "matias"], firstHours: FIRST });

  it("järjestelmän seuraava lasku on 9 031,74 €", () => {
    expect(period.remainingCents).toBe(903174);
  });

  it("laskut täsmäävät kuvien summiin: 4 329,54 € + 4 702,20 €", () => {
    const [a, b] = st.invoices;
    expect(a.hours).toBe(129.5);
    expect(a.hoursCents).toBe(336700);
    expect(a.expensesCents).toBe(96254);
    expect(a.totalCents).toBe(432954);
    expect(b.hours).toBe(171);
    expect(b.hoursCents).toBe(444600);
    expect(b.expensesCents).toBe(25620);
    expect(b.totalCents).toBe(470220);
  });

  it("osat summautuvat järjestelmän summaan eikä varoituksia tule", () => {
    expect(st.totalCents).toBe(903174);
    expect(st.totalHours).toBe(300.5);
    expect(st.reconciles).toBe(true);
    expect(st.warnings).toEqual([]);
  });

  it("tekijät jakautuvat kuten laskuilla", () => {
    const who = (i: 0 | 1) => Object.fromEntries(st.invoices[i].people.map((p) => [p.worker, p.hours]));
    expect(who(0)).toEqual({ joonatan: 71, selma: 46.5, jani: 6, petrus: 6 });
    expect(who(1)).toEqual({ matias: 76, oona: 31, ida: 31, joonatan: 21, jani: 8, petrus: 4 });
  });

  it("jokainen tunti on tasan yhdellä laskulla ja päivät ovat aikajärjestyksessä", () => {
    const sum = st.days.reduce((s, d) => s + d.rows.reduce((x, r) => x + r.hours, 0), 0);
    expect(sum).toBe(300.5);
    for (const d of st.days) expect(d.rows.reduce((x, r) => x + r.hours, 0)).toBe(d.hours);
    const keys = st.days.map((d) => d.day);
    expect(keys).toEqual(keys.slice().sort());
  });

  it("päivä jonka tunnit jakautuvat näkyy kahtena rivinä", () => {
    // Joonatan: 40 + 30 = 70, ja 1 h kolmannesta päivästä (22 h) → laskulle 1.
    const d = st.days.find((x) => x.day === "2026-10-01")!;
    const rows = d.rows.filter((r) => r.worker === "joonatan");
    expect(rows).toEqual([
      { worker: "joonatan", hours: 1, invoice: 1 },
      { worker: "joonatan", hours: 21, invoice: 2 },
    ]);
  });

  it("asiakas ei näe alihankkijan nimeä eikä tuntipalkkaa", () => {
    const text = JSON.stringify(st);
    expect(text).not.toContain("Sähkömies Oy");
    expect(text).not.toContain("Sähkö Ky");
    expect(text).toContain("Sähkökytkennät");
  });

  it("liian suuri jako rajataan ja siitä tulee varoitus", () => {
    const bad = buildHoursStatement(project, period, { billers: ["joonatan", "matias"], firstHours: { ...FIRST, petrus: 99 } });
    expect(bad.warnings.some((w) => w.startsWith("petrus"))).toBe(true);
    expect(bad.invoices[0].people.find((p) => p.worker === "petrus")?.hours).toBe(10);
  });

  it("tuntematon maksaja menee laskulle 1 varoituksen kanssa", () => {
    const p2 = { ...project, expenses: [...project.expenses!, expense({ by: "jani", desc: "Teippi", amountCents: 500 })] };
    const per = computeHoursPeriod(p2, [], { today: "2026-10-24" });
    const s = buildHoursStatement(p2, per, { billers: ["joonatan", "matias"], firstHours: FIRST });
    expect(s.warnings.some((w) => w.includes("Teippi"))).toBe(true);
    expect(s.reconciles).toBe(true);
  });
});
