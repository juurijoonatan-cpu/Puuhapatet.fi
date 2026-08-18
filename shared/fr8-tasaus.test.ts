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
