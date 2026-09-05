import { describe, expect, it } from "vitest";
import { seasonForMonth, currentSeason, showsWinterServices, type Season } from "./season";

const MONTHS: Array<[number, Season]> = [
  [0, "talvi"], [1, "talvi"], [2, "kevat"], [3, "kevat"], [4, "kevat"],
  [5, "kesa"], [6, "kesa"], [7, "kesa"], [8, "syksy"], [9, "syksy"],
  [10, "syksy"], [11, "talvi"],
];

describe("seasonForMonth", () => {
  it.each(MONTHS)("kuukausi %i on %s", (month, expected) => {
    expect(seasonForMonth(month)).toBe(expected);
  });

  it("kestää kuukausiluvun yli ja ali laidan", () => {
    expect(seasonForMonth(12)).toBe(seasonForMonth(0));
    expect(seasonForMonth(-1)).toBe(seasonForMonth(11));
    expect(seasonForMonth(25)).toBe(seasonForMonth(1));
  });

  it("kattaa kaikki neljä vuodenaikaa", () => {
    const seen = new Set(MONTHS.map(([m]) => seasonForMonth(m)));
    expect([...seen].sort()).toEqual(["kesa", "kevat", "syksy", "talvi"]);
  });
});

describe("currentSeason", () => {
  it("lukee annetun päivän kuukauden", () => {
    expect(currentSeason(new Date("2026-09-05T12:00:00Z"))).toBe("syksy");
    expect(currentSeason(new Date("2026-01-15T12:00:00Z"))).toBe("talvi");
    expect(currentSeason(new Date("2026-04-01T12:00:00Z"))).toBe("kevat");
    expect(currentSeason(new Date("2026-07-20T12:00:00Z"))).toBe("kesa");
  });
});

describe("showsWinterServices", () => {
  it("on päällä marraskuusta helmikuuhun", () => {
    for (const month of [10, 11, 0, 1]) {
      expect(showsWinterServices(new Date(2026, month, 15))).toBe(true);
    }
  });

  it("on pois maaliskuusta lokakuuhun", () => {
    for (const month of [2, 3, 4, 5, 6, 7, 8, 9]) {
      expect(showsWinterServices(new Date(2026, month, 15))).toBe(false);
    }
  });

  it("on tarkoituksella laajempi kuin kalenteritalvi", () => {
    // Marraskuu: kalenteri sanoo syksyä, lumityöt myydään silti.
    const marraskuu = new Date(2026, 10, 15);
    expect(currentSeason(marraskuu)).toBe("syksy");
    expect(showsWinterServices(marraskuu)).toBe(true);
  });
});
