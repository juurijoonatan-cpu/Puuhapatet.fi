import { describe, expect, it } from "vitest";
import { emptyProjectData, checkWindowAttribution, computeProjectTotals, computeWorkerStats, type ProjectData } from "./project";

// Kohta 6.1 — kokonaistilanteen ikkunamäärän täsmäytys. Ks. docs/fr8-era-laskutus-plan.md.
function fixture(): ProjectData {
  const data = emptyProjectData();
  data.marks = { K: { marks: [{ p: 1, x: 0, y: 0 }, { p: 1, x: 1, y: 0 }, { p: 1, x: 2, y: 0 }, { p: 1, x: 3, y: 0 }] } };
  // K#0: solo-pesty (Jani, täysi krediitti).
  data.statuses["K#0"] = "pesty";
  data.washedBy["K#0"] = "jani";
  // K#1: jaettu ikkuna (Joonatan + Matias, 0.5 kumpikin) — desimaali-tapaus (13,5/24,5-tyyppinen).
  data.statuses["K#1"] = "pesty";
  data.washedBy["K#1"] = "joonatan";
  data.washedBy2!["K#1"] = "matias";
  // K#2: solo-pesty (Milja).
  data.statuses["K#2"] = "pesty";
  data.washedBy["K#2"] = "milja";
  // K#3: kesken (ei pesty) — ei saa vaikuttaa summaan.
  data.statuses["K#3"] = "kesken";
  return data;
}

describe("checkWindowAttribution — kohta 6.1 (ikkunamäärän täsmäytys)", () => {
  it("täsmää kun kaikki pestyt ikkunat on attribuoitu (sis. 0.5-jaetut)", () => {
    const data = fixture();
    const totals = computeProjectTotals(data);
    expect(totals.washed).toBe(3); // K#0, K#1, K#2 — K#3 on kesken

    const stats = computeWorkerStats(data);
    const byWorker = Object.fromEntries(stats.map((s) => [s.worker, s.washed]));
    expect(byWorker.jani).toBe(1);
    expect(byWorker.joonatan).toBe(0.5);
    expect(byWorker.matias).toBe(0.5);
    expect(byWorker.milja).toBe(1);

    const check = checkWindowAttribution(data);
    expect(check.dotCount).toBe(3);
    expect(check.attributedSum).toBe(3);
    expect(check.diff).toBe(0);
    expect(check.matches).toBe(true);
  });

  it("paljastaa eron kun pesty ikkuna on ilman attribuutiota (regressio: 'heittää yhdellä')", () => {
    const data = fixture();
    delete data.washedBy["K#2"]; // pesty mutta ei tiedossa kuka pesi
    const check = checkWindowAttribution(data);
    expect(check.dotCount).toBe(3);
    expect(check.attributedSum).toBe(2);
    expect(check.diff).toBe(1);
    expect(check.matches).toBe(false);
  });

  it("desimaali-ikkunoiden summaus ei heitä vaikka jaettuja ikkunoita olisi monta", () => {
    const data = emptyProjectData();
    data.marks = { K: { marks: Array.from({ length: 6 }, (_, i) => ({ p: 1 as const, x: i, y: 0 })) } };
    // 6 jaettua ikkunaa J+M kesken -> J ja M molemmat 3.0 (6 × 0.5), yhteensä 6.
    for (let i = 0; i < 6; i++) {
      data.statuses[`K#${i}`] = "pesty";
      data.washedBy[`K#${i}`] = "joonatan";
      data.washedBy2![`K#${i}`] = "matias";
    }
    const check = checkWindowAttribution(data);
    expect(check.dotCount).toBe(6);
    expect(check.attributedSum).toBe(6);
    expect(check.matches).toBe(true);
  });
});
