import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * VARTIJA. YLÄPALKIN NAPIT EIVÄT SAA JÄÄDÄ MINKÄÄN ALLE.
 *
 * Tekijävalitsimen "klikkaa ohi sulkeaksesi" -levy on koko ruudun kokoinen ja
 * täysin läpinäkyvä. Se oli `zIndex: 44` yläpalkin (20) sisällä, ja yläpalkin
 * omat napit ovat sijoittamattomia — ne piirtyvät siis levyn ALLE. Kun
 * valitsin oli auki, jokainen napautus Tilanne/Kerrokset/Maksut-välilehteen
 * tai takaisin-nuoleen meni levylle: valikko sulkeutui hiljaa eikä mitään
 * muuta tapahtunut. Käyttäjälle koko yläpalkki näytti kuolleelta, eikä mikään
 * ruudulla kertonut miksi. Valitsin on pieni siru välilehtien vieressä, joten
 * se aukeaa vahingossa helposti.
 *
 * Korjauksessa on KAKSI osaa, ja kumpikin on välttämätön:
 *
 *   1. levyn z-arvo on pienempi kuin palkin vyöhykkeiden, JA
 *   2. levy renderöidään navin suorana lapsena — EI vyöhykkeen sisällä.
 *
 * Kohta 2 on se joka menee helposti ohi: vyöhyke on itse `zIndex: OVER_SCRIM`,
 * joten sen sisällä oleva levy nousee koko vyöhykkeen mukana välilehtien
 * yläpuolelle riippumatta omasta z-arvostaan. Ensimmäinen korjausyritykseni
 * kaatui juuri tähän, ja selaintesti näytti yhä "PEITOSSA".
 *
 * Tämä testi lukee lähdekoodin, koska vika ei ole logiikassa vaan rakenteessa:
 * yksikkötesti renderöimättä ei näkisi sitä, ja selaintesti ei aja CI:ssä.
 */

const SRC = readFileSync(join(process.cwd(), "client/src/components/fr8/Navbar.tsx"), "utf8");

/** `<nav …>` … `</nav>` -lohko. */
function navBlock(): string {
  const start = SRC.indexOf("<nav");
  const end = SRC.indexOf("</nav>");
  if (start < 0 || end < 0) throw new Error("Navbarin <nav>-lohkoa ei löytynyt");
  return SRC.slice(start, end);
}

describe("yläpalkin ulkoklikkari", () => {
  it("levyn z-arvo on PIENEMPI kuin palkin vyöhykkeiden", () => {
    const scrim = SRC.match(/const SCRIM = (\d+)/);
    const over = SRC.match(/const OVER_SCRIM = (\d+)/);
    expect(scrim, "SCRIM-vakio puuttuu").toBeTruthy();
    expect(over, "OVER_SCRIM-vakio puuttuu").toBeTruthy();
    expect(Number(scrim![1])).toBeLessThan(Number(over![1]));
  });

  it("välilehtinauha ja sivuvyöhykkeet ovat levyn YLÄPUOLELLA", () => {
    // Ilman näitä napit ovat sijoittamattomia ja piirtyvät levyn alle.
    expect(SRC).toMatch(/data-fr8-tabs[\s\S]{0,600}zIndex: OVER_SCRIM/);
    expect(SRC).toMatch(/const sideZone[\s\S]{0,400}zIndex: OVER_SCRIM/);
  });

  it("LEVY ON ENNEN KAIKKIA VYÖHYKKEITÄ — ei minkään sisällä", () => {
    // Tämä on se osa joka meni ensin ohi. Vyöhykkeen sisällä levy nousisi
    // vyöhykkeen mukana välilehtien yläpuolelle vaikka sen oma z olisi pieni,
    // ja juuri niin ensimmäinen korjausyritykseni epäonnistui.
    //
    // Väite on rakenteellinen: levy tulee <nav>-lohkossa ENNEN vasenta
    // vyöhykettä, välilehtinauhaa ja oikeaa vyöhykettä. Jos joku siirtää sen
    // takaisin valitsimen viereen (oikea vyöhyke on viimeisenä), tämä kaatuu.
    const nav = navBlock();
    const scrim = nav.indexOf("data-fr8-scrim");
    const tabs = nav.indexOf("data-fr8-tabs");
    const leftZone = nav.indexOf("VASEN:");
    expect(scrim, "data-fr8-scrim -levyä ei löytynyt <nav>-lohkosta").toBeGreaterThan(-1);
    expect(scrim).toBeLessThan(leftZone);
    expect(scrim).toBeLessThan(tabs);
  });

  it("levy sulkee valikon eikä tee muuta", () => {
    expect(SRC).toMatch(/data-fr8-scrim[\s\S]{0,200}onClick=\{\(\) => setWasherOpen\(false\)\}/);
  });

  it("valikko itse on yhä levyn JA vyöhykkeiden yläpuolella", () => {
    expect(SRC).toMatch(/zIndex: OVER_SCRIM \+ 1/);
  });

  it("VARTIJA VARTIJALLE: vanha kova z-arvo ei ole palannut", () => {
    // Jos joku kirjoittaa `zIndex: 44` takaisin, tämä kaatuu vaikka vakiot
    // olisivat yhä tiedostossa.
    expect(SRC).not.toMatch(/position: "fixed", inset: 0, zIndex: 44/);
  });
});
