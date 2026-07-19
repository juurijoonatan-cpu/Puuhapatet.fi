import { describe, expect, it } from "vitest";
import { emptyProjectData, checkWindowAttribution, type ProjectData } from "./project";
import { crewMemberStats, type CrewMember } from "./crew";
import {
  computeP2Billing,
  emptyP2State,
  isP2Washable,
  p2Transition,
  p2WorkerPayoutCents,
  pointPriority,
  sanitizeP2State,
  MAX_P2_PRICE_CENTS,
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

describe("pointPriority / isP2Washable", () => {
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

  it("isP2Washable vain kun vaihe päällä JA hinta lukittu", () => {
    const data = fixture();
    expect(isP2Washable(data, "K#2")).toBe(false); // ei p2:ta
    data.p2 = emptyP2State();
    data.p2.offers["K#2"] = { status: "locked", priceCents: 3000, lockedCents: 3000, version: 2, updatedAt: 1 };
    expect(isP2Washable(data, "K#2")).toBe(false); // vaihe pois päältä
    data.p2.enabled = true;
    expect(isP2Washable(data, "K#2")).toBe(true);
    data.p2.offers["K#3"] = proposedOffer();
    expect(isP2Washable(data, "K#3")).toBe(false); // vain ehdotettu
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
    expect(b.workerCostCents).toBe(1500);   // 50 % × 3000
    expect(b.marginCents).toBe(1500);

    data.deleted["K#3"] = true; // poistettu lukittu piste putoaa summasta
    b = computeP2Billing(data);
    expect(b.lockedCount).toBe(1);
    expect(b.lockedSumCents).toBe(3000);
  });

  it("pesty keltainen ILMAN lukkoa listataan anomaliana", () => {
    const data = fixture();
    data.p2 = emptyP2State();
    data.statuses["K#4"] = "pesty";
    data.washedBy["K#4"] = "jani";
    const b = computeP2Billing(data);
    expect(b.washedUnlockedKeys).toEqual(["K#4"]);
    expect(b.earnedCents).toBe(0);
  });
});

describe("p2WorkerPayoutCents", () => {
  it("pyöristää senttiin ja clampaa osuuden 1..100", () => {
    expect(p2WorkerPayoutCents(3000, 53)).toBe(1590);
    expect(p2WorkerPayoutCents(2500, 53)).toBe(1325);
    expect(p2WorkerPayoutCents(3000, 0)).toBe(30);     // clamp → 1 %
    expect(p2WorkerPayoutCents(3000, 200)).toBe(3000); // clamp → 100 %
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

  it("p2:lla: punainen maksaa oman taksan, lukittu keltainen %-osuuden hinnasta, lukitsematon 0", () => {
    const data = fixture();
    data.p2 = emptyP2State();
    data.p2.enabled = true;
    data.p2.workerSharePct = 50;
    data.p2.offers["K#2"] = { status: "locked", priceCents: 3000, lockedCents: 3000, version: 2, updatedAt: 1 };
    data.statuses["K#0"] = "pesty"; data.washedBy["K#0"] = "jani";  // punainen → 2000
    data.statuses["K#2"] = "pesty"; data.washedBy["K#2"] = "jani";  // lukittu keltainen → 1500
    data.statuses["K#3"] = "pesty"; data.washedBy["K#3"] = "jani";  // lukitsematon keltainen → 0

    const s = crewMemberStats(data, crewMember("jani"));
    expect(s.washed).toBe(3);                 // LUKUMÄÄRÄ laskee kaikki pestyt
    expect(s.earnedCents).toBe(3500);         // 2000 + 1500 + 0
    expect(s.p2EarnedCents).toBe(1500);

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
    expect(jani.earnedCents).toBe(750);   // 0.5 × 1500
    expect(milja.earnedCents).toBe(750);
    expect(checkWindowAttribution(data).matches).toBe(true);
  });
});

// ─── Sanitisation ──────────────────────────────────────────────────────────────

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
});
