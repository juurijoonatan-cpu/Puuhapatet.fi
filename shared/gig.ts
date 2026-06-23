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
}

export interface GigCompany {
  name?: string;         // firm / customer name
  contact?: string;      // contact person (yhteyshenkilö)
  businessId?: string;   // Y-tunnus / VAT id
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
 * A short bulletin the bosses write for the customer's live view — e.g.
 * "Useita ikkunoita oli osittain auki aloittaessa". Plain text, timestamped,
 * shown newest-first on the public tracking page. Internal-only fields (who
 * wrote it) are never exposed to the customer.
 */
export interface GigUpdate {
  id: string;            // unique id
  text: string;          // the note shown to the customer
  ts: number;            // epoch ms (when posted)
  by?: string;           // admin name (internal only)
}

export interface GigData {
  version: 1;
  contractId?: string;        // e.g. "PT-2026-02"
  company?: GigCompany;
  contractText?: string;      // pasted contract (plain text)
  currency: "EUR";
  vatNote?: string;           // e.g. "Hintoihin ei lisätä alv (AVL 3 §)"
  customerNote?: string;      // shown on the public live view
  customerUpdates?: GigUpdate[]; // boss-written bulletins shown to the customer
  sectors: GigSector[];
  invoiceInterval: number;    // invoice roughly every N washed units (e.g. 100)
  invoicedThrough: number;    // cumulative washed-unit count already invoiced
  invoicedCents: number;      // cumulative amount already invoiced, in cents
  payments: GigPayment[];
  log: GigLogEntry[];
  requireSignature?: boolean; // gate the customer live view until signed
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
 */
export function signatureRequired(gig: Pick<GigData, "requireSignature" | "contractText">): boolean {
  return gig.requireSignature ?? !!(gig.contractText && gig.contractText.trim());
}

// ─── Defaults ────────────────────────────────────────────────────────────────

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
      }))
    : [];
  const str = (v: any, max: number) => (v == null ? undefined : String(v).slice(0, max));

  // Boss bulletins for the customer view. Keep the most recent 50; drop empties.
  const customerUpdates: GigUpdate[] = Array.isArray(input.customerUpdates)
    ? input.customerUpdates
        .slice(-50)
        .map((u: any) => ({
          id: String(u?.id ?? "").slice(0, 40) || `u${Math.random().toString(36).slice(2, 10)}`,
          text: String(u?.text ?? "").slice(0, 600).trim(),
          ts: Number(u?.ts) || Date.now(),
          by: u?.by ? String(u.by).slice(0, 80) : undefined,
        }))
        .filter((u: GigUpdate) => u.text)
    : [];

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
    email: str(input.company.email, 200),
    phone: str(input.company.phone, 60),
    address: str(input.company.address, 240),
    billing: str(input.company.billing, 1000),
  } : undefined;
  return {
    version: 1,
    contractId: str(input.contractId, 60),
    company,
    contractText: str(input.contractText, 60000),
    currency: "EUR",
    vatNote: str(input.vatNote, 240),
    customerNote: str(input.customerNote, 2000),
    customerUpdates,
    sectors,
    invoiceInterval: clampNonNeg(Number(input.invoiceInterval)) || 100,
    invoicedThrough: clampNonNeg(Number(input.invoicedThrough)),
    invoicedCents: clampNonNeg(Number(input.invoicedCents)),
    payments,
    log,
    requireSignature: typeof input.requireSignature === "boolean" ? input.requireSignature : undefined,
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
