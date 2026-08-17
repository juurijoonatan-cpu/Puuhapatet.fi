/**
 * VARTIJA: urakkakeikan ALIHANKKIJAKULU kirjautuu kirjanpitoon.
 *
 * `buildDraftEntries` kirjasi jokaisen asiakaserän kokonaan myynniksi (3000)
 * eikä veloittanut tekijöiden palkkaa lainkaan. Perusteluna oli että palkka
 * "on jo netotettu pois katteessa" — mutta kirjaussääntö kirjaa BRUTON erän,
 * ei katetta, joten laskuttavan johtajan tuloslaskelma näytti koko
 * urakkasumman tuloksena. Mittaluokka lippulaivakeikassa: 6 150 € laskutettua,
 * josta 5 576,50 € on tekijöiden palkkaa ja johtajien yhteinen kate 573,50 €.
 *
 * Nämä testit lukitsevat sen ettei kulu voi taas kadota:
 *   1. sama erä tuottaa SEKÄ myynnin että kulun, samaan kirjanpitoon,
 *   2. joka vienti täsmää (debet = kredit),
 *   3. avaimet ovat vakaat → uudelleenajo ei tuota duplikaattia,
 *   4. punaiset (P1) ja keltaiset (P2) lasketaan kumpikin kertaalleen,
 *   5. tuntematon ostaja ei päädy kenenkään kirjanpitoon (invariantti 18).
 */
import { describe, expect, it } from "vitest";

// Vientisäännöt luetaan `draft-entries.ts`:stä, joka EI importtaa `server/db.ts`:ää.
// Siksi tämä testi ei tarvitse kantaa eikä sen mockaamista — sama lupaus kuin
// muualla server-testeissä (ks. `query-hygiene.test.ts`, `biller-turnover.test.ts`).
// `post.ts` itse on kirjaaja ja importtaa poolin; se ei kuulu tähän testiin.
import { buildDraftEntries, type WorkerInvoiceRow } from "./draft-entries";
import type { Job } from "@shared/schema";

type Draft = ReturnType<typeof buildDraftEntries>[number];

const J = "joonatan";
const M = "matias";
const ms = (iso: string) => new Date(iso).getTime();

/** Urakkakeikka jonka asiakaserät ovat `gigData.payments`-listassa. */
function gigJob(
  payments: { cents: number; billerId?: string; t: string; scope?: "p1" | "p2"; voided?: boolean }[],
  over: Partial<Job> = {},
): Job {
  return {
    id: 1, description: "FR8", isCustomGig: true, status: "in_progress",
    gigData: JSON.stringify({
      version: 1, currency: "EUR", sectors: [], invoiceInterval: 100,
      invoicedThrough: 0, invoicedCents: 0, log: [], updatedAt: 0,
      company: { name: "Kiinteistö Oy FR8" },
      payments: payments.map((p) => ({
        t: ms(p.t), countThrough: 0, amountCents: p.cents,
        ...(p.billerId ? { biller: { id: p.billerId } } : {}),
        ...(p.scope ? { scope: p.scope } : {}),
        ...(p.voided ? { voided: true } : {}),
      })),
    }),
    ...over,
  } as unknown as Job;
}

/**
 * Tekijän erälasku. Oletus: lähetetty punaisten erälasku Joonatanille, jonka
 * BRUTTO (`rivit.computed.ansaittuCents`) on eri kuin maksettava `totalCents` —
 * juuri se ero jonka takia kulun pitää lukea brutto.
 */
function workerInvoice(over: Partial<WorkerInvoiceRow> & { id: number }): WorkerInvoiceRow {
  const grossCents = over.rivit?.computed?.ansaittuCents ?? 68000;
  return {
    jobId: 1, kind: "tekija", tila: "lähetetty", senderId: "jani",
    recipientId: J, eraNumbers: [1, 2, 3],
    rivit: { input: { name: "Jani", pestytIkkunat: 34 }, computed: { ansaittuCents: grossCents } },
    totalCents: grossCents,
    sentAt: new Date("2026-05-15T00:00:00Z"),
    createdAt: new Date("2026-05-10T00:00:00Z"),
    ...over,
  };
}

/** Yhden tilin debet-summa yhdessä kirjanpidossa (kulut/varat: debet-positiivinen). */
function debit(drafts: Draft[], ledgerId: string, code: string): number {
  return drafts.filter((d) => d.ledgerId === ledgerId)
    .flatMap((d) => d.lines).filter((l) => l.accountCode === code)
    .reduce((s, l) => s + (l.debitCents ?? 0), 0);
}

/** Yhden tilin kredit-summa yhdessä kirjanpidossa (tuotot: kredit-positiivinen). */
function credit(drafts: Draft[], ledgerId: string, code: string): number {
  return drafts.filter((d) => d.ledgerId === ledgerId)
    .flatMap((d) => d.lines).filter((l) => l.accountCode === code)
    .reduce((s, l) => s + (l.creditCents ?? 0), 0);
}

const build = (jobs: Job[], invoices: WorkerInvoiceRow[] = []) =>
  buildDraftEntries(jobs, [], [], [], invoices);

const SALES = "3000";
const PURCHASES = "4000";
const PURCHASES_INTERNAL = "4010";
const BANK = "1910";

describe("buildDraftEntries — urakkakeikan alihankkijakulu", () => {
  it("erä tuottaa SEKÄ myynnin kreditin että alihankkijakulun debetin, samaan kirjanpitoon", () => {
    // Tämä on koko vika yhtenä testinä: ennen korjausta 4000 oli nolla ja
    // Joonatanin tulos näytti koko 4 575 €:n erän.
    const drafts = build(
      [gigJob([{ cents: 457500, billerId: J, t: "2026-05-01" }])],
      [workerInvoice({ id: 7, rivit: { input: { name: "Jani" }, computed: { ansaittuCents: 156000 } } })],
    );
    expect(credit(drafts, J, SALES)).toBe(457500);
    expect(debit(drafts, J, PURCHASES)).toBe(156000);
    // Pankki näkee molemmat puolet: raha tuli sisään ja lähti tekijälle.
    expect(debit(drafts, J, BANK)).toBe(457500);
    expect(credit(drafts, J, BANK)).toBe(156000);
    // Kulu EI ole yrittäjien välinen osto — tekijä on ulkopuolinen alihankkija.
    expect(debit(drafts, J, PURCHASES_INTERNAL)).toBe(0);
  });

  it("kulu on oma vientinsä laskun päivällä, ei erän päivällä", () => {
    // Tekijän lasku on oma tosite. Suoriteperuste: kulu kirjataan laskun
    // (lukitus)hetkelle — ei pankkisiirron hetkelle, jota järjestelmä ei tiedä.
    const drafts = build(
      [gigJob([{ cents: 157500, billerId: J, t: "2026-05-01" }])],
      [workerInvoice({ id: 7, sentAt: new Date("2026-06-20T00:00:00Z") })],
    );
    const cost = drafts.find((d) => d.sourceKey === "job:1:tekijalasku:7");
    expect(cost?.date.toISOString()).toBe("2026-06-20T00:00:00.000Z");
    expect(cost?.description).toContain("Jani");
    // Lähetysaika puuttuessa palataan luontihetkeen, ei nykyhetkeen.
    const noSentAt = build([gigJob([{ cents: 157500, billerId: J, t: "2026-05-01" }])],
      [workerInvoice({ id: 8, sentAt: null })]);
    expect(noSentAt.find((d) => d.sourceKey === "job:1:tekijalasku:8")?.date.toISOString())
      .toBe("2026-05-10T00:00:00.000Z");
  });

  it("kulu luetaan BRUTOSTA eikä ennakolla vähennetystä maksettavasta", () => {
    // `totalCents` = ansaittu − ennakko. Jos kulu luettaisiin siitä, jo maksettu
    // ennakko jäisi kokonaan kirjanpidon ulkopuolelle ja kate näyttäisi liikaa.
    const drafts = build(
      [gigJob([{ cents: 157500, billerId: J, t: "2026-05-01" }])],
      [workerInvoice({
        id: 7, totalCents: 50000,
        rivit: { input: { name: "Jani" }, computed: { ansaittuCents: 68000 } },
      })],
    );
    expect(debit(drafts, J, PURCHASES)).toBe(68000);
  });

  it("jokainen vienti täsmää: Σ debet === Σ kredit", () => {
    const drafts = build(
      [gigJob([
        { cents: 457500, billerId: J, t: "2026-05-01" },
        { cents: 157500, billerId: M, t: "2026-06-01" },
        { cents: 42000, billerId: J, t: "2026-06-15", scope: "p2" },
      ])],
      [
        workerInvoice({ id: 1, recipientId: J }),
        workerInvoice({ id: 2, recipientId: M, eraNumbers: [4] }),
        workerInvoice({ id: 3, recipientId: J, eraNumbers: [0], senderId: "milja" }),
      ],
    );
    expect(drafts.length).toBeGreaterThan(0);
    for (const d of drafts) {
      const deb = d.lines.reduce((s, l) => s + (l.debitCents ?? 0), 0);
      const cre = d.lines.reduce((s, l) => s + (l.creditCents ?? 0), 0);
      expect(deb, d.sourceKey).toBe(cre);
      expect(deb).toBeGreaterThan(0);
    }
  });
});

describe("buildDraftEntries — idempotenssi", () => {
  it("kahdesti ajettu rakennus tuottaa täsmälleen samat avaimet, ei duplikaatteja", () => {
    // `rebuildLedgers()` ajetaan JOKAISELLA /api/finance-pyynnöllä ja viennit
    // dedupataan `(ledgerId, sourceKey)`-uniikkirajoitteella. Jos avain heiluisi
    // (esim. juokseva indeksi tai aikaleima), uudelleenajo joko kaatuisi
    // rajoitteeseen tai tuottaisi saman kulun kahdesti.
    const jobs = [gigJob([
      { cents: 457500, billerId: J, t: "2026-05-01" },
      { cents: 157500, billerId: M, t: "2026-06-01" },
    ])];
    const invoices = [
      workerInvoice({ id: 11, recipientId: J }),
      workerInvoice({ id: 12, recipientId: M, eraNumbers: [4] }),
    ];
    const key = (d: Draft) => `${d.ledgerId}|${d.sourceKey}`;
    const first = build(jobs, invoices).map(key);
    const second = build(jobs, invoices).map(key);
    expect(second).toEqual(first);
    expect(new Set(first).size).toBe(first.length);
    expect(first).toContain(`${J}|job:1:tekijalasku:11`);
    expect(first).toContain(`${M}|job:1:tekijalasku:12`);
  });

  it("kulun avain ei törmää asiakaserän eikä kulukirjauksen avaimeen", () => {
    // "job:1:era:0" (asiakaserä) ja "expense:1" (kuitti) ovat eri avaimia kuin
    // "job:1:tekijalasku:1", vaikka id-numerot ovat samat.
    const drafts = build(
      [gigJob([{ cents: 157500, billerId: J, t: "2026-05-01" }])],
      [workerInvoice({ id: 1 })],
    );
    const keys = drafts.map((d) => d.sourceKey);
    expect(keys).toContain("job:1:era:0");
    expect(keys).toContain("job:1:tekijalasku:1");
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("buildDraftEntries — punaiset ja keltaiset eivät kaksinkerry", () => {
  it("P1-erälasku ja P2-potti kirjautuvat kumpikin KERTAALLEEN", () => {
    // Kaksi rahavirtaa, kaksi laskua, kaksi vientiä. Kumpikin summa saa esiintyä
    // tasan kerran: yhteensä 68 000 + 24 000, ei 2 × kumpaakaan eikä ristiin.
    const drafts = build(
      [gigJob([
        { cents: 157500, billerId: J, t: "2026-05-01" },
        { cents: 42000, billerId: J, t: "2026-06-15", scope: "p2" },
      ])],
      [
        workerInvoice({ id: 21, eraNumbers: [1, 2, 3], rivit: { input: { name: "Jani" }, computed: { ansaittuCents: 68000 } } }),
        workerInvoice({ id: 22, eraNumbers: [0], senderId: "milja", rivit: { input: { name: "Milja" }, computed: { ansaittuCents: 24000 } } }),
      ],
    );
    const costs = drafts.filter((d) => d.sourceKey.includes(":tekijalasku:"));
    expect(costs).toHaveLength(2);
    expect(debit(drafts, J, PURCHASES)).toBe(68000 + 24000);
    // Myyntipuoli: punaisten erä ja keltaisten lasku ovat molemmat myyntiä,
    // kumpikin kertaalleen (keltainen ei kuluta punaisten erälaskuria).
    expect(credit(drafts, J, SALES)).toBe(157500 + 42000);
    // Selite erottaa rahavirrat, jotta päiväkirjasta näkee kumpi on kumpi.
    expect(costs.map((c) => c.description).join(" ")).toContain("keltaiset");
    expect(costs.map((c) => c.description).join(" ")).toContain("erä 1+2+3");
  });

  it("mitätöity erä ei ole myyntiä, mutta tekijän lasku on yhä kulu", () => {
    // Mitätöity laskutuserä jää tositteeksi mutta ei mihinkään summaan
    // (`livePayments`). Tekijälle luvattu palkka ei katoa sen mukana.
    const drafts = build(
      [gigJob([
        { cents: 157500, billerId: J, t: "2026-05-01", voided: true },
        { cents: 157500, billerId: J, t: "2026-05-02" },
      ])],
      [workerInvoice({ id: 31 })],
    );
    expect(credit(drafts, J, SALES)).toBe(157500);
    expect(debit(drafts, J, PURCHASES)).toBe(68000);
  });
});

describe("buildDraftEntries — mitä EI kirjata", () => {
  it("keikka ilman tekijälaskuja ei tuota yhtään kulukirjausta", () => {
    const drafts = build([gigJob([{ cents: 157500, billerId: J, t: "2026-05-01" }])]);
    expect(drafts.filter((d) => d.sourceKey.includes(":tekijalasku:"))).toHaveLength(0);
    expect(debit(drafts, J, PURCHASES)).toBe(0);
    expect(debit(drafts, M, PURCHASES)).toBe(0);
    expect(credit(drafts, J, SALES)).toBe(157500);
  });

  it("tuntematon ostaja: kulua ei arvata kummallekaan johtajalle", () => {
    // Invariantti 18 — kohdentamaton raha ei kuulu kenellekään. Sama sääntö kuin
    // laskuttajattomalla asiakaserällä, joka ei myöskään kirjaudu myyntinä.
    const drafts = build(
      [gigJob([{ cents: 157500, t: "2026-05-01" }])], // ei laskuttajaa
      [workerInvoice({ id: 41, recipientId: "tuntematon" }), workerInvoice({ id: 42, recipientId: "" })],
    );
    expect(drafts).toHaveLength(0);
  });

  it("luonnos ja hylätty lasku eivät ole kuluja — vain lähetetty/hyväksytty on tosite", () => {
    // Luonnos odottaa vielä tekijän kuittausta; hylätty lasku ei koskaan
    // syntynyt. Kirjaus vain tositteesta.
    const jobs = [gigJob([{ cents: 157500, billerId: J, t: "2026-05-01" }])];
    expect(debit(build(jobs, [workerInvoice({ id: 51, tila: "luonnos" })]), J, PURCHASES)).toBe(0);
    expect(debit(build(jobs, [workerInvoice({ id: 52, tila: "hylätty" })]), J, PURCHASES)).toBe(0);
    expect(debit(build(jobs, [workerInvoice({ id: 53, tila: "hyväksytty" })]), J, PURCHASES)).toBe(68000);
  });

  it("johtajien välinen erälasku ei ole alihankkijakulu", () => {
    // `kind: "johtaja_valinen"` kulkee `founder_settlements`-vientien kautta
    // (4010/3010). Jos se luettaisiin tästäkin, sama euro olisi kahdesti kuluna.
    const drafts = build(
      [gigJob([{ cents: 157500, billerId: J, t: "2026-05-01" }])],
      [workerInvoice({ id: 61, kind: "johtaja_valinen", senderId: M, recipientId: J })],
    );
    expect(debit(drafts, J, PURCHASES)).toBe(0);
  });

  it("nolla- tai negatiivinen brutto ei tuota vientiä", () => {
    // Sovittu vähennys voi nollata laskun. Nollavienti olisi pelkkää kohinaa.
    const drafts = build(
      [gigJob([{ cents: 157500, billerId: J, t: "2026-05-01" }])],
      [workerInvoice({ id: 71, rivit: { input: { name: "Jani" }, computed: { ansaittuCents: 0 } } })],
    );
    expect(drafts.filter((d) => d.sourceKey.includes(":tekijalasku:"))).toHaveLength(0);
  });
});

describe("buildDraftEntries — kumpi kirjanpito kantaa kulun", () => {
  it("kulu menee sille johtajalle jonka lasku nimeää OSTAJAKSI", () => {
    // Erän laskutti Joonatan, mutta tekijän lasku osoitettiin Matiakselle
    // (todellinen maksaja). Tosite nimeää ostajan, joten osto kuuluu hänen
    // kirjanpitoonsa; johtajien keskinäinen oikaisu kulkee erikseen
    // `founder_settlements`-vienteinä (invariantti 16).
    const drafts = build(
      [gigJob([{ cents: 457500, billerId: J, t: "2026-05-01" }])],
      [workerInvoice({ id: 81, recipientId: M })],
    );
    expect(credit(drafts, J, SALES)).toBe(457500);
    expect(debit(drafts, J, PURCHASES)).toBe(0);
    expect(debit(drafts, M, PURCHASES)).toBe(68000);
  });

  it("erän mukaan reititetty lasku päätyy samaan kirjanpitoon kuin erän myynti", () => {
    // Oletusreititys (erät 1–3 → Joonatan, erä 4 → Matias) on sama kuin erien
    // laskuttajat, joten kummankin tuloslaskelmassa tulo ja kulu kohtaavat.
    const drafts = build(
      [gigJob([
        { cents: 457500, billerId: J, t: "2026-05-01" },
        { cents: 157500, billerId: M, t: "2026-06-01" },
      ])],
      [
        workerInvoice({ id: 91, recipientId: J, eraNumbers: [1, 2, 3], rivit: { input: { name: "Jani" }, computed: { ansaittuCents: 120000 } } }),
        workerInvoice({ id: 92, recipientId: M, eraNumbers: [4], rivit: { input: { name: "Jani" }, computed: { ansaittuCents: 36000 } } }),
      ],
    );
    expect(credit(drafts, J, SALES) - debit(drafts, J, PURCHASES)).toBe(457500 - 120000);
    expect(credit(drafts, M, SALES) - debit(drafts, M, PURCHASES)).toBe(157500 - 36000);
  });
});

describe("buildDraftEntries — mitä tuloslaskelmaan jää yhä kirjaamatta", () => {
  it("vain LASKUTETTU tekijävelka on kulua; laskuttamaton varaus ei näy (tiedostettu)", () => {
    // Lippulaivakeikan muoto: 6 150 € laskutettu asiakkaalta, mutta tekijöiden
    // erälaskuja on lähetetty vasta 1 560 €. Loppu (`reserveCents`, ~3 636,50 €)
    // on tekijöille kuuluvaa rahaa jolle EI ole tositetta, ja sen ainoa lähde on
    // karttablobi jota tämä kirjaaja ei tarkoituksella lue.
    //
    // Tämä testi lukitsee sen mitä kirjanpito nyt VÄITTÄÄ, jottei kukaan lue
    // tulosta katteena: 6 150 − 1 560 = 4 590 € ei ole johtajien katetta
    // (573,50 €) vaan tulos jossa laskuttamaton tekijävelka on yhä kirjaamatta.
    // Jaksotus on kirjanpitäjän päätös, ks. docs/talous-kirjanpito.md.
    const drafts = build(
      [gigJob([
        { cents: 457500, billerId: J, t: "2026-05-01" },
        { cents: 157500, billerId: M, t: "2026-06-01" },
      ])],
      [
        workerInvoice({ id: 101, recipientId: J, rivit: { input: { name: "Jani" }, computed: { ansaittuCents: 118000 } } }),
        workerInvoice({ id: 102, recipientId: M, eraNumbers: [4], rivit: { input: { name: "Jani" }, computed: { ansaittuCents: 38000 } } }),
      ],
    );
    const salesTotal = credit(drafts, J, SALES) + credit(drafts, M, SALES);
    const purchasesTotal = debit(drafts, J, PURCHASES) + debit(drafts, M, PURCHASES);
    expect(salesTotal).toBe(615000);
    expect(purchasesTotal).toBe(156000);
    expect(salesTotal - purchasesTotal).toBe(459000);
  });
});
