import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

/**
 * VARTIJA. Sääntö "älä lue `jobs`-taulua ilman sarakerajausta" on ollut
 * kirjattuna dokumenttiin jo kertaalleen — ja siitä huolimatta koodissa oli
 * 27 rikkomusta kun ne laskettiin. Dokumentti ei estä mitään; tämä estää.
 *
 * Miksi juuri `jobs`: sen rivissä on kaksi monen megatavun JSON-blobia
 * (`project_data`, `gig_data`) sekä kolme kuvakenttää. Yksi rajaamaton
 * `select()` vetää ne kaikki kannasta ulos, ja Neon laskee juuri sen
 * liikenteekseen. Se maksoi kerran koko kuukauden kiintiön puolessatoista
 * vuorokaudessa.
 *
 * Jos tämä testi kaatuu: älä lisää poikkeusta. Käytä `loadJobRow()`:ta tai
 * jotain valmiista projektioista (`JOB_COLS`, `CREW_JOB_COLS`, `MONEY_JOB_COLS`),
 * tai kirjoita kutsuun tarvitsemasi kentät.
 */

function serverFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...serverFiles(p));
    else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p);
  }
  return out;
}

/** Rivit joilla luetaan `jobs` ilman sarakelistaa. Kommentit eivät laske. */
function unprojectedJobReads(src: string): { line: number; text: string }[] {
  const hits: { line: number; text: string }[] = [];
  src.split("\n").forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
    if (/\.select\(\)\s*\.from\(jobs\)/.test(code)) hits.push({ line: i + 1, text: line.trim() });
  });
  return hits;
}

describe("kyselyhygienia — jobs-taulua ei lueta rajaamattomana", () => {
  const files = serverFiles(join(process.cwd(), "server"));

  it("löytää palvelinlähteet (testi itse ei saa olla tyhjä)", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("yksikään palvelintiedosto ei kutsu db.select().from(jobs)", () => {
    const violations: string[] = [];
    for (const f of files) {
      for (const hit of unprojectedJobReads(readFileSync(f, "utf8"))) {
        violations.push(`${f.replace(process.cwd() + "/", "")}:${hit.line} — ${hit.text}`);
      }
    }
    expect(violations, `Rajaamaton jobs-luku:\n${violations.join("\n")}`).toEqual([]);
  });

  it("tunnistaa rikkomuksen jos sellainen kirjoitetaan (vartija toimii)", () => {
    expect(unprojectedJobReads("const x = await db.select().from(jobs);")).toHaveLength(1);
    // Kommentti ei ole rikkomus.
    expect(unprojectedJobReads("// db.select().from(jobs) oli ennen tässä")).toHaveLength(0);
    expect(unprojectedJobReads(" * `db.select().from(jobs)` veti blobit")).toHaveLength(0);
    // Rajattu kutsu on kunnossa.
    expect(unprojectedJobReads("await db.select(JOB_COLS).from(jobs);")).toHaveLength(0);
  });
});
