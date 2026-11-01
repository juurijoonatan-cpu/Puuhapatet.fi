/**
 * TUNTILASKUT KIRJATTU LÄHETETYKSI KÄSIN.
 *
 * Joskus lasku lähtee muuta reittiä kuin järjestelmän sähköpostilla: johtaja
 * tekee sen omalla laskutusohjelmallaan, ja summa on se mitä laskulle oikeasti
 * kirjoitettiin — ei se mitä järjestelmä olisi laskenut. Tämä moduuli muuttaa
 * sellaisen "nämä laskut ovat lähteneet" -ilmoituksen samoiksi maksuriveiksi
 * kuin järjestelmän oma lähetys tekee, jotta KAIKKI muu (seuraava lasku,
 * keikan tulot, johtajien tasaus, kirjanpito) lukee ne samalla tavalla.
 *
 * KIRJATTU SUMMA ON TOTUUS. Laskujen summa tallennetaan sellaisenaan
 * (`amountCents`) — tulot ja kirjanpito seuraavat laskuja eikä arviota. Se mitä
 * laskut KATTOIVAT (tunnit ja kulut tähän hetkeen asti) tallennetaan
 * kattavuutena (`cover`, ks. `shared/hours-period.ts`), ja siitä seuraava kausi
 * alkaa alusta: avoimet tunnit nollautuvat.
 *
 * JOS SUMMA EI TÄSMÄÄ JÄRJESTELMÄN LASKEMAAN, ero ei katoa eikä sitä arvata
 * pois: seuraavan laskun summa on aina "kertymä − jo laskutettu". Alilaskutus
 * jää odottamaan seuraavaa laskua, ylilaskutus pienentää sitä. `reconcile`
 * kertoo eron ennen kirjausta, jotta se nähdään vahvistusruudussa.
 */

import { BRAND_BILLERS } from "./billers";
import type { GigPayment, HoursInvoiceCover } from "./gig";

export const MAX_MANUAL_INVOICES = 6;
/** Yksittäisen käsin kirjatun laskun yläraja: 1 000 000 €. Kirjoitusvirhevartija. */
export const MAX_MANUAL_INVOICE_CENTS = 100_000_000;

export interface ManualInvoiceInput {
  amountCents: number;
  /** Kuka johtaja laskutti — hänen Y-tunnuksensa liikevaihtoon lasku kuuluu. */
  billerId: string;
  /** Laskun numero omasta ohjelmasta, jos halutaan muistiin. */
  ref?: string;
}

export type ManualInvoicesResult =
  | { ok: true; invoices: { amountCents: number; billerId: string; ref?: string }[]; totalCents: number }
  | { ok: false; error: string };

/**
 * Puhdista ja tarkista syöte. Virheviesti on suomeksi ja luettavissa suoraan
 * käyttäjälle. Mitään ei arvata: puuttuva laskuttaja tai nollasumma on virhe.
 */
export function normalizeManualInvoices(input: unknown): ManualInvoicesResult {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, error: "Anna vähintään yksi lasku." };
  if (input.length > MAX_MANUAL_INVOICES) return { ok: false, error: `Enintään ${MAX_MANUAL_INVOICES} laskua kerralla.` };
  const out: { amountCents: number; billerId: string; ref?: string }[] = [];
  for (let i = 0; i < input.length; i++) {
    const row = input[i] as any;
    const n = i + 1;
    const cents = Math.round(Number(row?.amountCents));
    if (!Number.isFinite(cents) || cents <= 0) return { ok: false, error: `Laskun ${n} summa puuttuu tai ei ole positiivinen.` };
    if (cents > MAX_MANUAL_INVOICE_CENTS) return { ok: false, error: `Laskun ${n} summa on epäuskottavan suuri.` };
    const billerId = String(row?.billerId ?? "").trim();
    if (!BRAND_BILLERS.some((b) => b.id === billerId)) return { ok: false, error: `Valitse laskulle ${n} laskuttaja.` };
    const ref = String(row?.ref ?? "").trim().slice(0, 60);
    out.push({ amountCents: cents, billerId, ...(ref ? { ref } : {}) });
  }
  return { ok: true, invoices: out, totalCents: out.reduce((s, x) => s + x.amountCents, 0) };
}

/**
 * Käsin kirjoitettu euromäärä → sentit. Hyväksyy "4620", "4 620,50", "4620.5",
 * "4.620,50 €". Tulos on null jos teksti ei ole selvä rahasumma — mitään ei
 * arvata, koska väärin luettu summa menee suoraan liikevaihtoon.
 */
export function parseEuroInput(text: string): number | null {
  let t = String(text ?? "").replace(/[\s\u00a0€]/g, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, ""); // "4.620" = tuhaterotin
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const cents = Math.round(Number(t) * 100);
  return Number.isFinite(cents) ? cents : null;
}

export interface ManualReconcile {
  /** Mitä järjestelmä olisi laskuttanut seuraavalla laskulla. */
  expectedCents: number;
  /** Kirjattujen laskujen summa. */
  enteredCents: number;
  /** entered − expected. Nolla = täsmää. */
  diffCents: number;
  /** Mitä seuraavalle laskulle jää kirjauksen jälkeen (kertymä − laskutettu). */
  nextRemainingCents: number;
}

/**
 * Vertaa kirjattua summaa järjestelmän laskemaan. `nextRemainingCents` on
 * täsmälleen se luku jonka `computeHoursPeriod` antaa kirjauksen jälkeen —
 * ylilaskutus ei mene negatiiviseksi vaan pysähtyy nollaan, ja loppu kuittaa
 * myöhemmin kertyvää työtä.
 */
export function reconcileManualInvoices(expectedCents: number, enteredCents: number): ManualReconcile {
  const expected = Math.max(0, Math.round(expectedCents || 0));
  const entered = Math.max(0, Math.round(enteredCents || 0));
  return {
    expectedCents: expected,
    enteredCents: entered,
    diffCents: entered - expected,
    nextRemainingCents: Math.max(0, expected - entered),
  };
}

/** Kellonaika (ms) jolle lasku kirjataan. Päivämäärä "YYYY-MM-DD", tänään = nyt. */
export function manualInvoiceTime(sentOn: string | undefined, now: number): { ok: true; t: number } | { ok: false; error: string } {
  const s = String(sentOn ?? "").trim();
  if (!s) return { ok: true, t: now };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return { ok: false, error: "Päivämäärä on väärässä muodossa." };
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const noon = Date.UTC(y, mo - 1, d, 10, 0, 0); // ~keskipäivä Suomessa, ei vaihda päivää kummassakaan aikavyöhykkeessä
  if (new Date(noon).getUTCDate() !== d) return { ok: false, error: "Päivämäärää ei ole olemassa." };
  const today = new Date(now);
  const todayStart = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (noon >= todayStart + 86_400_000) return { ok: false, error: "Päivämäärä ei voi olla tulevaisuudessa." };
  // Tämän päivän lasku kirjataan tähän hetkeen (järjestys muihin riveihin nähden),
  // aiempi päivä päivän keskelle.
  return { ok: true, t: noon >= todayStart ? now : noon };
}

/**
 * Muodosta maksurivit. Jokainen lasku on oma riviensä (`scope: "hours"`), jotta
 * jokainen näkyy erikseen ja voidaan tarvittaessa mitätöidä yksi kerrallaan.
 *
 * KATTAVUUS ON YHTEINEN. Kaikki laskut kattavat saman hetken tunnit ja kulut
 * (kumulatiivisesti), ja kausi alkaa uusimmasta. IKKUNARAHA (`windowsCents`)
 * sen sijaan kirjataan vain YHDELLE riville, suurimmalle: kauden vertailu
 * summaa sen rivikohtaisesti, joten sama euro kahdella rivillä laskettaisiin
 * kahdesti.
 */
export function buildManualHoursPayments(opts: {
  invoices: { amountCents: number; billerId: string; ref?: string }[];
  t: number;
  countThrough: number;
  cover: Omit<HoursInvoiceCover, "windowsCents">;
  windowsCents: number;
}): GigPayment[] {
  const { invoices } = opts;
  let big = 0;
  invoices.forEach((x, i) => { if (x.amountCents > invoices[big].amountCents) big = i; });
  return invoices.map((x, i) => {
    const biller = BRAND_BILLERS.find((b) => b.id === x.billerId)!;
    return {
      // Millisekunnin porras pitää rivien järjestyksen vakaana.
      t: opts.t + i,
      countThrough: opts.countThrough,
      amountCents: x.amountCents,
      note: `Tuntilasku${invoices.length > 1 ? ` ${i + 1}/${invoices.length}` : ""} (kirjattu käsin)${x.ref ? ` · ${x.ref}` : ""}`,
      biller: { id: biller.id, name: biller.name, yTunnus: biller.yTunnus },
      scope: "hours" as const,
      cover: { ...opts.cover, windowsCents: i === big ? Math.max(0, Math.round(opts.windowsCents || 0)) : 0 },
    };
  });
}
