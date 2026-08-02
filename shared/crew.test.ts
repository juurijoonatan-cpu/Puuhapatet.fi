import { describe, expect, it } from "vitest";
import {
  sanitizeCrewMember, MAX_PAYOUTS_KEPT, MIN_UNTOUCHED_PAYOUTS_KEPT, MAX_CREW_DOC_LEN,
} from "./crew";

// Nämä testit vartioivat kirjanpidon tositteita. Jokainen niistä vastaa
// virheeseen joka OIKEASTI oli koodissa ja tuhosi dataa hiljaa — ks.
// docs/datakartoitus-ja-korjaussuunnitelma.md, OSA 1.

function member(extra: Record<string, unknown> = {}) {
  return sanitizeCrewMember({
    id: "jani", token: "tok_jani_1", name: "Jani Testi",
    role: "worker", active: true, perWindowCents: 100,
    agreements: [], notes: [], createdAt: 1,
    ...extra,
  })!;
}

function payout(i: number, extra: Record<string, unknown> = {}) {
  return {
    id: `p${i}`, amountCents: 1000, windows: 10,
    status: "ilmoitettu", createdAt: 1000 + i, ...extra,
  };
}

function doc(i: number, extra: Record<string, unknown> = {}) {
  return { id: `d${i}`, date: 1000 + i, desc: `Tosite ${i}`, amountCents: 100, ...extra };
}

describe("tositteet eivät katoa — dokumentit", () => {
  it("säilyttää KAIKKI dokumentit vaikka niitä olisi yli entinen 200:n katto", () => {
    const m = member({ documents: Array.from({ length: 250 }, (_, i) => doc(i)) });
    expect(m.documents).toHaveLength(250);
  });

  it("vanhin tosite säilyy — lista on uusin-ensin, ja juuri vanhimmat katosivat ennen", () => {
    // attachPersonDocument lisää uuden ALKUUN, joten indeksi 249 on vanhin.
    const docs = Array.from({ length: 250 }, (_, i) => doc(249 - i));
    const m = member({ documents: docs });
    expect(m.documents!.some((d) => d.desc === "Tosite 0")).toBe(true);
    expect(m.documents!.at(-1)!.desc).toBe("Tosite 0");
  });

  it("jokaiselle dokumentille asetetaan 6 vuoden säilytyspäivä", () => {
    const m = member({ documents: [doc(1, { date: Date.parse("2026-01-15") })] });
    const kept = m.documents![0];
    expect(kept.retentionUntil).toBeGreaterThan(kept.date);
    // ~6 vuotta karkausvuodat huomioiden.
    const years = (kept.retentionUntil - kept.date) / (365.25 * 24 * 3600 * 1000);
    expect(years).toBeGreaterThan(5.9);
    expect(years).toBeLessThan(6.1);
  });
});

describe("tositteet eivät katoa — ylikokoinen liite", () => {
  const big = "data:application/pdf;base64," + "A".repeat(MAX_CREW_DOC_LEN);

  it("ylikokoista liitettä EI katkaista puolivälistä avautumattomaksi", () => {
    const m = member({ documents: [doc(1, { fileDataUrl: big, fileName: "iso.pdf" })] });
    const kept = m.documents![0];
    // Aiemmin tämä oli `big.slice(0, MAX_CREW_DOC_LEN)` — rikkinäinen base64
    // joka näytti tallentuneelta mutta ei avautunut.
    expect(kept.fileDataUrl).toBeUndefined();
  });

  it("metadata säilyy vaikka liite jää pois, jotta puuttuminen näkyy", () => {
    const m = member({ documents: [doc(1, { fileDataUrl: big, fileName: "iso.pdf" })] });
    expect(m.documents![0].desc).toBe("Tosite 1");
    expect(m.documents![0].fileName).toBe("iso.pdf");
  });

  it("sallitun kokoinen liite säilyy tavulleen", () => {
    const ok = "data:application/pdf;base64," + "A".repeat(1000);
    const m = member({ documents: [doc(1, { fileDataUrl: ok })] });
    expect(m.documents![0].fileDataUrl).toBe(ok);
  });
});

describe("maksut eivät katoa", () => {
  it("maksettu maksu ei putoa katon takia", () => {
    const payouts = [
      ...Array.from({ length: MAX_PAYOUTS_KEPT + 30 }, (_, i) =>
        payout(i, { status: "maksettu", paidAt: 5, invoiceNo: `L${i}` })),
    ];
    const m = member({ payouts });
    expect(m.payouts).toHaveLength(MAX_PAYOUTS_KEPT + 30);
  });

  it("UMPIKUJA: sadan maksetun jälkeen uusi maksu tallentuu silti", () => {
    // Tämä oli se virhe. `Math.max(0, 100 - paid.length)` meni nollaan, joten
    // jokainen uusi ilmoitus katosi ja tekijä ei voinut enää saada maksua.
    const paid = Array.from({ length: MAX_PAYOUTS_KEPT }, (_, i) =>
      payout(i, { status: "maksettu", paidAt: 5, invoiceNo: `L${i}` }));
    const m = member({ payouts: [...paid, payout(999)] });
    expect(m.payouts!.some((p) => p.id === "p999")).toBe(true);
  });

  it("hyväksytty mutta maksamaton maksu ei putoa", () => {
    const filler = Array.from({ length: MAX_PAYOUTS_KEPT + 50 }, (_, i) => payout(i));
    const m = member({ payouts: [payout(999, { approvedAt: 42 }), ...filler] });
    expect(m.payouts!.some((p) => p.id === "p999")).toBe(true);
  });

  it("laskutustiedot saanut maksu ei putoa", () => {
    const filler = Array.from({ length: MAX_PAYOUTS_KEPT + 50 }, (_, i) => payout(i));
    const m = member({ payouts: [payout(999, { billing: { iban: "FI00" } }), ...filler] });
    expect(m.payouts!.some((p) => p.id === "p999")).toBe(true);
  });

  it("uusille koskemattomille ilmoituksille jää aina tilaa", () => {
    const paid = Array.from({ length: MAX_PAYOUTS_KEPT + 40 }, (_, i) =>
      payout(i, { status: "maksettu", paidAt: 5, invoiceNo: `L${i}` }));
    const fresh = Array.from({ length: MIN_UNTOUCHED_PAYOUTS_KEPT }, (_, i) => payout(500 + i));
    const m = member({ payouts: [...paid, ...fresh] });
    for (const f of fresh) expect(m.payouts!.some((p) => p.id === f.id)).toBe(true);
  });

  it("koskematon ylimäärä saa pudota — katolla on yhä tehtävä", () => {
    const many = Array.from({ length: MAX_PAYOUTS_KEPT + 500 }, (_, i) => payout(i));
    const m = member({ payouts: many });
    expect(m.payouts!.length).toBeLessThan(many.length);
    expect(m.payouts!.length).toBeGreaterThanOrEqual(MIN_UNTOUCHED_PAYOUTS_KEPT);
  });

  it("alkuperäinen järjestys säilyy, jotta näkymät eivät hyppää", () => {
    const m = member({ payouts: [payout(3), payout(1), payout(2)] });
    expect(m.payouts!.map((p) => p.id)).toEqual(["p3", "p1", "p2"]);
  });
});

describe("tositteen liiteviite", () => {
  it("fileAssetId ja fileBytes säilyvät sanitoinnissa", () => {
    const m = member({ documents: [doc(1, { fileAssetId: 99, fileBytes: 123456 })] });
    expect(m.documents![0].fileAssetId).toBe(99);
    expect(m.documents![0].fileBytes).toBe(123456);
  });

  it("kelvoton viite ei mene läpi", () => {
    const m = member({ documents: [doc(1, { fileAssetId: -3, fileBytes: 0 })] });
    expect(m.documents![0].fileAssetId).toBeUndefined();
    expect(m.documents![0].fileBytes).toBeUndefined();
  });
});
