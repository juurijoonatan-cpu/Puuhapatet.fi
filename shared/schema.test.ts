import { describe, expect, it } from "vitest";
import { customerTypeOf, toCustomerType, CUSTOMER_TYPE_LABEL } from "./schema";

/**
 * Asiakaslaji lisättiin `isYritys`-lipun RINNALLE, ei sen tilalle. Nämä testit
 * lukitsevat sen, että vanhat rivit (joilla saraketta ei ole) vastaavat
 * täsmälleen kuten ennen — muuten jokainen olemassa oleva asiakas vaihtaisi
 * lajia sinä päivänä kun sarake lisätään.
 */
describe("customerTypeOf — laji johdetaan myös vanhoille riveille", () => {
  it("vanha yritysrivi ilman saraketta on yhä yritys", () => {
    expect(customerTypeOf({ isYritys: true })).toBe("yritys");
    expect(customerTypeOf({ isYritys: true, customerType: null })).toBe("yritys");
  });

  it("vanha henkilörivi ilman saraketta on yhä henkilö", () => {
    expect(customerTypeOf({ isYritys: false })).toBe("henkilo");
    expect(customerTypeOf({})).toBe("henkilo");
    expect(customerTypeOf(null)).toBe("henkilo");
    expect(customerTypeOf(undefined)).toBe("henkilo");
  });

  it("nimenomainen laji voittaa johdetun", () => {
    // Yhdistys kirjataan isYritys=true + customerType="ry", jotta jokainen
    // olemassa oleva `isYritys`in lukija käyttäytyy oikein myös sille.
    expect(customerTypeOf({ isYritys: true, customerType: "ry" })).toBe("ry");
    expect(customerTypeOf({ isYritys: false, customerType: "yritys" })).toBe("yritys");
  });

  it("roskalaji putoaa takaisin johdettuun", () => {
    expect(customerTypeOf({ isYritys: true, customerType: "yhdistys" })).toBe("yritys");
    expect(customerTypeOf({ isYritys: false, customerType: 42 as any })).toBe("henkilo");
  });

  it("toCustomerType hyväksyy vain kolme arvoa", () => {
    expect(toCustomerType("ry")).toBe("ry");
    expect(toCustomerType("yritys")).toBe("yritys");
    expect(toCustomerType("henkilo")).toBe("henkilo");
    for (const bad of ["oy", "", null, undefined, 0, {}]) {
      expect(toCustomerType(bad)).toBeUndefined();
    }
  });

  it("jokaisella lajilla on näyttönimi", () => {
    expect(CUSTOMER_TYPE_LABEL.ry).toContain("ry");
    expect(Object.keys(CUSTOMER_TYPE_LABEL).sort()).toEqual(["henkilo", "ry", "yritys"]);
  });
});
