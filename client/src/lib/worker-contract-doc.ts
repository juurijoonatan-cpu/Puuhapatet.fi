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
import {
  WORKER_AGREEMENTS, PROFILE_QUESTIONS, type WorkerAgreement,
} from "@shared/worker-agreements";

function esc(s: string) {
  return (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}
function fiDate(ts: number) {
  return new Date(ts).toLocaleString("fi-FI");
}

export interface WorkerDocInput {
  member: CrewMember;
  buildingName?: string;
  buildingAddress?: string;
}

function profileBlock(member: CrewMember): string {
  const p = member.profile;
  if (!p) return `<p class="muted">Profiilia ei ole vielä täytetty.</p>`;
  // Map every questionnaire answer back to its label; fall back to the typed cols.
  const answers = p.answers ?? {};
  const rows: string[] = [];
  const seen = new Set<string>();
  const push = (label: string, value?: string) => {
    if (!value) return;
    rows.push(`<div><b>${esc(label)}</b>${esc(value)}</div>`);
  };
  for (const q of PROFILE_QUESTIONS) {
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
  const signBlock = sig
    ? `<div class="sign">
         <div class="grid">
           <div><b>Allekirjoittaja</b>${esc(sig.signerName || member.name)}</div>
           <div><b>Versio</b>${esc(sig.version)}</div>
           <div><b>Aika</b>${esc(fiDate(sig.signedAt))}</div>
           ${sig.ip ? `<div><b>IP</b>${esc(sig.ip)}</div>` : ""}
           ${sig.userAgent ? `<div class="full"><b>Selain</b>${esc(sig.userAgent)}</div>` : ""}
         </div>
         ${sig.signatureDataUrl ? `<div class="sigbox"><img src="${sig.signatureDataUrl}" alt="allekirjoitus"></div>` : ""}
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
  const agreements = WORKER_AGREEMENTS.map((ag) => agreementBlock(ag, m)).join("");
  const where = [input.buildingName, input.buildingAddress].filter(Boolean).join(" · ");
  return `<!doctype html><html lang="fi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Alihankkijasopimus — ${esc(m.name)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:'Poppins',-apple-system,'Segoe UI',system-ui,sans-serif;color:#1A1A1A;max-width:760px;margin:0 auto;padding:40px 26px 80px;line-height:1.6}
  h1{font-size:24px;margin:0 0 2px}
  h2{font-size:17px;margin:0 0 6px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .muted{color:#8C8A82}
  .small{font-size:12px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 20px;font-size:14px;margin:10px 0}
  .grid .full{grid-column:1/-1}
  .grid b{display:block;font-size:11px;letter-spacing:.05em;color:#8C8A82;text-transform:uppercase}
  .agreement{border-top:2px solid #1A1A1A;margin-top:26px;padding-top:16px}
  .intro{color:#555;margin:8px 0 12px}
  .sec{margin:12px 0 2px;font-size:14px}
  .bullet{margin:0 0 4px;padding-left:10px;font-size:13.5px;color:#333}
  .clauses{margin:12px 0;padding:12px 14px;background:#F6F4EE;border:1px solid #E4E1D7;border-radius:10px}
  .clause{margin:0 0 6px;font-size:13.5px}
  .accept{font-weight:600;font-size:13.5px;margin:12px 0 4px}
  .sign{margin-top:8px}
  .sigbox{border:1px solid #E4E1D7;border-radius:10px;padding:12px;margin-top:10px;background:#fff}
  .sigbox img{max-width:320px;max-height:130px;display:block}
  .badge{font-size:11px;font-weight:600;padding:2px 9px;border-radius:999px}
  .badge.ok{background:#eafaef;color:#1c5f33;border:1px solid #b6e6c6}
  .badge.wait{background:#fdf3e3;color:#8a5a12;border:1px solid #f0d9a8}
  .disclaimer{background:#fff7ed;border:1px solid #f0d9a8;border-radius:10px;padding:12px 14px;font-size:12.5px;color:#7c5310;margin:18px 0}
  .brandsign{border-top:2px solid #1A1A1A;margin-top:26px;padding-top:16px}
  .bsign-grid{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:28px}
  .bsign-line{border-bottom:1.5px solid #1A1A1A;height:34px}
  .bsign-name{font-weight:600;font-size:14px;margin-top:6px}
  .bsign-title{font-size:12px;color:#8C8A82}
  @media(max-width:520px){.bsign-grid{grid-template-columns:1fr}}
  @media print{body{padding:0}.clauses,.disclaimer{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>
  <div class="muted small">PUUHAPATET · ALIHANKKIJASOPIMUS${m.adminLinked ? " · ADMIN" : ""}</div>
  <h1>${esc(m.name)}</h1>
  <div class="muted">${esc(where || "Puuhapatet-keikka")} · ${m.perWindowCents / 100} € / pesty ikkuna${m.onboardedAt ? " · liittynyt " + esc(fiDate(m.onboardedAt)) : ""}</div>

  <h2 style="border-top:none;margin-top:22px">Profiili</h2>
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
  if (typeof document === "undefined") return;
  const blob = new Blob([buildWorkerContractHtml(input)], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName(input.member);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function openWorkerContractForPrint(input: WorkerDocInput) {
  const w = window.open("", "_blank");
  if (!w) return downloadWorkerContract(input);
  w.document.write(buildWorkerContractHtml(input));
  w.document.close();
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
