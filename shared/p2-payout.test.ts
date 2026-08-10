import { describe, expect, it } from "vitest";
import { p2WorkerPayoutCents, DEFAULT_P2_PAYOUT_SCHEDULE, type P2PayoutRule } from "./p2";

/**
 * VARTIJA. Palkkiotaulukko oli kolme täsmäosumaa (34 € → 18 €, 37,50 € → 20 €,
 * 50 € → 27 €) ja kaikelle muulle tasaprosentti 53 %. Koska jokainen ankkuri on
 * prosenttiviivan yläpuolella, palkkio PUTOSI heti ankkurin jälkeen:
 *
 *     37,50 € → 20,00 €   mutta   37,51 € → 19,88 €
 *     50,00 € → 27,00 €   mutta   50,01 € → 26,51 €
 *
 * Tekijä sai siis kalliimmasta ikkunasta vähemmän. Kukaan ei päättänyt niin;
 * se oli taulukon muodon sivuvaikutus. Nyt palkkio kulkee suoraan ankkurista
 * ankkuriin, ja tärkein testi tässä tiedostossa on monotonisuus.
 */

const pay = (cents: number, schedule: P2PayoutRule[] | null | undefined = DEFAULT_P2_PAYOUT_SCHEDULE) =>
  p2WorkerPayoutCents(cents, 53, schedule);

describe("p2WorkerPayoutCents", () => {
  it("SOVITUT ANKKURIT MAKSAVAT TÄSMÄLLEEN SEN MITÄ ON SOVITTU", () => {
    // Nämä ovat neuvoteltuja lupauksia, eivät laskennan tulosta. Jos käyrän
    // muoto joskus muuttuu, näiden kolmen on silti pysyttävä paikallaan.
    expect(pay(3400)).toBe(1800);
    expect(pay(3750)).toBe(2000);
    expect(pay(5000)).toBe(2700);
  });

  it("KALLIIMPI IKKUNA EI VOI KOSKAAN MAKSAA VÄHEMMÄN — tämä oli se vika", () => {
    let prev = -1;
    let worst: string | null = null;
    for (let c = 100; c <= 20000; c += 1) {
      const p = pay(c);
      if (p < prev && worst === null) worst = `${c / 100} € maksoi ${p / 100} €, edellinen ${prev / 100} €`;
      prev = p;
    }
    expect(worst).toBeNull();
  });

  it("juuri ne kaksi kohtaa joissa palkkio ennen putosi", () => {
    expect(pay(3751)).toBeGreaterThanOrEqual(pay(3750));
    expect(pay(5001)).toBeGreaterThanOrEqual(pay(5000));
    // Vanha käytös dokumentoituna, jottei kukaan palauta sitä vahingossa:
    // 37,51 € antoi 1988 (53 %) eli 12 senttiä VÄHEMMÄN kuin 37,50 €.
    expect(pay(3751)).not.toBe(1988);
  });

  it("ankkurien välissä palkkio kulkee suoraan — 36 € on 34:n ja 37,50:n välissä", () => {
    // 36 € on 57,1 % matkasta 34 €:stä 37,50 €:oon, joten palkkio on
    // 18 € + 0,571 × 2 € = 19,14 €.
    expect(pay(3600)).toBe(1914);
    // Ja väli on aidosti nouseva, ei porras.
    expect(pay(3500)).toBeGreaterThan(pay(3400));
    expect(pay(3700)).toBeGreaterThan(pay(3600));
  });

  it("ankkurialueen ulkopuolella käytetään lähimmän ankkurin omaa osuutta", () => {
    // Alle 34 €: sama osuus kuin 34 €:ssä (18/34). Jatkuva ankkurissa.
    expect(pay(1700)).toBe(900);
    // Yli 50 €: sama osuus kuin 50 €:ssä (27/50 = 54 %).
    expect(pay(10000)).toBe(5400);
    expect(pay(6000)).toBe(3240);
  });

  it("ei ekstrapoloi trendiä sovitun alueen ulkopuolelle", () => {
    // Viimeisen välin marginaali on 56 %; jos sitä jatkettaisiin, 60 € maksaisi
    // 32,60 €. Käytämme ankkurin omaa osuutta (54 %) = 32,40 € — pienempi ja
    // perusteltavissa, koska se on sama osuus kuin sovitussa 50 €:n ikkunassa.
    expect(pay(6000)).toBeLessThan(3260);
  });

  it("järjestämätön tai vajaa taulukko ei riko käyrää", () => {
    const messy: P2PayoutRule[] = [
      { priceCents: 5000, payoutCents: 2700 },
      { priceCents: 3400, payoutCents: 1800 },
      { priceCents: 3750, payoutCents: 2000 },
    ];
    expect(pay(3600, messy)).toBe(1914);
    expect(pay(3400, messy)).toBe(1800);
  });

  it("yhden rivin taulukko on pelkkä osuus, ja se osuu ankkuriin täsmälleen", () => {
    const one: P2PayoutRule[] = [{ priceCents: 4000, payoutCents: 2000 }];
    expect(pay(4000, one)).toBe(2000);
    expect(pay(2000, one)).toBe(1000);
    expect(pay(8000, one)).toBe(4000);
  });

  it("ilman taulukkoa jäljelle jää vanha tasaprosentti", () => {
    // Keikka jolle ei ole asetettu palkkiotaulukkoa käyttäytyy kuten ennen.
    expect(p2WorkerPayoutCents(3600, 53, [])).toBe(1908);
    expect(p2WorkerPayoutCents(3600, 50, [])).toBe(1800);
  });

  it("roskasyöte ei tuota rahaa tyhjästä eikä kaada laskentaa", () => {
    expect(pay(0)).toBe(0);
    expect(pay(-500)).toBe(0);
    expect(p2WorkerPayoutCents(NaN as unknown as number, 53, DEFAULT_P2_PAYOUT_SCHEDULE)).toBe(0);
    const junk = [{ priceCents: 0, payoutCents: 900 }, { priceCents: 3400, payoutCents: 1800 }] as P2PayoutRule[];
    expect(pay(3400, junk)).toBe(1800);
  });

  it("palkkio ei koskaan ylitä ikkunan hintaa sovitulla taulukolla", () => {
    for (let c = 100; c <= 20000; c += 100) expect(pay(c)).toBeLessThan(c);
  });
});
