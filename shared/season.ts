/**
 * Vuodenaika yhdestä paikasta.
 *
 * MIKSI TÄMÄ ON OLEMASSA. Etusivun yläreunassa luki kovakoodattuna "Kevät on
 * täällä!" samaan aikaan kun sivun alempi osio kertoi syksyn saapuvan. Kaksi
 * eri paikkaa arvasi vuodenajan eri tavalla, ja toinen niistä ei arvannut
 * lainkaan vaan oli kirjoitettu käsin joskus keväällä. Kalenteri ei ole
 * mielipide, joten se lasketaan nyt kerran ja kaikki lukevat saman vastauksen.
 *
 * Jos lisäät uuden kausisidonnaisen tekstin, hae vuodenaika täältä. Älä
 * kirjoita sitä käsin: käsin kirjoitettu vuodenaika on oikein korkeintaan
 * kolme kuukautta.
 */

export type Season = "talvi" | "kevat" | "kesa" | "syksy";

/** Kalenterivuodenaika. Kuukausi on 0-pohjainen kuten Date.getMonth(). */
export function seasonForMonth(month: number): Season {
  const m = ((Math.trunc(month) % 12) + 12) % 12;
  if (m === 11 || m <= 1) return "talvi"; // joulu, tammi, helmi
  if (m <= 4) return "kevat";             // maalis, huhti, touko
  if (m <= 7) return "kesa";              // kesä, heinä, elo
  return "syksy";                          // syys, loka, marras
}

export function currentSeason(now: Date = new Date()): Season {
  return seasonForMonth(now.getMonth());
}

/**
 * Näytetäänkö talvipalvelut (Talvikiilto, lumityöt) kausikorteissa.
 *
 * Tämä on TARKOITUKSELLA laajempi kuin kalenteritalvi: marraskuussa maassa on
 * jo lunta ja lumityötä kysytään, mutta kalenteri sanoo vielä syksyä. Sama
 * ikkuna kuin sivulla oli ennen tätä moduulia (marras–helmi), jotta kortit
 * eivät vaihdu tämän siivouksen sivutuotteena.
 */
export function showsWinterServices(now: Date = new Date()): boolean {
  const m = now.getMonth();
  return m >= 10 || m <= 1;
}
