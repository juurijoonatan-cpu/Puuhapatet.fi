/**
 * Builds a self-contained, printable HTML document of a gig contract — with the
 * signature, signer details and approval stamp when present. Used both by the
 * customer (download their own signed copy) and the admin (view / print / save).
 */

import { eur } from "@shared/gig";

export interface DocSector {
  name: string;
  unitLabel: string;
  total: number;
  unitPriceCents: number;
}

export interface DocSignature {
  signerName: string;
  signerTitle?: string;
  place?: string;
  signedAt: number;
  customer: {
    legalName: string;
    businessId?: string;
    billingAddress?: string;
    eInvoice?: string;
    contactPerson?: string;
  };
  signatureDataUrl?: string;
}

export interface GigContractDocInput {
  contractId?: string | null;
  companyName?: string | null;
  description?: string | null;
  vatNote?: string | null;
  customerNote?: string | null;
  contractText?: string | null;
  sectors: DocSector[];
  capCents: number;
  signature?: DocSignature | null;
  approvedAt?: number | null;
}

function esc(s: string) {
  return (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}
function fiDate(ts: number) {
  return new Date(ts).toLocaleString("fi-FI");
}

export function buildGigContractHtml(input: GigContractDocInput): string {
  const sig = input.signature;
  // Customer-facing: show the sector total only — never the per-unit price.
  const priceRows = input.sectors
    .map(
      (s) =>
        `<tr><td>${esc(s.name)} <span class="muted">· ${s.total} ${esc(s.unitLabel)}a</span></td>
         <td class="right"><b>${eur(s.total * s.unitPriceCents)}</b></td></tr>`,
    )
    .join("");

  const signBlock = sig
    ? `<div class="sign">
        <h2>Allekirjoitus</h2>
        ${input.approvedAt ? `<div class="banner">Hyväksytty ${esc(fiDate(input.approvedAt))}.</div>` : ""}
        <div class="grid">
          <div><b>Tilaaja (sopimusosapuoli)</b>${esc(sig.customer.legalName)}</div>
          <div><b>Allekirjoittaja</b>${esc(sig.signerName)}${sig.signerTitle ? ` · ${esc(sig.signerTitle)}` : ""}</div>
          ${sig.customer.businessId ? `<div><b>Y-tunnus</b>${esc(sig.customer.businessId)}</div>` : ""}
          ${sig.customer.contactPerson ? `<div><b>Yhteyshenkilö</b>${esc(sig.customer.contactPerson)}</div>` : ""}
          ${sig.customer.billingAddress ? `<div class="full"><b>Laskutusosoite</b>${esc(sig.customer.billingAddress)}</div>` : ""}
          ${sig.customer.eInvoice ? `<div class="full"><b>Verkkolasku / sähköposti</b>${esc(sig.customer.eInvoice)}</div>` : ""}
          <div class="full"><b>Paikka ja aika</b>${esc(sig.place ? sig.place + " · " : "")}${esc(fiDate(sig.signedAt))}</div>
        </div>
        <p class="muted small">Sopimus on tehty tilaajan <b>${esc(sig.customer.legalName)}</b>${sig.customer.businessId ? ` (Y-tunnus ${esc(sig.customer.businessId)})` : ""} ja Puuhapatetin välillä. Yllä mainittu allekirjoittaja on allekirjoittanut sen sähköisesti tilaajan puolesta tämän valtuutettuna edustajana ja sitoo siten tilaajan sopimukseen.</p>
        ${sig.signatureDataUrl ? `<div class="sigbox"><img src="${sig.signatureDataUrl}" alt="allekirjoitus"></div>` : ""}
        <p class="muted small">Sähköisesti allekirjoitettu Puuhapatetin seurantalinkissä.</p>
      </div>`
    : `<div class="sign"><p class="muted">Sopimusta ei ole vielä allekirjoitettu.</p></div>`;

  return `<!doctype html><html lang="fi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sopimus ${esc(input.contractId || "")} — ${esc(input.companyName || "")}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:'Poppins',-apple-system,'Segoe UI',system-ui,sans-serif;color:#1A1A1A;max-width:760px;margin:0 auto;padding:40px 26px 80px;line-height:1.65}
  h1{font-size:24px;margin:0 0 2px}
  h2{font-size:16px;margin:24px 0 8px}
  .muted{color:#8C8A82}
  .small{font-size:12px}
  table{width:100%;border-collapse:collapse;margin:10px 0;font-size:14px}
  td{padding:9px 6px;border-bottom:1px solid #E4E1D7}
  .right{text-align:right;white-space:nowrap}
  .total{display:flex;justify-content:space-between;align-items:baseline;border-top:2px solid #1A1A1A;margin-top:6px;padding-top:10px}
  .total b{font-size:20px}
  pre{white-space:pre-wrap;font-family:inherit;font-size:13.5px;background:#F6F4EE;border:1px solid #E4E1D7;border-radius:10px;padding:14px;max-width:100%}
  .sign{margin-top:28px;border-top:2px solid #1A1A1A;padding-top:18px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 20px;font-size:14px;margin:10px 0}
  .grid .full{grid-column:1/-1}
  .grid b{display:block;font-size:11px;letter-spacing:.05em;color:#8C8A82;text-transform:uppercase}
  .sigbox{border:1px solid #E4E1D7;border-radius:10px;padding:12px;margin-top:10px;background:#fff}
  .sigbox img{max-width:320px;max-height:130px;display:block}
  .banner{background:#eafaef;border:1px solid #b6e6c6;border-radius:10px;padding:10px 14px;font-size:13px;color:#1c5f33;margin-bottom:12px}
  @media print{body{padding:0}.banner,pre{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>
  <div class="muted small">PUUHAPATET${input.contractId ? " · " + esc(input.contractId) : ""}</div>
  <h1>Tarjous & sopimus</h1>
  <div class="muted">${esc(input.companyName || "")}${input.description ? " · " + esc(input.description) : ""}</div>

  <h2>Hinnoittelu · hintakatto</h2>
  <table>${priceRows}</table>
  <div class="total"><span>Hintakatto yhteensä</span><b>${eur(input.capCents)}</b></div>
  ${input.vatNote ? `<p class="muted small">${esc(input.vatNote)}</p>` : ""}
  ${input.customerNote ? `<p>${esc(input.customerNote)}</p>` : ""}

  ${input.contractText ? `<h2>Sopimusteksti</h2><pre>${esc(input.contractText)}</pre>` : ""}

  ${signBlock}
</body></html>`;
}

function fileName(input: GigContractDocInput) {
  const who = (input.companyName || input.signature?.customer.legalName || "sopimus")
    .replace(/[^\wÀ-ɏ]+/g, "-").replace(/^-+|-+$/g, "");
  return `Sopimus_${input.contractId || "PT"}_${who}.html`;
}

export function downloadGigContract(input: GigContractDocInput) {
  if (typeof document === "undefined") return;
  const blob = new Blob([buildGigContractHtml(input)], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName(input);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function openGigContractForPrint(input: GigContractDocInput) {
  const w = window.open("", "_blank");
  if (!w) return downloadGigContract(input);
  w.document.write(buildGigContractHtml(input));
  w.document.close();
}
