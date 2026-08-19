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
    // Vakio luetaan VAIN portin läpi, joka vertaa keikan omaa sopimustunnusta.
    expect(
      src,
      "Staattisen PDF:n osoite pitää johtaa keikan sopimustunnuksesta, ei moduulivakiosta.",
    ).toMatch(/const fr8PdfUrl = view\.contractId === FR8_CONTRACT_ID/);
    // Portin ulkopuolella vakiota ei käytetä: määrittely + portti = 2 osumaa.
    expect((src.match(/FR8_CONTRACT_PDF_URL/g) ?? []).length).toBe(2);
    // Upotus ja lataus lukevat johdettua osoitetta, eivät vakiota suoraan.
    expect(src).toContain("data={`${pdfUrl}#view=FitH`}");
  });

  /**
   * LIITETTY SOPIMUS HAETAAN TOKENILLA — sillä samalla jolla asiakas on sivulla.
   *
   * Tämä on sama sääntö kuin staattisella PDF:llä, mutta uudelle polulle
   * (`GigData.contractFile`): asiakirjan osoite ei saa johtua mistään muusta
   * kuin tämän asiakkaan omasta tokenista. Adminin polku kulkee keikan
   * numeerisella id:llä ja admin-sessiolla — jos se ilmestyy asiakkaan
   * näkymään, osoite on arvattavissa eikä enää sidottu tähän keikkaan.
   */
  it("liitetty sopimus haetaan asiakkaan omalla tokenilla", () => {
    const src = read("client/src/components/GigContractSign.tsx");
    expect(src).toMatch(/api\.contractFileUrlForGig\(token\)/);
    // Adminin id-pohjaiset haut nimeltä. Molemmat nimet ovat listalla, jotta
    // vanhan nimen palauttaminen ei livahda ohi vartijasta.
    const ADMIN_BY_ID = ["fetchGigContractFile", "contractFileUrlForJob"];
    for (const f of SHARED_CUSTOMER_VIEWS) {
      const src2 = stripComments(read(f));
      for (const helper of ADMIN_BY_ID) {
        expect(
          src2,
          `${f}: asiakasnäkymä ei saa hakea sopimusta adminin id-reitiltä (${helper}).`,
        ).not.toContain(helper);
      }
    }
  });

  it("tunnistaa paluun vuotoon (vartija toimii)", () => {
    const regressed = `const CONTRACT_PDF_URL = "/contracts/PT-2026-02.pdf";\n<object data={\`\${CONTRACT_PDF_URL}#view=FitH\`} />`;
    expect(/const fr8PdfUrl = view\.contractId === FR8_CONTRACT_ID/.test(regressed)).toBe(false);
    // Ja sama toiselle polulle: keikan id:llä haettu sopimus ei ole tokenilla
    // haettu sopimus, vaikka se näyttäisi samalta koodissa.
    expect(/api\.contractFileUrlForGig\(token\)/.test(
      `const url = api.contractFileUrlForJob(view.jobId);`,
    )).toBe(false);
  });
});

/**
 * VARTIJA: LÄHDEKOODIN KOMMENTTI EI OLE ASIAKKAAN TEKSTIÄ.
 *
 * JSX:ssä `/* … *\/` ilman aaltosulkeita EI ole kommentti vaan elementin LAPSI,
 * ja React piirtää sen sellaisenaan. Asiakkaan seurantasivulla luki näin koko
 * sisäinen selitys: "juuri vastikkeeton keikka sai eurokortit — 0,00 € /
 * 525,00 € asiakkaalle joka ei maksa mitään".
 *
 * Tämä testi etsii samaa muotoa asiakasnäkymistä: lohkokommentti joka on
 * sisennetty kuin JSX:n lapsi ja jota EI ole kirjoitettu `{/* … *\/}` -muotoon,
 * eikä se ole JSX-attribuuttien välissä (siellä muoto on laillinen) eikä
 * `<style>`-lohkon CSS:ssä.
 */
describe("asiakasnäkymien kommentit eivät päädy ruudulle", () => {
  /** Rivi jonka jälkeen lohkokommentti on laillinen: attribuuttilista tai
   *  lauseke, ei lapsipaikka. */
  const OPENS_EXPRESSION = /[{(,;:?]$|=>$|&&$|\}$|\)$|>$/;

  function bareBlockCommentsInChildren(src: string): string[] {
    const lines = src.split("\n");
    const out: string[] = [];
    let inStyle = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes("<style>")) inStyle = true;
      if (inStyle) { if (line.includes("</style>")) inStyle = false; continue; }
      const m = /^(\s{6,})\/\*/.exec(line);
      if (!m || line.includes("{/*")) continue;
      // Attribuuttipaikka: edellinen ei-tyhjä rivi päättyy attribuuttiin tai
      // avaavaan merkkiin. Lapsipaikassa se päättyy JSX-elementtiin tai
      // lausekelohkoon `}`/`)`, jotka OPENS_EXPRESSION hyväksyy — siksi
      // tarkistetaan erikseen ollaanko elementin sisällä.
      const prev = [...lines.slice(Math.max(0, i - 6), i)].reverse().find((l) => l.trim()) ?? "";
      const inAttributes = /^\s*[a-zA-Z-]+=/.test(prev) || prev.trim().endsWith("(") || prev.trim().endsWith("{");
      if (inAttributes) continue;
      if (!OPENS_EXPRESSION.test(prev.trim())) continue;
      out.push(`rivi ${i + 1}: ${line.trim().slice(0, 60)}`);
    }
    return out;
  }

  it("tunnistaa aaltosulkeettoman lohkokommentin (vartija toimii)", () => {
    const regressed = [
      "        })()}",
      "        /**",
      "         * Selitys joka piirtyisi asiakkaalle.",
      "         */",
      "        {data.sectors.map((s) => (",
    ].join("\n");
    expect(bareBlockCommentsInChildren(regressed).length).toBe(1);
  });

  it("asiakasnäkymissä ei ole kommenttia lapsipaikassa", () => {
    const offenders: string[] = [];
    for (const f of SHARED_CUSTOMER_VIEWS) {
      for (const hit of bareBlockCommentsInChildren(read(f))) offenders.push(`${f} ${hit}`);
    }
    expect(
      offenders,
      "Lohkokommentti JSX:n lapsipaikassa piirtyy asiakkaalle tekstinä. "
        + `Kirjoita se muodossa {/* … */}. → ${offenders.join(" | ")}`,
    ).toEqual([]);
  });
});
