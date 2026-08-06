import { describe, expect, it } from "vitest";
import { p2Transition, MAX_P2_NOTE_LEN, type P2Offer } from "./p2";

/**
 * HINTAHUOMIO seuraa tarjousta koko sen elinkaaren.
 *
 * Huomio on perustajan lyhyt perustelu hinnalle ("iso ikkuna, tikkaat").
 * Asiakas näkee sen hinnan vieressä hyväksyntähetkellä, joten se ei saa
 * kadota missään siirtymässä — kadonnut perustelu tarkoittaa että asiakas
 * päättää pelkän luvun perusteella.
 */
const admin = { who: "admin" as const, id: "joonatan" };
const customer = { who: "customer" as const };

function proposed(note?: string): P2Offer {
  const r = p2Transition(undefined, "propose", admin, { priceCents: 3750, note });
  if (!r.ok) throw new Error(r.error);
  return r.offer;
}

describe("hintahuomio", () => {
  it("tallentuu ehdotukseen", () => {
    expect(proposed("iso ikkuna, tikkaat").note).toBe("iso ikkuna, tikkaat");
  });

  it("säilyy kun asiakas hyväksyy hinnan", () => {
    const o = proposed("kaksi puolta");
    const r = p2Transition(o, "accept", customer, { priceCents: 3750, version: o.version });
    expect(r.ok && r.offer.note).toBe("kaksi puolta");
  });

  it("säilyy vastatarjouksen ja sen hyväksynnän läpi", () => {
    const o = proposed("tikkaat");
    const c = p2Transition(o, "counter", customer, { priceCents: 3000, version: o.version });
    expect(c.ok && c.offer.note).toBe("tikkaat");
    const co = c.ok ? c.offer : o;
    const a = p2Transition(co, "accept_counter", admin, { priceCents: co.counterCents, version: co.version });
    expect(a.ok && a.offer.note).toBe("tikkaat");
  });

  it("säilyy kun lukitus avataan uudelleen neuvoteltavaksi", () => {
    const o = proposed("parveke");
    const l = p2Transition(o, "accept", customer, { priceCents: 3750, version: o.version });
    const u = p2Transition(l.ok ? l.offer : o, "unlock", admin, { version: (l.ok ? l.offer : o).version });
    expect(u.ok && u.offer.note).toBe("parveke");
  });

  it("hinnan päivitys ilman huomiota säilyttää vanhan", () => {
    const o = proposed("iso ikkuna");
    const r = p2Transition(o, "propose", admin, { priceCents: 5000 });
    expect(r.ok && r.offer.note).toBe("iso ikkuna");
    expect(r.ok && r.offer.priceCents).toBe(5000);
  });

  it("tyhjä merkkijono poistaa huomion", () => {
    const o = proposed("poistettava");
    const r = p2Transition(o, "propose", admin, { priceCents: 3750, note: "   " });
    expect(r.ok && r.offer.note).toBeUndefined();
  });

  it("katkaistaan pituusrajaan", () => {
    const o = proposed("x".repeat(MAX_P2_NOTE_LEN + 50));
    expect(o.note).toHaveLength(MAX_P2_NOTE_LEN);
  });
});
