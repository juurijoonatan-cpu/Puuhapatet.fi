import { describe, expect, it } from "vitest";
import { emptyProjectData, newGigProjectData, checkWindowAttribution, computeProjectTotals, computeWorkerStats, sanitizeProjectData, stripObservationImages, fixedDealFor, FR8_PRICE_PER_WINDOW, FR8_CONTRACT_CAP_CENTS, type ProjectData } from "./project";

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

// Havaintokuvat eivät saa lähteä joka vastauksessa (Neonin siirtokiintiö), mutta
// teksti ja 💬-merkki pitää silti näkyä kartalla heti.
describe("stripObservationImages", () => {
  it("pudottaa kuvan mutta jättää tekstin, tekijän ja aikaleiman", () => {
    const out = stripObservationImages({
      "K#0": { text: "Rikkinäinen tiiviste", imageDataUrl: "data:image/jpeg;base64,AAAA", by: "jani", ts: 111 },
    });
    expect(out["K#0"]).toEqual({ text: "Rikkinäinen tiiviste", by: "jani", ts: 111, hasImage: true });
    expect(out["K#0"].imageDataUrl).toBeUndefined();
  });

  it("kuvaton havainto ei saa hasImage-lippua", () => {
    const out = stripObservationImages({ "K#1": { text: "Naarmu", ts: 222 } });
    expect(out["K#1"]).toEqual({ text: "Naarmu", by: undefined, ts: 222 });
    expect(out["K#1"].hasImage).toBeUndefined();
  });

  it("tyhjä tai puuttuva syöte antaa tyhjän objektin", () => {
    expect(stripObservationImages(undefined)).toEqual({});
    expect(stripObservationImages(null)).toEqual({});
    expect(stripObservationImages({})).toEqual({});
  });

  it("hasImage on vain siirtokenttä — sitä ei koskaan tallenneta", () => {
    const clean = sanitizeProjectData({
      ...emptyProjectData(),
      observations: { "K#0": { text: "Naarmu", ts: 1, hasImage: true } },
    });
    expect(clean.observations!["K#0"].hasImage).toBeUndefined();
  });
});

// Liitteet omassa taulussaan (job_assets): blobiin jää vain viite. Sanitoija ei
// saa pudottaa havaintoa vain siksi että kuvadata ei ole enää sen sisällä.
describe("liiteviitteet säilyvät sanitoinnissa", () => {
  it("viitteellinen havainto säilyy vaikka kuvadataa ei ole", () => {
    const clean = sanitizeProjectData({
      ...emptyProjectData(),
      observations: { "K#0": { text: "", ts: 5, imageAssetId: 42 } },
    });
    expect(clean.observations!["K#0"]).toBeDefined();
    expect(clean.observations!["K#0"].imageAssetId).toBe(42);
  });

  it("tyhjä havainto ilman tekstiä, kuvaa ja viitettä putoaa yhä", () => {
    const clean = sanitizeProjectData({
      ...emptyProjectData(),
      observations: { "K#0": { text: "", ts: 5 } },
    });
    expect(clean.observations!["K#0"]).toBeUndefined();
  });

  it("kelvoton viite ei mene läpi", () => {
    // Huom: numeroksi muuntuva merkkijono ("42") KELPAA — `Number()`-muunnos on
    // sama kuvio kuin muuallakin sanitoijassa, ja JSON-kierros voi tuottaa sen.
    for (const bad of [0, -1, 1.5, "eiluku", null, undefined, {}]) {
      const clean = sanitizeProjectData({
        ...emptyProjectData(),
        observations: { "K#0": { text: "on tekstiä", ts: 5, imageAssetId: bad } },
      });
      expect(clean.observations!["K#0"].imageAssetId).toBeUndefined();
    }
  });

  it("stripObservationImages välittää viitteen selaimelle mutta ei dataa", () => {
    const out = stripObservationImages({
      "K#0": { text: "Naarmu", ts: 1, imageAssetId: 7 },
      "K#1": { text: "Vanha", ts: 2, imageDataUrl: "data:image/jpeg;base64,AAA" },
    });
    expect(out["K#0"]).toEqual({ text: "Naarmu", by: undefined, ts: 1, hasImage: true, imageAssetId: 7 });
    // Vanha inline-muoto: merkki näkyy, mutta id:tä ei ole eikä dataa lähetetä.
    expect(out["K#1"].hasImage).toBe(true);
    expect(out["K#1"].imageAssetId).toBeUndefined();
    expect(out["K#1"].imageDataUrl).toBeUndefined();
  });
});

// ─── Keikan urakkatyyppi (dealKind) ──────────────────────────────────────────
//
// FR8:n allekirjoitettu 6300 €:n urakka kiinnittyi ennen pelkkään merkkijonoon
// `planBase`issa. Nämä testit lukitsevat sen, ettei uusi keikka voi PERIÄ sitä
// vahingossa eikä FR8 voi MENETTÄÄ sitä.
describe("fixedDealFor — urakka kiinnittyy nimenomaisesti, ei polkuarvauksella", () => {
  it("vanha FR8-blobi ilman dealKindiä saa yhä urakkansa (taaksepäin-yhteensopivuus)", () => {
    const data = emptyProjectData();            // ei dealKindiä, kuten talletettu FR8
    expect("dealKind" in data).toBe(false);
    data.building.planBase = "/fr8/plans/bp-";
    const deal = fixedDealFor(data);
    expect(deal).not.toBeNull();
    expect(deal!.pricePerWindow).toBe(FR8_PRICE_PER_WINDOW);
    expect(deal!.capCents).toBe(FR8_CONTRACT_CAP_CENTS);
  });

  it("uusi keikka ei peri FR8:n urakkaa vaikka pohjakuva olisi /fr8/-polussa", () => {
    const data = newGigProjectData();
    data.building.planBase = "/fr8/plans/stuhi-";
    expect(data.dealKind).toBe("none");
    expect(fixedDealFor(data)).toBeNull();
  });

  it("emptyProjectData EI leimaa dealKindiä — sitä käytetään myös varafallbackina", () => {
    // Jos tämä leimaisi "none", FR8:n urakka katoaisi silloin kun latausvirheen
    // jälkeen tallennetaan varakopio sen päälle.
    expect("dealKind" in emptyProjectData()).toBe(false);
    expect(newGigProjectData().dealKind).toBe("none");
  });

  it("nimenomainen fr8 pitää urakan vaikka pohjakuvat siirrettäisiin muualle", () => {
    const data = emptyProjectData();
    data.dealKind = "fr8";
    data.building.planBase = "/plans/bulevardi31-";
    expect(fixedDealFor(data)).not.toBeNull();
  });

  it("tavallinen uusi keikka omalla polulla ei saa urakkaa", () => {
    const data = emptyProjectData();
    data.building.planBase = "/gigs/stuhi/room-";
    expect(fixedDealFor(data)).toBeNull();
  });

  it("sanitointi säilyttää dealKindin ja jättää sen pois kun sitä ei ole", () => {
    const withKind = sanitizeProjectData({ ...emptyProjectData(), dealKind: "fr8" });
    expect(withKind.dealKind).toBe("fr8");

    const legacy: any = { ...emptyProjectData() };
    delete legacy.dealKind;
    expect("dealKind" in sanitizeProjectData(legacy)).toBe(false);

    // Roskaa ei tallenneta.
    expect("dealKind" in sanitizeProjectData({ dealKind: "vapaa-urakka" })).toBe(false);
  });
});
