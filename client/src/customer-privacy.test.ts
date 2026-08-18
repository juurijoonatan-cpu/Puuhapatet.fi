import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * VARTIJA: ASIAKKAAN NÄKEMÄ SISÄLTÖ ON HÄNEN OMAN KEIKKANSA SISÄLTÖÄ.
 *
 * Tämä testi on olemassa yhden aidon tietovuodon takia. `GigContractSign` on
 * jaettu komponentti jonka `gig-live.tsx` näyttää JOKAISELLE keikalle jonka
 * sopimus on allekirjoittamatta, ja se upotti sopimusasiakirjan
 * moduulitason vakiosta:
 *
 *     const CONTRACT_PDF_URL = "/contracts/PT-2026-02.pdf";
 *
 * Polkua ei sidottu keikkaan mitenkään. Kun toinen asiakas (yhdistys) avasi
 * oman seurantalinkkinsä, hän näki FR8:n allekirjoitetun 8-sivuisen sopimuksen
 * kokonaisuudessaan: tilaajan nimen, Y-tunnuksen, yhteyshenkilön, osoitteen ja
 * sektorien hinnoittelun. Ympäröivä teksti luki oikein keikan omaa blobia,
 * joten mikään muu näkymän osa ei paljastanut vikaa.
 *
 * Kaksi sääntöä, jotka tämä testi pitää voimassa:
 *   1. jaetussa asiakaskomponentissa ei ole yhdenkään asiakkaan tietoja, ja
 *   2. staattinen sopimus-PDF on aina keikkakohtaisen portin takana.
 */

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

/**
 * Kommentit pois ennen tarkistusta.
 *
 * Vika on KOODISSA, ei sen selityksessä: tiedostot dokumentoivat tämän vuodon
 * nimeltä ("...asiakas olisi nähnyt FR8 FAFO Oy:n sopimusasiakirjan..."), ja se
 * selitys on nimenomaan syy miksi vika ei palaa. Vartija katsoo siis vain sitä
 * mitä voi päätyä ruudulle.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** Komponentit jotka piirtyvät ASIAKKAAN selaimessa mille tahansa keikalle. */
const SHARED_CUSTOMER_VIEWS = [
  "client/src/components/GigContractSign.tsx",
  "client/src/pages/gig-live.tsx",
];

/**
 * Tunnisteita jotka yksilöivät yhden asiakkaan. Nämä olivat kovakoodattuina
 * `GigContractSign`issa (`FR8_TILAAJA`), eli toisen asiakkaan tiedot latautuivat
 * jokaisen keikan lomakkeelle.
 *
 * HUOM: "PT-2026-02" ei ole listalla eikä kuulu sinne — sopimustunnus on portti,
 * ei vuoto: se on juuri se ehto jolla FR8:n oma PDF rajataan FR8:lle.
 */
const CUSTOMER_IDENTIFIERS = [
  "FAFO",
  "Niilo",
  "niilo@",
  "Aleksanterinkatu",
  "3547969-9",
];

describe("asiakasnäkymien tietoraja", () => {
  it("jaetuissa asiakaskomponenteissa ei ole yhdenkään asiakkaan tietoja", () => {
    const offenders: string[] = [];
    for (const f of SHARED_CUSTOMER_VIEWS) {
      const src = stripComments(read(f));
      for (const id of CUSTOMER_IDENTIFIERS) {
        if (src.includes(id)) offenders.push(`${f}: ${id}`);
      }
    }
    expect(
      offenders,
      "Asiakkaan tiedot kovakoodattuna jaettuun näkymään → "
        + `${offenders.join(", ")}. Ne tulevat keikan blobista (GigData.company), eivät lähdekoodista.`,
    ).toEqual([]);
  });

  it("staattinen sopimus-PDF on keikkakohtaisen portin takana", () => {
    const src = read("client/src/components/GigContractSign.tsx");
    // Ainoa polku dokumenttiin kulkee `pdfUrl`in kautta, ja se on portti.
    expect(
      src,
      "PDF:n osoite pitää johtaa keikan sopimustunnuksesta, ei moduulivakiosta.",
    ).toMatch(/const pdfUrl = view\.contractId === FR8_CONTRACT_ID/);
    // Upotus ja lataus lukevat `pdfUrl`ia, eivät vakiota suoraan.
    expect(src).toContain("data={`${pdfUrl}#view=FitH`}");
    expect(src).toContain("href={pdfUrl}");
    // Portin ulkopuolella vakiota ei käytetä: määrittely + portti = 2 osumaa.
    expect((src.match(/FR8_CONTRACT_PDF_URL/g) ?? []).length).toBe(2);
  });

  it("tunnistaa paluun vuotoon (vartija toimii)", () => {
    const regressed = `const CONTRACT_PDF_URL = "/contracts/PT-2026-02.pdf";\n<object data={\`\${CONTRACT_PDF_URL}#view=FitH\`} />`;
    expect(/const pdfUrl = view\.contractId === FR8_CONTRACT_ID/.test(regressed)).toBe(false);
  });
});
