import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { computeEraBilling, SETTLE_ERA_NUMBERS, isSettleEraSelection, isP2EraSelection } from "@shared/era-billing";

/**
 * VARTIJA — tekijän maksusta ei saa tulla 0,00 €.
 *
 * Maksudialogi osaa lähettää VALMIIN SUMMAN (`ansaittuOverrideCents`) kahdesta
 * potista: keltaisista (palkkio tulee palkkiotaulukosta, ei 20 €/ikkuna) ja
 * koko saldon maksusta (summa on tekijän koko maksamaton saldo, jonka johtaja
 * voi vielä käsin korjata). Kummassakaan ei lähetetä ikkunoita tai tunteja —
 * ne kuuluvat omille poteilleen, muuten sama työ maksettaisiin kahdesti.
 *
 * MIKSI TÄMÄ TESTI ON: serverin ehto luki vain `isP2EraSelection`, joten koko
 * saldon maksun summa putosi hiljaa pois. Laskuksi kirjautui 0,00 € vaikka
 * dialogi näytti 84,00 € ja 78,00 € — ja rivit jäivät tekijöille odottamaan
 * kuittausta tyhjästä. Mikään yksikkötesti ei nähnyt sitä, koska laskenta
 * (`computeEraBilling`) toimi oikein: summa ei vain päässyt sinne asti.
 *
 * Jos tämä kaatuu: lisää uusi valmiin summan potti serverin ehtoon, älä poista
 * sitä listalta täältä.
 */

const SRC = readFileSync(join(process.cwd(), "server/routes.ts"), "utf8");

/** `POST /api/jobs/:id/era-invoice/worker-batch` -käsittelijän runko. */
function workerBatchBody(): string {
  const start = SRC.indexOf('app.post("/api/jobs/:id/era-invoice/worker-batch"');
  expect(start).toBeGreaterThan(0);
  const next = SRC.indexOf("\n  app.", start + 10);
  return SRC.slice(start, next > 0 ? next : SRC.length);
}

describe("tekijän erämaksun summa ei katoa matkalla", () => {
  const body = workerBatchBody();

  it("käsittelijän runko löytyi (testi itse ei saa olla tyhjä lupaus)", () => {
    expect(body.length).toBeGreaterThan(500);
  });

  it("valmis summa hyväksytään sekä keltaisista että koko saldon maksusta", () => {
    expect(body).toContain("const settleEra = isSettleEraSelection(eraNumbers)");
    const line = body.split("\n").find((l) => l.includes("const overrideAllowed"));
    expect(line).toBeTruthy();
    expect(line).toContain("isP2EraSelection(eraNumbers)");
    expect(line).toContain("settleEra");
  });

  it("nollan euron ansiota ei kirjata maksuksi", () => {
    expect(body).toContain("computed.ansaittuCents <= 0");
  });

  it("tarkistus tehdään ennen ensimmäistäkään kirjoitusta", () => {
    // Osittain kirjoitettu erä on pahempi kuin hylätty pyyntö: puolet
    // tekijöistä saisi maksun ja puolet ei, eikä uusi yritys enää korjaa sitä.
    const guard = body.indexOf("computed.ansaittuCents <= 0");
    const firstInsert = body.indexOf("db.insert(eraInvoices)");
    expect(guard).toBeGreaterThan(0);
    expect(firstInsert).toBeGreaterThan(guard);
  });

  it("koko saldon maksu ei kirjaa ikkunoita (ne kuuluvat omalle potilleen)", () => {
    const line = body.split("\n").find((l) => l.includes("const pestytIkkunat ="));
    expect(line).toContain("settleEra");
  });
});

describe("koko saldon maksun laskenta", () => {
  it("sentinel-erä 8 tunnistetaan koko saldon maksuksi eikä keltaisiksi", () => {
    expect(isSettleEraSelection(SETTLE_ERA_NUMBERS)).toBe(true);
    expect(isP2EraSelection(SETTLE_ERA_NUMBERS)).toBe(false);
  });

  it("valmis summa ilman ikkunoita ja tunteja tuottaa juuri sen summan", () => {
    const res = computeEraBilling(0, [{
      workerId: "selma", name: "Selma",
      pestytIkkunat: 0, sovittuMuutosCents: 0, ennakkoCents: 0,
      ansaittuOverrideCents: 8400, tunnit: 0, tuntihintaCents: 0,
    }], []);
    expect(res.workers[0].ansaittuCents).toBe(8400);
    expect(res.workers[0].maksettavaCents).toBe(8400);
  });
});
