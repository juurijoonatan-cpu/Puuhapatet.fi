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

describe("asiakas saa hyväksyä aiemmin hylkäämänsä ikkunan", () => {
  /**
   * "Ei" on asiakkaan näkymässä hyväksyntänapin vieressä ja osuu vahingossa.
   * Ilman tätä vahinko jäi lopulliseksi: hylätystä ikkunasta ei saanut rahaa
   * vaikka se oli jo pesty, eikä asiakas voinut korjata sitä itse. Hylkäys on
   * asiakkaan oma päätös, joten hän saa myös muuttaa sitä.
   */
  const declined = offer({ status: "declined", priceCents: 3400, version: 3, lockedCents: undefined, lockedAt: undefined, lockedBy: undefined });

  it("hyväksyntä hylätystä lukitsee hinnan", () => {
    const r = p2Transition(declined, "accept", { who: "customer" }, { priceCents: 3400, version: 3 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.offer.status).toBe("locked");
    expect(r.offer.lockedCents).toBe(3400);
    expect(r.offer.lockedBy).toBe("customer");
    expect(r.offer.version).toBe(4);
  });

  it("väärä hinta tai versio ei mene läpi hylätystäkään", () => {
    expect(p2Transition(declined, "accept", { who: "customer" }, { priceCents: 3000, version: 3 }).ok).toBe(false);
    expect(p2Transition(declined, "accept", { who: "customer" }, { priceCents: 3400, version: 2 }).ok).toBe(false);
  });

  it("lukittua ei voi hyväksyä uudestaan", () => {
    const locked = offer({ lockedBy: "customer", lockedCents: 3400, lockedAt: T, version: 3 });
    expect(p2Transition(locked, "accept", { who: "customer" }, { priceCents: 3400, version: 3 }).ok).toBe(false);
  });

  it("vain asiakas voi hyväksyä — admin ei hylätynkään kohdalla", () => {
    expect(p2Transition(declined, "accept", { who: "admin", id: "j" }, { priceCents: 3400, version: 3 }).ok).toBe(false);
  });
});
