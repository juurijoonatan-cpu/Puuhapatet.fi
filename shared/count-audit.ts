/**
 * IKKUNAMÄÄRÄN TARKISTUS.
 *
 * Perustajat laskivat rakennuksesta 77 pestyä keltaista, paneeli näytti 79.
 * Kun luku ja todellisuus eroavat, arvaaminen on turhaa — tämä kertoo mistä
 * luku koostuu ja mikä siinä voi olla vinossa.
 *
 * Laskenta itsessään on suoraviivainen: `allPoints` ohittaa poistetut, joten
 * poistettu ikkuna ei voi olla mukana. Kaksi asiaa voi silti tuottaa eron
 * silmämääräiseen laskentaan:
 *
 *  1. PÄÄLLEKKÄISET PISTEET. Jos kaksi pistettä on lähes samoissa
 *     koordinaateissa, kartalla näkyy yksi pallo mutta datassa on kaksi
 *     ikkunaa. Silmä laskee 77, kone 79 — kumpikaan ei ole "väärässä", mutta
 *     data on. Näin käy jos lisäysnappia napautetaan kahdesti.
 *
 *  2. AVAINTÖRMÄYS. Sama avain kahteen kertaan pistelistassa on aina virhe;
 *     tarkistetaan varmuuden vuoksi, koska se olisi hiljainen tuplalaskenta.
 *
 * Kerroskohtainen erittely on tässä siksi, että eron paikantaminen kerrokseen
 * vie sekunteja, kun koko rakennuksen uudelleenlaskenta veisi illan.
 */

import type { ProjectData } from "./project";
import { allPoints } from "./project";

export interface CountAuditFloor {
  floor: string;
  red: number;
  redWashed: number;
  yellow: number;
  yellowWashed: number;
}

/** Ryhmä pisteitä jotka ovat käytännössä samassa kohdassa pohjapiirrosta. */
export interface CountAuditOverlap {
  floor: string;
  keys: string[];
  /** Montako ryhmän pisteistä on merkitty pestyksi. */
  washed: number;
  /** Ryhmän pisteiden prioriteetit (1 ja/tai 2). */
  priorities: (1 | 2)[];
}

export interface CountAudit {
  byFloor: CountAuditFloor[];
  totalYellow: number;
  totalYellowWashed: number;
  totalRed: number;
  totalRedWashed: number;
  /** Lähes päällekkäiset pisteet — kartalla yksi pallo, datassa monta. */
  overlaps: CountAuditOverlap[];
  /** Montako ikkunaa katoaisi jos jokaisesta päällekkäisryhmästä jäisi yksi. */
  overlapExtra: number;
  /** Montako pestyä katoaisi samalla. */
  overlapExtraWashed: number;
  /** Sama avain kahdesti pistelistassa — ei saisi koskaan tapahtua. */
  duplicateKeys: string[];
}

/** Oletustoleranssi: kaksi pistettä 1,5 % päässä toisistaan on kartalla yksi pallo. */
export const OVERLAP_TOLERANCE_PCT = 1.5;

export function auditWindowCounts(data: ProjectData, tolPct = OVERLAP_TOLERANCE_PCT): CountAudit {
  const pts = allPoints(data);
  const byFloorMap = new Map<string, CountAuditFloor>();
  const seenKeys = new Set<string>();
  const duplicateKeys: string[] = [];
  const perFloorPts = new Map<string, { key: string; p: 1 | 2; x: number; y: number; washed: boolean }[]>();

  for (const pt of pts) {
    if (seenKeys.has(pt.key)) duplicateKeys.push(pt.key);
    else seenKeys.add(pt.key);

    let f = byFloorMap.get(pt.floor);
    if (!f) { f = { floor: pt.floor, red: 0, redWashed: 0, yellow: 0, yellowWashed: 0 }; byFloorMap.set(pt.floor, f); }
    const washed = pt.status === "pesty";
    if (pt.p === 2) { f.yellow += 1; if (washed) f.yellowWashed += 1; }
    else { f.red += 1; if (washed) f.redWashed += 1; }

    // Sijainti: siirretty piste lasketaan siitä mihin se on siirretty.
    const ov = data.posOverrides?.[pt.key];
    const base = coordsOf(data, pt.floor, pt.key);
    const x = ov ? ov.x : base?.x ?? 0;
    const y = ov ? ov.y : base?.y ?? 0;
    const list = perFloorPts.get(pt.floor) ?? [];
    list.push({ key: pt.key, p: pt.p, x, y, washed });
    perFloorPts.set(pt.floor, list);
  }

  const overlaps: CountAuditOverlap[] = [];
  for (const [floor, list] of Array.from(perFloorPts.entries())) {
    const grouped = new Set<string>();
    for (let i = 0; i < list.length; i++) {
      if (grouped.has(list[i].key)) continue;
      const group = [list[i]];
      for (let j = i + 1; j < list.length; j++) {
        if (grouped.has(list[j].key)) continue;
        if (Math.hypot(list[i].x - list[j].x, list[i].y - list[j].y) <= tolPct) group.push(list[j]);
      }
      if (group.length < 2) continue;
      group.forEach((g) => grouped.add(g.key));
      overlaps.push({
        floor,
        keys: group.map((g) => g.key),
        washed: group.filter((g) => g.washed).length,
        priorities: Array.from(new Set(group.map((g) => g.p))).sort() as (1 | 2)[],
      });
    }
  }

  const byFloor = Array.from(byFloorMap.values());
  return {
    byFloor,
    totalYellow: byFloor.reduce((n, f) => n + f.yellow, 0),
    totalYellowWashed: byFloor.reduce((n, f) => n + f.yellowWashed, 0),
    totalRed: byFloor.reduce((n, f) => n + f.red, 0),
    totalRedWashed: byFloor.reduce((n, f) => n + f.redWashed, 0),
    overlaps,
    overlapExtra: overlaps.reduce((n, o) => n + o.keys.length - 1, 0),
    overlapExtraWashed: overlaps.reduce((n, o) => n + Math.max(0, o.washed - 1), 0),
    duplicateKeys,
  };
}

/** Pisteen alkuperäiset koordinaatit (pohjapiste tai lisätty piste). */
function coordsOf(data: ProjectData, floor: string, key: string): { x: number; y: number } | null {
  if (key.includes("#c")) {
    const cm = (data.customMarks[floor] || []).find((c) => c.key === key);
    return cm ? { x: cm.x, y: cm.y } : null;
  }
  const idx = Number(key.split("#")[1]);
  const mk = data.marks[floor]?.marks?.[idx];
  return mk ? { x: mk.x, y: mk.y } : null;
}
