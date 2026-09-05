import { describe, expect, it } from "vitest";
import { orderModelCandidates, isModelGoneStatus } from "./ai";

/**
 * Tuotannossa botti meni mykäksi yhden vanhentuneen mallinimen takia: avain oli
 * paikallaan ja osoite oikea, mutta kutsu vastasi 404:llä. Nämä testit vahtivat
 * sitä logiikkaa joka päättää, milloin mallia kannattaa vaihtaa ja mihin.
 */
describe("isModelGoneStatus", () => {
  it("tunnistaa puuttuvan mallin", () => {
    expect(isModelGoneStatus(404)).toBe(true);
    // Osa tarjoajista vastaa tuntemattomaan malliin 400:lla eikä 404:lla.
    expect(isModelGoneStatus(400)).toBe(true);
  });

  it("ei pidä avain- eikä kiintiövirhettä mallivikana", () => {
    // Mallin vaihto ei korjaa väärää avainta, joten näistä ei saa vaihtaa.
    for (const status of [401, 403, 429, 500, 502, 503]) {
      expect(isModelGoneStatus(status), String(status)).toBe(false);
    }
  });
});

describe("orderModelCandidates", () => {
  const FALLBACKS = ["b", "c", "d"];

  it("kokeilee konfiguroitua mallia ensin", () => {
    expect(orderModelCandidates("a", [], FALLBACKS)).toEqual(["a", "b", "c", "d"]);
  });

  it("ei kokeile samaa mallia kahdesti jos se on myös varalistalla", () => {
    expect(orderModelCandidates("b", [], FALLBACKS)).toEqual(["b", "c", "d"]);
  });

  it("jättää poistuneiksi todetut pois", () => {
    expect(orderModelCandidates("a", ["a"], FALLBACKS)).toEqual(["b", "c", "d"]);
    expect(orderModelCandidates("a", ["a", "b"], FALLBACKS)).toEqual(["c", "d"]);
  });

  it("palaa konfiguroituun jos kaikki on merkitty poistuneiksi", () => {
    // Parempi yrittää ja epäonnistua kuin olla lähettämättä mitään: tarjoaja
    // on voinut palauttaa mallin takaisin sillä välin.
    expect(orderModelCandidates("a", ["a", "b", "c", "d"], FALLBACKS)).toEqual(["a"]);
  });

  it("ei palauta duplikaatteja", () => {
    // Duplikaatti maksaisi turhan kutsun ennen seuraavaan malliin siirtymistä.
    const out = orderModelCandidates("a", [], ["a", "b", "b", "c"]);
    expect(out).toEqual(["a", "b", "c"]);
    expect(new Set(out).size).toBe(out.length);
  });
});
