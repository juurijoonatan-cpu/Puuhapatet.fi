import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * VARTIJA — HOOKIT EIVÄT SAA OLLA POISTUMISEN ALAPUOLELLA.
 *
 * MITÄ TAPAHTUI. Työtaulun `addBoardEntry` ja `toggleBoardTask` kirjoitettiin
 * `useCallback`eiksi, ja ne päätyivät tiedostossa `if (loading) return …`
 * -poistumisen alapuolelle. Latauksen ajan React näki siis kaksi hookia
 * VÄHEMMÄN kuin heti sen jälkeen, ja kun data saapui, se heitti #310
 * ("Rendered more hooks than during the previous render").
 *
 * Lopputulos ruudulla oli valkoinen "Jotain meni pieleen" koko
 * projektinäkymän tilalla — ei siis rikkinäinen paneeli vaan rikkinäinen sivu.
 * Mikään yksikkötesti ei huomannut sitä, koska tiedosto kääntyy ja tyypittyy
 * moitteetta: vika syntyy vasta ajossa ja vasta toisella renderillä.
 *
 * Tämä testi lukee saman totuuden josta selain ajaa: hookkia ei saa esiintyä
 * ensimmäisen aikaisen poistumisen ja päänäkymän palautuksen välissä.
 *
 * Jos tämä kaatuu: siirrä hook poistumisen yläpuolelle, tai — kuten näiden
 * kahden kohdalla — kysy tarvitaanko hookia lainkaan. Kummankin riippuvuutena
 * oli tavallinen funktio, joka on uusi joka renderillä, joten muistiinpano ei
 * muistanut mitään.
 */

const SRC = readFileSync(join(process.cwd(), "client/src/pages/admin/project.tsx"), "utf8");

/** Ensimmäinen aikainen poistuminen `AdminProjectPage`n rungossa. */
const EARLY_EXIT = "  if (loading || crewChecking) {";
/** Päänäkymän palautus — komponentin runko päättyy tähän. */
const MAIN_RETURN = "  return shell(";

describe("projektinäkymän hookit ovat kaikkien poistumisten yläpuolella", () => {
  const exitAt = SRC.indexOf(EARLY_EXIT);
  const lastReturnAt = SRC.lastIndexOf(MAIN_RETURN);

  it("molemmat merkkipaalut löytyivät (testi itse ei saa olla tyhjä lupaus)", () => {
    expect(exitAt).toBeGreaterThan(0);
    expect(lastReturnAt).toBeGreaterThan(exitAt);
  });

  it("aikaisen poistumisen ja päänäkymän välissä ei kutsuta yhtään hookia", () => {
    const body = SRC.slice(exitAt, lastReturnAt);
    const hooks = Array.from(body.matchAll(/\buse[A-Z]\w*\s*\(/g)).map((m) => m[0].trim());
    expect(hooks, `hook poistumisen alapuolella: ${hooks.join(", ")}`).toEqual([]);
  });
});
