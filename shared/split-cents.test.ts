import { describe, expect, it } from "vitest";
import { splitCentsEvenly } from "./team";

/**
 * VARTIJA. Perustajien kate jaettiin `Math.floor`illa (pariton sentti katosi
 * näkyvistä) tai `Math.round`illa (3 senttiä kahdelle → 2 + 2 = 4, eli sentti
 * SYNTYI tyhjästä). Kumpikaan ei ole iso raha, mutta kun koko näkymän
 * tarkoitus on että luvut täsmäävät, yksikin karkaava sentti syö luottamuksen.
 */

describe("splitCentsEvenly", () => {
  it("summa on AINA täsmälleen jaettava summa — tämä on koko pointti", () => {
    for (const total of [0, 1, 2, 3, 7, 99, 8001, 10000, 123457]) {
      for (const n of [1, 2, 3, 5]) {
        expect(splitCentsEvenly(total, n).reduce((a, b) => a + b, 0)).toBe(total);
      }
    }
  });

  it("juuri ne tapaukset jotka menivät ennen pieleen", () => {
    expect(splitCentsEvenly(8001, 2)).toEqual([4001, 4000]);   // floor kadotti sentin
    expect(splitCentsEvenly(3, 2)).toEqual([2, 1]);            // round loi sentin
  });

  it("tasan menevä jakautuu tasan", () => {
    expect(splitCentsEvenly(10000, 2)).toEqual([5000, 5000]);
  });

  it("osuudet eroavat enintään sentin — kukaan ei saa merkittävästi enempää", () => {
    const parts = splitCentsEvenly(100, 3);
    expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1);
  });

  it("negatiivinen summa (velka) jakautuu samalla säännöllä", () => {
    expect(splitCentsEvenly(-3, 2).reduce((a, b) => a + b, 0)).toBe(-3);
  });

  it("järjetön osamäärä ei kaada eikä hukkaa rahaa", () => {
    expect(splitCentsEvenly(500, 0)).toEqual([500]);
    expect(splitCentsEvenly(500, -2)).toEqual([500]);
  });
});
