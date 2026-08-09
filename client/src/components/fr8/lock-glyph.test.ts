import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

/**
 * VARTIJA. Lukkokuvake saa kertoa vain TILAN, ei tekoa.
 *
 * Kerrosvalitsimeen lisättiin nappi, joka näytti sen teon joka napista
 * tapahtuisi: avoimessa kerroksessa 🔒 ("lukitse tämä") ja lukitussa 🔓
 * ("avaa tämä"). Ruudulla se luki päinvastoin kuin tarkoitettiin — kuudesta
 * kerroksesta viisi oli auki, ja jokaisessa niistä komeili lukko. Rivi näytti
 * siltä että koko talo on lukossa.
 *
 * SÄÄNTÖ: kun lukkokuvake piirretään ehdollisesti "onko lukossa" -tiedon
 * perusteella, kuvake kuuluu vain lukitun haaraan, ja siinä haarassa se on
 * suljettu lukko. Auki-haarassa ei ole lukkoa lainkaan, eikä lukitussa
 * haarassa avointa lukkoa. Teko kerrotaan sanoilla ("Lukitse krs 2"), ei
 * kuvakkeella.
 */

const CLOSED = "\u{1F512}"; // 🔒
const OPEN = "\u{1F513}";   // 🔓

/** Ehdollinen lukkokuvake: `<ehto> ? <a> : <b>` samalla rivillä. */
const TERNARY = /(!?)\s*([A-Za-z0-9_.[\]?]*[Ll]ocked[A-Za-z0-9_.[\]?]*)\s*\?([^:]{0,90}):([^\n]{0,90})/;

export function lockGlyphViolations(src: string): { line: number; why: string }[] {
  const out: { line: number; why: string }[] = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes(CLOSED) && !line.includes(OPEN)) continue;
    const m = line.match(TERNARY);
    if (!m) continue; // ei lukkoehtoon sidottu kuvake — ei tämän säännön asia
    const negated = m[1] === "!";
    const whenLocked = negated ? m[4] : m[3];
    const whenOpen = negated ? m[3] : m[4];
    if (whenOpen.includes(CLOSED) || whenOpen.includes(OPEN)) {
      out.push({ line: i + 1, why: "lukkokuvake näkyy kun kerros EI ole lukossa" });
    }
    if (whenLocked.includes(OPEN)) {
      out.push({ line: i + 1, why: "avoin lukko näkyy kun kerros ON lukossa" });
    }
  }
  return out;
}

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { sources(p, out); continue; }
    if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("lukkokuvake kertoo tilan, ei tekoa", () => {
  const files = sources(join(process.cwd(), "client/src"));

  it("löytää lähteet (testi itse ei saa olla tyhjä)", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("yksikään näkymä ei näytä lukkoa avoimesta kerroksesta", () => {
    const violations: string[] = [];
    for (const f of files) {
      for (const hit of lockGlyphViolations(readFileSync(f, "utf8"))) {
        violations.push(`${f.replace(process.cwd() + "/", "")}:${hit.line} — ${hit.why}`);
      }
    }
    expect(violations, `Lukkokuvake väärässä haarassa:\n${violations.join("\n")}`).toEqual([]);
  });

  it("tunnistaa rikkomuksen jos sellainen kirjoitetaan (vartija toimii)", () => {
    // Juuri se nappi joka rikkoi kerrosrivin: kuvake kertoi teon.
    expect(lockGlyphViolations(`  {gLocked ? "${OPEN}" : "${CLOSED}"}`)).toHaveLength(2);
    // Sama käänteisenä ehtona.
    expect(lockGlyphViolations(`  {!isLocked ? "${CLOSED}" : "${OPEN}"}`)).toHaveLength(2);
    // Pelkkä lukko auki-haarassa riittää.
    expect(lockGlyphViolations("  {floorLocked ? f : `" + CLOSED + "${f}`}")).toHaveLength(1);
  });

  it("ei valita oikein päin olevasta kuvakkeesta", () => {
    expect(lockGlyphViolations("  {gLocked ? `" + CLOSED + "${f}` : f}")).toEqual([]);
    // Staattinen merkki, ei sidottu lukkotilaan → ei tämän säännön asia.
    expect(lockGlyphViolations(`  <span>${CLOSED} Vastuuvakuutettu</span>`)).toEqual([]);
  });
});
