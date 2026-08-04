/**
 * Builds a self-contained, printable HTML document of a gig WORKER's signed
 * onboarding — their profile, every signed agreement (full text + accepted
 * clauses + signature image), and the audit trail (timestamp, IP, user agent).
 *
 * This is the host's legal record for an alihankkija (subcontractor). It mirrors
 * the customer gig-contract document (gig-contract-doc.ts).
 *
 * ⚠️  The agreement text is a template that has NOT been reviewed by a lawyer
 * (see shared/worker-agreements.ts). The document prints that disclaimer.
 */

import type { CrewMember } from "@shared/crew";
import { downloadHtmlDocument, printHtmlDocument } from "./doc-print";
import {
  ALL_AGREEMENTS, PROFILE_QUESTIONS, requiredAgreementIdsForSet, resolveAgreementSet, type WorkerAgreement,
} from "@shared/worker-agreements";

function esc(s: string) {
  return (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}
function fiDate(ts: number) {
  return new Date(ts).toLocaleString("fi-FI");
}
/** Ikkunakorvaus. `cents / 100` tulosti 2050 → "20.5 €" — pisteellä ja ilman
 *  senttejä. Suomalaisessa sopimuksessa summa on "20,50 €". */
function eurPerWindow(cents: number): string {
  // \u00a0 = sitova vali: summa ja euromerkki eivat saa katketa eri riveille.
  // Sama kaytanto kuin shared-poletiston eur():ssa. Kirjoitettu escapena,
  // koska nakymaton NBSP lahdekoodissa on ansa lukijalle ja hakijalle.
  return (cents / 100).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "\u00a0€";
}

export interface WorkerDocInput {
  member: CrewMember;
  buildingName?: string;
  buildingAddress?: string;
}

/** Yksi arvo profiilista: vastauslomake ensin, sitten tyypitetty kenttä. */
function field(member: CrewMember, id: string): string | undefined {
  const p = member.profile;
  if (!p) return undefined;
  const v = (p.answers?.[id] ?? (p as any)[id]) as string | undefined;
  return v && String(v).trim() ? String(v) : undefined;
}

/**
 * SOPIJAPUOLET — dokumentin ensimmäinen asia.
 *
 * Aiemmin sopimus alkoi tekijän nimellä otsikkona ja pikkuruisella harmaalla
 * rivillä "PUUHAPATET · ALIHANKKIJASOPIMUS". Kumpaakaan osapuolta ei koskaan
 * varsinaisesti nimetty, ja tekijän Y-tunnus — se johon KOKO sopimus nojaa,
 * koska ehdot lepäävät sen varassa että kyse on itsenäisestä yrittäjästä eikä
 * työsuhteesta — oli haudattuna kyselylomakkeen vastausten sekaan
 * "Aiemman kokemuksen" ja "Toivottujen työaikojen" väliin.
 *
 * Sopimus alkaa nyt sillä mitä sopimuksen kuuluu kertoa ensin: ketkä
 * sopivat, ja millä tunnisteilla.
 */
function partiesBlock(member: CrewMember): string {
  const name = field(member, "fullName") || member.name;
  const y = field(member, "yTunnus");
  const rows = [
    ["Y-tunnus", y || "— (ei vielä ilmoitettu)"],
    ["Sähköposti", field(member, "email")],
    ["Puhelin", field(member, "phone")],
    ["Osoite", field(member, "address") || member.profile?.city],
  ].filter(([, v]) => !!v) as [string, string][];

  return `<section class="parties">
    <h2 class="first">Sopijapuolet</h2>
    <div class="party-grid">
      <div class="party">
        <div class="party-role">Toimeksiantaja</div>
        <div class="party-name">Puuhapatet</div>
        <div class="party-meta">${BRAND_SIGNATORIES.map((s) => esc(s.name)).join(" · ")}</div>
      </div>
      <div class="party">
        <div class="party-role">Alihankkija</div>
        <div class="party-name">${esc(name)}</div>
        <div class="party-meta">${rows.map(([k, v]) => `<span><b>${esc(k)}</b> ${esc(v)}</span>`).join("")}</div>
      </div>
    </div>
    ${y ? "" : `<p class="warn">Alihankkijan Y-tunnusta ei ole vielä kirjattu. Sopimus edellyttää
      omaa Y-tunnusta, ja se on täydennettävä ennen ensimmäistä laskutusta.</p>`}
  </section>`;
}

function profileBlock(member: CrewMember): string {
  const p = member.profile;
  if (!p) return `<p class="muted">Profiilia ei ole vielä täytetty.</p>`;
  // Map every questionnaire answer back to its label; fall back to the typed cols.
  const answers = p.answers ?? {};
  const rows: string[] = [];
  // Sopijapuolet-lohko kertoo nämä jo — ei toisteta samoja rivejä alempana.
  const seen = new Set<string>(["fullName", "yTunnus", "email", "phone", "address"]);
  const push = (label: string, value?: string) => {
    if (!value) return;
    rows.push(`<div><b>${esc(label)}</b>${esc(value)}</div>`);
  };
  for (const q of PROFILE_QUESTIONS) {
    if (seen.has(q.id)) continue;
    seen.add(q.id);
    const v = (answers[q.id] ?? (p as any)[q.id]) as string | undefined;
    push(q.label, v);
  }
  // Insurance status + risk acknowledgement (captured at onboarding) — readable.
  seen.add("insuranceValid"); seen.add("riskAck");
  if (answers.insuranceValid) {
    push("Vakuutukset voimassa", answers.insuranceValid === "kylla" ? "Kyllä" : "Ei vielä (päivittää myöhemmin)");
  }
  if (answers.riskAck === "1") {
    push("Riskin hyväksyntä", "Hyväksynyt: tekee työn omalla riskillään, vastaa vahingoista myös ilman vakuutusta");
  }
  // Any extra answers not covered above.
  for (const [k, v] of Object.entries(answers)) {
    if (!seen.has(k)) push(k, v);
  }
  if (!rows.length) return `<p class="muted">Profiilia ei ole vielä täytetty.</p>`;
  return `<div class="grid">${rows.join("")}</div>`;
}

function agreementBlock(ag: WorkerAgreement, member: CrewMember): string {
  const sig = member.agreements.find((a) => a.agreementId === ag.id);
  const sections = ag.sections
    .map((s) => `<p class="sec"><b>${esc(s.no)} ${esc(s.title)}</b></p>` +
      s.body.map((b) => `<p class="bullet">• ${esc(b)}</p>`).join(""))
    .join("");
  const clauses = ag.clauses
    .map((c) => {
      const ok = sig?.acceptedClauseIds?.includes(c.id);
      return `<p class="clause">${ok ? "☑" : "☐"} ${esc(c.text)}</p>`;
    })
    .join("");
  // Allekirjoitus luetaan kuin allekirjoitus: nimi, päiväys ja piirros yhdessä.
  // Tekninen todistusaineisto (IP, selain, versio) on sen alla omana pienenä
  // rivinään — se kuuluu dokumenttiin todisteena, mutta se ei ole se asia jota
  // sopimusta lukeva ihminen etsii.
  const audit = sig
    ? [`versio ${sig.version}`, sig.ip ? `IP ${sig.ip}` : "", sig.userAgent || ""]
        .filter(Boolean).map(esc).join(" · ")
    : "";
  const signBlock = sig
    ? `<div class="sign">
         <div class="sign-row">
           <div class="sign-who">
             <div class="sign-label">Allekirjoittanut</div>
             <div class="sign-name">${esc(sig.signerName || member.name)}</div>
             <div class="sign-when">${esc(fiDate(sig.signedAt))}</div>
           </div>
           ${sig.signatureDataUrl
             ? `<div class="sigbox"><img src="${sig.signatureDataUrl}" alt="Allekirjoitus"></div>`
             : `<div class="sigbox empty">Allekirjoituskuvaa ei tallennettu</div>`}
         </div>
         ${audit ? `<div class="audit">${audit}</div>` : ""}
       </div>`
    : `<div class="sign"><p class="muted">Ei allekirjoitettu.</p></div>`;
  return `<section class="agreement">
    <h2>${esc(ag.title)} <span class="badge ${sig ? "ok" : "wait"}">${sig ? "Allekirjoitettu" : "Odottaa"}</span></h2>
    <div class="muted small">${esc(ag.tagline)}</div>
    <p class="intro">${esc(ag.intro)}</p>
    ${sections}
    <div class="clauses">${clauses}</div>
    <p class="accept">${esc(ag.accept)}</p>
    ${signBlock}
  </section>`;
}

// The brand side of every worker contract is signed by the two Puuhapatet
// founders (brand representatives). Hardcoded — they are always the signatories.
const BRAND_SIGNATORIES = [
  { name: "Joonatan Juuri", title: "Puuhapatet — perustaja / brändin edustaja" },
  { name: "Matias Pitkänen", title: "Puuhapatet — perustaja / brändin edustaja" },
];

function brandSignatureBlock(): string {
  const cols = BRAND_SIGNATORIES.map((s) => `
    <div class="bsign-col">
      <div class="bsign-line"></div>
      <div class="bsign-name">${esc(s.name)}</div>
      <div class="bsign-title">${esc(s.title)}</div>
    </div>`).join("");
  return `<section class="brandsign">
    <h2 style="border-top:none">Brändin allekirjoitukset</h2>
    <div class="muted small">Puuhapatetin puolesta tämän sopimuksen vahvistavat brändin edustajat:</div>
    <div class="bsign-grid">${cols}</div>
  </section>`;
}

export function buildWorkerContractHtml(input: WorkerDocInput): string {
  const m = input.member;
  // Show the agreements this worker's package requires PLUS any he actually signed
  // (covers a worker whose set was switched), in the canonical order.
  const idsToShow = new Set<string>([...requiredAgreementIdsForSet(resolveAgreementSet(m)), ...m.agreements.map((a) => a.agreementId)]);
  const agreements = ALL_AGREEMENTS.filter((ag) => idsToShow.has(ag.id)).map((ag) => agreementBlock(ag, m)).join("");
  const where = [input.buildingName, input.buildingAddress].filter(Boolean).join(" · ");
  return `<!doctype html><html lang="fi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Alihankkijasopimus — ${esc(m.name)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:'Poppins',-apple-system,'Segoe UI',system-ui,sans-serif;color:#1A1A1A;
       max-width:760px;margin:0 auto;padding:40px 26px 80px;line-height:1.6;
       -webkit-text-size-adjust:100%}

  /* ── Nimiö ─────────────────────────────────────────────────────────── */
  .eyebrow{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#8C8A82}
  h1{font-size:26px;line-height:1.2;margin:6px 0 4px;letter-spacing:-.01em}
  .lede{color:#6b6960;font-size:13.5px}
  .rule{border:0;border-top:2px solid #1A1A1A;margin:22px 0 0}

  h2{font-size:16px;margin:0 0 8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;
     letter-spacing:-.005em}
  h2.first{margin-top:22px}
  .muted{color:#8C8A82}
  .small{font-size:12px}

  /* ── Sopijapuolet ──────────────────────────────────────────────────── */
  .parties{margin-top:22px}
  .party-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .party{border:1px solid #E4E1D7;border-radius:12px;padding:13px 15px;background:#FCFBF8}
  .party-role{font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#8C8A82}
  .party-name{font-size:16px;font-weight:600;margin:3px 0 6px}
  .party-meta{font-size:12.5px;color:#4a4842;display:flex;flex-direction:column;gap:2px}
  .party-meta b{color:#8C8A82;font-weight:600}
  .warn{margin:10px 0 0;padding:10px 12px;border-radius:10px;font-size:12.5px;
        background:#fff7ed;border:1px solid #f0d9a8;color:#7c5310}

  .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 20px;font-size:14px;margin:10px 0}
  .grid .full{grid-column:1/-1}
  .grid b{display:block;font-size:11px;letter-spacing:.05em;color:#8C8A82;text-transform:uppercase}

  /* ── Sopimus ───────────────────────────────────────────────────────── */
  .agreement{border-top:2px solid #1A1A1A;margin-top:26px;padding-top:16px}
  .intro{color:#555;margin:8px 0 12px}
  .sec{margin:14px 0 2px;font-size:14px}
  .bullet{margin:0 0 4px;padding-left:12px;font-size:13.5px;color:#333}
  .clauses{margin:14px 0;padding:12px 14px;background:#F6F4EE;border:1px solid #E4E1D7;border-radius:10px}
  .clause{margin:0 0 6px;font-size:13.5px}
  .clause:last-child{margin-bottom:0}
  .accept{font-weight:600;font-size:13.5px;margin:14px 0 4px}

  /* ── Allekirjoitus ─────────────────────────────────────────────────── */
  .sign{margin-top:12px}
  .sign-row{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;flex-wrap:wrap}
  .sign-label{font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#8C8A82}
  .sign-name{font-size:15px;font-weight:600;margin-top:2px}
  .sign-when{font-size:12.5px;color:#6b6960}
  .sigbox{border:1px solid #E4E1D7;border-radius:10px;padding:10px 12px;background:#fff;
          min-width:200px}
  .sigbox img{max-width:300px;max-height:110px;display:block}
  .sigbox.empty{font-size:12px;color:#8C8A82;font-style:italic}
  .audit{margin-top:8px;font-size:10.5px;color:#a09e96;word-break:break-word}

  .badge{font-size:11px;font-weight:600;padding:2px 9px;border-radius:999px}
  .badge.ok{background:#eafaef;color:#1c5f33;border:1px solid #b6e6c6}
  .badge.wait{background:#fdf3e3;color:#8a5a12;border:1px solid #f0d9a8}
  .disclaimer{background:#fff7ed;border:1px solid #f0d9a8;border-radius:10px;padding:12px 14px;font-size:12.5px;color:#7c5310;margin:18px 0}
  .brandsign{border-top:2px solid #1A1A1A;margin-top:26px;padding-top:16px}
  .bsign-grid{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:28px}
  .bsign-line{border-bottom:1.5px solid #1A1A1A;height:34px}
  .bsign-name{font-weight:600;font-size:14px;margin-top:6px}
  .bsign-title{font-size:12px;color:#8C8A82}

  @media(max-width:560px){
    body{padding:26px 18px 60px}
    .party-grid,.bsign-grid,.grid{grid-template-columns:1fr}
    .sign-row{flex-direction:column;align-items:stretch}
  }

  /* ── Tulostus ──────────────────────────────────────────────────────────
     Tämä on paperille tarkoitettu sopimus, mutta tulostusta ei ohjattu
     mitenkään: neljä sopimusta valui yhteen putkeen, allekirjoitus saattoi
     katketa kahdelle sivulle ja hyväksyttyjen kohtien laatikko halkesi
     keskeltä. Sivunvaihdot kuuluvat dokumenttiin, eivät sattumalle. */
  @page{margin:18mm 16mm}
  @media print{
    body{padding:0;max-width:none;font-size:11.5pt}
    a[href]{text-decoration:none;color:inherit}
    /* Jokainen sopimus omalta sivultaan. Paketissa on neljä erillistä
       sopimusta, ja paperilla ne valuivat yhdeksi putkeksi — allekirjoitus
       saattoi jäädä eri sivulle kuin se sopimus jota se koskee.
       page-break-before on vanha alias: iOS Safari tarvitsee sen yha. */
    .agreement,.brandsign{
      break-before:page;page-break-before:always;
      border-top:none;margin-top:0;padding-top:0}
    /* Nämä eivät saa haljeta: allekirjoitus, ehtolaatikko, osapuolet. */
    .sign,.clauses,.party,.bsign-grid,.disclaimer{break-inside:avoid;page-break-inside:avoid}
    h2,.sec{break-after:avoid;page-break-after:avoid}
    .clauses,.disclaimer,.party,.warn,.badge{
      -webkit-print-color-adjust:exact;print-color-adjust:exact}
  }
</style></head><body>
  <div class="eyebrow">Puuhapatet · Alihankkijasopimus${m.adminLinked ? " · Admin" : ""}</div>
  <h1>${esc(field(m, "fullName") || m.name)}</h1>
  <div class="lede">${esc(where || "Puuhapatet-keikka")} · ${esc(eurPerWindow(m.perWindowCents))} / pesty ikkuna${m.onboardedAt ? " · liittynyt " + esc(fiDate(m.onboardedAt)) : ""}</div>
  <hr class="rule">

  ${partiesBlock(m)}

  <h2 class="first">Taustatiedot</h2>
  ${profileBlock(m)}

  ${agreements}

  ${brandSignatureBlock()}

  <div class="disclaimer">
    Huom: Tämä sopimuspohja on laadittu Puuhapatetille mallina, mutta sitä <b>ei ole vielä
    tarkastettu lakimiehellä</b>. Tarkistuta alihankkija- ja kilpailukieltoehdot
    suomalaisella juristilla ennen kuin nojaat niihin oikeudellisesti.
  </div>
</body></html>`;
}

function fileName(m: CrewMember) {
  const who = (m.profile?.fullName || m.name || "tyontekija").replace(/[^\wÀ-ɏ]+/g, "-").replace(/^-+|-+$/g, "");
  return `Alihankkijasopimus_${who}.html`;
}

export function downloadWorkerContract(input: WorkerDocInput) {
  downloadHtmlDocument(buildWorkerContractHtml(input), fileName(input.member));
}

export function openWorkerContractForPrint(input: WorkerDocInput) {
  printHtmlDocument(buildWorkerContractHtml(input), fileName(input.member));
}

/** Download a single signature PNG (mirrors gig-contract signature export). */
export function downloadSignatureImage(dataUrl: string, name: string) {
  if (typeof document === "undefined" || !dataUrl) return;
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = `${name.replace(/[^\wÀ-ɏ]+/g, "-").replace(/^-+|-+$/g, "")}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
