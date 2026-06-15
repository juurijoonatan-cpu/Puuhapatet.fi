/**
 * Rakentaa allekirjoitetusta sopimuksesta itsenäisen HTML-tiedoston (sisältää
 * allekirjoituskuvan) ja tarjoaa lataus-/tulostusvalmiin dokumentin. Tämä on
 * "tiedostona adminille" tallentuva versio, joka toimii myös ilman palvelinta.
 */

import {
  CONTRACT_ATTACHMENT,
  CONTRACT_INTRO,
  CONTRACT_META,
  CONTRACT_SECTIONS,
  ORDER_CHECKS,
  ORDER_OPTIONS,
  PRICE_ROWS,
  SignedContract,
} from "./contract";

function esc(s: string) {
  return (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

export function signedFileName(signed: SignedContract) {
  const d = new Date(signed.signedAt);
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const who = (signed.customer.legalName || "tilaaja").replace(/[^\wÀ-ɏ]+/g, "-").replace(/^-+|-+$/g, "");
  return `Sopimus_${signed.contractId}_${who}_allekirjoitettu_${stamp}.html`;
}

export function buildSignedHtml(signed: SignedContract): string {
  const chosen = ORDER_OPTIONS.find((o) => o.id === signed.order);
  const when = new Date(signed.signedAt).toLocaleString("fi-FI");

  const sections = CONTRACT_SECTIONS.map((s) => {
    const body = s.body
      .map((p) => (p.startsWith("• ") ? `<li>${esc(p.slice(2))}</li>` : `<p>${esc(p)}</p>`))
      .join("");
    const wrapped = body.includes("<li>") ? body.replace(/(<li>[\s\S]*<\/li>)/, "<ul>$1</ul>") : body;
    return `<section><h2><span class="no">${s.no}</span> ${esc(s.title)}</h2>${wrapped}</section>`;
  }).join("");

  const prices = PRICE_ROWS.map(
    (r) => `<tr><td>${esc(r.label)}</td><td>${esc(r.accrual)}</td><td class="right"><b>${esc(r.cap)}</b></td></tr>`
  ).join("");

  const orderChecks = ORDER_CHECKS.map(
    (label, i) => `<div class="chk">${signed.checks[i] ? "☑" : "☐"} ${esc(label)}</div>`
  ).join("");

  return `<!doctype html>
<html lang="fi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sopimus ${esc(signed.contractId)} — ${esc(signed.customer.legalName)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", system-ui, sans-serif; color: #1a1a1a; max-width: 800px; margin: 0 auto; padding: 40px 28px 80px; line-height: 1.6; }
  h1 { font-size: 26px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 22px 0 8px; }
  h2 .no { color: #999; font-family: monospace; margin-right: 8px; }
  .tag { color: #666; }
  .meta { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px 24px; background: #f5f5f5; border-radius: 12px; padding: 18px 20px; margin: 20px 0; font-size: 14px; }
  .meta b { display: block; font-size: 11px; letter-spacing: .08em; color: #888; text-transform: uppercase; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 14px; }
  td { padding: 8px 6px; border-bottom: 1px solid #eee; }
  .right { text-align: right; }
  ul { padding-left: 20px; } li { margin-bottom: 4px; }
  p { margin: 6px 0; font-size: 14px; }
  .sign { margin-top: 36px; border-top: 2px solid #1a1a1a; padding-top: 24px; }
  .sigbox { border: 1px solid #ccc; border-radius: 10px; padding: 14px; margin: 12px 0; }
  .sigbox img { max-width: 320px; max-height: 130px; display: block; }
  .chk { margin: 4px 0; font-size: 14px; }
  .banner { background: #eafaef; border: 1px solid #b6e6c6; border-radius: 10px; padding: 12px 16px; font-size: 13px; color: #1c5f33; margin: 16px 0; }
  .muted { color: #777; font-size: 12px; }
  @media print { body { padding: 0; } .banner { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head>
<body>
  <div class="muted">PUUHAPATET · ${esc(signed.contractId)}</div>
  <h1>${esc(CONTRACT_META.heading)}</h1>
  <div class="tag">${esc(CONTRACT_META.tagline)} · ${esc(CONTRACT_META.service)} — ${esc(CONTRACT_META.address)}</div>

  <div class="banner"><b>Allekirjoitettu ${esc(when)}.</b> Hyväksytty vaihtoehto: ${esc(chosen ? chosen.label + " (" + chosen.max + ")" : signed.order)}.</div>

  <div class="meta">
    <div><b>Päiväys</b>${esc(CONTRACT_META.date)}</div>
    <div><b>Voimassa</b>${esc(CONTRACT_META.validUntil)} saakka</div>
    <div><b>Tilaaja</b>${esc(CONTRACT_META.customer)}</div>
    <div><b>Yhteyshenkilö</b>${esc(CONTRACT_META.customerContact)}</div>
    <div style="grid-column:1/-1"><b>Palveluntarjoajat</b>${esc(CONTRACT_META.providers)}</div>
    <div style="grid-column:1/-1"><b>Yhteystiedot</b>${esc(CONTRACT_META.contactInfo)}</div>
  </div>

  <p>${esc(CONTRACT_INTRO)}</p>

  <h2>Hinnoittelu · hintakatto</h2>
  <table>${prices}</table>

  ${sections}
  <p class="muted">${esc(CONTRACT_ATTACHMENT)}</p>

  <div class="sign">
    <h2>Hyväksyminen ja allekirjoitukset</h2>
    ${orderChecks}

    <div class="meta" style="margin-top:16px">
      <div><b>Tilaajan virallinen nimi</b>${esc(signed.customer.legalName)}</div>
      <div><b>Y-tunnus</b>${esc(signed.customer.businessId) || "—"}</div>
      <div style="grid-column:1/-1"><b>Laskutusosoite</b>${esc(signed.customer.billingAddress) || "—"}</div>
      <div style="grid-column:1/-1"><b>Verkkolaskuosoite / sähköposti</b>${esc(signed.customer.eInvoice) || "—"}</div>
      <div style="grid-column:1/-1"><b>Yhteyshenkilö ja puhelin</b>${esc(signed.customer.contactPerson) || "—"}</div>
    </div>

    <div class="sigbox">
      <b>TILAAJA</b>
      ${signed.signatureDataUrl ? `<img src="${signed.signatureDataUrl}" alt="allekirjoitus">` : ""}
      <div>${esc(signed.signerName)}</div>
      <div class="muted">${esc(signed.place)} · ${esc(when)}</div>
    </div>
    <div class="sigbox">
      <b>PUUHAPATET</b>
      <div>Joonatan Juuri · Matias Pitkänen</div>
      <div class="muted">${esc(CONTRACT_META.address.split("/")[0].trim())}</div>
    </div>
    <p class="muted">Sähköisesti allekirjoitettu seurantapaneelissa. Allekirjoittajan selain: ${esc(signed.userAgent || "")}</p>
  </div>
</body></html>`;
}

/** Lataa allekirjoitetun sopimuksen HTML-tiedostona käyttäjän laitteelle. */
export function downloadSignedContract(signed: SignedContract) {
  if (typeof document === "undefined") return;
  const blob = new Blob([buildSignedHtml(signed)], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = signedFileName(signed);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
