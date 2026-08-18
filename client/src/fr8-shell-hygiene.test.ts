import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * VARTIJA: FR8-kuori mitoitetaan reunoista, ei viewport-yksiköllä.
 *
 * "Nappi ei painaudu — pitää painaa sen yläpuolelta" on korjattu tähän
 * tiedostoon kolmesti: ensin sisääntuloanimaatio, sitten dokumentin vieritys
 * (fr8-lock), ja lopulta itse kuoren korkeus. Kaksi ensimmäistä eivät
 * riittäneet, koska varsinainen syy oli kolmas:
 *
 *   `.fr8-root` on position:fixed, mutta sen korkeus tuli erikseen lasketusta
 *   viewport-yksiköstä (100dvh / -webkit-fill-available / 100vh). Fixed-elementti
 *   PIIRRETÄÄN viewportin mukaan, mutta yksikkö on oma lukunsa jonka selain
 *   päivittää omaan tahtiinsa. Kun ne eroavat, kuori on näkyvää aluetta
 *   korkeampi, pystysuora flex-jako venyy, ja jokainen nappi piirtyy alemmas
 *   kuin missä siihen yltää.
 *
 * `inset: 0` sitoo kaikki neljä reunaa samaan containing blockiin jonka mukaan
 * elementti myös piirretään. Korkeutta ei lasketa erikseen, joten se ei voi
 * mennä eri tahtiin.
 *
 * Jos tämä testi kaatuu: älä palauta `height`-riviä. Eksplisiittinen korkeus
 * ylimäärittelee laatikon, jolloin `bottom: 0` jätetään huomiotta ja vika
 * palaa juuri sellaisena kuin se oli.
 */

const CSS = readFileSync(join(process.cwd(), "client/src/index.css"), "utf8");

/** `.fr8-root`-säännön runko (ensimmäinen esiintymä, ei jälkeläissääntöjä). */
function shellRule(css: string): string {
  const i = css.indexOf(".fr8-root {");
  if (i < 0) throw new Error(".fr8-root-sääntöä ei löytynyt");
  const end = css.indexOf("\n}", i);
  return css.slice(i, end + 2);
}

const SHELLS = [
  "client/src/pages/worker.tsx",
  "client/src/pages/admin/project.tsx",
  "client/src/components/gig-tools/GigToolsOverlay.tsx",
];

describe("FR8-kuoren mitoitus", () => {
  it("löytää .fr8-root-säännön (testi itse ei saa olla tyhjä)", () => {
    const r = shellRule(CSS);
    expect(r).toContain("display: flex");
    expect(r.length).toBeGreaterThan(80);
  });

  it("ei mitoita kuorta viewport-yksiköllä", () => {
    const r = shellRule(CSS);
    const bad = ["100vh", "100dvh", "100svh", "100lvh", "-webkit-fill-available"]
      .filter((u) => new RegExp(`height:[^;]*${u.replace(/[-]/g, "\\-")}`).test(r));
    expect(
      bad,
      `Kuoren korkeus tulee viewport-yksiköstä (${bad.join(", ")}). `
        + "Käytä inset: 0 — muuten napin osumaruutu erkanee sen piirretystä paikasta.",
    ).toEqual([]);
  });

  it("sitoo kuoren kaikista neljästä reunasta", () => {
    const r = shellRule(CSS);
    expect(r).toMatch(/position:\s*fixed/);
    expect(r).toMatch(/inset:\s*0/);
  });

  it("jokainen kuori käyttää inset:0:aa, ei top/left/right-kolmikkoa", () => {
    const offenders: string[] = [];
    for (const f of SHELLS) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      for (const line of src.split("\n")) {
        if (!line.includes('className="fr8-root"')) continue;
        if (!/inset:\s*0/.test(line)) offenders.push(f);
      }
    }
    expect(offenders, `Kuori ilman inset: 0 → ${offenders.join(", ")}`).toEqual([]);
  });

  it("tunnistaa paluun vanhaan mitoitukseen (vartija toimii)", () => {
    const regressed = `.fr8-root {\n  height: 100vh;\n  height: -webkit-fill-available;\n  height: 100dvh;\n  display: flex;\n}\n`;
    const r = shellRule(regressed);
    const bad = ["100vh", "100dvh", "-webkit-fill-available"]
      .filter((u) => new RegExp(`height:[^;]*${u.replace(/[-]/g, "\\-")}`).test(r));
    expect(bad.sort()).toEqual(["-webkit-fill-available", "100dvh", "100vh"].sort());
    expect(/inset:\s*0/.test(r)).toBe(false);
  });

  /**
   * Turva-alue. Sovellus ajaa `viewport-fit=cover`illa, joten kiinteä yläpalkki
   * piirtyy ruudun fyysiseen ylälaitaan — kellon ja akkukuvakkeen alle — ellei se
   * varaa `env(safe-area-inset-top)`:ia. `fr8/Navbar.tsx` korjattiin tästä jo
   * kertaalleen; `GigToolsOverlay` oli kopio samasta 62 px:n palkista tehty ennen
   * korjausta, ja siinä takaisin-nappi oli kellon alla ja otsikko akun päällä.
   */
  it("jokainen kuori varaa turva-alueen yläpalkilleen", () => {
    const offenders = SHELLS.filter((f) => {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      return !src.includes("env(safe-area-inset-top)");
    });
    expect(
      offenders,
      `Kuori jonka yläpalkki ei varaa turva-aluetta → ${offenders.join(", ")}. `
        + "Turva-alue kuuluu PADDINGIIN, ja korkeuteen lisätään sama inset — "
        + "muuten sisältö valuu ruudun alalaidan ohi.",
    ).toEqual([]);
  });

  /**
   * Palkin korkeus ja sisällön korkeus ovat yksi luku kahdessa paikassa. Jos
   * vain palkkia kasvatetaan insetin verran, `<main>` jää liian korkeaksi ja
   * alimmat napit valuvat näkyvän alueen alle — sama vika jonka takia tämä
   * tiedosto on olemassa.
   */
  it("GigToolsOverlayn sisältökorkeus vähentää saman insetin kuin palkki lisää", () => {
    const src = readFileSync(join(process.cwd(), "client/src/components/gig-tools/GigToolsOverlay.tsx"), "utf8");
    expect(src).toContain('height: "calc(62px + env(safe-area-inset-top))"');
    expect(src).toContain('height: "calc(100% - 62px - env(safe-area-inset-top))"');
  });

  /**
   * `loading` ei saa olla efektin riippuvuus, jos efekti itse asettaa sen: se
   * lukitsi keikan asetusnäkymän pysyvästi tekstiin "Ladataan…" — setLoading(true)
   * laukaisi efektin siivouksen, joka perui kesken lentävän pyynnön, eikä
   * `setLoading(false)` päässyt koskaan ajoon.
   */
  it("asetusnäkymän lataus ei peru omaa pyyntöään", () => {
    const src = readFileSync(join(process.cwd(), "client/src/components/gig-tools/GigToolsOverlay.tsx"), "utf8");
    expect(src).toContain("startedRef");
    expect(src).not.toMatch(/\}, \[active, jobId, project, loading\]\);/);
  });

  it("dokumentin vieritys pysyy lukittuna kuoren ollessa auki", () => {
    // Täydentävä mekanismi: fixed-kuori + vierinyt dokumentti erkanee myös.
    expect(CSS).toContain("html.fr8-lock");
    for (const f of ["client/src/pages/worker.tsx", "client/src/pages/admin/project.tsx"]) {
      expect(readFileSync(join(process.cwd(), f), "utf8")).toContain("fr8-lock");
    }
  });
});
