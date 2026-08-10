/**
 * Asiakkaan seurantanäkymän edistymislaskenta — yksi totuus.
 *
 * Luku näkyy kahdessa paikassa (sivun yläkortti ja kartta), ja niiden EI saa
 * antaa laskea sitä eri tavoin. Sen takia laskenta asuu täällä eikä
 * komponentin sisällä, ja sillä on omat testinsä.
 */

import type { GigPublicView, P2PublicView } from "@/lib/api";

export type CustomerMap = NonNullable<GigPublicView["map"]>;

export interface CustomerPoint { key: string; p: 1 | 2; x: number; y: number }

/** Yhden kerroksen näkyvät ikkunapisteet: pohjapisteet + lisätyt, poistetut pois,
 *  siirretyt omilla koordinaateillaan. Sama järjestys kuin tekijöiden kartassa. */
export function getPoints(floor: string, map: CustomerMap): CustomerPoint[] {
  const out: CustomerPoint[] = [];
  (map.marks[floor]?.marks || []).forEach((mk, idx) => {
    const key = `${floor}#${idx}`;
    if (map.deleted[key]) return;
    const ov = map.posOverrides[key];
    out.push({ key, p: mk.p, x: ov ? ov.x : mk.x, y: ov ? ov.y : mk.y });
  });
  (map.customMarks[floor] || []).forEach((cm) => {
    if (map.deleted[cm.key]) return;
    const ov = map.posOverrides[cm.key];
    out.push({ key: cm.key, p: cm.p, x: ov ? ov.x : cm.x, y: ov ? ov.y : cm.y });
  });
  return out;
}

export interface CustomerProgress {
  /** Kaikki työhön kuuluvat ikkunat (hylätyt keltaiset pois). */
  total: number;
  /** Näistä pesty. */
  done: number;
  /** Pestyjä keltaisia joiden hinta odottaa vielä asiakkaan hyväksyntää. */
  awaiting: number;
  /** 0–100, pyöristetty. */
  pct: number;
  /**
   * KERTYNYT Priority 2 -summa: vain ne lisätyöikkunat jotka on sekä PESTY että
   * hinnaltaan SOVITTU. Tämä on eri luku kuin sovittu kokonaissumma, johon
   * kuuluvat myös vielä pesemättömät sovitut ikkunat — "kertynyt" tarkoittaa
   * tehtyä työtä, joten sen pitää tarkoittaa juuri sitä.
   */
  p2AccruedCents: number;
  /** Kertyneiden lisätyöikkunoiden lukumäärä. */
  p2AccruedCount: number;
}

/**
 * KOKONAISEDISTYMINEN.
 *
 * PUNAISET ovat aina mukana: ne ovat allekirjoitettu urakka.
 *
 * KELTAISET ovat mukana silloin kun Priority 2 -vaihe on auki — MYÖS ne joiden
 * hintaa asiakas ei ole vielä hyväksynyt. Työ on tehty, joten sen kuuluu näkyä
 * edistymisenä riippumatta siitä missä vaiheessa hinnasta sopiminen on.
 *
 * Ennen vaihetta 2 keltaiset EIVÄT ole mukana. Näkymä sanoo asiakkaalle
 * suoraan, etteivät ne kuulu tähän sopimukseen, joten ne eivät saa myöskään
 * painaa prosenttia alas. Kun vaihe 2 avataan, työn laajuus kasvaa ja luku
 * elää sen mukana — se on rehellinen kuvaus tilanteesta.
 *
 * POIS: hylätty keltainen jota EI ole pesty. Kun asiakas sanoo ei ennen kuin
 * työ on tehty, ikkuna ei ole enää osa työtä — se katoaa sekä osoittajasta
 * että nimittäjästä, jolloin prosentti nousee sen sijaan että jäisi ikuisesti
 * vajaaksi.
 *
 * MUTTA PESTY HYLÄTTY ON MUKANA. Työtä ei voi perua jälkikäteen: ikkuna on
 * pesty, ja asiakas voi hyväksyä sen hinnan yhä omasta näkymästään. Sama
 * sääntö on `shared/p2.ts`:ssä (`p2PendingPriceCents`), ja jos tämä poikkeaa
 * siitä, sama ikkuna on samalla ruudulla yhtä aikaa "odottaa hyväksyntääsi"
 * -laatikossa ja poissa edistymisestä — eri luvut samasta joukosta.
 */
/**
 * Kuuluuko piste siihen työhön jota asiakkaalle näytetään? Sama sääntö ohjaa
 * sekä pääkortin kokonaislukua että kartan kerroskohtaista lukua, jotteivät ne
 * voi kertoa eri tarinaa samalla ruudulla.
 *
 * `washed` on pakollinen juuri siksi että hylätyn kohtalo riippuu siitä: ilman
 * sitä laajuus ei voi olla yhtä mieltä hyväksyntälaatikon kanssa.
 */
export function inCustomerScope(pt: CustomerPoint, p2: P2PublicView | null | undefined, washed: boolean): boolean {
  if (pt.p !== 2) return true;
  if (!p2?.enabled) return false;
  if (p2.offers[pt.key]?.status !== "declined") return true;
  return washed;
}

export function customerProgress(
  map: CustomerMap | null | undefined,
  p2?: P2PublicView | null,
): CustomerProgress {
  if (!map) return { total: 0, done: 0, awaiting: 0, pct: 0, p2AccruedCents: 0, p2AccruedCount: 0 };
  const p2Live = !!p2?.enabled;
  const floors = map.building.floors.length ? map.building.floors : ["1"];
  let total = 0, done = 0, awaiting = 0, p2AccruedCents = 0, p2AccruedCount = 0;
  for (const f of floors) {
    for (const pt of getPoints(f, map)) {
      const washed = map.statuses[pt.key] === "pesty";
      if (!inCustomerScope(pt, p2, washed)) continue;
      const offer = pt.p === 2 ? p2?.offers[pt.key] : undefined;
      total += 1;
      if (!washed) continue;
      done += 1;
      if (pt.p !== 2 || !p2Live) continue;
      // Sama ehto kuin laskentakoneessa (`shared/p2.ts`): lukittu hinta on
      // `lockedCents`, ja ilman sitä ikkuna ei ole sovittu vaan yhä avoin.
      if (offer?.status === "locked" && typeof offer.lockedCents === "number") {
        p2AccruedCount += 1;
        p2AccruedCents += offer.lockedCents;
      } else {
        // "Odottaa hyväksyntää" on mielekäs vain kun neuvottelu on käynnissä.
        awaiting += 1;
      }
    }
  }
  return {
    total, done, awaiting,
    pct: total > 0 ? Math.round((done / total) * 100) : 0,
    p2AccruedCents, p2AccruedCount,
  };
}
