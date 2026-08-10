import { describe, expect, it } from "vitest";
import { auditWindowCounts } from "./count-audit";
import type { ProjectData, WindowStatus } from "./project";

/**
 * VARTIJA. "Laskimme 77 pestyä, paneeli väittää 79."
 *
 * Laskenta ohittaa poistetut, joten poistettu ikkuna ei voi olla mukana — se
 * on tässä testattu, koska se oli ensimmäinen epäilys ja sen pitää pysyä
 * poissuljettuna. Ero silmämääräiseen laskentaan syntyy toisesta asiasta:
 * kaksi pistettä lähes samassa kohdassa näkyy kartalla yhtenä pallona.
 */

function project(
  pts: { f?: string; p: 1 | 2; x: number; y: number; status?: WindowStatus; deleted?: boolean; custom?: boolean }[],
): ProjectData {
  const marks: Record<string, { marks: { p: 1 | 2; x: number; y: number }[] }> = {};
  const customMarks: Record<string, { key: string; p: 1 | 2; x: number; y: number }[]> = {};
  const statuses: Record<string, WindowStatus> = {};
  const deleted: Record<string, boolean> = {};
  const floors = Array.from(new Set(pts.map((p) => p.f ?? "1")));
  for (const f of floors) { marks[f] = { marks: [] }; customMarks[f] = []; }
  let cIdx = 0;
  for (const pt of pts) {
    const f = pt.f ?? "1";
    let key: string;
    if (pt.custom) {
      key = `${f}#c${cIdx++}`;
      customMarks[f].push({ key, p: pt.p, x: pt.x, y: pt.y });
    } else {
      key = `${f}#${marks[f].marks.length}`;
      marks[f].marks.push({ p: pt.p, x: pt.x, y: pt.y });
    }
    if (pt.status) statuses[key] = pt.status;
    if (pt.deleted) deleted[key] = true;
  }
  return {
    building: { name: null, address: null, floors, planBase: "/x/" },
    marks, statuses, washedBy: {}, customMarks, posOverrides: {}, deleted,
    log: [], hours: {}, hourLog: [], workers: [],
  } as unknown as ProjectData;
}

describe("auditWindowCounts", () => {
  it("poistettu ikkuna EI ole mukana pestyissä, vaikka status olisi jäänyt", () => {
    const data = project([
      { p: 2, x: 10, y: 10, status: "pesty" },
      { p: 2, x: 40, y: 40, status: "pesty", deleted: true },
    ]);
    // Status jää roikkumaan tarkoituksella — laskennan ei silti pidä nähdä sitä.
    expect(data.statuses["1#1"]).toBe("pesty");
    expect(auditWindowCounts(data).totalYellowWashed).toBe(1);
  });

  it("löytää lähes päällekkäiset pisteet — kartalla yksi pallo, datassa kaksi", () => {
    const data = project([
      { p: 2, x: 30, y: 30, status: "pesty" },
      { p: 2, x: 30.4, y: 30.3, status: "pesty" },   // tuplanapautus
      { p: 2, x: 70, y: 70, status: "pesty" },
    ]);
    const a = auditWindowCounts(data);
    expect(a.totalYellowWashed).toBe(3);        // kone laskee kolme
    expect(a.overlaps).toHaveLength(1);
    expect(a.overlaps[0].keys).toEqual(["1#0", "1#1"]);
    expect(a.overlapExtra).toBe(1);             // silmä laskee kaksi
    expect(a.overlapExtraWashed).toBe(1);
  });

  it("erilliset pisteet eivät ole päällekkäisiä", () => {
    const data = project([{ p: 2, x: 30, y: 30 }, { p: 2, x: 35, y: 30 }]);
    expect(auditWindowCounts(data).overlaps).toEqual([]);
  });

  it("eri kerroksissa samat koordinaatit eivät ole päällekkäisiä", () => {
    const data = project([{ f: "1", p: 2, x: 30, y: 30 }, { f: "2", p: 2, x: 30, y: 30 }]);
    expect(auditWindowCounts(data).overlaps).toEqual([]);
  });

  it("siirretty piste tutkitaan siitä mihin se on siirretty", () => {
    const data = project([{ p: 2, x: 10, y: 10 }, { p: 2, x: 80, y: 80 }]);
    (data.posOverrides as Record<string, { x: number; y: number }>)["1#1"] = { x: 10.2, y: 10.1 };
    expect(auditWindowCounts(data).overlaps).toHaveLength(1);
  });

  it("kolmen pisteen kasa on yksi ryhmä, ei kolme paria", () => {
    const data = project([
      { p: 2, x: 50, y: 50, status: "pesty" },
      { p: 2, x: 50.3, y: 50.2, status: "pesty" },
      { p: 2, x: 50.6, y: 50.4 },
    ]);
    const a = auditWindowCounts(data);
    expect(a.overlaps).toHaveLength(1);
    expect(a.overlaps[0].keys).toHaveLength(3);
    expect(a.overlapExtra).toBe(2);
    expect(a.overlapExtraWashed).toBe(1);       // kahdesta pestystä yksi jäisi
  });

  it("kerroserittely summautuu kokonaislukuihin", () => {
    const data = project([
      { f: "1", p: 2, x: 10, y: 10, status: "pesty" },
      { f: "1", p: 1, x: 20, y: 20, status: "pesty" },
      { f: "4", p: 2, x: 10, y: 10 },
      { f: "4", p: 2, x: 60, y: 60, status: "pesty" },
    ]);
    const a = auditWindowCounts(data);
    expect(a.byFloor.reduce((n, f) => n + f.yellowWashed, 0)).toBe(a.totalYellowWashed);
    expect(a.byFloor.reduce((n, f) => n + f.yellow, 0)).toBe(a.totalYellow);
    expect(a.totalYellowWashed).toBe(2);
    expect(a.totalRedWashed).toBe(1);
    expect(a.byFloor.find((f) => f.floor === "4")).toMatchObject({ yellow: 2, yellowWashed: 1 });
  });

  it("lisätty ja pohjapiste voivat olla päällekkäin keskenään", () => {
    const data = project([
      { p: 2, x: 25, y: 25, status: "pesty" },
      { p: 2, x: 25.5, y: 25, status: "pesty", custom: true },
    ]);
    const a = auditWindowCounts(data);
    expect(a.overlaps).toHaveLength(1);
    expect(a.overlaps[0].keys).toEqual(["1#0", "1#c0"]);
  });

  it("tyhjä projekti ei kaadu", () => {
    const a = auditWindowCounts(project([]));
    expect(a).toMatchObject({ totalYellow: 0, totalYellowWashed: 0, overlaps: [], duplicateKeys: [] });
  });
});
