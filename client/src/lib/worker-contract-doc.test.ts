import { describe, expect, it } from "vitest";
import { buildWorkerContractHtml } from "./worker-contract-doc";
import type { CrewMember } from "@shared/crew";

/**
 * Alihankkijasopimuksen dokumentti on sopimuskappale, jonka MOLEMMAT osapuolet
 * lataavat ja jonka pitää kestää tulostus paperille. Sen sisällöstä on siis
 * muutama asia joita ei saa rikkoa vahingossa — ja jotka on rikottu:
 *
 *   · Y-tunnus oli haudattuna kyselylomakkeen vastausten sekaan, vaikka koko
 *     sopimus lepää sen varassa (itsenäinen yrittäjä, ei työsuhde).
 *   · Ikkunakorvaus tulostui `cents / 100`:lla, eli 2050 → "20.5 €".
 *   · Tulostusta ei ohjattu mitenkään: neljä sopimusta valui yhdeksi putkeksi.
 */

function member(over: Partial<CrewMember> = {}): CrewMember {
  return {
    id: "selma",
    name: "Selma",
    active: true,
    perWindowCents: 2050,
    agreements: [{
      agreementId: "alihankinta",
      version: "2026-06",
      signedAt: Date.parse("2026-07-17T09:14:00Z"),
      signerName: "Selma Onerva Länsmans",
      signatureDataUrl: "data:image/png;base64,AAAA",
      acceptedClauseIds: ["a"],
      ip: "84.251.10.44",
      userAgent: "Mozilla/5.0 (iPhone)",
    }],
    profile: {
      fullName: "Selma Onerva Länsmans",
      email: "selma@esimerkki.fi",
      phone: "+358 40 123 4567",
      yTunnus: "3640119-9",
      answers: { address: "Esimerkkikatu 4, 00100 Helsinki" },
    },
    ...over,
  } as CrewMember;
}

const html = (m: CrewMember) => buildWorkerContractHtml({ member: m, buildingName: "FR8" });

describe("alihankkijasopimuksen dokumentti", () => {
  it("nimeää molemmat sopijapuolet", () => {
    const h = html(member());
    expect(h).toContain("Sopijapuolet");
    expect(h).toContain("Toimeksiantaja");
    expect(h).toContain("Alihankkija");
    expect(h).toContain("Joonatan Juuri");
    expect(h).toContain("Selma Onerva Länsmans");
  });

  it("nostaa Y-tunnuksen sopijapuoliin, ei kyselyvastausten sekaan", () => {
    const h = html(member());
    const parties = h.slice(h.indexOf('class="parties"'), h.indexOf('class="agreement"'));
    expect(parties).toContain("3640119-9");
    // Sama tieto ei toistu alempana taustatiedoissa.
    expect(h.split("3640119-9")).toHaveLength(2);
  });

  it("huomauttaa jos Y-tunnus puuttuu — sopimus edellyttää sitä", () => {
    const m = member();
    (m.profile as any).yTunnus = undefined;
    const h = html(m);
    expect(h).toContain("Y-tunnusta ei ole vielä kirjattu");
  });

  it("muotoilee ikkunakorvauksen suomalaisittain", () => {
    const h = html(member());
    // 2050 senttiä = "20,50 €" — pilkulla ja sentteineen, ei "20.5 €".
    // Väli on sitova ( ), jottei summa katkea euromerkistä rivinvaihdossa;
    // testi hyväksyy kumman tahansa välin, koska Intlin ulostulo voi vaihdella
    // ICU-version mukaan eikä tämä testi ole siitä kiinnostunut.
    expect(h).toMatch(/20,50\s€/);
    expect(h).not.toContain("20.5");
  });

  it("ohjaa tulostuksen: sivunvaihdot ja jakamattomat lohkot", () => {
    const h = html(member());
    expect(h).toContain("@page");
    // Jokainen sopimus omalta sivultaan, vanha alias mukana iOS Safarille.
    expect(h).toMatch(/break-before:page;\s*page-break-before:always/);
    // Allekirjoitus ei saa haljeta kahdelle sivulle.
    expect(h).toMatch(/\.sign[^{]*\{[^}]*break-inside:avoid/);
  });

  it("näyttää allekirjoituksen ja pitää todistusaineiston erillään", () => {
    const h = html(member());
    expect(h).toContain("Allekirjoittanut");
    expect(h).toContain('<img src="data:image/png;base64,AAAA"');
    // IP ja selain ovat mukana, mutta omana pienenä rivinään.
    expect(h).toMatch(/class="audit">[^<]*84\.251\.10\.44/);
  });

  it("kertoo suoraan jos allekirjoituskuva puuttuu", () => {
    const m = member();
    (m.agreements[0] as any).signatureDataUrl = "";
    expect(html(m)).toContain("Allekirjoituskuvaa ei tallennettu");
  });

  it("ei riko HTML:ää nimellä jossa on erikoismerkkejä", () => {
    const m = member({ name: '<script>alert("x")</script>' });
    (m.profile as any).fullName = '<script>alert("x")</script>';
    const h = html(m);
    expect(h).not.toContain("<script>alert");
    expect(h).toContain("&lt;script&gt;");
  });
});
