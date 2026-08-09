import { describe, expect, it } from "vitest";
import { p2CustomerLocksSince, p2Transition, type P2Offer, type P2State } from "./p2";

/**
 * VARTIJA. Hyväksynnän peruminen on poikkeustoimi: se ottaa takaisin asiakkaan
 * tahdonilmaisun ja siirtää rahaa "ansaitusta" takaisin "odottaa". Sen
 * kohdejoukko ei siis saa olla yhtään laveampi kuin on tarkoitus, ja napissa
 * lukevan määrän on oltava sama kuin mitä palvelin oikeasti peruu — molemmat
 * lukevat tämän saman funktion.
 */

function offer(o: Partial<P2Offer>): P2Offer {
  return { status: "locked", priceCents: 3400, version: 2, updatedAt: 0, ...o };
}

function state(offers: Record<string, P2Offer>): P2State {
  return { enabled: true, workerSharePct: 50, offers, events: [] };
}

const T = 1_700_000_000_000;

describe("p2CustomerLocksSince", () => {
  it("ottaa vain asiakkaan lukitsemat", () => {
    const s = state({
      a: offer({ lockedBy: "customer", lockedCents: 3400, lockedAt: T }),
      b: offer({ lockedBy: "admin", lockedCents: 2800, lockedAt: T }),   // meidän accept_counter
    });
    expect(p2CustomerLocksSince(s, T - 1000).map((l) => l.key)).toEqual(["a"]);
  });

  it("ottaa vain aikarajan jälkeiset", () => {
    const s = state({
      uusi: offer({ lockedBy: "customer", lockedCents: 3400, lockedAt: T }),
      vanha: offer({ lockedBy: "customer", lockedCents: 3400, lockedAt: T - 86_400_000 }),
    });
    expect(p2CustomerLocksSince(s, T - 3600_000).map((l) => l.key)).toEqual(["uusi"]);
  });

  it("ei koske muihin tiloihin", () => {
    const s = state({
      p: offer({ status: "proposed", lockedBy: "customer", lockedAt: T }),
      c: offer({ status: "countered", lockedBy: "customer", lockedAt: T }),
      d: offer({ status: "declined", lockedBy: "customer", lockedAt: T }),
    });
    expect(p2CustomerLocksSince(s, 0)).toEqual([]);
  });

  it("ohittaa lukitun jolta puuttuu aikaleima (ei arvata)", () => {
    const s = state({ a: offer({ lockedBy: "customer", lockedCents: 3400 }) });
    expect(p2CustomerLocksSince(s, 0)).toEqual([]);
  });

  it("järjestää uusin ensin ja kertoo sovitun hinnan", () => {
    const s = state({
      a: offer({ lockedBy: "customer", lockedCents: 3400, lockedAt: T }),
      b: offer({ lockedBy: "customer", lockedCents: 2800, lockedAt: T + 5 }),
    });
    expect(p2CustomerLocksSince(s, 0)).toEqual([
      { key: "b", lockedCents: 2800, lockedAt: T + 5 },
      { key: "a", lockedCents: 3400, lockedAt: T },
    ]);
  });

  it("tyhjä tila ei kaadu", () => {
    expect(p2CustomerLocksSince(null, 0)).toEqual([]);
    expect(p2CustomerLocksSince(undefined, 0)).toEqual([]);
  });
});

describe("peruttu hyväksyntä palaa odottamaan alkuperäisellä hinnalla", () => {
  it("unlock vie takaisin proposed-tilaan ja säilyttää hintahuomion", () => {
    const locked = offer({
      lockedBy: "customer", lockedCents: 3400, lockedAt: T,
      note: "Iso ikkuna, tikkaat", version: 3,
    });
    const r = p2Transition(locked, "unlock", { who: "admin", id: "joonatan" }, {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.offer.status).toBe("proposed");
    expect(r.offer.priceCents).toBe(3400);
    expect(r.offer.lockedCents).toBeUndefined();
    expect(r.offer.note).toBe("Iso ikkuna, tikkaat");
    // Versio nousee, joten asiakkaan auki oleva välilehti ei voi hyväksyä
    // vanhalla versiolla uudestaan ilman että se huomataan.
    expect(r.offer.version).toBe(4);
  });

  it("asiakkaan vanha versio ei enää kelpaa peruutuksen jälkeen", () => {
    const locked = offer({ lockedBy: "customer", lockedCents: 3400, lockedAt: T, version: 3 });
    const back = p2Transition(locked, "unlock", { who: "admin", id: "j" }, {});
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const stale = p2Transition(back.offer, "accept", { who: "customer" }, { priceCents: 3400, version: 3 });
    expect(stale.ok).toBe(false);
  });
});
