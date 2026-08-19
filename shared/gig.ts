/**
 * Custom gig / cap-pricing model — shared by client and server.
 *
 * A "custom gig" is a manually-entered job for a firm/contract where pricing
 * follows a per-unit accrual with a hard cap per sector (kattomalli). Each
 * completed unit (e.g. a washed window) adds its sector's unit price to the
 * running total, up to the sector cap. Units that are skipped (kuntovaraus)
 * drop off the bill entirely as a credit (hyvitys).
 *
 * This file is the single source of truth for the data shape and all the
 * money math, so the team tracker, the public live view and the invoice email
 * all agree to the cent.
 */

// ─── Data shapes ───────────────────────────────────────────────────────────────

export interface GigSector {
  id: string;            // stable id, e.g. "s1"
  name: string;          // "Sektori 1 — punaiset"
  color: string;         // hex, e.g. "#D9472B"
  unitLabel: string;     // singular noun, e.g. "ikkuna"
  total: number;         // total units in scope
  unitPriceCents: number;// price per completed unit, in cents
  washed: number;        // completed units
  skipped: number;       // skipped units (kuntovaraus) — credited off the bill
  invoicedWashed: number;// washed units already billed (for per-sector invoice lines)
  priority: number;      // lower = done first (1, 2, …)
}

export interface GigLogEntry {
  t: number;             // epoch ms
  text: string;          // human-readable, Finnish
  by?: string;           // worker name who logged it
}

export interface GigPayment {
  t: number;             // epoch ms when invoiced
  countThrough: number;  // cumulative washed-unit count this invoice covers up to
  amountCents: number;   // invoiced amount in cents
  to?: string;           // recipient email
  note?: string;
  emailId?: string;      // Resend message id
  /** Which leader (biller) billed the customer for this instalment. Their Y-tunnus
   *  becomes the BUYER on the alihankkija invoices funded by this money. */
  biller?: { id?: string; name?: string; yTunnus?: string };
  /** Customer e-invoice address (verkkolaskuosoite/OVT) this instalment was
   *  directed to, when given — recorded for the customer's routing & our records. */
  eInvoice?: string;
  /** Which pricing scope this payment belongs to: "p2" = keltaisten ikkunoiden
   *  per-window billing (shared/p2.ts), kept apart from the fixed P1 instalments.
   *  Absent = P1 (the historical default). */
  scope?: "p1" | "p2";
  /**
   * MITÄTÖITY erä. Lähetetty laskutuserä on kirjanpidon tosite (se kirjataan
   * myyntinä tilille 3000), joten sitä ei saa poistaa — virheellinen erä
   * merkitään mitätöidyksi ja se jää riviksi historiaan. Kaikki summat
   * ohittavat mitätöidyn erän: ks. `livePayments`.
   */
  voided?: boolean;
  voidedAt?: number;
  voidedBy?: string;
}

/**
 * Erät jotka lasketaan mukaan rahaan — eli kaikki paitsi mitätöidyt.
 *
 * YKSI paikka jossa mitätöinti suodatetaan, jotta se ei unohdu joltakin
 * summalta. Kaikki laskenta joka lukee `gig.payments` pitäisi lukea tämä.
 */
export function livePayments(payments: GigPayment[] | undefined | null): GigPayment[] {
  return (payments ?? []).filter((p) => !p?.voided);
}

export interface GigCompany {
  name?: string;         // firm / customer name
  contact?: string;      // contact person (yhteyshenkilö)
  businessId?: string;   // Y-tunnus / VAT id
  /**
   * Onko tilaaja yritys vai **rekisteröity yhdistys (ry)**.
   *
   * Molemmilla on nimi ja Y-tunnus, joten pelkistä tiedoista ei näe kummasta on
   * kyse — ja sopimuksessa on eri asia sanoa "yritys" kuin "yhdistys".
   * Puuttuva = yritys (vanha käytös).
   */
  entityType?: "yritys" | "ry";
  email?: string;
  phone?: string;
  address?: string;
  billing?: string;      // freeform billing details / invoicing address
}

/**
 * Customer's electronic acceptance of the contract. Captured on the public
 * live link before the tracking view opens — the "intro is the signing".
 */
export interface GigSignature {
  signedAt: number;            // epoch ms
  signerName: string;          // nimenselvennys (who signed)
  signerTitle?: string;        // asema / rooli (optional)
  place?: string;              // paikka
  option?: string;             // chosen order option, e.g. "A" / "B" / free text
  acceptedSectorIds?: string[];// which sectors were ordered (defaults to all)
  customer: {                  // pre-questionnaire (tilaajan tiedot)
    legalName: string;
    businessId?: string;
    billingAddress?: string;
    eInvoice?: string;         // verkkolaskuosoite / sähköposti
    contactPerson?: string;    // yhteyshenkilö ja puhelin
  };
  signatureDataUrl: string;    // drawn signature, PNG data URL
  ip?: string;                 // filled server-side
  userAgent?: string;          // filled server-side
}

/** Admin's approval of a signed gig — the "approved" marking. */
export interface GigApproval {
  approvedAt: number;          // epoch ms
  by?: string;                 // admin name
  note?: string;
}

/** High-level lifecycle of a gig, derived from signature + approval. */
export type GigStatus = "draft" | "signed" | "approved";

/**
 * Keikan oma sopimustiedosto (PDF) — viite liitetauluun, ei itse tiedosto.
 *
 * `name` on asiakkaan näkemä tiedostonimi ja se on TARKOITUKSELLA talletettu:
 * lataus yleisnimellä "sopimus.pdf" antaa asiakkaalle tiedoston josta ei näe
 * kenen sopimus se on.
 */
export interface GigContractFile {
  /** `job_assets`-rivin id. Tiedoston sisältö haetaan vain sitä katsottaessa. */
  assetId: number;
  name: string;
  mime: string;
  bytes: number;
  uploadedAt: number;
}

export interface GigData {
  version: 1;
  contractId?: string;        // e.g. "PT-2026-02"
  company?: GigCompany;
  contractText?: string;      // pasted contract (plain text)
  currency: "EUR";
  vatNote?: string;           // e.g. "Hintoihin ei lisätä alv (AVL 3 §)"
  customerNote?: string;      // shown on the public live view
  /**
   * Asiakasnäkymän ulkoasu: `"paper"` (oletus, vaalea) tai `"tech"` (tumma,
   * tekninen). Puuttuva = paper, joten olemassa olevat keikat eivät muutu.
   *
   * MIKSI KEIKKAKOHTAINEN: sama näkymä palvelee hyvin erilaisia asiakkaita.
   * Tekniselle yhteisölle mittalaitteen kieli on luontevampi kuin esite, ja
   * toisin päin. Teema on keikan ominaisuus, ei järjestelmän asetus.
   */
  customerTheme?: "paper" | "tech";
  sectors: GigSector[];
  invoiceInterval: number;    // invoice roughly every N washed units (e.g. 100)
  invoicedThrough: number;    // cumulative washed-unit count already invoiced
  invoicedCents: number;      // cumulative amount already invoiced, in cents
  payments: GigPayment[];
  log: GigLogEntry[];
  requireSignature?: boolean; // gate the customer live view until signed
  /**
   * SOPIMUS TEHDÄÄN VASTA MYÖHEMMIN.
   *
   * Työ aloitetaan ennen paperia: asiakkaan linkki avautuu suoraan
   * seurantanäkymään, eikä sopimus estä sitä missään vaiheessa. Kun sopimus
   * sitten valmistuu ja se liitetään keikalle, se nousee samassa näkymässä
   * popuppina luettavaksi ja allekirjoitettavaksi — se EI enää heitä
   * seurantaa katsovaa asiakasta takaisin koko sivun allekirjoituslomakkeeseen.
   *
   * Ilman tätä lippua sopimustekstin liittäminen jälkikäteen teki juuri sen:
   * `signatureRequired` kääntyi päälle ja `gig-live` palautti asiakkaan
   * lomakkeelle ilman mitään selitystä.
   *
   * Puuttuva = vanha käytös.
   */
  contractLater?: boolean;
  /**
   * SOPIMUS TIEDOSTONA — keikan oma PDF.
   *
   * MIKSI TÄMÄ ON OLEMASSA: sopimus on käytännössä aina PDF. Ennen tätä kenttää
   * järjestelmään sai sopimusasiakirjan vain kahdella tavalla: liittämällä sen
   * PLAIN TEXTinä `contractText`iin (allekirjoitukset, taulukot ja liitteet
   * katoavat) tai committaamalla PDF:n `client/public/contracts/`iin ja
   * julkaisemalla frontendin uudelleen. Jälkimmäinen tarkoitti että jokainen
   * uusi asiakas vaati koodimuutoksen — eikä sitä polkua ollut kuin FR8:lla.
   *
   * TIEDOSTO EI OLE TÄSSÄ BLOBISSA, vain viite: `assetId` osoittaa
   * `job_assets`-tauluun, aivan kuten pohjakuvat ja havaintokuvat. Sama syy:
   * gigData luetaan joka kerta kun asiakas avaa seurannan, ja megatavun PDF
   * blobin sisällä maksaisi joka kierroksella vaikka sopimus luetaan kerran.
   *
   * SERVERIN OMISTAMA kuten `p2`/`scope` projektissa: viite syntyy vain
   * `/contract-file`-reitiltä, ja geneerinen gigData-tallennus (adminin
   * "Tallenna sopimus") säilyttää talletetun arvon. Ilman sitä sopimuksen
   * liittäminen ja sen jälkeen mikä tahansa lomakkeen tallennus olisi
   * pudottanut tiedoston pois näkyvistä.
   */
  contractFile?: GigContractFile;
  signature?: GigSignature | null; // customer's electronic signature
  approval?: GigApproval | null;   // admin approval of the signed gig
  updatedAt: number;          // epoch ms
}

/** Derive the gig's lifecycle status from its signature + approval. */
export function gigStatus(gig: Pick<GigData, "signature" | "approval">): GigStatus {
  if (gig.approval?.approvedAt) return "approved";
  if (gig.signature?.signedAt) return "signed";
  return "draft";
}

/**
 * Whether the customer live view should be gated behind signing. Defaults to
 * "gate it when there is a contract to sign" unless explicitly overridden.
 *
 * `contractLater` voittaa kaiken: kun sopimus tehdään vasta myöhemmin, koko
 * sivun portti ei ole koskaan päällä — ei ennen sopimusta eikä sen jälkeen.
 */
export function signatureRequired(
  gig: Pick<GigData, "requireSignature" | "contractText" | "contractLater" | "contractFile">,
): boolean {
  if (gig.contractLater) return false;
  return gig.requireSignature ?? hasContractDoc(gig);
}

/**
 * ONKO KEIKALLA ASIAKIRJA JONKA VOI ALLEKIRJOITTAA — tiedosto TAI teksti.
 *
 * YKSI PAIKKA, KOLME KYSYJÄÄ. `signatureRequired`, `signaturePrompt` ja
 * `contractPending` kysyvät kaikki samaa asiaa, ja ennen tätä ne kysyivät sitä
 * kolmella rinnakkaisella `contractText`-ehdolla. Kun sopimus voi olla myös
 * PDF, kolme rinnakkaista ehtoa tarkoittaisi kolme paikkaa jossa tiedosto
 * muistetaan lisätä — ja se joka jäisi unohtumaan tuottaisi keikan jolla on
 * sopimus mutta jota ei voi allekirjoittaa (tai päinvastoin: "sopimus tulossa"
 * -lupauksen sopimuksesta joka on jo liitetty).
 */
export function hasContractDoc(gig: Pick<GigData, "contractText" | "contractFile">): boolean {
  if (gig.contractFile) return true;
  return !!(gig.contractText && gig.contractText.trim());
}

/** Miten allekirjoitusta pyydetään asiakkaalta. */
export type SignaturePrompt =
  /** Ei mitään pyydettävää: ei sopimusta, tai se on jo allekirjoitettu. */
  | "none"
  /** Koko sivun portti: seuranta avautuu vasta allekirjoituksesta. */
  | "gate"
  /** Seuranta on auki, ja sopimus nousee siihen popuppina. */
  | "popup";

/**
 * Yksi vastaus siihen mitä asiakkaalle näytetään sopimuksesta — ennen tätä
 * jokainen näkymä päätteli sen itse kahdesta kentästä.
 */
export function signaturePrompt(
  gig: Pick<GigData, "requireSignature" | "contractText" | "contractLater" | "contractFile" | "signature">,
): SignaturePrompt {
  if (gig.signature?.signedAt) return "none";
  if (signatureRequired(gig)) return "gate";
  // Sopimus valmis mutta portti pois päältä = popup. Tämä kattaa sekä
  // `contractLater`-keikan että sen tilanteen jossa ylläpito on nimenomaisesti
  // ottanut portin pois mutta sopimus on silti olemassa — aiemmin siinä
  // tilanteessa asiakas ei nähnyt sopimusta ollenkaan eikä voinut allekirjoittaa.
  if (hasContractDoc(gig)) return "popup";
  return "none";
}

/**
 * SOPIMUS ON VALMISTELUSSA — ei "ei sopimusta".
 *
 * Kun keikka luodaan valinnalla "allekirjoitetaan myöhemmin", asiakas saa
 * linkin ennen kuin sopimusta on olemassa. Näkymässä ei silloin ole mitään
 * merkkiä sopimuksesta, ja se lukee kuin sopimusta ei tulisi lainkaan.
 *
 * MIKSI TÄMÄ EIKÄ `!contractText` SELAIMESSA: pelkkä puuttuva sopimusteksti on
 * tosi myös keikalla jolle sopimusta EI ole tarkoitus tehdä (pieni yksityinen
 * pesu). Sille asiakkaalle "sopimus toimitetaan pian" on lupaus jota kukaan ei
 * ole antanut. Vain nimenomainen `contractLater` tarkoittaa "tulossa".
 */
export function contractPending(
  gig: Pick<GigData, "contractLater" | "contractText" | "contractFile" | "signature">,
): boolean {
  if (!gig.contractLater) return false;
  if (gig.signature?.signedAt) return false;
  return !hasContractDoc(gig);
}

// ─── Defaults ────────────────────────────────────────────────────────────────

/**
 * VIIVA TARKOITTAA "EI MITÄÄN", EI TEKSTIÄ NIMELTÄ "-".
 *
 * Vapaisiin tekstikenttiin kirjoitetaan viiva kun kenttään ei ole mitään
 * sanottavaa. Se oli kuitenkin arvo kuten mikä tahansa muu, ja päätyi
 * asiakkaan sivulle: sopimustunnukseksi otsikkoon ("- · Tarjous & sopimus") ja
 * omaksi kappaleekseen "Tiedotteet ja ohjeet" -osioon.
 */
export function withoutDashOnly(v: string | null | undefined): string | undefined {
  const t = (v ?? "").trim();
  if (!t || t === "-" || t === "–" || t === "—") return undefined;
  return t;
}

export function emptyGigData(): GigData {
  return {
    version: 1,
    currency: "EUR",
    sectors: [],
    invoiceInterval: 100,
    invoicedThrough: 0,
    invoicedCents: 0,
    payments: [],
    log: [],
    updatedAt: Date.now(),
  };
}

export function newSector(index: number): GigSector {
  const palette = ["#D9472B", "#DFA614", "#1F3B57", "#3E7C59", "#7A4FA3"];
  return {
    id: `s${index + 1}`,
    name: `Sektori ${index + 1}`,
    color: palette[index % palette.length],
    unitLabel: "ikkuna",
    total: 0,
    unitPriceCents: 0,
    washed: 0,
    skipped: 0,
    invoicedWashed: 0,
    priority: index + 1,
  };
}

// ─── Calculations ──────────────────────────────────────────────────────────────

export interface GigTotals {
  washedTotal: number;
  skippedTotal: number;
  unitTotal: number;          // sum of all sector totals
  accruedCents: number;       // money earned so far (washed × unit)
  capCents: number;           // hard cap (total × unit)
  creditCents: number;        // hyvitykset (skipped × unit)
  estimatedFinalCents: number;// cap − credits
  remainingCents: number;     // estimated final − accrued (still to earn)
  invoicedCents: number;      // already invoiced (Σ invoicedWashed × unit)
  invoicedWashed: number;     // already-invoiced washed-unit count
  uninvoicedCents: number;    // accrued − already invoiced
  percentByCap: number;       // accrued / cap, 0..1
}

export function computeTotals(gig: GigData): GigTotals {
  let washedTotal = 0, skippedTotal = 0, unitTotal = 0;
  let accruedCents = 0, capCents = 0, creditCents = 0;
  let invoicedCents = 0, invoicedWashed = 0;
  for (const s of gig.sectors) {
    const washed = clampNonNeg(s.washed);
    const skipped = clampNonNeg(s.skipped);
    const inv = Math.min(washed, clampNonNeg(s.invoicedWashed));
    washedTotal += washed;
    skippedTotal += skipped;
    unitTotal += clampNonNeg(s.total);
    accruedCents += washed * s.unitPriceCents;
    capCents += clampNonNeg(s.total) * s.unitPriceCents;
    creditCents += skipped * s.unitPriceCents;
    invoicedCents += inv * s.unitPriceCents;
    invoicedWashed += inv;
  }
  const estimatedFinalCents = Math.max(0, capCents - creditCents);
  const uninvoicedCents = Math.max(0, accruedCents - invoicedCents);
  return {
    washedTotal,
    skippedTotal,
    unitTotal,
    accruedCents,
    capCents,
    creditCents,
    estimatedFinalCents,
    remainingCents: Math.max(0, estimatedFinalCents - accruedCents),
    invoicedCents,
    invoicedWashed,
    uninvoicedCents,
    percentByCap: capCents > 0 ? Math.min(1, accruedCents / capCents) : 0,
  };
}

/**
 * The next washed-unit count at which an invoice is suggested.
 * Based on invoiceInterval crossings beyond what's already been invoiced.
 */
export function nextInvoiceThreshold(gig: GigData): number {
  const step = gig.invoiceInterval > 0 ? gig.invoiceInterval : 100;
  const base = Math.max(computeTotals(gig).invoicedWashed, 0);
  return Math.floor(base / step) * step + step;
}

/** True when accumulated washed units have crossed the next invoice threshold. */
export function invoiceDue(gig: GigData): boolean {
  const { washedTotal } = computeTotals(gig);
  return washedTotal >= nextInvoiceThreshold(gig);
}

function clampNonNeg(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Clamp a sector's counters so they stay valid: non-negative and
 * washed + skipped ≤ total.
 */
export function clampSector(s: GigSector): GigSector {
  const total = clampNonNeg(s.total);
  let washed = clampNonNeg(s.washed);
  let skipped = clampNonNeg(s.skipped);
  if (washed + skipped > total) {
    // Trim skipped first, then washed, so we never exceed total.
    const overflow = washed + skipped - total;
    const trimSkip = Math.min(skipped, overflow);
    skipped -= trimSkip;
    washed -= Math.max(0, overflow - trimSkip);
  }
  // Can't have invoiced more units than have been washed.
  const invoicedWashed = Math.min(washed, clampNonNeg(s.invoicedWashed));
  return { ...s, total, washed, skipped, invoicedWashed };
}

/** Sanitize an incoming gigData object (server-side validation). */
/**
 * Sopimustiedoston viitteen siivous.
 *
 * KELVOTON `assetId` PUDOTTAA KOKO VIITTEEN. Viite ilman riviä liitetaulussa
 * olisi keikka joka väittää sopimuksen olevan olemassa: asiakas näkisi
 * "SOPIMUSASIAKIRJA" ja sen alla rikkinäisen upotuksen, ja "sopimus
 * valmistelussa" -huomautus olisi jo kadonnut. Puuttuva tiedosto on
 * turvallisempi tila kuin luvattu tiedosto jota ei ole.
 */
export function sanitizeContractFile(input: any): GigContractFile | undefined {
  if (!input || typeof input !== "object") return undefined;
  const assetId = Number(input.assetId);
  if (!Number.isInteger(assetId) || assetId <= 0) return undefined;
  const name = String(input.name ?? "").trim().slice(0, 200) || "sopimus.pdf";
  const bytes = Number(input.bytes);
  const at = Number(input.uploadedAt);
  return {
    assetId,
    name,
    mime: String(input.mime ?? "application/pdf").slice(0, 100),
    bytes: Number.isFinite(bytes) && bytes > 0 ? Math.round(bytes) : 0,
    uploadedAt: Number.isFinite(at) && at > 0 ? Math.round(at) : Date.now(),
  };
}

export function sanitizeGigData(input: any): GigData {
  const base = emptyGigData();
  if (!input || typeof input !== "object") return base;
  const sectors: GigSector[] = Array.isArray(input.sectors)
    ? input.sectors.slice(0, 12).map((s: any, i: number) => clampSector({
        id: String(s?.id ?? `s${i + 1}`).slice(0, 16),
        name: String(s?.name ?? `Sektori ${i + 1}`).slice(0, 80),
        color: /^#[0-9a-fA-F]{3,8}$/.test(String(s?.color)) ? String(s.color) : "#1F3B57",
        unitLabel: String(s?.unitLabel ?? "ikkuna").slice(0, 24),
        total: clampNonNeg(Number(s?.total)),
        unitPriceCents: clampNonNeg(Number(s?.unitPriceCents)),
        washed: clampNonNeg(Number(s?.washed)),
        skipped: clampNonNeg(Number(s?.skipped)),
        invoicedWashed: clampNonNeg(Number(s?.invoicedWashed)),
        priority: clampNonNeg(Number(s?.priority)) || i + 1,
      }))
    : [];
  const log: GigLogEntry[] = Array.isArray(input.log)
    ? input.log.slice(-200).map((l: any) => ({
        t: Number(l?.t) || Date.now(),
        text: String(l?.text ?? "").slice(0, 240),
        by: l?.by ? String(l.by).slice(0, 80) : undefined,
      }))
    : [];
  const payments: GigPayment[] = Array.isArray(input.payments)
    ? input.payments.slice(0, 100).map((p: any) => ({
        t: Number(p?.t) || Date.now(),
        countThrough: clampNonNeg(Number(p?.countThrough)),
        amountCents: clampNonNeg(Number(p?.amountCents)),
        to: p?.to ? String(p.to).slice(0, 200) : undefined,
        note: p?.note ? String(p.note).slice(0, 200) : undefined,
        emailId: p?.emailId ? String(p.emailId).slice(0, 120) : undefined,
        biller: p?.biller && typeof p.biller === "object" ? {
          id: p.biller.id ? String(p.biller.id).slice(0, 40) : undefined,
          name: p.biller.name ? String(p.biller.name).slice(0, 160) : undefined,
          yTunnus: p.biller.yTunnus ? String(p.biller.yTunnus).slice(0, 40) : undefined,
        } : undefined,
        eInvoice: p?.eInvoice ? String(p.eInvoice).slice(0, 200) : undefined,
        scope: p?.scope === "p2" ? "p2" as const : p?.scope === "p1" ? "p1" as const : undefined,
        ...(p?.voided ? {
          voided: true as const,
          voidedAt: Number(p.voidedAt) || Date.now(),
          voidedBy: p.voidedBy ? String(p.voidedBy).slice(0, 40) : undefined,
        } : {}),
      }))
    : [];
  const str = (v: any, max: number) => (v == null ? undefined : String(v).slice(0, max));

  let signature: GigSignature | null = null;
  if (input.signature && typeof input.signature === "object") {
    const sg = input.signature;
    const cust = sg.customer && typeof sg.customer === "object" ? sg.customer : {};
    const legalName = String(cust.legalName ?? "").slice(0, 160).trim();
    const dataUrl = String(sg.signatureDataUrl ?? "");
    // Only keep a signature that actually carries the two essentials.
    if (legalName && dataUrl.startsWith("data:image/")) {
      signature = {
        signedAt: Number(sg.signedAt) || Date.now(),
        signerName: String(sg.signerName ?? "").slice(0, 160),
        signerTitle: str(sg.signerTitle, 120),
        place: str(sg.place, 120),
        option: str(sg.option, 80),
        acceptedSectorIds: Array.isArray(sg.acceptedSectorIds)
          ? sg.acceptedSectorIds.slice(0, 24).map((x: any) => String(x).slice(0, 16))
          : undefined,
        customer: {
          legalName,
          businessId: str(cust.businessId, 40),
          billingAddress: str(cust.billingAddress, 300),
          eInvoice: str(cust.eInvoice, 200),
          contactPerson: str(cust.contactPerson, 160),
        },
        signatureDataUrl: dataUrl.slice(0, 300_000), // cap stored PNG size
        ip: str(sg.ip, 64),
        userAgent: str(sg.userAgent, 400),
      };
    }
  }

  let approval: GigApproval | null = null;
  if (input.approval && typeof input.approval === "object" && Number(input.approval.approvedAt)) {
    approval = {
      approvedAt: Number(input.approval.approvedAt) || Date.now(),
      by: str(input.approval.by, 120),
      note: str(input.approval.note, 400),
    };
  }

  const company: GigCompany | undefined = input.company && typeof input.company === "object" ? {
    name: str(input.company.name, 120),
    contact: str(input.company.contact, 120),
    businessId: str(input.company.businessId, 40),
    // HUOM: tämä objekti rakennetaan kenttä kerrallaan ilman spreadia, joten
    // jokainen uusi `GigCompany`-kenttä on lisättävä myös tähän — muuten se
    // katoaa hiljaa joka tallennuksessa.
    entityType: input.company.entityType === "ry" ? "ry" as const
      : input.company.entityType === "yritys" ? "yritys" as const : undefined,
    email: str(input.company.email, 200),
    phone: str(input.company.phone, 60),
    address: str(input.company.address, 240),
    billing: str(input.company.billing, 1000),
  } : undefined;
  return {
    version: 1,
    contractId: withoutDashOnly(str(input.contractId, 60)),
    company,
    contractText: withoutDashOnly(str(input.contractText, 60000)),
    currency: "EUR",
    vatNote: withoutDashOnly(str(input.vatNote, 240)),
    customerNote: withoutDashOnly(str(input.customerNote, 2000)),
    customerTheme: input.customerTheme === "tech" ? "tech" as const
      : input.customerTheme === "paper" ? "paper" as const : undefined,
    sectors,
    invoiceInterval: clampNonNeg(Number(input.invoiceInterval)) || 100,
    invoicedThrough: clampNonNeg(Number(input.invoicedThrough)),
    invoicedCents: clampNonNeg(Number(input.invoicedCents)),
    payments,
    log,
    requireSignature: typeof input.requireSignature === "boolean" ? input.requireSignature : undefined,
    // HUOM: tämä objekti rakennetaan kenttä kerrallaan ilman spreadia, joten
    // uusi kenttä on lisättävä myös TÄHÄN — muuten se katoaa hiljaa joka
    // tallennuksessa, myös siinä tallennuksessa jonka allekirjoitus itse tekee.
    contractLater: typeof input.contractLater === "boolean" ? input.contractLater : undefined,
    contractFile: sanitizeContractFile(input.contractFile),
    signature,
    approval,
    updatedAt: Date.now(),
  };
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

export function eur(cents: number): string {
  return (cents / 100).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

export function eur2(cents: number): string {
  return (cents / 100).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}
