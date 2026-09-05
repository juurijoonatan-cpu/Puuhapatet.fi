import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * VARTIJA. Etusivun ennen/jälkeen-osion teksteissä ei käytetä pitkiä
 * väliviivoja. Se on omistajan nimenomainen linjaus, ei makuasia jonka
 * seuraava kirjoittaja saa kumota vahingossa: ajatusviiva (—) ja
 * puolipitkä viiva (–) luetaan tässä osiossa töksähtäväksi, ja teksti
 * kirjoitetaan mieluummin kokonaisin lausein tai pilkulla.
 *
 * Miinusmerkki (−) on eri asia ja sallittu: se on luku, ei välimerkki,
 * ja esiintyy muodossa "−35 %".
 *
 * Jos tämä testi kaatuu: kirjoita lause uusiksi. Älä lisää avainta
 * poikkeuslistalle.
 */

const I18N = join(process.cwd(), "client/src/lib/i18n.tsx");

/** Osion avaimet, molemmat kielet, muodossa "ba.jokin": "teksti". */
function beforeAfterStrings(): Array<[string, string]> {
  const src = readFileSync(I18N, "utf8");
  const found: Array<[string, string]> = [];
  const re = /"(ba\.[a-zA-Z0-9.]+)":\s*"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) found.push([m[1], m[2]]);
  return found;
}

describe("etusivun ennen/jälkeen -tekstit", () => {
  it("löytää molempien kielten avaimet", () => {
    const strings = beforeAfterStrings();
    // fi + en, 13 avainta kummassakin.
    expect(strings.length).toBeGreaterThanOrEqual(20);
    expect(strings.some(([k]) => k === "ba.title")).toBe(true);
    expect(strings.some(([k]) => k === "ba.stat.source")).toBe(true);
  });

  it("ei sisällä ajatusviivaa eikä puolipitkää viivaa", () => {
    const offenders = beforeAfterStrings()
      .filter(([, text]) => /[—–]/.test(text))
      .map(([key, text]) => `${key}: ${text}`);
    expect(offenders).toEqual([]);
  });

  it("sallii miinusmerkin luvussa", () => {
    const deduction = beforeAfterStrings().find(([, t]) => t.includes("−35"));
    expect(deduction).toBeDefined();
  });

  it("ei tarjoa enää omaa ennen/jälkeen -kuvaa toimintakehotteessa", () => {
    const ctas = beforeAfterStrings().filter(([k]) => k === "ba.cta");
    expect(ctas.length).toBe(2);
    for (const [, text] of ctas) {
      expect(text.toLowerCase()).not.toContain("ennen");
      expect(text.toLowerCase()).not.toContain("before");
    }
  });
});

/**
 * Valonlisä-luku on mittaustulos, ja lähde kuuluu koodiin sen viereen.
 * Tämä ei tarkista lukua vaan sen perustelun olemassaolon: jos joku vaihtaa
 * 10:n 40:een siksi että se myy paremmin, lähdeviite jää kertomaan ettei
 * numero ollut mielipide.
 */
describe("valonlisä-luku", () => {
  it("kantaa lähteensä mukanaan", () => {
    const src = readFileSync(join(process.cwd(), "client/src/components/light-gain-stat.tsx"), "utf8");
    expect(src).toContain("Building and Environment");
    expect(src).toContain("Sharples");
    expect(src).toMatch(/LIGHT_GAIN_PERCENT = \d+/);
  });
});

/**
 * VARTIJA. Etusivun yläreunassa luki kovakoodattuna "Kevät on täällä!" samaan
 * aikaan kun sivun alempi osio kertoi syksyn saapuvan. Vika ei ollut väärässä
 * sanassa vaan siinä, että vuodenaika oli kirjoitettu käsin yhteen paikkaan ja
 * laskettu toisessa. Nämä testit vahtivat rakennetta, eivät sanavalintaa:
 * kausitekstillä on oltava neljä versiota, ja sivu ei saa laskea kuukautta itse.
 */
describe("etusivun vuodenaika", () => {
  const SEASONS = ["talvi", "kevat", "kesa", "syksy"] as const;

  function i18n(): string {
    return readFileSync(I18N, "utf8");
  }

  it("hero-pillerillä on teksti jokaiselle vuodenajalle, molemmilla kielillä", () => {
    const src = i18n();
    for (const season of SEASONS) {
      const hits = src.match(new RegExp(`"hero\\.pill\\.${season}"`, "g")) ?? [];
      expect(hits.length, `hero.pill.${season}`).toBe(2); // fi + en
    }
  });

  it("ennen/jälkeen-merkillä on teksti jokaiselle vuodenajalle", () => {
    const src = i18n();
    for (const season of SEASONS) {
      const hits = src.match(new RegExp(`"ba\\.badge\\.${season}"`, "g")) ?? [];
      expect(hits.length, `ba.badge.${season}`).toBe(2);
    }
  });

  it("ei jätä kausitonta avainta jonka joku täyttäisi taas käsin", () => {
    const src = i18n();
    expect(src).not.toMatch(/"hero\.pill":/);
    expect(src).not.toMatch(/"ba\.badge":/);
  });

  it("etusivu ei laske kuukautta itse vaan kysyy @shared/seasonilta", () => {
    const landing = readFileSync(join(process.cwd(), "client/src/pages/landing.tsx"), "utf8");
    expect(landing).toContain('from "@shared/season"');
    // getMonth() sivulla tarkoittaa että joku on taas alkanut päätellä itse.
    expect(landing).not.toContain("getMonth()");
  });
});

/**
 * Taustavideon poster oli eri kuva kuin video, joten joka latauksella välähti
 * väärä otos. Poster on nyt videon oma ruutu 0.
 */
describe("etusivun taustavideo", () => {
  const landing = () => readFileSync(join(process.cwd(), "client/src/pages/landing.tsx"), "utf8");

  it("käyttää posterina videon omaa ruutua", () => {
    expect(landing()).toContain('poster="/hero-poster.jpg"');
  });

  it("ei käytä posterina eri otosta", () => {
    expect(landing()).not.toContain('poster="/hero-workers.jpg"');
  });
});

/**
 * VARTIJA. Viiterivi hakee logon polusta `/refs/<slug>.png` ja putoaa nimeen
 * tekstinä jos tiedostoa ei ole. Sopimus tiedostonimen ja koodin välillä on
 * kirjoitettu vain kansion README:hen, joten se rikkoutuisi hiljaa: logo ei
 * ilmestyisi, eikä mikään kertoisi miksi.
 */
describe("viiterivi", () => {
  const strip = () =>
    readFileSync(join(process.cwd(), "client/src/components/reference-strip.tsx"), "utf8");

  it("hakee logon slugin mukaisesta polusta", () => {
    expect(strip()).toContain("`/refs/${reference.slug}.png`");
  });

  it("putoaa nimeen tekstinä kun logotiedostoa ei ole", () => {
    // Ilman onErroria puuttuva tiedosto näkyisi rikkinäisen kuvan ikonina.
    expect(strip()).toContain("onError");
  });

  it("kirjoittaa teemakäännökset kokonaisina Tailwind-luokkina", () => {
    // Koottu luokkanimi ei päädy tuotantobundleen: kääntäjä lukee lähdekoodia
    // tekstinä eikä näe ajonaikaista yhdistelyä.
    const src = strip();
    expect(src).toContain('dark: "dark:invert"');
    expect(src).toContain('light: "invert dark:invert-0"');
    expect(src).toContain('color: ""');
  });

  it("antaa värilliselle tunnukselle alustan tummassa teemassa", () => {
    // Tummanvihreä puu on lähes näkymätön mustaa vasten, eikä sitä voi kääntää
    // (käännetty vihreä on magenta). Alusta on ainoa jäljelle jäävä keino.
    expect(strip()).toContain('color: "dark:rounded-md dark:bg-white/90');
  });

  it("dokumentoi jokaisen slugin README:ssä", () => {
    const src = strip();
    const readme = readFileSync(join(process.cwd(), "client/public/refs/README.md"), "utf8");
    const slugs = Array.from(src.matchAll(/slug: "([a-z0-9-]+)"/g)).map(m => m[1]);
    expect(slugs.length).toBeGreaterThan(0);
    for (const slug of slugs) {
      expect(readme, `README ei mainitse tiedostoa ${slug}.png`).toContain(`${slug}.png`);
    }
  });

  it("otsikko myöntää ettei lista ole täydellinen", () => {
    const src = readFileSync(I18N, "utf8");
    expect(src).toContain('"refs.title": "Meihin luottavat mm."');
  });
});
