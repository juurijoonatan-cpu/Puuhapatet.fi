import { describe, expect, it } from "vitest";
import { emptyProjectData, checkWindowAttribution, type ProjectData } from "./project";
import { crewMemberStats, type CrewMember } from "./crew";
import {
  computeP2Billing,
  customerAddedKeys,
  emptyP2State,
  isP2Priced,
  p2PendingPriceCents,
  p2Transition,
  p2WorkerPayoutCents,
  pointPriority,
  pushP2Event,
  sanitizeP2State,
  MAX_P2_PRICE_CENTS,
  MAX_P2_WISH_NOTE,
  type P2Offer,
} from "./p2";

// ─── Fixtures ──────────────────────────────────────────────────────────────────

/** Map with 2 red + 3 yellow seeded windows and 1 yellow custom mark. */
function fixture(): ProjectData {
  const data = emptyProjectData();
  data.marks = {
    K: {
      marks: [
        { p: 1, x: 0, y: 0 },  // K#0 red
        { p: 1, x: 1, y: 0 },  // K#1 red
        { p: 2, x: 2, y: 0 },  // K#2 yellow
        { p: 2, x: 3, y: 0 },  // K#3 yellow
        { p: 2, x: 4, y: 0 },  // K#4 yellow
      ],
    },
  };
  data.customMarks = { "1": [{ key: "1#cabc", p: 2, x: 5, y: 5 }] };
  return data;
}

function proposedOffer(priceCents = 3000, version = 1): P2Offer {
  return { status: "proposed", priceCents, version, updatedAt: 1 };
}

// ─── State machine ─────────────────────────────────────────────────────────────

describe("p2Transition — tilakone", () => {
  it("propose luo uuden ehdotuksen ja korottaa versiota", () => {
    const r = p2Transition(undefined, "propose", { who: "admin", id: "joonatan" }, { priceCents: 3000 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.offer.status).toBe("proposed");
      expect(r.offer.priceCents).toBe(3000);
      expect(r.offer.version).toBe(1);
    }
  });

  it("propose hylkää virheelliset hinnat", () => {
    for (const bad of [0, -5, 1.5, MAX_P2_PRICE_CENTS + 1, NaN]) {
      const r = p2Transition(undefined, "propose", { who: "admin" }, { priceCents: bad });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe(400);
    }
  });

  it("propose ei voi yliajaa lukittua hintaa", () => {
    const locked: P2Offer = { status: "locked", priceCents: 3000, lockedCents: 3000, version: 2, updatedAt: 1 };
    const r = p2Transition(locked, "propose", { who: "admin" }, { priceCents: 5000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(409);
  });

  it("asiakas ei voi käyttää admin-toimintoja ja päinvastoin", () => {
    const r1 = p2Transition(undefined, "propose", { who: "customer" }, { priceCents: 3000 });
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.code).toBe(403);
    const r2 = p2Transition(proposedOffer(), "accept", { who: "admin" }, { priceCents: 3000, version: 1 });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe(403);
  });

  it("accept lukitsee hinnan kun versio ja hinta täsmäävät", () => {
    const r = p2Transition(proposedOffer(3000, 1), "accept", { who: "customer" }, { priceCents: 3000, version: 1 }, 123);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.offer.status).toBe("locked");
      expect(r.offer.lockedCents).toBe(3000);
      expect(r.offer.lockedBy).toBe("customer");
      expect(r.offer.lockedAt).toBe(123);
      expect(r.offer.version).toBe(2);
    }
  });

  it("accept palauttaa 409 kun versio TAI hinta ei täsmää (anti-race)", () => {
    const stale = p2Transition(proposedOffer(3000, 2), "accept", { who: "customer" }, { priceCents: 3000, version: 1 });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.code).toBe(409);
    const wrongPrice = p2Transition(proposedOffer(3000, 1), "accept", { who: "customer" }, { priceCents: 2500, version: 1 });
    expect(wrongPrice.ok).toBe(false);
    if (!wrongPrice.ok) expect(wrongPrice.code).toBe(409);
  });

  it("counter → accept_counter lukitsee vastatarjouksen hintaan", () => {
    const c = p2Transition(proposedOffer(3000, 1), "counter", { who: "customer" }, { priceCents: 2500, version: 1 });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.offer.status).toBe("countered");
    expect(c.offer.counterCents).toBe(2500);
    expect(c.offer.version).toBe(2);

    const a = p2Transition(c.offer, "accept_counter", { who: "admin", id: "matias" }, { priceCents: 2500, version: 2 });
    expect(a.ok).toBe(true);
    if (a.ok) {
      expect(a.offer.status).toBe("locked");
      expect(a.offer.lockedCents).toBe(2500);
      expect(a.offer.priceCents).toBe(2500);
      expect(a.offer.lockedBy).toBe("admin");
    }
  });

  it("accept_counter vaatii täsmälleen nähdyn vastatarjouksen", () => {
    const countered: P2Offer = { status: "countered", priceCents: 3000, counterCents: 2500, version: 2, updatedAt: 1 };
    const r = p2Transition(countered, "accept_counter", { who: "admin" }, { priceCents: 2400, version: 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(409);
  });

  it("admin voi vastata counteriin uudella proposella (hylkää counterin)", () => {
    const countered: P2Offer = { status: "countered", priceCents: 3000, counterCents: 2500, version: 2, updatedAt: 1 };
    const r = p2Transition(countered, "propose", { who: "admin" }, { priceCents: 2800 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.offer.status).toBe("proposed");
      expect(r.offer.priceCents).toBe(2800);
      expect(r.offer.counterCents).toBeUndefined();
      expect(r.offer.version).toBe(3);
    }
  });

  it("decline ja cancel siirtävät declined-tilaan; declined → uusi propose ok", () => {
    const d = p2Transition(proposedOffer(3000, 1), "decline", { who: "customer" }, { version: 1 });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.offer.status).toBe("declined");

    const re = p2Transition(d.offer, "propose", { who: "admin" }, { priceCents: 2000 });
    expect(re.ok).toBe(true);
    if (re.ok) expect(re.offer.status).toBe("proposed");

    const c = p2Transition(proposedOffer(3000, 1), "cancel", { who: "admin" }, {});
    expect(c.ok).toBe(true);
    if (c.ok) expect(c.offer.status).toBe("declined");
  });

  it("unlock palauttaa proposed-tilaan ja säilyttää hinnan", () => {
    const locked: P2Offer = { status: "locked", priceCents: 3000, lockedCents: 3000, lockedBy: "customer", version: 2, updatedAt: 1 };
    const r = p2Transition(locked, "unlock", { who: "admin" }, {});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.offer.status).toBe("proposed");
      expect(r.offer.priceCents).toBe(3000);
      expect(r.offer.lockedCents).toBeUndefined();
      expect(r.offer.version).toBe(3);
    }
  });

  it("asiakas ei voi koskea lukittuun hintaan", () => {
    const locked: P2Offer = { status: "locked", priceCents: 3000, lockedCents: 3000, version: 2, updatedAt: 1 };
    for (const action of ["accept", "counter", "decline"] as const) {
      const r = p2Transition(locked, action, { who: "customer" }, { priceCents: 3000, version: 2 });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe(409);
    }
  });
});

// ─── Point helpers ─────────────────────────────────────────────────────────────

describe("pointPriority / isP2Priced", () => {
  it("resolvaa prioriteetin kartasta (seeded + custom), ei koskaan clientiltä", () => {
    const data = fixture();
    expect(pointPriority(data, "K#0")).toBe(1);
    expect(pointPriority(data, "K#2")).toBe(2);
    expect(pointPriority(data, "1#cabc")).toBe(2);
    expect(pointPriority(data, "K#99")).toBe(null);
    expect(pointPriority(data, "olematon")).toBe(null);
  });

  it("poistettu piste → null", () => {
    const data = fixture();
    data.deleted["K#2"] = true;
    expect(pointPriority(data, "K#2")).toBe(null);
  });

  it("isP2Priced vain kun vaihe päällä JA hinta lukittu (ei enää pesuportti)", () => {
    const data = fixture();
    expect(isP2Priced(data, "K#2")).toBe(false); // ei p2:ta
    data.p2 = emptyP2State();
    data.p2.offers["K#2"] = { status: "locked", priceCents: 3000, lockedCents: 3000, version: 2, updatedAt: 1 };
    expect(isP2Priced(data, "K#2")).toBe(false); // vaihe pois päältä
    data.p2.enabled = true;
    expect(isP2Priced(data, "K#2")).toBe(true);
    data.p2.offers["K#3"] = proposedOffer();
    expect(isP2Priced(data, "K#3")).toBe(false); // vain ehdotettu
  });

  it("p2PendingPriceCents: vastatarjous voittaa ehdotuksen, vain lukittu → null", () => {
    expect(p2PendingPriceCents(undefined)).toBe(null);
    expect(p2PendingPriceCents(proposedOffer(4000))).toBe(4000);
    expect(p2PendingPriceCents({ status: "countered", priceCents: 4000, counterCents: 2500, version: 2, updatedAt: 1 })).toBe(2500);
    // Lukittu ei enää odota mitään — se on sovittu.
    expect(p2PendingPriceCents({ status: "locked", priceCents: 3000, lockedCents: 3000, version: 2, updatedAt: 1 })).toBe(null);
    // HYLÄTTY ODOTTAA YHÄ: asiakas voi hyväksyä sen suoraan omasta
    // näkymästään, joten hinta on edelleen tulossa eikä nolla.
    expect(p2PendingPriceCents({ status: "declined", priceCents: 3000, version: 2, updatedAt: 1 })).toBe(3000);
  });
});

// ─── Money ─────────────────────────────────────────────────────────────────────

describe("computeP2Billing", () => {
  it("palauttaa nollat kun p2 puuttuu (vanha keikka ennallaan)", () => {
    const b = computeP2Billing(fixture());
    expect(b.yellowTotal).toBe(4);
    expect(b.lockedSumCents).toBe(0);
    expect(b.earnedCents).toBe(0);
    expect(b.washedUnlockedKeys).toEqual([]);
  });

  it("laskee lukitut, pestyt ja katteen; poistetut pisteet putoavat pois", () => {
    const data = fixture();
    data.p2 = emptyP2State();
    data.p2.enabled = true;
    data.p2.workerSharePct = 50;
    data.p2.offers["K#2"] = { status: "locked", priceCents: 3000, lockedCents: 3000, version: 2, updatedAt: 1 };
    data.p2.offers["K#3"] = { status: "locked", priceCents: 2000, lockedCents: 2000, version: 2, updatedAt: 1 };
    data.p2.offers["K#4"] = proposedOffer(4000);
    data.p2.offers["1#cabc"] = { status: "countered", priceCents: 3000, counterCents: 2500, version: 2, updatedAt: 1 };
    data.statuses["K#2"] = "pesty";
    data.washedBy["K#2"] = "jani";

    let b = computeP2Billing(data);
    expect(b.yellowTotal).toBe(4);
    expect(b.pricedCount).toBe(4);
    expect(b.proposedCount).toBe(1);
    expect(b.counteredCount).toBe(1);
    expect(b.lockedCount).toBe(2);
    expect(b.lockedSumCents).toBe(5000);
    expect(b.lockedWashedCount).toBe(1);
    expect(b.earnedCents).toBe(3000);
    expect(b.remainingLockedCents).toBe(2000);
    // 30 € on alle alimman ankkurin (34 € → 18 €), joten se maksetaan sen
    // omalla osuudella 18/34 = 52,9 %. Ennen tämä oli tasainen 50 %; ks.
    // shared/p2-payout.test.ts siitä miksi tasaprosentti piti korvata.
    expect(b.workerCostCents).toBe(1588);   // 30 € × 18/34
    expect(b.marginCents).toBe(1412);       // 3000 − 1588

    data.deleted["K#3"] = true; // poistettu lukittu piste putoaa summasta
    b = computeP2Billing(data);
    expect(b.lockedCount).toBe(1);
    expect(b.lockedSumCents).toBe(3000);
  });

  it("pesty keltainen ILMAN hintaa = hinnoittelematon (perustajan tehtävälista)", () => {
    const data = fixture();
    data.p2 = emptyP2State();
    data.statuses["K#4"] = "pesty";
    data.washedBy["K#4"] = "jani";
    const b = computeP2Billing(data);
    expect(b.washedUnlockedKeys).toEqual(["K#4"]);
    expect(b.unpricedWashedCount).toBe(1);
    expect(b.pendingWashedCount).toBe(0);
    expect(b.earnedCents).toBe(0);
  });

  it("pesty keltainen jolla hinta ODOTTAA asiakkaan hyväksyntää ei katoa", () => {
    // Tekijä pesi ikkunan ennen kuin Niilo hyväksyi hinnan: työ on tehty, joten
    // se näkyy odottavana — mutta ei laskutettavana eikä maksettavana.
    const data = fixture();
    data.p2 = emptyP2State();
    data.p2.enabled = true;
    data.p2.workerSharePct = 50;
    data.p2.offers["K#4"] = proposedOffer(4000);
    data.p2.offers["1#cabc"] = { status: "countered", priceCents: 4000, counterCents: 3000, version: 2, updatedAt: 1 };
    data.statuses["K#4"] = "pesty";
    data.washedBy["K#4"] = "jani";
    data.statuses["1#cabc"] = "pesty";
    data.washedBy["1#cabc"] = "jani";

    const b = computeP2Billing(data);
    expect(b.pendingWashedCount).toBe(2);
    expect(b.pendingEarnedCents).toBe(7000);        // 4000 ehdotus + 3000 vastatarjous
    expect(b.pendingWorkerCostCents).toBe(3728);    // 40 € → 21,40 € + 30 € → 15,88 €
    expect(b.unpricedWashedCount).toBe(0);
    // EI mukana varmoissa luvuissa.
    expect(b.earnedCents).toBe(0);
    expect(b.workerCostCents).toBe(0);
    expect(b.lockedWashedCount).toBe(0);
  });
});

describe("p2WorkerPayoutCents", () => {
  it("taulukon ulkopuolinen hinta kulkee käyrällä, ei tasaprosentilla", () => {
    // MUUTTUNUT TAHALLAAN. Ennen kaikki taulukon ulkopuolinen maksettiin
    // tasaprosentilla, jolloin palkkio putosi heti ankkurin jälkeen
    // (37,51 € maksoi vähemmän kuin 37,50 €). Nyt palkkio kulkee suoraan
    // ankkurista ankkuriin; alle alimman ankkurin käytetään sen omaa osuutta
    // (18/34), jolloin käyrä on jatkuva myös reunalla. Ks. p2-payout.test.ts.
    expect(p2WorkerPayoutCents(3000, 53)).toBe(1588);   // 30 € × 18/34
    expect(p2WorkerPayoutCents(2500, 53)).toBe(1324);   // 25 € × 18/34
    // Osuus ei enää ohjaa mitään kun palkkiotaulukko on olemassa — taulukko on
    // sovittu, prosentti oli vain sen puuttuva täyte.
    expect(p2WorkerPayoutCents(3000, 0)).toBe(1588);
    expect(p2WorkerPayoutCents(3000, 200)).toBe(1588);
  });

  it("ILMAN taulukkoa osuus yhä ohjaa ja clampataan 1..100", () => {
    expect(p2WorkerPayoutCents(3000, 53, [])).toBe(1590);
    expect(p2WorkerPayoutCents(3000, 0, [])).toBe(30);     // clamp → 1 %
    expect(p2WorkerPayoutCents(3000, 200, [])).toBe(3000); // clamp → 100 %
  });

  it("oletustaulukko: 34 € → 18 €, 37,50 € → 20 €, 50 € → 27 € (osuudesta riippumatta)", () => {
    expect(p2WorkerPayoutCents(3400, 53)).toBe(1800);
    expect(p2WorkerPayoutCents(3750, 53)).toBe(2000);
    expect(p2WorkerPayoutCents(5000, 53)).toBe(2700);
    // Osuus ei vaikuta taulukkohintoihin.
    expect(p2WorkerPayoutCents(3400, 90)).toBe(1800);
    expect(p2WorkerPayoutCents(3750, 10)).toBe(2000);
  });

  it("eksplisiittinen taulukko voittaa; muut hinnat kulkevat sen osuudella", () => {
    const sched = [{ priceCents: 5000, payoutCents: 2500 }];
    expect(p2WorkerPayoutCents(5000, 53, sched)).toBe(2500);   // ankkuri
    // Yhden ankkurin taulukko on käytännössä osuus (2500/5000 = 50 %), ja se
    // pätee myös ankkurin ulkopuolella — muuten palkkio hyppäisi ankkurissa.
    expect(p2WorkerPayoutCents(3400, 53, sched)).toBe(1700);
  });
});

// ─── crewMemberStats — P2-tietoinen palkkio ───────────────────────────────────

function crewMember(id: string): CrewMember {
  return {
    id, token: `tok_${id}`, name: id, role: "worker",
    perWindowCents: 2000, active: true, agreements: [], notes: [], createdAt: 1,
  };
}

describe("crewMemberStats — P2", () => {
  it("ILMAN p2:ta: kaikki pestyt maksavat perWindowCents (vanha käytös sentilleen)", () => {
    const data = fixture();
    data.statuses["K#0"] = "pesty"; data.washedBy["K#0"] = "jani";  // punainen
    data.statuses["K#2"] = "pesty"; data.washedBy["K#2"] = "jani";  // keltainen (legacy)
    const s = crewMemberStats(data, crewMember("jani"));
    expect(s.washed).toBe(2);
    expect(s.earnedCents).toBe(4000); // 2 × 2000
    expect(s.p2EarnedCents ?? 0).toBe(0);
  });

  it("VALMISTELUVAIHE (p2 alustettu, ei päällä): käytös täsmälleen kuin ilman p2:ta", () => {
    const data = fixture();
    data.p2 = emptyP2State(); // enabled = false — hinnoittelua valmistellaan
    data.p2.offers["K#2"] = { status: "locked", priceCents: 3000, lockedCents: 3000, version: 2, updatedAt: 1 };
    data.statuses["K#0"] = "pesty"; data.washedBy["K#0"] = "jani";  // punainen
    data.statuses["K#2"] = "pesty"; data.washedBy["K#2"] = "jani";  // keltainen
    const s = crewMemberStats(data, crewMember("jani"));
    expect(s.washed).toBe(2);
    expect(s.earnedCents).toBe(4000); // 2 × 2000 — kuten ennen P2:ta
    expect(s.p2EarnedCents).toBe(0);
  });

  it("p2:lla: punainen maksaa oman taksan, lukittu keltainen palkkiotaulukon mukaan, lukitsematon 0", () => {
    const data = fixture();
    data.p2 = emptyP2State();
    data.p2.enabled = true;
    data.p2.workerSharePct = 50;
    data.p2.offers["K#2"] = { status: "locked", priceCents: 3000, lockedCents: 3000, version: 2, updatedAt: 1 };
    data.statuses["K#0"] = "pesty"; data.washedBy["K#0"] = "jani";  // punainen → 2000
    data.statuses["K#2"] = "pesty"; data.washedBy["K#2"] = "jani";  // lukittu keltainen → 1588
    data.statuses["K#3"] = "pesty"; data.washedBy["K#3"] = "jani";  // lukitsematon keltainen → 0

    const s = crewMemberStats(data, crewMember("jani"));
    expect(s.washed).toBe(3);                 // LUKUMÄÄRÄ laskee kaikki pestyt
    expect(s.earnedCents).toBe(3588);         // 2000 punainen + 1588 keltainen + 0
    expect(s.p2EarnedCents).toBe(1588);   // 30 € × 18/34

    // Attribuutiotäsmäytys vertailee kappaleita — pysyy täsmäävänä.
    const check = checkWindowAttribution(data);
    expect(check.matches).toBe(true);
  });

  it("jaettu lukittu keltainen (washedBy2) jakaa P2-palkkion 50/50", () => {
    const data = fixture();
    data.p2 = emptyP2State();
    data.p2.enabled = true;
    data.p2.workerSharePct = 50;
    data.p2.offers["K#2"] = { status: "locked", priceCents: 3000, lockedCents: 3000, version: 2, updatedAt: 1 };
    data.statuses["K#2"] = "pesty";
    data.washedBy["K#2"] = "jani";
    data.washedBy2!["K#2"] = "milja";

    const jani = crewMemberStats(data, crewMember("jani"));
    const milja = crewMemberStats(data, crewMember("milja"));
    expect(jani.washed).toBe(0.5);
    expect(milja.washed).toBe(0.5);
    expect(jani.earnedCents).toBe(794);   // 0,5 × 1588
    expect(milja.earnedCents).toBe(794);
    expect(checkWindowAttribution(data).matches).toBe(true);
  });
});

// ─── Sanitisation ──────────────────────────────────────────────────────────────

describe("customerAddedKeys", () => {
  it("palauttaa asiakkaan lisäämät elossa olevat pisteet; poisto kumoaa lisäyksen", () => {
    const data = fixture();
    data.p2 = emptyP2State();
    // add A, add B, remove A → vain B jää
    pushP2Event(data.p2.events, { ts: 1, key: "1#ca", action: "add_point", actor: "customer", version: 0 });
    pushP2Event(data.p2.events, { ts: 2, key: "1#cb", action: "add_point", actor: "customer", version: 0 });
    pushP2Event(data.p2.events, { ts: 3, key: "1#ca", action: "remove_point", actor: "customer", version: 0 });
    expect(customerAddedKeys(data).sort()).toEqual(["1#cb"]);
    // adminin lisäämä piste ei ole "asiakkaan lisäämä"
    pushP2Event(data.p2.events, { ts: 4, key: "1#cx", action: "add_point", actor: "joonatan", version: 0 });
    expect(customerAddedKeys(data)).toEqual(["1#cb"]);
    // deleted-merkki pudottaa pois vaikka lisäystapahtuma olisi
    data.deleted["1#cb"] = true;
    expect(customerAddedKeys(data)).toEqual([]);
  });

  it("ilman p2:ta → tyhjä", () => {
    expect(customerAddedKeys(fixture())).toEqual([]);
  });
});

describe("sanitizeP2State", () => {
  it("puuttuva/ei-objekti → undefined (vanhat keikat round-trippaavat identtisesti)", () => {
    expect(sanitizeP2State(undefined)).toBeUndefined();
    expect(sanitizeP2State(null)).toBeUndefined();
    expect(sanitizeP2State("x")).toBeUndefined();
  });

  it("clampaa hinnat, pudottaa roskan ja korjaa korruptoituneen lukon", () => {
    const s = sanitizeP2State({
      enabled: true,
      workerSharePct: 500,
      offers: {
        ok: { status: "proposed", priceCents: 3000, version: 3 },
        tooBig: { status: "proposed", priceCents: MAX_P2_PRICE_CENTS + 1, version: 1 },
        zero: { status: "proposed", priceCents: 0, version: 1 },
        badLock: { status: "locked", priceCents: 3000, version: 2 }, // ei lockedCents
      },
      events: [{ action: "accept", key: "ok", version: 2, ts: 5 }, { action: "hax", key: "x" }],
      terms: { acceptorName: "  Testi Oy  ", acceptedAt: 9 },
    });
    expect(s).toBeDefined();
    expect(s!.enabled).toBe(true);
    expect(s!.workerSharePct).toBe(53); // epäkelpo → default
    expect(Object.keys(s!.offers).sort()).toEqual(["badLock", "ok"]);
    expect(s!.offers.ok.priceCents).toBe(3000);
    expect(s!.offers.badLock.status).toBe("proposed"); // korruptoitunut lukko avattu
    expect(s!.events).toHaveLength(1);
    expect(s!.terms?.acceptorName).toBe("Testi Oy");
  });

  it("payoutSchedule: pitää kelvolliset, pudottaa roskan, dedupaa ja järjestää", () => {
    const s = sanitizeP2State({
      enabled: true,
      offers: {},
      payoutSchedule: [
        { priceCents: 3750, payoutCents: 2000 },
        { priceCents: 3400, payoutCents: 1800 },
        { priceCents: 3400, payoutCents: 9999 },     // duplikaatti hinta → pudotetaan
        { priceCents: 0, payoutCents: 100 },          // virheellinen hinta
        { priceCents: 5000, payoutCents: -5 },        // negatiivinen palkkio
        { priceCents: MAX_P2_PRICE_CENTS + 1, payoutCents: 10 },
      ],
    });
    expect(s!.payoutSchedule).toEqual([
      { priceCents: 3400, payoutCents: 1800 },
      { priceCents: 3750, payoutCents: 2000 },
    ]);
  });

  it("payoutSchedule tyhjä/puuttuva → undefined (käytetään oletustaulukkoa)", () => {
    expect(sanitizeP2State({ enabled: true, offers: {} })!.payoutSchedule).toBeUndefined();
    expect(sanitizeP2State({ enabled: true, offers: {}, payoutSchedule: [] })!.payoutSchedule).toBeUndefined();
  });
});

// ─── Asiakkaan toive (hinta-arvio + viesti) ───────────────────────────────────

describe("sanitizeP2State — asiakkaan toiveet", () => {
  /**
   * Toive on SAATE, ei tarjous: se ei sido kumpaakaan eikä saa vuotaa
   * yhteenkään summaan. Sanitointi on ainoa paikka joka estää rikkinäistä
   * clienttiä kirjoittamasta karttablobiin mitä tahansa.
   */
  const wish = (wishes: unknown) => sanitizeP2State({ enabled: true, offers: {}, events: [], wishes })!.wishes;

  it("hinta-arvio ja viesti säilyvät", () => {
    expect(wish({ "1#c1": { cents: 3600, note: "Iso ikkuna ruokalan takana", ts: 5 } }))
      .toEqual({ "1#c1": { cents: 3600, note: "Iso ikkuna ruokalan takana", ts: 5 } });
  });

  it("pelkkä viesti tai pelkkä hinta riittää — molemmat ovat vapaaehtoisia", () => {
    expect(wish({ a: { note: "vain viesti" } })!.a).toMatchObject({ note: "vain viesti", cents: undefined });
    expect(wish({ a: { cents: 3000 } })!.a).toMatchObject({ cents: 3000, note: undefined });
  });

  it("TYHJÄ toive ei ansaitse riviä", () => {
    // Muuten jokainen ohitettu lomake jättäisi jälkeensä tyhjän merkinnän.
    expect(wish({ a: { cents: 0, note: "   " } })).toBeUndefined();
    expect(wish({})).toBeUndefined();
  });

  it("mahdoton hinta pudotetaan, viesti jää", () => {
    expect(wish({ a: { cents: -5, note: "silti" } })!.a).toMatchObject({ cents: undefined, note: "silti" });
    expect(wish({ a: { cents: MAX_P2_PRICE_CENTS + 1, note: "silti" } })!.a.cents).toBeUndefined();
    expect(wish({ a: { cents: MAX_P2_PRICE_CENTS, note: "x" } })!.a.cents).toBe(MAX_P2_PRICE_CENTS);
  });

  it("liian pitkä viesti katkaistaan eikä blobi kasva rajatta", () => {
    const long = "x".repeat(5000);
    expect(wish({ a: { note: long } })!.a.note!.length).toBe(MAX_P2_WISH_NOTE);
  });

  it("roskasyöte ei kaada sanitointia", () => {
    expect(wish(null)).toBeUndefined();
    expect(wish("ei objekti")).toBeUndefined();
    expect(wish({ a: null, b: { note: "ok" } })).toEqual({ b: { cents: undefined, note: "ok", ts: expect.any(Number) } });
  });

  it("toive EI ole tarjous — se ei näy yhdessäkään summassa", () => {
    // Tämä on koko asian ydin. Jos toive vuotaisi laskentaan, asiakkaan
    // arvaus muuttuisi rahaksi ilman että kukaan sopi mitään.
    const data = fixture();
    data.p2 = sanitizeP2State({
      enabled: true, offers: {}, events: [],
      wishes: { "K#2": { cents: 9900, note: "maksan mitä vaan" } },
    })!;
    data.statuses["K#2"] = "pesty";
    const b = computeP2Billing(data);
    expect(b.lockedSumCents).toBe(0);
    expect(b.earnedCents).toBe(0);
    expect(b.pendingEarnedCents).toBe(0);
    // Pesty se kyllä on — työ on tehty, hintaa vain ei ole.
    expect(b.washedTotal).toBe(1);
    expect(b.unpricedWashedCount).toBe(1);
  });
});
