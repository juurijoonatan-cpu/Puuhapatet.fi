import { describe, expect, it } from "vitest";
import { emptyProjectData, newGigProjectData, checkWindowAttribution, computeProjectTotals, computeWorkerStats, computeEfficiency, syncGigSectorsFromProject, sanitizeProjectData, stripObservationImages, fixedDealFor, pricePerWindowOf, isCommunityGig, planRenderOf, floorLabel, estHoursPerWindowOf, sanitizeScopeState, scopeSummary, DEFAULT_PRICE_PER_WINDOW, FR8_PRICE_PER_WINDOW, FR8_CONTRACT_CAP_CENTS, type ProjectData } from "./project";
import { emptyGigData, computeTotals } from "./gig";

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

// ─── Yhteisökeikka (€0) ──────────────────────────────────────────────────────
//
// Nolla ei ollut ESITETTÄVISSÄ: sanitoija muutti sen takaisin oletushinnaksi ja
// neljä laskentakohtaa toisti saman maskin. Vapaaehtoistyö näytti 35 €/ikkuna
// -keikalta. Nämä testit lukitsevat, että nolla pysyy nollana — mutta VAIN
// yhteisökeikalla, jottei tavallinen keikka voi vahingossa mennä nollille.
describe("yhteisökeikka — 0 € on oikea hinta", () => {
  it("community-keikan nollahinta säilyy sanitoinnissa", () => {
    const clean = sanitizeProjectData({
      ...newGigProjectData(), compensation: "community", pricePerWindow: 0,
    });
    expect(clean.compensation).toBe("community");
    expect(clean.pricePerWindow).toBe(0);
    expect(pricePerWindowOf(clean)).toBe(0);
    expect(isCommunityGig(clean)).toBe(true);
  });

  it("tavallisen keikan nollahinta putoaa yhä oletukseen (ei vahinkonollia)", () => {
    const clean = sanitizeProjectData({ ...newGigProjectData(), pricePerWindow: 0 });
    expect(clean.compensation).toBeUndefined();
    expect(clean.pricePerWindow).toBe(DEFAULT_PRICE_PER_WINDOW);
    expect(isCommunityGig(clean)).toBe(false);
  });

  it("yhteisökeikalla ikkunat lasketaan mutta rahaa ei kerry", () => {
    const data = newGigProjectData();
    data.compensation = "community";
    data.pricePerWindow = 0;
    data.building.floors = ["Tila"];
    data.marks = { Tila: { marks: [{ p: 1, x: 1, y: 1 }, { p: 1, x: 2, y: 2 }] } };
    data.statuses["Tila#0"] = "pesty";

    const totals = computeProjectTotals(data);
    expect(totals.total).toBe(2);
    expect(totals.washed).toBe(1);          // edistyminen toimii normaalisti
    expect(totals.revenueCents).toBe(0);    // rahaa ei kerry
    expect(totals.contractCents).toBe(0);
  });

  it("yhteisökeikan sektorit ovat 0 €, joten agreedPrice ei kasva", () => {
    const data = newGigProjectData();
    data.compensation = "community";
    data.pricePerWindow = 0;
    data.building.floors = ["Tila"];
    data.marks = { Tila: { marks: Array.from({ length: 15 }, (_, i) => ({ p: 1 as const, x: i, y: 0 })) } };

    const gig = syncGigSectorsFromProject(emptyGigData(), data);
    expect(gig.sectors).toHaveLength(1);
    expect(gig.sectors[0].total).toBe(15);
    expect(gig.sectors[0].unitPriceCents).toBe(0);
    expect(computeTotals(gig).capCents).toBe(0);
  });

  it("laskutussektorin nimi seuraa kartan yksikkösanaa", () => {
    // Yhden tilan keikalla laskun rivi luki "1. kerros" vaikka kartalla luki
    // "Tila". Nimi tulee nyt samasta `floorLabel`ista kuin kartan otsikko.
    const data = newGigProjectData();
    data.building.floors = ["Tila"];
    data.building.unitWord = "tila";
    data.marks = { Tila: { marks: [{ p: 1 as const, x: 0, y: 0 }] } };

    const gig = syncGigSectorsFromProject(emptyGigData(), data);
    expect(gig.sectors[0].name).toBe("Tila");
  });

  it("kerrosnimet eivät muuttuneet keikalla jolla ei ole yksikkösanaa", () => {
    const data = newGigProjectData();
    data.building.floors = ["K", "3"];
    data.marks = {
      K: { marks: [{ p: 1 as const, x: 0, y: 0 }] },
      3: { marks: [{ p: 1 as const, x: 0, y: 0 }] },
    };

    const gig = syncGigSectorsFromProject(emptyGigData(), data);
    expect(gig.sectors.map((s) => s.name)).toEqual(["Kellari", "3. kerros"]);
  });

  it("roskakorvaustyyppi ei mene läpi", () => {
    expect(sanitizeProjectData({ compensation: "talkoo" }).compensation).toBeUndefined();
  });
});

// ─── Tuntiarvio per ikkuna ───────────────────────────────────────────────────
describe("estimatedHoursPerWindow — arvio ja toteuma", () => {
  it("arviosta johdetaan koko keikan ja jäljellä olevan työn tunnit", () => {
    const data = newGigProjectData();
    data.estimatedHoursPerWindow = 1.5;
    data.building.floors = ["Tila"];
    data.marks = { Tila: { marks: Array.from({ length: 15 }, (_, i) => ({ p: 1 as const, x: i, y: 0 })) } };
    data.statuses["Tila#0"] = "pesty";
    data.statuses["Tila#1"] = "pesty";

    const eff = computeEfficiency(data);
    expect(eff.estHoursPerWindow).toBe(1.5);
    expect(eff.estTotalHours).toBe(22.5);      // 15 × 1,5 h
    expect(eff.estRemainingHours).toBe(19.5);  // 13 pesemätöntä × 1,5 h
  });

  it("toteutunut tunnit/ikkuna lasketaan kirjatuista tunneista", () => {
    const data = newGigProjectData();
    data.estimatedHoursPerWindow = 1.5;
    data.building.floors = ["Tila"];
    data.marks = { Tila: { marks: [{ p: 1, x: 0, y: 0 }, { p: 1, x: 1, y: 0 }] } };
    data.statuses["Tila#0"] = "pesty";
    data.statuses["Tila#1"] = "pesty";
    data.hours = { akseli: 4 };

    const eff = computeEfficiency(data);
    expect(eff.actualHoursPerWindow).toBe(2);  // 4 h / 2 ikkunaa — arvio ylittyi
  });

  it("ilman arviota tuntiluvut ovat null eikä mitään keksitä", () => {
    const eff = computeEfficiency(newGigProjectData());
    expect(eff.estHoursPerWindow).toBeNull();
    expect(eff.estTotalHours).toBeNull();
    expect(eff.estRemainingHours).toBeNull();
    expect(eff.actualHoursPerWindow).toBeNull();
  });

  it("kelvoton arvio hylätään, järjetön rajataan", () => {
    for (const bad of [0, -1, "eiluku", null]) {
      expect(sanitizeProjectData({ estimatedHoursPerWindow: bad }).estimatedHoursPerWindow).toBeUndefined();
    }
    expect(sanitizeProjectData({ estimatedHoursPerWindow: 999 }).estimatedHoursPerWindow).toBe(24);
    expect(sanitizeProjectData({ estimatedHoursPerWindow: 1.5 }).estimatedHoursPerWindow).toBe(1.5);
  });
});

// ─── Pohjakuvat ja tilan nimi ────────────────────────────────────────────────
describe("pohjakuvan viite, esitystapa ja tilan nimi", () => {
  it("kerroksen pohjakuvan viite säilyy vain oikeille kerroksille", () => {
    const clean = sanitizeProjectData({
      ...newGigProjectData(),
      building: { floors: ["Tila"], planImages: { Tila: 42, Poistettu: 7 } },
    });
    expect(clean.building.planImages).toEqual({ Tila: 42 });  // roikkuva viite pois
  });

  it("kelvoton kuvaviite ei mene läpi", () => {
    for (const bad of [0, -3, 1.5, "eiluku", null]) {
      const clean = sanitizeProjectData({
        ...newGigProjectData(), building: { floors: ["Tila"], planImages: { Tila: bad } },
      });
      expect(clean.building.planImages).toBeUndefined();
    }
  });

  it("kuva esitetään sellaisenaan vain kun se on merkitty valokuvaksi", () => {
    expect(planRenderOf(undefined)).toBe("plan");                    // FR8:n vanha käytös
    expect(planRenderOf({ floors: [] })).toBe("plan");
    expect(planRenderOf({ floors: [], planRender: "photo" })).toBe("photo");
    expect(sanitizeProjectData({ building: { floors: ["1"], planRender: "roska" } }).building.planRender)
      .toBeUndefined();
  });

  it("tilan nimi korvaa 'kerroksen' kun se on väärä sana", () => {
    // FR8 — ennallaan.
    expect(floorLabel({ floors: ["K", "1"] }, "K")).toBe("Kellari");
    expect(floorLabel({ floors: ["K", "1"] }, "3")).toBe("3. kerros");
    // Yhden tilan keikka: pelkkä sana, ei numeroa.
    expect(floorLabel({ floors: ["Sali"], unitWord: "tila" }, "Sali")).toBe("Tila");
    // Monta yksikköä: numeroidaan omalla sanalla.
    expect(floorLabel({ floors: ["1", "2"], unitWord: "tila" }, "2")).toBe("2. tila");
  });
});

describe("newGigProjectData — yhdistyskeikan oletus", () => {
  it("tavallinen uusi keikka ei ole yhteisökeikka", () => {
    const d = newGigProjectData();
    expect(d.compensation).toBeUndefined();
    expect(isCommunityGig(d)).toBe(false);
    expect(pricePerWindowOf(d)).toBe(DEFAULT_PRICE_PER_WINDOW);
  });

  it("yhdistyskeikka aloitetaan vastikkeettomana", () => {
    const d = newGigProjectData({ community: true });
    expect(d.compensation).toBe("community");
    expect(pricePerWindowOf(d)).toBe(0);
    // Oletus, ei lukko — sen voi vaihtaa keikan asetuksista.
    d.compensation = "money";
    d.pricePerWindow = 35;
    expect(pricePerWindowOf(d)).toBe(35);
  });
});

/**
 * TUNTIARVIO. Asiakkaan näkymässä on työmäärämittari, jonka koko asteikko
 * lasketaan tästä kertoimesta. Nolla, tyhjä tai roska ei saa muuttua "0 h":ksi
 * — silloin mittari väittäisi keikan olevan olematon. Puuttuva arvio = null =
 * mittaria ei piirretä lainkaan.
 */
describe("estHoursPerWindowOf", () => {
  it("palauttaa annetun arvion", () => {
    expect(estHoursPerWindowOf({ estimatedHoursPerWindow: 1.5 })).toBe(1.5);
  });

  it("null puuttuvalle, nollalle, negatiiviselle ja roskalle", () => {
    expect(estHoursPerWindowOf({})).toBeNull();
    expect(estHoursPerWindowOf({ estimatedHoursPerWindow: 0 })).toBeNull();
    expect(estHoursPerWindowOf({ estimatedHoursPerWindow: -2 })).toBeNull();
    expect(estHoursPerWindowOf({ estimatedHoursPerWindow: NaN })).toBeNull();
    expect(estHoursPerWindowOf({ estimatedHoursPerWindow: Infinity })).toBeNull();
    expect(estHoursPerWindowOf({ estimatedHoursPerWindow: undefined })).toBeNull();
  });

  it("on sama luku jonka computeEfficiency raportoi — yksi määritelmä", () => {
    const p: ProjectData = { ...emptyProjectData(), estimatedHoursPerWindow: 1.5 };
    expect(computeEfficiency(p).estHoursPerWindow).toBe(estHoursPerWindowOf(p));
  });
});

/**
 * LAAJUUSKYSELY — yhteisökeikan kyllä/ei per keltainen ikkuna.
 *
 * Tämä on asiakkaan kirjoittama tila, joka OHJAA TYÖTÄ: tekijä pesee keltaisen
 * vain koska asiakas sanoi niin. Siksi tuntematon vastaus ei saa muuttua
 * arvaukseksi, eikä poistetun ikkunan vanha vastaus saa jäädä lukuihin.
 */
describe("sanitizeScopeState", () => {
  it("säilyttää kelvolliset vastaukset", () => {
    const sc = sanitizeScopeState({ votes: { "1#0": { answer: "yes", at: 1000 }, "1#1": { answer: "no", at: 2000 } } });
    expect(sc?.votes["1#0"]).toEqual({ answer: "yes", at: 1000 });
    expect(sc?.votes["1#1"].answer).toBe("no");
  });

  it("pudottaa tuntemattoman vastauksen kokonaan — ei arvausta", () => {
    const sc = sanitizeScopeState({ votes: {
      "1#0": { answer: "maybe", at: 1 },
      "1#1": { answer: true, at: 1 },
      "1#2": { at: 1 },
      "1#3": "yes",
    } });
    expect(Object.keys(sc?.votes ?? {})).toEqual([]);
  });

  it("korjaa kelvottoman aikaleiman mutta säilyttää vastauksen", () => {
    const sc = sanitizeScopeState({ votes: { "1#0": { answer: "yes", at: "roska" } } });
    expect(sc?.votes["1#0"].answer).toBe("yes");
    expect(sc?.votes["1#0"].at).toBeGreaterThan(0);
  });

  it("null kelvottomasta syötteestä", () => {
    expect(sanitizeScopeState(null)).toBeNull();
    expect(sanitizeScopeState("yes")).toBeNull();
  });

  it("selviää tallennuksen läpi sanitizeProjectDatassa", () => {
    const p = sanitizeProjectData({
      ...emptyProjectData(),
      scope: { votes: { "1#0": { answer: "yes", at: 5 } } },
    });
    expect(p.scope?.votes["1#0"].answer).toBe("yes");
  });

  it("puuttuva scope pysyy puuttuvana — vanhat blobit eivät kasva", () => {
    expect(sanitizeProjectData(emptyProjectData()).scope).toBeUndefined();
  });
});

describe("scopeSummary", () => {
  /** Kaksi keltaista ja yksi punainen samalla kerroksella. */
  const base = (): ProjectData => ({
    ...emptyProjectData(),
    building: { ...emptyProjectData().building, floors: ["1"] },
    marks: { "1": { marks: [{ p: 1, x: 10, y: 10 }, { p: 2, x: 20, y: 20 }, { p: 2, x: 30, y: 30 }] } } as any,
  });

  it("jakaa keltaiset vastauksen mukaan; punaiset eivät kuulu kyselyyn", () => {
    const p = { ...base(), scope: { votes: { "1#1": { answer: "yes" as const, at: 1 } } } };
    const s = scopeSummary(p);
    expect(s.total).toBe(2);
    expect(s.yes).toEqual(["1#1"]);
    expect(s.no).toEqual([]);
    expect(s.open).toEqual(["1#2"]);
  });

  it("poistetun ikkunan vastaus ei jää lukuihin", () => {
    const p = {
      ...base(),
      deleted: { "1#1": true },
      scope: { votes: { "1#1": { answer: "yes" as const, at: 1 } } },
    };
    const s = scopeSummary(p);
    expect(s.total).toBe(1);
    expect(s.yes).toEqual([]);
    expect(s.open).toEqual(["1#2"]);
  });

  it("punaiseksi vaihdetun ikkunan vanha vastaus ei jää lukuihin", () => {
    const p = base();
    p.marks["1"].marks[1].p = 1;
    p.scope = { votes: { "1#1": { answer: "yes", at: 1 } } };
    const s = scopeSummary(p);
    expect(s.total).toBe(1);
    expect(s.yes).toEqual([]);
  });

  it("ilman kyselyä kaikki keltaiset ovat avoimia", () => {
    const s = scopeSummary(base());
    expect(s.open).toEqual(["1#1", "1#2"]);
    expect(s.yes).toEqual([]);
    expect(s.no).toEqual([]);
  });
});
