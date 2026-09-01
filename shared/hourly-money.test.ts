import { describe, expect, it } from "vitest";
import { computeHourlyMoney, hourlyItemisation, computeWindowMoney } from "./hourly-money";
import { p2InvoiceState } from "./worker-payouts";
import { DEFAULT_HOUR_RATE_CENTS, DEFAULT_WORKER_HOUR_CENTS, DEFAULT_PRICE_PER_WINDOW, emptyProjectData, sanitizeProjectData, type ProjectData, type ProjExpense, type ProjShift } from "./project";

/**
 * TUNTITILAN RAHA.
 *
 * Nämä testit ovat olemassa yhden säännön takia, joka on helppo saada väärin
 * päin: PERUSTAJAN omasta tunnista EI oteta katetta. Jos se unohtuu, virhe
 * näkyy kahdesti väärin — perustajan palkka on liian pieni ja "kate" liian
 * suuri, eli hänen oma palkkansa näyttää yhteiseltä rahalta.
 */

let n = 0;
function shift(worker: string, hours: number, day = "2026-09-01"): ProjShift {
  n += 1;
  return { id: `s${n}`, worker, day, hours, at: 1_700_000_000_000 + n };
}

const RATE = DEFAULT_HOUR_RATE_CENTS;   // 2600
const WAGE = DEFAULT_WORKER_HOUR_CENTS; // 1500

describe("computeHourlyMoney — oletushinnat", () => {
  it("oletukset ovat 26,00 € ja 15,00 €", () => {
    expect(RATE).toBe(2600);
    expect(WAGE).toBe(1500);
    const m = computeHourlyMoney({ shifts: [] });
    expect(m.hourRateCents).toBe(2600);
    expect(m.workerHourCents).toBe(1500);
  });

  it("työntekijän tunti: asiakas 26 €, tekijä 15 €, kate 11 €", () => {
    const m = computeHourlyMoney({ shifts: [shift("petrus", 1)] });
    expect(m.billableCents).toBe(2600);
    expect(m.workerCostCents).toBe(1500);
    expect(m.marginCents).toBe(1100);
    expect(m.founderWageCents).toBe(0);
    expect(m.workerHours).toBe(1);
    expect(m.founderHours).toBe(0);
  });

  it("PERUSTAJAN tunti: koko 26 € hänelle, EI katetta", () => {
    const m = computeHourlyMoney({ shifts: [shift("joonatan", 1)] });
    expect(m.billableCents).toBe(2600);
    expect(m.founderWageCents).toBe(2600);
    // Tämä on se rivi joka pitää säännön paikallaan.
    expect(m.marginCents).toBe(0);
    expect(m.workerCostCents).toBe(0);
    expect(m.founderHours).toBe(1);
    const joonatan = m.byFounder.find((f) => f.id === "joonatan")!;
    expect(joonatan.wageCents).toBe(2600);
    expect(joonatan.marginCents).toBe(0);
    expect(joonatan.totalCents).toBe(2600);
    // Matias ei saa senttiäkään Joonatanin omasta työstä.
    expect(m.byFounder.find((f) => f.id === "matias")!.totalCents).toBe(0);
  });

  it("kate jaetaan perustajien kesken tasan", () => {
    // 2 h työntekijää → kate 2 × 11 € = 22 € → 11 € kummallekin.
    const m = computeHourlyMoney({ shifts: [shift("petrus", 2)] });
    expect(m.marginCents).toBe(2200);
    expect(m.byFounder.find((f) => f.id === "joonatan")!.marginCents).toBe(1100);
    expect(m.byFounder.find((f) => f.id === "matias")!.marginCents).toBe(1100);
  });

  it("pariton kate jaetaan sentilleen, ei katoa eikä synny", () => {
    // 0,5 h → laskutus 1300, palkka 750, kate 550 → 275 + 275.
    const m = computeHourlyMoney({ shifts: [shift("petrus", 0.5)] });
    expect(m.billableCents).toBe(1300);
    expect(m.workerCostCents).toBe(750);
    expect(m.marginCents).toBe(550);
    const sum = m.byFounder.reduce((s, f) => s + f.marginCents, 0);
    expect(sum).toBe(m.marginCents);
  });

  it("osat summautuvat aina laskutettavaan senttiin", () => {
    const m = computeHourlyMoney({
      shifts: [shift("petrus", 3.5), shift("joonatan", 1.5), shift("mikko", 0.5)],
    });
    expect(m.workerCostCents + m.marginCents + m.founderWageCents).toBe(m.billableCents);
    const founderTotal = m.byFounder.reduce((s, f) => s + f.totalCents, 0);
    expect(founderTotal).toBe(m.founderWageCents + m.marginCents);
  });
});

describe("computeHourlyMoney — puolikkaat tunnit", () => {
  it("puolikas tunti on oikea raha, ei pyöristetty tunti", () => {
    const m = computeHourlyMoney({ shifts: [shift("petrus", 0.5)] });
    expect(m.totalHours).toBe(0.5);
    expect(m.billableCents).toBe(1300);
  });

  it("saman päivän puolikkaat summautuvat tekijäkohtaisesti", () => {
    const m = computeHourlyMoney({
      shifts: [shift("petrus", 0.5), shift("petrus", 1.5)],
    });
    expect(m.totalHours).toBe(2);
    expect(m.byWorker).toHaveLength(1);
    expect(m.byWorker[0].hours).toBe(2);
    expect(m.byWorker[0].earnedCents).toBe(3000);
  });
});

describe("computeHourlyMoney — keikkakohtaiset hinnat", () => {
  it("keikan omat hinnat voittavat oletukset", () => {
    const m = computeHourlyMoney({
      shifts: [shift("petrus", 1)],
      hourRateCents: 3000, workerHourCents: 1800,
    });
    expect(m.billableCents).toBe(3000);
    expect(m.workerCostCents).toBe(1800);
    expect(m.marginCents).toBe(1200);
  });

  it("kelvoton hinta putoaa oletukseen — nolla ei ole hinta", () => {
    for (const bad of [0, -5, NaN, undefined, "kaksikymmentä" as any]) {
      const m = computeHourlyMoney({ shifts: [shift("petrus", 1)], hourRateCents: bad });
      expect(m.hourRateCents).toBe(2600);
    }
  });

  it("perustajan tunti seuraa keikan hintaa, ei oletusta", () => {
    const m = computeHourlyMoney({
      shifts: [shift("matias", 2)], hourRateCents: 3000, workerHourCents: 1800,
    });
    expect(m.founderWageCents).toBe(6000);
    expect(m.marginCents).toBe(0);
  });
});

describe("computeHourlyMoney — virhetilanteet", () => {
  it("tuntipalkka yli asiakashinnan ei tuota miinuskatetta", () => {
    const m = computeHourlyMoney({
      shifts: [shift("petrus", 1)], hourRateCents: 2000, workerHourCents: 2500,
    });
    expect(m.rateInverted).toBe(true);
    expect(m.marginCents).toBe(0);
    // Tekijä saa enintään sen mitä asiakas maksaa — kirjausvirhe ei saa
    // muuttua velaksi jota kukaan ei ole luvannut.
    expect(m.workerCostCents).toBe(2000);
    expect(m.workerCostCents + m.marginCents).toBe(m.billableCents);
  });

  it("tyhjä keikka on nolla eikä kaadu", () => {
    const m = computeHourlyMoney({ shifts: [] });
    expect(m.totalHours).toBe(0);
    expect(m.billableCents).toBe(0);
    expect(m.byWorker).toEqual([]);
    expect(m.byFounder.every((f) => f.totalCents === 0)).toBe(true);
  });

  it("johtajan miinuskorjaus ei vie palkkaa pakkaselle", () => {
    // computeShiftStats rajaa tekijän tunnit nollaan; raha seuraa samaa lukua.
    const m = computeHourlyMoney({
      shifts: [shift("petrus", 2), shift("petrus", -5)],
    });
    expect(m.workerCostCents).toBeGreaterThanOrEqual(0);
    expect(m.billableCents).toBeGreaterThanOrEqual(0);
  });
});

let e = 0;
function expense(over: Partial<ProjExpense>): ProjExpense {
  e += 1;
  return {
    id: `e${e}`, by: "joonatan", kind: "materials", desc: "kulu",
    amountCents: 1000, ts: 1_700_000_000_000 + e, ...over,
  } as ProjExpense;
}

/**
 * KULUT LASKULLA.
 *
 * Kaksi lajia, eri säännöillä, ja molemmat on helppo saada väärin:
 *  · tarvike menee läpi VAIN kun se on merkitty asiakkaalle,
 *  · alihankinta veloitetaan AINA ja katteineen — merkinnän unohtaminen
 *    jättäisi laskulta satojen eurojen rivin.
 */
describe("kulut ja alihankinta", () => {
  it("asiakkaalle merkitty tarvike menee läpi sellaisenaan", () => {
    const m = computeHourlyMoney({
      shifts: [], expenses: [expense({ amountCents: 10400, desc: "lamput", forCustomer: true })],
    });
    expect(m.customerCostCents).toBe(10400);
    expect(m.customerTotalCents).toBe(10400);
    // Läpilaskutuksesta ei oteta katetta.
    expect(m.subcontractMarginCents).toBe(0);
  });

  it("merkitsemätön kulu on MEIDÄN kulumme eikä päädy laskulle", () => {
    const m = computeHourlyMoney({ shifts: [], expenses: [expense({ amountCents: 2500, desc: "bussilippu" })] });
    expect(m.customerCostCents).toBe(0);
    expect(m.customerTotalCents).toBe(0);
    expect(m.costLines).toEqual([]);
  });

  it("alihankinta veloitetaan AINA, myös ilman forCustomer-merkintää", () => {
    const m = computeHourlyMoney({
      shifts: [],
      expenses: [expense({ kind: "subcontract", amountCents: 20000, marginCents: 8000, desc: "lampunkorjaukset, Mika" })],
    });
    expect(m.subcontractCostCents).toBe(20000);
    expect(m.subcontractMarginCents).toBe(8000);
    expect(m.customerTotalCents).toBe(28000);
  });

  it("alihankinnan kate jaetaan perustajien kesken", () => {
    const m = computeHourlyMoney({
      shifts: [],
      expenses: [expense({ kind: "subcontract", amountCents: 20000, marginCents: 8000, desc: "Mika" })],
    });
    expect(m.byFounder.find((f) => f.id === "joonatan")!.marginCents).toBe(4000);
    expect(m.byFounder.find((f) => f.id === "matias")!.marginCents).toBe(4000);
  });

  it("kate ja tuntikate jaetaan yhtenä summana, sentit täsmäävät", () => {
    const m = computeHourlyMoney({
      shifts: [shift("petrus", 1)],
      expenses: [expense({ kind: "subcontract", amountCents: 10000, marginCents: 1500, desc: "Mika" })],
    });
    const shared = m.byFounder.reduce((s, f) => s + f.marginCents, 0);
    expect(shared).toBe(m.marginCents + m.subcontractMarginCents);
  });

  it("kuka kulun maksoi säilyy — tasaus tarvitsee sen", () => {
    const m = computeHourlyMoney({
      shifts: [],
      expenses: [expense({ kind: "subcontract", amountCents: 20000, marginCents: 5000, by: "joonatan", desc: "Mika" })],
    });
    expect(m.costLines[0].paidBy).toBe("joonatan");
  });
});

describe("hourlyItemisation", () => {
  const base = () => ({ ...emptyProjectData(), shifts: [], expenses: [] as ProjExpense[] });

  it("erittely täsmää laskutettavaan summaan", () => {
    const it = hourlyItemisation({
      ...base(),
      shifts: [shift("petrus", 3), shift("joonatan", 1)],
      expenses: [
        expense({ amountCents: 10400, desc: "lamput", forCustomer: true }),
        expense({ kind: "subcontract", amountCents: 20000, marginCents: 8000, desc: "Mika" }),
      ],
    });
    expect(it.matchesBilling).toBe(true);
    expect(it.totalCents).toBe(it.customerTotalCents);
    // 4 h × 26 € = 10400, + lamput 10400, + alihankinta 28000
    expect(it.customerTotalCents).toBe(10400 + 10400 + 28000);
  });

  it("erittely kertoo tunnit ja tekijämäärän", () => {
    const it = hourlyItemisation({ ...base(), shifts: [shift("petrus", 2), shift("mikko", 1)] });
    expect(it.lines[0].label).toContain("3 h");
    expect(it.lines[0].label).toContain("2 tekijää");
  });

  it("alihankinta on YKSI rivi — ostohintaa ei eritellä asiakkaalle", () => {
    const it = hourlyItemisation({
      ...base(),
      expenses: [expense({ kind: "subcontract", amountCents: 20000, marginCents: 8000, desc: "Mika", customerDesc: "Valotyöt" })],
    });
    const sub = it.lines.find((l) => l.label === "Valotyöt")!;
    expect(sub.cents).toBe(28000);
    // Kate ei saa esiintyä omana rivinään.
    expect(it.lines.some((l) => l.cents === 8000)).toBe(false);
    expect(it.lines.some((l) => /kate/i.test(l.label))).toBe(false);
  });

  /**
   * ALIHANKKIJAN NIMI EI PÄÄDY ASIAKKAAN LASKULLE.
   *
   * `desc` on meidän muistiinpanomme — "Mika", "sähkömies, 300 €". Nimestä
   * asiakas löytää alihankkijan itse ja sitä kautta ostohintamme; seuraava
   * keikka menee silloin ohitsemme. Tämä on nimenomaan se tieto jota yksi
   * rivi ja yksi luku suojaavat, joten se testataan eikä luoteta siihen
   * että kukaan muistaa sen kirjoittaessaan seuraavan rivin.
   */
  it("sisäinen kuvaus EI vuoda asiakkaan laskulle — ei nimeä, ei ostohintaa", () => {
    const it = hourlyItemisation({
      ...base(),
      expenses: [expense({
        kind: "subcontract", amountCents: 20000, marginCents: 8000,
        desc: "Mika Virtanen, lampunvaihdot, sovittu 200 €",
      })],
    });
    const invoiceText = it.lines.map((l) => l.label).join(" | ");
    expect(invoiceText).not.toMatch(/Mika/i);
    expect(invoiceText).not.toMatch(/200/);
    // Rivi on silti olemassa ja täydellä hinnalla.
    expect(it.lines.some((l) => l.cents === 28000)).toBe(true);
    expect(it.matchesBilling).toBe(true);
  });

  it("asiakasteksti on se joka laskulla lukee — sisäinen kuvaus jää meille", () => {
    const it = hourlyItemisation({
      ...base(),
      expenses: [expense({
        kind: "subcontract", amountCents: 30000, marginCents: 7000,
        desc: "sähkömies Mika", customerDesc: "Valotyöt",
      })],
    });
    const sub = it.lines.find((l) => l.cents === 37000)!;
    expect(sub.label).toBe("Valotyöt");
    // Ja rivi kantaa yhä sisäisen kuvauksen adminin listaa varten.
    expect(it.money.costLines[0].desc).toBe("sähkömies Mika");
    expect(it.money.costLines[0].customerLabel).toBe("Valotyöt");
  });

  it("tyhjä keikka ei tuota laskutettavaa", () => {
    const it = hourlyItemisation(base());
    expect(it.customerTotalCents).toBe(0);
    expect(it.matchesBilling).toBe(true);
  });
});

/**
 * TUNTILASKU ON OMA VIRTANSA.
 *
 * `p2InvoiceState` jakoi erät kahtia ehdolla `scope !== "p2"`, eli KAIKKI muu
 * luettiin urakan P1-eräksi. Yksi tuntilasku olisi siis kasvattanut kiinteän
 * urakan eränumeroa ja syönyt sen neljän erän laskennasta erän jota kukaan ei
 * ole lähettänyt — ja neljännen erän loppusumma olisi laskettu väärin.
 */
describe("tuntilasku ei sotke urakan eriä", () => {
  const p = (amountCents: number, scope?: "p1" | "p2" | "hours", voided?: boolean) =>
    ({ amountCents, scope, voided });

  it("tuntilasku ei ole P1-erä", () => {
    const st = p2InvoiceState(0, [p(100000, "p1"), p(5000, "hours")]);
    expect(st.p1Payments).toBe(1);
    expect(st.p1InvoicedCents).toBe(100000);
    expect(st.hoursPayments).toBe(1);
    expect(st.hoursInvoicedCents).toBe(5000);
  });

  it("tuntilasku ei ole keltaisten laskua", () => {
    const st = p2InvoiceState(9000, [p(5000, "hours")]);
    expect(st.invoicedCents).toBe(0);
    expect(st.remainingCents).toBe(9000);
  });

  it("vanha erä ilman scopea on yhä P1", () => {
    const st = p2InvoiceState(0, [p(100000)]);
    expect(st.p1Payments).toBe(1);
    expect(st.hoursPayments).toBe(0);
  });

  it("mitätöity tuntilasku ei ole laskutettua rahaa", () => {
    const st = p2InvoiceState(0, [p(5000, "hours", true), p(2500, "hours")]);
    expect(st.hoursPayments).toBe(1);
    expect(st.hoursInvoicedCents).toBe(2500);
  });
});

/**
 * KEIKAN RAHA MENEE TASAN — EIKÄ MITÄÄN JÄÄ ARVATTAVAKSI.
 *
 * Ennen palautusta laskenta jätti selittämättömän aukon: asiakkaalta 1000 €,
 * tekijöille 300 €, meille 400 € — ja 300 € ei kuulunut kenellekään. Se 300 €
 * on kulu jonka joku maksoi omasta pussistaan; se ei ole tuottoa vaan menee
 * takaisin maksajalle. Nämä testit pitävät huolen että kolme osaa summautuvat
 * aina asiakkaan kokonaissummaan, jotta näkymä ei voi näyttää katoavaa rahaa.
 */
describe("kulujen palautus ja rahan täsmäys", () => {
  it("tekijät + perustajat + palautukset = asiakkaan summa", () => {
    const m = computeHourlyMoney({
      shifts: [shift("petrus", 10), shift("joonatan", 4)],
      expenses: [
        expense({ amountCents: 10400, desc: "lamput", forCustomer: true, by: "matias" }),
        expense({ kind: "subcontract", amountCents: 30000, marginCents: 7000, desc: "sähkömies", by: "joonatan" }),
      ],
    });
    expect(m.workerCostCents + m.founderTotalCents + m.reimbursementCents + m.windowsCents)
      .toBe(m.customerTotalCents);
  });

  /**
   * IKKUNARAHA EI SAA REPÄISTÄ TÄSMÄYSTÄ. Kun ikkunat tulivat laskulle, ne
   * kasvattivat asiakkaan summaa — ja jos ne olisi jätetty tästä yhtälöstä
   * pois, näkymä olisi taas näyttänyt katoavaa rahaa, tällä kertaa
   * ikkunahinnan verran keikkaa kohti.
   */
  it("tekijät + perustajat + palautukset + ikkunat = asiakkaan summa", () => {
    const d = mapGig();
    d.statuses["K#0"] = "pesty"; d.washedBy["K#0"] = "jani";
    d.statuses["K#1"] = "pesty"; d.washedBy["K#1"] = "joonatan";
    d.shifts = [shift("petrus", 10), shift("joonatan", 4)] as never;
    d.expenses = [
      expense({ amountCents: 10400, desc: "lamput", forCustomer: true, by: "matias" }),
      expense({ kind: "subcontract", amountCents: 30000, marginCents: 7000, desc: "sähkömies", by: "joonatan" }),
    ] as never;
    const m = computeHourlyMoney(d, { uninvoicedWindows: 2 });
    expect(m.windowsCents).toBe(Math.round(2 * DEFAULT_PRICE_PER_WINDOW * 100));
    expect(m.workerCostCents + m.founderTotalCents + m.reimbursementCents + m.windowsCents)
      .toBe(m.customerTotalCents);
  });

  it("palautus kuuluu maksajalle, ei jaettavaksi", () => {
    const m = computeHourlyMoney({
      shifts: [],
      expenses: [
        expense({ kind: "subcontract", amountCents: 30000, marginCents: 7000, desc: "sähkömies", by: "joonatan" }),
        expense({ amountCents: 10400, desc: "lamput", forCustomer: true, by: "matias" }),
      ],
    });
    expect(m.reimbursementCents).toBe(40400);
    expect(m.byPayer).toEqual([
      { id: "joonatan", cents: 30000 },
      { id: "matias", cents: 10400 },
    ]);
    // Kate jaetaan — kulu ei.
    expect(m.byFounder.find((f) => f.id === "joonatan")?.marginCents).toBe(3500);
    expect(m.byFounder.find((f) => f.id === "matias")?.marginCents).toBe(3500);
  });

  it("kirjanpidollinen maksaja (forWhom) menee `by`:n edelle", () => {
    const m = computeHourlyMoney({
      shifts: [],
      expenses: [expense({ amountCents: 5000, forCustomer: true, by: "joonatan", forWhom: "matias" })],
    });
    expect(m.byPayer).toEqual([{ id: "matias", cents: 5000 }]);
  });

  it("perustajien osuus sisältää alihankinnan katteen", () => {
    const m = computeHourlyMoney({
      shifts: [],
      expenses: [expense({ kind: "subcontract", amountCents: 30000, marginCents: 7000, desc: "sähkömies" })],
    });
    expect(m.founderTotalCents).toBe(7000);
    // Sama luku kuin perustajarivien summa — näkymä ei laske sitä uudelleen.
    expect(m.byFounder.reduce((s, f) => s + f.totalCents, 0)).toBe(m.founderTotalCents);
  });

  it("pelkillä tunneilla palautusta ei ole eikä maksajia", () => {
    const m = computeHourlyMoney({ shifts: [shift("petrus", 3), shift("matias", 2)] });
    expect(m.reimbursementCents).toBe(0);
    expect(m.byPayer).toEqual([]);
    expect(m.workerCostCents + m.founderTotalCents).toBe(m.customerTotalCents);
  });
});

/** Nimetön rivi laskulla on virhe: asiakas näkisi tyhjän selitteen ja summan. */
describe("laskun rivi on aina nimetty", () => {
  it("kuvaukseton tarvike saa kululajin nimen", () => {
    const it0 = hourlyItemisation({
      shifts: [], expenses: [expense({ kind: "materials", desc: "", amountCents: 5000, forCustomer: true })],
    } as never);
    expect(it0.lines[0].label).toBe("Tarvikkeet");
    expect(it0.matchesBilling).toBe(true);
  });

  it("kuvaukseton alihankinta saa neutraalin varanimen, ei tyhjää eikä sisäistä", () => {
    const it0 = hourlyItemisation({
      shifts: [], expenses: [expense({ kind: "subcontract", desc: "", amountCents: 30000, marginCents: 7000 })],
    } as never);
    expect(it0.lines[0].label).toBe("Työsuoritus");
    expect(it0.lines[0].cents).toBe(37000);
  });

  /**
   * Tyhjä asiakasteksti EI saa olla se reitti jota myöten sisäinen kuvaus
   * lipsahtaa laskulle: varanimi on neutraali, ei `desc`.
   */
  it("tyhjä asiakasteksti antaa varanimen — ei sisäistä kuvausta", () => {
    const it0 = hourlyItemisation({
      shifts: [], expenses: [expense({
        kind: "subcontract", desc: "Mika", customerDesc: "   ", amountCents: 30000, marginCents: 7000,
      })],
    } as never);
    expect(it0.lines[0].label).toBe("Työsuoritus");
  });
});

/**
 * HINNAT SÄILYVÄT TALLENNUKSESSA.
 *
 * Sanitoija rakentaa paluuobjektin kenttä kerrallaan ilman levitystä, ja se
 * ajetaan myös LUETTAESSA. Listasta puuttuva kenttä katoaa siis heti, ei vasta
 * joskus — ja keikkakohtainen hinta palaisi hiljaa oletukseen kesken keikan.
 */
describe("keikkakohtaiset hinnat kestävät tallennuksen", () => {
  it("asetetut hinnat säilyvät sanitoinnin läpi", () => {
    const d = sanitizeProjectData({ ...emptyProjectData(), hourRateCents: 3000, workerHourCents: 1800 });
    expect(d.hourRateCents).toBe(3000);
    expect(d.workerHourCents).toBe(1800);
    expect(computeHourlyMoney(d).hourRateCents).toBe(3000);
  });

  it("asettamaton hinta ei jähmety oletukseksi kenttään", () => {
    const d = sanitizeProjectData(emptyProjectData());
    expect(d.hourRateCents).toBeUndefined();
    expect(d.workerHourCents).toBeUndefined();
    // …mutta laskenta käyttää silti oletusta.
    expect(computeHourlyMoney(d).hourRateCents).toBe(DEFAULT_HOUR_RATE_CENTS);
    expect(computeHourlyMoney(d).workerHourCents).toBe(DEFAULT_WORKER_HOUR_CENTS);
  });

  it("roskahinta ei tallennu", () => {
    const d = sanitizeProjectData({ ...emptyProjectData(), hourRateCents: 0, workerHourCents: -500 });
    expect(d.hourRateCents).toBeUndefined();
    expect(d.workerHourCents).toBeUndefined();
  });
});

/**
 * OMA TUNTIHINTA ON RIVILLÄ VALMIINA.
 *
 * Tekijälle vastaava koodi ei saa joutua valitsemaan asiakashinnan ja
 * tuntipalkan väliltä: väärin päin kirjoitettuna se kertoisi tekijälle
 * paljonko hänen tunnistaan jää meille. Rivi tietää sen itse.
 */
describe("perHourCents on kunkin oma tuntihinta", () => {
  it("työntekijälle tuntipalkka, perustajalle koko asiakashinta", () => {
    const m = computeHourlyMoney({ shifts: [shift("petrus", 3), shift("joonatan", 2)] });
    expect(m.byWorker.find((w) => w.id === "petrus")?.perHourCents).toBe(WAGE);
    expect(m.byWorker.find((w) => w.id === "joonatan")?.perHourCents).toBe(RATE);
  });

  it("tunnit × oma tuntihinta = oma ansio", () => {
    const m = computeHourlyMoney({ shifts: [shift("petrus", 7.5), shift("matias", 4.5)] });
    for (const w of m.byWorker) {
      expect(w.earnedCents).toBe(Math.round(w.hours * w.perHourCents));
    }
  });

  it("väärinpäin kirjatuilla hinnoilla tekijä ei saa yli asiakashinnan", () => {
    const m = computeHourlyMoney({ shifts: [shift("petrus", 1)], hourRateCents: 1500, workerHourCents: 2600 });
    expect(m.rateInverted).toBe(true);
    expect(m.byWorker[0].perHourCents).toBe(1500);
    expect(m.marginCents).toBe(0);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * IKKUNARAHA TUNTIKEIKALLA
 *
 * Tämä on rahaa joka katosi kahdesti: ikkunatyötä ei veloitettu tuntilaskulla
 * lainkaan (erittelyssä pelkkä tietorivi, eikä tuntinäkymässä ole toista
 * laskunappia), ja lähetys merkitsi silti kaikki pesut laskutetuiksi. Nämä
 * testit pitävät kummankin pään kiinni.
 * ──────────────────────────────────────────────────────────────────────────── */
function mapGig(over?: Partial<ProjectData>): ProjectData {
  const d = emptyProjectData();
  d.marks = { K: { marks: [{ p: 1, x: 0, y: 0 }, { p: 1, x: 1, y: 0 }, { p: 1, x: 2, y: 0 }, { p: 1, x: 3, y: 0 }] } };
  return { ...d, ...over } as ProjectData;
}

/** Tekijän ikkunapalkka crew-rivillä; ilman crewiä käytetään oletusta 20 €. */
function crewOf(rows: { id: string; role?: string; perWindowCents?: number }[]) {
  return rows.map((r) => ({
    id: r.id, name: r.id, token: `t-${r.id}`, role: r.role ?? "worker",
    perWindowCents: r.perWindowCents ?? 2000,
  }));
}

describe("ikkunaraha", () => {
  it("TEKIJÄN ikkuna: hän saa oman ikkunapalkkansa, erotus on katetta", () => {
    const d = mapGig();
    d.statuses["K#0"] = "pesty"; d.washedBy["K#0"] = "jani";
    d.crew = crewOf([{ id: "jani", perWindowCents: 2000 }]) as never;
    const w = computeWindowMoney(d);
    const price = Math.round(DEFAULT_PRICE_PER_WINDOW * 100);
    expect(w.pricePerWindowCents).toBe(price);
    expect(w.workerCostCents).toBe(2000);
    expect(w.marginCents).toBe(price - 2000);
    expect(w.founderWindowCents).toBe(0);
  });

  /**
   * PERUSTAJAN IKKUNA ON KOKONAAN HÄNEN. Sama sääntö kuin perustajan tunnilla,
   * ja sama unohtamisen hinta: jos hänestä otettaisiin "kate", hänen oma
   * palkkansa näyttäisi yhteiseltä rahalta ja hän saisi siitä vain puolet.
   */
  it("PERUSTAJAN ikkuna: koko ikkunahinta hänelle, ei katetta", () => {
    const d = mapGig();
    d.statuses["K#0"] = "pesty"; d.washedBy["K#0"] = "joonatan";
    const w = computeWindowMoney(d);
    const price = Math.round(DEFAULT_PRICE_PER_WINDOW * 100);
    expect(w.founderWindowCents).toBe(price);
    expect(w.marginCents).toBe(0);
    expect(w.workerCostCents).toBe(0);
    const joonatan = w.byFounder.find((f) => f.id === "joonatan")!;
    expect(joonatan.windowCents).toBe(price);
    // Eikä Matias saa siitä osaa: se ei ole katetta vaan Joonatanin työtä.
    expect(w.byFounder.find((f) => f.id === "matias")?.totalCents ?? 0).toBe(0);
  });

  it("jaettu ikkuna on puolikas kummallekin", () => {
    const d = mapGig();
    d.statuses["K#0"] = "pesty"; d.washedBy["K#0"] = "joonatan"; d.washedBy2!["K#0"] = "jani";
    d.crew = crewOf([{ id: "jani", perWindowCents: 2000 }]) as never;
    const w = computeWindowMoney(d);
    expect(w.byWasher.find((r) => r.id === "joonatan")!.windows).toBe(0.5);
    expect(w.byWasher.find((r) => r.id === "jani")!.windows).toBe(0.5);
    expect(w.byWasher.find((r) => r.id === "jani")!.earnedCents).toBe(1000);
  });

  it("ikkunaraha menee tasan: tekijät + perustajat = asiakkaan ikkunasumma", () => {
    const d = mapGig();
    d.statuses["K#0"] = "pesty"; d.washedBy["K#0"] = "jani";
    d.statuses["K#1"] = "pesty"; d.washedBy["K#1"] = "joonatan";
    d.statuses["K#2"] = "pesty"; d.washedBy["K#2"] = "milja";
    d.crew = crewOf([{ id: "jani" }, { id: "milja", perWindowCents: 1750 }]) as never;
    const w = computeWindowMoney(d);
    const founders = w.byFounder.reduce((n, f) => n + f.totalCents, 0);
    expect(w.workerCostCents + founders).toBe(w.customerCents);
    expect(w.customerCents).toBe(Math.round(3 * DEFAULT_PRICE_PER_WINDOW * 100));
  });

  it("VELOITETAAN vain laskuttamattomat ikkunat", () => {
    const d = mapGig();
    d.statuses["K#0"] = "pesty"; d.washedBy["K#0"] = "jani";
    d.statuses["K#1"] = "pesty"; d.washedBy["K#1"] = "jani";
    d.statuses["K#2"] = "pesty"; d.washedBy["K#2"] = "jani";
    const price = Math.round(DEFAULT_PRICE_PER_WINDOW * 100);

    // Kaikki laskuttamatta: kolme ikkunaa laskulle.
    const all = hourlyItemisation(d, { uninvoicedWindows: 3 });
    const chargedAll = all.lines.find((l) => /Ikkunanpesu/.test(l.label))!;
    expect(chargedAll.cents).toBe(3 * price);
    expect(all.customerTotalCents).toBe(3 * price);
    expect(all.matchesBilling).toBe(true);

    // Kaksi jo laskutettu: vain yksi menee laskulle, ja se sanotaan.
    const one = hourlyItemisation(d, { uninvoicedWindows: 1 });
    expect(one.lines.find((l) => /Ikkunanpesu/.test(l.label))!.cents).toBe(price);
    expect(one.customerTotalCents).toBe(price);
    expect(one.lines.some((l) => /Aiemmin laskutettu 2 ikkunaa/.test(l.label) && l.cents === null)).toBe(true);
    expect(one.matchesBilling).toBe(true);

    // Kaikki laskutettu: ei veloitusriviä, mutta työ kerrotaan yhä.
    const none = hourlyItemisation(d, { uninvoicedWindows: 0 });
    expect(none.customerTotalCents).toBe(0);
    expect(none.lines.every((l) => l.cents === null)).toBe(true);
    expect(none.matchesBilling).toBe(true);
  });

  it("ikkunat ja tunnit ovat molemmat laskulla, eikä erittely irtoa summasta", () => {
    const d = mapGig();
    d.statuses["K#0"] = "pesty"; d.washedBy["K#0"] = "jani";
    d.shifts = [{ id: "s1", worker: "jani", day: "2026-09-01", hours: 3, at: 1 }] as never;
    const it0 = hourlyItemisation(d, { uninvoicedWindows: 1 });
    const price = Math.round(DEFAULT_PRICE_PER_WINDOW * 100);
    expect(it0.customerTotalCents).toBe(3 * DEFAULT_HOUR_RATE_CENTS + price);
    expect(it0.matchesBilling).toBe(true);
    expect(it0.lines.some((l) => /Tuntityö/.test(l.label))).toBe(true);
    expect(it0.lines.some((l) => /Ikkunanpesu/.test(l.label))).toBe(true);
  });

  it("kartaton keikka ei saa ikkunariviä eikä kaadu", () => {
    const m = computeHourlyMoney({ ...emptyProjectData(), shifts: [] } as never);
    expect(m.windows).toBe(null);
    expect(m.windowsCents).toBe(0);
  });

  /**
   * TUNTEMATON LASKUTUSTILA EI SAA KEKSIÄ VELOITUSTA.
   *
   * Laskutusmerkintä elää keikan sektoreilla, ei projektidatassa. Aluksi
   * puuttuva tieto tulkittiin "kaikki laskuttamatta", ja se oli väärä suunta:
   * tuntipaneelin rahakortti näkee vain projektidatan, joten sadan jo
   * laskutetun pesun keikalla se olisi näyttänyt tuhansia euroja ikkunarahaa
   * joka on jo peritty — ja se luku olisi luettu laskun summana.
   */
  it("ilman laskutustietoa ikkunoista ei veloiteta mitään", () => {
    const d = mapGig();
    for (let i = 0; i < 4; i++) { d.statuses[`K#${i}`] = "pesty"; d.washedBy[`K#${i}`] = "jani"; }
    d.crew = crewOf([{ id: "jani" }]) as never;

    const blind = computeHourlyMoney(d);
    expect(blind.windowsCents).toBe(0);
    expect(blind.customerTotalCents).toBe(0);
    // Ansiot näkyvät silti: kuka on pessyt ja mitä hänelle kuuluu ei riipu
    // siitä onko asiakasta laskutettu.
    expect(blind.windows!.byWasher[0].earnedCents).toBe(4 * 2000);

    // Ja kun tila on tiedossa, veloitus on täsmälleen se.
    expect(computeHourlyMoney(d, { uninvoicedWindows: 1 }).windowsCents)
      .toBe(Math.round(DEFAULT_PRICE_PER_WINDOW * 100));
  });

  it("laskuttamattomia ei voi olla enempää kuin pestyjä", () => {
    const d = mapGig();
    d.statuses["K#0"] = "pesty"; d.washedBy["K#0"] = "jani";
    expect(computeWindowMoney(d, { uninvoicedWindows: 99 }).uninvoicedWindows).toBe(1);
    expect(computeWindowMoney(d, { uninvoicedWindows: -5 }).uninvoicedWindows).toBe(0);
    // Ja puuttuva tieto on nolla, ei "kaikki".
    expect(computeWindowMoney(d).uninvoicedWindows).toBe(0);
  });
});

/**
 * SOVITTU LISÄ — vapaa rivi asiakkaan laskulle.
 *
 * "102 € sovittu lisä" ei ole kulu: kukaan ei ole maksanut siitä mitään
 * omasta pussistaan. Jos se käsiteltäisiin kuluna, laskenta lupaisi jollekulle
 * 102 € takaisin kulujen palautuksena rahasta jota ei ole maksettu — ja se
 * raha lähtisi meiltä.
 */
describe("sovittu lisä laskulle", () => {
  it("menee laskulle täysimääräisenä ja on kokonaan katetta", () => {
    const m = computeHourlyMoney({
      shifts: [],
      expenses: [expense({ kind: "surcharge", amountCents: 10200, customerDesc: "Sovittu lisä" })],
    });
    expect(m.customerTotalCents).toBe(10200);
    expect(m.subcontractMarginCents).toBe(10200);
    // EI palautusta: kukaan ei maksanut siitä mitään.
    expect(m.reimbursementCents).toBe(0);
    expect(m.byPayer).toEqual([]);
    // Ja se jää perustajille.
    expect(m.founderTotalCents).toBe(10200);
  });

  it("näkyy laskulla annetulla selitteellä", () => {
    const it0 = hourlyItemisation({
      ...emptyProjectData(), shifts: [],
      expenses: [expense({ kind: "surcharge", amountCents: 10200, desc: "sisäinen", customerDesc: "Sovittu lisä" })],
    } as never);
    const line = it0.lines.find((l) => l.cents === 10200)!;
    expect(line.label).toBe("Sovittu lisä");
    expect(it0.matchesBilling).toBe(true);
  });

  it("ilman selitettä varanimi, ei sisäistä muistiinpanoa", () => {
    const it0 = hourlyItemisation({
      ...emptyProjectData(), shifts: [],
      expenses: [expense({ kind: "surcharge", amountCents: 5000, desc: "Mikan kanssa sovittu" })],
    } as never);
    expect(it0.lines.find((l) => l.cents === 5000)!.label).toBe("Sovittu lisä");
    expect(JSON.stringify(it0.lines)).not.toMatch(/Mikan/);
  });

  it("veloitetaan aina — forCustomer-merkintää ei tarvita eikä odoteta", () => {
    const m = computeHourlyMoney({
      shifts: [],
      expenses: [expense({ kind: "surcharge", amountCents: 3000 })],
    });
    expect(m.customerTotalCents).toBe(3000);
  });

  it("raha täsmää lisärivin kanssa", () => {
    const m = computeHourlyMoney({
      shifts: [shift("petrus", 10)],
      expenses: [
        expense({ kind: "surcharge", amountCents: 10200, customerDesc: "Sovittu lisä" }),
        expense({ amountCents: 4500, desc: "lamput", forCustomer: true, by: "matias" }),
      ],
    });
    expect(m.workerCostCents + m.founderTotalCents + m.reimbursementCents + m.windowsCents)
      .toBe(m.customerTotalCents);
  });
});
