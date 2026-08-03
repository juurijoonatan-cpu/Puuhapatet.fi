import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

/**
 * VARTIJA. Mobiilissa on sääntö joka pakottaa jokaisen `backdrop-filter`-pinnan
 * taustan 5,5 %:n valkoiseksi (index.css). Se on kirjoitettu KORTTEJA varten:
 * kortin oma tausta on valkoinen 3,5 %, ja kun blur pudotetaan
 * suorituskykysyistä, kortti katoaa taustaansa ellei pintaa nosteta.
 *
 * Sääntö on POISSULKULISTA, ja siinä on sen vika: uusi pinta on oletuksena
 * mukana. Kaikki pinnat eivät ole kortteja:
 *
 *   · leijuva valikko kartan päällä → 5,5 % valkoista ei peitä mitään,
 *     teksti menee ristiin kartan pisteiden kanssa;
 *   · modaalin himmennys (musta 60 %) → himmennys katoaa kokonaan;
 *   · virheilmoituksen keltainen palkki → haalistuu haamuksi.
 *
 * Tämä on jo tapahtunut kahdesti: ensin ikkunavalikolle, sitten yläpalkin
 * oletustekijä-valikolle, modaalien himmennyksille ja virhepalkille. Molemmilla
 * kerroilla vika löytyi vasta puhelimen ruudulta.
 *
 * SÄÄNTÖ JONKA TÄMÄ VALVOO: jos elementillä on `backdropFilter` JA sille on
 * annettu oma tausta joka ei ole valkoinen kalvo, sen on kannettava merkintää
 * joka kertoo mitä mobiilissa pitää tehdä:
 *
 *   data-fr8-pop    leijuva valikko → peittävä #16161c + varjo
 *   data-fr8-solid  sama, nimetty toisin historiallisista syistä
 *   data-fr8-bg     tausta on jo tarkoituksella jokin → älä koske
 *
 * Jos tämä testi kaatuu: valitse merkintä sen mukaan mikä pinta on. Älä
 * poista taustaa äläkä bluria vaan merkitse pinta.
 */

const MARKERS = /data-fr8-(pop|solid|bg)/;

/** Tiedostot joissa FR8:n tummaa lasia piirretään inline-tyyleillä. */
function sources(): string[] {
  const roots = [
    join(process.cwd(), "client/src/components/fr8"),
    join(process.cwd(), "client/src/pages/admin"),
  ];
  const out: string[] = [];
  for (const root of roots) {
    for (const name of readdirSync(root)) {
      const p = join(root, name);
      if (statSync(p).isDirectory()) continue;
      if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) out.push(p);
    }
  }
  return out;
}

/**
 * Onko tausta "kortin valkoinen kalvo"? Vain silloin mobiilinosto on oikein.
 * rgba(255,255,255,x) on kalvo; kaikki muu — musta himmennys, tumma valikko,
 * keltainen virhe — on tarkoituksellinen väri.
 */
function isCardWash(bg: string): boolean {
  const m = bg.match(/^rgba?\(\s*255\s*,\s*255\s*,\s*255\s*[,)]/);
  return !!m;
}

/**
 * Etsii JSX-elementit joilla on sekä `backdropFilter` että oma ei-valkoinen
 * `background`. Elementti luetaan `<`:sta sen tyyliobjektin loppuun asti, jotta
 * monelle riville taitettu tyyli ja eri rivillä oleva merkintä löytyvät samasta
 * elementistä.
 */
export function unmarkedSurfaces(src: string): { line: number; bg: string }[] {
  const hits: { line: number; bg: string }[] = [];
  // Jokainen elementin alku `<div`, `<span`, … ja sitä seuraavat ~40 riviä.
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*<[a-z]/.test(lines[i])) continue;
    // Elementin avaustagi päättyy `>`:aan joka ei ole nuolifunktion osa.
    let chunk = "";
    for (let j = i; j < Math.min(i + 40, lines.length); j++) {
      chunk += lines[j] + "\n";
      if (/^\s*(\/?>|>)\s*$/.test(lines[j]) || /[^=]>\s*$/.test(lines[j])) break;
    }
    if (!/backdropFilter/.test(chunk)) continue;
    const bg = chunk.match(/background(?:Color)?: "([^"]+)"/);
    if (!bg) continue;               // ei omaa taustaa → poletti hoitaa
    if (isCardWash(bg[1])) continue; // kortti → nosto on oikein
    if (MARKERS.test(chunk)) continue;
    hits.push({ line: i + 1, bg: bg[1] });
  }
  return hits;
}

describe("pintahygienia — ei-korttipinnat kantavat mobiilimerkinnän", () => {
  const files = sources();

  it("löytää lähteet (testi itse ei saa olla tyhjä)", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("jokainen tumma tai värillinen blur-pinta on merkitty", () => {
    const violations: string[] = [];
    for (const f of files) {
      for (const hit of unmarkedSurfaces(readFileSync(f, "utf8"))) {
        violations.push(`${f.replace(process.cwd() + "/", "")}:${hit.line} — background ${hit.bg}`);
      }
    }
    expect(
      violations,
      `Merkitsemätön blur-pinta (lisää data-fr8-pop / -bg):\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("tunnistaa rikkomuksen jos sellainen kirjoitetaan (vartija toimii)", () => {
    const dropdown = `
      <div
        style={{ position: "absolute", background: "rgba(16,16,20,0.94)", backdropFilter: "blur(24px)" }}
      >
    `;
    expect(unmarkedSurfaces(dropdown)).toHaveLength(1);

    const scrim = `
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)" }}>
    `;
    expect(unmarkedSurfaces(scrim)).toHaveLength(1);
  });

  it("ei valita kortista eikä merkitystä pinnasta", () => {
    const card = `
      <div style={{ background: "rgba(255,255,255,0.035)", backdropFilter: "blur(22px)" }}>
    `;
    expect(unmarkedSurfaces(card)).toEqual([]);

    const marked = `
      <div
        data-fr8-pop
        style={{ background: "rgba(16,16,20,0.94)", backdropFilter: "blur(24px)" }}
      >
    `;
    expect(unmarkedSurfaces(marked)).toEqual([]);

    const noBlur = `
      <div style={{ background: "rgba(16,16,20,0.94)" }}>
    `;
    expect(unmarkedSurfaces(noBlur)).toEqual([]);
  });
});
