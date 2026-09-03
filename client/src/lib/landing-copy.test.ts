import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * VARTIJA. Etusivun ennen/jälkeen-osion teksteissä ei käytetä pitkiä
 * väliviivoja. Se on omistajan nimenomainen linjaus, ei makuasia jonka
 * seuraava kirjoittaja saa kumota vahingossa: ajatusviiva (—) ja
 * puolipitkä viiva (–) luetaan tässä osiossa töksähtäväksi, ja teksti
 * kirjoitetaan mieluummin kokonaisin lausein tai pilkulla.
 *
 * Miinusmerkki (−) on eri asia ja sallittu: se on luku, ei välimerkki,
 * ja esiintyy muodossa "−35 %".
 *
 * Jos tämä testi kaatuu: kirjoita lause uusiksi. Älä lisää avainta
 * poikkeuslistalle.
 */

const I18N = join(process.cwd(), "client/src/lib/i18n.tsx");

/** Osion avaimet, molemmat kielet, muodossa "ba.jokin": "teksti". */
function beforeAfterStrings(): Array<[string, string]> {
  const src = readFileSync(I18N, "utf8");
  const found: Array<[string, string]> = [];
  const re = /"(ba\.[a-zA-Z0-9.]+)":\s*"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) found.push([m[1], m[2]]);
  return found;
}

describe("etusivun ennen/jälkeen -tekstit", () => {
  it("löytää molempien kielten avaimet", () => {
    const strings = beforeAfterStrings();
    // fi + en, 13 avainta kummassakin.
    expect(strings.length).toBeGreaterThanOrEqual(20);
    expect(strings.some(([k]) => k === "ba.title")).toBe(true);
    expect(strings.some(([k]) => k === "ba.stat.source")).toBe(true);
  });

  it("ei sisällä ajatusviivaa eikä puolipitkää viivaa", () => {
    const offenders = beforeAfterStrings()
      .filter(([, text]) => /[—–]/.test(text))
      .map(([key, text]) => `${key}: ${text}`);
    expect(offenders).toEqual([]);
  });

  it("sallii miinusmerkin luvussa", () => {
    const deduction = beforeAfterStrings().find(([, t]) => t.includes("−35"));
    expect(deduction).toBeDefined();
  });

  it("ei tarjoa enää omaa ennen/jälkeen -kuvaa toimintakehotteessa", () => {
    const ctas = beforeAfterStrings().filter(([k]) => k === "ba.cta");
    expect(ctas.length).toBe(2);
    for (const [, text] of ctas) {
      expect(text.toLowerCase()).not.toContain("ennen");
      expect(text.toLowerCase()).not.toContain("before");
    }
  });
});

/**
 * Valonlisä-luku on mittaustulos, ja lähde kuuluu koodiin sen viereen.
 * Tämä ei tarkista lukua vaan sen perustelun olemassaolon: jos joku vaihtaa
 * 10:n 40:een siksi että se myy paremmin, lähdeviite jää kertomaan ettei
 * numero ollut mielipide.
 */
describe("valonlisä-luku", () => {
  it("kantaa lähteensä mukanaan", () => {
    const src = readFileSync(join(process.cwd(), "client/src/components/light-gain-stat.tsx"), "utf8");
    expect(src).toContain("Building and Environment");
    expect(src).toContain("Sharples");
    expect(src).toMatch(/LIGHT_GAIN_PERCENT = \d+/);
  });
});
