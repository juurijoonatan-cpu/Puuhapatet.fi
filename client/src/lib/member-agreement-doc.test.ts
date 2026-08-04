import { describe, expect, it } from "vitest";
import { buildMemberAgreementHtml } from "./member-agreement-doc";
import type { MemberAgreementSignature } from "@shared/member-agreement";

/**
 * Jäsensopimuksen kappale on ARKISTOKOPIO: se renderöidään uudestaan
 * tallennetusta allekirjoituksesta. Silloin sen on kerrottava mitä
 * ALLEKIRJOITETTIIN, ei mitä koodissa nyt sattuu lukemaan.
 *
 * Perustajavariantti kirjoitti palvelumaksun elävästä HOST_SERVICE_FEE_PCT
 * -vakiosta, joten vakion muutos olisi muuttanut takautuvasti jokaisen jo
 * allekirjoitetun sopimuksen tekstiä. Nyt luku tulee allekirjoituksen
 * snapshotista. Tämä testi pitää sen siellä.
 */
function sig(over: Partial<MemberAgreementSignature> = {}): MemberAgreementSignature {
  return {
    version: "2026-06",
    type: "founder",
    userId: "joonatan",
    signedAt: Date.parse("2026-06-02T18:20:00Z"),
    signerName: "Joonatan Juuri",
    place: "Helsinki",
    snapshot: { name: "Joonatan Juuri", role: "HOST", yTunnus: "3598782-9", feePct: 15 },
    acceptedPolicyIds: ["tietosuoja"],
    signatureDataUrl: "data:image/png;base64,AAAA",
    ip: "84.251.10.44",
    userAgent: "Mozilla/5.0 (Macintosh)",
    ...over,
  };
}

describe("jäsensopimuksen kappale", () => {
  it("käyttää ALLEKIRJOITETTUA palvelumaksua, ei nykyistä vakiota", () => {
    // Snapshotissa 15 %, vaikka HOST_SERVICE_FEE_PCT on tänään 10 %.
    const h = buildMemberAgreementHtml(sig());
    expect(h).toContain("palvelumaksu 15 %");
    expect(h).toContain("palvelumaksu brändille on 15 %");
    expect(h).not.toContain("10 %");
  });

  it("nimeää molemmat sopijapuolet ja näyttää Y-tunnuksen", () => {
    const h = buildMemberAgreementHtml(sig());
    expect(h).toContain("Sopijapuolet");
    expect(h).toContain("Matias Pitkänen");
    expect(h).toContain("3598782-9");
  });

  it("merkitsee hyväksytyt käytännöt rastilla ja hyväksymättömät tyhjällä", () => {
    const h = buildMemberAgreementHtml(sig());
    expect(h).toContain("☑");
    expect(h).toContain("☐");
  });

  it("näyttää allekirjoituksen, paikan ja ajan", () => {
    const h = buildMemberAgreementHtml(sig());
    expect(h).toContain("Allekirjoittanut");
    expect(h).toContain("Joonatan Juuri");
    expect(h).toContain("Helsinki");
    expect(h).toContain('<img src="data:image/png;base64,AAAA"');
  });

  it("näyttää huoltajan kun allekirjoittaja on alaikäinen", () => {
    const h = buildMemberAgreementHtml(sig({ type: "worker", guardianName: "Anna Esimerkki",
      snapshot: { name: "Nuori Tekijä", role: "STAFF", feePct: 20 } }));
    expect(h).toContain("Huoltaja");
    expect(h).toContain("Anna Esimerkki");
  });

  it("ohjaa tulostuksen", () => {
    const h = buildMemberAgreementHtml(sig());
    expect(h).toContain("@page");
    expect(h).toMatch(/\.sign[^{]*\{[^}]*break-inside:avoid/);
  });

  it("ei riko HTML:ää erikoismerkeillä", () => {
    const h = buildMemberAgreementHtml(sig({ signerName: '<script>alert(1)</script>' }));
    expect(h).not.toContain("<script>alert");
    expect(h).toContain("&lt;script&gt;");
  });
});
