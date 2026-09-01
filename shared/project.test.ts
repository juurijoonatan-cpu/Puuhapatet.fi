import { describe, expect, it } from "vitest";
import { emptyProjectData, newGigProjectData, checkWindowAttribution, computeProjectTotals, computeWorkerStats, computeEfficiency, syncGigSectorsFromProject, sanitizeProjectData, stripObservationImages, fixedDealFor, pricePerWindowOf, isCommunityGig, planRenderOf, floorLabel, estHoursPerWindowOf, sanitizeScopeState, scopeSummary, computeLampTotals, computeLampWorkerStats, computeDoorTotals, computeDoorWorkerStats, lampIsPublic, doorIsPublic, publicLampView, publicDoorView, allLampPoints, fixtureAttentionRows, lampBucket, lampNeedsBulb, computeLampFloorStats, computeLampInventory, computeDoorFloorStats, resolveFixtureOrder, sanitizeFixtureQuote, sanitizeFixtureOrder, computeLampModelStats, sanitizeLampModels, billingModeOf, isHourlyGig, roundWorkHours, roundWorkHoursFromMinutes, customerExpenses, customerHourRows, invoiceNaming, sanitizeBoard, sortedBoard, openTaskCount, BOARD_CUSTOMER, sanitizeShifts, computeShiftStats, shiftHoursOf, dayKey, isDayKey, fmtDayLabel, shiftDay, weekOf, weekdayLetter, dayOfMonth, monthLabel, MAX_SHIFTS, cappedTimerHours, MAX_TIMER_SHIFT_HOURS, addShiftEntry, shiftHoursOnDay, DEFAULT_PRICE_PER_WINDOW, FR8_PRICE_PER_WINDOW, FR8_CONTRACT_CAP_CENTS, type ProjectData } from "./project";
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

describe("lamput — merkintä, poisto ja per-tekijä laskuri (ei rahaa)", () => {
  function withLamps(): ProjectData {
    const p = emptyProjectData();
    p.lamps = { "1": [{ key: "1#lampA", x: 10, y: 10 }, { key: "1#lampB", x: 20, y: 20 }] };
    p.lampStatuses = { "1#lampA": "vaihdettu" };
    p.lampChangedBy = { "1#lampA": { by: "jani", ts: 1 } };
    return p;
  }

  it("laskee kokonaistilanteen (yhteensä / vaihdettu / %)", () => {
    const totals = computeLampTotals(withLamps());
    expect(totals.total).toBe(2);
    expect(totals.changed).toBe(1);
    expect(totals.unchanged).toBe(1);
    expect(totals.pct).toBe(50);
  });

  it("ei lamppuja → nolla eikä jako nollalla", () => {
    const totals = computeLampTotals(emptyProjectData());
    expect(totals).toEqual({
      total: 0, changed: 0, unchanged: 0, pct: 0,
      broken: 0, working: 0, unchecked: 0, noted: 0, visible: 0,
    });
  });

  it("per-tekijä laskuri näyttää kuka on vaihtanut montako", () => {
    const p = withLamps();
    p.lamps!["1"].push({ key: "1#lampC", x: 30, y: 30 });
    p.lampStatuses!["1#lampC"] = "vaihdettu";
    p.lampChangedBy!["1#lampC"] = { by: "jani", ts: 2 };
    const stats = computeLampWorkerStats(p);
    expect(stats).toEqual([{ worker: "jani", changed: 2, noted: 0 }]);
  });

  it("sanitointi säilyttää vaihdetun lampun muuttajan", () => {
    const clean = sanitizeProjectData({
      lamps: { "1": [{ key: "1#lampA", x: 5, y: 5 }] },
      lampStatuses: { "1#lampA": "vaihdettu" },
      lampChangedBy: { "1#lampA": { by: "matias", ts: 123 } },
    });
    expect(clean.lamps?.["1"]).toEqual([{ key: "1#lampA", x: 5, y: 5 }]);
    expect(clean.lampStatuses?.["1#lampA"]).toBe("vaihdettu");
    expect(clean.lampChangedBy?.["1#lampA"]).toEqual({ by: "matias", ts: 123 });
  });

  it("changedBy ilman vastaavaa vaihdettu-statusta ei jää roikkumaan (sama sääntö kuin keskenBy:llä)", () => {
    const clean = sanitizeProjectData({
      lamps: { "1": [{ key: "1#lampA", x: 5, y: 5 }] },
      // Ei lampStatuses-merkintää lainkaan tälle avaimelle ("ei"-tila) —
      // silti clientiltä tulee kuka-vaihtoi-tieto (esim. vanhentunut kopio).
      lampChangedBy: { "1#lampA": { by: "matias", ts: 123 } },
    });
    expect(clean.lampChangedBy?.["1#lampA"]).toBeUndefined();
  });

  it("poisto (splice) ei jätä statusta tai attribuutiota roikkumaan", () => {
    const p = withLamps();
    p.lamps!["1"] = p.lamps!["1"].filter((l) => l.key !== "1#lampA");
    delete p.lampStatuses!["1#lampA"];
    delete p.lampChangedBy!["1#lampA"];
    const totals = computeLampTotals(p);
    expect(totals.total).toBe(1);
    expect(totals.changed).toBe(0);
  });

  it("kunto ja huomautus ovat eri tieto kuin vaihto — eivätkä sotke toisiaan", () => {
    const p = withLamps();
    p.lampConditions = { "1#lampB": "rikki" };
    p.lampNotes = { "1#lampB": { text: "Kupu rikki", by: "matias", ts: 5 } };
    const totals = computeLampTotals(p);
    // lampB on rikki JA huomautettu, mutta yhä vaihtamatta.
    expect(totals.changed).toBe(1);
    expect(totals.broken).toBe(1);
    expect(totals.working).toBe(0);
    expect(totals.unchecked).toBe(1);
    expect(totals.noted).toBe(1);
  });

  it("huomautuksen kirjoittaja näkyy per-tekijä laskurissa vaihtajan rinnalla", () => {
    const p = withLamps();
    p.lampNotes = { "1#lampB": { text: "Kupu rikki", by: "matias", ts: 5 } };
    const stats = computeLampWorkerStats(p);
    expect(stats).toEqual([
      { worker: "jani", changed: 1, noted: 0 },
      { worker: "matias", changed: 0, noted: 1 },
    ]);
  });
});

describe("kalusteet asiakkaan näkymässä — kartoitus ei ole uutinen", () => {
  function mapped(): ProjectData {
    const p = emptyProjectData();
    p.lamps = { "1": [
      { key: "1#lampA", x: 10, y: 10 },   // pelkkä kartoitettu
      { key: "1#lampB", x: 20, y: 20 },   // vaihdettu
      { key: "1#lampC", x: 30, y: 30 },   // rikki
      { key: "1#lampD", x: 40, y: 40 },   // huomautettu
    ] };
    p.lampStatuses = { "1#lampB": "vaihdettu" };
    p.lampChangedBy = { "1#lampB": { by: "jani", ts: 7 } };
    p.lampConditions = { "1#lampC": "rikki" };
    p.lampNotes = { "1#lampD": { text: "Vilkkuu", by: "matias", ts: 9 } };
    return p;
  }

  it("pelkkä kartalle merkitty lamppu EI näy asiakkaalle", () => {
    const pts = allLampPoints(mapped());
    const a = pts.find((x) => x.key === "1#lampA")!;
    expect(lampIsPublic(a)).toBe(false);
  });

  it("vaihdettu, rikki ja huomautettu näkyvät — kartoitettu ei", () => {
    const view = publicLampView(mapped());
    expect(view.map((v) => v.key).sort()).toEqual(["1#lampB", "1#lampC", "1#lampD"]);
    expect(computeLampTotals(mapped()).visible).toBe(3);
  });

  it("asiakkaalle ei lähde tekijän henkilöllisyyttä", () => {
    const raw = JSON.stringify(publicLampView(mapped()));
    expect(raw).not.toContain("jani");
    expect(raw).not.toContain("matias");
    // Huomautuksen TEKSTI on tarkoitus näyttää — vain nimi jää pois.
    expect(raw).toContain("Vilkkuu");
  });

  it("ovi näkyy vasta tehtynä tai huomautettuna", () => {
    const p = emptyProjectData();
    p.doors = { "1": [
      { key: "1#doorA", x: 5, y: 5, label: "Pääovi" },
      { key: "1#doorB", x: 6, y: 6 },
      { key: "1#doorC", x: 7, y: 7 },
    ] };
    p.doorStatuses = { "1#doorB": "tehty" };
    p.doorDoneBy = { "1#doorB": { by: "jani", ts: 3 } };
    p.doorNotes = { "1#doorC": { text: "Lukko jumittaa", by: "jani", ts: 4 } };

    const totals = computeDoorTotals(p);
    expect(totals.total).toBe(3);
    expect(totals.done).toBe(1);
    expect(totals.open).toBe(2);
    expect(totals.noted).toBe(1);
    expect(totals.visible).toBe(2);

    expect(publicDoorView(p).map((d) => d.key).sort()).toEqual(["1#doorB", "1#doorC"]);
    expect(doorIsPublic({ floor: "1", key: "1#doorA", x: 5, y: 5, status: "ei" })).toBe(false);
    expect(computeDoorWorkerStats(p)).toEqual([{ worker: "jani", done: 1, noted: 1 }]);
  });

  it("huomiolista nostaa rikkinäisen ja huomautetun ylimmäksi, valmiit viimeiseksi", () => {
    const p = mapped();
    const rows = fixtureAttentionRows(p);
    expect(rows[0].key).toBe("1#lampC");           // rikki
    expect(rows[1].key).toBe("1#lampD");           // huomautettu
    expect(rows[rows.length - 1].key).toBe("1#lampB"); // vaihdettu, ei huomautettavaa
    expect(rows.find((r) => r.key === "1#lampB")!.public).toBe(true);
    expect(rows.find((r) => r.key === "1#lampA")!.public).toBe(false);
  });
});

describe("kalusteiden sanitointi", () => {
  it("säilyttää kunnon, huomautuksen ja oven tehtävänimen", () => {
    const clean = sanitizeProjectData({
      lamps: { "1": [{ key: "1#lampA", x: 5, y: 5 }] },
      lampConditions: { "1#lampA": "rikki" },
      lampNotes: { "1#lampA": { text: "  Kupu rikki  ", by: "matias", ts: 42 } },
      lampAddedBy: { "1#lampA": { by: "jani", ts: 41 } },
      doors: { "1": [{ key: "1#doorA", x: 6, y: 6, label: "Pääovi" }] },
      doorStatuses: { "1#doorA": "tehty" },
      doorDoneBy: { "1#doorA": { by: "matias", ts: 43 } },
      doorNotes: { "1#doorA": { text: "Karmit maalattu", ts: 44 } },
    });
    expect(clean.lampConditions?.["1#lampA"]).toBe("rikki");
    expect(clean.lampNotes?.["1#lampA"]).toEqual({ text: "Kupu rikki", by: "matias", ts: 42 });
    expect(clean.lampAddedBy?.["1#lampA"]).toEqual({ by: "jani", ts: 41 });
    expect(clean.doors?.["1"]).toEqual([{ key: "1#doorA", x: 6, y: 6, label: "Pääovi" }]);
    expect(clean.doorDoneBy?.["1#doorA"]).toEqual({ by: "matias", ts: 43 });
    expect(clean.doorNotes?.["1#doorA"]?.text).toBe("Karmit maalattu");
  });

  it("tyhjä huomautus ja tuntematon kunto pudotetaan", () => {
    const clean = sanitizeProjectData({
      lamps: { "1": [{ key: "1#lampA", x: 5, y: 5 }] },
      lampConditions: { "1#lampA": "ehkä" },
      lampNotes: { "1#lampA": { text: "   ", by: "matias", ts: 1 } },
    });
    expect(clean.lampConditions).toBeUndefined();
    expect(clean.lampNotes).toBeUndefined();
  });

  it("kuittaamattomalle ovelle ei jää roikkumaan tekijätietoa", () => {
    const clean = sanitizeProjectData({
      doors: { "1": [{ key: "1#doorA", x: 6, y: 6 }] },
      doorDoneBy: { "1#doorA": { by: "matias", ts: 43 } },
    });
    expect(clean.doorDoneBy).toBeUndefined();
  });

  it("kalusteeton keikka ei saa uusia kenttiä — vanha blobi pyörähtää entisellään", () => {
    const clean = sanitizeProjectData(emptyProjectData());
    for (const k of ["lampConditions", "lampNotes", "lampAddedBy", "doors", "doorStatuses", "doorDoneBy", "doorNotes", "doorAddedBy"]) {
      expect(k in clean).toBe(false);
    }
  });
});


describe("lamppuvarasto — mitä ostetaan ja mikä on kunnossa", () => {
  /** Neljä lamppua, yksi kutakin ämpäriä. */
  function stocked(): ProjectData {
    const p = emptyProjectData();
    p.building.floors = ["1", "2"];
    p.lamps = {
      "1": [
        { key: "1#a", x: 1, y: 1 },   // vaihdettu
        { key: "1#b", x: 2, y: 2 },   // rikki  → ostettava
        { key: "1#c", x: 3, y: 3 },   // toimiva
        { key: "1#d", x: 4, y: 4 },   // tarkastamatta
      ],
      "2": [{ key: "2#a", x: 5, y: 5 }],  // rikki → ostettava
    };
    p.lampStatuses = { "1#a": "vaihdettu" };
    p.lampChangedBy = { "1#a": { by: "jani", ts: 1 } };
    p.lampConditions = { "1#b": "rikki", "1#c": "toimiva", "2#a": "rikki" };
    return p;
  }

  it("vaihdettu voittaa kunnon — korjattu lamppu ei enää tarvitse polttimoa", () => {
    const p = stocked();
    // Sama lamppu on sekä rikki ETTÄ vaihdettu: se on korjattu, ei ostettava.
    p.lampConditions!["1#a"] = "rikki";
    const pt = allLampPoints(p).find((x) => x.key === "1#a")!;
    expect(lampBucket(pt)).toBe("vaihdettu");
    expect(lampNeedsBulb(pt)).toBe(false);
    expect(computeLampInventory(p).needsBulbs).toBe(2);
  });

  it("neljä ämpäriä summautuu aina kokonaismäärään", () => {
    for (const row of computeLampFloorStats(stocked())) {
      expect(row.changed + row.needsBulb + row.working + row.unchecked).toBe(row.total);
    }
  });

  it("laskee ostettavan määrän kerroksittain", () => {
    const rows = computeLampFloorStats(stocked());
    expect(rows.map((r) => [r.floor, r.total, r.needsBulb])).toEqual([["1", 4, 1], ["2", 1, 1]]);
  });

  it("lamputon kerros jätetään pois raportista", () => {
    const p = stocked();
    p.building.floors = ["1", "2", "3"];
    expect(computeLampFloorStats(p).map((r) => r.floor)).toEqual(["1", "2"]);
  });

  it("kunnossa-osuus lasketaan TARKASTETUISTA, ei kaikista", () => {
    const inv = computeLampInventory(stocked());
    expect(inv.total).toBe(5);
    expect(inv.unchecked).toBe(1);
    expect(inv.checked).toBe(4);
    // Kunnossa = vaihdettu (1) + toimiva (1) = 2, neljästä tarkastetusta.
    expect(inv.functional).toBe(2);
    expect(inv.functionalPct).toBe(50);
  });

  it("uuden pisteen lisääminen kartalle ei pudota kunnossa-prosenttia", () => {
    const before = computeLampInventory(stocked()).functionalPct;
    const p = stocked();
    p.lamps!["1"].push({ key: "1#e", x: 9, y: 9 });
    expect(computeLampInventory(p).functionalPct).toBe(before);
  });

  it("lamputon keikka ei jaa nollalla", () => {
    const inv = computeLampInventory(emptyProjectData());
    expect(inv).toMatchObject({ total: 0, needsBulbs: 0, functionalPct: 0 });
    expect(inv.byFloor).toEqual([]);
  });
});

describe("ostoslista ja asiakkaan hintaehdotus", () => {
  function withOrder(): ProjectData {
    const p = emptyProjectData();
    p.building.floors = ["1"];
    p.lamps = { "1": [{ key: "1#a", x: 1, y: 1 }, { key: "1#b", x: 2, y: 2 }] };
    p.lampConditions = { "1#a": "rikki", "1#b": "rikki" };
    p.doors = { "1": [{ key: "1#d1", x: 3, y: 3 }, { key: "1#d2", x: 4, y: 4 }] };
    p.doorStatuses = { "1#d1": "tehty" };
    return p;
  }

  it("määrä lasketaan kartalta oletuksena", () => {
    const o = resolveFixtureOrder(withOrder());
    expect(o.bulbs).toBe(2);
    expect(o.bulbsManual).toBe(false);
    // Ovia on tehtävänä yksi (kaksi merkittyä, joista yksi jo tehty).
    expect(o.doorCount).toBe(1);
    expect(o.doorCountManual).toBe(false);
  });

  it("johtajan käsin asettama määrä voittaa lasketun, ja laskettu jää näkyviin", () => {
    const p = withOrder();
    p.fixtureOrder = { bulbsNeeded: 10, lampModel: "E27 LED 9W" };
    const o = resolveFixtureOrder(p);
    expect(o.bulbs).toBe(10);
    expect(o.bulbsAuto).toBe(2);
    expect(o.bulbsManual).toBe(true);
    expect(o.lampModel).toBe("E27 LED 9W");
  });

  it("nolla on kelvollinen käsin asetettu määrä (ei pudota takaisin laskettuun)", () => {
    const p = withOrder();
    p.fixtureOrder = { bulbsNeeded: 0 };
    const o = resolveFixtureOrder(p);
    expect(o.bulbs).toBe(0);
    expect(o.bulbsManual).toBe(true);
  });

  it("asiakkaan hinnalla laskettu summa käyttää efektiivistä määrää", () => {
    const p = withOrder();
    p.fixtureQuote = { lampWorkPriceCents: 450, doorWorkPriceCents: 1200, at: 1 };
    // 2 lampunvaihtoa × 4,50 € + 1 tiivisteenvaihto × 12,00 € = 21,00 €
    expect(resolveFixtureOrder(p).quotedTotalCents).toBe(2100);
  });

  it("hinta on VAIHTOTYÖSTÄ per kohde — tarvike ei vaikuta summaan", () => {
    const p = withOrder();
    // Neljä ovea tehtävänä, 15 € / tiivisteen vaihto → 60 €. Materiaali on
    // saatetieto siitä mitä kohteeseen menee, eikä se ole summassa mukana.
    p.fixtureOrder = { doorsNeeded: 4, doorMaterial: "EPDM D-tiiviste" };
    p.fixtureQuote = { doorWorkPriceCents: 1500, at: 1 };
    const o = resolveFixtureOrder(p);
    expect(o.doorCount).toBe(4);
    expect(o.doorMaterial).toBe("EPDM D-tiiviste");
    expect(o.quotedTotalCents).toBe(6000);

    // Tarvikkeen vaihtaminen ei muuta summaa lainkaan.
    p.fixtureOrder = { doorsNeeded: 4, doorMaterial: "Silikonitiiviste, musta" };
    expect(resolveFixtureOrder(p).quotedTotalCents).toBe(6000);
  });

  it("sama luku ajaa sekä tarvikemäärän että vaihtojen määrän", () => {
    const p = withOrder();
    p.fixtureQuote = { lampWorkPriceCents: 1000, at: 1 };
    const o = resolveFixtureOrder(p);
    // Kaksi rikkinäistä lamppua = kaksi polttimoa JA kaksi vaihtoa.
    expect(o.bulbs).toBe(2);
    expect(o.quotedTotalCents).toBe(2000);
  });

  it("ilman hintaa summaa ei ole (nolla olisi eri väite kuin ei mitään)", () => {
    expect(resolveFixtureOrder(withOrder()).quotedTotalCents).toBeNull();
    const p = withOrder();
    p.fixtureQuote = { note: "Palataan asiaan", at: 1 };
    expect(resolveFixtureOrder(p).quotedTotalCents).toBeNull();
  });

  it("pelkkä viesti ilman hintoja on kelvollinen ehdotus", () => {
    expect(sanitizeFixtureQuote({ note: "Kysytään taloyhtiöltä", at: 5 })).toMatchObject({ note: "Kysytään taloyhtiöltä" });
  });

  it("tyhjä ehdotus pudotetaan kokonaan", () => {
    expect(sanitizeFixtureQuote({ note: "   ", at: 5 })).toBeNull();
    expect(sanitizeFixtureQuote({})).toBeNull();
  });

  it("negatiivinen hinta pudotetaan, ylisuuri leikataan", () => {
    const q = sanitizeFixtureQuote({ lampWorkPriceCents: -500, doorWorkPriceCents: 9_999_999, at: 1 })!;
    expect(q.lampWorkPriceCents).toBeUndefined();
    expect(q.doorWorkPriceCents).toBe(200_000);
  });

  it("nolla on kelvollinen hinta (veloituksetta)", () => {
    expect(sanitizeFixtureQuote({ lampWorkPriceCents: 0, at: 1 })?.lampWorkPriceCents).toBe(0);
  });

  it("tyhjä ostotieto pudotetaan, tekstit trimmataan", () => {
    expect(sanitizeFixtureOrder({ lampModel: "   " })).toBeNull();
    expect(sanitizeFixtureOrder({ lampModel: "  E27  " })).toEqual({ lampModel: "E27" });
  });

  it("kalusteeton keikka ei saa tilauskenttiä sanitoinnissa", () => {
    const clean = sanitizeProjectData(emptyProjectData());
    expect("fixtureOrder" in clean).toBe(false);
    expect("fixtureQuote" in clean).toBe(false);
  });

  it("ovien kerrosjakauma laskee tehdyt ja tekemättömät", () => {
    expect(computeDoorFloorStats(withOrder())).toEqual([{ floor: "1", total: 2, done: 1, open: 1 }]);
  });
});


describe("laskuri lupaa vain sen mitä kartalle on merkitty", () => {
  it("merkitsemätön lamppu ei ole missään luvussa — ei edes tarkastamattomissa", () => {
    const p = emptyProjectData();
    p.building.floors = ["1"];
    p.lamps = { "1": [{ key: "1#a", x: 1, y: 1 }, { key: "1#b", x: 2, y: 2 }] };
    p.lampConditions = { "1#a": "toimiva" };

    const inv = computeLampInventory(p);
    // Kaksi merkittyä: yksi tarkastettu, yksi ei. Kiinteistössä voi olla
    // kymmeniä muita — ne EIVÄT saa näkyä minään lukuna.
    expect(inv.total).toBe(2);
    expect(inv.unchecked).toBe(1);
    expect(inv.checked).toBe(1);
    expect(inv.total).toBe(inv.byFloor.reduce((n, r) => n + r.total, 0));
  });

  it("kaikki luvut summautuvat merkittyjen määrään, eivät mihinkään suurempaan", () => {
    const p = emptyProjectData();
    p.building.floors = ["1", "2"];
    p.lamps = {
      "1": [{ key: "1#a", x: 1, y: 1 }, { key: "1#b", x: 2, y: 2 }, { key: "1#c", x: 3, y: 3 }],
      "2": [{ key: "2#a", x: 4, y: 4 }],
    };
    p.lampStatuses = { "1#a": "vaihdettu" };
    p.lampChangedBy = { "1#a": { by: "jani", ts: 1 } };
    p.lampConditions = { "1#b": "rikki", "1#c": "toimiva" };

    const inv = computeLampInventory(p);
    expect(inv.fixed + inv.needsBulbs + inv.working + inv.unchecked).toBe(inv.total);
    expect(inv.total).toBe(4);
    // "Kunnossa" ei voi ylittää merkittyjen määrää.
    expect(inv.functional).toBeLessThanOrEqual(inv.total);
    expect(inv.functionalPct).toBeLessThanOrEqual(100);
  });

  it("kartoittamaton keikka näyttää nollaa, ei tyhjää lupausta", () => {
    const p = emptyProjectData();
    p.doors = { "1": [{ key: "1#d", x: 1, y: 1 }] };
    const inv = computeLampInventory(p);
    expect(inv.total).toBe(0);
    expect(inv.needsBulbs).toBe(0);
    expect(inv.functionalPct).toBe(0);
  });
});


describe("lamppumallit — kaikki lamput eivät ole samaa mallia", () => {
  function mixed(): ProjectData {
    const p = emptyProjectData();
    p.building.floors = ["1"];
    p.lamps = { "1": [
      { key: "1#a", x: 1, y: 1 },  // E27, rikki
      { key: "1#b", x: 2, y: 2 },  // E27, rikki
      { key: "1#c", x: 3, y: 3 },  // G9,  rikki
      { key: "1#d", x: 4, y: 4 },  // E27, vaihdettu
      { key: "1#e", x: 5, y: 5 },  // ei mallia, rikki
    ] };
    p.lampModels = [{ id: "m1", name: "E27 LED 9W" }, { id: "m2", name: "G9 halogeeni" }];
    p.lampModelOf = { "1#a": "m1", "1#b": "m1", "1#c": "m2", "1#d": "m1" };
    p.lampConditions = { "1#a": "rikki", "1#b": "rikki", "1#c": "rikki", "1#e": "rikki" };
    p.lampStatuses = { "1#d": "vaihdettu" };
    p.lampChangedBy = { "1#d": { by: "jani", ts: 1 } };
    return p;
  }

  it("erittelee ostettavat mallin mukaan, suurin erä ensin", () => {
    const rows = computeLampModelStats(mixed());
    expect(rows.map((r) => [r.name, r.needsBulb])).toEqual([
      ["E27 LED 9W", 2],
      ["G9 halogeeni", 1],
      ["Ei mallia", 1],
    ]);
  });

  it("malliton lamppu ei katoa summaan vaan saa oman rivinsä", () => {
    const none = computeLampModelStats(mixed()).find((r) => r.id === null)!;
    expect(none.total).toBe(1);
    expect(none.needsBulb).toBe(1);
  });

  it("mallikohtaiset summat täsmäävät kokonaismäärään", () => {
    const p = mixed();
    const rows = computeLampModelStats(p);
    expect(rows.reduce((n, r) => n + r.total, 0)).toBe(computeLampInventory(p).total);
    expect(rows.reduce((n, r) => n + r.needsBulb, 0)).toBe(computeLampInventory(p).needsBulbs);
  });

  it("vaihdettu ei ole ostettavaa, mutta näkyy mallin rivillä", () => {
    const e27 = computeLampModelStats(mixed()).find((r) => r.id === "m1")!;
    expect(e27.total).toBe(3);
    expect(e27.needsBulb).toBe(2);
    expect(e27.changed).toBe(1);
  });

  it("käyttämätön malli näkyy nollarivinä — johtaja lisäsi sen syystä", () => {
    const p = mixed();
    p.lampModels!.push({ id: "m3", name: "Loisteputki T8" });
    const row = computeLampModelStats(p).find((r) => r.id === "m3")!;
    expect(row).toMatchObject({ total: 0, needsBulb: 0 });
  });

  it("poistettuun malliin osoittava lamppu on malliton, ei haamurivi", () => {
    const p = mixed();
    p.lampModels = p.lampModels!.filter((m) => m.id !== "m2");
    const rows = computeLampModelStats(p);
    expect(rows.some((r) => r.name === "G9 halogeeni")).toBe(false);
    // G9:n lamppu siirtyi mallittomiin — se on yhä rikki ja yhä ostettava.
    expect(rows.find((r) => r.id === null)!.needsBulb).toBe(2);
  });

  it("ostoslista erittelee vain rivit joilla on ostettavaa", () => {
    const p = mixed();
    p.lampModels!.push({ id: "m3", name: "Loisteputki T8" });
    expect(resolveFixtureOrder(p).byModel.map((r) => r.name)).toEqual([
      "E27 LED 9W", "G9 halogeeni", "Ei mallia",
    ]);
  });

  it("ilman malleja erittelyä ei ole — yksi luku riittää", () => {
    const p = emptyProjectData();
    p.lamps = { "1": [{ key: "1#a", x: 1, y: 1 }] };
    p.lampConditions = { "1#a": "rikki" };
    expect(resolveFixtureOrder(p).byModel).toEqual([]);
  });

  it("sanitointi pudottaa nimettömän mallin ja kaksoistunnuksen", () => {
    const clean = sanitizeLampModels([
      { id: "m1", name: "E27" }, { id: "m1", name: "Kaksoiskappale" },
      { id: "m2", name: "  " }, { id: "", name: "Tunnukseton" },
    ]);
    expect(clean).toEqual([{ id: "m1", name: "E27" }]);
  });

  it("sanitointi pudottaa viitteen malliin jota ei ole", () => {
    const clean = sanitizeProjectData({
      lamps: { "1": [{ key: "1#a", x: 1, y: 1 }, { key: "1#b", x: 2, y: 2 }] },
      lampModels: [{ id: "m1", name: "E27" }],
      lampModelOf: { "1#a": "m1", "1#b": "poistettu" },
    });
    expect(clean.lampModelOf).toEqual({ "1#a": "m1" });
  });

  it("malliton keikka ei saa mallikenttiä", () => {
    const clean = sanitizeProjectData(emptyProjectData());
    expect("lampModels" in clean).toBe(false);
    expect("lampModelOf" in clean).toBe(false);
  });
});


describe("tuntitila — pyöristys ja tilan oletus", () => {
  it("puolikas tunti pyöristyy ylös, sitä lyhyempi nollaan", () => {
    // Tämä on se pidäke jonka takia sääntö on olemassa: puolen tunnin
    // piipahdus kirjaa tunnin, sitä lyhyempi ei kirjaa mitään.
    expect(roundWorkHoursFromMinutes(30)).toBe(1);
    expect(roundWorkHoursFromMinutes(29)).toBe(0);
    expect(roundWorkHoursFromMinutes(20)).toBe(0);
    expect(roundWorkHoursFromMinutes(0)).toBe(0);
  });

  it("pyöristää lähimpään täyteen tuntiin molempiin suuntiin", () => {
    expect(roundWorkHoursFromMinutes(89)).toBe(1);   // 1 h 29 min → 1 h
    expect(roundWorkHoursFromMinutes(90)).toBe(2);   // 1 h 30 min → 2 h
    expect(roundWorkHoursFromMinutes(455)).toBe(8);  // 7 h 35 min → 8 h
  });

  it("kelvoton tai negatiivinen kesto on nolla, ei NaN eikä miinustunti", () => {
    expect(roundWorkHours(Number.NaN)).toBe(0);
    expect(roundWorkHours(-3)).toBe(0);
    expect(roundWorkHoursFromMinutes(-90)).toBe(0);
  });

  it("puuttuva tila on kohdennettu — FR8 ja vanhat keikat eivät muutu", () => {
    const p = emptyProjectData();
    expect(billingModeOf(p)).toBe("targeted");
    expect(isHourlyGig(p)).toBe(false);
    expect(billingModeOf(null)).toBe("targeted");
  });

  it("valittu tila säilyy sanitoinnissa, tuntematon pudotetaan oletukseen", () => {
    expect(sanitizeProjectData({ billingMode: "hourly" }).billingMode).toBe("hourly");
    expect(sanitizeProjectData({ billingMode: "targeted" }).billingMode).toBe("targeted");
    const bogus = sanitizeProjectData({ billingMode: "kuukausi" });
    expect("billingMode" in bogus).toBe(false);
    expect(billingModeOf(bogus)).toBe("targeted");
  });

  it("valitsematon tila ei kirjoita kenttää lainkaan", () => {
    // Vanha blobi pyörähtää läpi entisellään: tilaa ei ole, eikä sellaista
    // synny sanitoinnissa.
    expect("billingMode" in sanitizeProjectData(emptyProjectData())).toBe(false);
  });
});


describe("asiakkaan tuntinäkymä — mitä hän saa nähdä", () => {
  function gig(): ProjectData {
    const p = emptyProjectData();
    p.billingMode = "hourly";
    // VANHAT tunnit — projektityökalun juokseva summa. Nämä eivät saa näkyä
    // asiakkaalle: ne on tehty muille töille ennen kuin tämä keikka alkoi.
    p.hours = { milja: 78, petrus: 47 };
    // Tämän työn tunnit: päivätty vuorokirjanpito.
    p.shifts = [
      { id: "s1", worker: "oona", day: "2026-08-24", hours: 5, at: 100 },
      { id: "s2", worker: "oona", day: "2026-08-25", hours: 4, at: 200 },
      { id: "s3", worker: "selma", day: "2026-08-25", hours: 6, at: 300 },
      { id: "s4", worker: "jani", day: "2026-08-25", hours: 1, at: 400 },
      { id: "s5", worker: "jani", day: "2026-08-25", hours: -1, at: 500, by: "joonatan" },
    ];
    p.expenses = [
      { id: "e1", by: "joonatan", kind: "materials", desc: "Polttimot", amountCents: 4500, ts: 300, forCustomer: true },
      { id: "e2", by: "joonatan", kind: "transport", desc: "Bussilippu", amountCents: 320, ts: 200 },
      { id: "e3", by: "matias", kind: "materials", desc: "Tiivisteet", amountCents: 1800, ts: 400, forCustomer: true,
        receiptDataUrl: "data:image/png;base64,AAAA" },
    ];
    return p;
  }

  it("vain asiakkaalle merkityt kulut näkyvät, uusin ensin", () => {
    expect(customerExpenses(gig()).map((e) => e.desc)).toEqual(["Tiivisteet", "Polttimot"]);
  });

  /**
   * ALIHANKKIJAN NIMI EI OLE ASIAKKAAN TIETOA — EI LASKULLA EIKÄ SEURANTASIVULLA.
   *
   * Sama rivi näkyy asiakkaalle kahdessa paikassa. Laskun puoli on omassa
   * testissään (`hourly-money.test.ts`); tämä pitää huolen että seurantasivu
   * ei ole se toinen ovi josta sisäinen kuvaus kävelee ulos.
   */
  it("alihankinnan sisäinen kuvaus ei näy seurantasivulla", () => {
    const p = gig();
    p.expenses = [
      { id: "e9", by: "joonatan", kind: "subcontract", desc: "Mika, lampunvaihdot 200 €",
        amountCents: 20000, marginCents: 8000, ts: 500, forCustomer: true },
    ];
    const seen = customerExpenses(p);
    expect(seen).toHaveLength(1);
    expect(seen[0].desc).toBe("Työsuoritus");
    expect(seen[0].amountCents).toBe(28000); // kulu + kate yhtenä lukuna
    expect(JSON.stringify(seen)).not.toContain("Mika");
  });

  it("annettu asiakasteksti on se joka seurantasivulla näkyy", () => {
    const p = gig();
    p.expenses = [
      { id: "e9", by: "joonatan", kind: "subcontract", desc: "Mika", customerDesc: "Valotyöt",
        amountCents: 20000, marginCents: 8000, ts: 500, forCustomer: true },
    ];
    expect(customerExpenses(p)[0].desc).toBe("Valotyöt");
  });

  it("asiakasteksti säilyy sanitoinnin läpi", () => {
    const clean = sanitizeProjectData({
      ...emptyProjectData(),
      expenses: [{ id: "e1", by: "joonatan", kind: "subcontract", desc: "Mika",
        customerDesc: "  Valotyöt  ", amountCents: 20000, marginCents: 8000, ts: 1 }],
    });
    expect(clean.expenses[0].customerDesc).toBe("Valotyöt");
    // Tyhjää ei kirjoiteta blobiin — silloin varanimi hoitaa rivin.
    const blank = sanitizeProjectData({
      ...emptyProjectData(),
      expenses: [{ id: "e1", by: "joonatan", kind: "subcontract", desc: "Mika",
        customerDesc: "   ", amountCents: 20000, ts: 1 }],
    });
    expect(blank.expenses[0].customerDesc).toBeUndefined();
  });

  it("kuitti ei seuraa asiakkaalle koskaan — se on kirjanpitomme tosite", () => {
    const raw = JSON.stringify(customerExpenses(gig()));
    expect(raw).not.toContain("data:image");
    // Eikä maksajan nimi: asiakkaalle kerrotaan mitä ostettiin, ei kuka maksoi.
    expect(raw).not.toContain("joonatan");
    expect(raw).not.toContain("matias");
  });

  it("nollatuntinen ei ole rivi asiakkaan listalla", () => {
    // Janille kirjattiin tunti ja se korjattiin pois — nollaan päätynyt tekijä
    // ei ole rivi.
    const rows = customerHourRows(gig(), (id) => id);
    expect(rows.map((r) => r.name)).toEqual(["oona", "selma"]);
  });

  it("VANHAT projektitunnit eivät vuoda asiakkaan tuntilistalle", () => {
    // Tämä on koko tuntitilan tärkein raja. `hours` on vanhan työkalun
    // juokseva summa (FR8:lla satoja tunteja muilta töiltä); tuntitilan luku
    // on asiakkaan lasku. Jos nämä sekoittuvat, laskutamme väärin.
    const rows = customerHourRows(gig(), (id) => id);
    expect(rows.map((r) => r.name)).not.toContain("milja");
    expect(rows.map((r) => r.name)).not.toContain("petrus");
    expect(rows.reduce((a, r) => a + r.hours, 0)).toBe(15);
  });

  it("tunnit järjestetään suurimmasta, ja nimi tulee nimeäjältä", () => {
    const rows = customerHourRows(gig(), (id) => ({ oona: "Oona", selma: "Selma" }[id] ?? id));
    expect(rows).toEqual([{ name: "Oona", hours: 9 }, { name: "Selma", hours: 6 }]);
  });

  it("merkitsemätön kulu pysyy sisäisenä myös sanitoinnin jälkeen", () => {
    const clean = sanitizeProjectData(gig());
    const flags = (clean.expenses ?? []).map((e) => e.forCustomer);
    expect(flags).toEqual([true, undefined, true]);
  });

  it("roskainen tai false-arvoinen lippu ei avaa kulua asiakkaalle", () => {
    const clean = sanitizeProjectData({
      expenses: [
        { id: "a", by: "x", kind: "other", desc: "a", amountCents: 100, ts: 1, forCustomer: "kyllä" },
        { id: "b", by: "x", kind: "other", desc: "b", amountCents: 100, ts: 2, forCustomer: false },
        { id: "c", by: "x", kind: "other", desc: "c", amountCents: 100, ts: 3, forCustomer: 1 },
      ],
    });
    expect((clean.expenses ?? []).every((e) => e.forCustomer === undefined)).toBe(true);
    expect(customerExpenses(clean)).toEqual([]);
  });
});


describe("työtaulu — yksi lista, kolme kirjoittajaa", () => {
  const entries = [
    { id: "a", kind: "task" as const, text: "Vaihtakaa kellarin lamput", by: BOARD_CUSTOMER, byName: "Niilo", at: 100 },
    { id: "b", kind: "note" as const, text: "Kellarin lamput vaihdettu", by: "oona", byName: "Oona", at: 300 },
    { id: "c", kind: "task" as const, text: "Tarkistakaa 3. kerros", by: "matias", at: 200,
      done: { by: "selma", byName: "Selma", at: 400 } },
    { id: "d", kind: "task" as const, text: "Ovien tiivisteet", by: BOARD_CUSTOMER, at: 50 },
  ];

  it("avoimet tehtävät ensin, uusin ylimmäksi; kuitatut ja merkinnät perässä", () => {
    expect(sortedBoard(entries).map((e) => e.id)).toEqual(["a", "d", "b", "c"]);
  });

  it("avoimet tehtävät lasketaan, merkinnät ja kuitatut eivät", () => {
    expect(openTaskCount(entries)).toBe(2);
    expect(openTaskCount([])).toBe(0);
    expect(openTaskCount(undefined)).toBe(0);
  });

  it("tekstitön rivi putoaa — tyhjä viesti ei ole viesti", () => {
    const clean = sanitizeBoard([
      { id: "x", kind: "note", text: "   ", by: "oona", at: 1 },
      { id: "y", kind: "note", text: "OK", by: "oona", at: 2 },
      { id: "", kind: "note", text: "tunnukseton", by: "oona", at: 3 },
      { id: "z", kind: "note", text: "kirjoittajaton", by: "", at: 4 },
    ]);
    expect(clean.map((e) => e.id)).toEqual(["y"]);
  });

  it("kaksoistunnus pudotetaan — sama rivi ei saa esiintyä kahdesti", () => {
    const clean = sanitizeBoard([
      { id: "a", kind: "note", text: "eka", by: "oona", at: 1 },
      { id: "a", kind: "note", text: "toka", by: "oona", at: 2 },
    ]);
    expect(clean.map((e) => e.text)).toEqual(["eka"]);
  });

  it("kuittaus kuuluu vain tehtävälle — merkinnälle eksynyt pudotetaan", () => {
    const clean = sanitizeBoard([
      { id: "n", kind: "note", text: "juttu", by: "oona", at: 1, done: { by: "selma", at: 2 } },
      { id: "t", kind: "task", text: "tehtävä", by: "oona", at: 1, done: { by: "selma", at: 2 } },
    ]);
    // Merkinnällä ei ole mitään kuitattavaa; sinne eksynyt kuittaus saisi sen
    // näyttämään listalla tehdyltä tehtävältä.
    expect(clean.find((e) => e.id === "n")!.done).toBeUndefined();
    expect(clean.find((e) => e.id === "t")!.done).toMatchObject({ by: "selma" });
  });

  it("tuntematon laji on merkintä, ei tehtävä — arvattu tehtävä jäisi ikuisesti auki", () => {
    expect(sanitizeBoard([{ id: "q", kind: "kysymys", text: "?", by: "oona", at: 1 }])[0].kind).toBe("note");
  });

  it("taulu ei kasva rajatta, ja vanhin putoaa", () => {
    const many = Array.from({ length: 320 }, (_, i) => ({ id: `e${i}`, kind: "note", text: `t${i}`, by: "oona", at: i }));
    const clean = sanitizeBoard(many);
    expect(clean.length).toBe(300);
    expect(clean[0].id).toBe("e20");
  });

  it("tyhjä taulu ei kirjoita kenttää lainkaan", () => {
    expect("board" in sanitizeProjectData(emptyProjectData())).toBe(false);
    expect("board" in sanitizeProjectData({ board: [] })).toBe(false);
  });

  it("kirjoittajan nimi säilyy tallennushetkeltä", () => {
    // Asiakas ei ole crew-listassa, joten nimeä ei voi jälkikäteen selvittää.
    const clean = sanitizeBoard([{ id: "a", kind: "task", text: "x", by: BOARD_CUSTOMER, byName: "Niilo", at: 1 }]);
    expect(clean[0].byName).toBe("Niilo");
  });
});


/**
 * TUNTITILAN VUOROKIRJANPITO.
 *
 * Nämä testit vartioivat yhtä rajaa: tuntitilan luku ei saa olla peräisin
 * vanhasta `hours`-summasta. Se vika oli tuotannossa — tuntinäkymä avautui
 * näyttäen 255 tuntia joita kukaan ei ollut tehnyt sille työlle — ja koska
 * tuntitilassa luku on lasku ja palkka, se ei ollut kosmeettinen.
 */
describe("tuntitilan vuorokirjanpito — oma kirjanpito, päivätty", () => {
  const shifts = [
    { id: "a", worker: "oona", day: "2026-08-24", hours: 5, at: 10 },
    { id: "b", worker: "oona", day: "2026-08-25", hours: 4, at: 20 },
    { id: "c", worker: "selma", day: "2026-08-25", hours: 6, at: 30 },
  ];

  it("summat lasketaan riveistä, ja päivä ratkaisee mikä on tänään", () => {
    const st = computeShiftStats(shifts, "2026-08-25");
    expect(st.totalHours).toBe(15);
    expect(st.todayHours).toBe(10);
    expect(st.byWorker).toEqual([
      { id: "oona", hours: 9, days: 2, lastAt: 20 },
      { id: "selma", hours: 6, days: 1, lastAt: 30 },
    ]);
  });

  it("päivät tulevat uusin ensin ja jokaisella on tekijänsä", () => {
    const st = computeShiftStats(shifts, "2026-08-25");
    expect(st.byDay.map((d) => d.day)).toEqual(["2026-08-25", "2026-08-24"]);
    expect(st.byDay[0]).toEqual({
      day: "2026-08-25", hours: 10,
      workers: [{ id: "selma", hours: 6 }, { id: "oona", hours: 4 }],
    });
  });

  it("korjaus on oma rivinsä eikä summan muokkaus", () => {
    const withFix = [...shifts, { id: "d", worker: "selma", day: "2026-08-25", hours: -2, at: 40, by: "joonatan" }];
    expect(shiftHoursOf(withFix, "selma")).toBe(4);
    expect(computeShiftStats(withFix, "2026-08-25").totalHours).toBe(13);
  });

  it("tekijä ei päädy miinukselle eikä nollarivi ole rivi", () => {
    const over = [
      { id: "a", worker: "jani", day: "2026-08-25", hours: 1, at: 10 },
      { id: "b", worker: "jani", day: "2026-08-25", hours: -4, at: 20, by: "joonatan" },
    ];
    expect(shiftHoursOf(over, "jani")).toBe(0);
    expect(computeShiftStats(over, "2026-08-25").byWorker).toEqual([]);
  });

  it("sanitointi pudottaa rivin jolta puuttuu tekijä, tunnit tai tunniste", () => {
    const clean = sanitizeShifts([
      { id: "a", worker: "oona", day: "2026-08-25", hours: 4, at: 1 },
      { id: "b", worker: "", day: "2026-08-25", hours: 4, at: 2 },
      { id: "c", worker: "selma", day: "2026-08-25", hours: 0, at: 3 },
      { id: "", worker: "selma", day: "2026-08-25", hours: 2, at: 4 },
      { id: "a", worker: "selma", day: "2026-08-25", hours: 9, at: 5 },
    ]);
    expect(clean.map((s) => s.id)).toEqual(["a"]);
  });

  it("annettu menneisyyden päivä säilyy — eiliselle kirjaaminen ei siirry tähän päivään", () => {
    // Ajastin unohtuu ja päivä kirjataan usein vasta seuraavana aamuna, joten
    // kirjaushetki ja työpäivä ovat eri asioita. Jos `at` voittaisi `day`n,
    // eiliselle kirjattu työ hyppäisi tälle päivälle.
    const at = new Date(2026, 7, 26, 8, 0, 0).getTime();
    const [row] = sanitizeShifts([{ id: "a", worker: "matias", day: "2026-08-25", hours: 7, at }]);
    expect(row.day).toBe("2026-08-25");
    expect(computeShiftStats([row], "2026-08-26").todayHours).toBe(0);
    expect(computeShiftStats([row], "2026-08-26").totalHours).toBe(7);
  });

  it("kelvoton päivä johdetaan kirjaushetkestä — rivi ei jää päivättömäksi", () => {
    const at = new Date(2026, 7, 25, 13, 0, 0).getTime();
    const [row] = sanitizeShifts([{ id: "a", worker: "oona", day: "eilen", hours: 3, at }]);
    expect(row.day).toBe("2026-08-25");
  });

  it("päiväavain on paikallinen — yötyö ei siirry edelliselle päivälle", () => {
    // 01:30 paikallista aikaa: UTC-päivä olisi Suomessa vielä edellinen.
    const at = new Date(2026, 7, 25, 1, 30, 0).getTime();
    expect(dayKey(at)).toBe("2026-08-25");
    expect(isDayKey(dayKey(at))).toBe(true);
    expect(isDayKey("25.8.2026")).toBe(false);
  });

  it("päivämäärä näytetään viikonpäivän kanssa", () => {
    expect(fmtDayLabel("2026-08-25")).toBe("ti 25.8.");
  });

  it("saman päivän käsin kirjaukset kertyvät YHTEEN riviin", () => {
    // Ilman tätä jokainen napautus jätti oman sirpaleensa päiväkirjaan — ja
    // kun tunnin korjasi alas ja takaisin ylös, päivän summa ei liikkunut
    // lainkaan. Kirjaus näytti siltä ettei se tehnyt mitään.
    let list: any[] = [];
    for (let i = 0; i < 3; i++) {
      list = addShiftEntry(list, { id: `x${i}`, worker: "oona", hours: 1, day: "2026-08-25", at: 100 + i });
    }
    expect(list).toHaveLength(1);
    expect(list[0].hours).toBe(3);
  });

  it("korjaus alas ja takaisin ylös näkyy lukuna, ei kahtena rivinä", () => {
    let list: any[] = addShiftEntry([], { id: "a", worker: "oona", hours: 4, day: "2026-08-25", at: 1 });
    list = addShiftEntry(list, { id: "b", worker: "oona", hours: -1, day: "2026-08-25", at: 2 });
    expect(list).toHaveLength(1);
    expect(list[0].hours).toBe(3);
    list = addShiftEntry(list, { id: "c", worker: "oona", hours: 1, day: "2026-08-25", at: 3 });
    expect(list).toHaveLength(1);
    expect(list[0].hours).toBe(4);
  });

  it("nollaan kutistunut korjausrivi poistuu", () => {
    let list: any[] = addShiftEntry([], { id: "a", worker: "oona", hours: 1, day: "2026-08-25", at: 1 });
    list = addShiftEntry(list, { id: "b", worker: "oona", hours: -1, day: "2026-08-25", at: 2 });
    expect(list).toEqual([]);
  });

  it("ajastimen vuoro ei yhdisty — kaksi vuoroa on kaksi vuoroa", () => {
    let list: any[] = addShiftEntry([], { id: "a", worker: "oona", hours: 4, day: "2026-08-25", at: 1, startedAt: 1 });
    list = addShiftEntry(list, { id: "b", worker: "oona", hours: 3, day: "2026-08-25", at: 2, startedAt: 2 });
    expect(list).toHaveLength(2);
    expect(shiftHoursOnDay(list, "oona", "2026-08-25")).toBe(7);
  });

  it("käsin korjaus ei vie PÄIVÄÄ miinukselle", () => {
    // Miinukselle mennyt päivä katoaisi päiväkirjasta mutta jäisi vähentämään
    // kokonaissummaa — päiväkirja ei täsmäisi eikä eroa voisi selittää.
    let list: any[] = addShiftEntry([], { id: "a", worker: "oona", hours: 2, day: "2026-08-25", at: 1, startedAt: 1 });
    list = addShiftEntry(list, { id: "b", worker: "oona", hours: -9, day: "2026-08-25", at: 2 });
    expect(shiftHoursOnDay(list, "oona", "2026-08-25")).toBe(0);
    expect(computeShiftStats(list, "2026-08-25").totalHours).toBe(0);
  });

  it("eri päivät pysyvät erillään", () => {
    let list: any[] = addShiftEntry([], { id: "a", worker: "oona", hours: 4, day: "2026-08-25", at: 1 });
    list = addShiftEntry(list, { id: "b", worker: "oona", hours: 5, day: "2026-08-26", at: 2 });
    expect(list).toHaveLength(2);
    expect(shiftHoursOnDay(list, "oona", "2026-08-25")).toBe(4);
    expect(shiftHoursOnDay(list, "oona", "2026-08-26")).toBe(5);
  });

  it("unohtunut ajastin ei kirjaa vuorokausia", () => {
    // Ajastin jää päälle yön yli. Kukaan ei tee 35 tunnin työvuoroa, joten se
    // luku on mittausvirhe — ja tuntitilassa se menisi suoraan laskulle.
    expect(cappedTimerHours(35)).toEqual({ hours: MAX_TIMER_SHIFT_HOURS, capped: true });
  });

  it("raja ei leikkaa todellista pitkää päivää", () => {
    expect(cappedTimerHours(11.6)).toEqual({ hours: 12, capped: false });
    expect(cappedTimerHours(MAX_TIMER_SHIFT_HOURS)).toEqual({ hours: MAX_TIMER_SHIFT_HOURS, capped: false });
    // Alle puolen tunnin piipahdus ei kerrytä tuntia, kuten muutenkaan.
    expect(cappedTimerHours(0.3)).toEqual({ hours: 0, capped: false });
  });

  it("lista ei kasva rajatta — vanhin putoaa", () => {
    const many = Array.from({ length: MAX_SHIFTS + 25 }, (_, i) => ({
      id: `s${i}`, worker: "oona", day: "2026-08-25", hours: 1, at: i,
    }));
    const clean = sanitizeShifts(many);
    expect(clean.length).toBe(MAX_SHIFTS);
    expect(clean[0].id).toBe("s25");
  });

  it("tyhjä kirjanpito ei kirjoita kenttää — vanhat blobit pysyvät ennallaan", () => {
    const p = emptyProjectData();
    expect("shifts" in sanitizeProjectData(p)).toBe(false);
  });

  it("kirjanpito säilyy sanitoinnin läpi", () => {
    const p = emptyProjectData();
    p.shifts = shifts;
    expect(sanitizeProjectData(p).shifts?.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });
});

/**
 * PUOLIKKAAT TUNNIT KÄSIN KIRJATTUNA.
 *
 * Ajastin pyöristää täysiin tunteihin, koska se on mittaus. Käsin kirjattu
 * aika on PÄÄTÖS: pomo tietää tehneensä puoli tuntia. Ennen tätä hänen ainoa
 * vaihtoehtonsa oli kirjata tunti tai ei mitään, ja kumpikin on väärä luku
 * sekä laskulla että palkassa.
 *
 * Ledger on sietänyt kahta desimaalia koko ajan — vain käyttöliittymä oli
 * sidottu kokonaisiin. Nämä testit pitävät ledgerin puolen paikallaan, jottei
 * pyöristys palaa sinne "siivouksena".
 */
describe("puolikkaat tunnit ledgerissä", () => {
  it("sanitoija säilyttää puolikkaan", () => {
    const [row] = sanitizeShifts([{ id: "a", worker: "petrus", day: "2026-09-01", hours: 0.5, at: 1 }]);
    expect(row.hours).toBe(0.5);
  });

  it("saman päivän käsinkirjaukset summautuvat puolikkaina", () => {
    let shifts = addShiftEntry([], { id: "a", worker: "petrus", day: "2026-09-01", hours: 0.5, at: 1 });
    shifts = addShiftEntry(shifts, { id: "b", worker: "petrus", day: "2026-09-01", hours: 0.5, at: 2 });
    expect(shifts).toHaveLength(1);
    expect(shifts[0].hours).toBe(1);
  });

  it("puolikas vähennys ei pyöristy pois", () => {
    let shifts = addShiftEntry([], { id: "a", worker: "petrus", day: "2026-09-01", hours: 2, at: 1 });
    shifts = addShiftEntry(shifts, { id: "b", worker: "petrus", day: "2026-09-01", hours: -0.5, at: 2 });
    expect(shifts[0].hours).toBe(1.5);
  });

  it("tilasto näyttää puolikkaat sellaisenaan", () => {
    const shifts = sanitizeShifts([
      { id: "a", worker: "petrus", day: "2026-09-01", hours: 1.5, at: 1 },
      { id: "b", worker: "mikko", day: "2026-09-01", hours: 0.5, at: 2 },
    ]);
    const st = computeShiftStats(shifts, "2026-09-02");
    expect(st.totalHours).toBe(2);
    expect(st.byWorker.find((w) => w.id === "mikko")!.hours).toBe(0.5);
  });
});

/**
 * LASKUN NIMI.
 *
 * Nimi luetaan asiakkaalle kuudessa kohdassa, ja ennen tätä sääntö oli
 * kirjoitettu jokaiseen erikseen: tuntilasku puuttui neljästä ja olisi
 * lähtenyt nimellä "Osalasku". Nyt sääntö on yksi funktio — ja tässä on
 * testi joka kaatuu, jos joku kirjoittaa seitsemännen kopion.
 */
describe("laskun nimi", () => {
  it("tuntilasku ei ole osalasku eikä loppulasku", () => {
    const n = invoiceNaming({ scope: "hours", isFinal: true, fixedDeal: true, paymentNumber: 4 });
    expect(n.short).toBe("Tuntilasku");
    expect(n.prose).not.toMatch(/osalasku|loppulasku|maksuerä/i);
  });

  it("keltaisten lasku on lisätyölasku, ei urakan erä", () => {
    expect(invoiceNaming({ scope: "p2", fixedDeal: true, paymentNumber: 2 }).short).toBe("Lisätyölasku (2. vaihe)");
  });

  it("urakan erä numeroidaan, vapaa lasku ei", () => {
    expect(invoiceNaming({ scope: "p1", fixedDeal: true, paymentNumber: 3 }).short).toBe("Osalasku 3/4");
    expect(invoiceNaming({ scope: "p1", isFinal: true }).short).toBe("Loppulasku");
    expect(invoiceNaming({ scope: "p1" }).short).toBe("Osalasku");
  });

  it("jokaisella virralla on nimi kummassakin muodossa", () => {
    for (const scope of ["p1", "p2", "hours"] as const) {
      const n = invoiceNaming({ scope });
      expect(n.short.trim()).not.toBe("");
      expect(n.prose.trim()).not.toBe("");
    }
  });
});

/**
 * KALENTERIN PÄIVÄMATEMATIIKKA.
 *
 * Nämä ovat pieniä funktioita joiden virhe ei näy koodissa vaan vasta
 * ruudulla, väärän päivän kohdalla — ja tuntikirjanpidossa päivä on koko
 * perusta: väärälle päivälle kirjattu tunti on väärä luku palkassa ja
 * laskulla. Siksi ne testataan erikseen eikä silmämääräisesti.
 */
describe("kalenterin päivät", () => {
  it("siirtää päivää eteen ja taakse", () => {
    expect(shiftDay("2026-09-01", 1)).toBe("2026-09-02");
    expect(shiftDay("2026-09-01", -1)).toBe("2026-08-31");
    expect(shiftDay("2026-09-01", -7)).toBe("2026-08-25");
    expect(shiftDay("2026-09-01", 0)).toBe("2026-09-01");
  });

  it("kuukauden ja vuoden yli", () => {
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDay("2027-01-01", -1)).toBe("2026-12-31");
    // Karkausvuosi: 2028 on karkausvuosi, 2026 ei.
    expect(shiftDay("2028-02-28", 1)).toBe("2028-02-29");
    expect(shiftDay("2026-02-28", 1)).toBe("2026-03-01");
  });

  /**
   * KESÄAJAN VAIHTOPÄIVÄ. Keskiyöhön lisätty vuorokausi osuu 23 tai 25 tunnin
   * päähän, ja päivä joko hyppää yli tai jää paikalleen. Kalenterissa se olisi
   * puuttuva tai kahdesti piirtyvä päivä — kahdesti vuodessa.
   */
  it("kesäajan vaihtopäivä ei hukkaa eikä kahdenna päivää", () => {
    // EU: kesäaika alkaa maaliskuun viimeisenä sunnuntaina, päättyy lokakuun.
    expect(shiftDay("2026-03-28", 1)).toBe("2026-03-29");
    expect(shiftDay("2026-03-29", 1)).toBe("2026-03-30");
    expect(shiftDay("2026-10-24", 1)).toBe("2026-10-25");
    expect(shiftDay("2026-10-25", 1)).toBe("2026-10-26");
    // Ja viikko molempien yli pysyy seitsemänä eri päivänä.
    for (const start of ["2026-03-23", "2026-10-19"]) {
      const w = weekOf(start);
      expect(new Set(w).size).toBe(7);
    }
  });

  it("viikko alkaa maanantaista ja päättyy sunnuntaihin", () => {
    // 2026-09-01 on tiistai.
    const w = weekOf("2026-09-01");
    expect(w).toHaveLength(7);
    expect(w[0]).toBe("2026-08-31"); // maanantai
    expect(w[6]).toBe("2026-09-06"); // sunnuntai
    expect(w).toContain("2026-09-01");
    // Sunnuntai kuuluu EDELLISEEN viikkoon, ei seuraavaan.
    expect(weekOf("2026-09-06")[0]).toBe("2026-08-31");
    // Maanantaista laskettu viikko on sama.
    expect(weekOf("2026-08-31")).toEqual(w);
  });

  it("viikonpäivän kirjain ja kuukauden päivä", () => {
    expect(weekdayLetter("2026-08-31")).toBe("M"); // maanantai
    expect(weekdayLetter("2026-09-06")).toBe("S"); // sunnuntai
    expect(dayOfMonth("2026-09-01")).toBe(1);
    expect(dayOfMonth("2026-09-30")).toBe(30);
  });

  it("otsikko kertoo molemmat kuukaudet kun viikko jakautuu", () => {
    expect(monthLabel(weekOf("2026-09-15"))).toBe("syyskuu 2026");
    expect(monthLabel(weekOf("2026-09-01"))).toBe("elokuu–syyskuu 2026");
    expect(monthLabel(weekOf("2026-12-31"))).toBe("joulukuu 2026 – tammikuu 2027");
    expect(monthLabel([])).toBe("");
  });

  it("roska ei kaada mitään", () => {
    expect(shiftDay("roska", 1)).toBe("roska");
    expect(weekOf("")).toEqual([]);
    expect(weekdayLetter("x")).toBe("");
    expect(dayOfMonth("x")).toBe(0);
  });
});
