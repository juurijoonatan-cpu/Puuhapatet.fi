import { describe, expect, it } from "vitest";
import { isValidYTunnus } from "./y-tunnus";

describe("isValidYTunnus", () => {
  it("hyväksyy pätevät Y-tunnukset (BRAND_BILLERS + Oliver)", () => {
    expect(isValidYTunnus("3598782-9")).toBe(true); // Joonatan
    expect(isValidYTunnus("3609912-9")).toBe(true); // Matias
    expect(isValidYTunnus("3636866-7")).toBe(true); // Oliver
  });

  it("hyväksyy ylimääräiset välilyönnit trimmaamalla", () => {
    expect(isValidYTunnus(" 3636866-7 ")).toBe(true);
  });

  it("hylkää väärän tarkistusmerkin", () => {
    expect(isValidYTunnus("3636866-8")).toBe(false);
  });

  it("hylkää väärän muodon", () => {
    expect(isValidYTunnus("1234567-8")).toBe(false); // muoto ok, tarkiste väärin
    expect(isValidYTunnus("123-4")).toBe(false);
    expect(isValidYTunnus("36368667")).toBe(false); // ei väliviivaa
    expect(isValidYTunnus("")).toBe(false);
    expect(isValidYTunnus(undefined)).toBe(false);
    expect(isValidYTunnus(null)).toBe(false);
  });

  it("jäännös 1 ei ole koskaan pätevä, oli tarkistusmerkki mikä tahansa", () => {
    // digits 1,0,0,1,0,0,0 -> summa = 1*7 + 1*5 = 12, 12 % 11 === 1.
    expect(isValidYTunnus("1001000-0")).toBe(false);
    expect(isValidYTunnus("1001000-1")).toBe(false);
  });
});
