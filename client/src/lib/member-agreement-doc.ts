/**
 * Puuhapatet-jäsensopimuksen tulostettava kappale.
 *
 * MIKSI TÄMÄ PUUTTUI JA MIKSI SE ON ONGELMA: jäsensopimus (perustajan tai
 * työntekijän variantti, /admin/tervetuloa) allekirjoitetaan kerran ennen kuin
 * työkalut aukeavat. Allekirjoitus tallennetaan `users.member_agreement`
 * -sarakkeeseen kokonaisena — kuva, aikaleima, IP, selain, hyväksytyt
 * käytännöt — ja `GET /api/admin/member-agreement/:userId` palauttaa sen
 * pyydettäessä. Mikään ei kuitenkaan renderöinyt sitä. Ainoa kutsuja luki
 * vastauksesta version ja heitti loput pois, joten data oli käytännössä
 * write-only: allekirjoitat, ja sen jälkeen et pääse siihen enää käsiksi.
 *
 * Keikkasopimuksella ja alihankkijasopimuksella oli omat asiakirjansa
 * (gig-contract-doc.ts, worker-contract-doc.ts) — tältä puuttui vastaava
 * kokonaan. Asiakas ja tekijä saivat kappaleensa, perustaja ei omaansa.
 *
 * Tämä tiedosto rakentaa sen samalla kaavalla: sopijapuolet ensin, koko teksti,
 * hyväksytyt käytännöt rasteineen, allekirjoitus ja tekninen todistusaineisto.
 */

import {
  buildAgreement, POLICIES, type MemberAgreementSignature,
} from "@shared/member-agreement";
import type { TeamRole } from "@shared/team";
import { downloadHtmlDocument, printHtmlDocument } from "./doc-print";

function esc(s: string) {
  return (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}
function fiDate(ts: number) {
  return new Date(ts).toLocaleString("fi-FI");
}

/** Puuhapatetin puolesta sopimuksen vahvistavat brändin edustajat. */
const BRAND_SIGNATORIES = ["Joonatan Juuri", "Matias Pitkänen"];

function partiesBlock(sig: MemberAgreementSignature): string {
  const snap = sig.snapshot;
  const rows: [string, string | undefined][] = [
    ["Rooli", snap.role === "HOST" ? "Perustaja" : "Jäsen"],
    ["Y-tunnus", snap.yTunnus],
    ["Palvelumaksu", `${snap.feePct} %`],
    ["Huoltaja", sig.guardianName],
  ];
  const meta = rows
    .filter(([, v]) => !!v)
    .map(([k, v]) => `<span><b>${esc(k)}</b> ${esc(v!)}</span>`)
    .join("");
  return `<section class="parties">
    <h2 class="first">Sopijapuolet</h2>
    <div class="party-grid">
      <div class="party">
        <div class="party-role">Puuhapatet</div>
        <div class="party-name">Puuhapatet</div>
        <div class="party-meta">${BRAND_SIGNATORIES.map(esc).join(" · ")}</div>
      </div>
      <div class="party">
        <div class="party-role">Jäsen</div>
        <div class="party-name">${esc(snap.name || sig.signerName)}</div>
        <div class="party-meta">${meta}</div>
      </div>
    </div>
  </section>`;
}

export function buildMemberAgreementHtml(sig: MemberAgreementSignature): string {
  const doc = buildAgreement({
    userId: sig.userId,
    name: sig.snapshot.name,
    role: sig.snapshot.role as TeamRole,
    yTunnus: sig.snapshot.yTunnus,
    feePct: sig.snapshot.feePct,
    isUnder18: !!sig.guardianName,
  });

  const sections = doc.sections
    .map((s) => `<p class="sec"><b>${esc(s.no)} ${esc(s.title)}</b></p>`
      + s.body.map((b) => b.startsWith("• ")
        ? `<p class="bullet">${esc(b)}</p>`
        : `<p class="para">${esc(b)}</p>`).join(""))
    .join("");

  // Käytännöt rasteineen: näkyy mitkä on kuitattu ja mitkä ei. Sama merkintä
  // kuin alihankkijasopimuksessa, jotta molemmat asiakirjat luetaan samoin.
  const policies = POLICIES.map((p) => {
    const ok = sig.acceptedPolicyIds.includes(p.id);
    return `<div class="policy">
      <p class="clause"><b>${ok ? "☑" : "☐"} ${esc(p.title)}</b></p>
      ${p.points.map((pt) => `<p class="bullet">• ${esc(pt)}</p>`).join("")}
    </div>`;
  }).join("");

  const audit = [
    `versio ${sig.version}`,
    sig.ip ? `IP ${sig.ip}` : "",
    sig.userAgent || "",
  ].filter(Boolean).map(esc).join(" · ");

  return `<!doctype html><html lang="fi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(doc.title)} — ${esc(sig.snapshot.name || sig.signerName)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:'Poppins',-apple-system,'Segoe UI',system-ui,sans-serif;color:#1A1A1A;
       max-width:760px;margin:0 auto;padding:40px 26px 80px;line-height:1.6;
       -webkit-text-size-adjust:100%}
  .eyebrow{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#8C8A82}
  h1{font-size:26px;line-height:1.2;margin:6px 0 4px;letter-spacing:-.01em}
  .lede{color:#6b6960;font-size:13.5px}
  .rule{border:0;border-top:2px solid #1A1A1A;margin:22px 0 0}
  h2{font-size:16px;margin:0 0 8px;letter-spacing:-.005em}
  h2.first{margin-top:22px}
  .muted{color:#8C8A82}
  .small{font-size:12px}

  .parties{margin-top:22px}
  .party-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .party{border:1px solid #E4E1D7;border-radius:12px;padding:13px 15px;background:#FCFBF8}
  .party-role{font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#8C8A82}
  .party-name{font-size:16px;font-weight:600;margin:3px 0 6px}
  .party-meta{font-size:12.5px;color:#4a4842;display:flex;flex-direction:column;gap:2px}
  .party-meta b{color:#8C8A82;font-weight:600}

  .body{border-top:2px solid #1A1A1A;margin-top:26px;padding-top:16px}
  .intro{color:#555;margin:8px 0 14px}
  .sec{margin:14px 0 2px;font-size:14px}
  .para{margin:0 0 6px;font-size:13.5px;color:#333}
  .bullet{margin:0 0 4px;padding-left:12px;font-size:13.5px;color:#333}
  .policies{margin:14px 0;padding:12px 14px;background:#F6F4EE;border:1px solid #E4E1D7;border-radius:10px}
  .policy{margin-bottom:12px}
  .policy:last-child{margin-bottom:0}
  .clause{margin:0 0 4px;font-size:13.5px}
  .closing{font-weight:600;font-size:13.5px;margin:16px 0 4px}

  .sign{margin-top:16px;border-top:2px solid #1A1A1A;padding-top:16px}
  .sign-row{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;flex-wrap:wrap}
  .sign-label{font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#8C8A82}
  .sign-name{font-size:15px;font-weight:600;margin-top:2px}
  .sign-when{font-size:12.5px;color:#6b6960}
  .sigbox{border:1px solid #E4E1D7;border-radius:10px;padding:10px 12px;background:#fff;min-width:200px}
  .sigbox img{max-width:300px;max-height:110px;display:block}
  .audit{margin-top:8px;font-size:10.5px;color:#a09e96;word-break:break-word}

  .bsign-grid{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:28px}
  .bsign-line{border-bottom:1.5px solid #1A1A1A;height:34px}
  .bsign-name{font-weight:600;font-size:14px;margin-top:6px}
  .bsign-title{font-size:12px;color:#8C8A82}

  @media(max-width:560px){
    body{padding:26px 18px 60px}
    .party-grid,.bsign-grid{grid-template-columns:1fr}
    .sign-row{flex-direction:column;align-items:stretch}
  }

  /* Tulostus: sama ohjaus kuin muissa sopimusasiakirjoissa.
     page-break-* on vanha alias, jota iOS Safari yha tarvitsee. */
  @page{margin:18mm 16mm}
  @media print{
    body{padding:0;max-width:none;font-size:11.5pt}
    a[href]{text-decoration:none;color:inherit}
    .sign,.policy,.party,.bsign-grid{break-inside:avoid;page-break-inside:avoid}
    h2,.sec{break-after:avoid;page-break-after:avoid}
    .policies,.party{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  }
</style></head><body>
  <div class="eyebrow">Puuhapatet · ${esc(doc.type === "founder" ? "Perustajasopimus" : "Jäsensopimus")}</div>
  <h1>${esc(sig.snapshot.name || sig.signerName)}</h1>
  <div class="lede">${esc(doc.subtitle)}</div>
  <hr class="rule">

  ${partiesBlock(sig)}

  <section class="body">
    <h2>${esc(doc.title)}</h2>
    <p class="intro">${esc(doc.intro)}</p>
    ${sections}

    <h2 style="margin-top:18px">Käytännöt</h2>
    <div class="policies">${policies}</div>

    <p class="closing">${esc(doc.closing)}</p>
  </section>

  <section class="sign">
    <div class="sign-row">
      <div>
        <div class="sign-label">Allekirjoittanut</div>
        <div class="sign-name">${esc(sig.signerName)}</div>
        <div class="sign-when">${esc(sig.place ? sig.place + " · " : "")}${esc(fiDate(sig.signedAt))}</div>
        ${sig.guardianName ? `<div class="sign-when">Huoltaja: ${esc(sig.guardianName)}</div>` : ""}
      </div>
      ${sig.signatureDataUrl
        ? `<div class="sigbox"><img src="${sig.signatureDataUrl}" alt="Allekirjoitus"></div>`
        : `<div class="sigbox">Allekirjoituskuvaa ei tallennettu</div>`}
    </div>
    ${audit ? `<div class="audit">${audit}</div>` : ""}

    <div class="bsign-grid">
      ${BRAND_SIGNATORIES.map((n) => `<div>
        <div class="bsign-line"></div>
        <div class="bsign-name">${esc(n)}</div>
        <div class="bsign-title">Puuhapatet — perustaja / brändin edustaja</div>
      </div>`).join("")}
    </div>
  </section>
</body></html>`;
}

function fileName(sig: MemberAgreementSignature): string {
  const who = (sig.snapshot.name || sig.signerName || "jasen")
    .replace(/[^\wÀ-ɏ]+/g, "-").replace(/^-+|-+$/g, "");
  const kind = sig.type === "founder" ? "Perustajasopimus" : "Jasensopimus";
  return `${kind}_${who}.html`;
}

export function downloadMemberAgreement(sig: MemberAgreementSignature) {
  downloadHtmlDocument(buildMemberAgreementHtml(sig), fileName(sig));
}

export function openMemberAgreementForPrint(sig: MemberAgreementSignature) {
  printHtmlDocument(buildMemberAgreementHtml(sig), fileName(sig));
}
