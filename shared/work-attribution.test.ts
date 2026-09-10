/**
 * KOHDENTAMATON TYÖ — testit sille että yksikään euro ei katoa.
 *
 * Jokainen näistä on oikea tapaus jossa tehty työ katosi ruudulta kokonaan:
 * poistettu tekijä, harjoittelija ja nimeämätön puolikas. Testit vartioivat
 * sekä sitä että raha LÖYTYY että sitä ettei sitä lasketa kahteen kertaan.
 */
import { describe, it, expect } from "vitest";
import { buildAttributionAudit, UNNAMED_WASHER_ID, normalizedSecondWasher } from "./work-attribution";
import { crewMemberStats } from "./crew";
import { founderWashCounts } from "./fr8-tasaus";
import { emptyProjectData, type ProjectData } from "./project";

/** Keikka jossa on `n` punaista ikkunaa yhdessä kerroksessa. */
function projectWith(n: number, over: Partial<ProjectData> = {}): ProjectData {
  const base = emptyProjectData();
  const floor = base.building.floors[0];
  const marks = Array.from({ length: n }, (_, i) => ({ x: i * 10, y: 0, p: 1 as const }));
  const statuses: Record<string, string> = {};
  for (let i = 0; i < n; i++) statuses[`${floor}#${i}`] = "pesty";
  return {
    ...base,
    marks: { ...base.marks, [floor]: { marks } },
    statuses: statuses as ProjectData["statuses"],
    ...over,
  };
}

const key = (i: number, p: ProjectData) => `${p.building.floors[0]}#${i}`;

const crewMember = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: id[0].toUpperCase() + id.slice(1), token: `t-${id}`,
  perWindowCents: 2000, role: "worker" as const, active: true, ...over,
});

describe("normalizedSecondWasher", () => {
  it("sama henkilö molemmissa päissä ei ole jaettu ikkuna", () => {
    expect(normalizedSecondWasher("oona", "oona")).toBe("");
  });
  it("tyhjä toinen pesijä on tyhjä", () => {
    expect(normalizedSecondWasher("oona", "")).toBe("");
    expect(normalizedSecondWasher("oona", undefined)).toBe("");
  });
  it("aito pari säilyy", () => {
    expect(normalizedSecondWasher("oona", "selma")).toBe("selma");
  });
});

describe("sama pesijä kirjattuna kahdesti", () => {
  it("maksaa KOKO ikkunan, ei puolikasta — ja tasaus on samaa mieltä", () => {
    const p = projectWith(1);
    p.washedBy = { [key(0, p)]: "oona" };
    p.washedBy2 = { [key(0, p)]: "oona" };
    p.crew = [crewMember("oona")] as ProjectData["crew"];

    // Ennen korjausta: crewMemberStats antoi 0,5 ja tasaus 1,0 — tekijä näki
    // puolet omastaan katoavan sen mukaan mitä näkymää katsoi.
    expect(crewMemberStats(p, p.crew![0] as never).p1Washed).toBe(1);
    expect(crewMemberStats(p, p.crew![0] as never).p1EarnedCents).toBe(2000);
    expect(founderWashCounts(p).workerP1EarnedByWorker.oona).toBe(2000);
  });
});

describe("poistettu tekijä", () => {
  it("näkyy omana kohdentamattomana eränään eikä katoa hiljaa", () => {
    const p = projectWith(2);
    p.washedBy = { [key(0, p)]: "haamu", [key(1, p)]: "oona" };
    p.crew = [crewMember("oona")] as ProjectData["crew"];

    const audit = buildAttributionAudit(p);
    expect(audit.any).toBe(true);
    expect(audit.removedCents).toBe(2000);
    expect(audit.removedWindows).toBe(1);
    // Maksettava tekijä EI ole kohdentamattomissa — hän on maksulistalla.
    expect(audit.buckets.map((b) => b.id)).toEqual(["haamu"]);
    expect(audit.buckets[0].kind).toBe("removed");
  });

  it("deaktivoitu crew-rivi lasketaan samaan pottiin", () => {
    const p = projectWith(1);
    p.washedBy = { [key(0, p)]: "vanha" };
    p.crew = [crewMember("vanha", { active: false })] as ProjectData["crew"];
    expect(buildAttributionAudit(p).removedCents).toBe(2000);
  });
});

describe("harjoittelija (Milja)", () => {
  it("ei ole kadonnutta rahaa vaan vastuujohtajan tilitettävää", () => {
    const p = projectWith(1);
    p.washedBy = { [key(0, p)]: "milja" };
    p.crew = [crewMember("milja", { name: "Milja Pitkänen" })] as ProjectData["crew"];

    const audit = buildAttributionAudit(p);
    expect(audit.traineeCents).toBe(2000);
    expect(audit.removedCents).toBe(0);
    const bucket = audit.buckets[0];
    expect(bucket.kind).toBe("trainee");
    expect(bucket.responsibleLeaderId).toBe("matias");
    expect(bucket.responsibleLeaderName).toBe("Matias Pitkänen");
  });
});

describe("nimeämätön puolikas", () => {
  it("puolittaa nimetyn tekijän osuuden eikä maksa hänelle koko ikkunaa", () => {
    const p = projectWith(1);
    p.washedBy = { [key(0, p)]: "oona" };
    p.washedBy2 = { [key(0, p)]: UNNAMED_WASHER_ID };
    p.crew = [crewMember("oona")] as ProjectData["crew"];

    // Nimetty tekijä saa puolet…
    expect(crewMemberStats(p, p.crew![0] as never).p1Washed).toBe(0.5);
    expect(crewMemberStats(p, p.crew![0] as never).p1EarnedCents).toBe(1000);
    // …ja toinen puolisko näkyy kohdentamattomana eikä katoa.
    const audit = buildAttributionAudit(p);
    expect(audit.unnamedWindows).toBe(0.5);
    expect(audit.unnamedCents).toBe(1000);
    // Tasauksessa se on kohdentamatonta, ei tekijäkulua.
    const f = founderWashCounts(p);
    expect(f.unattributedP1Windows).toBe(0.5);
    expect(f.workerP1Windows).toBe(0.5);
  });

  it("pesijätön ikkuna on samassa potissa", () => {
    const p = projectWith(1);
    p.crew = [crewMember("oona")] as ProjectData["crew"];
    const audit = buildAttributionAudit(p);
    expect(audit.unnamedWindows).toBe(1);
    expect(audit.unnamedCents).toBe(2000);
  });
});

describe("perustajan oma työ", () => {
  it("ei ole kohdentamatonta — se on katetta, ei maksamatonta velkaa", () => {
    const p = projectWith(1);
    p.washedBy = { [key(0, p)]: "joonatan" };
    p.crew = [crewMember("joonatan", { role: "host" })] as ProjectData["crew"];
    expect(buildAttributionAudit(p).any).toBe(false);
  });
});

describe("maksettava tekijä", () => {
  it("ei koskaan päädy kohdentamattomiin", () => {
    const p = projectWith(3);
    p.washedBy = { [key(0, p)]: "oona", [key(1, p)]: "oona", [key(2, p)]: "selma" };
    p.crew = [crewMember("oona"), crewMember("selma")] as ProjectData["crew"];
    expect(buildAttributionAudit(p)).toMatchObject({ any: false, totalCents: 0 });
  });
});

describe("jo maksettu ei ole selvitettävää", () => {
  it("poistettu tekijä joka on maksettu kokonaan katoaa listalta", () => {
    const p = projectWith(2);
    p.washedBy = { [key(0, p)]: "haamu", [key(1, p)]: "haamu" };
    p.crew = [] as ProjectData["crew"];

    // Ansaittu 2 × 20 € = 40 €, ja hänelle on jo laskutettu 40 €.
    const audit = buildAttributionAudit(p, { settledCentsById: { haamu: 4000 } });
    expect(audit.any).toBe(false);
    expect(audit.removedCents).toBe(0);
  });

  it("osittain maksettu näyttää vain jäljellä olevan", () => {
    const p = projectWith(2);
    p.washedBy = { [key(0, p)]: "haamu", [key(1, p)]: "haamu" };
    p.crew = [] as ProjectData["crew"];

    const audit = buildAttributionAudit(p, { settledCentsById: { haamu: 1500 } });
    expect(audit.removedCents).toBe(2500);
    expect(audit.buckets[0]).toMatchObject({ earnedCents: 4000, settledCents: 1500, totalCents: 2500 });
  });

  it("crew-riville kirjattu käsin maksettu payout vähennetään", () => {
    const p = projectWith(1);
    p.washedBy = { [key(0, p)]: "milja" };
    p.crew = [crewMember("milja", {
      name: "Milja Pitkänen",
      payouts: [{ id: "x", amountCents: 2000, status: "maksettu", ts: 1 }],
    })] as ProjectData["crew"];
    expect(buildAttributionAudit(p).any).toBe(false);
  });

  it("nimeämättömälle ei voi olla maksuja — sen id ei kuittaudu vahingossa", () => {
    const p = projectWith(1);
    p.washedBy = { [key(0, p)]: "oona" };
    p.washedBy2 = { [key(0, p)]: UNNAMED_WASHER_ID };
    p.crew = [crewMember("oona")] as ProjectData["crew"];
    const audit = buildAttributionAudit(p, { settledCentsById: { [UNNAMED_WASHER_ID]: 99999 } });
    expect(audit.unnamedCents).toBe(1000);
  });
});
