import { describe, expect, it } from "vitest";
import { buildTasaus } from "./fr8-tasaus";
import { newGigProjectData, type ProjectData } from "./project";
import type { CrewMember, CrewPayout } from "./crew";

/**
 * KÄSIN KIRJATTUJEN TEKIJÄMAKSUJEN MAKSAJA.
 *
 * Etusivu valitti kuukausia summasta "380,00 € maksettu ilman maksajamerkintää",
 * vaikka maksaja oli tallennettu joka maksulle sen syntyhetkellä
 * (`CrewPayout.buyer.billerId`, hallintanäkymän pakollinen valitsin). Moottori ei
 * lukenut sitä kenttää lainkaan vaan pyysi kirjaamaan saman tiedon TOISEEN
 * kenttään (`settlement.paidBy`) — ja valitti siihen asti.
 *
 * Näissä testeissä on kolme sääntöä:
 *   1. tallennettu ostaja luetaan maksajaksi,
 *   2. käsin kirjattu ohitus voittaa sen,
 *   3. mitään ei arvata: tuntematon ostaja jää kohdentamattomaksi.
 */

function payout(id: string, cents: number, billerId?: string): CrewPayout {
  return {
    id,
    amountCents: cents,
    windows: 1,
    status: "maksettu",
    createdAt: 1,
    ...(billerId
      ? { buyer: { billerId, name: billerId === "company" ? "Puuhapatet Oy" : billerId } }
      : {}),
  };
}

function projectWith(payouts: CrewPayout[]): ProjectData {
  const worker: CrewMember = {
    id: "jani",
    token: "t-jani",
    name: "Jani",
    role: "worker",
    perWindowCents: 2_000,
    payouts,
  };
  return { ...newGigProjectData(), crew: [worker] };
}

const paidOf = (t: ReturnType<typeof buildTasaus>, id: string) =>
  t.result.rows.find((r) => r.id === id)!.paidOutCents;

describe("buildTasaus — käsin kirjatun maksun maksaja", () => {
  it("tallennettu ostaja luetaan maksajaksi, eikä summa ole kohdentamaton", () => {
    const t = buildTasaus(projectWith([payout("p1", 38_000, "matias")]), [], []);
    expect(t.unattributedPaidCents).toBe(0);
    expect(paidOf(t, "matias")).toBe(38_000);
    expect(paidOf(t, "joonatan")).toBe(0);
    expect(t.payouts[0].unattributed).toBe(false);
    expect(t.payouts[0].paidById).toBe("matias");
  });

  it("puuttuva ostaja jää kohdentamattomaksi — mitään ei arvata", () => {
    const t = buildTasaus(projectWith([payout("p1", 38_000)]), [], []);
    expect(t.unattributedPaidCents).toBe(38_000);
    expect(t.payouts[0].paidById).toBeNull();
  });

  it("yritysostaja ei ole johtaja, joten se jää kohdentamattomaksi", () => {
    // `resolveBuyer` voi palauttaa "company"-ostajan. Se ei ole kumpikaan
    // johtaja, joten sen lukeminen maksajaksi olisi arvaus.
    const t = buildTasaus(projectWith([payout("p1", 38_000, "company")]), [], []);
    expect(t.unattributedPaidCents).toBe(38_000);
    expect(t.payouts[0].paidById).toBeNull();
  });

  it("käsin kirjattu ohitus voittaa tallennetun ostajan", () => {
    const project = projectWith([payout("p1", 38_000, "matias")]);
    const t = buildTasaus(project, [], [], {
      paidBy: { "manual:jani:p1": "joonatan" },
    } as any);
    expect(t.unattributedPaidCents).toBe(0);
    expect(paidOf(t, "joonatan")).toBe(38_000);
    expect(paidOf(t, "matias")).toBe(0);
    expect(t.payouts[0].overridden).toBe(true);
  });

  it("vanha per-tekijä-avain luetaan yhä, jottei tehty kohdennus katoa", () => {
    const t = buildTasaus(projectWith([payout("p1", 38_000)]), [], [], {
      paidBy: { "manual:jani": "matias" },
    } as any);
    expect(t.unattributedPaidCents).toBe(0);
    expect(paidOf(t, "matias")).toBe(38_000);
  });

  it("saman tekijän maksut voivat tulla eri johtajilta — rivi per maksu", () => {
    // Tämä oli mahdotonta niin kauan kuin rivi oli tekijän KAIKKIEN maksujen
    // summa: koko summa oli pakko antaa toiselle johtajalle.
    const t = buildTasaus(
      projectWith([payout("p1", 20_000, "joonatan"), payout("p2", 18_000, "matias")]),
      [], [],
    );
    expect(t.unattributedPaidCents).toBe(0);
    expect(paidOf(t, "joonatan")).toBe(20_000);
    expect(paidOf(t, "matias")).toBe(18_000);
    expect(t.payouts).toHaveLength(2);
  });

  it("maksamaton maksu ei ole rahaa eikä näy missään summassa", () => {
    const project = projectWith([{ ...payout("p1", 38_000, "matias"), status: "odottaa" }]);
    const t = buildTasaus(project, [], []);
    expect(t.unattributedPaidCents).toBe(0);
    expect(paidOf(t, "matias")).toBe(0);
    expect(t.payouts).toHaveLength(0);
  });

  it("kirjattu siirto ei muuta kohdentamatonta summaa", () => {
    // Käyttäjän kokemus oli että "tasasin sen, mutta se valittaa yhä" — nämä
    // ovat eri asioita, ja se pitää pysyä niin.
    const project = projectWith([payout("p1", 38_000)]);
    const withTransfer = buildTasaus(project, [], [], {
      transfers: [{ id: "tr1", fromId: "joonatan", toId: "matias", cents: 10_000, ts: 1 }],
    } as any);
    expect(withTransfer.unattributedPaidCents).toBe(38_000);
  });
});

/**
 * OMA TULO = LASKUTETTU, EI KERTYNYT.
 *
 * `result.rows[i].entitledCents` on kertymäperusteinen: keltaisten TEKIJÄKULU
 * vähennetään heti kun ikkuna on pesty ja hinta lukittu, myös silloin kun
 * keltaisista ei ole laskutettu senttiäkään. Etusivun "Oma tulo" painui siitä
 * alas — ja `Math.max(0, …)` piilotti sen kokonaan, jolloin luku näytti tulevan
 * pelkistä pikkukeikoista.
 *
 * `invoicedEntitledCents` on sama laskenta keltaisten LASKUTETULLA osuudella.
 */
describe("buildTasaus — invoicedEntitledCents", () => {
  const marks = (n: number) => ({ Tila: { marks: Array.from({ length: n }, (_, i) => ({ p: 1 as const, x: i, y: 0 })) } });

  function gigWithRedWork(): ProjectData {
    const p = newGigProjectData();
    p.building.floors = ["Tila"];
    p.marks = marks(4);
    p.pricePerWindow = 37.5;
    // Kaksi tekijän pesemää, kaksi johtajan.
    p.statuses = { "Tila#0": "pesty", "Tila#1": "pesty", "Tila#2": "pesty", "Tila#3": "pesty" };
    p.washedBy = { "Tila#0": "jani", "Tila#1": "jani", "Tila#2": "joonatan", "Tila#3": "matias" };
    p.crew = [{ id: "jani", token: "t", name: "Jani", role: "worker", perWindowCents: 2_000 }] as any;
    return p;
  }

  const payment = (cents: number, biller: string, scope?: "p1" | "p2") => ({
    t: 1, amountCents: cents, biller: { id: biller, name: biller }, ...(scope ? { scope } : {}),
  }) as any;

  it("ilman keltaisia luku on sama kuin kertymäperusteinen — laskenta ei ajelehdi", () => {
    const t = buildTasaus(gigWithRedWork(), [payment(150_00, "joonatan")], []);
    for (const r of t.result.rows) {
      expect(t.invoicedEntitledCents[r.id]).toBe(r.entitledCents);
    }
  });

  it("jokaiselle johtajalle tulee luku, myös nollakeikalla", () => {
    const t = buildTasaus(newGigProjectData(), [], []);
    expect(Object.keys(t.invoicedEntitledCents).sort()).toEqual(t.result.rows.map((r) => r.id).sort());
  });

  it("lisäys ei muuta tasauksen omaa vastausta (siirto ja varaus ennallaan)", () => {
    // Toinen laskenta on olemassa vain "Oma tulo" -lukua varten. Jos se vuotaisi
    // tasaukseen, sovellus antaisi taas kaksi eri vastausta kysymykseen "kuka on
    // velkaa kummalle" (invariantti 19).
    const project = gigWithRedWork();
    const payments = [payment(300_00, "joonatan"), payment(100_00, "matias")];
    const t = buildTasaus(project, payments, []);
    const again = buildTasaus(project, payments, []);
    expect(t.result.transfer).toEqual(again.result.transfer);
    expect(t.result.reserveCents).toBe(again.result.reserveCents);
    // Ja summa on yhä sidottu laskutettuun pottiin, ei kertymään.
    const sum = Object.values(t.invoicedEntitledCents).reduce((s, c) => s + c, 0);
    expect(sum).toBeLessThanOrEqual(t.input.p1PotCents + t.input.p2PotCents);
  });
});

/**
 * TUNTITYÖ TASAUKSESSA.
 *
 * Tuntikeikka meni tasauksessa väärin kahdesta suunnasta yhtä aikaa:
 * tekijöiden tuntipalkkoja ei vähennetty jaettavasta potista, ja johtajan oma
 * tuntityö ei näkynyt hänen ansaintanaan. Nämä testit lukitsevat molemmat.
 */
describe("buildTasaus — tuntityö", () => {
  /** Keikka, jolla on annetut tuntivuorot eikä yhtään ikkunaa. */
  function hourlyProject(shifts: { worker: string; hours: number }[]): ProjectData {
    const p = projectWith([]);
    return {
      ...p,
      // Perustaja on crew-listalla roolilla "host", jotta hänen tuntinsa
      // luetaan omaksi työksi eikä tekijäkuluksi.
      crew: [
        ...(p.crew ?? []),
        { id: "joonatan", token: "t-j", name: "Joonatan", role: "host", perWindowCents: 0 } as CrewMember,
      ],
      shifts: shifts.map((s, i) => ({ id: `s${i}`, worker: s.worker, day: "2026-01-02", hours: s.hours, at: i + 1 })),
    };
  }

  it("vähentää tekijöiden tuntipalkat jaettavasta potista", () => {
    // Asiakkaalta 10 h × 26 € = 260 €. Tekijän palkka 10 × 15 € = 150 €.
    // Jaettavaa on kate 110 €, ei koko 260 €.
    const t = buildTasaus(
      hourlyProject([{ worker: "jani", hours: 10 }]),
      [{ t: 1, amountCents: 260_00, scope: "hours", biller: { id: "joonatan" } }],
      [],
    );
    expect(t.input.hoursPotCents).toBe(260_00);
    expect(t.input.workerHoursEarnedCents).toBe(150_00);
    expect(t.result.distributableCents).toBe(110_00);
    // Tuntilasku EI ole urakan erä eikä siis nosta €/ikkuna-hintaa.
    expect(t.input.p1PotCents).toBe(0);
    expect(t.result.xCents).toBe(0);
  });

  it("antaa johtajalle hänen oman tuntityönsä täydellä tuntihinnalla", () => {
    // Joonatan teki itse 10 h → 260 € omaa työtä, ei katetta kummallekaan.
    const t = buildTasaus(
      hourlyProject([{ worker: "joonatan", hours: 10 }]),
      [{ t: 1, amountCents: 260_00, scope: "hours", biller: { id: "joonatan" } }],
      [],
    );
    const joonatan = t.result.rows.find((r) => r.id === "joonatan")!;
    const matias = t.result.rows.find((r) => r.id === "matias")!;
    expect(joonatan.hoursOwnCents).toBe(260_00);
    expect(matias.hoursOwnCents).toBe(0);
    expect(t.input.workerHoursEarnedCents).toBe(0);
    // Koko potti on Joonatanin omaa työtä → ei jaettavaa katetta, ei siirtoa.
    expect(t.result.founderKateCents).toBe(0);
    expect(joonatan.entitledCents).toBe(260_00);
    expect(t.result.transfer).toBeNull();
  });

  it("nimeää tuntilaskun ja yhdistetyn laskun omikseen eikä urakan eräksi", () => {
    const t = buildTasaus(
      hourlyProject([]),
      [
        { t: 1, amountCents: 100_00, scope: "p1", biller: { id: "joonatan" } },
        { t: 2, amountCents: 200_00, scope: "hours", biller: { id: "joonatan" } },
        { t: 3, amountCents: 300_00, scope: "all", parts: { hours: 120_00, p2: 80_00 }, biller: { id: "matias" } },
      ],
      [],
    );
    expect(t.eras.map((e) => e.label)).toEqual(["Erä 1", "Tuntilasku", "Yhdistetty lasku"]);
    expect(t.input.p1PotCents).toBe(200_00);      // 100 + (300 − 120 − 80)
    expect(t.input.hoursPotCents).toBe(320_00);   // 200 + 120
    expect(t.input.p2PotCents).toBe(80_00);
  });
});
