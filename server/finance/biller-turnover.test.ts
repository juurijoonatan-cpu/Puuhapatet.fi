import { describe, expect, it } from "vitest";
import { computeBillerTurnover, type InternalInvoiceRow } from "./settlement";
import type { Job } from "@shared/schema";

/**
 * VARTIJA: yrittäjien väliset laskut kuuluvat lähettäjän liikevaihtoon.
 *
 * Johtajat jakavat urakan erät tarkoituksella keskenään, ettei kummankaan
 * liikevaihto ylitä ALV:n vähäisen toiminnan rajaa — ja siirtävät rahan
 * oikealle ansaitsijalle laskuttamalla TOISIAAN omilla Y-tunnuksillaan.
 * Lähetetty lasku on lähettäjän omaa myyntiä.
 *
 * Ennen tätä `computeBillerTurnover` sai vain `jobs`-rivit, joten juuri se
 * mekanismi jolla raha oikeasti liikkuu oli näkymätön — ja raja voi ylittyä
 * ilman että kortti varoittaa. Nämä testit lukitsevat sen ettei niin käy.
 */

function gigJob(payments: { cents: number; billerId?: string; year: number }[]): Job {
  return {
    id: 1, description: "Urakka", isCustomGig: true, status: "in_progress",
    gigData: JSON.stringify({
      version: 1, currency: "EUR", sectors: [], invoiceInterval: 100,
      invoicedThrough: 0, invoicedCents: 0, log: [], updatedAt: 0,
      payments: payments.map((p) => ({
        t: new Date(`${p.year}-06-01T00:00:00Z`).getTime(),
        countThrough: 0, amountCents: p.cents,
        ...(p.billerId ? { biller: { id: p.billerId } } : {}),
      })),
    }),
  } as unknown as Job;
}

function internal(rows: Partial<InternalInvoiceRow>[]): InternalInvoiceRow[] {
  return rows.map((r) => ({
    senderId: "matias", kind: "johtaja_valinen", tila: "lähetetty",
    totalCents: 72000, sentAt: new Date("2026-06-01T00:00:00Z"),
    createdAt: new Date("2026-06-01T00:00:00Z"), ...r,
  }));
}

const Y = "2026";

describe("computeBillerTurnover — yrittäjien väliset laskut", () => {
  it("ilman sisäisiä laskuja luku on ennallaan (pelkät asiakaslaskut)", () => {
    const t = computeBillerTurnover([gigJob([
      { cents: 457500, billerId: "joonatan", year: 2026 },
      { cents: 157500, billerId: "matias", year: 2026 },
    ])]);
    expect(t.turnoverByYear[Y].joonatan).toBe(457500);
    expect(t.turnoverByYear[Y].matias).toBe(157500);
    expect(t.customerByYear[Y].matias).toBe(157500);
    expect(t.internalByYear[Y]).toBeUndefined();
  });

  it("lähetetty tasauslasku kasvattaa LÄHETTÄJÄN liikevaihtoa", () => {
    // Ruudulta luettu tilanne: Matias laskuttaa Joonatanilta 720 €.
    const t = computeBillerTurnover(
      [gigJob([
        { cents: 457500, billerId: "joonatan", year: 2026 },
        { cents: 157500, billerId: "matias", year: 2026 },
      ])],
      internal([{ senderId: "matias", totalCents: 72000 }]),
    );
    expect(t.turnoverByYear[Y].matias).toBe(157500 + 72000);   // 2 295,00 €
    expect(t.customerByYear[Y].matias).toBe(157500);
    expect(t.internalByYear[Y].matias).toBe(72000);
    // Maksajalta ei vähennetä mitään: osto ei ole negatiivista liikevaihtoa.
    expect(t.turnoverByYear[Y].joonatan).toBe(457500);
  });

  it("luonnos ei ole lasku eikä kerrytä rajaa", () => {
    const t = computeBillerTurnover([], internal([{ tila: "luonnos" }]));
    expect(t.internalByYear[Y]).toBeUndefined();
    expect(t.turnoverByYear[Y]).toBeUndefined();
  });

  it("hyväksytty lasku lasketaan mukaan", () => {
    const t = computeBillerTurnover([], internal([{ tila: "hyväksytty" }]));
    expect(t.internalByYear[Y].matias).toBe(72000);
  });

  it("tekijän lasku EI ole johtajan liikevaihtoa — se on kulu", () => {
    const t = computeBillerTurnover([], internal([{ kind: "tekija", senderId: "jani" }]));
    expect(t.turnoverByYear[Y]).toBeUndefined();
  });

  it("tuntematon lähettäjä ei luo haamuriviä", () => {
    const t = computeBillerTurnover([], internal([{ senderId: "ei-ketaan" }]));
    expect(t.turnoverByYear[Y]).toBeUndefined();
  });

  it("vuosi luetaan laskun lähetyshetkestä", () => {
    const t = computeBillerTurnover([], internal([
      { sentAt: new Date("2025-12-31T00:00:00Z") },
      { sentAt: new Date("2026-01-01T00:00:00Z") },
    ]));
    expect(t.internalByYear["2025"].matias).toBe(72000);
    expect(t.internalByYear["2026"].matias).toBe(72000);
  });

  it("kirjattu maksu ilman laskua raportoidaan mutta EI summata (ei tuplausta)", () => {
    // Sama tapahtuma on kahdessa taulussa. Yhteenlasku tuplaisi liikevaihdon,
    // joten laskurivit voittavat ja ero kerrotaan erikseen.
    const withInvoice = computeBillerTurnover([], internal([{ totalCents: 72000 }]), 72000);
    expect(withInvoice.turnoverByYear[Y].matias).toBe(72000);
    expect(withInvoice.settledWithoutInvoiceCents).toBe(0);

    const withoutInvoice = computeBillerTurnover([], [], 50000);
    expect(withoutInvoice.turnoverByYear[Y]).toBeUndefined();
    expect(withoutInvoice.settledWithoutInvoiceCents).toBe(50000);
  });

  it("laskuttajaa vailla oleva erä ei kuulu kenellekään mutta raportoidaan", () => {
    const t = computeBillerTurnover([gigJob([{ cents: 157500, year: 2026 }])]);
    expect(t.turnoverByYear[Y]).toBeUndefined();
    expect(t.unassignedEras).toHaveLength(1);
    expect(t.unassignedEras[0].cents).toBe(157500);
  });

  it("kokonaisluku on aina asiakaslaskut + sisäiset laskut", () => {
    const t = computeBillerTurnover(
      [gigJob([{ cents: 100000, billerId: "joonatan", year: 2026 }])],
      internal([{ senderId: "joonatan", totalCents: 25000 }]),
    );
    const total = t.turnoverByYear[Y].joonatan;
    expect(total).toBe((t.customerByYear[Y].joonatan ?? 0) + (t.internalByYear[Y].joonatan ?? 0));
    expect(total).toBe(125000);
  });
});

describe("computeBillerTurnover — kohdentamaton ja hylätty", () => {
  it("keikka jonka laskuttaja EI ole brändin laskuttaja ei katoa kortilta", () => {
    // Ehto oli aiemmin `else if (!row.billedBy)`, joten `billedBy` joka osoitti
    // johonkin muuhun Y-tunnukseen katosi kokonaan: ei kenenkään
    // liikevaihdossa eikä kohdentamattomien listalla. Hiljaa kadonnutta rahaa.
    const job = {
      id: 9, description: "Pikkukeikka", isCustomGig: false, gigData: null,
      status: "done", quoteStatus: null, agreedPrice: 30000,
      billedBy: "joku-muu", assignedTo: "joku-muu",
      scheduledAt: new Date("2026-05-05T00:00:00Z"), createdAt: new Date("2026-05-05T00:00:00Z"),
    } as unknown as Job;
    const t = computeBillerTurnover([job]);
    expect(t.turnoverByYear[Y]).toBeUndefined();          // ei kenenkään
    expect(t.unassignedByYear[Y].cents).toBe(30000);      // mutta näkyvissä
    expect(t.unassignedByYear[Y].count).toBe(1);
  });

  it("lähetetty mutta hylätty sisäinen lasku raportoidaan erikseen, ei summassa", () => {
    const t = computeBillerTurnover([], internal([
      { tila: "hylätty", totalCents: 50000, sentAt: new Date("2026-06-01T00:00:00Z") },
      { tila: "lähetetty", totalCents: 72000 },
    ]));
    expect(t.internalByYear[Y].matias).toBe(72000);  // vain lähetetty
    expect(t.rejectedButSentCents).toBe(50000);      // hylätty näkyy erikseen
  });

  it("hylätty luonnos (ei lähetetty) ei ole tosite eikä sitä raportoida", () => {
    const t = computeBillerTurnover([], internal([{ tila: "hylätty", sentAt: null }]));
    expect(t.rejectedButSentCents).toBe(0);
    expect(t.turnoverByYear[Y]).toBeUndefined();
  });
});
