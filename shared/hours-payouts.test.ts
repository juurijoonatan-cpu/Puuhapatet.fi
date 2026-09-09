/**
 * TUNTITYÖ MAKSUISSA — yksikkötestit.
 *
 * Tämä on se rahavirta jota järjestelmä ei tunnistanut lainkaan: tunnit
 * kirjattiin (`ProjShift`), mutta yksikään maksunäkymä ei laskenut niistä
 * senttiäkään. Nämä testit lukitsevat kolme asiaa:
 *
 *   1. tunnit muuttuvat rahaksi automaattisesti (tunnit × tuntipalkka),
 *   2. tuntipotti EI kuittaa ikkunavelkaa eikä toisinpäin,
 *   3. tuntityö näkyy laskun erittelyssä omana rivinään.
 */
import { describe, it, expect } from "vitest";
import { computeWorkerSettlements, eraSettlementByWorker, sumWorkerSettlements } from "./worker-payouts";
import {
  computeEraBilling, normalizeEraNumbers, eraScopeOf, eraScopeLabel,
  HOURS_ERA_NUMBERS, P2_ERA_NUMBERS, isHoursEraSelection,
} from "./era-billing";
import { emptyProjectData, type ProjectData, type ProjShift } from "./project";
import { DEFAULT_WORKER_PER_WINDOW_CENTS, type CrewMember } from "./crew";

function member(id: string, over: Partial<CrewMember> = {}): CrewMember {
  return {
    id, name: id, token: `t-${id}`, role: "worker",
    perWindowCents: DEFAULT_WORKER_PER_WINDOW_CENTS,
    active: true, agreements: [], payouts: [], ...over,
  } as CrewMember;
}

function shift(worker: string, hours: number, day = "2026-01-02"): ProjShift {
  return { id: `${worker}-${day}-${hours}`, worker, day, hours, at: Date.now() };
}

/** Keikka jossa on `red` pestyä punaista ikkunaa ja annetut tuntivuorot. */
function gig(opts: { workerId: string; red?: number; shifts?: ProjShift[]; workerHourCents?: number }): ProjectData {
  const p = emptyProjectData();
  p.building.floors = ["1"];
  const marks: any = { "1": { marks: [] } };
  const statuses: any = {};
  const washedBy: Record<string, string> = {};
  for (let i = 0; i < (opts.red ?? 0); i++) {
    marks["1"].marks.push({ x: i, y: 0, p: 1 });
    statuses[`1#${i}`] = "pesty";
    washedBy[`1#${i}`] = opts.workerId;
  }
  p.marks = marks;
  p.statuses = statuses;
  p.washedBy = washedBy;
  p.crew = [member(opts.workerId)];
  p.shifts = opts.shifts ?? [];
  // Tuntipalkka lasketaan VAIN tuntitilassa (ks. worker-payouts): kohdennetulla
  // keikalla vuororivit ovat seurantatietoa eivätkä palkkaa.
  p.billingMode = "hourly";
  if (opts.workerHourCents != null) p.workerHourCents = opts.workerHourCents;
  return p;
}

/** Tuntipotin erälasku tekijälle. */
function hoursInvoice(over: {
  senderId: string; tila?: string; tunnit: number; ansaittuCents: number;
}) {
  return {
    kind: "tekija",
    tila: over.tila ?? "lähetetty",
    senderId: over.senderId,
    totalCents: over.ansaittuCents,
    eraNumbers: [...HOURS_ERA_NUMBERS],
    rivit: { input: { tunnit: over.tunnit }, computed: { ansaittuCents: over.ansaittuCents } },
  };
}

describe("tuntityön tunnistus maksuissa", () => {
  it("laskee tuntipalkan automaattisesti kirjatuista vuoroista", () => {
    // 12 h × 15,00 € = 180,00 €. Ei yhtään ikkunaa — juuri tämä keikka näytti
    // ennen nollaa jokaisessa maksunäkymässä.
    const p = gig({ workerId: "jani", shifts: [shift("jani", 8), shift("jani", 4, "2026-01-03")] });
    const [row] = computeWorkerSettlements(p);
    expect(row.hours).toBe(12);
    expect(row.hourRateCents).toBe(1500);
    expect(row.hoursEarnedCents).toBe(180_00);
    expect(row.openHoursCents).toBe(180_00);
    expect(row.openTotalCents).toBe(180_00);
  });

  it("käyttää keikan omaa tuntipalkkaa kun se on asetettu", () => {
    const p = gig({ workerId: "jani", shifts: [shift("jani", 10)], workerHourCents: 1800 });
    const [row] = computeWorkerSettlements(p);
    expect(row.hoursEarnedCents).toBe(180_00);
  });

  it("summaa ikkunatyön ja tuntityön yhdeksi siirrettäväksi", () => {
    // 10 punaista × 20 € = 200 € + 5 h × 15 € = 75 € → 275 €.
    const p = gig({ workerId: "jani", red: 10, shifts: [shift("jani", 5)] });
    const [row] = computeWorkerSettlements(p);
    expect(row.openP1Cents).toBe(200_00);
    expect(row.openHoursCents).toBe(75_00);
    expect(row.openTotalCents).toBe(275_00);
    expect(sumWorkerSettlements([row]).openTotalCents).toBe(275_00);
  });

  it("tuntimaksu kuittaa VAIN tuntivelkaa, ei ikkunavelkaa", () => {
    const p = gig({ workerId: "jani", red: 10, shifts: [shift("jani", 5)] });
    const invoices = [hoursInvoice({ senderId: "jani", tunnit: 5, ansaittuCents: 75_00 })];
    const [row] = computeWorkerSettlements(p, {
      era: eraSettlementByWorker(invoices, "p1"),
      p2Era: eraSettlementByWorker(invoices, "p2"),
      hoursEra: eraSettlementByWorker(invoices, "hours"),
    });
    expect(row.openHoursCents).toBe(0);
    expect(row.openP1Cents).toBe(200_00);   // ikkunavelka koskematon
    expect(row.openTotalCents).toBe(200_00);
  });

  it("ikkunamaksu ei kuittaa tuntivelkaa", () => {
    const p = gig({ workerId: "jani", red: 10, shifts: [shift("jani", 5)] });
    const p1Invoice = {
      kind: "tekija", tila: "lähetetty", senderId: "jani", totalCents: 200_00,
      eraNumbers: [1, 2, 3],
      rivit: { input: { pestytIkkunat: 10 }, computed: { ansaittuCents: 200_00 } },
    };
    const [row] = computeWorkerSettlements(p, {
      era: eraSettlementByWorker([p1Invoice], "p1"),
      hoursEra: eraSettlementByWorker([p1Invoice], "hours"),
    });
    expect(row.openP1Cents).toBe(0);
    expect(row.openHoursCents).toBe(75_00);
  });

  it("luonnos varaa tuntivelan — johtaja ei luo samaa maksua kahdesti", () => {
    const p = gig({ workerId: "jani", shifts: [shift("jani", 5)] });
    const invoices = [hoursInvoice({ senderId: "jani", tila: "luonnos", tunnit: 5, ansaittuCents: 75_00 })];
    const [row] = computeWorkerSettlements(p, { hoursEra: eraSettlementByWorker(invoices, "hours") });
    expect(row.hoursPendingCents).toBe(75_00);
    expect(row.openHoursCents).toBe(0);
    expect(row.openHours).toBe(0);
  });

  it("osamaksu jättää loput tunnit avoimeksi ja esitäyttö seuraa rahaa", () => {
    const p = gig({ workerId: "jani", shifts: [shift("jani", 10)] });   // 150 €
    const invoices = [hoursInvoice({ senderId: "jani", tunnit: 4, ansaittuCents: 60_00 })];
    const [row] = computeWorkerSettlements(p, { hoursEra: eraSettlementByWorker(invoices, "hours") });
    expect(row.openHoursCents).toBe(90_00);
    expect(row.openHours).toBe(6);
  });
});

describe("käsin kirjattu maksu kuittaa myös tuntivelkaa", () => {
  it("vanhan kanavan payout kuittaa tunnit kun muuta velkaa ei ole", () => {
    // Käsin kirjattu payout ei tiedä mistä rahasta on kysymys. Tuntikeikalla
    // ikkunavelkaa ei ole, joten ilman ylivuotoa maksu ei kuitannut mitään ja
    // maksudialogi esitäytti saman summan uudelleen — tuplamaksu.
    const p = gig({ workerId: "jani", shifts: [shift("jani", 10)] });   // 150 €
    p.crew = [member("jani", {
      payouts: [{ id: "p1", amountCents: 150_00, windows: 0, status: "maksettu", createdAt: 1 }],
    } as any)];
    const [row] = computeWorkerSettlements(p);
    expect(row.hoursEarnedCents).toBe(150_00);
    expect(row.openHoursCents).toBe(0);
    expect(row.openTotalCents).toBe(0);
  });

  it("ylivuoto menee ikkunoiden JÄLKEEN tunteihin, ei niiden ohi", () => {
    // 10 punaista = 200 € + 10 h = 150 €. Käsin kirjattu 250 € kuittaa ensin
    // punaiset (200 €) ja ylijäävä 50 € tunteja.
    const p = gig({ workerId: "jani", red: 10, shifts: [shift("jani", 10)] });
    p.crew = [member("jani", {
      payouts: [{ id: "p1", amountCents: 250_00, windows: 0, status: "maksettu", createdAt: 1 }],
    } as any)];
    const [row] = computeWorkerSettlements(p);
    expect(row.openP1Cents).toBe(0);
    expect(row.openHoursCents).toBe(100_00);
    expect(row.openTotalCents).toBe(100_00);
  });

  it("ei kuittaa KELTAISIA ennen kuin punaiset ja tunnit on maksettu", () => {
    // 10 punaista (200 €) + 5 keltaista à 37,50 € (palkkiotaulukko 20 €/kpl =
    // 100 €) + 10 h (150 €). Käsin kirjattu 280 € riittää punaisiin ja osaan
    // tunneista — keltaisiin se ei saa yltää, koska asiakas ei ole vielä
    // maksanut niistä mitään.
    const p = gig({ workerId: "jani", red: 10, shifts: [shift("jani", 10)] });
    p.marks = {
      "1": { marks: [
        ...Array.from({ length: 10 }, (_, i) => ({ x: i, y: 0, p: 1 as const })),
        ...Array.from({ length: 5 }, (_, i) => ({ x: i, y: 1, p: 2 as const })),
      ] },
    } as any;
    const statuses: any = {};
    const washedBy: Record<string, string> = {};
    const offers: any = {};
    for (let i = 0; i < 15; i++) {
      statuses[`1#${i}`] = "pesty";
      washedBy[`1#${i}`] = "jani";
      if (i >= 10) offers[`1#${i}`] = { status: "locked", priceCents: 3750, version: 1, lockedCents: 3750 };
    }
    p.statuses = statuses;
    p.washedBy = washedBy;
    p.p2 = { enabled: true, workerSharePct: 53, offers, events: [] } as any;
    p.crew = [member("jani", {
      payouts: [{ id: "p1", amountCents: 280_00, windows: 0, status: "maksettu", createdAt: 1 }],
    } as any)];
    const [row] = computeWorkerSettlements(p);
    expect(row.openP1Cents).toBe(0);
    expect(row.openHoursCents).toBe(70_00);      // 150 − 80 ylivuotoa
    expect(row.openP2Cents).toBe(row.p2EarnedCents);   // keltaiset koskematta
    expect(row.p2EarnedCents).toBeGreaterThan(0);
  });
});

describe("kohdennettu raha ei valu toiseen pottiin", () => {
  it("tuntipotin lasku ei kuittaa keltaista velkaa", () => {
    // Sovittu 150 €:n tuntimaksu keikalla jolla ei ole tuntikertymää: lasku on
    // merkitty tunneiksi, joten se ei saa syödä keltaista velkaa, jota asiakas
    // ei ole vielä maksanut.
    const p = gig({ workerId: "jani", red: 0 });
    p.marks = { "1": { marks: Array.from({ length: 10 }, (_, i) => ({ x: i, y: 0, p: 2 as const })) } } as any;
    const statuses: any = {};
    const washedBy: Record<string, string> = {};
    const offers: any = {};
    for (let i = 0; i < 10; i++) {
      statuses[`1#${i}`] = "pesty";
      washedBy[`1#${i}`] = "jani";
      offers[`1#${i}`] = { status: "locked", priceCents: 3750, version: 1, lockedCents: 3750 };
    }
    p.statuses = statuses;
    p.washedBy = washedBy;
    p.p2 = { enabled: true, workerSharePct: 53, offers, events: [] } as any;

    const invoices = [hoursInvoice({ senderId: "jani", tunnit: 10, ansaittuCents: 150_00 })];
    const [row] = computeWorkerSettlements(p, {
      p2Era: eraSettlementByWorker(invoices, "p2"),
      hoursEra: eraSettlementByWorker(invoices, "hours"),
    });
    expect(row.p2EarnedCents).toBeGreaterThan(0);
    expect(row.openP2Cents).toBe(row.p2EarnedCents);   // keltaiset koskematta
  });
});

describe("tuntipalkka ei koskaan ylitä asiakastuntihintaa", () => {
  it("rajaa väärin kirjatun tuntipalkan asiakashintaan", () => {
    // Tekijän tuntipalkaksi on kirjattu 30 € vaikka asiakas maksaa 26 €.
    // Miinuskate on kirjausvirhe: tekijä saa asiakashinnan, ei enempää —
    // sama sääntö kuin `computeHourlyMoney.rateInverted`issa.
    const p = gig({ workerId: "jani", shifts: [shift("jani", 10)], workerHourCents: 3000 });
    const [row] = computeWorkerSettlements(p);
    expect(row.hourRateCents).toBe(2600);
    expect(row.hoursEarnedCents).toBe(260_00);
  });
});

describe("tuntityö EI ole palkkaa kohdennetulla keikalla", () => {
  it("ei muuta seurantatunteja rahaksi kun keikka ei ole tuntitilassa", () => {
    // Sama työ maksettaisiin kahdesti: kerran ikkunoina, kerran tunteina.
    const p = gig({ workerId: "jani", red: 10, shifts: [shift("jani", 8)] });
    p.billingMode = "targeted";
    const [row] = computeWorkerSettlements(p);
    expect(row.hours).toBe(0);
    expect(row.hoursEarnedCents).toBe(0);
    expect(row.openHoursCents).toBe(0);
    expect(row.openTotalCents).toBe(200_00);   // vain ikkunat
  });

  it("keikka ilman erikseen asetettua tilaa on kohdennettu, ei tuntitila", () => {
    const p = gig({ workerId: "jani", shifts: [shift("jani", 8)] });
    delete (p as { billingMode?: string }).billingMode;
    const [row] = computeWorkerSettlements(p);
    expect(row.hoursEarnedCents).toBe(0);
  });
});

describe("tuntipotti erävalintana", () => {
  it("hyväksyy tuntipotin erävalintana eikä sekoita sitä punaisiin", () => {
    expect(normalizeEraNumbers([9])).toEqual([...HOURS_ERA_NUMBERS]);
    expect(isHoursEraSelection([9])).toBe(true);
    expect(eraScopeOf([9])).toBe("hours");
    expect(eraScopeOf([1, 2, 3])).toBe("p1");
    expect(eraScopeOf([...P2_ERA_NUMBERS])).toBe("p2");
  });

  it("kirjoittaa sentinel-erän auki eikä koskaan näytä 'Erä 9'", () => {
    expect(eraScopeLabel([9])).toBe("Tuntityö");
    expect(eraScopeLabel([0])).toBe("Keltaiset");
    expect(eraScopeLabel([4])).toBe("Erä 4");
    expect(eraScopeLabel([1, 2, 3])).toBe("Erät 1–3");
  });

  it("ei hyväksy mielivaltaisia erävalintoja", () => {
    expect(normalizeEraNumbers([2])).toBeNull();
    expect(normalizeEraNumbers([9, 4])).toBeNull();
  });
});

describe("computeEraBilling — tuntityö laskun rivinä", () => {
  it("laskee tunnit × tuntipalkka omaksi rivikseen", () => {
    const r = computeEraBilling(0, [{
      workerId: "jani", name: "Jani", pestytIkkunat: 0,
      sovittuMuutosCents: 0, ennakkoCents: 0, tunnit: 7.5, tuntihintaCents: 1500,
    }], []);
    const row = r.workers[0];
    expect(row.tunnitCents).toBe(112_50);
    expect(row.ikkunatCents).toBe(0);
    expect(row.ansaittuCents).toBe(112_50);
    expect(row.maksettavaCents).toBe(112_50);
  });

  // Puhtaana laskentana summaus toimii; tallennettu lasku on silti aina yhden
  // virran lasku (server rajaa kentät erävalinnan mukaan), koska maksettavan
  // kohdennus lukee virran erävalinnasta.
  it("ikkunat ja tunnit summautuvat kun molemmat annetaan", () => {
    const r = computeEraBilling(0, [{
      workerId: "jani", name: "Jani", pestytIkkunat: 10,
      sovittuMuutosCents: 0, ennakkoCents: 0, tunnit: 2, tuntihintaCents: 1500,
    }], []);
    const row = r.workers[0];
    expect(row.ikkunatCents).toBe(200_00);
    expect(row.tunnitCents).toBe(30_00);
    expect(row.ansaittuCents).toBe(230_00);
  });

  it("sovittu muutos ja ennakko toimivat yhä tuntirivin kanssa", () => {
    const r = computeEraBilling(0, [{
      workerId: "jani", name: "Jani", pestytIkkunat: 0,
      sovittuMuutosCents: -10_00, ennakkoCents: 20_00, tunnit: 10, tuntihintaCents: 1500,
    }], []);
    const row = r.workers[0];
    expect(row.ansaittuCents).toBe(140_00);      // 150 − 10
    expect(row.maksettavaCents).toBe(120_00);    // − 20 ennakko
  });

  it("ilman tunteja rivi käyttäytyy täsmälleen kuten ennen", () => {
    const r = computeEraBilling(0, [{
      workerId: "jani", name: "Jani", pestytIkkunat: 12, sovittuMuutosCents: 0, ennakkoCents: 0,
    }], []);
    expect(r.workers[0].ansaittuCents).toBe(240_00);
    expect(r.workers[0].tunnit).toBe(0);
    expect(r.workers[0].tunnitCents).toBe(0);
  });
});
