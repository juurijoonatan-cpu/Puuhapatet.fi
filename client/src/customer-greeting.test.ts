/**
 * Tervehdyksen ja työmäärämittarin puhtaat funktiot.
 *
 * Nämä testit ovat olemassa yhdestä syystä: tervehdys näyttää ASIAKKAAN NIMEN.
 * Väärä nimi on pahempi kuin ei nimeä, ja yhteyshenkilökenttä on vapaa teksti,
 * johon on käytännössä kirjoitettu myös sähköposteja, numeroita ja titteleitä.
 */

import { describe, it, expect } from "vitest";
import { greetingWord, firstNameOf, greetingText } from "@/components/customer/Greeting";
import { fmtHours } from "@/components/customer/WorkloadGauge";

/** Paikallinen aika annetulla tunnilla — tervehdys lukee `getHours()`in. */
function at(hour: number): Date {
  const d = new Date(2026, 7, 19, hour, 30, 0);
  return d;
}

describe("greetingWord", () => {
  it("aamu, päivä, ilta ja yö omilla väleillään", () => {
    expect(greetingWord(at(6))).toBe("Hyvää aamua");
    expect(greetingWord(at(12))).toBe("Hyvää päivää");
    expect(greetingWord(at(20))).toBe("Hyvää iltaa");
    expect(greetingWord(at(2))).toBe("Hyvää yötä");
  });

  it("rajat kuuluvat oikealle puolelle", () => {
    expect(greetingWord(at(4))).toBe("Hyvää yötä");
    expect(greetingWord(at(5))).toBe("Hyvää aamua");
    expect(greetingWord(at(9))).toBe("Hyvää aamua");
    expect(greetingWord(at(10))).toBe("Hyvää päivää");
    expect(greetingWord(at(16))).toBe("Hyvää päivää");
    expect(greetingWord(at(17))).toBe("Hyvää iltaa");
    expect(greetingWord(at(22))).toBe("Hyvää iltaa");
    expect(greetingWord(at(23))).toBe("Hyvää yötä");
  });
});

describe("firstNameOf", () => {
  it("ottaa etunimen koko nimestä", () => {
    expect(firstNameOf("Akseli Kettunen")).toBe("Akseli");
    expect(firstNameOf("  akseli  kettunen ")).toBe("Akseli");
  });

  it("hyväksyy yhdysnimen ja skandit", () => {
    expect(firstNameOf("Anna-Maria Väisänen")).toBe("Anna-Maria");
    expect(firstNameOf("Ömer Öztürk")).toBe("Ömer");
  });

  it("katkaisee tittelin ja roolin", () => {
    expect(firstNameOf("Akseli Kettunen / hallitus")).toBe("Akseli");
    expect(firstNameOf("Akseli, puheenjohtaja")).toBe("Akseli");
    expect(firstNameOf("Akseli (Stuhi)")).toBe("Akseli");
  });

  it("EI keksi nimeä sähköpostista, numerosta tai tyhjästä", () => {
    expect(firstNameOf("akseli@stuhi.fi")).toBeNull();
    expect(firstNameOf("+358 40 123 4567")).toBeNull();
    expect(firstNameOf("3172958-1")).toBeNull();
    expect(firstNameOf("")).toBeNull();
    expect(firstNameOf("   ")).toBeNull();
    expect(firstNameOf(null)).toBeNull();
    expect(firstNameOf(undefined)).toBeNull();
    // Yhden kirjaimen "nimi" on melkein varmasti alkukirjain, ei nimi.
    expect(firstNameOf("A. Kettunen")).toBeNull();
  });
});

describe("greetingText", () => {
  it("nimellä kun nimi on, ilman kun ei ole", () => {
    expect(greetingText("Akseli Kettunen", at(19))).toBe("Hyvää iltaa, Akseli");
    expect(greetingText("info@stuhi.fi", at(19))).toBe("Hyvää iltaa");
    expect(greetingText(null, at(8))).toBe("Hyvää aamua");
  });
});

describe("fmtHours", () => {
  it("desimaali vain kun se kertoo jotain", () => {
    expect(fmtHours(1.5)).toBe("1,5 h");
    expect(fmtHours(22)).toBe("22 h");
    expect(fmtHours(22.5)).toBe("22,5 h");
    expect(fmtHours(0)).toBe("0 h");
  });

  it("näyttää 45 minuutin mitoituksen oikein", () => {
    // Yhdellä desimaalilla tästä tuli "0,8 h", eli näkymä näytti eri luvun kuin
    // se joka keikalle oli annettu.
    expect(fmtHours(0.75)).toBe("0,75 h");
    expect(fmtHours(0.25)).toBe("0,25 h");
  });

  it("pyöristää kahteen desimaaliin — ei liukulukuroskaa", () => {
    expect(fmtHours(1.4449)).toBe("1,44 h");
    expect(fmtHours(1.4451)).toBe("1,45 h");
    // 0,3 × 7 = 2.0999999999999996 liukulukuna.
    expect(fmtHours(0.3 * 7)).toBe("2,1 h");
  });
});
