/**
 * KUMPI VÄRI JOHTAA PERUSTAJIEN NÄKYMÄÄ.
 *
 * Punaiset (P1) ovat kiinteä urakka, jolla on loppu. Kun jokainen punainen on
 * pesty JA kaikki erät on laskutettu, se on suljettu kirja: sen luvut ovat yhä
 * totta, mutta ne eivät enää kerro missä mennään. Ne on kertaalleen tarkistettu
 * ja tilitetty käsin, eikä niitä lasketa enää uudestaan.
 *
 * Keltaiset (P2) ovat se työ joka on käynnissä ja jonka luvut elävät joka
 * päivä. Kun urakka on kiinni, näkymän kuuluu johtaa käynnissä olevalla työllä.
 * Punaiset eivät katoa — jokainen niiden luku on yhden painalluksen takana.
 *
 * Tämä on JOHDETTU TILA, ei kytkin jota kukaan asettaa. Seuraavalla keikalla,
 * jossa punaiset ovat kesken, näkymä johtaa taas punaisilla itsestään. Sääntö
 * asuu täällä eikä komponentin sisällä, koska se ratkaisee mikä luku on
 * ruudulla isolla — ja sellainen sääntö ansaitsee testin.
 */

export interface DashboardPhaseInput {
  /** Sopimusprioriteetin (punaiset) ikkunoita kartalla. */
  redTotal: number;
  /** Näistä pesty. */
  redWashed: number;
  /** Lähetettyjen erien määrä (FR8:ssa neljä). `null` = laskutustilaa ei ole. */
  p1PayCount: number | null;
  /** Laskutettu punaisista, senttiä. */
  p1InvoicedCents: number;
  /** Sovittu kokonaissumma punaisista, senttiä. */
  agreedTotalCents: number;
  /** Onko 2. vaihe päällä. */
  p2Enabled: boolean;
  /** Keltaisia pisteitä kartalla. */
  yellowTotal: number;
}

export interface DashboardPhase {
  /** Urakka on pesty loppuun ja laskutettu kokonaan. */
  redClosed: boolean;
  /** Keltaiset etualalle: urakka kiinni ja 2. vaiheessa on oikeasti työtä. */
  yellowLed: boolean;
}

/** FR8:n urakka laskutetaan neljässä erässä. */
export const P1_INSTALMENTS = 4;

export function dashboardPhase(i: DashboardPhaseInput): DashboardPhase {
  // Nolla punaista ei ole "valmis urakka" vaan ei urakkaa lainkaan. Ilman tätä
  // ehtoa tyhjä kartta sulkisi urakan heti ja piilottaisi punaiset ennen kuin
  // yhtäkään ikkunaa on merkitty.
  const washedAll = i.redTotal > 0 && i.redWashed >= i.redTotal;
  // Kumpi tahansa riittää: erälaskuri on se mitä näkymä muutenkin näyttää
  // ("4/4 erää"), ja summavertailu kattaa keikan jossa eriä on eri määrä.
  const invoicedAll = i.p1PayCount !== null
    && (i.p1PayCount >= P1_INSTALMENTS
      || (i.agreedTotalCents > 0 && i.p1InvoicedCents >= i.agreedTotalCents));
  const redClosed = washedAll && invoicedAll;
  return { redClosed, yellowLed: redClosed && i.p2Enabled && i.yellowTotal > 0 };
}
