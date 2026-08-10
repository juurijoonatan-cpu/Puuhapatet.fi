import { describe, expect, it } from "vitest";
import { dashboardPhase, type DashboardPhaseInput } from "./dashboard-phase";

/**
 * VARTIJA. Perustajien dash näytti jokaisen luvun punaisten kautta vielä
 * senkin jälkeen kun urakka oli pesty loppuun, laskutettu neljässä erässä ja
 * tilitetty käsin. Käynnissä oleva työ — keltaiset — oli sivun kahdeksantena
 * palkkina päättyneen urakan alla, ja rahariviltä kolme neljästä ruudusta oli
 * lukuja joille ei ollut enää mitään tehtävissä.
 *
 * Nyt suljettu urakka väistyy painalluksen taakse ja keltaiset johtavat. Nämä
 * testit lukitsevat MILLOIN se tapahtuu — ja ennen kaikkea milloin ei, ettei
 * kesken oleva urakka voi kadota ruudulta.
 */

const base: DashboardPhaseInput = {
  redTotal: 168, redWashed: 168,
  p1PayCount: 4, p1InvoicedCents: 630000, agreedTotalCents: 630000,
  p2Enabled: true, yellowTotal: 136,
};
const phase = (over: Partial<DashboardPhaseInput> = {}) => dashboardPhase({ ...base, ...over });

describe("dashboardPhase", () => {
  it("pesty loppuun + kaikki erät lähetetty = urakka kiinni, keltaiset johtavat", () => {
    expect(phase()).toEqual({ redClosed: true, yellowLed: true });
  });

  it("KESKEN OLEVA URAKKA EI SAA KADOTA — yksikin pesemätön punainen pitää sen etualalla", () => {
    // Tämä on se suunta jossa virhe maksaisi: jos punaiset piiloutuisivat
    // ennen kuin ne on tehty, kesken oleva sopimustyö katoaisi näkyvistä.
    expect(phase({ redWashed: 167 })).toEqual({ redClosed: false, yellowLed: false });
  });

  it("laskuttamatta jäänyt erä pitää urakan etualalla vaikka kaikki olisi pesty", () => {
    expect(phase({ p1PayCount: 3, p1InvoicedCents: 472500 })).toEqual({ redClosed: false, yellowLed: false });
  });

  it("summavertailu riittää vaikka eriä olisi eri määrä", () => {
    // Keikka jossa laskutus ei mene neljään erään: ratkaisee se onko koko
    // sovittu summa laskutettu, ei erien lukumäärä.
    expect(phase({ p1PayCount: 1, p1InvoicedCents: 630000 }).redClosed).toBe(true);
  });

  it("tyhjä kartta ei ole valmis urakka", () => {
    // Ilman tätä uusi keikka aloittaisi urakka-suljettuna ja piilottaisi
    // punaiset ennen kuin yhtäkään ikkunaa on merkitty.
    expect(phase({ redTotal: 0, redWashed: 0 })).toEqual({ redClosed: false, yellowLed: false });
  });

  it("ilman laskutustilaa urakkaa ei julisteta suljetuksi", () => {
    // `null` tarkoittaa ettei serveriltä ole vielä tullut laskutustilaa.
    // Arvaus kumpaankin suuntaan olisi väärin; oletus on että urakka on auki.
    expect(phase({ p1PayCount: null, p1InvoicedCents: 0, agreedTotalCents: 0 }).redClosed).toBe(false);
  });

  it("suljettu urakka ILMAN 2. vaihetta ei nosta keltaisia — niitä ei ole", () => {
    expect(phase({ p2Enabled: false })).toEqual({ redClosed: true, yellowLed: false });
    expect(phase({ yellowTotal: 0 })).toEqual({ redClosed: true, yellowLed: false });
  });

  it("nollasumma ei sulje urakkaa laskuttamatta", () => {
    // agreedTotalCents 0 tekisi vertailusta `0 >= 0` eli aina tosi. Silloin
    // hinnoittelematon keikka näyttäisi laskutetulta.
    expect(phase({ p1PayCount: 0, p1InvoicedCents: 0, agreedTotalCents: 0 }).redClosed).toBe(false);
  });
});
