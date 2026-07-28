import { describe, expect, it } from "vitest";
import { emptyProjectData, type ProjectData } from "./project";
import { emptyP2State, type P2Offer } from "./p2";
import {
  computeGuided,
  isGuidedBlocked,
  sanitizeGuidedWork,
  emptyGuidedWork,
} from "./guided";

// ─── Fixtures ──────────────────────────────────────────────────────────────────

/**
 * 3 floors:
 *   K: K#0 red (y10), K#1 red (y5), K#2 yellow (y20)
 *   1: 1#0 red,      1#1 yellow
 *   2: 2#0 red
 * A yellow is in scope ONLY when its price is locked (p2 enabled). By default no
 * offers exist, so the yellows are out of scope until a test locks them.
 */
function fixture(): ProjectData {
  const data = emptyProjectData();
  data.building.floors = ["K", "1", "2"];
  data.marks = {
    K: {
      marks: [
        { p: 1, x: 0, y: 10 }, // K#0 red
        { p: 1, x: 0, y: 5 },  // K#1 red (higher up)
        { p: 2, x: 0, y: 20 }, // K#2 yellow
      ],
    },
    "1": {
      marks: [
        { p: 1, x: 0, y: 0 },  // 1#0 red
        { p: 2, x: 0, y: 1 },  // 1#1 yellow
      ],
    },
    "2": {
      marks: [
        { p: 1, x: 0, y: 0 },  // 2#0 red
      ],
    },
  };
  return data;
}

function lockYellow(data: ProjectData, key: string, priceCents = 3000): void {
  if (!data.p2) data.p2 = { ...emptyP2State(), enabled: true };
  data.p2.enabled = true;
  const offer: P2Offer = {
    status: "locked",
    priceCents,
    lockedCents: priceCents,
    lockedAt: 1,
    lockedBy: "customer",
    version: 2,
    updatedAt: 1,
  };
  data.p2.offers[key] = offer;
}

function enable(data: ProjectData, override: string | null = null): ProjectData {
  data.guided = { enabled: true, activeFloorOverride: override };
  return data;
}

function wash(data: ProjectData, key: string): void {
  data.statuses[key] = "pesty";
}

/** Wash a window AND append a pesty log entry (so it can serve as the
 *  nearest-neighbor anchor). ts orders the log (newest-first). */
function washLogged(data: ProjectData, key: string, ts: number): void {
  data.statuses[key] = "pesty";
  const floor = key.split("#")[0];
  data.log.unshift({ floor, key, p: 1, status: "pesty", ts });
}

// ─── Disabled / absent ──────────────────────────────────────────────────────────

describe("computeGuided — pois päältä", () => {
  it("guided puuttuu → disabloitu tila, mikään ei lukossa", () => {
    const g = computeGuided(fixture());
    expect(g.enabled).toBe(false);
    expect(g.activeFloor).toBeNull();
    expect(g.lockedFloors).toEqual([]);
    expect(g.nextKey).toBeNull();
    expect(g.openKeys).toEqual([]);
  });

  it("isGuidedBlocked on aina false kun guided ei ole päällä", () => {
    const data = fixture();
    expect(isGuidedBlocked(data, "2#0")).toBe(false);
    data.guided = { enabled: false };
    expect(isGuidedBlocked(data, "2#0")).toBe(false);
  });
});

// ─── Active floor selection ───────────────────────────────────────────────────

describe("computeGuided — aktiivinen kerros", () => {
  it("aktiivinen kerros = ensimmäinen kesken oleva rakennusjärjestyksessä", () => {
    const g = computeGuided(enable(fixture()));
    expect(g.activeFloor).toBe("K");
    // Later floors with in-scope work are locked; K is active (not locked).
    expect(g.lockedFloors).toEqual(["1", "2"]);
  });

  it("aktiivinen kerros etenee kun kerros valmistuu", () => {
    const data = enable(fixture());
    // Wash the whole of K's in-scope set (2 reds; the yellow is out of scope).
    wash(data, "K#0");
    wash(data, "K#1");
    const g = computeGuided(data);
    expect(g.activeFloor).toBe("1");
    expect(g.lockedFloors).toEqual(["2"]);
  });

  it("lukittu keltainen tulee mukaan työn piiriin ja voi pitää kerroksen auki", () => {
    const data = enable(fixture());
    wash(data, "K#0");
    wash(data, "K#1");
    // K#2 yellow now locked → K regains in-scope work → K is active again.
    lockYellow(data, "K#2");
    const g = computeGuided(data);
    expect(g.activeFloor).toBe("K");
    expect(g.floorProgress.find((f) => f.floor === "K")!.remaining).toBe(1);
  });

  it("kaikki pesty → allComplete, ei aktiivista kerrosta", () => {
    const data = enable(fixture());
    wash(data, "K#0");
    wash(data, "K#1");
    wash(data, "1#0");
    wash(data, "2#0");
    const g = computeGuided(data);
    expect(g.allComplete).toBe(true);
    expect(g.activeFloor).toBeNull();
    expect(g.nextKey).toBeNull();
    expect(g.lockedFloors).toEqual([]);
  });
});

// ─── In-scope: red always, yellow only when locked ────────────────────────────

describe("computeGuided — työn piiri", () => {
  it("punaiset aina piirissä, keltaiset vain lukittuna", () => {
    const data = enable(fixture());
    const g = computeGuided(data);
    // K in scope = 2 reds only (yellow K#2 not locked).
    const k = g.floorProgress.find((f) => f.floor === "K")!;
    expect(k.inScope).toBe(2);
    lockYellow(data, "K#2");
    const g2 = computeGuided(data);
    expect(g2.floorProgress.find((f) => f.floor === "K")!.inScope).toBe(3);
  });

  it("totalInScope laskee vain punaiset + lukitut keltaiset", () => {
    const data = enable(fixture());
    // 4 reds total (K#0,K#1,1#0,2#0); yellows out of scope.
    expect(computeGuided(data).totalInScope).toBe(4);
    lockYellow(data, "1#1");
    expect(computeGuided(data).totalInScope).toBe(5);
  });
});

// ─── Next-window guidance ─────────────────────────────────────────────────────

describe("computeGuided — seuraava ikkuna", () => {
  it("nextKey = ylimpänä oleva pesemätön aktiivisella kerroksella (y-järjestys)", () => {
    const g = computeGuided(enable(fixture()));
    // K#1 (y5) is higher than K#0 (y10) → guided first.
    expect(g.activeFloor).toBe("K");
    expect(g.nextKey).toBe("K#1");
    expect(g.next?.floor).toBe("K");
  });

  it("kesken-tila menee jonon kärkeen (ei jätetä kesken olevaa)", () => {
    const data = enable(fixture());
    data.statuses["K#0"] = "kesken"; // lower (y10) but started → should come first
    const g = computeGuided(data);
    expect(g.nextKey).toBe("K#0");
  });

  it("openKeys sisältää vain aktiivisen kerroksen pesemättömät piirissä olevat", () => {
    const g = computeGuided(enable(fixture()));
    expect(g.openKeys.sort()).toEqual(["K#0", "K#1"]);
  });

  it("nextKey siirtyy seuraavaan kun edellinen pestään", () => {
    const data = enable(fixture());
    wash(data, "K#1");
    expect(computeGuided(data).nextKey).toBe("K#0");
  });
});

// ─── Nearest-neighbor (efficiency: seuraava ikkuna vierestä) ───────────────────

/** Single floor "K" with a clear geometry to separate nearest-neighbor from the
 *  top-left sweep: a center window, one right beside it, and a far corner one. */
function geoFixture(): ProjectData {
  const data = emptyProjectData();
  data.building.floors = ["K"];
  data.marks = {
    K: {
      marks: [
        { p: 1, x: 50, y: 50 }, // K#0 center
        { p: 1, x: 50, y: 40 }, // K#1 just above center (NEAR)
        { p: 1, x: 0, y: 0 },   // K#2 top-left corner (FAR, but sweep-first)
      ],
    },
  };
  return enable(data);
}

describe("computeGuided — lähin ikkuna (nearest-neighbor)", () => {
  it("ohjaa juuri pestyn ikkunan VIEREEN, ei kartan toiselle laidalle", () => {
    const data = geoFixture();
    washLogged(data, "K#0", 1000); // finished the center window
    const g = computeGuided(data);
    // Nearest to center (50,50) is K#1 (50,40), NOT the top-left corner K#2 —
    // even though the old top→bottom sweep would have sent them to K#2 (y0).
    expect(g.nextKey).toBe("K#1");
    // openKeys ordered by proximity: nearest first, far corner last.
    expect(g.openKeys).toEqual(["K#1", "K#2"]);
  });

  it("ilman pesuja aloittaa vasemmasta yläkulmasta (sweep)", () => {
    const g = computeGuided(geoFixture());
    // Nothing washed → no anchor → top-left corner K#2 (y0) starts the sweep.
    expect(g.nextKey).toBe("K#2");
  });

  it("ankkuri seuraa uusinta pesua (log newest-first)", () => {
    const data = geoFixture();
    washLogged(data, "K#2", 1000); // washed the corner first
    washLogged(data, "K#0", 2000); // then the center (newest)
    // Anchor = newest wash = center (50,50) → nearest unwashed is K#1.
    expect(computeGuided(data).nextKey).toBe("K#1");
  });

  it("kesken voittaa etäisyyden (aloitettua ei jätetä kesken)", () => {
    const data = geoFixture();
    washLogged(data, "K#0", 1000);      // anchor at center
    data.statuses["K#2"] = "kesken";     // far corner is started
    // Even though K#1 is nearer, the started K#2 wins (finish it first).
    expect(computeGuided(data).nextKey).toBe("K#2");
  });

  it("per-worker ankkuri: kukin tekijä jatkaa OMASTA viimeisestä pesustaan", () => {
    const data = emptyProjectData();
    data.building.floors = ["K"];
    data.marks = { K: { marks: [
      { p: 1, x: 0, y: 0 },    // K#0 top-left
      { p: 1, x: 10, y: 0 },   // K#1 beside K#0
      { p: 1, x: 90, y: 90 },  // K#2 bottom-right
      { p: 1, x: 80, y: 90 },  // K#3 beside K#2
    ] } };
    enable(data);
    washLogged(data, "K#0", 1000); data.washedBy["K#0"] = "A"; // A works top-left
    washLogged(data, "K#2", 2000); data.washedBy["K#2"] = "B"; // B works bottom-right
    // Each worker is guided to the window beside THEIR own last wash.
    expect(computeGuided(data, { anchorWorkerId: "A" }).nextKey).toBe("K#1");
    expect(computeGuided(data, { anchorWorkerId: "B" }).nextKey).toBe("K#3");
    // No worker id → global newest wash (K#2) → its neighbour K#3.
    expect(computeGuided(data).nextKey).toBe("K#3");
  });
});

// ─── Founder override ─────────────────────────────────────────────────────────

describe("computeGuided — perustajan ohitus (override)", () => {
  it("kelvollinen ohitus pakottaa aktiivisen kerroksen", () => {
    const g = computeGuided(enable(fixture(), "2"));
    expect(g.activeFloor).toBe("2");
    expect(g.overrideActive).toBe(true);
    // K and 1 both locked now (they have work but aren't active).
    expect(g.lockedFloors.sort()).toEqual(["1", "K"]);
  });

  it("ohitus ohitetaan jos kerros on jo valmis → auto-valinta", () => {
    const data = enable(fixture(), "2");
    wash(data, "2#0"); // override floor now complete
    const g = computeGuided(data);
    expect(g.overrideActive).toBe(false);
    expect(g.activeFloor).toBe("K"); // falls back to first incomplete
  });

  it("ohitus tuntemattomaan kerrokseen → auto-valinta", () => {
    const g = computeGuided(enable(fixture(), "99"));
    expect(g.overrideActive).toBe(false);
    expect(g.activeFloor).toBe("K");
  });
});

// ─── Washing gate ───────────────────────────────────────────────────────────

describe("isGuidedBlocked — pesuportti", () => {
  it("estää lukitun (ei-aktiivisen) kerroksen ikkunat", () => {
    const data = enable(fixture());
    expect(data.guided!.enabled).toBe(true);
    // Active floor is K → windows on 1 and 2 are blocked.
    expect(isGuidedBlocked(data, "K#0")).toBe(false);
    expect(isGuidedBlocked(data, "1#0")).toBe(true);
    expect(isGuidedBlocked(data, "2#0")).toBe(true);
  });

  it("ei estä mitään kun ei aktiivista kerrosta (kaikki valmis)", () => {
    const data = enable(fixture());
    wash(data, "K#0");
    wash(data, "K#1");
    wash(data, "1#0");
    wash(data, "2#0");
    expect(isGuidedBlocked(data, "2#0")).toBe(false);
  });

  it("estää riippumatta ikkunan tilasta (myös jo pestyn ei-aktiivisen)", () => {
    const data = enable(fixture());
    wash(data, "2#0");
    // 2 is not active (K is) → still blocked even though washed.
    expect(isGuidedBlocked(data, "2#0")).toBe(true);
  });
});

// ─── Sanitisation ─────────────────────────────────────────────────────────────

describe("sanitizeGuidedWork", () => {
  it("palauttaa undefined ei-objektille", () => {
    expect(sanitizeGuidedWork(null)).toBeUndefined();
    expect(sanitizeGuidedWork("x")).toBeUndefined();
  });

  it("normalisoi enabled + override", () => {
    expect(sanitizeGuidedWork({ enabled: true, activeFloorOverride: "3" }))
      .toEqual({ enabled: true, activeFloorOverride: "3" });
    expect(sanitizeGuidedWork({ enabled: "yes" }))
      .toEqual({ enabled: false, activeFloorOverride: null });
    expect(sanitizeGuidedWork({ enabled: true, activeFloorOverride: "" }))
      .toEqual({ enabled: true, activeFloorOverride: null });
  });

  it("leikkaa liian pitkän override-arvon", () => {
    const g = sanitizeGuidedWork({ enabled: true, activeFloorOverride: "x".repeat(50) })!;
    expect(g.activeFloorOverride!.length).toBe(8);
  });

  it("emptyGuidedWork on disabloitu", () => {
    expect(emptyGuidedWork()).toEqual({ enabled: false, activeFloorOverride: null });
  });
});
