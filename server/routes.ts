import type { Express } from "express";
import { type Server } from "http";
import { eq, desc, sql, ne, and, isNotNull, isNull, inArray } from "drizzle-orm";
import { Resend } from "resend";
import bwipjs from "bwip-js";
import PDFDocument from "pdfkit";
import rateLimit from "express-rate-limit";
import { db } from "./db";
import { customers, jobs, expenses, workerPayments, investments, startupBonusUsages, users, chatConversations, chatMessages, founderSettlements, insertCustomerSchema, insertJobSchema, insertExpenseSchema, insertInvestmentSchema, insertStartupBonusUsageSchema } from "@shared/schema";
import { feeRateForWorker, effectiveJobTotal, FOUNDER_IDS, marketerCommissionCents, MARKETER_COMMISSION_RATE } from "@shared/team";
import { randomUUID, createHash, createHmac, timingSafeEqual, scryptSync, randomBytes } from "crypto";
import {
  AI_ENABLED, ADMIN_AI_ENABLED, chatComplete, chatCompleteWithTools, chatCompleteWithToolsClaude,
  publicSystemPrompt, adminSystemPrompt, marketerAssistantPrompt,
  PUBLIC_FALLBACK_FI, type ChatTurn, type AiTool,
} from "./ai";
import {
  computeOfferCents, computeCustomOfferCents, estimateMinutes, formatEstimate,
  CUSTOM_PRICING_SUMMARY, SQM_RANGES, HOUSE_TYPES,
  type HouseKey, type TierKey, type HeightKey, type AreaKey, type AddonKey, type DifficultyKey,
} from "@shared/pricing";
import { sanitizeGigData, computeTotals, emptyGigData, signatureRequired, gigStatus, type GigData } from "@shared/gig";
import { sanitizeMemberSignature } from "@shared/member-agreement";
import { sanitizeProjectData, computeProjectTotals, computeWorkerStats, computeEfficiency, syncGigSectorsFromProject, emptyProjectData, toNoteKind, fixedDealFor, computeDealBilling, computeEraDebts, allPoints, MAX_OBSERVATION_IMAGE_LEN, MAX_EXPENSE_RECEIPT_LEN, type ProjectData, type ProjExpense, type ProjExpenseKind, type EraDebtBreakdown } from "@shared/project";
import {
  sanitizeCrew, sanitizeCrewMember, newCrewToken, findCrewByToken, crewMemberStats, isOnboarded,
  hasSignedAllAgreements, DEFAULT_WORKER_PER_WINDOW_CENTS, MAX_SIGNATURE_DATAURL_LEN, MAX_PAYOUT_RECEIPT_LEN, MAX_CREW_DOC_LEN, totalPaidPayoutCents, retentionFromDate,
  type CrewMember, type CrewDocument,
} from "@shared/crew";
import { WORKER_AGREEMENTS, REQUIRED_AGREEMENT_IDS, WORKER_AGREEMENT_VERSION, WORKER_AGREEMENTS_GATED } from "@shared/worker-agreements";
import {
  computeTax, readVatStatus, readInPrepaymentRegister, readPayeeType, WITHHOLDING_COMPANY,
  WITHHOLDING_NATURAL_PERSON, VAT_SMALL_BUSINESS_LIMIT_EUR, fmtPct, type TaxBreakdown,
} from "@shared/tax";
import {
  BRAND_BILLERS, DEFAULT_BILLER_ID, resolveBrandBiller, billerToBuyer,
  type Biller, type BuyerSnapshot,
} from "@shared/billers";
import { computePayProgress } from "@shared/payprogress";
import { traineeForUserId, traineeForName, type TraineeInfo } from "@shared/trainees";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
// Ennen kuin puuhapatet.fi-domain on vahvistettu Resendissä, käytä onboarding@resend.dev
const FROM_EMAIL = process.env.FROM_EMAIL || "Puuhapatet <onboarding@resend.dev>";

const EXPENSE_KIND_LABELS: Record<string, string> = {
  transport: "Kuljetus", materials: "Tarvikkeet", equipment: "Kalusto", other: "Muu",
};

/**
 * Builds the internal "kattava maksuraportti" — a manager-only summary of: what we
 * have billed the customer (instalments), what we have paid / still owe the
 * alihankkijat (crew payouts), logged job expenses, and the resulting margin.
 * Never sent to a customer — only to the founders (WORKER_NOTIFICATION_EMAILS).
 */
function buildGigReportHtml(job: { id: number; description: string | null }, gig: GigData, project: ProjectData | null): string {
  const eur = (c: number) => (c / 100).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  const dt = (ts: number) => new Date(ts).toLocaleDateString("fi-FI");
  const esc = (s: string) => String(s).replace(/</g, "&lt;");
  const deal = project ? fixedDealFor(project) : null;

  const invoicedCents = gig.payments.reduce((s, p) => s + p.amountCents, 0);
  const contractCents = deal ? deal.capCents : Math.max(invoicedCents, gig.invoicedCents || 0);
  const remainingCents = Math.max(0, contractCents - invoicedCents);

  // Crew name lookup (for resolving who logged an expense / who got paid).
  const crew = project?.crew || [];
  const nameOf = (id: string) => crew.find((m) => m.id === id)?.name || id;

  // 1) Instalments billed to the customer.
  const instalmentRows = gig.payments.length
    ? gig.payments.map((p, i) => `
        <tr style="border-bottom:1px solid #E4E1D7">
          <td style="padding:8px 0;font-size:13px;color:#1A1A1A">${i + 1}. erä · ${dt(p.t)}</td>
          <td style="padding:8px 0;font-size:13px;color:#8C8A82">${p.biller?.name ? esc(p.biller.name) : "—"}</td>
          <td style="padding:8px 0;text-align:right;font-size:13px;font-weight:600;color:#1A1A1A;font-variant-numeric:tabular-nums">${eur(p.amountCents)}</td>
        </tr>`).join("")
    : `<tr><td colspan="3" style="padding:8px 0;font-size:13px;color:#8C8A82">Ei vielä lähetettyjä eriä.</td></tr>`;

  // 2) Alihankkija payouts (paid vs still pending).
  let crewPaidTotal = 0, crewPendingTotal = 0;
  const crewRows = crew.map((m) => {
    const paid = totalPaidPayoutCents(m);
    const pending = (m.payouts || []).filter((p) => p.status !== "maksettu").reduce((s, p) => s + p.amountCents, 0);
    crewPaidTotal += paid; crewPendingTotal += pending;
    if (paid === 0 && pending === 0) return "";
    return `
      <tr style="border-bottom:1px solid #E4E1D7">
        <td style="padding:8px 0;font-size:13px;color:#1A1A1A">${esc(m.name)}</td>
        <td style="padding:8px 0;text-align:right;font-size:13px;color:#1A1A1A;font-variant-numeric:tabular-nums">${eur(paid)}</td>
        <td style="padding:8px 0;text-align:right;font-size:13px;color:${pending > 0 ? "#B45309" : "#8C8A82"};font-variant-numeric:tabular-nums">${eur(pending)}</td>
      </tr>`;
  }).join("");
  const anyCrew = crewPaidTotal > 0 || crewPendingTotal > 0;

  // 3) Logged expenses (managers + workers), grouped by category.
  const expenses = project?.expenses || [];
  const expTotal = expenses.reduce((s, e) => s + e.amountCents, 0);
  const byKind = expenses.reduce<Record<string, number>>((acc, e) => {
    acc[e.kind] = (acc[e.kind] || 0) + e.amountCents; return acc;
  }, {});
  const expRows = expenses.length
    ? expenses.slice().sort((a, b) => b.ts - a.ts).map((e) => `
        <tr style="border-bottom:1px solid #E4E1D7">
          <td style="padding:8px 0;font-size:13px;color:#1A1A1A">${EXPENSE_KIND_LABELS[e.kind] || e.kind}${e.desc ? ` — ${esc(e.desc)}` : ""}</td>
          <td style="padding:8px 0;font-size:12px;color:#8C8A82">${esc(nameOf(e.by))} · ${dt(e.ts)}</td>
          <td style="padding:8px 0;text-align:right;font-size:13px;color:#1A1A1A;font-variant-numeric:tabular-nums">${eur(e.amountCents)}</td>
        </tr>`).join("")
    : `<tr><td colspan="3" style="padding:8px 0;font-size:13px;color:#8C8A82">Ei kirjattuja kuluja.</td></tr>`;

  // 4) Margin = billed − paid to crew − expenses (rough; excludes pending payouts).
  const marginCents = invoicedCents - crewPaidTotal - expTotal;

  const sumRow = (label: string, value: string, strong = false, color = "#1A1A1A") =>
    `<tr><td style="padding:${strong ? "10px" : "5px"} 0;font-size:${strong ? "15px" : "13px"};font-weight:${strong ? 700 : 400};color:${color}${strong ? ";border-top:2px solid #1A1A1A" : ""}">${label}</td>
      <td style="padding:${strong ? "10px" : "5px"} 0;text-align:right;font-size:${strong ? "16px" : "13px"};font-weight:${strong ? 800 : 600};color:${color};font-variant-numeric:tabular-nums${strong ? ";border-top:2px solid #1A1A1A" : ""}">${value}</td></tr>`;

  return `
<!DOCTYPE html><html lang="fi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F6F4EE;font-family:'Poppins',ui-sans-serif,system-ui,-apple-system,sans-serif">
  <div style="max-width:640px;margin:24px auto;background:#FFFFFF;border-radius:14px;overflow:hidden;border:1px solid #E4E1D7">
    <div style="padding:24px 32px;border-bottom:1px solid #E4E1D7">
      <p style="margin:0;color:#1A1A1A;font-size:18px;font-weight:700">Maksuraportti — sisäinen</p>
      <p style="margin:4px 0 0;color:#8C8A82;font-size:13px">${esc(gig.company?.name || job.description || `Keikka #${job.id}`)}${gig.contractId ? ` · ${esc(gig.contractId)}` : ""} · ${dt(Date.now())}</p>
    </div>
    <div style="padding:20px 32px">
      <p style="margin:0 0 6px;color:#8C8A82;font-size:11px;letter-spacing:1px;text-transform:uppercase">Sopimus & laskutus</p>
      <table width="100%" cellpadding="0" cellspacing="0">
        ${sumRow("Sopimuksen kokonaisarvo", eur(contractCents))}
        ${sumRow(`Laskutettu asiakkaalta (${gig.payments.length} erää)`, eur(invoicedCents))}
        ${sumRow("Laskuttamatta jäljellä", eur(remainingCents))}
      </table>

      <p style="margin:22px 0 6px;color:#8C8A82;font-size:11px;letter-spacing:1px;text-transform:uppercase">Lähetetyt maksuerät</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-top:2px solid #1A1A1A">
        <thead><tr><td style="padding:6px 0;font-size:11px;color:#8C8A82">Erä</td><td style="padding:6px 0;font-size:11px;color:#8C8A82">Laskuttaja</td><td style="padding:6px 0;text-align:right;font-size:11px;color:#8C8A82">Summa</td></tr></thead>
        <tbody>${instalmentRows}</tbody>
      </table>

      <p style="margin:22px 0 6px;color:#8C8A82;font-size:11px;letter-spacing:1px;text-transform:uppercase">Alihankkijoiden maksut</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-top:2px solid #1A1A1A">
        <thead><tr><td style="padding:6px 0;font-size:11px;color:#8C8A82">Tekijä</td><td style="padding:6px 0;text-align:right;font-size:11px;color:#8C8A82">Maksettu</td><td style="padding:6px 0;text-align:right;font-size:11px;color:#8C8A82">Avoinna</td></tr></thead>
        <tbody>${anyCrew ? crewRows : `<tr><td colspan="3" style="padding:8px 0;font-size:13px;color:#8C8A82">Ei maksuja.</td></tr>`}</tbody>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:2px">
        ${sumRow("Maksettu alihankkijoille yhteensä", eur(crewPaidTotal))}
        ${crewPendingTotal > 0 ? sumRow("Avoinna alihankkijoille", eur(crewPendingTotal), false, "#B45309") : ""}
      </table>

      <p style="margin:22px 0 6px;color:#8C8A82;font-size:11px;letter-spacing:1px;text-transform:uppercase">Kulut</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-top:2px solid #1A1A1A">
        <tbody>${expRows}</tbody>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:2px">
        ${Object.entries(byKind).map(([k, v]) => sumRow(EXPENSE_KIND_LABELS[k] || k, eur(v))).join("")}
        ${sumRow("Kulut yhteensä", eur(expTotal), false, "#1A1A1A")}
      </table>

      <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px">
        ${sumRow("Kate (laskutettu − maksetut − kulut)", eur(marginCents), true, marginCents >= 0 ? "#166534" : "#B91C1C")}
      </table>
      <p style="margin:14px 0 0;color:#8C8A82;font-size:11px;line-height:1.6">
        Kate on suuntaa-antava: se vähentää laskutetusta vain jo MAKSETUT alihankkijaerät ja kirjatut kulut.
        Avoimet alihankkijaerät (${eur(crewPendingTotal)}) eivät ole vielä mukana katteessa.
      </p>
    </div>
    <div style="padding:14px 32px;border-top:1px solid #E4E1D7;background:#F6F4EE">
      <p style="margin:0;color:#8C8A82;font-size:12px">Puuhapatet · sisäinen maksuraportti · ei lähetetä asiakkaalle</p>
    </div>
  </div>
</body></html>`;
}

// ─── Asiakkaan yhteydenotto-sähköpostin runko (3 tyyliä) ────────────────────
// Jaettu admin-AI:n luonnos-esikatselun ja varsinaisen lähetyksen kesken, jotta
// asiakas näkee saman viestin kuin AI luonnosteli (puoliautonominen flow).
type OutreachStyle = "henkikohtainen" | "pro" | "lyhyt";
function buildOutreachEmailHtml(style: OutreachStyle, messageText: string, firstName: string): string {
  const msg = messageText.replace(/\n/g, "<br>");
  if (style === "lyhyt") {
    return `<!DOCTYPE html>
<html lang="fi"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff"><tr><td align="center" style="padding:40px 16px">
<table width="540" cellpadding="0" cellspacing="0" style="max-width:540px;width:100%">
  <tr><td style="padding-bottom:32px">
    <p style="margin:0;color:#111;font-size:15px;line-height:1.8">${msg}</p>
  </td></tr>
  <tr><td style="border-top:1px solid #eeeeee;padding-top:20px">
    <p style="margin:0;color:#333;font-size:14px;line-height:1.7">
      Terveisin,<br>
      <strong>Joonatan Juuri</strong> &amp; Matias Pitkänen<br>
      <span style="color:#666">Puuhapatet</span><br>
      <a href="tel:+358400389999" style="color:#2d5016;text-decoration:none">+358 40 0389999</a> · 
      <a href="https://wa.me/358400389999" style="color:#25D366;text-decoration:none">WhatsApp</a><br>
      <a href="https://puuhapatet.fi" style="color:#2d5016;text-decoration:none;font-size:12px">puuhapatet.fi</a>
    </p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
  }
  if (style === "pro") {
    return `<!DOCTYPE html>
<html lang="fi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f0faf2">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0faf2"><tr><td align="center" style="padding:28px 16px">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
  <tr><td style="background:#2d5016;border-radius:16px 16px 0 0;padding:24px 32px">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td><p style="margin:0;color:#fff;font-size:24px;font-weight:900;letter-spacing:-0.5px">Puuhapatet.</p>
          <p style="margin:4px 0 0;color:#a3c97a;font-size:11px">Ammattimainen kiinteistöpalvelu · Espoo &amp; Helsinki</p></td>
      <td style="text-align:right"><span style="background:#a3c97a;color:#1a3a0a;font-size:10px;font-weight:800;letter-spacing:2px;padding:4px 12px;border-radius:20px;text-transform:uppercase">YHTEYDENOTTO</span></td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:0;line-height:0"><img src="https://puuhapatet.fi/hero-workers.jpg" alt="Puuhapatet työssä" style="width:100%;max-height:220px;object-fit:cover;display:block"/></td></tr>
  <tr><td style="background:#fff;border:1px solid #d1f0d8;border-top:none;padding:28px 32px">
    <p style="margin:0 0 20px;color:#2a3a2a;font-size:15px;line-height:1.8">${msg}</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e8f5e9;margin-top:20px;padding-top:20px">
      <tr>
        <td style="padding-top:20px;text-align:center">
          <a href="https://puuhapatet.fi/tilaus" style="display:inline-block;background:#111;color:#4ade80;font-size:15px;font-weight:800;text-decoration:none;padding:16px 40px;border-radius:12px;border:2px solid #22c55e">Jätä yhteydenottopyyntö →</a>
          <br>
          <a href="https://wa.me/358400389999" style="display:inline-block;background:#25D366;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px;margin:10px 4px 0">💬 WhatsApp</a>
          <p style="margin:8px 0 0;color:#999;font-size:12px">Ilmainen tarjous alle 24 tunnissa</p>
        </td>
      </tr>
    </table>
  </td></tr>
  <tr><td style="background:#111;border-radius:0 0 16px 16px;padding:18px 32px">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td><p style="margin:0 0 2px;color:#4ade80;font-size:15px;font-weight:800">Puuhapatet.</p>
          <p style="margin:0;color:#666;font-size:12px">Joonatan +358 40 0389999 · Matias +358 44 2350881</p></td>
      <td style="text-align:right"><a href="https://puuhapatet.fi" style="color:#4ade80;font-weight:700;text-decoration:none;font-size:13px">puuhapatet.fi</a></td>
    </tr></table>
  </td></tr>
</table></td></tr></table>
</body></html>`;
  }
  // henkikohtainen (default)
  return `<!DOCTYPE html>
<html lang="fi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8faf8"><tr><td align="center" style="padding:32px 16px">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.07)">
  <tr><td style="background:#2d5016;padding:20px 28px">
    <p style="margin:0;color:#fff;font-size:18px;font-weight:800;letter-spacing:-0.3px">Puuhapatet.</p>
  </td></tr>
  <tr><td style="padding:28px 28px 8px">
    <p style="margin:0 0 18px;color:#1a1a1a;font-size:22px;font-weight:700;line-height:1.3">Hei ${firstName}! 👋</p>
    <p style="margin:0;color:#333;font-size:15px;line-height:1.8">${msg}</p>
  </td></tr>
  <tr><td style="padding:20px 28px">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0faf2;border-radius:10px;padding:16px">
      <tr><td style="padding:0">
        <p style="margin:0 0 10px;color:#2d5016;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px">Ota yhteyttä</p>
        <p style="margin:0 0 6px;font-size:14px;color:#333">
          💬 <a href="https://wa.me/358400389999" style="color:#2d5016;font-weight:600;text-decoration:none">WhatsApp — Joonatan</a>
          <span style="color:#999;font-size:12px"> (+358 40 0389999)</span>
        </p>
        <p style="margin:0;font-size:14px;color:#333">
          🌐 <a href="https://puuhapatet.fi/tilaus" style="color:#2d5016;font-weight:600;text-decoration:none">puuhapatet.fi/tilaus</a>
          <span style="color:#999;font-size:12px"> — jätä yhteystiedot, soitamme takaisin</span>
        </p>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:0 28px 24px">
    <p style="margin:0;color:#555;font-size:14px;line-height:1.7">
      Terveisin,<br>
      <strong style="color:#1a1a1a">Joonatan &amp; Matias</strong><br>
      <span style="color:#2d5016;font-size:13px">Puuhapatet</span>
    </p>
  </td></tr>
  <tr><td style="background:#f8f8f8;padding:12px 28px;border-top:1px solid #eee">
    <p style="margin:0;color:#aaa;font-size:11px">
      <a href="https://puuhapatet.fi" style="color:#aaa;text-decoration:none">puuhapatet.fi</a> · info@puuhapatet.fi · Espoo &amp; Helsinki
    </p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

// Brändi ei ole vielä yhtiö → laskun OSTAJA on yksi johtajista (oma Y-tunnus).
// Kun yhtiöityy, aseta COMPANY_* → "company"-laskuttaja valittavaksi ostajaksi.
function companyBiller(): Biller | null {
  const name = process.env.COMPANY_NAME;
  const yTunnus = process.env.COMPANY_Y_TUNNUS;
  if (!name && !yTunnus) return null;
  return {
    id: "company", kind: "company",
    name: name || "Puuhapatet",
    yTunnus: yTunnus || undefined,
    address: process.env.COMPANY_ADDRESS || undefined,
    email: process.env.COMPANY_EMAIL || undefined,
  };
}
function allBillers(): Biller[] {
  const c = companyBiller();
  return c ? [c, ...BRAND_BILLERS] : BRAND_BILLERS;
}
/** Resolve a payout's BUYER from a biller id (leader today, company later).
 *  Defaults to the company if configured, else the first leader. */
function resolveBuyer(billerId?: string | null): BuyerSnapshot {
  const found = allBillers().find((b) => b.id === billerId)
    ?? companyBiller()
    ?? resolveBrandBiller(DEFAULT_BILLER_ID)
    ?? BRAND_BILLERS[0];
  return billerToBuyer(found);
}

/** Is this crew member a trainee (harjoittelija)? Matched by linked login / id /
 *  first name. Trainees aren't bound by the subcontractor signing gate. */
function isCrewTrainee(member: CrewMember): boolean {
  return !!(traineeForUserId(member.linkedUserId) || traineeForUserId(member.id) || traineeForName(member.name));
}
// Optional: protect the calendar feed with a token (set CALENDAR_TOKEN env var on Render)
const CALENDAR_TOKEN = process.env.CALENDAR_TOKEN || null;

/** Clean, simple end-of-day summary email to the worker (best-effort). */
async function sendSessionSummaryEmail(
  member: CrewMember,
  s: { start: number; end: number; minutes: number; windows: number; earnedCents: number },
  buildingName?: string,
): Promise<void> {
  if (!resend) return;
  const to = member.profile?.email;
  if (!to) return;
  const eur = (c: number) => (c / 100).toLocaleString("fi-FI", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " €";
  const dur = s.minutes >= 60 ? `${Math.floor(s.minutes / 60)} t ${s.minutes % 60} min` : `${s.minutes} min`;
  const first = (member.profile?.fullName || member.name || "").split(/\s+/)[0] || "";
  const day = new Date(s.end).toLocaleDateString("fi-FI", { day: "numeric", month: "numeric", year: "numeric" });
  const row = (label: string, value: string) =>
    `<tr><td style="padding:10px 0;color:#8C8A82;font-size:13px">${label}</td><td style="padding:10px 0;text-align:right;font-weight:700;font-size:16px;color:#1A1A1A">${value}</td></tr>`;
  const html = `<!doctype html><html><body style="margin:0;background:#F6F4EE;font-family:'Poppins',-apple-system,Segoe UI,system-ui,sans-serif">
  <div style="max-width:460px;margin:0 auto;padding:28px 20px">
    <div style="background:#fff;border:1px solid #E4E1D7;border-radius:18px;padding:26px">
      <div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#8C8A82">Puuhapatet</div>
      <h1 style="font-size:22px;margin:8px 0 2px;color:#1A1A1A">Hyvää työtä${first ? `, ${first}` : ""}! 🎉</h1>
      <p style="margin:0 0 18px;color:#8C8A82;font-size:14px">Päivän yhteenveto · ${day}${buildingName ? ` · ${buildingName}` : ""}</p>
      <table style="width:100%;border-collapse:collapse">
        ${row("Pestyt ikkunat", String(s.windows))}
        ${row("Ansio", eur(s.earnedCents))}
        ${row("Työaika", dur)}
      </table>
      <p style="margin:20px 0 0;color:#8C8A82;font-size:12.5px;line-height:1.6">Ansio kertyy tekemistäsi ikkunoista ja maksetaan oman Y-tunnuksesi kautta. Kiitos päivästä!</p>
    </div>
    <p style="text-align:center;color:#b8b5ab;font-size:11px;margin-top:14px">Puuhapatet · puuhapatet.fi</p>
  </div></body></html>`;
  // Copy the bosses (us) so a finished day — whether stopped on the timer or
  // logged by hand afterwards — always lands in our inbox too. Bcc keeps the
  // worker's view clean (they don't see the founders' addresses).
  const bcc = WORKER_NOTIFICATION_EMAILS.filter((e) => e && e !== to);
  await resend.emails.send({
    from: FROM_EMAIL,
    to,
    ...(bcc.length ? { bcc } : {}),
    subject: `Päivän yhteenveto — ${s.windows} ikkunaa · ${eur(s.earnedCents)}`,
    html,
  });
}
// Notification email list — override via WORKER_EMAILS env var (comma-separated)
const WORKER_NOTIFICATION_EMAILS: string[] = process.env.WORKER_EMAILS
  ? process.env.WORKER_EMAILS.split(",").map(e => e.trim()).filter(Boolean)
  : ["joonatan@puuhapatet.fi", "matias@puuhapatet.fi"];
// Extra blind-copy recipients for CUSTOMER invoices, on top of the founders'
// puuhapatet.fi addresses — e.g. Matias's personal inbox. Overridable via env.
const INVOICE_BCC_EMAILS: string[] = process.env.INVOICE_BCC_EMAILS
  ? process.env.INVOICE_BCC_EMAILS.split(",").map(e => e.trim()).filter(Boolean)
  : ["matiaspit88@gmail.com"];
// Admin / contact-form recipient
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "joonatan@puuhapatet.fi";

// ─── Admin authentication ─────────────────────────────────────────────────────
// Server-side auth for the admin/data API. Uses an HMAC-signed bearer token and
// scrypt-hashed passwords — both from Node's built-in `crypto`, so there are NO
// new dependencies and NO paid services. The token is stateless (no DB lookup
// per request), so it scales across instances.
//
// AUTH_SECRET MUST be set in the deployment environment. Without it the admin
// API refuses to log anyone in (fail closed) rather than trusting everyone.
const AUTH_SECRET = process.env.AUTH_SECRET || "";
// First-time password for an account that has never set one. Lets the team log
// in once after the upgrade; the password is hashed on first successful login.
const ADMIN_DEFAULT_PASSWORD = process.env.ADMIN_DEFAULT_PASSWORD || "";
// Per-user starter passwords for brand-new accounts (worker logins). Accepted
// only until the user sets their own; then it's hashed and this is ignored.
const INITIAL_PASSWORDS: Record<string, string> = { jani: "Jani123", milja: "milja456", oliver: "Oliver234", oona: "Oona345", petrus: "Petrus123", myyja1: "Myyja123" };
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

// scrypt password hashing — format: "scrypt$<saltHex>$<hashHex>"
function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

function isHashed(stored: string | null | undefined): boolean {
  return !!stored && stored.startsWith("scrypt$");
}

// Verifies a password against either a scrypt hash or — for the one-time upgrade
// path — a legacy plaintext value. Constant-time where it matters.
function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  if (isHashed(stored)) {
    const [, saltHex, hashHex] = stored.split("$");
    if (!saltHex || !hashHex) return false;
    const expected = Buffer.from(hashHex, "hex");
    const actual = scryptSync(password, Buffer.from(saltHex, "hex"), 64);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
  // Legacy plaintext (pre-upgrade). Equal-length guard avoids a throw in timingSafe.
  const a = Buffer.from(password);
  const b = Buffer.from(stored);
  return a.length === b.length && timingSafeEqual(a, b);
}

interface AdminTokenPayload { sub: string; role: string; exp: number }

function signToken(payload: AdminTokenPayload): string {
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(createHmac("sha256", AUTH_SECRET).update(body).digest());
  return `${body}.${sig}`;
}

function verifyToken(token: string): AdminTokenPayload | null {
  if (!AUTH_SECRET || !token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = b64url(createHmac("sha256", AUTH_SECRET).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as AdminTokenPayload;
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

// Public API routes that must NOT require admin auth: customer links (quote/gig),
// worker links (crew tokens carry their own auth), public forms, chat, health.
// Everything else under /api is admin-only (default-deny).
const PUBLIC_API: { method: string; re: RegExp }[] = [
  { method: "GET",  re: /^\/api\/health$/ },
  { method: "GET",  re: /^\/api\/ai-status$/ },
  { method: "POST", re: /^\/api\/contact$/ },
  { method: "POST", re: /^\/api\/it-contact$/ },
  { method: "POST", re: /^\/api\/chat$/ },
  { method: "POST", re: /^\/api\/chat\/handoff$/ },
  { method: "POST", re: /^\/api\/admin\/login$/ },
  { method: "GET",  re: /^\/api\/calendar\.ics$/ },
  { method: "GET",  re: /^\/api\/crew-agreements$/ },
  { method: "GET",  re: /^\/api\/quote\/[^/]+$/ },
  { method: "POST", re: /^\/api\/quote\/[^/]+\/respond$/ },
  { method: "GET",  re: /^\/api\/gig\/[^/]+$/ },
  { method: "POST", re: /^\/api\/gig\/[^/]+\/sign$/ },
  { method: "GET",  re: /^\/api\/crew\/[^/]+$/ },
  { method: "POST", re: /^\/api\/crew\/[^/]+\/(auth|onboard|window|hours|note|map-note|shift|expense)$/ },
  { method: "POST", re: /^\/api\/crew\/[^/]+\/map-note\/(update|delete)$/ },
  { method: "POST", re: /^\/api\/crew\/[^/]+\/payout\/[^/]+\/approve$/ },
  { method: "DELETE", re: /^\/api\/crew\/[^/]+\/expense\/[^/]+$/ },
];

function isPublicApi(method: string, path: string): boolean {
  return PUBLIC_API.some(r => r.method === method && r.re.test(path));
}

function escapeIcs(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function toIcsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
}

// ─── Finnish payment barcode helpers ─────────────────────────────────────────

function finnishRefWithCheckDigit(numericStr: string): string {
  const s = numericStr.replace(/\D/g, "") || "0";
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum += parseInt(s[s.length - 1 - i]) * weights[i % 3];
  return s + ((10 - (sum % 10)) % 10);
}

function formatFinnishRef(ref: string): string {
  // Display format: groups of 3 from right, e.g. "424" → "424", "000042" → "42"
  const digits = ref.replace(/\D/g, "");
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

async function generateFinnishBarcodeHtml(params: {
  iban: string; amountCents: number; viitenumero: string; dueDateISO?: string; isEn: boolean;
}): Promise<string> {
  try {
    const ibanDigits = params.iban.replace(/[\s]/g, "").replace(/^FI/, "").slice(0, 16).padStart(16, "0");
    const euros = Math.floor(params.amountCents / 100);
    const cents = params.amountCents % 100;
    const amountStr = String(euros).padStart(6, "0") + String(cents).padStart(2, "0");
    const numericBase = params.viitenumero.replace(/\D/g, "") || "1";
    const refFull = finnishRefWithCheckDigit(numericBase);
    const refPadded = refFull.padStart(20, "0");
    let dueDateStr = "000000";
    if (params.dueDateISO) {
      const d = new Date(params.dueDateISO + "T12:00:00");
      dueDateStr = String(d.getFullYear()).slice(-2) + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
    }
    const barcodeData = "4" + ibanDigits + amountStr + "000" + refPadded + dueDateStr;
    const svg = (bwipjs as any).toSVG({ bcid: "code128", text: barcodeData, scale: 3, height: 12, includetext: false });
    const b64 = Buffer.from(svg).toString("base64");
    return `
      <div style="text-align:center;margin-top:20px;padding-top:16px;border-top:1px dashed #fde68a">
        <img src="data:image/svg+xml;base64,${b64}" alt="Pankkiviivakoodi" style="max-width:100%;height:56px;display:inline-block" />
        <p style="margin:6px 0 0;font-size:10px;color:#78350f;font-family:'Courier New',monospace;letter-spacing:0.5px">${barcodeData}</p>
        <p style="margin:4px 0 0;font-size:11px;color:#92400e">${params.isEn ? "Scan barcode with your banking app to pay" : "Skannaa pankkiviivakoodi pankkisovelluksella"}</p>
      </div>`;
  } catch { return ""; }
}

// ─── Service receipt PDF ──────────────────────────────────────────────

function generateKotitalousReceiptPdf(params: {
  customerName: string;
  customerAddress?: string;
  workerName?: string;
  workerYTunnus?: string;
  workerAddress?: string;
  description: string;
  completionDate: string;
  paymentMethod?: string;
  agreedPriceCents: number;
  laborCents: number;
  estimatedHours?: number;
  expensesTotalCents?: number;
  lang?: string;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const isEn = params.lang === "en";
    const GREEN = "#2d5016";
    const GRAY = "#64748b";
    const LIGHT = "#f8fafc";
    const fmtEur = (cents: number) =>
      (cents / 100).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

    const pageW = doc.page.width - 96;

    // ── Header bar ────────────────────────────────────────────────────────────────
    doc.rect(48, 48, pageW, 56).fill(GREEN);
    doc.fill("#fff").font("Helvetica-Bold").fontSize(16)
      .text(isEn ? "SERVICE RECEIPT" : "PALVELUTOSITE", 64, 62, { width: pageW - 32 });
    doc.fill("#b8e07a").font("Helvetica").fontSize(9)
      .text("Puuhapatet  ·  puuhapatet.fi  ·  info@puuhapatet.fi", 64, 84, { width: pageW - 32 });

    let y = 124;
    const colW = (pageW - 16) / 2;

    // ── Parties ──────────────────────────────────────────────────────────────────────
    doc.fill(GRAY).font("Helvetica-Bold").fontSize(7)
      .text(isEn ? "SERVICE PROVIDER" : "PALVELUN SUORITTAJA", 48, y, { width: colW });
    doc.text(isEn ? "CUSTOMER" : "ASIAKAS", 48 + colW + 16, y, { width: colW });

    y += 14;
    doc.fill("#1e293b").font("Helvetica-Bold").fontSize(10);
    doc.text(params.workerName || "Puuhapatet", 48, y, { width: colW });
    doc.text(params.customerName, 48 + colW + 16, y, { width: colW });

    y += 14;
    doc.fill(GRAY).font("Helvetica").fontSize(9);
    if (params.workerYTunnus) {
      doc.text(`Y-tunnus: ${params.workerYTunnus}`, 48, y, { width: colW });
      y += 12;
    }
    if (params.workerAddress) doc.text(params.workerAddress, 48, y, { width: colW });
    if (params.customerAddress) doc.text(params.customerAddress, 48 + colW + 16, y - (params.workerYTunnus ? 12 : 0), { width: colW });
    y += 24;

    // ── Divider ────────────────────────────────────────────────────────────────────────
    doc.moveTo(48, y).lineTo(48 + pageW, y).strokeColor("#e2e8f0").lineWidth(1).stroke();
    y += 16;

    // ── Service details ───────────────────────────────────────────────────────────────────────
    doc.fill(GRAY).font("Helvetica-Bold").fontSize(7)
      .text(isEn ? "SERVICE DETAILS" : "PALVELUTIEDOT", 48, y);
    y += 14;

    const detailRows: [string, string][] = [
      [isEn ? "Service" : "Palvelu", params.description],
      [isEn ? "Date" : "P\xe4iv\xe4m\xe4\xe4r\xe4", params.completionDate],
    ];
    if (params.estimatedHours) {
      detailRows.push([isEn ? "Duration" : "Kesto", `~${params.estimatedHours} h`]);
    }
    if (params.paymentMethod) {
      const pm = params.paymentMethod === "k\xe4teinen" ? (isEn ? "Cash" : "K\xe4teinen")
        : params.paymentMethod === "mobilepay" ? "MobilePay"
        : params.paymentMethod === "kortti" ? (isEn ? "Card" : "Kortti")
        : params.paymentMethod === "tilisiirto" ? (isEn ? "Bank transfer" : "Tilisiirto")
        : params.paymentMethod;
      detailRows.push([isEn ? "Payment" : "Maksutapa", pm]);
    }
    for (const [label, value] of detailRows) {
      doc.fill(GRAY).font("Helvetica").fontSize(9).text(label, 48, y, { width: 140 });
      doc.fill("#1e293b").font("Helvetica-Bold").fontSize(9).text(value, 48 + 140, y, { width: colW });
      y += 14;
    }

    y += 8;
    doc.moveTo(48, y).lineTo(48 + pageW, y).strokeColor("#e2e8f0").lineWidth(1).stroke();
    y += 16;

    // ── Price breakdown ──────────────────────────────────────────────────────────────────────────
    doc.fill(GRAY).font("Helvetica-Bold").fontSize(7)
      .text(isEn ? "PRICE BREAKDOWN" : "HINNAN ERITTELY", 48, y);
    y += 14;

    const hasExpenses = !!(params.expensesTotalCents && params.expensesTotalCents > 0);
    doc.rect(48, y, pageW, (hasExpenses ? 3 : 2) * 18 + 24).fill(LIGHT);
    y += 12;

    const priceRows: [string, string, boolean][] = [];
    if (hasExpenses) {
      priceRows.push([isEn ? "Labour" : "Ty\xf6", fmtEur(params.laborCents), false]);
      priceRows.push([isEn ? "Materials" : "V\xe4linekulut", fmtEur(params.expensesTotalCents!), false]);
    }
    priceRows.push([isEn ? "Total" : "Yhteens\xe4", fmtEur(params.agreedPriceCents), true]);

    for (const [label, value, bold] of priceRows) {
      doc.fill(bold ? GREEN : GRAY).font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 10 : 9)
        .text(label, 60, y, { width: pageW - 120 });
      doc.fill(bold ? GREEN : "#1e293b").font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 10 : 9)
        .text(value, 60 + (pageW - 120), y, { width: 100, align: "right" });
      y += 18;
    }

    doc.end();
  });
}

// ─── Worker (alihankkija) invoice PDF ─────────────────────────────────────────
// The legally-formatted invoice the subcontractor issues TO Puuhapatet (their
// Y-tunnus → Puuhapatet). Generated automatically once Puuhapatet marks the
// payout paid. Note the direction is the opposite of the customer invoice.
function generateWorkerInvoicePdf(params: {
  invoiceNo: string;
  workerName: string;
  workerYTunnus?: string;
  workerAddress?: string;
  workerIban?: string;
  windows: number;
  amountCents: number;
  note?: string;
  invoiceDate: string;
  paidDate?: string;
  /** Vero-erittely (ALV + ennakonpidätys). amountCents = työkorvaus ilman ALV:tä. */
  tax: TaxBreakdown;
  /** Laskun OSTAJA — johtaja (oma Y-tunnus) joka laskutti asiakkaan, tai yhtiö. */
  buyer: BuyerSnapshot;
  /** Itselaskutuksen hyväksyntä: milloin laskuttaja (työntekijä) hyväksyi maksun
   *  (epoch ms). Todentaa AVL 209 b §:n edellyttämän hyväksymismenettelyn. */
  acceptedAt?: number;
  /** Laskuttajan omat vähennyskelpoiset kulut — EI osa maksettavaa summaa, vain
   *  tiedoksi/verotusta varten. */
  expenses?: { desc: string; amountCents: number }[];
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const INK = "#1A1A1A";
    const GRAY = "#64748b";
    const NAVY = "#1F3B57";
    const fmtEur = (cents: number) =>
      (cents / 100).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
    const pageW = doc.page.width - 96;

    // Header
    doc.rect(48, 48, pageW, 56).fill(NAVY);
    doc.fill("#fff").font("Helvetica-Bold").fontSize(16).text("LASKU", 64, 62, { width: pageW - 32 });
    doc.fill("#cdd9e6").font("Helvetica").fontSize(9)
      .text(`Laskunumero ${params.invoiceNo}  ·  ${params.invoiceDate}`, 64, 84, { width: pageW - 32 });

    let y = 124;
    const colW = (pageW - 16) / 2;

    // Parties: worker (seller) → the leader/company who billed the customer (buyer)
    const buyer = params.buyer;
    doc.fill(GRAY).font("Helvetica-Bold").fontSize(7).text("LASKUTTAJA (MYYJÄ)", 48, y, { width: colW });
    doc.text("LASKUN SAAJA (OSTAJA)", 48 + colW + 16, y, { width: colW });
    y += 14;
    doc.fill(INK).font("Helvetica-Bold").fontSize(10);
    doc.text(params.workerName || "Alihankkija", 48, y, { width: colW });
    doc.text(buyer.name || "Puuhapatet", 48 + colW + 16, y, { width: colW });
    y += 14;
    doc.fill(GRAY).font("Helvetica").fontSize(9);
    const leftStartY = y;
    if (params.workerYTunnus) { doc.text(`Y-tunnus: ${params.workerYTunnus}`, 48, y, { width: colW }); y += 12; }
    if (params.workerAddress) { doc.text(params.workerAddress, 48, y, { width: colW }); y += 12; }
    if (params.workerIban) { doc.text(`IBAN: ${params.workerIban}`, 48, y, { width: colW }); y += 12; }
    // Buyer details (right column).
    let ry = leftStartY;
    doc.text(`Y-tunnus: ${buyer.yTunnus || "—"}`, 48 + colW + 16, ry, { width: colW }); ry += 12;
    if (buyer.address) { doc.text(buyer.address, 48 + colW + 16, ry, { width: colW }); ry += 12; }
    doc.text(buyer.email || "info@puuhapatet.fi", 48 + colW + 16, ry, { width: colW }); ry += 12;
    doc.text("Puuhapatet (brändi)", 48 + colW + 16, ry, { width: colW }); ry += 12;

    y = Math.max(y, ry) + 6;
    // Supply date (AVL 209 b § edellyttää toimituspäivän).
    doc.fill(GRAY).font("Helvetica").fontSize(9).text(`Toimituspäivä: ${params.paidDate || params.invoiceDate}`, 48, y);
    y += 16;
    // Itselaskutus — pakollinen laskumerkintä, kun OSTAJA laatii laskun myyjän
    // nimissä (AVL 209 b §). Edellyttää myyjän hyväksyntää; merkitään se tähän.
    doc.fill(NAVY).font("Helvetica-Bold").fontSize(9).text("Itselaskutus — ostajan laatima lasku (AVL 209 b §)", 48, y);
    y += 13;
    if (params.acceptedAt) {
      doc.fill(GRAY).font("Helvetica").fontSize(8)
        .text(`Laskuttaja hyväksynyt laskun: ${new Date(params.acceptedAt).toLocaleDateString("fi-FI")}`, 48, y);
      y += 14;
    } else {
      y += 4;
    }

    const tax = params.tax;
    // Line item — veroton työkorvaus.
    doc.rect(48, y, pageW, 26).fill("#F1F5F9");
    doc.fill(GRAY).font("Helvetica-Bold").fontSize(8);
    doc.text("KUVAUS", 60, y + 9, { width: pageW - 140 });
    doc.text("VEROTON", 48 + pageW - 100, y + 9, { width: 88, align: "right" });
    y += 26;

    const desc = params.note || "Ikkunanpesutyö (alihankinta)";
    const unitCents = params.windows > 0 ? Math.round(tax.laborCents / params.windows) : 0;
    const qtyLine = params.windows > 0 ? `${params.windows} ikkunaa × ${fmtEur(unitCents)} / ikkuna` : "";
    doc.fill(INK).font("Helvetica").fontSize(10).text(desc, 60, y + 7, { width: pageW - 140 });
    if (qtyLine) doc.fill(GRAY).font("Helvetica").fontSize(8).text(qtyLine, 60, y + 22, { width: pageW - 140 });
    doc.fill(INK).font("Helvetica-Bold").fontSize(10).text(fmtEur(tax.laborCents), 48 + pageW - 100, y + 7, { width: 88, align: "right" });
    y += 38;
    doc.moveTo(48, y).lineTo(48 + pageW, y).strokeColor("#E2E8F0").stroke();
    y += 12;

    // Subtotals — veroton, ALV, loppusumma; sitten ennakonpidätys ja maksettava.
    const sumRow = (label: string, value: string, opts?: { bold?: boolean; color?: string; size?: number }) => {
      const size = opts?.size ?? 9;
      doc.fill(opts?.color ?? GRAY).font(opts?.bold ? "Helvetica-Bold" : "Helvetica").fontSize(size)
        .text(label, 48 + pageW - 240, y, { width: 140, align: "right" });
      doc.fill(opts?.color ?? INK).font(opts?.bold ? "Helvetica-Bold" : "Helvetica").fontSize(size)
        .text(value, 48 + pageW - 100, y, { width: 88, align: "right" });
      y += size + 7;
    };
    sumRow("Veroton (työkorvaus)", fmtEur(tax.laborCents));
    if (tax.vatRegistered) {
      sumRow(`ALV ${fmtPct(tax.vatRate)}`, fmtEur(tax.vatCents));
      sumRow("Laskun loppusumma", fmtEur(tax.invoiceTotalCents), { bold: true });
    }
    if (tax.withheld) {
      y += 2;
      sumRow(`Ennakonpidätys ${fmtPct(tax.withholdingRate)}`, "−" + fmtEur(tax.withholdingCents));
    }
    y += 4;
    doc.fill(NAVY).font("Helvetica-Bold").fontSize(13)
      .text(tax.withheld ? "Maksetaan tilille" : "Maksettavaa", 48 + pageW - 240, y, { width: 140, align: "right" });
    doc.text(fmtEur(tax.payableCents), 48 + pageW - 100, y, { width: 88, align: "right" });
    y += 30;

    // Vero-perustelut (ALV-status + ennakkoperintä) selkokielellä.
    doc.fill(GRAY).font("Helvetica").fontSize(8);
    for (const note of tax.notes) {
      doc.text(note, 48, y, { width: pageW });
      y += doc.heightOfString(note, { width: pageW }) + 4;
    }
    doc.text("Lasku alihankintatyöstä Puuhapatetille.", 48, y, { width: pageW });
    y += 20;

    // Laskuttajan omat vähennyskelpoiset kulut — informatiivinen, EI osa
    // maksettavaa summaa. Auttaa työntekijää vähentämään kulut omassa verotuksessa.
    const exp = (params.expenses || []).filter((e) => e.amountCents > 0);
    if (exp.length > 0) {
      const expTotal = exp.reduce((s, e) => s + e.amountCents, 0);
      const taxableAfter = Math.max(0, tax.laborCents - expTotal);
      doc.moveTo(48, y).lineTo(48 + pageW, y).strokeColor("#E2E8F0").stroke();
      y += 12;
      doc.fill(NAVY).font("Helvetica-Bold").fontSize(9)
        .text("Laskuttajan vähennyskelpoiset kulut (tiedoksi verotusta varten — ei osa maksettavaa summaa)", 48, y, { width: pageW });
      y += 16;
      doc.font("Helvetica").fontSize(9);
      for (const e of exp) {
        doc.fill(INK).text(e.desc, 60, y, { width: pageW - 160 });
        doc.fill(INK).text(fmtEur(e.amountCents), 48 + pageW - 100, y, { width: 88, align: "right" });
        y += 14;
      }
      doc.fill(GRAY).font("Helvetica-Bold").fontSize(9)
        .text("Kulut yhteensä", 48 + pageW - 240, y, { width: 140, align: "right" });
      doc.fill(INK).text("−" + fmtEur(expTotal), 48 + pageW - 100, y, { width: 88, align: "right" });
      y += 14;
      doc.fill(GRAY).font("Helvetica").fontSize(8)
        .text(`Verotettava tulo kulujen jälkeen (arvio): ${fmtEur(taxableAfter)}. Säilytä kuitit tositteina.`, 48, y, { width: pageW });
      y += 18;
    }

    if (params.workerIban) {
      doc.fill(INK).font("Helvetica-Bold").fontSize(9).text("Maksutiedot", 48, y); y += 14;
      doc.fill(GRAY).font("Helvetica").fontSize(9).text(`Tilinumero (IBAN): ${params.workerIban}`, 48, y); y += 12;
      doc.text(`Viite: ${params.invoiceNo}`, 48, y); y += 12;
    }
    if (params.paidDate) {
      doc.fill("#3E7C59").font("Helvetica-Bold").fontSize(9).text(`Maksettu ${params.paidDate}.`, 48, y);
    }

    doc.end();
  });
}


export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {

  // ─── Rate limiters ────────────────────────────────────────────────────────────
  const emailLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Liian monta pyyntöä. Yritä tunnin kuluttua." },
  });
  const contactLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 8,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Liian monta pyyntöä. Yritä tunnin kuluttua." },
  });
  app.use("/api/send-receipt",      emailLimiter);
  app.use("/api/send-job-summary",  emailLimiter);
  app.use("/api/send-progress-update", emailLimiter);
  app.use("/api/send-quote",        emailLimiter);
  app.use("/api/jobs/:id/gig/invoice", emailLimiter);
  app.use("/api/contact",           contactLimiter);
  app.use("/api/it-contact",        contactLimiter);
  // Chat: allow a real back-and-forth but stop abuse (per IP)
  const chatLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Liian monta viestiä. Hetki ja yritä uudelleen." },
  });
  app.use("/api/chat",            chatLimiter);
  app.use("/api/admin/assistant", chatLimiter);

  // Brute-force protection for the login endpoint.
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Liian monta kirjautumisyritystä. Yritä hetken kuluttua." },
  });
  app.use("/api/admin/login", loginLimiter);

  // ─── Admin auth gate (default-deny) ────────────────────────────────────────────
  // Runs before every route below. Public API routes pass through; everything
  // else under /api requires a valid admin bearer token. Non-/api requests
  // (static assets, the SPA) are untouched.
  app.use((req, res, next) => {
    if (!req.path.startsWith("/api/")) return next();
    if (isPublicApi(req.method, req.path)) return next();
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const payload = verifyToken(token);
    if (!payload) return res.status(401).json({ error: "Kirjautuminen vaaditaan" });
    (req as any).admin = payload;
    next();
  });

  // ─── Admin login ───────────────────────────────────────────────────────────────
  app.post("/api/admin/login", async (req, res) => {
    try {
      if (!AUTH_SECRET) {
        return res.status(503).json({ error: "Palvelinta ei ole vielä konfiguroitu (AUTH_SECRET puuttuu)." });
      }
      const { userId, password } = req.body ?? {};
      if (!userId || !password) {
        return res.status(400).json({ error: "Käyttäjä ja salasana vaaditaan." });
      }
      const [row] = await db.select().from(users).where(eq(users.username, String(userId)));
      const stored = row?.passwordHash || "";

      let ok = false;
      let usedStarter = false;
      if (stored) {
        ok = verifyPassword(String(password), stored);
      } else {
        // Account has no password yet → accept a per-user starter password (e.g.
        // Jani logs in once with "Jani123") or the shared one-time default.
        const starter = INITIAL_PASSWORDS[String(userId).toLowerCase()];
        if (starter && String(password) === starter) { ok = true; usedStarter = true; }
        else if (ADMIN_DEFAULT_PASSWORD && String(password) === ADMIN_DEFAULT_PASSWORD) { ok = true; usedStarter = true; }
      }
      if (!ok) return res.status(401).json({ error: "Virheellinen salasana." });

      // Lazy upgrade: migrate legacy plaintext (or a freshly defaulted account)
      // to a scrypt hash so it's stored safely from now on. Nobody is locked out.
      if (!isHashed(stored)) {
        const newHash = hashPassword(String(password));
        if (row) {
          await db.update(users).set({ passwordHash: newHash }).where(eq(users.username, String(userId)));
        } else {
          await db.insert(users).values({ name: String(userId), username: String(userId), passwordHash: newHash, role: "staff" });
        }
      }

      const role = row?.role || "staff";
      const token = signToken({ sub: String(userId), role, exp: Date.now() + TOKEN_TTL_MS });
      // Tell the client to prompt for a new password when a starter was used.
      res.json({ ok: true, token, role, mustChangePassword: usedStarter });
    } catch (e: any) {
      console.error("Login error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Health ──────────────────────────────────────────────────────────────────
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, ts: new Date().toISOString() });
  });

  // ─── ICS Calendar feed ───────────────────────────────────────────────────────

  app.get("/api/calendar.ics", async (req, res) => {
    // Optional token check
    if (CALENDAR_TOKEN && req.query.token !== CALENDAR_TOKEN) {
      res.status(401).send("Unauthorized");
      return;
    }
    try {
      const rows = await db
        .select({ job: jobs, customer: customers })
        .from(jobs)
        .leftJoin(customers, eq(jobs.customerId, customers.id))
        .where(and(ne(jobs.status, "lead"), ne(jobs.status, "cancelled"), ne(jobs.status, "done")));

      const now = toIcsDate(new Date());

      const events = rows
        .filter(r => r.job.scheduledAt)
        .map(r => {
          const start = new Date(r.job.scheduledAt!);
          const end = new Date(start.getTime() + 2 * 60 * 60 * 1000); // +2h default duration
          const summary = r.customer?.name
            ? `${r.customer.name} — ${r.job.description}`
            : r.job.description;
          const price = (r.job.agreedPrice / 100).toFixed(2) + " €";
          const desc = [
            "Hinta: " + price,
            r.customer?.phone ? "Puh: " + r.customer.phone : null,
            r.job.notes ? "Muistiinpano: " + r.job.notes : null,
          ].filter(Boolean).join("\\n");

          return [
            "BEGIN:VEVENT",
            `UID:puuhapatet-job-${r.job.id}@puuhapatet.fi`,
            `DTSTAMP:${now}`,
            `DTSTART:${toIcsDate(start)}`,
            `DTEND:${toIcsDate(end)}`,
            `SUMMARY:${escapeIcs(summary)}`,
            r.customer?.address ? `LOCATION:${escapeIcs(r.customer.address)}` : null,
            `DESCRIPTION:${desc}`,
            "END:VEVENT",
          ].filter(Boolean).join("\r\n");
        });

      const ics = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Puuhapatet//Keikat//FI",
        "X-WR-CALNAME:Puuhapatet Keikat",
        "X-WR-CALDESC:Puuhapatet keikat",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        ...events,
        "END:VCALENDAR",
      ].join("\r\n");

      res.setHeader("Content-Type", "text/calendar; charset=utf-8");
      res.setHeader("Content-Disposition", 'inline; filename="puuhapatet.ics"');
      res.setHeader("Cache-Control", "no-cache, no-store");
      res.send(ics);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Customers ───────────────────────────────────────────────────────────────

  app.get("/api/customers", async (_req, res) => {
    try {
      const rows = await db.select().from(customers).orderBy(desc(customers.createdAt));
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/customers/:id", async (req, res) => {
    try {
      const [customer] = await db.select().from(customers).where(eq(customers.id, Number(req.params.id)));
      if (!customer) return res.status(404).json({ error: "Ei löydy" });
      const customerJobs = await db.select().from(jobs).where(eq(jobs.customerId, customer.id)).orderBy(desc(jobs.createdAt));
      res.json({ ...customer, jobs: customerJobs });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/customers", async (req, res) => {
    try {
      const data = insertCustomerSchema.parse(req.body);
      const [row] = await db.insert(customers).values(data).returning();
      res.status(201).json(row);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.patch("/api/customers/:id", async (req, res) => {
    try {
      const [row] = await db.update(customers).set(req.body).where(eq(customers.id, Number(req.params.id))).returning();
      if (!row) return res.status(404).json({ error: "Ei löydy" });
      res.json(row);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ─── Jobs ─────────────────────────────────────────────────────────────────────

  app.get("/api/jobs", async (_req, res) => {
    try {
      const rows = await db
        .select({ job: jobs, customer: customers })
        .from(jobs)
        .leftJoin(customers, eq(jobs.customerId, customers.id))
        .orderBy(desc(jobs.createdAt));
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/jobs/:id", async (req, res) => {
    try {
      const [row] = await db
        .select({ job: jobs, customer: customers })
        .from(jobs)
        .leftJoin(customers, eq(jobs.customerId, customers.id))
        .where(eq(jobs.id, Number(req.params.id)));
      if (!row) return res.status(404).json({ error: "Ei löydy" });
      const jobExpenses = await db.select().from(expenses).where(eq(expenses.jobId, row.job.id));
      res.json({ ...row, expenses: jobExpenses });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/jobs", async (req, res) => {
    try {
      const body = { ...req.body };
      if (typeof body.scheduledAt === "string") body.scheduledAt = new Date(body.scheduledAt);
      const data = insertJobSchema.parse(body);
      const [row] = await db.insert(jobs).values(data).returning();
      res.status(201).json(row);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.patch("/api/jobs/:id", async (req, res) => {
    try {
      const body = { ...req.body };
      // Drizzle timestamp columns expect Date objects, not ISO strings
      if (typeof body.scheduledAt === "string") {
        body.scheduledAt = new Date(body.scheduledAt);
      }
      if (body.scheduledAt === null) {
        body.scheduledAt = null; // explicitly NULL — clears the field
      }
      // When a job is marked done, strip heavy/temp fields to keep the DB lean
      if (body.status === "done") {
        body.propertyImageUrl = null;  // base64 image, biggest offender
        body.quoteVideoUrl    = null;  // no longer needed
        body.pendingWorkers   = null;  // invite state irrelevant after completion
      }
      const [row] = await db
        .update(jobs)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(jobs.id, Number(req.params.id)))
        .returning();
      if (!row) return res.status(404).json({ error: "Ei löydy" });
      res.json(row);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete("/api/jobs/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      // Delete child expenses first (foreign key)
      await db.delete(expenses).where(eq(expenses.jobId, id));
      const [row] = await db.delete(jobs).where(eq(jobs.id, id)).returning();
      if (!row) return res.status(404).json({ error: "Ei löydy" });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/customers/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      // Cascade: delete expenses → jobs → customer
      const customerJobs = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.customerId, id));
      for (const j of customerJobs) {
        await db.delete(expenses).where(eq(expenses.jobId, j.id));
      }
      await db.delete(jobs).where(eq(jobs.customerId, id));
      const [row] = await db.delete(customers).where(eq(customers.id, id)).returning();
      if (!row) return res.status(404).json({ error: "Ei löydy" });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Expenses ─────────────────────────────────────────────────────────────────

  app.get("/api/jobs/:id/expenses", async (req, res) => {
    try {
      const rows = await db.select().from(expenses).where(eq(expenses.jobId, Number(req.params.id)));
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/jobs/:id/expenses", async (req, res) => {
    try {
      const data = insertExpenseSchema.parse({ ...req.body, jobId: Number(req.params.id) });
      const [row] = await db.insert(expenses).values(data).returning();
      res.status(201).json(row);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete("/api/expenses/:id", async (req, res) => {
    try {
      await db.delete(expenses).where(eq(expenses.id, Number(req.params.id)));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Dashboard stats ──────────────────────────────────────────────────────────

  app.get("/api/stats", async (_req, res) => {
    try {
      // Counts in a single query
      const [counts] = await db.select({
        totalJobs: sql<number>`count(*) filter (where ${jobs.status} != 'cancelled')`,
        upcoming:  sql<number>`count(*) filter (where ${jobs.status} = 'scheduled')`,
      }).from(jobs);

      // Financial figures: done jobs with their expenses summed in one LEFT JOIN query
      const doneJobsWithExp = await db.select({
        id:          jobs.id,
        agreedPrice: jobs.agreedPrice,
        unitCount:   jobs.unitCount,
        isTaloyhtiio: jobs.isTaloyhtiio,
        waiveFee:    jobs.waiveFee,
        assignedTo:  jobs.assignedTo,
        jobExpenses: sql<number>`coalesce(sum(${expenses.amount}), 0)`,
      }).from(jobs)
        .leftJoin(expenses, eq(expenses.jobId, jobs.id))
        // Completed jobs only — but a declined quote means the job never
        // happened, so exclude those even if a stale status lingers.
        .where(and(eq(jobs.status, "done"), sql`${jobs.quoteStatus} is distinct from 'declined'`))
        .groupBy(jobs.id, jobs.agreedPrice, jobs.unitCount, jobs.isTaloyhtiio, jobs.waiveFee, jobs.assignedTo);

      let totalRevenue = 0, totalExpenses = 0, serviceFeeTotal = 0;
      for (const job of doneJobsWithExp) {
        const jobExp = Number(job.jobExpenses);
        const price = effectiveJobTotal(job); // taloyhtiö: per-apartment × unitCount
        totalRevenue += price;
        totalExpenses += jobExp;
        // Role-aware service fee: each worker's share is charged at their own
        // rate (founders 10 %, staff 40 %).
        if (!job.waiveFee) {
          const net = Math.max(0, price - jobExp);
          const workerIds = normalizeWorkerIds(job.assignedTo);
          if (workerIds.length > 0) {
            const share = net / workerIds.length;
            for (const wid of workerIds) {
              serviceFeeTotal += Math.round(share * feeRateForWorker(wid));
            }
          }
        }
      }
      const netIncome = totalRevenue - totalExpenses - serviceFeeTotal;

      res.json({
        totalJobs:       Number(counts.totalJobs),
        totalRevenue,    // senttiä — valmistuneista keikoista
        totalExpenses,   // senttiä
        serviceFeeTotal, // senttiä — palvelumaksut (perustajat 10 %, työntekijät 40 %)
        netIncome,       // senttiä — verotettava nettotulo
        upcoming:        Number(counts.upcoming),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Worker stats (host view) ─────────────────────────────────────────────────

  // Normalize assignedTo field: handles old "Full Name" format and new "id" format
  function normalizeWorkerIds(assignedTo: string | null): string[] {
    if (!assignedTo) return [];
    const nameToId: Record<string, string> = {
      "Joonatan Juuri": "joonatan",
      "Matias Pitkänen": "matias",
    };
    return assignedTo
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => nameToId[s] ?? s);
  }

  // Returns accumulated service-fee debt per worker (fees earned − payments made)
  app.get("/api/workers/stats", async (_req, res) => {
    try {
      // Done jobs with per-job expense totals in one query
      const doneJobsWithExp = await db.select({
        id:          jobs.id,
        agreedPrice: jobs.agreedPrice,
        unitCount:   jobs.unitCount,
        isTaloyhtiio: jobs.isTaloyhtiio,
        waiveFee:    jobs.waiveFee,
        assignedTo:  jobs.assignedTo,
        jobExpenses: sql<number>`coalesce(sum(${expenses.amount}), 0)`,
      }).from(jobs)
        .leftJoin(expenses, eq(expenses.jobId, jobs.id))
        // Completed jobs only — declined quotes never produced revenue, so a
        // declined job must not generate a service-fee debt.
        .where(and(eq(jobs.status, "done"), sql`${jobs.quoteStatus} is distinct from 'declined'`))
        .groupBy(jobs.id, jobs.agreedPrice, jobs.unitCount, jobs.isTaloyhtiio, jobs.waiveFee, jobs.assignedTo);

      // Payment totals aggregated per worker in one query
      const paymentRows = await db.select({
        workerId:  workerPayments.workerId,
        totalPaid: sql<number>`sum(${workerPayments.amountPaid})`,
      }).from(workerPayments).groupBy(workerPayments.workerId);

      const totalPaidByWorker: Record<string, number> = {};
      for (const p of paymentRows) {
        totalPaidByWorker[p.workerId] = Number(p.totalPaid);
      }

      const workerFeesTotal: Record<string, number> = {};
      const workerJobCount: Record<string, number> = {};

      for (const job of doneJobsWithExp) {
        const jobExpenses = Number(job.jobExpenses);
        const price = effectiveJobTotal(job); // taloyhtiö: per-apartment × unitCount
        const netRevenue = Math.max(0, price - jobExpenses);
        const workerIds = normalizeWorkerIds(job.assignedTo);
        if (workerIds.length === 0) continue;
        const sharePerWorker = netRevenue / workerIds.length;
        for (const wid of workerIds) {
          // Each worker's fee uses their own role's rate (10 % / 40 %).
          const fee = job.waiveFee ? 0 : Math.round(sharePerWorker * feeRateForWorker(wid));
          workerFeesTotal[wid] = (workerFeesTotal[wid] ?? 0) + fee;
          workerJobCount[wid] = (workerJobCount[wid] ?? 0) + 1;
        }
      }

      // Net debt = fees earned - payments already made
      const workerFees: Record<string, number> = {};
      const allWorkerIds = Array.from(new Set([...Object.keys(workerFeesTotal), ...Object.keys(totalPaidByWorker)]));
      for (const wid of allWorkerIds) {
        workerFees[wid] = Math.max(0, (workerFeesTotal[wid] ?? 0) - (totalPaidByWorker[wid] ?? 0));
      }

      // Brand cash = total service fees paid by workers so far
      const brandCash = Object.values(totalPaidByWorker).reduce((s, v) => s + v, 0);

      // Brand earned = total service fees the brand has accrued from all
      // completed gigs (the "money gained from the gigs"), regardless of how
      // much has actually been settled yet. This is what the kassa shows.
      const brandEarned = Object.values(workerFeesTotal).reduce((s, v) => s + v, 0);

      res.json({ workerFees, workerJobCount, brandCash, brandEarned });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Per-founder (biller) customer-invoice turnover by calendar year, for the
  // admin "Verotus" view. Each founder invoices customers under their own
  // Y-tunnus, and the ALV vähäinen-toiminta exemption (AVL 3 §) depends on each
  // staying under the limit. We sum every gig instalment (GigPayment) tagged to
  // a biller, by the year it was invoiced. NOTE: this counts ONLY Puuhapatet
  // customer invoices — the legal threshold counts ALL of a person's business
  // activity, so this is a floor, surfaced with that caveat in the UI.
  // Who billed a small job — ONE rule for the ALV turnover, the founder
  // settlement and the per-person invoice register, so the three can never
  // drift apart:
  //   1. explicit billedBy (set on invoice send / in the Verotus view) wins;
  //   2. otherwise, if the job's workers contain EXACTLY ONE founder, that
  //      founder billed it (the pair alternates whose Y-tunnus collects, but a
  //      solo founder gig is always billed by its founder) — this repairs the
  //      history without any manual re-marking;
  //   3. otherwise unknown (both founders / staff only) → shown as unassigned.
  function inferBillerId(job: { billedBy?: string | null; assignedTo?: string | null }): string | null {
    if (job.billedBy) return job.billedBy;
    const tokens = (job.assignedTo || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (tokens.length === 0) return null;
    const matches = BRAND_BILLERS.filter((b) =>
      tokens.includes(b.id) ||
      tokens.includes(b.name.trim().toLowerCase()) ||
      tokens.includes(b.name.trim().split(/\s+/)[0].toLowerCase()));
    return matches.length === 1 ? matches[0].id : null;
  }

  app.get("/api/admin/biller-turnover", async (_req, res) => {
    try {
      const rows = await db.select().from(jobs);
      // year -> billerId -> cents
      const byYear: Record<string, Record<string, number>> = {};
      // Done small jobs with NO biller set yet — surfaced so the founders can
      // attribute them (otherwise the ALV tracker under-counts someone).
      const unassignedByYear: Record<string, { count: number; cents: number }> = {};
      // Gig instalments recorded before the biller field existed. NEVER default
      // these to anyone: a silent default puts another founder's turnover on
      // the wrong person's ALV counter and inverts the founder debt. They stay
      // out of everyone's figures and are listed here for one-tap attribution.
      const unassignedEras: { jobId: number; index: number; name: string; dateMs: number | null; cents: number }[] = [];
      for (const row of rows) {
        // Custom gigs (FR8 etc.): each recorded instalment payment carries its biller.
        if (row.gigData) {
          let gig: GigData | null = null;
          try { gig = sanitizeGigData(JSON.parse(row.gigData)); } catch { gig = null; }
          const gigName = gig?.company?.name || row.description || `Keikka #${row.id}`;
          (gig?.payments || []).forEach((p, i) => {
            if (!p?.amountCents || p.amountCents <= 0) return;
            const billerId = p.biller?.id;
            if (!billerId) {
              unassignedEras.push({
                jobId: row.id, index: i, name: `${gigName} — erä ${i + 1}`,
                dateMs: p.t || null, cents: p.amountCents,
              });
              return;
            }
            const year = String(new Date(p.t || 0).getFullYear());
            (byYear[year] ||= {});
            byYear[year][billerId] = (byYear[year][billerId] ?? 0) + p.amountCents;
          });
        }
        // Small jobs: the whole invoice goes to whoever billed (explicit or
        // inferred — see inferBillerId). A job whose money is already tracked
        // via gig payments must not count twice.
        if (!row.isCustomGig && !row.gigData && row.status === "done" && row.quoteStatus !== "declined") {
          const total = effectiveJobTotal(row);
          if (total <= 0) continue;
          const year = String(new Date(row.scheduledAt ?? row.createdAt).getFullYear());
          const eff = inferBillerId(row);
          if (eff && BRAND_BILLERS.some((b) => b.id === eff)) {
            (byYear[year] ||= {});
            byYear[year][eff] = (byYear[year][eff] ?? 0) + total;
          } else if (!row.billedBy) {
            // Genuinely unknown (both founders / staff-only crew) — surfaced
            // for manual attribution. An explicit staff biller (own Y-tunnus)
            // is a valid attribution that just isn't founder turnover.
            (unassignedByYear[year] ||= { count: 0, cents: 0 });
            unassignedByYear[year].count += 1;
            unassignedByYear[year].cents += total;
          }
        }
      }
      res.json({
        ok: true,
        limitEur: VAT_SMALL_BUSINESS_LIMIT_EUR,
        billers: BRAND_BILLERS.map((b) => ({ id: b.id, name: b.name, yTunnus: b.yTunnus })),
        turnoverByYear: byYear, // { "2026": { joonatan: cents, matias: cents } }
        unassignedByYear,
        unassignedEras,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Founder cross-invoicing across ALL gigs. The two founders split every gig
  // 50/50 but only ONE of them bills the customer (they alternate whose Y-tunnus
  // collects each erä). So the biller ends up holding the other founder's half —
  // this endpoint nets, across every billed erä of every FR8 gig AND every done
  // small job (billedBy), who owes whom, so they can settle up with a
  // founder-to-founder invoice (vastalasku).
  app.get("/api/admin/founder-settlement", async (_req, res) => {
    try {
      const rows = await db.select().from(jobs);
      const customerRows = await db.select().from(customers);
      const customerName = new Map(customerRows.map((c) => [c.id, c.name]));
      // Job expenses: the biller fronted materials and keeps the reimbursement,
      // so shares are computed on (total − kulut) — same maths as the
      // tilitystosite the workers receive.
      const expenseRows = await db.select().from(expenses);
      const expByJob = new Map<number, number>();
      for (const e of expenseRows) expByJob.set(e.jobId, (expByJob.get(e.jobId) ?? 0) + e.amount);
      // Already-issued vastalaskut: subtracted from the cumulative debt so the
      // same euros are never invoiced twice.
      const settledRows = await db.select().from(founderSettlements).orderBy(desc(founderSettlements.createdAt));
      const founderList = BRAND_BILLERS.map((b) => ({ id: b.id, name: b.name, yTunnus: b.yTunnus }));
      const n = Math.max(1, founderList.length);
      const founders = founderList.map((f) => ({
        id: f.id, name: f.name, yTunnus: f.yTunnus,
        billedCents: 0,      // total collected from customers as biller
        kateShareCents: 0,   // their equal share of the total kate
        palkatPaidCents: 0,  // workers' palkat the biller fronted
      }));
      const idxOf = (id?: string) => founders.findIndex((f) => f.id === id);
      // owes[fromId][toId] = cents the biller (from) holds that belongs to (to).
      const owes: Record<string, Record<string, number>> = {};
      const bump = (from: string, to: string, cents: number) => {
        if (!from || !to || from === to || cents <= 0) return;
        (owes[from] ||= {})[to] = (owes[from][to] ?? 0) + cents;
      };
      const perGig: {
        jobId: number; gigName: string;
        eras: { era: number; dateMs: number | null; billerId: string; billerName: string; instalmentCents: number; palkatCents: number; kateCents: number; shares: { id: string; cents: number }[]; paysOut: { id: string; name: string; cents: number }[] }[];
      }[] = [];
      // Recorded gig instalments with no biller — excluded from the maths above
      // until attributed (the ALV card lists them with a one-tap assign).
      let unassignedEraCount = 0;

      for (const job of rows) {
        const project = parseProject(job.projectData ?? null);
        if (!project) continue;
        const deal = fixedDealFor(project);
        if (!deal) continue;
        const eraBreakdown = computeEraDebts(project, deal, project.crew || [], project.eraWindows ?? null);
        const gig = parseGig(job.gigData);
        const payments = gig?.payments ?? [];
        eraBreakdown.forEach((e, i) => {
          const p = payments[i];
          // A recorded payment = cash moved. A payment WITHOUT a biller is
          // never defaulted to anyone (a wrong default inverts who owes whom):
          // it stays out of the debt maths and is counted below so the UI can
          // demand attribution — same rule as the ALV turnover.
          const b = p?.biller;
          (e as any).biller = b?.id ? { id: b.id, name: b.name } : null;
          if (p && !b?.id) unassignedEraCount += 1;
        });
        const gigName = gig?.company?.name || job.description || `Keikka #${job.id}`;
        const eras: (typeof perGig)[number]["eras"] = [];
        for (const e of eraBreakdown) {
          const biller = (e as any).biller as { id: string; name: string } | null;
          if (!biller?.id) continue; // only billed erät with a KNOWN biller
          const kate = e.marginCents;
          const base = Math.floor(kate / n);
          const shares = founders.map((f, i) => ({ id: f.id, name: f.name, cents: i === 0 ? kate - base * (n - 1) : base }));
          shares.forEach((s) => { const j = idxOf(s.id); if (j >= 0) founders[j].kateShareCents += s.cents; });
          const bj = idxOf(biller.id);
          if (bj >= 0) { founders[bj].billedCents += e.instalmentCents; founders[bj].palkatPaidCents += e.earnedCents; }
          const paysOut = shares.filter((s) => s.id !== biller.id);
          paysOut.forEach((s) => bump(biller.id, s.id, s.cents));
          eras.push({
            era: e.era,
            // Billing date from the recorded payment — lets the client put the
            // kate income in the right YEAR for the founder's OmaVero figure.
            dateMs: payments[e.era - 1]?.t || null,
            billerId: biller.id,
            billerName: biller.name || (bj >= 0 ? founders[bj].name : ""),
            instalmentCents: e.instalmentCents,
            palkatCents: e.earnedCents,
            kateCents: kate,
            // EVERY founder's kate share of this erä (incl. the biller's own).
            shares: shares.map((s) => ({ id: s.id, cents: s.cents })),
            paysOut: paysOut.map((s) => ({ id: s.id, name: s.name, cents: s.cents })),
          });
        }
        if (eras.length > 0) perGig.push({ jobId: job.id, gigName, eras });
      }

      // Small jobs: the founders have split these 50/50 and alternated whose
      // Y-tunnus takes the customer's payment. The biller (billedBy) collected
      // the FULL sum → owes every OTHER founder among the assigned workers their
      // equal share. (Non-founder workers are settled via the tilitystosite flow.)
      const founderByName = new Map(founderList.map((f) => [f.name.trim().toLowerCase(), f.id]));
      const resolveWorkerId = (s: string) => {
        const t = s.trim().toLowerCase();
        return founderByName.get(t) ?? t; // founder name → id; else raw id string
      };
      const smallJobs: {
        jobId: number; name: string; dateMs: number; totalCents: number; expensesCents: number;
        billerId: string; billerName: string; numWorkers: number;
        owes: { id: string; name: string; cents: number }[];
      }[] = [];
      for (const job of rows) {
        if (job.isCustomGig || job.gigData || job.status !== "done" || job.quoteStatus === "declined") continue;
        const billerId = inferBillerId(job);
        if (!billerId || idxOf(billerId) < 0) continue;
        const total = effectiveJobTotal(job);
        if (total <= 0) continue;
        const expensesCents = expByJob.get(job.id) ?? 0;
        const baseCents = Math.max(0, total - expensesCents);
        const workerIds = (job.assignedTo || "").split(",").map(resolveWorkerId).filter(Boolean);
        const numWorkers = Math.max(workerIds.length, 1);
        const share = Math.round(baseCents / numWorkers);
        const owesList = founderList
          .filter((f) => f.id !== billerId && workerIds.includes(f.id))
          .map((f) => ({ id: f.id, name: f.name, cents: share }))
          .filter((o) => o.cents > 0);
        if (owesList.length === 0) continue;
        owesList.forEach((o) => bump(billerId, o.id, o.cents));
        const bj = idxOf(billerId);
        smallJobs.push({
          jobId: job.id,
          name: customerName.get(job.customerId) || job.description || `Keikka #${job.id}`,
          dateMs: new Date(job.scheduledAt ?? job.createdAt).getTime(),
          totalCents: total,
          expensesCents,
          billerId,
          billerName: founderList[bj]?.name ?? billerId,
          numWorkers,
          owes: owesList,
        });
      }
      smallJobs.sort((a, b) => b.dateMs - a.dateMs);

      // Apply already-recorded settlements as opposing debts — the pairwise
      // netting below then reports only what is STILL open.
      for (const s of settledRows) bump(s.toId, s.fromId, s.cents);

      // Net pairwise: for each unordered founder pair, cancel opposing debts so
      // we end up with a single "X should pay Y €Z" line per pair.
      const crossInvoices: { fromId: string; fromName: string; toId: string; toName: string; cents: number }[] = [];
      for (let i = 0; i < founders.length; i++) {
        for (let j = i + 1; j < founders.length; j++) {
          const a = founders[i], b = founders[j];
          const ab = owes[a.id]?.[b.id] ?? 0; // a holds b's money
          const ba = owes[b.id]?.[a.id] ?? 0; // b holds a's money
          const net = ab - ba;
          if (net > 0) crossInvoices.push({ fromId: a.id, fromName: a.name, toId: b.id, toName: b.name, cents: net });
          else if (net < 0) crossInvoices.push({ fromId: b.id, fromName: b.name, toId: a.id, toName: a.name, cents: -net });
        }
      }

      res.json({
        ok: true, founders, crossInvoices, perGig, smallJobs, unassignedEraCount,
        settled: settledRows.map((s) => ({
          id: s.id, fromId: s.fromId, toId: s.toId, cents: s.cents,
          invoiceNo: s.invoiceNo ?? undefined,
          createdAtMs: new Date(s.createdAt).getTime(),
        })),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Record an ISSUED founder-to-founder settlement invoice — reduces the open
  // cross-debt so the next vastalasku starts from zero, not from all history.
  app.post("/api/admin/founder-settlement/record", async (req, res) => {
    try {
      const { fromId, toId, cents, invoiceNo } = (req.body || {}) as Record<string, any>;
      const validParty = (id: any) => BRAND_BILLERS.some((b) => b.id === id);
      const c = Math.round(Number(cents));
      if (!validParty(fromId) || !validParty(toId) || fromId === toId || !Number.isFinite(c) || c <= 0) {
        return res.status(400).json({ error: "Virheellinen tilitys" });
      }
      const [row] = await db.insert(founderSettlements)
        .values({ fromId, toId, cents: c, invoiceNo: invoiceNo ? String(invoiceNo).slice(0, 60) : null })
        .returning();

      // File a tosite in BOTH founders' Dokumentit automatically — the payer
      // gets an expense receipt, the receiver an income receipt (kirjanpito,
      // 6-year retention rides on the document record). Best-effort: the
      // ledger row above is the source of truth even if filing fails.
      try {
        const nameOf = (id: string) => BRAND_BILLERS.find((b) => b.id === id)?.name.split(/\s+/)[0] ?? id;
        const note = row.invoiceNo ? ` (${row.invoiceNo})` : "";
        const now = Date.now();
        const mkDoc = (desc: string): CrewDocument => ({
          id: `doc_${randomUUID().slice(0, 12)}`,
          date: now, desc, amountCents: c, kind: "kuitti",
          retentionUntil: retentionFromDate(now), addedAt: now,
        });
        await attachPersonDocument(toId, mkDoc(`Tilitys saatu: ${nameOf(fromId)} maksoi${note}`));
        await attachPersonDocument(fromId, mkDoc(`Tilitys maksettu: ${nameOf(toId)}lle${note}`));
      } catch (err) {
        console.warn("settlement tosite filing failed", err);
      }

      res.status(201).json({ ok: true, settlement: row });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Issue a vastalasku WITHOUT booking a payment. Issuing an invoice and
  // getting paid are separate events: the creditor files a myyntilasku, the
  // debtor an ostolasku, and the open cross-debt stays open until the actual
  // payment is recorded (MobilePay → "Kirjaa maksu" with the invoice number).
  app.post("/api/admin/founder-settlement/issue-invoice", async (req, res) => {
    try {
      const { fromId, toId, cents, invoiceNo } = (req.body || {}) as Record<string, any>;
      const validParty = (id: any) => BRAND_BILLERS.some((b) => b.id === id);
      const c = Math.round(Number(cents));
      const no = String(invoiceNo ?? "").trim().slice(0, 60);
      if (!validParty(fromId) || !validParty(toId) || fromId === toId || !Number.isFinite(c) || c <= 0 || !no) {
        return res.status(400).json({ error: "Virheellinen lasku" });
      }
      const nameOf = (id: string) => BRAND_BILLERS.find((b) => b.id === id)?.name.split(/\s+/)[0] ?? id;
      const now = Date.now();
      const mkDoc = (desc: string): CrewDocument => ({
        id: `doc_${randomUUID().slice(0, 12)}`,
        date: now, desc: desc.slice(0, 300), amountCents: c, kind: "lasku",
        retentionUntil: retentionFromDate(now), addedAt: now,
      });
      await attachPersonDocument(toId, mkDoc(
        `Myyntilasku ${no} (vastalasku): ${nameOf(fromId)} maksaa osuudet yhteisistä keikoista`), true);
      await attachPersonDocument(fromId, mkDoc(
        `Ostolasku ${no} (vastalasku): maksettava ${nameOf(toId)}lle — osuudet yhteisistä keikoista`), true);
      res.status(201).json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Undo a recorded settlement (e.g. the invoice was scrapped before payment).
  app.delete("/api/admin/founder-settlement/:id", async (req, res) => {
    try {
      const [row] = await db.delete(founderSettlements)
        .where(eq(founderSettlements.id, Number(req.params.id))).returning();
      if (!row) return res.status(404).json({ error: "Ei löydy" });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Mark a worker's current debt as paid (inserts a payment record)
  app.post("/api/workers/:id/mark-paid", async (req, res) => {
    try {
      const workerId = req.params.id;
      const { amount } = req.body; // senttiä
      if (!amount || amount <= 0) return res.status(400).json({ error: "Virheellinen summa" });
      const [row] = await db.insert(workerPayments)
        .values({ workerId, amountPaid: Math.round(amount) })
        .returning();
      res.status(201).json(row);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Reset the whole payment history. Clears every recorded service-fee
  // payment so the kassa "maksettu" goes back to 0 and each worker's
  // palveluvelka shows the full amount earned from gigs again.
  app.delete("/api/workers/payments", async (_req, res) => {
    try {
      await db.delete(workerPayments);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Investments ──────────────────────────────────────────────────────────────

  app.get("/api/investments", async (_req, res) => {
    try {
      const rows = await db.select().from(investments).orderBy(desc(investments.purchasedAt));
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/investments", async (req, res) => {
    try {
      const body = { ...req.body };
      if (typeof body.purchasedAt === "string") {
        body.purchasedAt = new Date(body.purchasedAt);
      }
      const data = insertInvestmentSchema.parse(body);
      const [row] = await db.insert(investments).values(data).returning();

      // Auto-create startup bonus usage entries when bonusBy is set
      if (row.bonusBy) {
        const half = Math.round(row.amount / 2);
        const isSplit = !!row.splitWith;
        const usages: Array<{ userId: string; amount: number }> = [];
        if (row.bonusBy === "both" && isSplit) {
          usages.push({ userId: row.boughtBy,  amount: half });
          usages.push({ userId: row.splitWith!, amount: half });
        } else if (row.bonusBy === "boughtBy") {
          usages.push({ userId: row.boughtBy, amount: isSplit ? half : row.amount });
        } else if (row.bonusBy === "splitWith" && isSplit) {
          usages.push({ userId: row.splitWith!, amount: half });
        }
        for (const u of usages) {
          await db.insert(startupBonusUsages).values({
            userId:       u.userId,
            amount:       u.amount,
            description:  row.description,
            category:     row.category,
            usedAt:       row.purchasedAt,
            investmentId: row.id,
          });
        }
      }

      res.status(201).json(row);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.patch("/api/investments/:id", async (req, res) => {
    try {
      const body = { ...req.body };
      if (typeof body.purchasedAt === "string") {
        body.purchasedAt = new Date(body.purchasedAt);
      }
      const [row] = await db.update(investments).set(body).where(eq(investments.id, Number(req.params.id))).returning();
      if (!row) return res.status(404).json({ error: "Ei löydy" });
      res.json(row);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete("/api/investments/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      // Remove linked bonus usage entries first
      await db.delete(startupBonusUsages).where(eq(startupBonusUsages.investmentId, id));
      await db.delete(investments).where(eq(investments.id, id));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Startup bonus usages ─────────────────────────────────────────────────────

  app.get("/api/startup-bonus-usages", async (req, res) => {
    try {
      const userId = req.query.userId as string | undefined;
      const rows = userId
        ? await db.select().from(startupBonusUsages).where(eq(startupBonusUsages.userId, userId)).orderBy(desc(startupBonusUsages.usedAt))
        : await db.select().from(startupBonusUsages).orderBy(desc(startupBonusUsages.usedAt));
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/startup-bonus-usages", async (req, res) => {
    try {
      const body = { ...req.body };
      if (typeof body.usedAt === "string") body.usedAt = new Date(body.usedAt);
      const data = insertStartupBonusUsageSchema.parse(body);
      const [row] = await db.insert(startupBonusUsages).values(data).returning();
      res.status(201).json(row);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete("/api/startup-bonus-usages/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      // Don't allow deleting entries that are linked to an investment (delete the investment instead)
      const [existing] = await db.select().from(startupBonusUsages).where(eq(startupBonusUsages.id, id));
      if (existing?.investmentId) {
        return res.status(400).json({ error: "Poista investointi — käyttömerkintä poistuu automaattisesti" });
      }
      await db.delete(startupBonusUsages).where(eq(startupBonusUsages.id, id));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Email receipt ────────────────────────────────────────────────────────────

  app.post("/api/send-receipt", async (req, res) => {
    if (!resend) {
      return res.status(503).json({ error: "Sähköpostipalvelu ei käytössä — aseta RESEND_API_KEY ympäristömuuttuja." });
    }
    try {
      const { to, bcc, customerName, customerAddress, date, description, price, paymentMethod, workerName, workerPhone, workerYTunnus, isReturning, lang } = req.body;
      if (!to || !customerName || !description || !price) {
        return res.status(400).json({ error: "Puuttuvia kenttiä" });
      }

      const isEn = lang === "en";
      const firstName = customerName.split(" ")[0];
      const workerFirst = workerName ? workerName.split(" ")[0] : "Puuhapatet";

      // Generate a personalized referral code
      const nameTag = firstName.replace(/[^a-z]/gi, "").slice(0, 5).toUpperCase().padEnd(4, "X");
      const randTag = Math.random().toString(36).slice(2, 5).toUpperCase();
      const referralCode = `${nameTag}-${randTag}`;
      const referralLink = `https://puuhapatet.fi/tilaus?ref=${referralCode}`;

      // Detect service type from description
      const descLower = description.toLowerCase();
      const isWindowJob = /ikkuna|lasi|ikkunanpesu|window/.test(descLower);
      const isLawnJob = /nurmik|leikkuu|ruohon/.test(descLower);

      const greeting = isEn
        ? (isReturning
            ? `Hi ${firstName}! Great to see you again — all done, thanks for your continued trust.`
            : `Hi ${firstName}! All done — thank you for choosing Puuhapatet.`)
        : (isReturning
            ? `Moi ${firstName}! Mukava nähdä sinut taas — homma on nyt hoidettu, kiitos jatkuvasta luottamuksesta.`
            : `Moi ${firstName}! Homma on hoidettu — kiitos kun valitsit Puuhapatet.`);

      const paymentLine = paymentMethod
        ? `<tr><td style="padding:6px 0;color:#666">${isEn ? "Payment method" : "Maksutapa"}</td><td style="padding:6px 0;font-weight:600;text-align:right">${paymentMethod}</td></tr>`
        : "";

      // ── Tips block — short, human, placed near the end of the email ──────────
      const tipText = isWindowJob
        ? (isEn
            ? "One small tip: windows clean best on a cloudy day — sunlight dries the soap too fast and leaves streaks. Once a year is usually enough, but feel free to reach out whenever you want a freshen-up."
            : "Pieni vinkki: ikkunat pestään parhaiten pilvisellä säällä — auringossa pesuaine kuivuu liian nopeasti. Kerran vuodessa riittää useimmille, mutta ota yhteyttä aina kun tuntuu siltä, hoidamme mielellämme.")
        : isLawnJob
        ? (isEn
            ? "A quick tip: mowing every 1–2 weeks during the growing season keeps the lawn in great shape. Consistent height is the secret — and we're always happy to take it off your hands."
            : "Nopea vinkki: 1–2 viikon leikkuuväli kasvukaudella pitää nurmikon hyvässä kunnossa. Tasainen korkeus on salaisuus — ja hoidamme mielellämme aina tarvittaessa.")
        : (isEn
            ? "If you notice anything else around the house that needs attention, just reach out — we'll get back to you quickly with a quote. No job too small."
            : "Jos huomaat jotain muuta, mitä kannattaisi huoltaa, ota vain yhteyttä — vastaamme nopeasti ja tehdään tarjous samantien. Mikään keikka ei ole liian pieni.");
      const tipsBlock = `<p style="color:#94a3b8;font-size:12px;line-height:1.7;text-align:center;margin:0 0 16px;padding:0 8px">${tipText}</p>`;

      const html = `
<!DOCTYPE html>
<html lang="${isEn ? "en" : "fi"}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f4f5">
  <div style="max-width:560px;margin:24px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.12)">

    <!-- Header -->
    <div style="background:#18181b;padding:28px 32px;text-align:center">
      <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;letter-spacing:-0.3px">Puuhapatet.</h1>
      <p style="margin:6px 0 0;color:#a1a1aa;font-size:13px">${isEn ? "Receipt" : "Kuitti"} · ${date}</p>
    </div>

    <!-- Body -->
    <div style="padding:28px 32px">
      <p style="color:#18181b;font-size:15px;line-height:1.6;margin:0 0 20px">${greeting}</p>

      <!-- Receipt table -->
      <div style="background:#fafafa;border-radius:12px;padding:20px;margin-bottom:24px">
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr><td style="padding:6px 0;color:#666">${isEn ? "Customer" : "Asiakas"}</td><td style="padding:6px 0;font-weight:600;text-align:right">${customerName}</td></tr>
          <tr><td style="padding:6px 0;color:#666">${isEn ? "Address" : "Osoite"}</td><td style="padding:6px 0;font-weight:600;text-align:right">${customerAddress || "—"}</td></tr>
          <tr style="border-top:1px solid #e4e4e7"><td style="padding:6px 0;color:#666">${isEn ? "Service" : "Palvelu"}</td><td style="padding:6px 0;font-weight:600;text-align:right">${description}</td></tr>
          ${paymentLine}
          <tr style="border-top:2px solid #18181b"><td style="padding:10px 0;color:#18181b;font-weight:700;font-size:16px">${isEn ? "Price" : "Hinta"}</td><td style="padding:10px 0;font-weight:700;font-size:20px;text-align:right;color:#18181b">${price}</td></tr>
        </table>
      </div>

      <!-- Household deduction -->
      <div style="background:#ecfdf5;border-radius:12px;padding:16px;margin-bottom:24px">
        <p style="margin:0 0 6px;font-weight:700;color:#065f46;font-size:13px">${isEn ? "HOUSEHOLD TAX DEDUCTION (KOTITALOUSVÄHENNYS)" : "MUISTA KOTITALOUSVÄHENNYS"}</p>
        <p style="margin:0;color:#047857;font-size:13px;line-height:1.6">
          ${isEn
            ? `This service is typically eligible for the Finnish <strong>household tax deduction</strong>. You may reclaim approximately 35% of the labour cost in your taxes — up to €2,250 per person per year. This invoice serves as documentation, no separate receipt needed. Confirm eligibility at vero.fi or with a tax adviser.<br><br>More info: <a href="https://vero.fi/en/individuals/tax-cards-and-tax-returns/deductions/household-deduction/" style="color:#047857;font-weight:600">vero.fi (household deduction)</a>`
            : `Tämä palvelu on tyypillisesti <strong>kotitalousvähennyskelpoinen</strong>. Voit hakea verotuksessa noin 35 % työn osuudesta takaisin — enintään 2 250 € / henkilö / vuosi. Lasku toimii dokumenttina, ei erillistä kuittia tarvita. Tarkista soveltuvuus osoitteessa vero.fi tai veroneuvojalta.<br><br>Lisätietoa: <a href="https://vero.fi/kotitalousvahennys" style="color:#047857;font-weight:600">vero.fi/kotitalousvähennys</a>`
          }
        </p>
      </div>

      <!-- Google review ask -->
      <div style="background:#fffbeb;border-radius:12px;padding:16px;margin-bottom:24px;border-left:3px solid #f59e0b">
        <p style="margin:0 0 6px;font-weight:700;color:#92400e;font-size:13px">${isEn ? "A SMALL REQUEST" : "PIENI PYYNTÖ"}</p>
        <p style="margin:0;color:#78350f;font-size:13px;line-height:1.6">
          ${isEn
            ? "Every review means more to us than you might imagine — whether positive or constructive, each one helps us grow. We're a small business and honest feedback is invaluable."
            : "Jokainen arvostelu merkitsee meille enemmän kuin osaat kuvitella — olipa se sitten positiivinen tai parannettavaa antava, jokainen auttaa meitä kehittymään. Olemme pieni yritys ja rehellinen palaute on kullanarvoista."
          }
        </p>
        <a href="https://g.page/r/CQo_lx1fQ57lEAE/review" style="display:inline-block;margin-top:10px;background:#f59e0b;color:#fff;padding:8px 18px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px">${isEn ? "Leave a review →" : "Jätä arvostelu →"}</a>
      </div>

      <!-- Referral -->
      <div style="background:#f0f9ff;border-radius:12px;padding:16px;margin-bottom:24px;border-left:3px solid #0ea5e9">
        <p style="margin:0 0 6px;font-weight:700;color:#075985;font-size:13px">${isEn ? "SHARE WITH FRIENDS — 5% OFF" : "JAA KAVEREILLE — 5 % ALENNUS"}</p>
        <p style="margin:0 0 10px;color:#0369a1;font-size:13px;line-height:1.6">
          ${isEn
            ? `If you recommend us to a friend or neighbour, they'll get <strong>5% off</strong> their first order. Valid for 30 days. Your personal code:`
            : `Jos suosittelet meitä kaverille tai naapurille, he saavat <strong>5 % alennuksen</strong> ensimmäisestä tilauksestaan. Voimassa 30 päivää. Henkilökohtainen koodisi:`
          }
        </p>
        <div style="background:#fff;border:1px solid #bae6fd;border-radius:8px;padding:10px 14px;text-align:center;margin-bottom:10px">
          <span style="font-family:monospace;font-size:18px;font-weight:700;color:#0c4a6e;letter-spacing:2px">${referralCode}</span>
        </div>
        <a href="${referralLink}" style="display:inline-block;background:#0ea5e9;color:#fff;padding:8px 18px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px">${isEn ? "Share link →" : "Jaa linkki →"}</a>
      </div>

      <!-- Next booking CTA -->
      <div style="text-align:center;margin-bottom:20px">
        <p style="color:#52525b;font-size:14px;margin:0 0 6px;line-height:1.6">
          ${isEn ? "Need help with other home tasks?" : "Tarvitsetko apua muissa kotihommissa?"}<br>
          <span style="font-size:13px;color:#71717a">${isEn ? "Lawn mowing · cleaning · yard care · painting" : "Nurmikon leikkuu · siivouspalvelut · pihahoito · maalaus"}</span>
        </p>
        <a href="https://puuhapatet.fi/tilaus" style="display:inline-block;margin-top:10px;background:#18181b;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px">${isEn ? "Book your next service →" : "Varaa seuraava aika →"}</a>
      </div>

      <!-- Service tip — short, end of email -->
      ${tipsBlock}

      <p style="color:#a1a1aa;font-size:12px;text-align:center;margin:0 0 0">
        ${isEn ? "Window cleaning · lawn mowing · cleaning · yard care · painting" : "Ikkunapesu · nurmikko · siivous · pihahoito · maalaus · roskakatos- ja terassihuollot"}
      </p>
    </div>

    <!-- Footer -->
    <div style="background:#fafafa;padding:20px 32px;border-top:1px solid #e4e4e7">
      <p style="margin:0 0 12px;color:#52525b;font-size:13px;line-height:1.5">
        — ${workerFirst}
      </p>
      <table style="width:100%;font-size:12px;color:#71717a">
        <tr>
          <td style="vertical-align:top">
            <strong style="color:#18181b">${workerName || "Puuhapatet"}</strong><br>
            ${workerPhone ? workerPhone + "<br>" : ""}
            ${workerYTunnus ? "Y-tunnus: " + workerYTunnus + "<br>" : ""}
          </td>
          <td style="text-align:right;vertical-align:top">
            <strong style="color:#18181b">Puuhapatet</strong><br>
            <a href="mailto:info@puuhapatet.fi" style="color:#71717a;text-decoration:none">info@puuhapatet.fi</a><br>
            <a href="https://puuhapatet.fi" style="color:#71717a;text-decoration:none">puuhapatet.fi</a>
          </td>
        </tr>
      </table>
    </div>
  </div>
</body>
</html>`;

      const result = await resend.emails.send({
        from: FROM_EMAIL,
        to,
        ...(bcc ? { bcc } : {}),
        subject: isEn ? `Receipt — Puuhapatet, ${date}` : `Kuitti tehty — Puuhapatet, ${date}`,
        html,
      });

      res.json({ ok: true, id: result.data?.id });
    } catch (e: any) {
      console.error("Email send error:", e);
      res.status(500).json({ error: e.message || "Sähköpostin lähetys epäonnistui" });
    }
  });

  // ─── Job summary / invoice email ─────────────────────────────────────────────

  app.post("/api/send-job-summary", async (req, res) => {
    if (!resend) {
      return res.status(503).json({ error: "Sähköpostipalvelu ei käytössä — aseta RESEND_API_KEY ympäristömuuttuja." });
    }
    try {
      const {
        to, bcc,
        customerName, customerAddress,
        timelineEvents,
        description, price, paymentMethod,
        iban, bic, viitenumero, dueDate,
        workerMessage, jobNotes,
        photoDataUrl,
        allWorkers,
        senderName, senderAddress, senderYTunnus, senderId, jobId,
        agreedPriceCents, expensesTotalCents,
        estimatedHours,
        lang,
        unitBreakdown,
        settlement,
      } = req.body;

      // dueDate arrives as ISO (YYYY-MM-DD); format for display
      const dueDateDisplay = dueDate
        ? new Date(dueDate + "T12:00:00").toLocaleDateString(lang === "en" ? "en-GB" : "fi-FI")
        : undefined;

      if (!to || !customerName || !description || !price || !paymentMethod) {
        return res.status(400).json({ error: "Puuttuvia kenttiä" });
      }

      const isEn = lang === "en";
      const isInvoice = paymentMethod === "tilisiirto";
      const firstName = customerName.split(" ")[0];

      // All workers for footer / contact
      const workers: { name: string; phone?: string; email?: string; yTunnus?: string }[] =
        Array.isArray(allWorkers) && allWorkers.length > 0
          ? allWorkers
          : [];
      const workerNames = workers.map(w => w.name.split(" ")[0]).join(" ja ");

      // Completion date = last timeline event's date
      const events: { label: string; date: string }[] = Array.isArray(timelineEvents) && timelineEvents.length > 0
        ? timelineEvents
        : [{ label: isEn ? "Done" : "Valmis", date: new Date().toLocaleDateString("fi-FI") }];
      const completionDate = events[events.length - 1]?.date ?? new Date().toLocaleDateString("fi-FI");

      // ── Referral code ────────────────────────────────────────────────────────
      const nameTag = firstName.replace(/[^a-z]/gi, "").slice(0, 5).toUpperCase().padEnd(4, "X");
      const randTag = Math.random().toString(36).slice(2, 5).toUpperCase();
      const referralCode = `${nameTag}-${randTag}`;
      const referralLink = `https://puuhapatet.fi/tilaus?ref=${referralCode}`;

      // ── Timeline ─────────────────────────────────────────────────────────────
      const dot = (label: string, sub: string, active: boolean) =>
        `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1;min-width:0;padding:0 2px">
          <div style="width:14px;height:14px;border-radius:50%;background:${active ? "#16a34a" : "#d4d4d8"};border:2px solid ${active ? "#16a34a" : "#d4d4d8"};flex-shrink:0"></div>
          <span style="font-size:11px;font-weight:${active ? "700" : "600"};color:${active ? "#16a34a" : "#71717a"};text-align:center">${label}</span>
          <span style="font-size:10px;color:#a1a1aa;text-align:center">${sub}</span>
        </div>`;

      const timelineDots = events.map((e, i) => dot(e.label, e.date, i === events.length - 1));
      const timelineHtml = `
        <div style="background:#fafafa;border-radius:12px;padding:20px 24px;margin-bottom:24px">
          <div style="display:flex;align-items:flex-start">
            ${timelineDots.map((d, i) =>
              i < timelineDots.length - 1
                ? d + `<div style="height:2px;background:#e4e4e7;flex:2;margin-top:8px;align-self:flex-start"></div>`
                : d
            ).join("")}
          </div>
        </div>`;

      // ── Helper: format cents to euros ───────────────────────────────────────
      const fmtC = (c: number) =>
        (c / 100).toLocaleString(isEn ? "en-GB" : "fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

      // ── Finnish payment barcode (tilisiirto) ─────────────────────────────────
      let fiBarcodeHtml = "";
      if (isInvoice && iban && agreedPriceCents) {
        fiBarcodeHtml = await generateFinnishBarcodeHtml({
          iban, amountCents: agreedPriceCents, viitenumero: viitenumero || "1",
          dueDateISO: dueDate, isEn,
        });
      }

      // ── Professional invoice box (tilisiirto) ────────────────────────────────
      const laborCents = agreedPriceCents && expensesTotalCents
        ? (agreedPriceCents - expensesTotalCents) : (agreedPriceCents || 0);
      const hasExpenses = !!(agreedPriceCents && expensesTotalCents && expensesTotalCents > 0);
      const numericRef = (viitenumero || "").replace(/\D/g, "") || "1";
      const refDisplay = formatFinnishRef(finnishRefWithCheckDigit(numericRef));
      const todayDisplay = new Date().toLocaleDateString(isEn ? "en-GB" : "fi-FI");

      const invoiceBox = isInvoice ? `
        <div style="border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;margin-bottom:24px;font-size:13px">

          <!-- Header bar -->
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#1e293b">
            <tr>
              <td style="padding:16px 24px;vertical-align:middle">
                <div style="color:#fff;font-size:20px;font-weight:800;letter-spacing:1px">${isEn ? "INVOICE" : "LASKU"}</div>
                <div style="color:#94a3b8;font-size:11px;margin-top:2px">#${refDisplay}</div>
              </td>
              <td style="padding:16px 24px;text-align:right;vertical-align:middle">
                <div style="color:#94a3b8;font-size:11px">${isEn ? "Date" : "Päivämäärä"}: ${todayDisplay}</div>
                <div style="color:#94a3b8;font-size:11px;margin-top:2px">${isEn ? "Delivery date" : "Toimituspäivä"}: ${completionDate}</div>
                ${dueDateDisplay ? `<div style="color:#fbbf24;font-size:12px;font-weight:700;margin-top:4px">${isEn ? "Due" : "Eräpäivä"}: ${dueDateDisplay}</div>` : ""}
              </td>
            </tr>
          </table>

          <!-- Parties -->
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-bottom:1px solid #e5e7eb">
            <tr>
              <td width="50%" style="padding:16px 24px;vertical-align:top;border-right:1px solid #e5e7eb">
                <div style="font-size:9px;font-weight:700;color:#9ca3af;letter-spacing:1px;margin-bottom:6px;text-transform:uppercase">${isEn ? "From" : "Laskuttaja"}</div>
                ${senderName ? `<div style="font-weight:700;color:#111827;font-size:13px">${senderName}</div>` : ""}
                ${senderAddress ? `<div style="color:#6b7280;font-size:12px;margin-top:2px">${senderAddress}</div>` : ""}
                ${(() => {
                  // Y-tunnus must be the SELLER's (the invoicing founder) — never
                  // another assigned worker's. Fall back to matching the sender by
                  // name in the workers list; the old workers[0] fallback printed
                  // the wrong founder's Y-tunnus when someone else billed.
                  const yt = senderYTunnus || workers.find(w => w.name === senderName)?.yTunnus;
                  return yt ? `<div style="color:#6b7280;font-size:12px;margin-top:2px">Y-tunnus: ${yt}</div>` : "";
                })()}
              </td>
              <td width="50%" style="padding:16px 24px;vertical-align:top">
                <div style="font-size:9px;font-weight:700;color:#9ca3af;letter-spacing:1px;margin-bottom:6px;text-transform:uppercase">${isEn ? "Bill to" : "Laskutetaan"}</div>
                <div style="font-weight:700;color:#111827;font-size:13px">${customerName}</div>
                ${customerAddress ? `<div style="color:#6b7280;font-size:12px;margin-top:2px">${customerAddress}</div>` : ""}
              </td>
            </tr>
          </table>

          <!-- Line items -->
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr style="background:#f9fafb;border-bottom:1px solid #e5e7eb">
              <th style="padding:10px 24px;text-align:left;font-size:9px;font-weight:700;color:#6b7280;letter-spacing:0.8px;text-transform:uppercase">${isEn ? "Service" : "Palvelu"}</th>
              ${estimatedHours ? `<th style="padding:10px 12px;text-align:center;font-size:9px;font-weight:700;color:#6b7280;letter-spacing:0.8px;text-transform:uppercase;white-space:nowrap">${isEn ? "Hours" : "Tunnit"}</th>` : ""}
              <th style="padding:10px 24px;text-align:right;font-size:9px;font-weight:700;color:#6b7280;letter-spacing:0.8px;text-transform:uppercase">${isEn ? "Amount" : "Hinta"}</th>
            </tr>
            <tr style="border-bottom:1px solid #f3f4f6">
              <td style="padding:14px 24px;vertical-align:top">
                <div style="font-weight:600;color:#111827">${description}</div>
                ${estimatedHours ? `<div style="font-size:11px;color:#9ca3af;margin-top:3px">${isEn ? `~${estimatedHours} hours` : `n. ${estimatedHours} tuntia`}</div>` : ""}
              </td>
              ${estimatedHours ? `<td style="padding:14px 12px;text-align:center;color:#6b7280;vertical-align:top">~${estimatedHours} h</td>` : ""}
              <td style="padding:14px 24px;text-align:right;font-weight:600;color:#111827;vertical-align:top">${hasExpenses ? fmtC(laborCents) : price}</td>
            </tr>
            ${hasExpenses ? `
            <tr style="border-bottom:1px solid #f3f4f6">
              <td style="padding:10px 24px;color:#6b7280">${isEn ? "Materials" : "Materiaalit"}</td>
              ${estimatedHours ? `<td style="padding:10px 12px"></td>` : ""}
              <td style="padding:10px 24px;text-align:right;color:#6b7280">${fmtC(expensesTotalCents)}</td>
            </tr>` : ""}
            <tr>
              <td colspan="${estimatedHours ? "3" : "2"}" style="padding:6px 24px;font-size:10px;color:#9ca3af">
                ${isEn ? "No VAT — the seller is not VAT-liable (Finnish VAT Act § 3, small-scale business)." : "Ei arvonlisäveroa — myyjä ei ole arvonlisäverovelvollinen (AVL 3 §, vähäinen toiminta)."}
              </td>
            </tr>
            <tr style="background:#f9fafb">
              <td colspan="${estimatedHours ? "2" : "1"}" style="padding:14px 24px;font-weight:700;color:#111827;font-size:14px">${isEn ? "Total" : "Yhteensä"}</td>
              <td style="padding:14px 24px;text-align:right;font-size:20px;font-weight:800;color:#111827">${price}</td>
            </tr>
          </table>

          ${Array.isArray(unitBreakdown) && unitBreakdown.length > 0 ? `
          <div style="padding:16px 24px;background:#f8fafc;border-top:1px solid #e5e7eb">
            <p style="margin:0 0 10px;font-size:11px;font-weight:700;color:#6b7280;letter-spacing:0.8px;text-transform:uppercase">${isEn ? "Per Unit Breakdown" : "Asuntokohtainen erittely"}</p>
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px">
              ${(unitBreakdown as {unitName:string;priceEur:string}[]).map(u =>
                `<tr style="border-bottom:1px solid #f1f5f9">
                  <td style="padding:5px 0;color:#374151">${u.unitName}</td>
                  <td style="padding:5px 0;text-align:right;font-weight:600;color:#111827">${u.priceEur}</td>
                </tr>`
              ).join("")}
            </table>
          </div>` : ""}

          ${hasExpenses ? `
          <div style="padding:8px 24px;background:#f0fdf4;border-top:1px solid #bbf7d0">
            <span style="font-size:11px;color:#166534">${isEn ? `Tax deduction eligible (labour): ${fmtC(laborCents)}` : `Kotitalousvähennykseen kelpaava työn osuus: ${fmtC(laborCents)}`}</span>
          </div>` : `
          <div style="padding:8px 24px;background:#f0fdf4;border-top:1px solid #bbf7d0">
            <span style="font-size:11px;color:#166534">${isEn ? `Full amount qualifies for household tax deduction` : `Koko summa kotitalousvähennyskelpoinen`}</span>
          </div>`}

          <!-- Payment details -->
          <div style="background:#fffbeb;border-top:2px solid #fbbf24;padding:20px 24px">
            <div style="font-size:9px;font-weight:700;color:#92400e;letter-spacing:1px;text-transform:uppercase;margin-bottom:12px">${isEn ? "Payment details" : "Maksutiedot"}</div>
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:12px">
              ${iban ? `<tr>
                <td style="padding:4px 0;color:#78350f;width:42%">${isEn ? "Account (IBAN)" : "Tilinumero (IBAN)"}</td>
                <td style="padding:4px 0;font-family:'Courier New',monospace;font-weight:600;color:#111827" x-apple-data-detectors="false">${iban}</td>
              </tr>` : ""}
              ${bic ? `<tr>
                <td style="padding:4px 0;color:#78350f">BIC/SWIFT</td>
                <td style="padding:4px 0;font-family:'Courier New',monospace;font-weight:600;color:#111827">${bic}</td>
              </tr>` : ""}
              ${viitenumero ? `<tr>
                <td style="padding:4px 0;color:#78350f">${isEn ? "Reference" : "Viitenumero"}</td>
                <td style="padding:4px 0;font-family:'Courier New',monospace;font-weight:700;letter-spacing:1px;color:#111827" x-apple-data-detectors="false">${refDisplay}</td>
              </tr>` : ""}
              ${dueDateDisplay ? `<tr>
                <td style="padding:4px 0;color:#78350f">${isEn ? "Due date" : "Eräpäivä"}</td>
                <td style="padding:4px 0;font-weight:700;color:#92400e">${dueDateDisplay}</td>
              </tr>` : ""}
              <tr>
                <td style="padding:8px 0 0;color:#78350f;font-weight:700;font-size:14px">${isEn ? "Total due" : "Maksettava"}</td>
                <td style="padding:8px 0 0;font-size:18px;font-weight:800;color:#92400e">${price}</td>
              </tr>
            </table>
            ${fiBarcodeHtml}
          </div>
        </div>` : "";

      // ── Paid confirmation ────────────────────────────────────────────────────
      const paidMethodLabel = paymentMethod === "käteinen" ? (isEn ? "Cash" : "Käteinen")
        : paymentMethod === "mobilepay" ? "MobilePay"
        : paymentMethod === "kortti" ? (isEn ? "Card" : "Kortti")
        : paymentMethod;
      const paidBox = !isInvoice ? `
        <div style="background:#ecfdf5;border-radius:12px;padding:16px 20px;margin-bottom:24px;display:flex;align-items:center;gap:12px">
          <span style="font-size:22px">✓</span>
          <div>
            <p style="margin:0;font-weight:700;color:#065f46;font-size:14px">${isEn ? "Payment received" : "Maksettu"}</p>
            <p style="margin:2px 0 0;color:#047857;font-size:13px">${paidMethodLabel}</p>
          </div>
        </div>` : "";

      // ── Job summary card (non-invoice) ───────────────────────────────────────
      const summaryCard = !isInvoice ? `
        <div style="background:#fafafa;border-radius:12px;padding:20px;margin-bottom:24px">
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            <tr><td style="padding:6px 0;color:#666;width:40%">${isEn ? "Customer" : "Asiakas"}</td><td style="padding:6px 0;font-weight:600;text-align:right">${customerName}</td></tr>
            ${customerAddress ? `<tr><td style="padding:6px 0;color:#666">${isEn ? "Address" : "Osoite"}</td><td style="padding:6px 0;font-weight:600;text-align:right">${customerAddress}</td></tr>` : ""}
            <tr style="border-top:1px solid #e4e4e7"><td style="padding:6px 0;color:#666">${isEn ? "Service" : "Palvelu"}</td><td style="padding:6px 0;font-weight:600;text-align:right">${description}</td></tr>
            <tr><td style="padding:6px 0;color:#666">${isEn ? "Date" : "Päivämäärä"}</td><td style="padding:6px 0;font-weight:600;text-align:right">${completionDate}</td></tr>
            <tr style="border-top:2px solid #18181b"><td style="padding:10px 0;font-weight:700;font-size:15px">${isEn ? "Price" : "Hinta"}</td><td style="padding:10px 0;font-weight:800;font-size:18px;text-align:right;color:#18181b">${price}</td></tr>
          </table>
        </div>` : "";

      // ── Job notes ────────────────────────────────────────────────────────────
      const notesBox = jobNotes ? `
        <div style="background:#f0f9ff;border-radius:12px;padding:16px 20px;margin-bottom:24px">
          <p style="margin:0 0 8px;font-weight:700;color:#075985;font-size:12px;letter-spacing:0.5px">${isEn ? "NOTES FROM THE JOB" : "HUOMIOITA KEIKASTA"}</p>
          <p style="margin:0;color:#0369a1;font-size:13px;line-height:1.7;white-space:pre-line">${jobNotes}</p>
        </div>` : "";

      // ── Job photo ────────────────────────────────────────────────────────────
      const photoBlock = photoDataUrl ? `
        <div style="margin-bottom:24px">
          <img src="${photoDataUrl}" alt="${isEn ? "Job photo" : "Kuva keikasta"}" style="width:100%;max-width:100%;border-radius:12px;display:block;object-fit:cover" />
        </div>` : "";

      // ── Kotitalousvähennys (non-invoice only — invoice already shows this) ───
      const taxHint = !isInvoice ? `
        <div style="background:#f9fafb;border:1px solid #e4e4e7;border-radius:12px;padding:14px 18px;margin-bottom:24px">
          <p style="margin:0 0 4px;font-weight:600;color:#374151;font-size:12px">${isEn ? "HOUSEHOLD TAX DEDUCTION" : "KOTITALOUSVÄHENNYS"}</p>
          <p style="margin:0;color:#6b7280;font-size:12px;line-height:1.6">
            ${isEn
              ? "This document may serve as proof for the Finnish household tax deduction (~35% of the labour cost, up to €2,250/person/year). Confirm eligibility at vero.fi or with a tax adviser. No separate receipt needed."
              : "Tämä lasku voi toimia kotitalousvähennyksen dokumenttina (~35 % työn osuudesta, enintään 2 250 € / henkilö / vuosi). Tarkista soveltuvuus osoitteessa vero.fi tai veroneuvojalta. Erillistä kuittia ei tarvita."}
          </p>
        </div>` : "";

      // ── Google review ────────────────────────────────────────────────────────
      const reviewBlock = `
        <div style="background:#fffbeb;border-radius:12px;padding:16px;margin-bottom:24px;border-left:3px solid #f59e0b">
          <p style="margin:0 0 6px;font-weight:700;color:#92400e;font-size:13px">${isEn ? "A SMALL REQUEST" : "PIENI PYYNTÖ"}</p>
          <p style="margin:0 0 10px;color:#78350f;font-size:13px;line-height:1.6">
            ${isEn
              ? "Every review helps us reach more customers — it takes 30 seconds and means the world to us."
              : "Jokainen arvostelu auttaa meitä tavoittamaan uusia asiakkaita — se vie 30 sekuntia ja merkitsee meille valtavasti."}
          </p>
          <a href="https://g.page/r/CQo_lx1fQ57lEAE/review" style="display:inline-block;background:#f59e0b;color:#fff;padding:8px 18px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px">${isEn ? "Leave a review →" : "Jätä arvostelu →"}</a>
        </div>`;

      // ── Referral ─────────────────────────────────────────────────────────────
      const referralBlock = `
        <div style="background:#f0f9ff;border-radius:12px;padding:16px;margin-bottom:24px;border-left:3px solid #0ea5e9">
          <p style="margin:0 0 6px;font-weight:700;color:#075985;font-size:13px">${isEn ? "SHARE WITH FRIENDS — 5% OFF" : "JAA KAVEREILLE — 5 % ALENNUS"}</p>
          <p style="margin:0 0 10px;color:#0369a1;font-size:13px;line-height:1.6">
            ${isEn
              ? `Recommend us to a friend — they get <strong>5% off</strong> their first booking. Your personal code:`
              : `Suosittele meitä kaverille — he saavat <strong>5 % alennuksen</strong> ensimmäisestä tilauksesta. Koodisi:`}
          </p>
          <div style="background:#fff;border:1px solid #bae6fd;border-radius:8px;padding:8px 14px;text-align:center;margin-bottom:10px">
            <span style="font-family:monospace;font-size:17px;font-weight:700;color:#0c4a6e;letter-spacing:2px">${referralCode}</span>
          </div>
          <a href="${referralLink}" style="display:inline-block;background:#0ea5e9;color:#fff;padding:8px 18px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px">${isEn ? "Share link →" : "Jaa linkki →"}</a>
        </div>`;

      // ── Next booking CTA ─────────────────────────────────────────────────────
      const nextBookingBlock = `
        <div style="text-align:center;margin-bottom:28px">
          <p style="color:#52525b;font-size:14px;margin:0 0 4px;line-height:1.6">
            ${isEn ? "Need help with other home tasks?" : "Tarvitsetko apua muissa kotihommissa?"}<br>
            <span style="font-size:12px;color:#71717a">${isEn ? "Lawn mowing · cleaning · yard care · painting" : "Nurmikon leikkuu · siivous · pihahoito · maalaus"}</span>
          </p>
          <a href="https://puuhapatet.fi/tilaus" style="display:inline-block;margin-top:10px;background:#2d5016;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px">${isEn ? "Book your next service →" : "Varaa seuraava aika →"}</a>
        </div>`;


      // ── Footer workers ───────────────────────────────────────────────────────
      const footerWorkersHtml = workers.length > 0
        ? workers.map(w =>
            `<div style="margin-bottom:8px">
              <strong style="color:#18181b">${w.name}</strong><br>
              ${w.phone ? `<span style="color:#71717a">${w.phone}</span><br>` : ""}
              ${w.yTunnus ? `<span style="color:#71717a">Y-tunnus: ${w.yTunnus}</span><br>` : ""}
            </div>`
          ).join("")
        : `<strong style="color:#18181b">Puuhapatet</strong><br>`;

      const html = `
<!DOCTYPE html>
<html lang="${isEn ? "en" : "fi"}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no">
  <style>
    body { margin:0; padding:0; background:#f0f2f0; }
    @media only screen and (max-width:600px) {
      .email-card { border-radius:0 !important; margin:0 !important; }
      .email-body { padding:20px 20px !important; }
      .email-footer { padding:16px 20px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,sans-serif;background:#f0f2f0;-webkit-font-smoothing:antialiased">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f0f2f0;min-height:100vh">
    <tr><td align="center" style="padding:32px 16px">

  <div class="email-card" style="max-width:600px;width:100%;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.10);margin:0 auto">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#2d5016 0%,#3d6b1f 100%);padding:32px 40px;text-align:center">
      <h1 style="margin:0;color:#fff;font-size:24px;font-weight:800;letter-spacing:-0.5px">Puuhapatet.</h1>
      <p style="margin:8px 0 0;color:#b8e07a;font-size:14px;font-weight:500">${isInvoice ? (isEn ? "Invoice" : "Lasku") : (isEn ? "Job complete" : "Työ valmis")} · ${completionDate}</p>
    </div>

    <!-- Body -->
    <div class="email-body" style="padding:32px 40px">

      ${timelineHtml}

      <!-- Greeting + worker message -->
      ${workerMessage
        ? `<p style="color:#1a1a1a;font-size:16px;line-height:1.75;margin:0 0 24px;white-space:pre-line">${isEn ? `Hi ${firstName}!` : `Hei ${firstName}!`}<br><br>${workerMessage}</p>`
        : `<p style="color:#1a1a1a;font-size:16px;line-height:1.75;margin:0 0 24px">${isEn
            ? `Hi ${firstName}! The job is all done — thank you for choosing Puuhapatet.`
            : `Hei ${firstName}! Keikka on hoidettu — kiitos kun valitsit Puuhapatet.`}</p>`
      }

      ${invoiceBox}
      ${paidBox}
      ${summaryCard}
      ${photoBlock}
      ${notesBox}
      ${taxHint}
      ${reviewBlock}
      ${referralBlock}
      ${nextBookingBlock}

      <p style="color:#b0b0b0;font-size:12px;text-align:center;margin:8px 0 0;line-height:1.6">
        ${isEn ? "Window cleaning · lawn mowing · cleaning · yard care · painting" : "Ikkunapesu · nurmikko · siivous · pihahoito · maalaus"}
      </p>
    </div>

    <!-- Footer -->
    <div class="email-footer" style="background:#f7f8f7;padding:24px 40px;border-top:1px solid #e8eae8">
      ${workers.length > 0 ? `<p style="margin:0 0 14px;color:#555;font-size:13px;font-style:italic">— ${workerNames}</p>` : ""}
      <table style="width:100%;font-size:12px;color:#777;border-collapse:collapse">
        <tr>
          <td style="vertical-align:top;padding-right:16px">${footerWorkersHtml}</td>
          <td style="text-align:right;vertical-align:top;white-space:nowrap">
            <strong style="color:#2d5016">Puuhapatet</strong><br>
            <a href="mailto:info@puuhapatet.fi" style="color:#777;text-decoration:none">info@puuhapatet.fi</a><br>
            <a href="https://puuhapatet.fi" style="color:#777;text-decoration:none">puuhapatet.fi</a>
          </td>
        </tr>
      </table>
    </div>
  </div>

    </td></tr>
  </table>
</body>
</html>`;

      const subject = isInvoice
        ? (isEn ? `Invoice — Puuhapatet, ${completionDate}` : `Lasku — Puuhapatet, ${completionDate}`)
        : (isEn ? `Job complete — Puuhapatet, ${completionDate}` : `Työ valmis — Puuhapatet, ${completionDate}`);

      // ── Kotitalousvähennys PDF attachment ────────────────────────────────────
      let pdfAttachment: { filename: string; content: Buffer } | null = null;
      if (agreedPriceCents) {
        try {
          // The receipt's seller must be the SENDER (same identity as the
          // invoice header) — not the first assigned worker, whose Y-tunnus
          // used to leak onto other founders' receipts.
          const senderWorker = senderName
            ? { name: senderName, yTunnus: senderYTunnus || workers.find(w => w.name === senderName)?.yTunnus }
            : workers[0];
          const pdfBuffer = await generateKotitalousReceiptPdf({
            customerName,
            customerAddress,
            workerName: senderWorker?.name,
            workerYTunnus: senderWorker?.yTunnus,
            workerAddress: senderName ? senderAddress : undefined,
            description,
            completionDate,
            paymentMethod,
            agreedPriceCents,
            laborCents,
            estimatedHours: estimatedHours ? Number(estimatedHours) : undefined,
            expensesTotalCents: expensesTotalCents || undefined,
            lang,
          });
          pdfAttachment = {
            filename: isEn ? "service-receipt.pdf" : "palvelutosite.pdf",
            content: pdfBuffer,
          };
        } catch (pdfErr) {
          console.warn("PDF generation failed, sending email without attachment:", pdfErr);
        }
      }

      const result = await resend.emails.send({
        from: FROM_EMAIL,
        to,
        ...(bcc && bcc.length > 0 ? { bcc } : {}),
        subject,
        html,
        ...(pdfAttachment ? { attachments: [pdfAttachment] } : {}),
      });

      // ── Tilitystosite: usean tekijän keikoilla kullekin tekijälle oma erittely ──
      // Vapaamuotoinen tosite kirjanpitoon/verotukseen: dokumentoi miten yhden
      // tekijän laskuttama kokonaissumma on jaettu tekijöiden kesken.
      let settlementSent = 0;
      const settlementWorkers: {
        name: string; email?: string; yTunnus?: string;
        grossCents: number; expensesCents: number; feePct: number; feeCents: number; netCents: number;
      }[] = Array.isArray(settlement?.workers) ? settlement.workers : [];

      if (settlementWorkers.length >= 2) {
        const collector: string = settlement.collectorName || settlementWorkers[0]?.name || "—";
        const payLabel: Record<string, string> = {
          "käteinen": "Käteinen", "mobilepay": "MobilePay", "tilisiirto": "Tilisiirto", "kortti": "Kortti",
        };

        const splitRows = settlementWorkers.map(w => `
          <tr>
            <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9">
              <span style="font-weight:600;color:#1e293b">${w.name}</span>
              ${w.yTunnus ? `<br><span style="font-size:11px;color:#94a3b8">Y-tunnus ${w.yTunnus}</span>` : ""}
            </td>
            <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:right;color:#475569">${fmtC(w.grossCents)}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:right;color:#ea580c">−${fmtC(w.expensesCents)}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:right;color:#9333ea">−${fmtC(w.feeCents)} (${w.feePct} %)</td>
            <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:700;color:#16a34a">${fmtC(w.netCents)}</td>
          </tr>`).join("");

        const tositeHtml = (me: typeof settlementWorkers[number]) => `
          <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#1e293b">
            <div style="background:#1e293b;border-radius:16px 16px 0 0;padding:20px 24px">
              <div style="color:#fff;font-size:20px;font-weight:800;letter-spacing:0.5px">TILITYSTOSITE</div>
              <div style="color:#94a3b8;font-size:12px;margin-top:2px">Puuhapatet · ${todayDisplay}</div>
            </div>
            <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 16px 16px;padding:24px">
              <p style="font-size:14px;margin:0 0 16px">Hei ${me.name.split(" ")[0]}! Tämä tosite erittelee yhteiskeikan tulonjaon — säilytä kirjanpitoa ja verotusta (OmaVero) varten.</p>

              <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;margin-bottom:16px">
                <tr><td style="padding:4px 0;color:#64748b;width:160px">Työ</td><td style="padding:4px 0;font-weight:600">${description}</td></tr>
                <tr><td style="padding:4px 0;color:#64748b">Asiakas</td><td style="padding:4px 0">${customerName}${customerAddress ? `, ${customerAddress}` : ""}</td></tr>
                <tr><td style="padding:4px 0;color:#64748b">Valmistunut</td><td style="padding:4px 0">${completionDate}</td></tr>
                <tr><td style="padding:4px 0;color:#64748b">Kokonaishinta</td><td style="padding:4px 0;font-weight:600">${agreedPriceCents ? fmtC(agreedPriceCents) : price}</td></tr>
                <tr><td style="padding:4px 0;color:#64748b">Maksutapa</td><td style="padding:4px 0">${payLabel[paymentMethod] ?? paymentMethod}</td></tr>
                <tr><td style="padding:4px 0;color:#64748b">Maksun vastaanotti</td><td style="padding:4px 0;font-weight:600">${collector}</td></tr>
              </table>

              <p style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;margin:0 0 8px">Tulonjako tekijöittäin</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="font-size:12px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:16px">
                <tr style="background:#f8fafc">
                  <th style="padding:8px 12px;text-align:left;color:#64748b;font-weight:600">Tekijä</th>
                  <th style="padding:8px 12px;text-align:right;color:#64748b;font-weight:600">Brutto-osuus</th>
                  <th style="padding:8px 12px;text-align:right;color:#64748b;font-weight:600">Kulut</th>
                  <th style="padding:8px 12px;text-align:right;color:#64748b;font-weight:600">Palvelumaksu</th>
                  <th style="padding:8px 12px;text-align:right;color:#64748b;font-weight:600">Netto</th>
                </tr>
                ${splitRows}
              </table>

              <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:14px 16px;margin-bottom:16px">
                <span style="font-size:13px;color:#166534">Sinun osuutesi (verotettava tulo tästä keikasta):</span>
                <span style="font-size:18px;font-weight:800;color:#16a34a;float:right">${fmtC(me.netCents)}</span>
              </div>

              <p style="font-size:11px;color:#94a3b8;margin:0">
                Vapaamuotoinen tosite. ${collector} on laskuttanut asiakasta kokonaissummalla ja tilittänyt muille
                tekijöille heidän osuutensa. Kukin tekijä ilmoittaa oman netto-osuutensa omassa verotuksessaan.
                Vuosiyhteenvedon saat sovelluksen Verotulosteesta.
              </p>
            </div>
          </div>`;

        for (const w of settlementWorkers) {
          if (!w.email) continue;
          try {
            await resend.emails.send({
              from: FROM_EMAIL,
              to: w.email,
              subject: `Tilitystosite — ${description}, ${completionDate}`,
              html: tositeHtml(w),
            });
            settlementSent++;
          } catch (err) {
            console.warn("Tilitystosite send failed for", w.name, err);
          }
        }
      }

      // Record WHO billed this job (whose account/Y-tunnus collected the money).
      // Founder ids feed the ALV turnover + founder cross-invoicing; a staff
      // sender counts only with their own Y-tunnus (otherwise the job must stay
      // in the "laskuttaja puuttuu" bucket). Only fills an EMPTY billedBy — a
      // re-send never overwrites a manually corrected attribution.
      const senderIsBiller = senderId && /^[a-z0-9]{1,40}$/i.test(String(senderId))
        && (FOUNDER_IDS.includes(String(senderId).toLowerCase()) || !!senderYTunnus);
      if (jobId && senderIsBiller) {
        try {
          await db.update(jobs)
            .set({ billedBy: String(senderId).toLowerCase(), updatedAt: new Date() })
            .where(and(eq(jobs.id, Number(jobId)), isNull(jobs.billedBy)));
        } catch (err) {
          console.warn("billedBy save failed for job", jobId, err);
        }
      }

      // ── Auto-file into document management (kirjanpito, 6 v säilytys) ──────
      // 1) The biller keeps a copy of every sales invoice/receipt they send —
      //    a legal retention duty that used to depend on remembering to save
      //    the email. 2) Every other worker on the gig gets a työkorvaus
      //    receipt for their net share: the legal record of the compensation
      //    from the person who billed the customer. Best-effort — the email
      //    already went out; a filing failure must not fail the request.
      try {
        const now = Date.now();
        const mkDoc = (desc: string, amountCents: number, kind: "lasku" | "kuitti"): CrewDocument => ({
          id: `doc_${randomUUID().slice(0, 12)}`,
          date: now, desc: desc.slice(0, 300), amountCents, kind,
          retentionUntil: retentionFromDate(now), addedAt: now,
        });
        // completionDate in the desc keeps repeat gigs (same customer, same
        // price, same service) distinct while a plain re-send still dedupes.
        const grossCents = Math.round(Number(agreedPriceCents) || 0);
        if (senderIsBiller && grossCents > 0) {
          await attachPersonDocument(String(senderId).toLowerCase(), mkDoc(
            isInvoice
              ? `Myyntilasku #${refDisplay}: ${customerName} — ${description}`
              : `Myyntitosite (${paymentMethod}) ${completionDate}: ${customerName} — ${description}`,
            grossCents, "lasku",
          ), true);
        }
        const collectorName: string = settlement?.collectorName || senderName || "";
        for (const w of settlementWorkers) {
          const shareCents = Math.round(Number(w?.netCents) || 0);
          if (!w?.name || shareCents <= 0) continue;
          if (collectorName && w.name === collectorName) continue; // biller's record is the invoice copy above
          await attachPersonDocument(w.name.trim().split(/\s+/)[0].toLowerCase(), mkDoc(
            `Työkorvaus-osuus ${completionDate}: ${customerName} — ${description} (${(collectorName || "toinen tekijä").split(/\s+/)[0]} laskutti ja tilittää)`,
            shareCents, "kuitti",
          ), true);
        }
      } catch (err) {
        console.warn("send-job-summary document filing failed", err);
      }

      res.json({ ok: true, id: result.data?.id, settlementSent });
    } catch (e: any) {
      console.error("Job summary email error:", e);
      res.status(500).json({ error: e.message || "Sähköpostin lähetys epäonnistui" });
    }
  });

  // ─── Progress update email ────────────────────────────────────────────────────

  app.post("/api/send-progress-update", async (req, res) => {
    if (!resend) {
      return res.status(503).json({ error: "Sähköpostipalvelu ei käytössä — aseta RESEND_API_KEY ympäristömuuttuja." });
    }
    try {
      const { to, bcc, customerName, description, progressNotes, continuationPlan, continuationDate, workerName, workerPhone, lang } = req.body;
      if (!to || !customerName || !progressNotes) {
        return res.status(400).json({ error: "Puuttuvia kenttiä" });
      }

      const isEn = lang === "en";
      const firstName = customerName.split(" ")[0];
      const workerFirst = workerName ? workerName.split(" ")[0] : "Puuhapatet";
      const today = new Date().toLocaleDateString(isEn ? "en-GB" : "fi-FI");

      const nextDateLine = continuationDate
        ? (() => {
            const d = new Date(continuationDate);
            return d.toLocaleDateString(isEn ? "en-GB" : "fi-FI") + (
              d.getHours() || d.getMinutes()
                ? " " + d.toLocaleTimeString(isEn ? "en-GB" : "fi-FI", { hour: "2-digit", minute: "2-digit" })
                : ""
            );
          })()
        : null;

      const html = `
<!DOCTYPE html>
<html lang="${isEn ? "en" : "fi"}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f4f5">
  <div style="max-width:560px;margin:24px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.12)">

    <!-- Header -->
    <div style="background:#18181b;padding:28px 32px;text-align:center">
      <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;letter-spacing:-0.3px">Puuhapatet.</h1>
      <p style="margin:6px 0 0;color:#a1a1aa;font-size:13px">${isEn ? "Job update" : "Keikkapäivitys"} · ${today}</p>
    </div>

    <!-- Body -->
    <div style="padding:28px 32px">

      <!-- Greeting -->
      <p style="color:#18181b;font-size:15px;line-height:1.6;margin:0 0 24px">
        ${isEn
          ? `Hi ${firstName}! We've been working on your property today and wanted to keep you in the loop on where things stand.`
          : `Moi ${firstName}! Olemme käyneet luonanne tänään ja halusimme pitää sinut ajan tasalla tilanteesta.`}
      </p>

      <!-- What was done -->
      <div style="background:#f0fdf4;border-radius:12px;padding:20px;margin-bottom:16px;border-left:4px solid #22c55e">
        <p style="margin:0 0 8px;font-weight:700;color:#166534;font-size:12px;letter-spacing:.5px;text-transform:uppercase">${isEn ? "What we did today" : "Mitä tehtiin"}</p>
        <p style="margin:0;color:#15803d;font-size:14px;line-height:1.7;white-space:pre-wrap">${progressNotes}</p>
      </div>

      ${continuationPlan ? `
      <!-- Continuation plan -->
      <div style="background:#eff6ff;border-radius:12px;padding:20px;margin-bottom:16px;border-left:4px solid #3b82f6">
        <p style="margin:0 0 8px;font-weight:700;color:#1e40af;font-size:12px;letter-spacing:.5px;text-transform:uppercase">${isEn ? "Next visit plan" : "Jatkosuunnitelma"}</p>
        <p style="margin:0;color:#1d4ed8;font-size:14px;line-height:1.7;white-space:pre-wrap">${continuationPlan}</p>
      </div>` : ""}

      ${nextDateLine ? `
      <!-- Next date -->
      <div style="background:#fafafa;border-radius:12px;padding:16px 20px;margin-bottom:16px;display:flex;align-items:center;gap:16px">
        <div style="background:#18181b;border-radius:10px;padding:12px;flex-shrink:0;text-align:center;min-width:48px">
          <span style="color:#fff;font-size:18px">📅</span>
        </div>
        <div>
          <p style="margin:0 0 2px;font-weight:700;color:#18181b;font-size:12px;letter-spacing:.5px;text-transform:uppercase">${isEn ? "Scheduled next visit" : "Sovittu jatkopäivä"}</p>
          <p style="margin:0;color:#52525b;font-size:15px;font-weight:600">${nextDateLine}</p>
        </div>
      </div>` : ""}

      <!-- Service label -->
      ${description ? `<p style="color:#a1a1aa;font-size:12px;margin:0 0 20px">
        ${isEn ? "Service" : "Palvelu"}: ${description}
      </p>` : ""}

      <!-- CTA -->
      <div style="text-align:center;margin-bottom:24px">
        <p style="color:#52525b;font-size:13px;margin:0 0 10px;line-height:1.6">
          ${isEn ? "Questions? Feel free to reach out directly." : "Kysyttävää? Ota rohkeasti yhteyttä suoraan."}
        </p>
        ${workerPhone
          ? `<a href="tel:${workerPhone}" style="display:inline-block;background:#18181b;color:#fff;padding:10px 24px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px">${isEn ? "Call us →" : "Soita →"} ${workerPhone}</a>`
          : `<a href="mailto:info@puuhapatet.fi" style="display:inline-block;background:#18181b;color:#fff;padding:10px 24px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px">info@puuhapatet.fi</a>`
        }
      </div>

      <p style="color:#a1a1aa;font-size:12px;text-align:center;margin:0">
        ${isEn ? "Window cleaning · lawn mowing · cleaning · yard care · painting" : "Ikkunapesu · nurmikko · siivous · pihahoito · maalaus"}
      </p>
    </div>

    <!-- Footer -->
    <div style="background:#fafafa;padding:20px 32px;border-top:1px solid #e4e4e7">
      <p style="margin:0 0 12px;color:#52525b;font-size:13px;line-height:1.5">— ${workerFirst}</p>
      <table style="width:100%;font-size:12px;color:#71717a">
        <tr>
          <td style="vertical-align:top">
            <strong style="color:#18181b">${workerName || "Puuhapatet"}</strong><br>
            ${workerPhone ? workerPhone + "<br>" : ""}
          </td>
          <td style="text-align:right;vertical-align:top">
            <strong style="color:#18181b">Puuhapatet</strong><br>
            <a href="mailto:info@puuhapatet.fi" style="color:#71717a;text-decoration:none">info@puuhapatet.fi</a><br>
            <a href="https://puuhapatet.fi" style="color:#71717a;text-decoration:none">puuhapatet.fi</a>
          </td>
        </tr>
      </table>
    </div>
  </div>
</body>
</html>`;

      const result = await resend.emails.send({
        from: FROM_EMAIL,
        to,
        ...(bcc ? { bcc } : {}),
        subject: isEn ? `Job update — Puuhapatet, ${today}` : `Keikkapäivitys — Puuhapatet, ${today}`,
        html,
      });

      res.json({ ok: true, id: result.data?.id });
    } catch (e: any) {
      console.error("Progress update email error:", e);
      res.status(500).json({ error: e.message || "Sähköpostin lähetys epäonnistui" });
    }
  });

  // ─── Quote email ──────────────────────────────────────────────────────────────

  app.post("/api/send-quote", async (req, res) => {
    if (!resend) {
      return res.status(503).json({ error: "Sähköpostipalvelu ei käytössä — aseta RESEND_API_KEY ympäristömuuttuja." });
    }
    try {
      const {
        to, bcc, quoteId, quoteToken, customerName, customerAddress,
        items, total, validDays, customMessage,
        workerName, workerPhone, workerEmail, lang,
        isTaloyhtiio, taloyhtiioName, unitCount, propertyImageUrl, isYritys,
      } = req.body;

      const bccArr = bcc
        ? (bcc as string).split(",").map((s: string) => s.trim()).filter(Boolean)
        : undefined;

      if (!to || !customerName || !quoteId || !items?.length) {
        return res.status(400).json({ error: "Puuttuvia kenttiä" });
      }

      const isEn      = lang === "en";
      const isTalo    = !!isTaloyhtiio;
      const firstName = (customerName as string).split(" ")[0];
      const today     = new Date().toLocaleDateString(isEn ? "en-GB" : "fi-FI");
      const vDays     = validDays || 14;
      const validUntil = new Date(Date.now() + vDays * 24 * 60 * 60 * 1000)
        .toLocaleDateString(isEn ? "en-GB" : "fi-FI");

      const kotitalous = Math.round(Number(total) * 0.65);

      // ── Intro text ──────────────────────────────────────────────────────
      let defaultIntro: string;
      if (isTalo) {
        const taloName = taloyhtiioName || customerName;
        const units = unitCount ? ` (${unitCount} huoneistoa)` : "";
        defaultIntro = isEn
          ? `Hello. Here's our quote for ${taloName}${units}. Please review and approve via the link — you can also suggest a time that works for you.`
          : `Hei. Tässä tarjous kohteelle ${taloName}${units}. Hyväksy ja ehdota sopivaa ajankohtaa linkin kautta.`;
      } else {
        defaultIntro = isEn
          ? `Hello ${firstName}. Here's your quote. Please review and approve via the link — you can also suggest a time that works for you.`
          : `Hei ${firstName}. Tässä tarjouksemme. Hyväksy ja ehdota sopivaa ajankohtaa linkin kautta.`;
      }

      const introText = customMessage
        ? (customMessage as string).replace(/\n/g, "<br>")
        : defaultIntro;

      // ── Service rows ────────────────────────────────────────────────────
      const serviceRowsHtml = (items as Array<{ title: string; detail: string; price: number }>)
        .map((item, idx) => `
          <tr style="border-bottom:1px solid #ecfdf5;background:${idx % 2 === 1 ? "#f8fffe" : "#ffffff"}">
            <td style="padding:13px 16px 13px 0;vertical-align:top">
              <p style="margin:0;color:#1a2e1a;font-size:14px;font-weight:600">${item.title}</p>
              ${item.detail ? `<p style="margin:3px 0 0;color:#4b7a4b;font-size:12px">${item.detail}</p>` : ""}
            </td>
            <td style="padding:13px 0;text-align:right;vertical-align:top;white-space:nowrap">
              <span style="color:#1a2e1a;font-size:15px;font-weight:700">${Number(item.price).toFixed(0)} €</span>
            </td>
          </tr>
        `).join("");

      // ── Taloyhtiö key-points block ─────────────────────────────────────
      const taloKeyPointsHtml = isTalo ? `
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px">
        <tr>
          <td style="background:#f0fdf4;border-radius:12px;padding:18px 20px;border:1px solid #bbf7d0">
            <p style="margin:0 0 12px;font-weight:700;color:#166534;font-size:10px;letter-spacing:1.5px;text-transform:uppercase">${isEn ? "KEY POINTS FOR THE BUILDING" : "TALOYHTIÖLLE TÄRKEÄÄ"}</p>
            <table width="100%" cellpadding="0" cellspacing="0">
              ${[
                { fi: `Koko kiinteistö hoidetaan ammattimaisesti${unitCount ? ` — ${unitCount} huoneistoa` : ""}`, en: `Entire property handled professionally${unitCount ? ` — ${unitCount} units` : ""}` },
                { fi: "Koordinointi hallituksen tai isännöitsijän kanssa — asukkaat eivät tarvitse olla paikalla", en: "Coordinated with building management — residents don't need to be home" },
                { fi: "Selkeä dokumentointi ja lasku taloyhtiön kirjanpitoon", en: "Clear documentation and invoice for building records" },
                { fi: "Ammattitaitoiset tekijät — työn laatu vastaa sovittua", en: "Professional workers — work quality as agreed" },
              ].map(p => `
              <tr>
                <td style="padding:5px 0;font-size:13px;color:#1a3a1a;line-height:1.5">✓ ${isEn ? p.en : p.fi}</td>
              </tr>`).join("")}
            </table>
          </td>
        </tr>
      </table>` : "";

      // ── Property image block (skip data URLs — not supported in email clients) ──
      const emailImageUrl = propertyImageUrl && !(propertyImageUrl as string).startsWith("data:") ? propertyImageUrl : null;
      const propertyImageHtml = emailImageUrl ? `
      <tr>
        <td style="padding:0">
          <img src="${emailImageUrl}" alt="${taloyhtiioName || customerName}" style="width:100%;max-height:240px;object-fit:cover;display:block" />
        </td>
      </tr>` : "";

      const html = `
<!DOCTYPE html>
<html lang="${isEn ? "en" : "fi"}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f0faf2">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0faf2"><tr><td align="center" style="padding:28px 16px">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

  <!-- HEADER — forest green brand bar -->
  <tr>
    <td style="background:#2d5016;border-radius:16px 16px 0 0;padding:28px 32px 24px">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <p style="margin:0;color:#ffffff;font-size:26px;font-weight:900;letter-spacing:-0.5px">Puuhapatet.</p>
            <p style="margin:5px 0 0;color:#a3c97a;font-size:12px;letter-spacing:0.3px">${isEn ? "Professional property services" : "Ammattimainen kiinteistöpalvelu"}</p>
          </td>
          <td style="text-align:right;vertical-align:top;padding-top:2px">
            <span style="display:inline-block;background:#a3c97a;color:#1a3a0a;font-size:10px;font-weight:800;letter-spacing:2px;padding:5px 14px;border-radius:20px;text-transform:uppercase">${isTalo ? (isEn ? "BUILDING QUOTE" : "TALOYHTIÖTARJOUS") : isYritys ? (isEn ? "BUSINESS QUOTE" : "YRITYSTARJOUS") : (isEn ? "QUOTE" : "TARJOUS")}</span>
          </td>
        </tr>
      </table>
      <div style="margin-top:20px;padding-top:16px;border-top:1px solid #3d6620">
        <p style="font-family:'Courier New',Courier,monospace;color:#c8e89a;font-size:14px;font-weight:700;margin:0 0 4px;letter-spacing:1.5px">${quoteId}</p>
        <p style="color:#8ab865;font-size:12px;margin:0">${today} &nbsp;·&nbsp; ${isEn ? "Valid until" : "Voimassa"} <strong style="color:#c8e89a">${validUntil}</strong></p>
      </div>
    </td>
  </tr>

  <!-- PROPERTY IMAGE (optional) -->
  ${propertyImageHtml ? `<tr><td style="padding:0">${propertyImageHtml}</td></tr>` : ""}

  <!-- TO / FROM -->
  <tr>
    <td style="background:#ffffff;border-left:1px solid #d1f0d8;border-right:1px solid #d1f0d8">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding:16px 28px;border-right:1px solid #e8f5e9;width:50%;vertical-align:top">
            <p style="margin:0 0 5px;color:#6aab6a;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase">${isEn ? "FOR" : "ASIAKKAALLE"}</p>
            <p style="margin:0 0 2px;color:#1a2e1a;font-size:14px;font-weight:700">${isTalo && taloyhtiioName ? taloyhtiioName : customerName}</p>
            ${isTalo && taloyhtiioName ? `<p style="margin:0;color:#5a8a5a;font-size:12px">${customerName}</p>` : ""}
            ${customerAddress ? `<p style="margin:2px 0 0;color:#6a8a6a;font-size:12px;line-height:1.5">${customerAddress}</p>` : ""}
          </td>
          <td style="padding:16px 28px;width:50%;text-align:right;vertical-align:top">
            <p style="margin:0 0 5px;color:#6aab6a;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase">${isEn ? "FROM" : "LÄHETTÄJÄ"}</p>
            <p style="margin:0 0 2px;color:#1a2e1a;font-size:14px;font-weight:700">${workerName || "Puuhapatet"}</p>
            ${workerPhone ? `<p style="margin:0;color:#6a8a6a;font-size:12px">${workerPhone}</p>` : ""}
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- BODY -->
  <tr>
    <td style="background:#ffffff;border:1px solid #d1f0d8;border-top:none;padding:28px 32px">

      <!-- Intro -->
      <p style="margin:0 0 24px;color:#2a3a2a;font-size:15px;line-height:1.8">${introText}</p>

      <!-- Services label -->
      <p style="margin:0 0 8px;color:#6aab6a;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase">${isEn ? "SERVICES" : "PALVELUT"}</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-top:2px solid #2d5016">
        <tbody>${serviceRowsHtml}</tbody>
      </table>

      <!-- Total / per-unit -->
      ${isTalo && unitCount ? `
      <table width="100%" cellpadding="0" cellspacing="0" style="border-top:2px solid #2d5016;margin-top:0">
        <tr>
          <td style="padding:10px 0 2px;color:#6aab6a;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase">${isEn ? "PER APARTMENT" : "PER ASUNTO"}</td>
          <td style="padding:10px 0 2px;text-align:right;color:#2d5016;font-size:30px;font-weight:900">${Number(total).toFixed(0)} €</td>
        </tr>
        <tr>
          <td style="padding:2px 0 12px;color:#6a8a6a;font-size:12px">${unitCount} ${isEn ? "apartments" : "asuntoa"}</td>
          <td style="padding:2px 0 12px;text-align:right;color:#6a8a6a;font-size:14px;font-weight:700">${isEn ? "Total" : "Yhteensä"} ${(Number(total) * Number(unitCount)).toFixed(0)} €</td>
        </tr>
      </table>` : `
      <table width="100%" cellpadding="0" cellspacing="0" style="border-top:2px solid #2d5016;margin-top:0">
        <tr>
          <td style="padding:14px 0;color:#1a2e1a;font-size:14px;font-weight:700">${isEn ? "Total" : "Yhteensä"}</td>
          <td style="padding:14px 0;text-align:right;color:#2d5016;font-size:30px;font-weight:900">${Number(total).toFixed(0)} €</td>
        </tr>
      </table>`}

      <!-- Kotitalousvähennys footnote (non-yritys, non-talo) -->
      ${!req.body.isYritys && !isTalo ? `
      <p style="margin:8px 0 0;color:#6a8a6a;font-size:11px;line-height:1.6">
        ${isEn ? "* This service is typically eligible for the Finnish household tax deduction — confirm at <a href='https://vero.fi/en/individuals/tax-cards-and-tax-returns/deductions/household-deduction/' style='color:#4a7a4a'>vero.fi</a>" : "* Palvelu on tyypillisesti kotitalousvähennyskelpoinen — tarkista soveltuvuus: <a href='https://vero.fi/kotitalousvahennys' style='color:#4a7a4a'>vero.fi/kotitalousvähennys</a>"}
      </p>` : ""}

      ${taloKeyPointsHtml}

      <!-- Trust badges -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px">
        <tr>
          <td style="background:#f8fffe;border-radius:10px;padding:16px 18px;border:1px solid #d1f0d8">
            <table width="100%" cellpadding="0" cellspacing="0">
              ${[
                { emoji: "⭐", fi: "Tyytyväisyystakuu — mikäli tulos ei vastaa sovittua, korjaamme sen maksutta. Reklamaatiot: info@puuhapatet.fi", en: "Satisfaction guarantee — if the result doesn't match what was agreed, we'll redo it free of charge. Claims: info@puuhapatet.fi" },
                { emoji: "🔒", fi: "Vastuuvakuutettu — toiminnassamme aiheutuneet vahingot katetaan vastuuvakuutuksemme puitteissa", en: "Liability insured — damages caused during our work are covered under our liability insurance policy" },
                { emoji: "✓",  fi: "Selkeä hinnoittelu — ei piilokuluja", en: "Transparent pricing — no hidden costs" },
              ].map(p => `
              <tr>
                <td style="padding:4px 0;font-size:13px;color:#2a3a2a;line-height:1.5">${p.emoji} ${isEn ? p.en : p.fi}</td>
              </tr>`).join("")}
            </table>
          </td>
        </tr>
      </table>

      <!-- Validity note -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px">
        <tr>
          <td style="background:#fffbeb;border-radius:10px;padding:12px 18px;border-left:4px solid #f59e0b">
            <p style="margin:0;color:#78350f;font-size:13px;line-height:1.6">
              <strong>${isEn ? "Valid until" : "Voimassa"} ${validUntil}</strong>${isEn ? "" : " asti"}${isEn ? ". Confirm to reserve your slot." : ". Vahvista varmistaaksesi paikkasi."}
            </p>
          </td>
        </tr>
      </table>

      <!-- CTA -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:26px">
        <tr>
          <td style="text-align:center">
            <p style="color:#4a6a4a;font-size:14px;margin:0 0 16px;line-height:1.65">
              ${isTalo
                ? (isEn ? "Share this link with all residents — each can confirm their apartment directly." : "Jaa tämä linkki kaikille asukkaille — jokainen voi vahvistaa oman asuntonsa suoraan.")
                : (isEn ? "One click to confirm — we'll be in touch shortly." : "Yksi klikkaus riittää — olemme yhteydessä pikaisesti.")}
            </p>
            ${workerPhone
              ? `<a href="tel:${workerPhone}" style="display:inline-block;background:#3d6620;color:#ffffff;padding:12px 26px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;margin:4px">📞 ${isEn ? "Call us" : "Soita"} — ${workerPhone}</a>`
              : ""}
            <br>
            <a href="https://puuhapatet.fi/${quoteToken ? `tarjous/${quoteToken}` : "tilaus"}" style="display:inline-block;background:#2d5016;color:#ffffff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:800;font-size:15px;margin:8px 4px 4px;letter-spacing:0.3px">${isTalo ? (isEn ? "Open building quote →" : "Avaa taloyhtiötarjous →") : (isEn ? "View & accept quote →" : "Katso ja hyväksy tarjous →")}</a>
          </td>
        </tr>
      </table>

    </td>
  </tr>

  <!-- FOOTER -->
  <tr>
    <td style="background:#f0fdf4;border:1px solid #d1f0d8;border-top:none;border-radius:0 0 16px 16px;padding:16px 32px">
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:12px;color:#5a8a5a">
        <tr>
          <td style="vertical-align:top">
            <strong style="color:#1a2e1a">${workerName || "Puuhapatet"}</strong><br>
            ${workerPhone ? `${workerPhone}<br>` : ""}
            ${workerEmail ? `<a href="mailto:${workerEmail}" style="color:#5a8a5a;text-decoration:none">${workerEmail}</a>` : ""}
          </td>
          <td style="text-align:right;vertical-align:top">
            <strong style="color:#1a2e1a">Puuhapatet</strong><br>
            <a href="mailto:info@puuhapatet.fi" style="color:#5a8a5a;text-decoration:none">info@puuhapatet.fi</a><br>
            <a href="https://puuhapatet.fi" style="color:#5a8a5a;text-decoration:none">puuhapatet.fi</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>

</table>
</td></tr></table>
</body>
</html>`;

      const displayTotal = isTalo && unitCount
        ? `${Number(total).toFixed(0)} €/as. × ${unitCount} = ${(Number(total) * Number(unitCount)).toFixed(0)} €`
        : `${Number(total).toFixed(0)} €`;
      const subject = isEn
        ? `Your quote from Puuhapatet — ${isTalo && unitCount ? `${Number(total).toFixed(0)} €/unit × ${unitCount} = ${(Number(total) * Number(unitCount)).toFixed(0)} €` : `${Number(total).toFixed(0)} €`}`
        : `Tarjous ${quoteId} — ${displayTotal} (Puuhapatet)`;

      const result = await resend.emails.send({
        from: FROM_EMAIL,
        to,
        ...(bccArr?.length ? { bcc: bccArr } : {}),
        subject,
        html,
      });

      res.json({ ok: true, id: result.data?.id });
    } catch (e: any) {
      console.error("Quote email error:", e);
      res.status(500).json({ error: e.message || "Sähköpostin lähetys epäonnistui" });
    }
  });

  // ─── Public quote portal endpoints ──────────────────────────────────────────

  app.get("/api/quote/:token", async (req, res) => {
    try {
      const rows = await db
        .select({
          id:                 jobs.id,
          description:        jobs.description,
          agreedPrice:        jobs.agreedPrice,
          scheduledAt:        jobs.scheduledAt,
          quoteStatus:        jobs.quoteStatus,
          quoteVideoUrl:      jobs.quoteVideoUrl,
          suggestedTimes:     jobs.suggestedTimes,
          notes:              jobs.notes,
          isTaloyhtiio:       jobs.isTaloyhtiio,
          taloyhtiioApproved: jobs.taloyhtiioApproved,
          unitCount:          jobs.unitCount,
          propertyImageUrl:   jobs.propertyImageUrl,
          taloyhtiioName:     jobs.taloyhtiioName,
          unitResponses:      jobs.unitResponses,
          isYritys:           jobs.isYritys,
          boardContactName:   jobs.boardContactName,
          boardContactEmail:  jobs.boardContactEmail,
          boardContactPhone:  jobs.boardContactPhone,
          customerName:       customers.name,
          customerAddress:    customers.address,
        })
        .from(jobs)
        .innerJoin(customers, eq(jobs.customerId, customers.id))
        .where(eq(jobs.quoteToken, req.params.token));
      if (!rows.length) return res.status(404).json({ error: "Tarjousta ei löydy" });
      const row = rows[0];
      const quoteIdMatch = row.notes?.match(/T-PP-[A-Z0-9-]+/);
      const parsedSuggestedTimes: string[] = (() => { try { return row.suggestedTimes ? JSON.parse(row.suggestedTimes) : []; } catch { return []; } })();
      res.json({
        quoteId:            quoteIdMatch ? quoteIdMatch[0] : req.params.token,
        customerName:       row.customerName,
        customerAddress:    row.customerAddress,
        description:        row.description,
        agreedPriceCents:   row.agreedPrice,
        validUntil:         row.scheduledAt,
        scheduledAt:        row.scheduledAt ? (row.scheduledAt instanceof Date ? row.scheduledAt.toISOString() : row.scheduledAt) : null,
        suggestedTimes:     parsedSuggestedTimes,
        quoteStatus:        row.quoteStatus || "pending",
        quoteVideoUrl:      row.quoteVideoUrl,
        isTaloyhtiio:       row.isTaloyhtiio || false,
        taloyhtiioApproved: row.taloyhtiioApproved || false,
        unitCount:          row.unitCount ?? null,
        propertyImageUrl:   row.propertyImageUrl ?? null,
        taloyhtiioName:     row.taloyhtiioName ?? null,
        unitResponses:      (() => { try { return row.unitResponses ? JSON.parse(row.unitResponses) : []; } catch { return []; } })(),
        isYritys:           row.isYritys || false,
        boardContactName:   row.boardContactName ?? null,
        boardContactEmail:  row.boardContactEmail ?? null,
        boardContactPhone:  row.boardContactPhone ?? null,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/quote/:token/respond", async (req, res) => {
    try {
      const { status, suggestedTimes, customerMessage, unitResponse,
              boardContactName, boardContactEmail, boardContactPhone } = req.body;
      if (!status || !["accepted", "declined"].includes(status)) {
        return res.status(400).json({ error: "Virheellinen status" });
      }

      // Fetch current job to check for taloyhtiö and existing unit responses
      const [current] = await db
        .select({ unitResponses: jobs.unitResponses, isTaloyhtiio: jobs.isTaloyhtiio, description: jobs.description, agreedPrice: jobs.agreedPrice })
        .from(jobs)
        .where(eq(jobs.quoteToken, req.params.token));
      if (!current) return res.status(404).json({ error: "Ei löydy" });

      let newUnitResponses: string | null = null;
      const isUnitSubmission = !!(current.isTaloyhtiio && unitResponse);
      if (isUnitSubmission) {
        let existing: any[] = [];
        try { existing = current.unitResponses ? JSON.parse(current.unitResponses) : []; } catch { existing = []; }
        const sanitize = (s: unknown) => String(s ?? "").slice(0, 500);
        const safe = {
          unitId:       sanitize(unitResponse.unitId),
          unitName:     sanitize(unitResponse.unitName),
          status:       ["accepted", "declined"].includes(unitResponse.status) ? unitResponse.status : "declined",
          email:        unitResponse.email ? sanitize(unitResponse.email).slice(0, 200) : undefined,
          residentName: unitResponse.residentName ? sanitize(unitResponse.residentName).slice(0, 200) : undefined,
          times:        Array.isArray(unitResponse.times) ? unitResponse.times.slice(0, 3).map(sanitize) : [],
          message:      sanitize(unitResponse.message),
        };
        const idx = existing.findIndex((r: any) => r.unitId === safe.unitId);
        if (idx >= 0) existing[idx] = safe; else existing.push(safe);
        newUnitResponses = JSON.stringify(existing);
      }

      const updatePayload: Record<string, unknown> = {
        suggestedTimes:  suggestedTimes?.length ? JSON.stringify(suggestedTimes) : null,
        customerMessage: customerMessage || null,
        ...(newUnitResponses !== null ? { unitResponses: newUnitResponses } : {}),
        updatedAt:       new Date(),
      };
      // Only update quoteStatus for board-rep responses, not per-unit resident submissions
      if (!isUnitSubmission) {
        updatePayload.quoteStatus = status;
        // Auto-activate resident portal the moment the board rep approves — no separate admin step needed
        if (status === "accepted" && current.isTaloyhtiio) {
          updatePayload.taloyhtiioApproved = true;
        }
        // Save billing contact info provided by board rep
        const sanitize = (s: unknown) => s ? String(s).slice(0, 200) : null;
        if (boardContactName)  updatePayload.boardContactName  = sanitize(boardContactName);
        if (boardContactEmail) updatePayload.boardContactEmail = sanitize(boardContactEmail);
        if (boardContactPhone) updatePayload.boardContactPhone = sanitize(boardContactPhone);
      }

      const [updated] = await db
        .update(jobs)
        .set(updatePayload as any)
        .where(eq(jobs.quoteToken, req.params.token))
        .returning();
      if (!updated) return res.status(404).json({ error: "Ei löydy" });

      if (resend) {
        const fmtTime = (t: string) => {
          const [dp = "", tp = ""] = t.split("T");
          const [y, mo, d] = dp.split("-");
          const [hh, mm] = tp.split(":");
          return `${d}.${mo}.${y} klo ${hh}:${mm}`;
        };
        let timesHtml = "";
        let unitHtml = "";
        if (unitResponse) {
          const esc = (s: string) => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
          const unitTimes = (unitResponse.times as string[] || []).filter(Boolean).map(fmtTime).join("<br>");
          unitHtml = `<p><strong>${esc(String(unitResponse.unitName || ""))}: </strong> ${unitTimes || "Ei aikaehdotusta"}</p>`;
          if (unitResponse.message) unitHtml += `<p><em>${esc(String(unitResponse.message))}</em></p>`;
        } else if (suggestedTimes?.length) {
          timesHtml = `<p><strong>Ehdotetut ajat:</strong><br>${(suggestedTimes as string[]).filter(Boolean).map(fmtTime).join("<br>")}</p>`;
        }
        const msgHtml = customerMessage ? `<p><strong>Viesti:</strong><br>${(customerMessage as string).replace(/\n/g, "<br>")}</p>` : "";
        await resend.emails.send({
          from: FROM_EMAIL,
          to: WORKER_NOTIFICATION_EMAILS,
          subject: `Tarjous ${status === "accepted" ? "hyväksytty ✓" : "hylätty"} — ${updated.description?.slice(0, 50)}`,
          html: `<div style="font-family:sans-serif;max-width:500px;margin:auto;padding:24px">
            <h2 style="color:#2d5016">Tarjous ${status === "accepted" ? "hyväksytty ✓" : "hylätty"}</h2>
            <p><strong>Palvelu:</strong> ${updated.description}</p>
            <p><strong>Hinta:</strong> ${((updated.agreedPrice ?? 0) / 100).toFixed(0)} €</p>
            ${unitHtml}${timesHtml}${msgHtml}
            <hr>
            <p style="color:#888;font-size:12px">Puuhapatet Admin</p>
          </div>`,
        });
      }
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Approve a taloyhtiö quote for resident sharing
  app.patch("/api/jobs/:id/taloyhtiio-approve", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { approved } = req.body;
      await db.update(jobs).set({ taloyhtiioApproved: !!approved, updatedAt: new Date() }).where(eq(jobs.id, id));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Notify taloyhtiö residents of confirmed scheduled time ──────────────────

  app.post("/api/jobs/:id/notify-residents", async (req, res) => {
    if (!resend) return res.status(503).json({ error: "Sähköpostipalvelu ei käytössä" });
    try {
      const id = Number(req.params.id);
      const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
      if (!job) return res.status(404).json({ error: "Keikkaa ei löydy" });
      if (!job.scheduledAt) return res.status(400).json({ error: "Ajankohta ei asetettu" });

      const dateStr = new Date(job.scheduledAt).toLocaleDateString("fi-FI", {
        weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
      });
      // For taloyhtiö gigs agreedPrice is already the per-apartment price.
      const unitPriceCents = job.agreedPrice ?? 0;
      const unitPriceEur = (unitPriceCents / 100).toLocaleString("fi-FI", { style: "currency", currency: "EUR" });

      let accepted: Array<{ unitName: string; email?: string }> = [];
      try { accepted = JSON.parse(job.unitResponses ?? "[]"); } catch {}
      const residentsWithEmail = accepted.filter(r => r.email);

      const emailList: { to: string; name: string }[] = [];
      if (job.boardContactEmail) emailList.push({ to: job.boardContactEmail, name: job.boardContactName ?? "Hallituksen edustaja" });
      for (const r of residentsWithEmail) {
        if (r.email && !emailList.find(e => e.to === r.email))
          emailList.push({ to: r.email, name: r.unitName });
      }

      if (emailList.length === 0) return res.status(400).json({ error: "Ei sähköpostiosoitteita" });

      const html = (name: string) => `
        <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px">
          <h2 style="color:#2d5016;margin:0 0 8px">Ikkunanpesu vahvistettu ✓</h2>
          <p style="color:#555;margin:0 0 20px">Hei${name ? ` ${name}` : ""}! Palvelun ajankohta on nyt vahvistettu.</p>
          <div style="background:#f0fdf4;border-radius:12px;padding:20px;margin-bottom:20px;border:1px solid #bbf7d0">
            <p style="margin:0 0 6px"><strong>Palvelu:</strong> ${job.description ?? "Ikkunanpesu"}</p>
            <p style="margin:0 0 6px"><strong>Ajankohta:</strong> ${dateStr}</p>
            ${job.unitCount && job.unitCount > 1 ? `<p style="margin:0"><strong>Hinta per asunto:</strong> ${unitPriceEur}</p>` : ""}
          </div>
          <p style="color:#888;font-size:13px">Ole kotona sovittuna aikana tai jätä tarvittavat ohjeet etukäteen. Lisätietoja: info@puuhapatet.fi</p>
          <p style="color:#888;font-size:12px;margin-top:16px">Puuhapatet — ikkunanpesu & kotitalouspalvelut</p>
        </div>`;

      let sent = 0;
      for (const { to, name } of emailList) {
        try {
          await resend.emails.send({ from: FROM_EMAIL, to, subject: `Ajankohta vahvistettu — ${dateStr}`, html: html(name) });
          sent++;
        } catch { /* continue even if one fails */ }
      }
      res.json({ ok: true, sent });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Admin user passwords (cross-device, hashed) ────────────────────────────
  // Admin-only (behind the auth gate). The old GET endpoint that returned the
  // stored password has been removed — login now happens server-side, so the
  // client never needs to read a password back.

  app.post("/api/admin/user-password/:userId", async (req, res) => {
    try {
      const userId = req.params.userId;
      const { password, currentPassword } = req.body ?? {};
      if (!password || String(password).length < 4) {
        return res.status(400).json({ error: "Liian lyhyt salasana (väh. 4 merkkiä)." });
      }
      // A logged-in admin may only change their OWN password here.
      const caller = (req as any).admin as AdminTokenPayload | undefined;
      if (caller && caller.sub !== userId) {
        return res.status(403).json({ error: "Voit vaihtaa vain oman salasanasi." });
      }
      const [existing] = await db.select().from(users).where(eq(users.username, userId));
      // Verify the current password (legacy plaintext, scrypt, or the one-time default).
      const stored = existing?.passwordHash || "";
      const currentOk = stored
        ? verifyPassword(String(currentPassword || ""), stored)
        : (!ADMIN_DEFAULT_PASSWORD || String(currentPassword || "") === ADMIN_DEFAULT_PASSWORD);
      if (!currentOk) {
        return res.status(401).json({ error: "Nykyinen salasana on väärin." });
      }
      const newHash = hashPassword(String(password));
      if (existing) {
        await db.update(users).set({ passwordHash: newHash }).where(eq(users.username, userId));
      } else {
        await db.insert(users).values({ name: userId, username: userId, passwordHash: newHash, role: "staff" });
      }
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Member agreement (signed inside the admin, cross-device) ───────────────

  app.get("/api/admin/member-agreement/:userId", async (req, res) => {
    // Soft-fail (no 500) so the client can fall back to its local cache, e.g.
    // before the member_agreement column has been migrated.
    try {
      const [row] = await db.select({ ma: users.memberAgreement }).from(users).where(eq(users.username, req.params.userId));
      let signature = null;
      try { signature = row?.ma ? JSON.parse(row.ma) : null; } catch { signature = null; }
      res.json({ ok: true, signature });
    } catch {
      res.json({ ok: true, signature: null });
    }
  });

  app.post("/api/admin/member-agreement/:userId", async (req, res) => {
    const userId = req.params.userId;
    const sig = sanitizeMemberSignature({ ...req.body, userId });
    if (!sig) return res.status(400).json({ error: "Allekirjoitus tai vaaditut tiedot puuttuvat" });
    sig.ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
      || req.socket?.remoteAddress || sig.ip;
    sig.userAgent = req.headers["user-agent"] ? String(req.headers["user-agent"]) : sig.userAgent;
    try {
      const json = JSON.stringify(sig);
      const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.username, userId));
      if (existing) {
        await db.update(users).set({ memberAgreement: json }).where(eq(users.username, userId));
      } else {
        await db.insert(users).values({
          name: sig.snapshot.name || userId,
          username: userId,
          passwordHash: "",
          role: sig.snapshot.role === "HOST" ? "host" : "staff",
          memberAgreement: json,
        });
      }
      res.json({ ok: true, signature: sig, persisted: true });
    } catch (e: any) {
      // Don't lock members out if server persistence isn't available yet
      // (e.g. column not migrated) — the client keeps a local copy.
      console.error("member-agreement persist failed:", e?.message);
      res.json({ ok: true, signature: sig, persisted: false });
    }
  });

  // ─── Customer job count (for returning customer check) ──────────────────────

  app.get("/api/customers/:id/job-count", async (req, res) => {
    try {
      const [result] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(jobs)
        .where(eq(jobs.customerId, Number(req.params.id)));
      res.json({ count: result?.count ?? 0 });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Worker invite to job ─────────────────────────────────────────────────────

  // Known workers (for email lookup — mirrors client admin-profile.ts)
  const WORKER_INFO: Record<string, { name: string; email: string | null }> = {
    joonatan: { name: process.env.WORKER_JOONATAN_NAME || "Joonatan Juuri",  email: process.env.WORKER_JOONATAN_EMAIL || "joonatan@puuhapatet.fi" },
    matias:   { name: process.env.WORKER_MATIAS_NAME  || "Matias Pitkänen", email: process.env.WORKER_MATIAS_EMAIL  || "matias@puuhapatet.fi" },
    petrus:   { name: "Petrus Aalto",      email: process.env.WORKER_PETRUS_EMAIL || "petrus.aalto@icloud.com" },
    oona:     { name: "Oona",              email: process.env.WORKER_OONA_EMAIL   || null },
  };

  // POST /api/jobs/:id/invite — add a worker to pendingWorkers, send email invite
  app.post("/api/jobs/:id/invite", async (req, res) => {
    try {
      const jobId = Number(req.params.id);
      const { invitedUserId, inviterName, note } = req.body as {
        invitedUserId: string;
        inviterName?: string;
        note?: string;
      };
      if (!invitedUserId) return res.status(400).json({ error: "invitedUserId puuttuu" });

      const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
      if (!job) return res.status(404).json({ error: "Keikkaa ei löydy" });

      // Add to pendingWorkers (avoid duplicates)
      const current = (job.pendingWorkers ?? "").split(",").map(s => s.trim()).filter(Boolean);
      if (!current.includes(invitedUserId)) current.push(invitedUserId);
      const [updated] = await db
        .update(jobs)
        .set({ pendingWorkers: current.join(","), updatedAt: new Date() })
        .where(eq(jobs.id, jobId))
        .returning();

      // Send email notification if we have an email for this worker
      const workerInfo = WORKER_INFO[invitedUserId];
      if (resend && workerInfo?.email) {
        const cust = await db.select().from(customers).where(eq(customers.id, job.customerId)).limit(1);
        const customerName = cust[0]?.name ?? "Asiakas";
        const dateStr = job.scheduledAt
          ? new Date(job.scheduledAt).toLocaleDateString("fi-FI", { weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })
          : "Aika ei vielä vahvistettu";

        await resend.emails.send({
          from: FROM_EMAIL,
          to: workerInfo.email,
          subject: `Keikkakutsu: ${customerName} — ${dateStr}`,
          html: `
            <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
              <h2 style="margin:0 0 8px">Keikkakutsu 📋</h2>
              <p style="color:#666;margin:0 0 20px">Sinulle on lähetetty kutsu keikalle</p>
              <div style="background:#f5f5f5;border-radius:12px;padding:20px;margin-bottom:20px">
                <p style="margin:0 0 6px"><strong>Asiakas:</strong> ${customerName}</p>
                <p style="margin:0 0 6px"><strong>Ajankohta:</strong> ${dateStr}</p>
                <p style="margin:0 0 6px"><strong>Palvelu:</strong> ${job.description}</p>
                ${note ? `<p style="margin:12px 0 0;color:#555;font-style:italic">"${note}"</p>` : ""}
              </div>
              <p style="color:#888;font-size:13px">Kirjaudu Puuhapatet Admin -sovellukseen hyväksyäksesi tai hylätäksesi kutsu. Vastaa 4 tunnin sisällä.</p>
              <p style="color:#888;font-size:13px">Lähettäjä: ${inviterName ?? "Puuhapatet"}</p>
            </div>
          `,
        });
      }

      res.json({ ok: true, job: updated });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/jobs/:id/invite-respond — accept or decline a pending invite
  app.post("/api/jobs/:id/invite-respond", async (req, res) => {
    try {
      const jobId = Number(req.params.id);
      const { userId, accept } = req.body as { userId: string; accept: boolean };
      if (!userId) return res.status(400).json({ error: "userId puuttuu" });

      const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
      if (!job) return res.status(404).json({ error: "Keikkaa ei löydy" });

      // Remove from pending
      const pending = (job.pendingWorkers ?? "").split(",").map(s => s.trim()).filter(s => s && s !== userId);

      let newAssignedTo = job.assignedTo;
      if (accept) {
        // Add to assignedTo
        const assigned = (job.assignedTo ?? "").split(",").map(s => s.trim()).filter(Boolean);
        if (!assigned.includes(userId)) assigned.push(userId);
        newAssignedTo = assigned.join(",");
      }

      const [updated] = await db
        .update(jobs)
        .set({
          pendingWorkers: pending.length > 0 ? pending.join(",") : null,
          assignedTo: newAssignedTo,
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, jobId))
        .returning();

      res.json({ ok: true, job: updated });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Door-to-door marketer: capture leads + founder triage ───────────────────
  // A marketer (or founder) captures a lead in the field. Creates customer + job
  // (status "lead", submissionStatus "pending_review") for the founders to
  // accept → workers / take themselves / decline. submittedBy = logged-in user.
  app.post("/api/marketer/leads", async (req, res) => {
    try {
      const sub = String((req as any).admin?.sub ?? "").toLowerCase();
      if (!sub) return res.status(403).json({ error: "Kirjautuminen vaaditaan." });
      const { name, phone, address, email, description, priceCents, notes } = req.body ?? {};
      const custName = String(name ?? "").trim();
      if (!custName || !String(phone ?? "").trim()) {
        return res.status(400).json({ error: "Asiakkaan nimi ja puhelin vaaditaan." });
      }
      const today = new Date().toLocaleDateString("fi-FI");
      const [newCustomer] = await db.insert(customers).values({
        name: custName.slice(0, 200),
        phone: String(phone).slice(0, 60),
        email: email ? String(email).slice(0, 200) : null,
        address: String(address ?? "—").slice(0, 300),
        notes: `[Myyjän keräämä liidi ${today} · ${sub}]`,
        ownedBy: sub,
      }).returning();
      const price = Math.max(0, Math.round(Number(priceCents) || 0));
      // Shareable offer link: give the lead a quote token so it renders at
      // /tarjous/<token> and the customer can view (and accept) the price.
      const quoteToken = randomUUID().replace(/-/g, "").slice(0, 16);
      const [newJob] = await db.insert(jobs).values({
        customerId: newCustomer.id,
        description: (String(description ?? "").trim() || "Ikkunanpesu (myyjän liidi)").slice(0, 500),
        agreedPrice: price,
        status: "lead",
        submittedBy: sub,
        submissionStatus: "pending_review",
        marketerId: sub,
        quoteToken,
        quoteStatus: price > 0 ? "pending" : null,
        notes: notes ? `[${today}] ${String(notes).slice(0, 400)}` : null,
      }).returning();
      res.json({ ok: true, job: newJob, customer: newCustomer, quoteToken });
    } catch (e: any) {
      console.error("Marketer lead error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/marketer/leads — leads I submitted (founders see everyone's).
  app.get("/api/marketer/leads", async (req, res) => {
    try {
      const admin = (req as any).admin as AdminTokenPayload | undefined;
      const sub = String(admin?.sub ?? "").toLowerCase();
      const isHost = admin?.role === "host";
      if (!sub) return res.status(403).json({ error: "Kirjautuminen vaaditaan." });
      const rows = await db.select().from(jobs)
        .where(isHost ? isNotNull(jobs.submittedBy) : eq(jobs.submittedBy, sub))
        .orderBy(desc(jobs.updatedAt)).limit(200);
      const custIds = Array.from(new Set(rows.map(r => r.customerId)));
      const custs = custIds.length ? await db.select().from(customers).where(inArray(customers.id, custIds)) : [];
      const custById = new Map(custs.map(c => [c.id, c]));
      const out = rows.map(j => {
        const c = custById.get(j.customerId);
        return {
          id: j.id, status: j.status, submissionStatus: j.submissionStatus,
          description: j.description, agreedPrice: j.agreedPrice,
          marketerId: j.marketerId, marketerCommissionCents: j.marketerCommissionCents,
          submittedBy: j.submittedBy, createdAt: j.createdAt,
          quoteToken: j.quoteToken, quoteStatus: j.quoteStatus,
          customer: c ? { name: c.name, address: c.address, phone: c.phone } : null,
        };
      });
      res.json(out);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/jobs/:id/triage — founder accepts/takes/declines a marketer lead.
  // accept_workers: approve (founders then invite workers via the normal flow).
  // take_self: approve + assign to the founder + schedule.
  // decline: reject (kept for the marketer's stats). Commission is snapshotted
  // on approval (flat €/deal) so it's locked even if rates change later.
  app.post("/api/jobs/:id/triage", async (req, res) => {
    try {
      const admin = (req as any).admin as AdminTokenPayload | undefined;
      if (admin?.role !== "host") return res.status(403).json({ error: "Vain perustaja voi käsitellä liidejä." });
      const jobId = Number(req.params.id);
      const action = String(req.body?.action ?? "");
      const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
      if (!job) return res.status(404).json({ error: "Keikkaa ei löydy." });
      if (job.submissionStatus !== "pending_review") return res.status(400).json({ error: "Liidi ei ole enää tarkistettavana." });

      // Progressive, uncapped commission on the FINAL deal value (so discounts to
      // close reduce it, and bigger gigs pay more). effectiveJobTotal handles
      // taloyhtiö gigs where agreedPrice is per-apartment. Snapshotted here so
      // it's locked in even if the rate changes later.
      const marketer = (job.marketerId || job.submittedBy || "").toLowerCase();
      const commission = marketer ? marketerCommissionCents(effectiveJobTotal(job)) : 0;
      const updates: any = { updatedAt: new Date() };

      if (action === "decline") {
        updates.submissionStatus = "rejected";
      } else if (action === "take_self") {
        updates.submissionStatus = "approved";
        updates.marketerCommissionCents = commission;
        const me = String(admin?.sub ?? "");
        const assigned = (job.assignedTo ?? "").split(",").map(s => s.trim()).filter(Boolean);
        if (me && !assigned.includes(me)) assigned.push(me);
        updates.assignedTo = assigned.join(",") || null;
        updates.status = "scheduled";
      } else if (action === "accept_workers") {
        updates.submissionStatus = "approved";
        updates.marketerCommissionCents = commission;
        // Stays a "lead" so founders can invite workers via the existing flow.
      } else {
        return res.status(400).json({ error: "Tuntematon toimenpide." });
      }
      const [updated] = await db.update(jobs).set(updates).where(eq(jobs.id, jobId)).returning();
      res.json({ ok: true, job: updated });
    } catch (e: any) {
      console.error("Triage error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Public booking contact form ─────────────────────────────────────────────
  app.post("/api/contact", async (req, res) => {
    try {
      const { name, phone, email, address, urgency, message, coupon } = req.body;
      if (!name || !phone || !message) {
        return res.status(400).json({ error: "Nimi, puhelin ja viesti ovat pakollisia." });
      }
      const urgencyLabel = urgency === "this_week" ? "Tällä viikolla" : urgency === "flexible" ? "Ei kiireellinen" : "—";

      const html = `<!DOCTYPE html>
<html lang="fi">
<head><meta charset="UTF-8" /><title>Uusi yhteydenotto</title></head>
<body style="margin:0;padding:0;background:#f4f9ec;font-family:-apple-system,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f9ec;padding:40px 20px">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #dde9c4">
        <tr>
          <td style="background:#2d5016;padding:28px 36px">
            <p style="margin:0;color:#b8e07a;font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase">Puuhapatet.fi</p>
            <h1 style="margin:6px 0 0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px">Uusi yhteydenotto &#x1F4CB;</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 36px">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="padding-bottom:16px;border-bottom:1px solid #eee">
                <p style="margin:0 0 3px;color:#888;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">Asiakas</p>
                <p style="margin:0;font-size:16px;font-weight:600;color:#1a2e0a">${name}</p>
                <p style="margin:3px 0 0;font-size:14px"><a href="tel:${phone}" style="color:#2d5016;text-decoration:none">${phone}</a></p>
                ${email ? `<p style="margin:3px 0 0;font-size:14px"><a href="mailto:${email}" style="color:#2d5016;text-decoration:none">${email}</a></p>` : ""}
              </td></tr>
              <tr><td style="padding:16px 0;border-bottom:1px solid #eee">
                <p style="margin:0 0 3px;color:#888;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">Alue / Osoite</p>
                <p style="margin:0;font-size:15px;color:#1a2e0a">${address || "—"}</p>
              </td></tr>
              <tr><td style="padding:16px 0;border-bottom:1px solid #eee">
                <p style="margin:0 0 3px;color:#888;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">Kiireellisyys</p>
                <p style="margin:0;font-size:15px;color:#1a2e0a">${urgencyLabel}</p>
              </td></tr>
              <tr><td style="padding:16px 0${coupon ? ";border-bottom:1px solid #eee" : ""}">
                <p style="margin:0 0 8px;color:#888;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">Viesti</p>
                <p style="margin:0;font-size:15px;color:#333;line-height:1.6;white-space:pre-wrap">${message.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
              </td></tr>
              ${coupon ? `<tr><td style="padding:16px 0"><p style="margin:0 0 3px;color:#888;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">Alennuskoodi</p><p style="margin:0;font-size:15px;font-weight:600;color:#2d5016">${coupon}</p></td></tr>` : ""}
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:#f4f9ec;padding:16px 36px;border-top:1px solid #dde9c4">
            <p style="margin:0;color:#6b8f3a;font-size:12px">Puuhapatet.fi &middot; ${new Date().toLocaleString("fi-FI")}</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

      if (!resend) {
        return res.status(503).json({ error: "Sähköpostipalvelu ei käytössä — aseta RESEND_API_KEY ympäristömuuttuja." });
      }
      await resend.emails.send({
        from: FROM_EMAIL,
        to: [ADMIN_EMAIL],
        replyTo: email || undefined,
        subject: `Yhteydenotto: ${name} — ${urgencyLabel}`,
        html,
      });

      // Best-effort confirmation to the customer so the sender gets certainty
      // the request went through. Never let this fail the request — the admin
      // notification above is what actually matters for catching the lead.
      if (email) {
        const confirmHtml = `<!DOCTYPE html>
<html lang="fi">
<head><meta charset="UTF-8" /><title>Kiitos yhteydenotosta</title></head>
<body style="margin:0;padding:0;background:#f4f9ec;font-family:-apple-system,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f9ec;padding:40px 20px">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #dde9c4">
        <tr>
          <td style="background:#2d5016;padding:28px 36px">
            <p style="margin:0;color:#b8e07a;font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase">Puuhapatet.fi</p>
            <h1 style="margin:6px 0 0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px">Kiitos yhteydenotosta! &#x1F44B;</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 36px">
            <p style="margin:0 0 16px;font-size:16px;color:#1a2e0a">Hei ${name},</p>
            <p style="margin:0 0 16px;font-size:15px;color:#333;line-height:1.6">Kiitos viestistäsi! Olemme vastaanottaneet yhteydenottosi ja palaamme asiaan pian — tyypillisesti saman päivän aikana.</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;background:#f4f9ec;border-radius:12px">
              <tr><td style="padding:16px 20px">
                <p style="margin:0 0 6px;color:#888;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">Viestisi</p>
                <p style="margin:0;font-size:14px;color:#333;line-height:1.6;white-space:pre-wrap">${message.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
              </td></tr>
            </table>
            <p style="margin:18px 0 0;font-size:14px;color:#555;line-height:1.6">Jos asiasi on kiireellinen, soita meille suoraan: <a href="tel:+358400389999" style="color:#2d5016;text-decoration:none;font-weight:600">0400 389 999</a>.</p>
          </td>
        </tr>
        <tr>
          <td style="background:#f4f9ec;padding:16px 36px;border-top:1px solid #dde9c4">
            <p style="margin:0;color:#6b8f3a;font-size:12px">Puuhapatet.fi &middot; ${new Date().toLocaleString("fi-FI")}</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
        try {
          await resend.emails.send({
            from: FROM_EMAIL,
            to: [email],
            replyTo: ADMIN_EMAIL,
            subject: "Kiitos yhteydenotostasi — Puuhapatet.fi",
            html: confirmHtml,
          });
        } catch (confirmErr) {
          console.error("Contact confirmation email failed (non-fatal):", confirmErr);
        }
      }

      res.json({ ok: true });
    } catch (e: any) {
      console.error("Contact form error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Puuhapatet IT — contact form ────────────────────────────────────────────
  app.post("/api/it-contact", async (req, res) => {
    try {
      const { name, email, phone, company, service, currentSite, message } = req.body;
      if (!name || !email || !message) {
        return res.status(400).json({ error: "Nimi, sähköposti ja viesti ovat pakollisia." });
      }
      const serviceLabels: Record<string, string> = {
        website:  "Uusi verkkosivusto",
        cv:       "CV tai henkilökohtainen sivu",
        redesign: "Olemassa olevan sivuston uudistus",
        seo:      "Hakukonenäkyvyys",
        hosting:  "Hosting ja ylläpito",
        erp:      "Hallintaratkaisu tai CRM",
        other:    "Jotain muuta",
      };
      const serviceLabel = serviceLabels[service] || service || "Ei määritelty";

      const html = `
<!DOCTYPE html>
<html lang="fi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Uusi IT-yhteydenotto</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Inter,-apple-system,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#111111;border-radius:16px;overflow:hidden;border:1px solid #222">
        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#6a4cf5,#d44df0);padding:32px 40px">
            <p style="margin:0;color:rgba(255,255,255,0.7);font-size:12px;font-weight:500;letter-spacing:1px;text-transform:uppercase">Puuhapatet IT</p>
            <h1 style="margin:8px 0 0;color:#ffffff;font-size:28px;font-weight:700;letter-spacing:-1px;line-height:1.1">Uusi yhteydenotto 🚀</h1>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px 40px">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding-bottom:20px;border-bottom:1px solid #222">
                  <p style="margin:0 0 4px;color:#666;font-size:12px;text-transform:uppercase;letter-spacing:0.5px">Palvelu</p>
                  <p style="margin:0;color:#ffffff;font-size:16px;font-weight:600">${serviceLabel}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:20px 0;border-bottom:1px solid #222">
                  <p style="margin:0 0 4px;color:#666;font-size:12px;text-transform:uppercase;letter-spacing:0.5px">Asiakas</p>
                  <p style="margin:0;color:#ffffff;font-size:16px;font-weight:600">${name}${company ? ` — ${company}` : ""}</p>
                  <p style="margin:4px 0 0;color:#0099ff;font-size:14px"><a href="mailto:${email}" style="color:#0099ff;text-decoration:none">${email}</a></p>
                  ${phone ? `<p style="margin:4px 0 0;color:#999;font-size:14px">${phone}</p>` : ""}
                  ${currentSite ? `<p style="margin:4px 0 0;color:#999;font-size:14px">Nykyinen sivu: <a href="${currentSite.startsWith('http') ? currentSite : 'https://'+currentSite}" style="color:#0099ff;text-decoration:none">${currentSite}</a></p>` : ""}
                </td>
              </tr>
              <tr>
                <td style="padding:20px 0">
                  <p style="margin:0 0 12px;color:#666;font-size:12px;text-transform:uppercase;letter-spacing:0.5px">Viesti</p>
                  <p style="margin:0;color:#cccccc;font-size:15px;line-height:1.6;white-space:pre-wrap">${message.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#0d0d0d;padding:20px 40px;border-top:1px solid #1a1a1a">
            <p style="margin:0;color:#444;font-size:12px">Puuhapatet IT · puuhapatet.fi/it · ${new Date().toLocaleString("fi-FI")}</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

      if (!resend) {
        return res.status(503).json({ error: "Sähköpostipalvelu ei käytössä — aseta RESEND_API_KEY ympäristömuuttuja." });
      }
      await resend.emails.send({
        from: FROM_EMAIL,
        to: [ADMIN_EMAIL],
        replyTo: email,
        subject: `IT-yhteydenotto: ${name}${company ? ` (${company})` : ""} — ${serviceLabel}`,
        html,
      });

      res.json({ ok: true });
    } catch (e: any) {
      console.error("IT contact error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Custom gig (cap-pricing) endpoints ──────────────────────────────────────

  function parseGig(raw: string | null): GigData | null {
    if (!raw) return null;
    try { return sanitizeGigData(JSON.parse(raw)); } catch { return null; }
  }

  // Public, read-only live view for the customer (shareable link).
  app.get("/api/gig/:token", async (req, res) => {
    try {
      const [row] = await db
        .select({ job: jobs, customer: customers })
        .from(jobs)
        .innerJoin(customers, eq(jobs.customerId, customers.id))
        .where(eq(jobs.quoteToken, req.params.token));
      if (!row || !row.job.isCustomGig) return res.status(404).json({ error: "Seurantaa ei löydy" });
      const gig = parseGig(row.job.gigData);
      if (!gig) return res.status(404).json({ error: "Seurantaa ei löydy" });
      const totals = computeTotals(gig);
      // Read-only floor-plan map data for the customer view (white, no controls).
      // Lives in projectData; we expose only the dot positions + statuses so the
      // customer can watch washed windows update live. No worker ids, no rates.
      const proj = parseProject(row.job.projectData ?? null);
      const map = proj && proj.building?.planBase ? {
        building: { name: proj.building.name ?? null, address: proj.building.address ?? null, floors: proj.building.floors, planBase: proj.building.planBase },
        marks: proj.marks,
        statuses: proj.statuses,
        customMarks: proj.customMarks,
        posOverrides: proj.posOverrides,
        deleted: proj.deleted,
        // Navigation markers + the live "work happening here now" highlight so the
        // customer can see ladders/entrances/hazards and where work is in progress.
        notes: proj.notes ?? {},
        // Per-window observations the workers left (text + optional photo) — shown
        // as small dismissible popups on the customer map.
        observations: proj.observations ?? {},
        activeZone: proj.activeZone ?? null,
      } : null;
      // Only expose what the customer is meant to see — no internal billing notes.
      res.json({
        contractId: gig.contractId ?? null,
        companyName: gig.company?.name ?? row.customer.name,
        description: row.job.description,
        currency: gig.currency,
        vatNote: gig.vatNote ?? null,
        customerNote: gig.customerNote ?? null,
        sectors: gig.sectors.map((s) => ({
          id: s.id, name: s.name, color: s.color, unitLabel: s.unitLabel,
          total: s.total, unitPriceCents: s.unitPriceCents, washed: s.washed, skipped: s.skipped,
        })),
        totals,
        updatedAt: gig.updatedAt,
        invoicedCents: gig.invoicedCents,
        paymentsCount: gig.payments.length,
        isFixedDeal: !!(proj && fixedDealFor(proj)),
        // Read-only floor-plan map (null if the gig has no plan).
        map,
        // Contract & signing gate — the live view opens only after the customer signs.
        contractText: gig.contractText ?? null,
        requireSignature: signatureRequired(gig),
        status: gigStatus(gig),
        signed: !!gig.signature?.signedAt,
        signedAt: gig.signature?.signedAt ?? null,
        signerName: gig.signature?.signerName ?? null,
        approved: !!gig.approval?.approvedAt,
        approvedAt: gig.approval?.approvedAt ?? null,
        // Signed details for the customer's own downloadable copy (no ip/ua).
        signature: gig.signature ? {
          signerName: gig.signature.signerName,
          place: gig.signature.place ?? null,
          signedAt: gig.signature.signedAt,
          customer: gig.signature.customer,
          signatureDataUrl: gig.signature.signatureDataUrl,
        } : null,
        // Prefill the pre-questionnaire with what we already know about the customer.
        company: {
          name: gig.company?.name ?? row.customer.name ?? null,
          businessId: gig.company?.businessId ?? null,
          email: gig.company?.email ?? row.customer.email ?? null,
          contact: gig.company?.contact ?? null,
          address: gig.company?.address ?? gig.company?.billing ?? null,
        },
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Public: the customer signs the contract from the live link. The intro is
  // the signing — only after this does the live tracking view open.
  app.post("/api/gig/:token/sign", async (req, res) => {
    try {
      const [row] = await db
        .select({ job: jobs, customer: customers })
        .from(jobs)
        .innerJoin(customers, eq(jobs.customerId, customers.id))
        .where(eq(jobs.quoteToken, req.params.token));
      if (!row || !row.job.isCustomGig) return res.status(404).json({ error: "Seurantaa ei löydy" });
      const gig = parseGig(row.job.gigData);
      if (!gig) return res.status(404).json({ error: "Seurantaa ei löydy" });
      if (gig.signature?.signedAt) {
        return res.status(409).json({ error: "Sopimus on jo allekirjoitettu", signedAt: gig.signature.signedAt });
      }

      const b = (req.body ?? {}) as Record<string, any>;
      const cust = (b.customer ?? {}) as Record<string, any>;
      const legalName = String(cust.legalName ?? "").trim();
      const signerName = String(b.signerName ?? "").trim();
      const signatureDataUrl = String(b.signatureDataUrl ?? "");
      if (!legalName) return res.status(400).json({ error: "Tilaajan virallinen nimi puuttuu" });
      if (!signerName) return res.status(400).json({ error: "Allekirjoittajan nimi puuttuu" });
      if (!signatureDataUrl.startsWith("data:image/")) return res.status(400).json({ error: "Allekirjoitus puuttuu" });

      const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
        || req.socket?.remoteAddress || undefined;

      gig.signature = {
        signedAt: Date.now(),
        signerName,
        signerTitle: b.signerTitle ? String(b.signerTitle) : undefined,
        place: b.place ? String(b.place) : undefined,
        option: b.option ? String(b.option) : undefined,
        acceptedSectorIds: Array.isArray(b.acceptedSectorIds) ? b.acceptedSectorIds.map(String) : undefined,
        customer: {
          legalName,
          businessId: cust.businessId ? String(cust.businessId) : undefined,
          billingAddress: cust.billingAddress ? String(cust.billingAddress) : undefined,
          eInvoice: cust.eInvoice ? String(cust.eInvoice) : undefined,
          contactPerson: cust.contactPerson ? String(cust.contactPerson) : undefined,
        },
        signatureDataUrl,
        ip,
        userAgent: req.headers["user-agent"] ? String(req.headers["user-agent"]) : undefined,
      };
      // Fill any missing company fields from the signed details so invoicing benefits.
      gig.company = {
        ...gig.company,
        name: gig.company?.name || legalName,
        businessId: gig.company?.businessId || gig.signature.customer.businessId,
        email: gig.company?.email || gig.signature.customer.eInvoice,
        contact: gig.company?.contact || gig.signature.customer.contactPerson,
        billing: gig.company?.billing || gig.signature.customer.billingAddress,
      };
      gig.log.push({ t: Date.now(), text: `Sopimus allekirjoitettu sähköisesti: ${signerName}${gig.signature.signerTitle ? `, ${gig.signature.signerTitle}` : ""} — tilaajan ${legalName} puolesta` });
      gig.updatedAt = Date.now();

      const clean = sanitizeGigData(gig);
      await db.update(jobs).set({ gigData: JSON.stringify(clean), updatedAt: new Date() }).where(eq(jobs.id, row.job.id));

      // Best-effort notifications — never block the signing response on email.
      if (resend) {
        const cid = clean.contractId || "sopimus";
        const teamTo = Array.from(new Set([ADMIN_EMAIL, ...WORKER_NOTIFICATION_EMAILS])).filter(Boolean);
        const liveUrl = `https://puuhapatet.fi/seuranta/${req.params.token}`;
        const wrap = (inner: string) => `<div style="font-family:'Poppins',system-ui,sans-serif;max-width:560px;margin:0 auto;background:#fff;border:1px solid #E4E1D7;border-radius:14px;overflow:hidden">
          <div style="padding:22px 26px;border-bottom:1px solid #E4E1D7"><p style="margin:0;font-size:18px;font-weight:700">Puuhapatet</p></div>
          <div style="padding:22px 26px;color:#1A1A1A;font-size:14px;line-height:1.7">${inner}</div></div>`;
        Promise.allSettled([
          teamTo.length ? resend.emails.send({
            from: FROM_EMAIL, to: teamTo,
            subject: `✍️ Sopimus allekirjoitettu: ${legalName} (${cid})`,
            html: wrap(`<p><b>${legalName}</b> allekirjoitti sopimuksen <b>${cid}</b>.</p>
              <p style="color:#8C8A82">Allekirjoittaja: ${signerName}${gig.signature?.signerTitle ? " · " + gig.signature.signerTitle : ""} (tilaajan ${legalName} puolesta)${gig.signature?.place ? " · " + gig.signature.place : ""}<br>Aika: ${new Date().toLocaleString("fi-FI")}</p>
              <p><a href="https://puuhapatet.fi/admin/gig/${row.job.id}" style="color:#1F3B57">Avaa keikka adminissa →</a></p>`),
          }) : Promise.resolve(),
          (gig.company?.email) ? resend.emails.send({
            from: FROM_EMAIL, to: gig.company.email,
            subject: `Vahvistus: sopimus ${cid} allekirjoitettu — Puuhapatet`,
            html: wrap(`<p>Kiitos! Sopimus <b>${cid}</b> on allekirjoitettu ja vastaanotettu.</p>
              <p>Voit seurata työn etenemistä ja kertyvää summaa reaaliaikaisesti:</p>
              <p><a href="${liveUrl}" style="color:#1F3B57">${liveUrl}</a></p>
              <p style="color:#8C8A82">Maksat vain tehdystä työstä — hinta ei voi ylittää sovittua kattoa.</p>`),
          }) : Promise.resolve(),
        ]).catch(() => {});
      }

      res.json({ ok: true, signedAt: clean.signature?.signedAt ?? Date.now() });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Admin: mark a signed gig approved (or revoke approval). The "approved" marking.
  app.post("/api/jobs/:id/gig/approve", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
      if (!job) return res.status(404).json({ error: "Keikkaa ei löydy" });
      const gig = parseGig(job.gigData);
      if (!gig) return res.status(400).json({ error: "Keikalla ei ole seurantadataa" });

      const approved = req.body?.approved !== false; // default: approve
      const by = req.body?.by ? String(req.body.by) : undefined;
      const note = req.body?.note ? String(req.body.note) : undefined;
      if (approved) {
        gig.approval = { approvedAt: Date.now(), by, note };
        gig.log.push({ t: Date.now(), text: `Keikka hyväksytty${by ? ` · ${by}` : ""}`, by });
      } else {
        gig.approval = null;
        gig.log.push({ t: Date.now(), text: `Hyväksyntä peruttu${by ? ` · ${by}` : ""}`, by });
      }
      gig.updatedAt = Date.now();
      const clean = sanitizeGigData(gig);
      await db.update(jobs).set({ gigData: JSON.stringify(clean), updatedAt: new Date() }).where(eq(jobs.id, id));
      res.json({ ok: true, gigData: clean, status: gigStatus(clean) });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Replace the gig's data (team tracker). Server validates & clamps.
  app.patch("/api/jobs/:id/gig", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
      if (!job) return res.status(404).json({ error: "Keikkaa ei löydy" });
      const gig = sanitizeGigData(req.body?.gigData ?? req.body);
      const totals = computeTotals(gig);
      // Keep agreedPrice in sync with the cap so dashboards/exports stay correct.
      await db.update(jobs)
        .set({ gigData: JSON.stringify(gig), agreedPrice: totals.capCents, isCustomGig: true, updatedAt: new Date() })
        .where(eq(jobs.id, id));
      res.json({ ok: true, gigData: gig, totals });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Send a partial / final invoice email for the uninvoiced accrual, then
  // advance invoicedThrough / invoicedCents and log the payment.
  app.post("/api/jobs/:id/gig/invoice", async (req, res) => {
    if (!resend) {
      return res.status(503).json({ error: "Sähköpostipalvelu ei käytössä — aseta RESEND_API_KEY ympäristömuuttuja." });
    }
    try {
      const id = Number(req.params.id);
      const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
      if (!job) return res.status(404).json({ error: "Keikkaa ei löydy" });
      const gig = parseGig(job.gigData);
      if (!gig) return res.status(400).json({ error: "Keikalla ei ole seurantadataa" });

      const {
        to, bcc, iban, bic, viitenumero, dueDate,
        senderName, senderYTunnus, senderAddress, workerPhone,
        message, isFinal, eInvoice,
      } = req.body as Record<string, any>;

      const recipient = to || gig.company?.email;
      if (!recipient) return res.status(400).json({ error: "Vastaanottajan sähköposti puuttuu" });

      // For fixed-price deals (FR8 / kiinteähintainen sopimus) the installment is
      // always exactly 1/4 of the agreed total — never computed per window.
      const proj = parseProject(job.projectData ?? null);
      const fixedDeal = proj ? fixedDealFor(proj) : null;
      const installmentCents = fixedDeal ? Math.round(fixedDeal.capCents / 4) : null;

      const totalsBefore = computeTotals(gig);
      const amountCents = installmentCents ?? totalsBefore.uninvoicedCents;
      if (amountCents <= 0) return res.status(400).json({ error: "Ei laskutettavaa kertymää" });
      if (fixedDeal && gig.payments.length >= 4) {
        return res.status(400).json({ error: "Kaikki neljä maksuerää on jo lähetetty." });
      }

      const fmtEur = (c: number) => (c / 100).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
      // Which instalment this is. For fixed deals the admin can override the
      // number manually in the dialog (1–4); otherwise it follows the count sent.
      const reqPaymentNumber = Number(req.body?.paymentNumber);
      const paymentNumber = (fixedDeal && Number.isInteger(reqPaymentNumber) && reqPaymentNumber >= 1 && reqPaymentNumber <= 4)
        ? reqPaymentNumber
        : gig.payments.length + 1;

      // For fixed-price contracts one clean instalment line; for standard gigs
      // per-sector window counts as before.
      const lineRows = fixedDeal
        ? `<tr style="border-bottom:1px solid #E4E1D7">
            <td style="padding:10px 0;color:#1A1A1A;font-size:14px">
              Maksuerä ${paymentNumber}/4 — kiinteähintainen sopimus<br>
              <span style="color:#8C8A82;font-size:12px">25 % sovitusta kokonaishinnasta ${fmtEur(fixedDeal.capCents)}</span>
            </td>
            <td style="padding:10px 0;text-align:right;font-size:14px;font-weight:600;color:#1A1A1A;font-variant-numeric:tabular-nums">${fmtEur(amountCents)}</td>
          </tr>`
        : gig.sectors.map((s) => {
            const delta = Math.max(0, s.washed - Math.min(s.washed, s.invoicedWashed || 0));
            if (delta <= 0) return "";
            const lineCents = delta * s.unitPriceCents;
            const creditCents = s.skipped * s.unitPriceCents;
            return `
              <tr style="border-bottom:1px solid #E4E1D7">
                <td style="padding:10px 0;color:#1A1A1A;font-size:14px">
                  ${s.name} — ${delta} ${s.unitLabel}a × ${fmtEur(s.unitPriceCents)}
                  ${s.skipped > 0 ? `<br><span style="color:#8C8A82;font-size:12px">Kuntovaraus yhteensä ${s.skipped} kpl · hyvitetty −${fmtEur(creditCents)}</span>` : ""}
                </td>
                <td style="padding:10px 0;text-align:right;font-size:14px;font-weight:600;color:#1A1A1A;font-variant-numeric:tabular-nums">${fmtEur(lineCents)}</td>
              </tr>`;
          }).join("");

      const dueDisplay = dueDate ? new Date(dueDate + "T12:00:00").toLocaleDateString("fi-FI") : null;
      const barcodeHtml = iban
        ? await generateFinnishBarcodeHtml({ iban, amountCents, viitenumero: viitenumero || String(id), dueDateISO: dueDate, isEn: false })
        : "";

      const invoiceNo = `${gig.contractId || "PT"}-${paymentNumber.toString().padStart(2, "0")}`;
      const invoiceDate = new Date().toLocaleDateString("fi-FI"); // laskun päivämäärä (AVL 209 e §)
      const accruedSoFar = totalsBefore.accruedCents;
      const previouslyInvoiced = totalsBefore.invoicedCents;

      const html = `
<!DOCTYPE html><html lang="fi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F6F4EE;font-family:'Poppins',ui-sans-serif,system-ui,-apple-system,sans-serif">
  <div style="max-width:600px;margin:24px auto;background:#FFFFFF;border-radius:14px;overflow:hidden;border:1px solid #E4E1D7">
    <div style="padding:28px 32px;border-bottom:1px solid #E4E1D7">
      <p style="margin:0;color:#1A1A1A;font-size:20px;font-weight:700;letter-spacing:-0.3px">Puuhapatet</p>
      ${senderName ? `<p style="margin:4px 0 0;color:#8C8A82;font-size:12px">Myyjä: ${senderName}${senderYTunnus ? ` · Y-tunnus ${senderYTunnus}` : ""}</p>` : ""}
      <p style="margin:4px 0 0;color:#8C8A82;font-size:13px">${isFinal ? "Loppulasku" : "Osalasku"} · ${invoiceNo}${gig.contractId ? ` · sopimus ${gig.contractId}` : ""}</p>
      <p style="margin:2px 0 0;color:#8C8A82;font-size:12px">Laskun päivämäärä: ${invoiceDate} · Toimituspäivä: ${invoiceDate}</p>
    </div>
    <div style="padding:24px 32px">
      <p style="margin:0 0 4px;color:#8C8A82;font-size:11px;letter-spacing:1px;text-transform:uppercase">Laskutettava</p>
      <p style="margin:0 0 ${eInvoice ? "4px" : "16px"};color:#1A1A1A;font-size:15px;font-weight:600">${gig.company?.name || job.description}${gig.company?.businessId ? ` · Y-tunnus ${gig.company.businessId}` : ""}</p>
      ${eInvoice ? `<p style="margin:0 0 16px;color:#8C8A82;font-size:12px">Verkkolaskuosoite: ${String(eInvoice).replace(/</g, "&lt;")}</p>` : ""}
      ${message ? `<p style="margin:0 0 20px;color:#1A1A1A;font-size:14px;line-height:1.7;white-space:pre-wrap">${String(message).replace(/</g, "&lt;")}</p>` : ""}
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-top:2px solid #1A1A1A;margin-top:8px">
        <tbody>${lineRows}</tbody>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px">
        ${fixedDeal
          ? `<tr><td style="padding:8px 0;color:#8C8A82;font-size:13px">Kokonaishinta (sovittu)</td><td style="padding:8px 0;text-align:right;color:#8C8A82;font-size:13px;font-variant-numeric:tabular-nums">${fmtEur(fixedDeal.capCents)}</td></tr>
             <tr><td style="padding:4px 0;color:#8C8A82;font-size:13px">Tähän mennessä laskutettu</td><td style="padding:4px 0;text-align:right;color:#8C8A82;font-size:13px;font-variant-numeric:tabular-nums">${fmtEur((paymentNumber - 1) * amountCents)}</td></tr>`
          : `<tr><td style="padding:8px 0;color:#8C8A82;font-size:13px">Kertymä yhteensä</td><td style="padding:8px 0;text-align:right;color:#8C8A82;font-size:13px;font-variant-numeric:tabular-nums">${fmtEur(accruedSoFar)}</td></tr>
             ${previouslyInvoiced > 0 ? `<tr><td style="padding:4px 0;color:#8C8A82;font-size:13px">Aiemmin laskutettu</td><td style="padding:4px 0;text-align:right;color:#8C8A82;font-size:13px;font-variant-numeric:tabular-nums">−${fmtEur(previouslyInvoiced)}</td></tr>` : ""}`
        }
        <tr><td style="padding:12px 0;border-top:2px solid #1A1A1A;color:#1A1A1A;font-size:16px;font-weight:700">Maksettavaa nyt</td><td style="padding:12px 0;border-top:2px solid #1A1A1A;text-align:right;color:#1A1A1A;font-size:22px;font-weight:800;font-variant-numeric:tabular-nums">${fmtEur(amountCents)}</td></tr>
      </table>
      <div style="background:#F6F4EE;border-radius:12px;padding:16px 20px;margin-top:20px">
        <p style="margin:0 0 8px;color:#8C8A82;font-size:11px;letter-spacing:1px;text-transform:uppercase">Maksutiedot</p>
        ${senderName ? `<p style="margin:0 0 2px;font-size:13px;color:#1A1A1A">Saaja: ${senderName}${senderYTunnus ? ` · Y-tunnus ${senderYTunnus}` : ""}</p>` : ""}
        ${iban ? `<p style="margin:0 0 2px;font-size:13px;color:#1A1A1A">IBAN: ${iban}${bic ? ` · BIC ${bic}` : ""}</p>` : ""}
        ${viitenumero ? `<p style="margin:0 0 2px;font-size:13px;color:#1A1A1A">Viite: ${viitenumero}</p>` : ""}
        ${dueDisplay ? `<p style="margin:0;font-size:13px;color:#1A1A1A">Eräpäivä: ${dueDisplay}</p>` : ""}
        ${gig.vatNote ? `<p style="margin:8px 0 0;font-size:12px;color:#8C8A82">${gig.vatNote}</p>` : ""}
      </div>
      ${barcodeHtml}
      <p style="margin:20px 0 0;color:#8C8A82;font-size:12px;line-height:1.6">
        Maksat vain tehdystä työstä — hinta ei voi ylittää sovittua kattoa. Seuraa edistymistä reaaliaikaisesti seurantalinkistä.
      </p>
    </div>
    <div style="padding:16px 32px;border-top:1px solid #E4E1D7;background:#F6F4EE">
      <p style="margin:0;color:#8C8A82;font-size:12px">Puuhapatet · info@puuhapatet.fi · puuhapatet.fi${workerPhone ? ` · ${workerPhone}` : ""}</p>
    </div>
  </div>
</body></html>`;

      // Always BCC the team on every customer invoice — admins can also add extra
      // addresses via the bcc field. Deduplicate and exclude the main recipient.
      const bccArr = Array.from(new Set([
        ...(bcc ? String(bcc).split(",").map((s) => s.trim()).filter(Boolean) : []),
        ...WORKER_NOTIFICATION_EMAILS,
        ...INVOICE_BCC_EMAILS,
      ])).filter((e) => e && e !== recipient);
      const result = await resend.emails.send({
        from: FROM_EMAIL,
        to: recipient,
        ...(bccArr.length ? { bcc: bccArr } : {}),
        subject: fixedDeal
          ? `Osalasku ${paymentNumber}/4 · ${invoiceNo} — ${fmtEur(amountCents)} · Puuhapatet`
          : `${isFinal ? "Loppulasku" : "Osalasku"} ${invoiceNo} — ${fmtEur(amountCents)} · Puuhapatet`,
        html,
      });

      // Advance per-sector invoiced markers, then refresh the summary fields.
      gig.sectors.forEach((s) => { s.invoicedWashed = s.washed; });
      const totalsAfter = computeTotals(gig);
      gig.invoicedThrough = totalsAfter.invoicedWashed;
      gig.payments.push({
        t: Date.now(), countThrough: totalsAfter.invoicedWashed, amountCents,
        to: recipient, note: isFinal ? "Loppulasku" : "Osalasku", emailId: result.data?.id,
        // Record WHICH leader billed the customer — their Y-tunnus becomes the buyer
        // on the alihankkija invoices funded by this instalment.
        biller: (senderName || senderYTunnus || req.body?.billerId) ? {
          id: req.body?.billerId ? String(req.body.billerId).slice(0, 40) : undefined,
          name: senderName ? String(senderName).slice(0, 160) : undefined,
          yTunnus: senderYTunnus ? String(senderYTunnus).slice(0, 40) : undefined,
        } : undefined,
        eInvoice: eInvoice ? String(eInvoice).slice(0, 200) : undefined,
      });
      // For fixed-price contracts, invoicedCents = N completed instalments × fixed amount
      // (avoids mismatch between per-window accrual and agreed flat price).
      gig.invoicedCents = fixedDeal
        ? gig.payments.length * (installmentCents ?? 0)
        : totalsAfter.invoicedCents;
      gig.log.push({ t: Date.now(), text: `${isFinal ? "Loppulasku" : "Osalasku"} ${invoiceNo} lähetetty: ${fmtEur(amountCents)} → ${recipient}` });
      gig.updatedAt = Date.now();
      await db.update(jobs).set({ gigData: JSON.stringify(gig), updatedAt: new Date() }).where(eq(jobs.id, id));

      // Also email the founders a comprehensive internal payment report so they
      // always get the full picture (instalments + alihankkija payouts + expenses
      // + margin), not just the BCC'd customer invoice. Fire-and-forget — a report
      // failure must never break the actual invoicing.
      try {
        const reportHtml = buildGigReportHtml({ id: job.id, description: job.description }, gig, proj);
        await resend.emails.send({
          from: FROM_EMAIL,
          to: WORKER_NOTIFICATION_EMAILS,
          subject: `Maksuraportti — ${gig.company?.name || job.description || `Keikka #${id}`} · Puuhapatet`,
          html: reportHtml,
        });
      } catch (reportErr) {
        console.error("Gig report (auto) error:", reportErr);
      }

      res.json({ ok: true, id: result.data?.id, amountCents, gigData: gig });
    } catch (e: any) {
      console.error("Gig invoice error:", e);
      res.status(500).json({ error: e.message || "Laskun lähetys epäonnistui" });
    }
  });

  // Manager-only: email the comprehensive payment report on demand (the same
  // report that auto-sends with each instalment), without sending an invoice.
  app.post("/api/jobs/:id/gig/report", async (req, res) => {
    if (!resend) {
      return res.status(503).json({ error: "Sähköpostipalvelu ei käytössä — aseta RESEND_API_KEY ympäristömuuttuja." });
    }
    try {
      const id = Number(req.params.id);
      const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
      if (!job) return res.status(404).json({ error: "Keikkaa ei löydy" });
      const gig = parseGig(job.gigData);
      if (!gig) return res.status(400).json({ error: "Keikalla ei ole seurantadataa" });
      const project = parseProject(job.projectData ?? null);
      const html = buildGigReportHtml({ id: job.id, description: job.description }, gig, project);
      const result = await resend.emails.send({
        from: FROM_EMAIL,
        to: WORKER_NOTIFICATION_EMAILS,
        subject: `Maksuraportti — ${gig.company?.name || job.description || `Keikka #${id}`} · Puuhapatet`,
        html,
      });
      res.json({ ok: true, id: result.data?.id });
    } catch (e: any) {
      console.error("Gig report error:", e);
      res.status(500).json({ error: e.message || "Raportin lähetys epäonnistui" });
    }
  });

  // ─── Joonatanin päivittäinen ansioraportti (autosend, vain hänelle) ──────────
  // Lähettää Joonatanille joka päivä lyhyen, selkeän koosteen: paljonko tienasit
  // tänään (oma työ + passiivinen tuotto-osuus työntekijöistä) ja koko keikan
  // kertymä tähän mennessä. EI näy sovelluksessa — pelkkä sähköposti. Ajetaan
  // GitHub Actions -ajastimella (.github/workflows/daily-earnings.yml).
  //
  // Suojaus: jos CRON_SECRET on asetettu, pyynnössä on oltava sama avain
  // (?key= tai x-cron-key). Vastaanottaja: FOUNDER_DAILY_EMAIL || ADMIN_EMAIL.
  app.post("/api/cron/daily-earnings", async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (secret) {
      const given = (req.headers["x-cron-key"] as string) || String(req.query.key || "");
      if (given !== secret) return res.status(401).json({ error: "Unauthorized" });
    }
    if (!resend) {
      return res.status(503).json({ error: "Sähköpostipalvelu ei käytössä — aseta RESEND_API_KEY." });
    }
    try {
      const userId = String(req.query.user || "joonatan");
      const to = process.env.FOUNDER_DAILY_EMAIL || ADMIN_EMAIL;
      const allJobs = await db.select().from(jobs);

      const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
      const todayMs = startOfToday.getTime();
      const isFounderMember = (id: string, mRole?: string) => mRole === "host" || FOUNDER_IDS.includes(id);

      let todayOwnCents = 0, todayPassiveCents = 0, totalOwnCents = 0, totalPassiveCents = 0;
      const gigRows: { name: string; todayCents: number; totalCents: number }[] = [];

      for (const j of allJobs) {
        const project = parseProject((j as any).projectData ?? null);
        if (!project) continue;
        const deal = fixedDealFor(project);
        if (!deal) continue; // vain allekirjoitetut kiinteähintaiset keikat (FR8)
        const crew = project.crew ?? [];
        // Per-window kate is DYNAMIC, derived from the dots: the fixed contract
        // total (capCents) divided by the LIVE billable (red) windows on the map —
        // NOT the nominal €37,50 (which assumes exactly 168 windows). Fewer red
        // dots ⇒ higher €/ikkuna. This mirrors the in-app dashboard
        // (project.tsx → internalKateCents) so the email and the app agree.
        const billableTotal = allPoints(project).filter((p) => p.p === deal.billablePriority).length;
        const kateCents = billableTotal > 0 ? Math.round(deal.capCents / billableTotal) : Math.round(deal.pricePerWindow * 100);
        const rateOf = (id: string, mRole?: string) =>
          isFounderMember(id, mRole) ? kateCents : (crew.find((c) => c.id === id)?.perWindowCents ?? DEFAULT_WORKER_PER_WINDOW_CENTS);
        const founderCount = Math.max(1, crew.filter((c) => isFounderMember(c.id, c.role)).length || FOUNDER_IDS.length);
        // Trainee windows (e.g. Milja) credit their responsible leader (Matias).
        const effId = (id: string): string => {
          const mm = crew.find((c) => c.id === id);
          const t = traineeForUserId(mm?.linkedUserId) || traineeForUserId(id) || traineeForName(mm?.name);
          return t ? t.responsibleLeaderId : id;
        };
        const mRoleOf = (id: string) => crew.find((c) => c.id === id)?.role;

        // ── Today (log, deduped per key, billable priority only) ──
        const seenToday = new Set<string>();
        const todayBy = new Map<string, number>();
        for (const l of project.log) {
          if (l.status !== "pesty" || l.p !== deal.billablePriority || l.ts < todayMs) continue;
          if (seenToday.has(l.key)) continue;
          seenToday.add(l.key);
          const w = effId(project.washedBy[l.key] || l.by || "");
          if (!w) continue;
          todayBy.set(w, (todayBy.get(w) || 0) + 1);
        }
        // A founder earns the full kate on their own windows, and on each WORKER
        // window a margin of (kate − that worker's rate, e.g. 38,18 − 20 = 18,18 €),
        // split evenly between the founders.
        let todayPool = 0;
        for (const [w, n] of Array.from(todayBy)) {
          if (!isFounderMember(w, mRoleOf(w))) todayPool += n * Math.max(0, kateCents - rateOf(w, mRoleOf(w)));
        }
        const gTodayOwn = (todayBy.get(userId) || 0) * kateCents;
        const gTodayPassive = Math.round(todayPool / founderCount);

        // ── Cumulative (final attribution, billable priority only) ──
        const washedBy2 = project.washedBy2 || {};
        const totalByWorker = new Map<string, number>();
        for (const p of allPoints(project)) {
          if (p.status !== "pesty" || p.p !== deal.billablePriority) continue;
          const second = washedBy2[p.key];
          const primary = effId(p.washedBy || "");
          if (primary) totalByWorker.set(primary, (totalByWorker.get(primary) || 0) + (second ? 0.5 : 1));
          if (second) { const s = effId(second); totalByWorker.set(s, (totalByWorker.get(s) || 0) + 0.5); }
        }
        let totalPool = 0;
        for (const [w, n] of Array.from(totalByWorker)) {
          if (!isFounderMember(w, mRoleOf(w))) totalPool += n * Math.max(0, kateCents - rateOf(w, mRoleOf(w)));
        }
        const gTotalOwn = Math.round((totalByWorker.get(userId) || 0) * kateCents);
        const gTotalPassive = Math.round(totalPool / founderCount);

        todayOwnCents += gTodayOwn; todayPassiveCents += gTodayPassive;
        totalOwnCents += gTotalOwn; totalPassiveCents += gTotalPassive;

        const gToday = gTodayOwn + gTodayPassive;
        const gTotal = gTotalOwn + gTotalPassive;
        if (gToday > 0 || gTotal > 0) {
          gigRows.push({ name: project.building?.name || (j as any).description || `Keikka #${(j as any).id}`, todayCents: gToday, totalCents: gTotal });
        }
      }

      const todayTotal = todayOwnCents + todayPassiveCents;
      const grandTotal = totalOwnCents + totalPassiveCents;
      const fmt = (c: number) => (c / 100).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
      const esc = (s: string) => String(s).replace(/</g, "&lt;");
      const dateStr = new Date().toLocaleDateString("fi-FI", { weekday: "long", day: "numeric", month: "numeric", year: "numeric" });

      const rowsHtml = gigRows.length
        ? gigRows.map((g) => `<tr>
            <td style="padding:7px 0;font-size:13px;color:#1A1A1A">${esc(g.name)}</td>
            <td style="padding:7px 0;text-align:right;font-size:13px;color:#1A1A1A;font-variant-numeric:tabular-nums">${fmt(g.todayCents)}</td>
            <td style="padding:7px 0;text-align:right;font-size:13px;color:#8C8A82;font-variant-numeric:tabular-nums">${fmt(g.totalCents)}</td>
          </tr>`).join("")
        : `<tr><td colspan="3" style="padding:10px 0;font-size:13px;color:#8C8A82">Ei kertymää tänään.</td></tr>`;

      const html = `<!doctype html><html><body style="margin:0;background:#F6F4EE;font-family:'Poppins',Arial,sans-serif">
        <div style="max-width:560px;margin:0 auto;padding:28px 18px">
          <p style="margin:0 0 2px;font-size:11px;letter-spacing:0.14em;color:#8C8A82;text-transform:uppercase">Puuhapatet · vain sinulle</p>
          <h1 style="margin:0 0 4px;font-size:22px;color:#1A1A1A">Päivän ansiosi</h1>
          <p style="margin:0 0 20px;font-size:13px;color:#8C8A82">${esc(dateStr)}</p>

          <div style="background:#fff;border:1px solid #E4E1D7;border-radius:14px;padding:20px;margin-bottom:14px">
            <p style="margin:0 0 2px;font-size:11px;letter-spacing:0.06em;color:#8C8A82;text-transform:uppercase">Tänään yhteensä</p>
            <p style="margin:0 0 12px;font-size:34px;font-weight:800;color:#1A1A1A;font-variant-numeric:tabular-nums">${fmt(todayTotal)}</p>
            <table style="width:100%;border-collapse:collapse">
              <tr><td style="padding:4px 0;font-size:13px;color:#1A1A1A">Oma työ</td><td style="padding:4px 0;text-align:right;font-size:13px;color:#1A1A1A;font-variant-numeric:tabular-nums">${fmt(todayOwnCents)}</td></tr>
              <tr><td style="padding:4px 0;font-size:13px;color:#1A1A1A">Passiivinen tuotto-osuus (työntekijöistä)</td><td style="padding:4px 0;text-align:right;font-size:13px;color:#3E7C59;font-variant-numeric:tabular-nums">${fmt(todayPassiveCents)}</td></tr>
            </table>
            <p style="margin:10px 0 0;font-size:11.5px;color:#8C8A82;line-height:1.5">Passiivinen osuus kertyy, vaikka et itse pesisi yhtään ikkunaa — se on osuutesi työntekijöiden tekemän työn katteesta.</p>
          </div>

          <div style="background:#fff;border:1px solid #E4E1D7;border-radius:14px;padding:20px">
            <p style="margin:0 0 12px;font-size:11px;letter-spacing:0.06em;color:#8C8A82;text-transform:uppercase">Koko kertymä tähän mennessä</p>
            <table style="width:100%;border-collapse:collapse">
              <tr><td style="padding:4px 0;font-size:13px;color:#1A1A1A">Yhteensä</td><td style="padding:4px 0;text-align:right;font-size:15px;font-weight:700;color:#1A1A1A;font-variant-numeric:tabular-nums">${fmt(grandTotal)}</td></tr>
              <tr><td style="padding:4px 0;font-size:13px;color:#8C8A82">— oma työ</td><td style="padding:4px 0;text-align:right;font-size:13px;color:#8C8A82;font-variant-numeric:tabular-nums">${fmt(totalOwnCents)}</td></tr>
              <tr><td style="padding:4px 0;font-size:13px;color:#8C8A82">— passiivinen tuotto-osuus</td><td style="padding:4px 0;text-align:right;font-size:13px;color:#8C8A82;font-variant-numeric:tabular-nums">${fmt(totalPassiveCents)}</td></tr>
            </table>
            <table style="width:100%;border-collapse:collapse;margin-top:14px;border-top:1px solid #E4E1D7">
              <tr><td style="padding:8px 0 4px;font-size:10px;letter-spacing:0.08em;color:#8C8A82;text-transform:uppercase">Keikka</td><td style="padding:8px 0 4px;text-align:right;font-size:10px;letter-spacing:0.08em;color:#8C8A82;text-transform:uppercase">Tänään</td><td style="padding:8px 0 4px;text-align:right;font-size:10px;letter-spacing:0.08em;color:#8C8A82;text-transform:uppercase">Yhteensä</td></tr>
              ${rowsHtml}
            </table>
          </div>

          <p style="margin:16px 2px 0;font-size:11px;color:#A8A59B;line-height:1.5">Automaattinen päiväkooste · vain sinulle (${esc(to)}) · puuhapatet.fi</p>
        </div>
      </body></html>`;

      const result = await resend.emails.send({
        from: FROM_EMAIL,
        to,
        subject: `Päivän ansiosi ${fmt(todayTotal)} — ${new Date().toLocaleDateString("fi-FI")} · Puuhapatet`,
        html,
      });
      res.json({ ok: true, id: result.data?.id, to, todayTotal, grandTotal });
    } catch (e: any) {
      console.error("Daily earnings error:", e);
      res.status(500).json({ error: e.message || "Päiväkoosteen lähetys epäonnistui" });
    }
  });

  // Undo the most recent instalment — pops the last payment from the gig's memory
  // so the counter resets (e.g. a test/early send recorded a payment by mistake).
  // Does NOT recall the email already sent; it only fixes the tracked state.
  app.post("/api/jobs/:id/gig/invoice/undo", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
      if (!job) return res.status(404).json({ error: "Keikkaa ei löydy" });
      const gig = parseGig(job.gigData);
      if (!gig) return res.status(400).json({ error: "Keikalla ei ole seurantadataa" });
      if (!gig.payments.length) return res.status(400).json({ error: "Ei peruttavia maksueriä" });

      const removed = gig.payments.pop()!;
      const proj = parseProject(job.projectData ?? null);
      const fixedDeal = proj ? fixedDealFor(proj) : null;
      const installmentCents = fixedDeal ? Math.round(fixedDeal.capCents / 4) : null;
      // Recompute invoiced totals from the remaining payments.
      if (fixedDeal) {
        gig.invoicedCents = gig.payments.length * (installmentCents ?? 0);
      } else {
        gig.invoicedCents = gig.payments.reduce((s, p) => s + p.amountCents, 0);
        gig.invoicedThrough = gig.payments.length ? gig.payments[gig.payments.length - 1].countThrough : 0;
        // Roll the per-sector invoiced markers back to what's still invoiced.
        gig.sectors.forEach((s) => { s.invoicedWashed = Math.min(s.invoicedWashed || 0, gig.invoicedThrough); });
      }
      const fmtEur = (c: number) => (c / 100).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
      gig.log.push({ t: Date.now(), text: `Maksuerä peruttu seurannasta: ${fmtEur(removed.amountCents)}${removed.to ? ` (oli → ${removed.to})` : ""}` });
      gig.updatedAt = Date.now();
      await db.update(jobs).set({ gigData: JSON.stringify(gig), updatedAt: new Date() }).where(eq(jobs.id, id));
      res.json({ ok: true, gigData: gig });
    } catch (e: any) {
      console.error("Gig invoice undo error:", e);
      res.status(500).json({ error: e.message || "Erän peruutus epäonnistui" });
    }
  });

  // ─── Project / floor-plan window tool (FR8 projektinäkymä) ────────────────────

  function parseProject(raw: string | null): ProjectData | null {
    if (!raw) return null;
    try { return sanitizeProjectData(JSON.parse(raw)); } catch { return null; }
  }

  // Read the floor-plan project data for a job (null if not yet initialised).
  app.get("/api/jobs/:id/project", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
      if (!job) return res.status(404).json({ error: "Keikkaa ei löydy" });
      const project = parseProject(job.projectData ?? null);
      if (!project) return res.json({ ok: true, project: null });
      res.json({
        ok: true,
        project,
        totals: computeProjectTotals(project),
        workerStats: computeWorkerStats(project),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Replace the project data (mapping + statuses + hours). Server validates & clamps.
  app.patch("/api/jobs/:id/project", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
      if (!job) return res.status(404).json({ error: "Keikkaa ei löydy" });
      const project = sanitizeProjectData(req.body?.projectData ?? req.body);
      const totals = computeProjectTotals(project);

      // Auto-sync the gig's billing sectors from the toolkit (FR8 = source of
      // truth) — but only once the project actually has windows, so a non-FR8
      // gig's sectors are never clobbered. Keeps the customer view + invoicing
      // consistent with the floor-plan map.
      const extra: Record<string, unknown> = {};
      if (totals.total > 0) {
        const gig = sanitizeGigData(
          syncGigSectorsFromProject(parseGig(job.gigData) ?? emptyGigData(), project),
        );
        extra.gigData = JSON.stringify(gig);
        extra.agreedPrice = computeTotals(gig).capCents;
        extra.isCustomGig = true;
      }

      await db.update(jobs)
        .set({ projectData: JSON.stringify(project), updatedAt: new Date(), ...extra })
        .where(eq(jobs.id, id));
      res.json({
        ok: true,
        project,
        totals,
        workerStats: computeWorkerStats(project),
      });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ─── Gig crew — hard-coded workers w/ private links + worker dashboard ────────
  //
  // The crew roster lives inside the gig's projectData. A worker authenticates
  // by their private token (the secret in their link); hosts manage the roster
  // through the admin job endpoints. Workers never see the gig price/cap — only
  // their own per-window pay rate × the windows they marked.

  const pinHash = (pin: string) =>
    createHash("sha256").update(`puuhapatet:crew:${String(pin)}`).digest("hex");

  // Find which custom-gig job a crew token belongs to (scans custom gigs).
  // Tokens are minted globally unique (genUniqueCrewToken), so at most one gig
  // can match — but we still guard against an accidental cross-gig collision so
  // worker A in gig 1 can never be resolved to gig 2.
  async function findJobByCrewToken(token: string): Promise<{ job: typeof jobs.$inferSelect; project: ProjectData; member: CrewMember } | null> {
    if (!token) return null;
    const rows = await db.select().from(jobs).where(eq(jobs.isCustomGig, true));
    const matches: { job: typeof jobs.$inferSelect; project: ProjectData; member: CrewMember }[] = [];
    for (const job of rows) {
      const project = parseProject(job.projectData ?? null);
      if (!project) continue;
      const member = findCrewByToken(project, token);
      if (member) matches.push({ job, project, member });
    }
    if (matches.length > 1) {
      // Ambiguous token across gigs — refuse rather than guess (should never
      // happen once all tokens are globally unique).
      console.warn(`crew token ${token.slice(0, 4)}… matched ${matches.length} gigs — refusing`);
      return null;
    }
    return matches[0] ?? null;
  }

  // Resolve the logged-in admin user → their personal worker dashboard token.
  // For "dashboard-only" users (e.g. Jani): after admin login the client calls
  // this and redirects to /tyo/<token>. Auto-matches a crew member with NO setup
  // needed, in priority order:
  //   1. linkedUserId === userId   (explicit link, if ever set)
  //   2. crew id   === userId      (joonatan/matias/petrus convention)
  //   3. first name === userId     (e.g. user "jani" → crew member "Jani")
  // Authed route → only the user themselves can resolve their own link.
  app.get("/api/admin/my-dashboard", async (req, res) => {
    try {
      const sub = ((req as any).admin?.sub ?? "").toLowerCase();
      if (!sub) return res.status(401).json({ error: "Kirjautuminen vaaditaan" });
      const firstName = (m: CrewMember) => (m.name || "").trim().split(/\s+/)[0]?.toLowerCase() || "";
      const rows = await db.select().from(jobs).where(eq(jobs.isCustomGig, true));
      let fallback: string | null = null; // a name match, used only if no stronger match
      for (const job of rows) {
        const project = parseProject(job.projectData ?? null);
        for (const m of project?.crew ?? []) {
          if (!m.active) continue;
          if ((m.linkedUserId && m.linkedUserId.toLowerCase() === sub) || m.id.toLowerCase() === sub) {
            return res.json({ ok: true, token: m.token }); // strong match → done
          }
          if (!fallback && firstName(m) === sub) fallback = m.token;
        }
      }
      res.json({ ok: true, token: fallback });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Mint a crew token that is unique across EVERY custom gig (sanitizeCrew only
  // dedupes within one project), so two gigs can never collide on a token.
  async function collectAllCrewTokens(): Promise<Set<string>> {
    const rows = await db.select().from(jobs).where(eq(jobs.isCustomGig, true));
    const tokens = new Set<string>();
    for (const job of rows) {
      const project = parseProject(job.projectData ?? null);
      for (const m of project?.crew ?? []) if (m?.token) tokens.add(m.token);
    }
    return tokens;
  }
  async function genUniqueCrewToken(taken?: Set<string>): Promise<string> {
    const used = taken ?? (await collectAllCrewTokens());
    let t = newCrewToken();
    let guard = 0;
    while (used.has(t) && guard++ < 50) t = newCrewToken();
    used.add(t);
    return t;
  }

  async function saveProject(job: typeof jobs.$inferSelect, project: ProjectData): Promise<ProjectData> {
    const clean = sanitizeProjectData(project);
    const totals = computeProjectTotals(clean);
    // Keep the customer's billing view (gig sectors) in sync with the map, just
    // like the admin project save does — so worker marks flow to /seuranta too.
    const extra: Record<string, unknown> = {};
    if (totals.total > 0) {
      const gig = sanitizeGigData(
        syncGigSectorsFromProject(parseGig(job.gigData) ?? emptyGigData(), clean),
      );
      extra.gigData = JSON.stringify(gig);
      extra.agreedPrice = computeTotals(gig).capCents;
      extra.isCustomGig = true;
    }
    await db.update(jobs)
      .set({ projectData: JSON.stringify(clean), updatedAt: new Date(), ...extra })
      .where(eq(jobs.id, job.id));
    return clean;
  }

  // Build the worker-facing view: floor map + their own progress, NO gig price.
  function workerView(project: ProjectData, member: CrewMember) {
    const stats = crewMemberStats(project, member);
    const projectTotals = computeProjectTotals(project);
    // Paydate-progress counts: for a fixed deal (FR8) track the LIVE billable (red)
    // window count, so the milestone follows the actual dots on the map (e.g. 161 →
    // ~41 / erä). The agreed total (€6300) is unaffected — only this window-count
    // milestone tracks the live set. Otherwise use all mapped windows.
    const payDeal = fixedDealFor(project);
    let windowsTotal = projectTotals.total;
    let windowsWashed = projectTotals.washed;
    if (payDeal) {
      const db = computeDealBilling(project, payDeal);
      windowsTotal = db.billableTotal;
      windowsWashed = db.billableWashed;
    }
    // Trainee (harjoittelija, e.g. Milja under Matias): NOT an alihankkija and
    // NOT asked to sign anything — soft-start dashboard only. Their marked windows
    // and hours are credited to their responsible leader (Matias) in the manager
    // views. Matched by the linked login id / crew id, or first name as fallback.
    const trainee: TraineeInfo | undefined =
      traineeForUserId(member.linkedUserId) || traineeForUserId(member.id) || traineeForName(member.name);
    // A trainee signs nothing; everyone else the full alihankkija set.
    const requiredIds = trainee ? [] : REQUIRED_AGREEMENT_IDS;
    const agreementVersion = WORKER_AGREEMENT_VERSION;
    // Soft-start model: "in the app" (typed name) is decoupled from "has signed".
    const signedAll = trainee ? true : hasSignedAllAgreements(member, REQUIRED_AGREEMENT_IDS, WORKER_AGREEMENT_VERSION);
    const enteredApp = !!member.onboardedAt;
    // Until signing is gated, the dashboard opens on name alone. Once gated, an
    // already-entered alihankkija who hasn't signed must do so — a trainee never.
    const needsToSign = !trainee && WORKER_AGREEMENTS_GATED && !signedAll;
    // id → display name for every crew member, so the worker map can show WHO
    // washed each window ("Pesi Jani") and who left a note.
    const workerNames: Record<string, string> = {};
    for (const m of project.crew || []) workerNames[m.id] = m.name;
    // Team leaderboard (workers only). Exposes name + windows + windows/hour — NO
    // pay rate, tokens or euros — so it's safe to show every worker the standings.
    const leaderboard = (project.crew || [])
      .filter((m) => m.active && m.role === "worker" && !m.adminLinked)
      .map((m) => {
        const s = crewMemberStats(project, m);
        return { id: m.id, name: m.name, washed: s.washed, windowsPerHour: s.windowsPerHour, hours: s.hours, isMe: m.id === member.id };
      })
      .sort((a, b) => b.washed - a.washed || b.windowsPerHour - a.windowsPerHour);
    return {
      leaderboard,
      worker: {
        id: member.id,
        name: member.name,
        role: member.role,
        perWindowCents: member.perWindowCents,
        adminLinked: !!member.adminLinked,
        hasPin: !!member.pinHash,
        // "onboarded" = is in the app (has a name). Signing is tracked separately
        // via needsToSign so a soft-started worker isn't bounced to onboarding.
        onboarded: enteredApp,
        needsToSign,
        signedAll,
        // Trainee: drives the dashboard to hide the alihankkija/tax cards and show
        // a "under <leader>'s responsibility" note instead. null for normal workers.
        trainee: trainee ? { responsibleLeaderName: trainee.responsibleLeaderName } : null,
        activeShiftAt: member.activeShiftAt ?? null,
        shiftStartWashed: member.shiftStartWashed ?? null,
        sessions: (member.sessions || []).slice(-30).reverse(), // newest-first
        profile: member.profile ?? null,
        signedAgreementIds: member.agreements
          .filter((a) => a.version === agreementVersion)
          .map((a) => a.agreementId),
        notes: member.notes,
        // The worker's own billing details (their Y-tunnus + IBAN), used to
        // prefill the payout-approval form and their auto-generated invoice.
        billing: {
          name: member.profile?.fullName ?? member.name,
          yTunnus: member.profile?.yTunnus ?? null,
          iban: member.profile?.iban ?? null,
          address: member.profile?.answers?.address ?? member.profile?.city ?? null,
        },
      },
      // Puuhapatet -> worker payouts (newest-first). The worker sees and approves
      // these; the gig price/cap stays hidden as always.
      payouts: (member.payouts || []).slice().sort((a, b) => b.createdAt - a.createdAt),
      building: project.building,
      pricePerWindow: member.perWindowCents / 100, // worker's OWN rate, not the gig price
      marks: project.marks,
      // Workers see the full live map: which windows are washed and (on tap) WHO
      // washed them, plus the host's info notes (ladders, hazards, storage, …) and
      // the "työn alla" zone as a read-only info layer. They can mark their own
      // work and add simple notes; they cannot move/delete windows.
      statuses: project.statuses,
      washedBy: project.washedBy,
      keskenBy: project.keskenBy ?? {},
      workerNames,
      notes: project.notes ?? {},
      observations: project.observations ?? {},
      activeZone: project.activeZone ?? null,
      customMarks: project.customMarks,
      posOverrides: project.posOverrides,
      deleted: project.deleted,
      hours: stats.hours,
      stats,
      // Gig-wide window counts (team) for the shared "paydate progress" stat — NO
      // euros, so the worker still never sees the gig total/price/cap.
      windowsTotal,
      windowsWashed,
      agreementVersion,
      // A trainee signs nothing ([]); everyone else the alihankkija set.
      requiredAgreementIds: requiredIds,
      // Whether signing is currently enforced. Drives the client flow: soft start
      // (intro + name only) when false; full sign flow / banner when true. Trainees
      // are never gated (no agreements).
      agreementsGated: trainee ? false : WORKER_AGREEMENTS_GATED,
      // Worker's own logged expenses (filtered — they never see other workers' costs).
      expenses: (project.expenses || []).filter((e) => e.by === member.id),
    };
  }

  // GET the worker's dashboard payload by their private token.
  app.get("/api/crew/:token", async (req, res) => {
    try {
      const found = await findJobByCrewToken(String(req.params.token));
      if (!found || !found.member.active) return res.status(404).json({ error: "Linkkiä ei löytynyt" });
      res.json({ ok: true, view: workerView(found.project, found.member) });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Verify a worker's PIN (no-op success if they have not set one yet).
  app.post("/api/crew/:token/auth", async (req, res) => {
    try {
      const found = await findJobByCrewToken(String(req.params.token));
      if (!found || !found.member.active) return res.status(404).json({ error: "Linkkiä ei löytynyt" });
      const { member } = found;
      if (!member.pinHash) return res.json({ ok: true, needsPin: false });
      const ok = !!req.body?.pin && pinHash(String(req.body.pin)) === member.pinHash;
      if (!ok) return res.status(401).json({ ok: false, error: "Väärä PIN" });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Complete onboarding: save profile, append agreement signatures, set PIN.
  app.post("/api/crew/:token/onboard", async (req, res) => {
    try {
      const found = await findJobByCrewToken(String(req.params.token));
      if (!found || !found.member.active) return res.status(404).json({ error: "Linkkiä ei löytynyt" });
      const { job, project, member } = found;
      const body = req.body ?? {};

      // Merge into a fresh sanitized member so a bad client can't corrupt it.
      const incomingAgreements = Array.isArray(body.agreements) ? body.agreements : [];
      if (incomingAgreements.some((a: any) => String(a?.signatureDataUrl ?? "").length > MAX_SIGNATURE_DATAURL_LEN)) {
        return res.status(413).json({ error: "Allekirjoitus on liian suuri. Piirrä se uudelleen." });
      }
      const stamped = incomingAgreements.map((a: any) => ({
        ...a,
        ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress,
        userAgent: req.headers["user-agent"],
      }));
      // Keep prior signatures for agreement ids not re-signed now.
      const reSignedIds = new Set(stamped.map((a: any) => String(a.agreementId)));
      const keptAgreements = member.agreements.filter((a) => !reSignedIds.has(a.agreementId));

      const merged = sanitizeCrewMember({
        ...member,
        profile: body.profile ?? member.profile,
        agreements: [...keptAgreements, ...stamped],
        pinHash: body.pin ? pinHash(String(body.pin)) : member.pinHash,
      });
      if (!merged) return res.status(400).json({ error: "Virheelliset tiedot" });
      // Require at least a name to enter the app (soft start). Agreements may be
      // empty now and signed later via the dashboard banner.
      const name = (merged.profile?.fullName || merged.name || "").trim();
      if (!name) return res.status(400).json({ error: "Kirjoita nimesi." });
      // Stamp entry on the first onboard call; later sign-ups keep the timestamp.
      merged.onboardedAt = member.onboardedAt || Date.now();

      project.crew = (project.crew || []).map((m) => (m.id === member.id ? merged : m));
      const saved = await saveProject(job, project);
      const savedMember = findCrewByToken(saved, member.token)!;
      res.json({ ok: true, view: workerView(saved, savedMember) });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Worker marks a window (status change, attributed to themselves only).
  app.post("/api/crew/:token/window", async (req, res) => {
    try {
      const found = await findJobByCrewToken(String(req.params.token));
      if (!found || !found.member.active) return res.status(404).json({ error: "Linkkiä ei löytynyt" });
      const { job, project, member } = found;
      // Soft start: marking is open. Once signing is gated, block marking until
      // the worker has signed the current agreement set (the dashboard banner
      // drives them there). Trainees are never gated (they sign no subcontractor
      // agreement) — they can mark windows straight away.
      if (!isCrewTrainee(member) && WORKER_AGREEMENTS_GATED && !hasSignedAllAgreements(member, REQUIRED_AGREEMENT_IDS, WORKER_AGREEMENT_VERSION)) {
        return res.status(403).json({ error: "Lue lisätiedot ja allekirjoita sopimukset ensin" });
      }
      const key = String(req.body?.key ?? "").slice(0, 64);
      const status = req.body?.status === "pesty" || req.body?.status === "kesken" ? req.body.status : "ei";
      if (!key) return res.status(400).json({ error: "key puuttuu" });

      if (status === "ei") {
        // Only clear a window the worker owns (or that nobody owns).
        if (!project.washedBy[key] || project.washedBy[key] === member.id) {
          delete project.statuses[key];
          delete project.washedBy[key];
          if (project.keskenBy) delete project.keskenBy[key];
        }
      } else {
        project.statuses[key] = status;
        if (status === "pesty") {
          project.washedBy[key] = member.id;
          if (project.keskenBy) delete project.keskenBy[key];
        } else if (status === "kesken") {
          delete project.washedBy[key];
          project.keskenBy = project.keskenBy ?? {};
          project.keskenBy[key] = member.id;
        } else {
          delete project.washedBy[key];
          if (project.keskenBy) delete project.keskenBy[key];
        }
      }
      const floor = key.split("#")[0];
      const p: 1 | 2 = req.body?.p === 2 ? 2 : 1;
      project.log = [{ floor, key, p, status, ts: Date.now(), by: member.id }, ...(project.log || [])].slice(0, 200);

      const saved = await saveProject(job, project);
      const savedMember = findCrewByToken(saved, member.token)!;
      res.json({ ok: true, view: workerView(saved, savedMember) });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Worker leaves an OBSERVATION about a specific window (text + optional photo).
  // Keyed by the window key, same as statuses. Empty text + no image clears it.
  // Shown to the customer as a small dismissible popup on that window's dot.
  app.post("/api/crew/:token/window-observation", async (req, res) => {
    try {
      const found = await findJobByCrewToken(String(req.params.token));
      if (!found || !found.member.active) return res.status(404).json({ error: "Linkkiä ei löytynyt" });
      const { job, project, member } = found;
      if (!isCrewTrainee(member) && WORKER_AGREEMENTS_GATED && !hasSignedAllAgreements(member, REQUIRED_AGREEMENT_IDS, WORKER_AGREEMENT_VERSION)) {
        return res.status(403).json({ error: "Lue lisätiedot ja allekirjoita sopimukset ensin" });
      }
      const key = String(req.body?.key ?? "").slice(0, 64);
      if (!key) return res.status(400).json({ error: "key puuttuu" });
      const text = String(req.body?.text ?? "").slice(0, 1000).trim();
      const img = typeof req.body?.imageDataUrl === "string" && req.body.imageDataUrl.startsWith("data:image/")
        ? req.body.imageDataUrl.slice(0, MAX_OBSERVATION_IMAGE_LEN) : undefined;
      project.observations = project.observations || {};
      if (!text && !img) delete project.observations[key];
      else project.observations[key] = { text, imageDataUrl: img, by: member.id, ts: Date.now() };
      const saved = await saveProject(job, project);
      const savedMember = findCrewByToken(saved, member.token)!;
      res.json({ ok: true, view: workerView(saved, savedMember) });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Worker starts / ends their work-hour timer.
  //  • start: stamp activeShiftAt + the current washed count (session baseline) so
  //    managers see a live "shift on" indicator.
  //  • end: compute the session summary (windows since start × the worker's own
  //    rate, worked minutes from the client incl. break deduction), append it to
  //    the session log, and clear the running state. Hours are logged separately
  //    via /hours. Returns the view; the client shows the last session as a recap.
  app.post("/api/crew/:token/shift", async (req, res) => {
    try {
      const found = await findJobByCrewToken(String(req.params.token));
      if (!found || !found.member.active) return res.status(404).json({ error: "Linkkiä ei löytynyt" });
      const { job, project, member } = found;
      const start = req.body?.start === true;
      const nowWashed = crewMemberStats(project, member).washed;
      let endedSession: { start: number; end: number; minutes: number; windows: number; earnedCents: number } | null = null;
      project.crew = (project.crew || []).map((m) => {
        if (m.id !== member.id) return m;
        if (start) {
          return { ...m, activeShiftAt: Date.now(), shiftStartWashed: nowWashed };
        }
        // End the shift → record the session.
        const startedAt = m.activeShiftAt || Date.now();
        const baseline = m.shiftStartWashed ?? nowWashed;
        const windows = Math.max(0, nowWashed - baseline);
        const minutes = Math.max(0, Math.round(Number(req.body?.minutes) || (Date.now() - startedAt) / 60000));
        endedSession = { start: startedAt, end: Date.now(), minutes, windows, earnedCents: windows * m.perWindowCents };
        const sessions = [...(m.sessions || []), endedSession].slice(-200);
        return { ...m, activeShiftAt: undefined, shiftStartWashed: undefined, sessions };
      });
      const saved = await saveProject(job, project);
      const savedMember = findCrewByToken(saved, member.token)!;
      // Email the worker a clean day summary (best-effort; never blocks the response).
      if (!start && endedSession && resend && savedMember.profile?.email) {
        sendSessionSummaryEmail(savedMember, endedSession, project.building?.name).catch(
          (e) => console.warn("session summary email failed:", e?.message),
        );
      }
      res.json({ ok: true, view: workerView(saved, savedMember) });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Worker logs hours (timer stop or manual entry).
  app.post("/api/crew/:token/hours", async (req, res) => {
    try {
      const found = await findJobByCrewToken(String(req.params.token));
      if (!found || !found.member.active) return res.status(404).json({ error: "Linkkiä ei löytynyt" });
      const { job, project, member } = found;
      const delta = Math.round((Number(req.body?.delta) || 0) * 100) / 100;
      if (!delta) return res.status(400).json({ error: "delta puuttuu" });
      project.hours[member.id] = Math.max(0, +(((project.hours[member.id] || 0) + delta).toFixed(2)));
      project.hourLog = [{ worker: member.id, delta, ts: Date.now(), by: member.id }, ...(project.hourLog || [])].slice(0, 200);
      const saved = await saveProject(job, project);
      const savedMember = findCrewByToken(saved, member.token)!;
      res.json({ ok: true, view: workerView(saved, savedMember) });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Worker logs a whole work day by hand (manual mode / forgot the timer). Records
  // the hours in the ledger AND appends a session so the day shows up in the diary.
  // The session also counts the windows this worker marked "pesty" TODAY (from the
  // activity log), so a manually-logged day shows hours AND windows together.
  app.post("/api/crew/:token/manual-session", async (req, res) => {
    try {
      const found = await findJobByCrewToken(String(req.params.token));
      if (!found || !found.member.active) return res.status(404).json({ error: "Linkkiä ei löytynyt" });
      const { job, project, member } = found;
      const hours = Math.round((Number(req.body?.hours) || 0) * 100) / 100;
      if (!(hours > 0)) return res.status(400).json({ error: "tunnit puuttuu" });
      const minutes = Math.round(hours * 60);
      const end = Date.now();
      // Windows this worker marked pesty today — count each window once.
      const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
      const todayKeys = new Set<string>();
      for (const l of project.log || []) {
        if (l.by === member.id && l.status === "pesty" && l.ts >= startOfDay.getTime()) todayKeys.add(l.key);
      }
      const windows = todayKeys.size;
      const session = { start: end - minutes * 60000, end, minutes, windows, earnedCents: windows * member.perWindowCents, manual: true };
      project.hours[member.id] = Math.max(0, +(((project.hours[member.id] || 0) + hours).toFixed(2)));
      project.hourLog = [{ worker: member.id, delta: hours, ts: end, by: member.id }, ...(project.hourLog || [])].slice(0, 200);
      project.crew = (project.crew || []).map((m) =>
        m.id !== member.id ? m : { ...m, sessions: [...(m.sessions || []), session].slice(-200) },
      );
      const saved = await saveProject(job, project);
      const savedMember = findCrewByToken(saved, member.token)!;
      // Same progress-update email as the timer flow — so a day logged by hand
      // afterwards still notifies the worker (and bcc's the bosses). Best-effort.
      if (resend && savedMember.profile?.email) {
        sendSessionSummaryEmail(savedMember, session, project.building?.name).catch(
          (e) => console.warn("manual session summary email failed:", e?.message),
        );
      }
      res.json({ ok: true, view: workerView(saved, savedMember) });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Worker adds a note.
  app.post("/api/crew/:token/note", async (req, res) => {
    try {
      const found = await findJobByCrewToken(String(req.params.token));
      if (!found || !found.member.active) return res.status(404).json({ error: "Linkkiä ei löytynyt" });
      const { job, project, member } = found;
      const text = String(req.body?.text ?? "").trim().slice(0, 2000);
      if (!text) return res.status(400).json({ error: "Tyhjä muistiinpano" });
      project.crew = (project.crew || []).map((m) =>
        m.id === member.id ? { ...m, notes: [{ t: Date.now(), text }, ...(m.notes || [])].slice(0, 200) } : m,
      );
      const saved = await saveProject(job, project);
      const savedMember = findCrewByToken(saved, member.token)!;
      res.json({ ok: true, view: workerView(saved, savedMember) });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Worker map notes — simple shared markers on the floor plan: a "huomio" on a
  // specific spot (broken latch etc.) or info for others (where the ladder is).
  // Stored in project.notes like the host's; attributed to the worker (by).
  const FLOOR_RE = /^[\w-]{1,8}$/;
  app.post("/api/crew/:token/map-note", async (req, res) => {
    try {
      const found = await findJobByCrewToken(String(req.params.token));
      if (!found || !found.member.active) return res.status(404).json({ error: "Linkkiä ei löytynyt" });
      const { job, project, member } = found;
      const floor = String(req.body?.floor ?? "");
      const x = Number(req.body?.x), y = Number(req.body?.y);
      if (!FLOOR_RE.test(floor) || !Number.isFinite(x) || !Number.isFinite(y)) {
        return res.status(400).json({ error: "Virheelliset tiedot" });
      }
      const kind = toNoteKind(req.body?.kind);
      const text = String(req.body?.text ?? "").slice(0, 2000);
      const key = `${floor}#n${Math.random().toString(36).slice(2, 9)}`;
      const note = { key, x: Math.max(0, Math.min(100, +x.toFixed(2))), y: Math.max(0, Math.min(100, +y.toFixed(2))), kind, text: text || undefined, ts: Date.now(), by: member.id };
      const notes = project.notes ?? (project.notes = {});
      notes[floor] = [...(notes[floor] || []), note].slice(0, 500);
      const saved = await saveProject(job, project);
      const savedMember = findCrewByToken(saved, member.token)!;
      res.json({ ok: true, key, view: workerView(saved, savedMember) });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post("/api/crew/:token/map-note/update", async (req, res) => {
    try {
      const found = await findJobByCrewToken(String(req.params.token));
      if (!found || !found.member.active) return res.status(404).json({ error: "Linkkiä ei löytynyt" });
      const { job, project, member } = found;
      const floor = String(req.body?.floor ?? "");
      const key = String(req.body?.key ?? "");
      const text = String(req.body?.text ?? "").slice(0, 2000);
      const list = project.notes?.[floor];
      if (!list) return res.status(404).json({ error: "Merkintää ei löytynyt" });
      const note = list.find((n) => n.key === key);
      // Workers may edit only their own notes; the host's stay read-only to them.
      if (!note || (note.by && note.by !== member.id)) return res.status(403).json({ error: "Et voi muokata tätä merkintää" });
      note.text = text || undefined;
      const saved = await saveProject(job, project);
      const savedMember = findCrewByToken(saved, member.token)!;
      res.json({ ok: true, view: workerView(saved, savedMember) });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post("/api/crew/:token/map-note/delete", async (req, res) => {
    try {
      const found = await findJobByCrewToken(String(req.params.token));
      if (!found || !found.member.active) return res.status(404).json({ error: "Linkkiä ei löytynyt" });
      const { job, project, member } = found;
      const floor = String(req.body?.floor ?? "");
      const key = String(req.body?.key ?? "");
      const list = project.notes?.[floor];
      const note = list?.find((n) => n.key === key);
      if (!note || (note.by && note.by !== member.id)) return res.status(403).json({ error: "Et voi poistaa tätä merkintää" });
      project.notes![floor] = list!.filter((n) => n.key !== key);
      const saved = await saveProject(job, project);
      const savedMember = findCrewByToken(saved, member.token)!;
      res.json({ ok: true, view: workerView(saved, savedMember) });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Worker approves a payout notification: confirms the amount and locks in
  // their billing snapshot (name / Y-tunnus / IBAN) for their own invoice. The
  // actual bank transfer is done manually by Puuhapatet afterwards.
  app.post("/api/crew/:token/payout/:payoutId/approve", async (req, res) => {
    try {
      const found = await findJobByCrewToken(String(req.params.token));
      if (!found || !found.member.active) return res.status(404).json({ error: "Linkkiä ei löytynyt" });
      const { job, project, member } = found;
      const pid = String(req.params.payoutId);
      const list = member.payouts || [];
      const payout = list.find((p) => p.id === pid);
      if (!payout) return res.status(404).json({ error: "Maksua ei löytynyt" });
      if (payout.status !== "ilmoitettu") {
        return res.status(409).json({ error: "Maksu on jo hyväksytty" });
      }
      // Trainees (harjoittelija) don't invoice us — they never go through the
      // alihankkija payout/withholding flow. Block the path defensively.
      if (isCrewTrainee(member)) {
        return res.status(400).json({ error: "Harjoittelija ei laskuta — maksu hoidetaan tiimin kautta." });
      }
      const b = (req.body?.billing ?? {}) as Record<string, any>;
      payout.status = "hyvaksytty";
      payout.approvedAt = Date.now();
      payout.billing = {
        name: String(b.name ?? member.profile?.fullName ?? member.name).slice(0, 160) || undefined,
        yTunnus: String(b.yTunnus ?? member.profile?.yTunnus ?? "").slice(0, 40) || undefined,
        iban: String(b.iban ?? member.profile?.iban ?? "").slice(0, 40) || undefined,
        address: String(b.address ?? "").slice(0, 240) || undefined,
      };
      // Freeze the tax breakdown the worker just saw & approved, computed from their
      // CURRENT declared status — so the final invoice matches the preview even if
      // they edit their profile later (the "paid" step reuses this snapshot).
      payout.tax = computeTax({
        laborCents: payout.amountCents,
        vatStatus: readVatStatus(member.profile?.answers),
        inPrepaymentRegister: readInPrepaymentRegister(member.profile?.answers),
        payeeType: readPayeeType(member.profile?.answers),
      });
      // Worker's own deductible expenses (kulut) attached at approval — recorded
      // for their tax deduction; they NEVER change amountCents (the labour paid).
      // Final shape is re-validated by sanitizeProjectData on save.
      const rawExpenses = Array.isArray(req.body?.expenses) ? req.body.expenses : [];
      payout.expenses = rawExpenses.slice(0, 30).map((e: any, i: number) => ({
        id: String(e?.id ?? `pe_${Date.now()}_${i}`).slice(0, 40),
        desc: String(e?.desc ?? "").slice(0, 200).trim(),
        amountCents: Math.max(0, Math.floor(Number(e?.amountCents) || 0)),
        receiptDataUrl: typeof e?.receiptDataUrl === "string" && e.receiptDataUrl.startsWith("data:image/")
          ? e.receiptDataUrl.slice(0, MAX_PAYOUT_RECEIPT_LEN) : undefined,
      })).filter((e: any) => e.desc && e.amountCents > 0);
      project.crew = (project.crew || []).map((m) => (m.id === member.id ? { ...m, payouts: list } : m));
      const saved = await saveProject(job, project);
      const savedMember = findCrewByToken(saved, member.token)!;
      res.json({ ok: true, view: workerView(saved, savedMember) });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Worker downloads their own subcontractor invoice (PDF) for a PAID payout.
  // Regenerated on demand from the payout's stored snapshot (tax/buyer/billing),
  // so the invoice the worker sees on their dashboard matches the emailed copy.
  app.get("/api/crew/:token/payout/:payoutId/invoice.pdf", async (req, res) => {
    try {
      const found = await findJobByCrewToken(String(req.params.token));
      if (!found || !found.member.active) return res.status(404).json({ error: "Linkkiä ei löytynyt" });
      const { member } = found;
      const payout = (member.payouts || []).find((p) => p.id === String(req.params.payoutId));
      if (!payout || payout.status !== "maksettu") return res.status(404).json({ error: "Laskua ei löytynyt" });

      const billing = payout.billing || {};
      const answers = member.profile?.answers;
      // Prefer the snapshot captured at approval/payment; fall back to a fresh computation.
      const tax = payout.tax ?? computeTax({
        laborCents: payout.amountCents,
        vatStatus: readVatStatus(answers),
        inPrepaymentRegister: readInPrepaymentRegister(answers),
        payeeType: readPayeeType(answers),
      });
      const buyer = payout.buyer ?? resolveBuyer(null);
      const invoiceDate = new Date(payout.paidAt || payout.createdAt).toLocaleDateString("fi-FI");
      const pdf = await generateWorkerInvoicePdf({
        invoiceNo: payout.invoiceNo || `${member.id.toUpperCase().slice(0, 6)}-01`,
        workerName: billing.name || member.profile?.fullName || member.name,
        workerYTunnus: billing.yTunnus || member.profile?.yTunnus || undefined,
        workerAddress: billing.address || member.profile?.city || undefined,
        workerIban: billing.iban || member.profile?.iban || undefined,
        windows: payout.windows,
        amountCents: payout.amountCents,
        note: payout.note,
        invoiceDate,
        paidDate: invoiceDate,
        tax,
        buyer,
        acceptedAt: payout.approvedAt,
        expenses: payout.expenses,
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="lasku-${payout.invoiceNo || payout.id}.pdf"`);
      res.send(pdf);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ── Worker expenses (crew token — public, own expenses only) ───────────────────
  // Workers log their own job costs (transport, materials, equipment, other).
  // The admin sees ALL expenses across workers in the project expense view.

  const VALID_EXPENSE_KINDS: ProjExpenseKind[] = ["transport", "materials", "equipment", "other"];

  function makeExpenseId(): string {
    return `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  app.post("/api/crew/:token/expense", async (req, res) => {
    try {
      const found = await findJobByCrewToken(String(req.params.token));
      if (!found || !found.member.active) return res.status(404).json({ error: "Linkkiä ei löytynyt" });
      const { job, project, member } = found;
      const { kind, desc, amountCents } = req.body as Record<string, any>;
      if (!amountCents || Number(amountCents) <= 0) {
        return res.status(400).json({ error: "Summa puuttuu tai on nolla" });
      }
      const expense: ProjExpense = {
        id: makeExpenseId(),
        by: member.id,
        kind: VALID_EXPENSE_KINDS.includes(kind) ? kind : "other",
        desc: String(desc || "").slice(0, 300).trim(),
        amountCents: Math.round(Number(amountCents)),
        ts: Date.now(),
      };
      project.expenses = [...(project.expenses || []), expense];
      await saveProject(job, project);
      // Return only this worker's expenses for privacy
      const myExpenses = (project.expenses || []).filter((e) => e.by === member.id);
      res.json({ ok: true, expense, expenses: myExpenses });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete("/api/crew/:token/expense/:expenseId", async (req, res) => {
    try {
      const found = await findJobByCrewToken(String(req.params.token));
      if (!found || !found.member.active) return res.status(404).json({ error: "Linkkiä ei löytynyt" });
      const { job, project, member } = found;
      const expId = String(req.params.expenseId);
      const target = (project.expenses || []).find((e) => e.id === expId);
      if (!target) return res.status(404).json({ error: "Kulua ei löydy" });
      if (target.by !== member.id) return res.status(403).json({ error: "Ei oikeutta poistaa tätä kulua" });
      project.expenses = (project.expenses || []).filter((e) => e.id !== expId);
      await saveProject(job, project);
      const myExpenses = (project.expenses || []).filter((e) => e.by === member.id);
      res.json({ ok: true, expenses: myExpenses });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ── Admin project expenses (admin auth required) ────────────────────────────

  app.post("/api/jobs/:id/project/expense", async (req, res) => {
    try {
      const loaded = await loadJobProject(Number(req.params.id));
      if (!loaded) return res.status(404).json({ error: "Keikkaa ei löydy" });
      const { job, project } = loaded;
      const { kind, desc, amountCents, by, forWhom, receiptDataUrl } = req.body as Record<string, any>;
      if (!amountCents || Number(amountCents) <= 0) {
        return res.status(400).json({ error: "Summa puuttuu tai on nolla" });
      }
      const adminSub = (req as any).admin?.sub || "admin";
      const receipt = typeof receiptDataUrl === "string" && receiptDataUrl.startsWith("data:image/")
        ? receiptDataUrl.slice(0, MAX_EXPENSE_RECEIPT_LEN) : undefined;
      const forWhomVal = typeof forWhom === "string" && forWhom.trim() ? forWhom.trim().slice(0, 40) : undefined;
      const expense: ProjExpense = {
        id: makeExpenseId(),
        by: String(by || adminSub).slice(0, 40),
        kind: VALID_EXPENSE_KINDS.includes(kind) ? kind : "other",
        desc: String(desc || "").slice(0, 300).trim(),
        amountCents: Math.round(Number(amountCents)),
        ts: Date.now(),
        ...(forWhomVal ? { forWhom: forWhomVal } : {}),
        ...(receipt ? { receiptDataUrl: receipt } : {}),
      };
      project.expenses = [...(project.expenses || []), expense];
      await saveProject(job, project);
      res.json({ ok: true, expense, expenses: project.expenses });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete("/api/jobs/:id/project/expense/:expenseId", async (req, res) => {
    try {
      const loaded = await loadJobProject(Number(req.params.id));
      if (!loaded) return res.status(404).json({ error: "Keikkaa ei löydy" });
      const { job, project } = loaded;
      const expId = String(req.params.expenseId);
      project.expenses = (project.expenses || []).filter((e) => e.id !== expId);
      await saveProject(job, project);
      res.json({ ok: true, expenses: project.expenses });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // The agreement documents + profile questionnaire (for the worker onboarding UI).
  app.get("/api/crew-agreements", (_req, res) => {
    res.json({ ok: true, version: WORKER_AGREEMENT_VERSION, agreements: WORKER_AGREEMENTS, requiredAgreementIds: REQUIRED_AGREEMENT_IDS });
  });

  // ── Host (admin) crew management ────────────────────────────────────────────

  async function loadJobProject(id: number) {
    const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
    if (!job) return null;
    const project = parseProject(job.projectData ?? null) ?? { ...emptyProjectData() };
    return { job, project };
  }

  // Host overview: roster + per-worker stats (windows done, €, hours, €/h).
  app.get("/api/jobs/:id/crew", async (req, res) => {
    try {
      const loaded = await loadJobProject(Number(req.params.id));
      if (!loaded) return res.status(404).json({ error: "Keikkaa ei löydy" });
      const { job, project } = loaded;
      // Show the full worker roster INCLUDING admin-linked workers (e.g. Petrus
      // Aalto, who is also a Puuhapatet admin) — hosts need to see and edit them
      // here. Only the founder hosts (Joonatan/Matias, role "host") stay masked,
      // since they manage from the admin views, not the worker roster UI. Each
      // admin-linked worker shows an "ADMIN" badge in the crew card.
      const crew = (project.crew || [])
        .filter((m) => m.role !== "host")
        .map((m) => ({
          member: m,
          stats: crewMemberStats(project, m),
          onboarded: isOnboarded(m, REQUIRED_AGREEMENT_IDS, WORKER_AGREEMENT_VERSION),
        }));
      // Deal + billable-window count so the payroll page can show the per-erä
      // kate (€1575 / erän ikkunat). eraWindows = founders' editable per-erä counts.
      const deal = fixedDealFor(project);
      const billablePts = deal ? allPoints(project).filter((p) => p.p === deal.billablePriority) : [];
      const totalBillable = billablePts.length;
      const billableWashed = billablePts.filter((p) => p.status === "pesty").length;
      // Per-erä debt: who washed each instalment's windows (in wash order) and the
      // palkka that implies. Display only — never affects pay.
      const eraBreakdown: EraDebtBreakdown[] = deal
        ? computeEraDebts(project, deal, project.crew || [], project.eraWindows ?? null)
        : [];
      // Tie each erä to the founder who BILLED that instalment (instalments are
      // sent in order, so payments[i] ↔ erä i+1). A payment without a biller is
      // never defaulted to anyone — same rule as ALV turnover + founder
      // settlement; the Verotus view lists it for one-tap attribution.
      const gig = parseGig(job.gigData);
      const payments = gig?.payments ?? [];
      eraBreakdown.forEach((e, i) => {
        const b = payments[i]?.biller;
        e.biller = b?.id ? { id: b.id, name: b.name } : null;
      });
      // Founder settlement model. The biller COLLECTS the full instalment from the
      // customer; the kate (instalment − workers' palkat) is split EQUALLY between
      // the founders as passive income; the biller then pays the workers' palkat
      // and the OTHER founders their kate share, keeping their own share. Computed
      // only for BILLED erät (where cash actually moved). Per billed erä we return a
      // settlement "kuitti" so the biller sees exactly why they're left with X.
      const founderList = BRAND_BILLERS.map((b) => ({ id: b.id, name: b.name }));
      const n = Math.max(1, founderList.length);
      const founders = founderList.map((f) => ({ id: f.id, name: f.name, billedCents: 0, kateShareCents: 0 }));
      const idxOf = (id?: string) => founders.findIndex((f) => f.id === id);
      const settlements = eraBreakdown
        .filter((e) => e.biller?.id)
        .map((e) => {
          const kate = e.marginCents;
          const base = Math.floor(kate / n);
          // Remainder cent(s) go to the first founder so shares reconcile exactly.
          const shares = founders.map((f, i) => ({ id: f.id, name: f.name, cents: i === 0 ? kate - base * (n - 1) : base }));
          shares.forEach((s) => { const j = idxOf(s.id); if (j >= 0) founders[j].kateShareCents += s.cents; });
          const bj = idxOf(e.biller!.id);
          if (bj >= 0) founders[bj].billedCents += e.instalmentCents;
          return {
            era: e.era,
            billerId: e.biller!.id || "",
            billerName: e.biller!.name || (bj >= 0 ? founders[bj].name : ""),
            instalmentCents: e.instalmentCents,
            palkatCents: e.earnedCents,
            kateCents: kate,
            billerShareCents: shares.find((s) => s.id === e.biller!.id)?.cents ?? 0,
            paysOut: shares.filter((s) => s.id !== e.biller!.id), // biller pays each other founder this
          };
        });
      const founderSettlement = { founders, settlements };
      res.json({
        ok: true, crew, building: project.building, version: WORKER_AGREEMENT_VERSION,
        deal, totalBillable, billableWashed, eraWindows: project.eraWindows ?? null, eraBreakdown, founderSettlement,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Single-person admin view: aggregate ONE worker across every gig — profile,
  // money movement (earned / paid / open + each payout tagged with its keikka),
  // and documents. Used by /admin/tiimi/:workerId. Host-facing.
  const matchesWorkerExact = (m: CrewMember, wid: string) =>
    m.id.toLowerCase() === wid || (m.linkedUserId ?? "").toLowerCase() === wid;
  // First-name fallback (like the /tyo login linking): admin ids are first
  // names (oona, oliver, …) but old crew rows may lack linkedUserId. Never
  // overrides an explicit linkedUserId pointing at someone else, and is only
  // consulted when NO exact match exists anywhere.
  const matchesWorkerByName = (m: CrewMember, wid: string) =>
    !m.linkedUserId && (m.name ?? "").trim().split(/\s+/)[0].toLowerCase() === wid;

  app.get("/api/admin/worker/:workerId", async (req, res) => {
    try {
      const wid = String(req.params.workerId).toLowerCase();
      const allJobs = await db.select().from(jobs);
      let worker: any = null;
      let payouts: any[] = [];
      let documents: any[] = [];
      let earnedCents = 0, paidCents = 0;
      const collect = (pred: (m: CrewMember, wid: string) => boolean) => {
        worker = null; payouts = []; documents = []; earnedCents = 0; paidCents = 0;
        for (const job of allJobs) {
          const project = parseProject(job.projectData ?? null);
          const m = (project?.crew || []).find((c) => pred(c, wid));
          if (!m) continue;
          const gigName = job.description || project!.building?.name || `Keikka #${job.id}`;
          const stats = crewMemberStats(project!, m);
          earnedCents += stats.earnedCents;
          for (const p of (m.payouts || [])) {
            if (p.status === "maksettu") paidCents += p.amountCents;
            payouts.push({ ...p, jobId: job.id, gigName, token: m.token });
          }
          for (const d of (m.documents || [])) documents.push({ ...d, jobId: job.id });
          if (!worker) {
            worker = {
              id: m.id, name: m.name, role: m.role, token: m.token,
              photoDataUrl: m.profile?.photoDataUrl,
              phone: m.profile?.phone, email: m.profile?.email,
              yTunnus: m.profile?.yTunnus, city: m.profile?.city,
              answers: m.profile?.answers ?? {},
            };
          }
        }
      };
      collect(matchesWorkerExact);
      if (!worker) collect(matchesWorkerByName);
      // Founders (and other admins) may not be crew on any gig — never 404 the
      // bosses' own pages: build the profile from the biller registry instead.
      if (!worker) {
        const biller = BRAND_BILLERS.find((b) => b.id === wid);
        if (biller) {
          worker = {
            id: biller.id, name: biller.name, role: "host", token: "",
            email: biller.email, yTunnus: biller.yTunnus, city: biller.address,
            answers: {},
          };
        }
      }
      if (!worker) return res.status(404).json({ error: "Työntekijää ei löytynyt" });
      payouts.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      documents.sort((a, b) => (b.date || 0) - (a.date || 0));

      // ── Asiakaslaskutus — the person's SENT customer invoices, computed live
      // from the jobs so past gigs are always included (nothing to backfill):
      //  · small jobs where this person billed (billedBy)
      //  · gig instalments (FR8) whose recorded payment carries their biller id
      //    (legacy payments without a biller default to the first founder, the
      //    same rule the ALV turnover uses).
      const customerRows2 = await db.select({ id: customers.id, name: customers.name }).from(customers);
      const custName = new Map(customerRows2.map((c) => [c.id, c.name]));
      const customerInvoices: { jobId: number; dateMs: number; name: string; ref?: string; amountCents: number; source: "keikka" | "era" }[] = [];
      for (const job of allJobs) {
        if (job.gigData) {
          let gig: GigData | null = null;
          try { gig = sanitizeGigData(JSON.parse(job.gigData)); } catch { gig = null; }
          const gigName = gig?.company?.name || job.description || `Keikka #${job.id}`;
          (gig?.payments || []).forEach((p, i) => {
            if (!p?.amountCents || p.amountCents <= 0) return;
            // Explicit biller only — an unattributed instalment is NOBODY's
            // invoice until a founder assigns it (Verotus → ALV card).
            if (p.biller?.id !== wid) return;
            customerInvoices.push({
              jobId: job.id,
              dateMs: p.t || new Date(job.updatedAt ?? job.createdAt).getTime(),
              name: `${gigName} — erä ${i + 1}`,
              amountCents: p.amountCents, source: "era",
            });
          });
        }
        if (!job.isCustomGig && !job.gigData && job.status === "done" && job.quoteStatus !== "declined" && inferBillerId(job) === wid) {
          const total = effectiveJobTotal(job);
          if (total <= 0) continue;
          customerInvoices.push({
            jobId: job.id,
            dateMs: new Date(job.scheduledAt ?? job.createdAt).getTime(),
            name: custName.get(job.customerId) || job.description || `Keikka #${job.id}`,
            ref: formatFinnishRef(finnishRefWithCheckDigit(String(job.id))),
            amountCents: total, source: "keikka",
          });
        }
      }
      customerInvoices.sort((a, b) => b.dateMs - a.dateMs);

      // Founder-to-founder settlement history involving this person (vastalaskut
      // + MobilePay-kirjaukset) — their money trail in one place.
      const settlementRows = FOUNDER_IDS.includes(wid)
        ? (await db.select().from(founderSettlements).orderBy(desc(founderSettlements.createdAt)))
            .filter((s) => s.fromId === wid || s.toId === wid)
            .map((s) => ({ id: s.id, fromId: s.fromId, toId: s.toId, cents: s.cents, invoiceNo: s.invoiceNo ?? undefined, createdAtMs: new Date(s.createdAt).getTime() }))
        : [];

      res.json({
        ok: true, worker,
        totals: { earnedCents, paidCents, openCents: Math.max(0, earnedCents - paidCents) },
        payouts, documents, customerInvoices, settlements: settlementRows,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Host attaches a document (receipt/invoice) to a worker by hand. Stored on the
  // member in the first gig they belong to; retention = date + 6 years.
  app.post("/api/admin/worker/:workerId/document", async (req, res) => {
    try {
      const wid = String(req.params.workerId).toLowerCase();
      const { date, desc, amountCents, fileName, fileDataUrl, kind } = (req.body || {}) as Record<string, any>;
      const dt = Number(date) || Date.now();
      const doc: CrewDocument = {
        id: `doc_${randomUUID().slice(0, 12)}`,
        date: dt,
        desc: String(desc ?? "").slice(0, 300).trim(),
        amountCents: amountCents != null && Number.isFinite(Number(amountCents)) ? Math.max(0, Math.round(Number(amountCents))) : undefined,
        fileName: fileName ? String(fileName).slice(0, 200) : undefined,
        fileDataUrl: typeof fileDataUrl === "string" && /^data:(image\/|application\/pdf)/.test(fileDataUrl) ? fileDataUrl.slice(0, MAX_CREW_DOC_LEN) : undefined,
        kind: kind === "kuitti" || kind === "lasku" ? kind : "muu",
        retentionUntil: retentionFromDate(dt),
        addedAt: Date.now(),
      };
      if (!doc.desc && !doc.fileDataUrl) return res.status(400).json({ error: "Anna kuvaus tai tiedosto." });
      const ok = await attachPersonDocument(wid, doc);
      if (!ok) return res.status(404).json({ error: "Työntekijää ei löytynyt" });
      return res.json({ ok: true, document: doc });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Attach a document to a person's Dokumentit: exact crew match first, then
  // first-name fallback; founders who aren't crew anywhere get a hidden
  // host-role holder member (active:false + 1-cent rate so payroll/kate math
  // never shifts). Shared by the manual-document endpoint and the automatic
  // settlement tositteet.
  async function attachPersonDocument(wid: string, doc: CrewDocument, dedupe = false): Promise<boolean> {
    const allJobs = await db.select().from(jobs);
    for (const pred of [matchesWorkerExact, matchesWorkerByName]) {
      for (const job of allJobs) {
        const project = parseProject(job.projectData ?? null);
        if (!project?.crew) continue;
        const idx = project.crew.findIndex((c) => pred(c, wid));
        if (idx < 0) continue;
        // Automatic filings pass dedupe: re-sending the same invoice or
        // re-issuing the same vastalasku must not stack identical rows in
        // the 6-year register (same desc + amount = the same tosite).
        if (dedupe && (project.crew[idx].documents || []).some(
          (d) => d.desc === doc.desc && d.amountCents === doc.amountCents,
        )) return true;
        project.crew[idx] = { ...project.crew[idx], documents: [doc, ...(project.crew[idx].documents || [])] };
        await saveProject(job, project);
        return true;
      }
    }
    const biller = BRAND_BILLERS.find((b) => b.id === wid);
    if (biller) {
      for (const job of allJobs) {
        const project = parseProject(job.projectData ?? null);
        if (!project) continue;
        const member = sanitizeCrewMember({
          id: biller.id, token: await genUniqueCrewToken(), name: biller.name,
          role: "host", adminLinked: true, active: false, perWindowCents: 1,
          agreements: [], notes: [], createdAt: Date.now(), documents: [doc],
        });
        if (!member) break;
        project.crew = [...(project.crew || []), member];
        await saveProject(job, project);
        return true;
      }
    }
    return false;
  }

  // Attribute (or correct) WHO billed a recorded gig instalment. Legacy
  // payments recorded before the biller field existed carry no biller — they
  // are excluded from ALV turnover, the invoice register and the founder debt
  // until a founder assigns them here (Verotus → ALV card → one-tap).
  app.post("/api/jobs/:id/gig-payment-biller", async (req, res) => {
    try {
      const jobId = Number(req.params.id);
      const idx = Math.floor(Number(req.body?.index));
      const billerId = String(req.body?.billerId ?? "").toLowerCase();
      const biller = BRAND_BILLERS.find((b) => b.id === billerId);
      if (!biller || !Number.isFinite(idx) || idx < 0) {
        return res.status(400).json({ error: "Virheellinen laskuttaja tai erä" });
      }
      const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
      const gig = parseGig(job?.gigData ?? null);
      if (!gig || !gig.payments[idx]) return res.status(404).json({ error: "Erämaksua ei löydy" });
      gig.payments[idx] = {
        ...gig.payments[idx],
        biller: { id: biller.id, name: biller.name, yTunnus: biller.yTunnus },
      };
      await db.update(jobs).set({ gigData: JSON.stringify(gig), updatedAt: new Date() }).where(eq(jobs.id, jobId));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Founders set the per-erä (instalment) window counts for the fixed deal. Pure
  // display/planning data (drives the per-erä kate on the payroll page); does NOT
  // affect worker pay or the earnings model.
  app.post("/api/jobs/:id/project/era-windows", async (req, res) => {
    try {
      const loaded = await loadJobProject(Number(req.params.id));
      if (!loaded) return res.status(404).json({ error: "Keikkaa ei löydy" });
      const { job, project } = loaded;
      const raw = Array.isArray(req.body?.windows) ? req.body.windows : null;
      if (!raw) return res.status(400).json({ error: "windows-taulukko puuttuu" });
      const windows = raw.slice(0, 24).map((n: any) => Math.max(0, Math.min(100000, Math.floor(Number(n) || 0))));
      project.eraWindows = windows;
      const saved = await saveProject(job, project);
      res.json({ ok: true, eraWindows: saved.eraWindows ?? windows });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // The logged-in admin's OWN gig worker memberships. Some Puuhapatet admins
  // (e.g. Petrus) are also workers on a gig (adminLinked crew). This lets their
  // admin dashboard show a small "your gig earnings + open your worker view"
  // card without exposing the gig total or other workers' euros. Scans active
  // jobs for a crew member matching the caller's admin id (or linkedUserId).
  app.get("/api/me/gig-worker", async (req, res) => {
    try {
      const sub = String((req as any).admin?.sub ?? "").toLowerCase();
      if (!sub) return res.json({ ok: true, gigs: [] });
      const rows = await db.select().from(jobs)
        .where(and(ne(jobs.status, "cancelled"), ne(jobs.status, "lead")));
      const gigs: Array<{
        jobId: number; gigName: string; token: string;
        washed: number; earnedCents: number; paidCents: number; pendingCents: number;
      }> = [];
      for (const job of rows) {
        const project = parseProject(job.projectData ?? null);
        if (!project) continue;
        const member = (project.crew || []).find(
          (m) => m.active && (m.id.toLowerCase() === sub || (m.linkedUserId ?? "").toLowerCase() === sub),
        );
        if (!member) continue;
        const stats = crewMemberStats(project, member);
        const paidCents = totalPaidPayoutCents(member);
        const pendingCents = (member.payouts || [])
          .filter((p) => p.status !== "maksettu")
          .reduce((s, p) => s + p.amountCents, 0);
        // Neutral gig name: company name → building name → job description.
        let gigName = project.building?.name || "";
        try {
          const gd = job.gigData ? JSON.parse(job.gigData) : null;
          if (gd?.company?.name) gigName = String(gd.company.name);
        } catch { /* ignore */ }
        if (!gigName) gigName = job.description || `Keikka #${job.id}`;
        gigs.push({
          jobId: job.id, gigName, token: member.token,
          washed: stats.washed, earnedCents: stats.earnedCents, paidCents, pendingCents,
        });
      }
      res.json({ ok: true, gigs });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Seed the default roster (Petrus + 5 placeholders) if the crew is empty.
  app.post("/api/jobs/:id/crew/seed", async (req, res) => {
    try {
      const loaded = await loadJobProject(Number(req.params.id));
      if (!loaded) return res.status(404).json({ error: "Keikkaa ei löydy" });
      const { job, project } = loaded;
      if ((project.crew || []).length > 0) {
        return res.json({ ok: true, crew: project.crew, alreadySeeded: true });
      }
      const now = Date.now();
      const taken = await collectAllCrewTokens();
      const mkToken = () => { let t = newCrewToken(); while (taken.has(t)) t = newCrewToken(); taken.add(t); return t; };
      const mk = (id: string, name: string, opts: Partial<CrewMember> = {}): CrewMember => ({
        id, token: mkToken(), name, role: "worker", perWindowCents: DEFAULT_WORKER_PER_WINDOW_CENTS,
        active: true, agreements: [], notes: [], createdAt: now, ...opts,
      });
      const roster: CrewMember[] = [
        // Hosts (Joonatan + Matias) — see admin views, not part of the worker roster UI.
        mk("joonatan", "Joonatan Juuri", { role: "host", adminLinked: true }),
        mk("matias", "Matias Pitkänen", { role: "host", adminLinked: true }),
        // Petrus is kept in data but masked from this gig (adminLinked → filtered out).
        mk("petrus", "Petrus Aalto", { adminLinked: true }),
        // 5 placeholder subcontractor slots — names + links filled in later.
        ...[1, 2, 3, 4, 5].map((n) => mk(`tyontekija${n}`, `Työntekijä ${n}`)),
      ];
      project.crew = roster;
      const saved = await saveProject(job, project);
      res.json({ ok: true, crew: saved.crew });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Add a single worker (host).
  app.post("/api/jobs/:id/crew", async (req, res) => {
    try {
      const loaded = await loadJobProject(Number(req.params.id));
      if (!loaded) return res.status(404).json({ error: "Keikkaa ei löydy" });
      const { job, project } = loaded;
      const existing = project.crew || [];
      const baseId = String(req.body?.id ?? `tyontekija${existing.length + 1}`).slice(0, 40).replace(/[^a-z0-9]/gi, "").toLowerCase() || `w${Date.now().toString(36)}`;
      let id = baseId, n = 1;
      while (existing.some((m) => m.id === id)) id = `${baseId}${++n}`;
      const member = sanitizeCrewMember({
        id,
        token: await genUniqueCrewToken(),
        name: req.body?.name || `Työntekijä ${existing.length + 1}`,
        role: req.body?.role === "host" ? "host" : "worker",
        adminLinked: !!req.body?.adminLinked,
        perWindowCents: req.body?.perWindowCents ?? DEFAULT_WORKER_PER_WINDOW_CENTS,
        active: true, agreements: [], notes: [], createdAt: Date.now(),
      });
      if (!member) return res.status(400).json({ error: "Virheelliset tiedot" });
      project.crew = [...existing, member];
      const saved = await saveProject(job, project);
      res.json({ ok: true, member, crew: saved.crew });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Update a worker's editable fields (host): name, rate, active, role.
  app.patch("/api/jobs/:id/crew/:memberId", async (req, res) => {
    try {
      const loaded = await loadJobProject(Number(req.params.id));
      if (!loaded) return res.status(404).json({ error: "Keikkaa ei löydy" });
      const { job, project } = loaded;
      const mid = String(req.params.memberId);
      // Mint a globally-unique replacement token up front if rotating.
      const rotatedToken = req.body?.rotateToken ? await genUniqueCrewToken() : null;
      let updated: CrewMember | null = null;
      project.crew = (project.crew || []).map((m) => {
        if (m.id !== mid) return m;
        updated = sanitizeCrewMember({
          ...m,
          name: req.body?.name ?? m.name,
          perWindowCents: req.body?.perWindowCents ?? m.perWindowCents,
          active: typeof req.body?.active === "boolean" ? req.body.active : m.active,
          role: req.body?.role ?? m.role,
          // Link / unlink an admin login user to this dashboard ("" clears it).
          linkedUserId: req.body?.linkedUserId === undefined ? m.linkedUserId : (req.body.linkedUserId || undefined),
          // Manual earnings override (managers' dashboard); null/"" clears it.
          manualEarningsCents: req.body?.manualEarningsCents === undefined
            ? m.manualEarningsCents
            : (req.body.manualEarningsCents == null || req.body.manualEarningsCents === "" ? undefined : Number(req.body.manualEarningsCents)),
          // Host can rotate a leaked link — the old link dies immediately.
          token: rotatedToken ?? m.token,
        });
        return updated ?? m;
      });
      if (!updated) return res.status(404).json({ error: "Työntekijää ei löydy" });
      const saved = await saveProject(job, project);
      res.json({ ok: true, member: updated, crew: saved.crew });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Remove a worker (host).
  app.delete("/api/jobs/:id/crew/:memberId", async (req, res) => {
    try {
      const loaded = await loadJobProject(Number(req.params.id));
      if (!loaded) return res.status(404).json({ error: "Keikkaa ei löydy" });
      const { job, project } = loaded;
      const mid = String(req.params.memberId);
      project.crew = (project.crew || []).filter((m) => m.id !== mid);
      const saved = await saveProject(job, project);
      res.json({ ok: true, crew: saved.crew });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Host logs a worker's whole day on their behalf and emails them the summary.
  // Records the given hours in the ledger + a diary session counting the windows
  // that worker marked pesty today, then sends the same day-summary email the
  // worker would get from "Päätä päivä". Lets a leader close out the team's day.
  app.post("/api/jobs/:id/crew/:memberId/log-day", async (req, res) => {
    try {
      const loaded = await loadJobProject(Number(req.params.id));
      if (!loaded) return res.status(404).json({ error: "Keikkaa ei löydy" });
      const { job, project } = loaded;
      const mid = String(req.params.memberId);
      const member = (project.crew || []).find((m) => m.id === mid);
      if (!member) return res.status(404).json({ error: "Työntekijää ei löydy" });
      const hours = Math.round((Number(req.body?.hours) || 0) * 100) / 100;
      const minutes = Math.max(0, Math.round(hours * 60));
      // Windows this worker marked pesty today — count each window once.
      const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
      const todayKeys = new Set<string>();
      for (const l of project.log || []) {
        if (l.by === member.id && l.status === "pesty" && l.ts >= startOfDay.getTime()) todayKeys.add(l.key);
      }
      const windows = todayKeys.size;
      if (minutes === 0 && windows === 0) return res.status(400).json({ error: "Ei tunteja eikä ikkunoita kirjattavaksi" });
      const end = Date.now();
      const session = { start: end - minutes * 60000, end, minutes, windows, earnedCents: windows * member.perWindowCents, manual: true };
      if (hours > 0) {
        project.hours[member.id] = Math.max(0, +(((project.hours[member.id] || 0) + hours).toFixed(2)));
        project.hourLog = [{ worker: member.id, delta: hours, ts: end, by: "johtaja" }, ...(project.hourLog || [])].slice(0, 200);
      }
      project.crew = (project.crew || []).map((m) =>
        m.id !== member.id ? m : { ...m, sessions: [...(m.sessions || []), session].slice(-200) },
      );
      const saved = await saveProject(job, project);
      const savedMember = findCrewByToken(saved, member.token)!;
      let emailed = false;
      if (resend && savedMember.profile?.email) {
        try { await sendSessionSummaryEmail(savedMember, session, project.building?.name); emailed = true; }
        catch (e: any) { console.warn("manager day-log email failed:", e?.message); }
      }
      res.json({ ok: true, crew: saved.crew, windows, emailed });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ── Worker payouts (Puuhapatet → alihankkija) ───────────────────────────────
  // Host-only. Creating a payout sends the worker a "first payment" notification
  // they approve from their /tyo link. Marking it paid (after the manual bank
  // transfer) auto-generates the worker's invoice (their Y-tunnus → Puuhapatet)
  // and emails it to the team.

  // Create a payout notification for a worker.
  app.post("/api/jobs/:id/crew/:memberId/payout", async (req, res) => {
    try {
      const loaded = await loadJobProject(Number(req.params.id));
      if (!loaded) return res.status(404).json({ error: "Keikkaa ei löydy" });
      const { job, project } = loaded;
      const mid = String(req.params.memberId);
      const member = (project.crew || []).find((m) => m.id === mid);
      if (!member) return res.status(404).json({ error: "Työntekijää ei löydy" });
      // Trainees don't invoice us — earnings are handled by their responsible
      // leader, not via the alihankkija payout flow.
      if (isCrewTrainee(member)) {
        return res.status(400).json({ error: "Harjoittelijalle ei luoda alihankkijamaksua — korvaus hoidetaan tiimin kautta." });
      }
      const amountCents = Math.floor(Number(req.body?.amountCents));
      if (!Number.isFinite(amountCents) || amountCents <= 0) {
        return res.status(400).json({ error: "Virheellinen summa" });
      }
      // Buyer = the leader (their Y-tunnus) who billed the customer for this money;
      // the worker invoices them. Defaults to the first leader / company if unset.
      const buyer = resolveBuyer(req.body?.billerId ? String(req.body.billerId) : null);
      const payout = {
        id: `po_${randomUUID().slice(0, 12)}`,
        amountCents: Math.min(amountCents, 1_000_000_00),
        windows: Math.max(0, Math.floor(Number(req.body?.windows) || 0)),
        note: req.body?.note ? String(req.body.note).slice(0, 200) : undefined,
        status: "ilmoitettu" as const,
        createdAt: Date.now(),
        buyer,
      };
      const payouts = [payout, ...(member.payouts || [])];
      project.crew = (project.crew || []).map((m) => (m.id === mid ? { ...m, payouts } : m));
      const saved = await saveProject(job, project);
      res.json({ ok: true, member: (saved.crew || []).find((m) => m.id === mid) });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Delete a payout notification (host-only). Only NON-paid payouts can be removed
  // — a paid one has an issued invoice and must stay. Lets the host scrap a wrong
  // payout and create a fresh one.
  app.delete("/api/jobs/:id/crew/:memberId/payout/:payoutId", async (req, res) => {
    try {
      const loaded = await loadJobProject(Number(req.params.id));
      if (!loaded) return res.status(404).json({ error: "Keikkaa ei löydy" });
      const { job, project } = loaded;
      const mid = String(req.params.memberId);
      const pid = String(req.params.payoutId);
      const member = (project.crew || []).find((m) => m.id === mid);
      if (!member) return res.status(404).json({ error: "Työntekijää ei löydy" });
      const payout = (member.payouts || []).find((p) => p.id === pid);
      if (!payout) return res.status(404).json({ error: "Maksua ei löytynyt" });
      if (payout.status === "maksettu") {
        return res.status(409).json({ error: "Maksettua maksua ei voi poistaa (lasku on jo luotu)." });
      }
      const payouts = (member.payouts || []).filter((p) => p.id !== pid);
      project.crew = (project.crew || []).map((m) => (m.id === mid ? { ...m, payouts } : m));
      const saved = await saveProject(job, project);
      res.json({ ok: true, member: (saved.crew || []).find((m) => m.id === mid) });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Mark a payout as paid (after manual bank transfer): generate the worker's
  // invoice PDF and email it to the team. Idempotent-ish: only acts when not
  // already paid.
  app.post("/api/jobs/:id/crew/:memberId/payout/:payoutId/paid", async (req, res) => {
    try {
      const loaded = await loadJobProject(Number(req.params.id));
      if (!loaded) return res.status(404).json({ error: "Keikkaa ei löydy" });
      const { job, project } = loaded;
      const mid = String(req.params.memberId);
      const pid = String(req.params.payoutId);
      const member = (project.crew || []).find((m) => m.id === mid);
      if (!member) return res.status(404).json({ error: "Työntekijää ei löydy" });
      const payouts = member.payouts || [];
      const payout = payouts.find((p) => p.id === pid);
      if (!payout) return res.status(404).json({ error: "Maksua ei löytynyt" });
      if (payout.status === "maksettu") {
        return res.status(409).json({ error: "Maksu on jo merkitty maksetuksi" });
      }
      // Server-side approval gate: the worker MUST have approved (self-billing,
      // AVL 209 b §) before we mark paid & generate their invoice. The admin UI
      // already enforces this, but a direct API call must not bypass it.
      if (payout.status !== "hyvaksytty") {
        return res.status(409).json({ error: "Työntekijän on ensin hyväksyttävä maksu." });
      }

      const billing = payout.billing || {};
      const workerName = billing.name || member.profile?.fullName || member.name;
      const workerYTunnus = billing.yTunnus || member.profile?.yTunnus || undefined;
      const workerIban = billing.iban || member.profile?.iban || undefined;
      const workerAddress = billing.address || member.profile?.city || undefined;
      const paidCount = payouts.filter((p) => p.status === "maksettu").length;
      const invoiceNo = `${member.id.toUpperCase().slice(0, 6)}-${String(paidCount + 1).padStart(2, "0")}`;
      const now = Date.now();
      const invoiceDate = new Date(now).toLocaleDateString("fi-FI");

      // Vero-erittely: ALV laskuttajan ALV-aseman mukaan + ennakonpidätys, jos
      // laskuttaja ei ole ennakkoperintärekisterissä. amountCents on työkorvaus
      // ilman ALV:tä (pestyt ikkunat × hinta). Admin voi antaa withholdingRate-
      // ohituksen (esim. 0.13 oikeushenkilölle tai verokortin %).
      const answers = member.profile?.answers;
      const overrideRate = Number(req.body?.withholdingRate);
      const hasOverride = Number.isFinite(overrideRate) && overrideRate >= 0 && overrideRate <= 1;
      // Reuse the snapshot frozen at approval (what the worker actually approved),
      // unless the admin explicitly overrides the withholding rate at payment.
      const tax = (payout.tax && !hasOverride) ? payout.tax : computeTax({
        laborCents: payout.amountCents,
        vatStatus: readVatStatus(answers),
        inPrepaymentRegister: readInPrepaymentRegister(answers),
        payeeType: readPayeeType(answers),
        withholdingRate: hasOverride ? overrideRate : undefined,
      });

      // Buyer = the leader who billed the customer. Use the one chosen at creation;
      // allow an override at payment time (req.body.billerId), else keep/resolve.
      const buyer = req.body?.billerId
        ? resolveBuyer(String(req.body.billerId))
        : (payout.buyer ?? resolveBuyer(null));

      payout.status = "maksettu";
      payout.paidAt = now;
      payout.invoiceNo = invoiceNo;
      payout.billing = { name: workerName, yTunnus: workerYTunnus, iban: workerIban, address: workerAddress };
      payout.tax = tax;
      payout.buyer = buyer;

      project.crew = (project.crew || []).map((m) => (m.id === mid ? { ...m, payouts } : m));
      const saved = await saveProject(job, project);

      // Generate the worker's invoice PDF and email it to the team (best-effort).
      const fmtEur = (c: number) => (c / 100).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
      let emailId: string | undefined;
      try {
        const pdf = await generateWorkerInvoicePdf({
          invoiceNo, workerName, workerYTunnus, workerAddress, workerIban,
          windows: payout.windows, amountCents: payout.amountCents,
          note: payout.note, invoiceDate, paidDate: invoiceDate, tax, buyer,
          acceptedAt: payout.approvedAt,
          expenses: payout.expenses,
        });
        if (resend) {
          const html = `
<!DOCTYPE html><html lang="fi"><body style="margin:0;background:#F6F4EE;font-family:'Poppins',ui-sans-serif,system-ui,sans-serif">
  <div style="max-width:600px;margin:24px auto;background:#fff;border:1px solid #E4E1D7;border-radius:14px;overflow:hidden">
    <div style="padding:24px 32px;border-bottom:1px solid #E4E1D7">
      <p style="margin:0;font-size:20px;font-weight:700;color:#1A1A1A">Puuhapatet</p>
      <p style="margin:4px 0 0;font-size:13px;color:#8C8A82">Alihankkijan lasku · ${invoiceNo}</p>
    </div>
    <div style="padding:24px 32px">
      <p style="margin:0 0 16px;font-size:14px;color:#1A1A1A;line-height:1.7">
        Lasku <strong>${workerName}</strong> → <strong>${buyer.name}</strong>${buyer.yTunnus ? ` (Y-tunnus ${buyer.yTunnus})` : ""}.
        Maksu on merkitty maksetuksi. Liitteenä alihankkijan lasku (tosite).
      </p>
      <table width="100%" style="border-collapse:collapse;border-top:2px solid #1A1A1A">
        <tr><td style="padding:10px 0;font-size:13px;color:#1A1A1A">${payout.note || "Ikkunanpesutyö"}${payout.windows ? ` · ${payout.windows} ikkunaa` : ""} (veroton)</td>
        <td style="padding:10px 0;text-align:right;font-size:14px;color:#1A1A1A">${fmtEur(tax.laborCents)}</td></tr>
        ${tax.vatRegistered ? `<tr><td style="padding:4px 0;font-size:13px;color:#8C8A82">ALV ${fmtPct(tax.vatRate)}</td><td style="padding:4px 0;text-align:right;font-size:13px;color:#8C8A82">${fmtEur(tax.vatCents)}</td></tr>` : ""}
        ${tax.withheld ? `<tr><td style="padding:4px 0;font-size:13px;color:#8C8A82">Ennakonpidätys ${fmtPct(tax.withholdingRate)}</td><td style="padding:4px 0;text-align:right;font-size:13px;color:#8C8A82">−${fmtEur(tax.withholdingCents)}</td></tr>` : ""}
        <tr><td style="padding:10px 0;border-top:1px solid #E4E1D7;font-size:14px;font-weight:800;color:#1A1A1A">${tax.withheld ? "Maksetaan tilille" : "Maksettavaa"}</td>
        <td style="padding:10px 0;border-top:1px solid #E4E1D7;text-align:right;font-size:16px;font-weight:800;color:#1A1A1A">${fmtEur(tax.payableCents)}</td></tr>
      </table>
      <div style="background:#F6F4EE;border-radius:12px;padding:16px 20px;margin-top:16px;font-size:13px;color:#1A1A1A">
        <p style="margin:0 0 4px">Myyjä: ${workerName}${workerYTunnus ? ` · Y-tunnus ${workerYTunnus}` : ""}</p>
        ${workerIban ? `<p style="margin:0 0 4px">IBAN: ${workerIban}</p>` : ""}
        <p style="margin:0">Ostaja: ${buyer.name}${buyer.yTunnus ? ` · Y-tunnus ${buyer.yTunnus}` : ""}</p>
        ${tax.withheld ? `<p style="margin:8px 0 0;color:#8a5a12">Huom: myyjä ei ole ennakkoperintärekisterissä → ennakonpidätys ${fmtPct(tax.withholdingRate)} (${fmtEur(tax.withholdingCents)}) tilitettävä Verolle.</p>` : ""}
      </div>
    </div>
  </div>
</body></html>`;
          // 1) Team copy (record-keeping).
          const result = await resend.emails.send({
            from: FROM_EMAIL,
            to: WORKER_NOTIFICATION_EMAILS,
            subject: `Alihankkijan lasku ${invoiceNo} — ${workerName} → ${buyer.name} · ${fmtEur(tax.payableCents)}`,
            html,
            attachments: [{ filename: `lasku-${invoiceNo}.pdf`, content: pdf.toString("base64") }],
          });
          emailId = result.data?.id;

          // 2) The worker's OWN copy — their tosite/proof of the invoice they issued.
          const workerEmail = member.profile?.email;
          if (workerEmail) {
            const workerHtml = `
<!DOCTYPE html><html lang="fi"><body style="margin:0;background:#F6F4EE;font-family:'Poppins',ui-sans-serif,system-ui,sans-serif">
  <div style="max-width:600px;margin:24px auto;background:#fff;border:1px solid #E4E1D7;border-radius:14px;overflow:hidden">
    <div style="padding:24px 32px;border-bottom:1px solid #E4E1D7">
      <p style="margin:0;font-size:20px;font-weight:700;color:#1A1A1A">Puuhapatet</p>
      <p style="margin:4px 0 0;font-size:13px;color:#8C8A82">Sinun laskusi · ${invoiceNo}</p>
    </div>
    <div style="padding:24px 32px;font-size:14px;color:#1A1A1A;line-height:1.7">
      <p style="margin:0 0 14px">Hei${(workerName || "").split(" ")[0] ? ` ${workerName.split(" ")[0]}` : ""}! Tässä on lasku, jonka teit työstäsi.
        Säilytä se tositteena kirjanpitoasi varten — sama PDF on liitteenä.</p>
      <div style="background:#F6F4EE;border-radius:12px;padding:16px 20px;font-size:13px">
        <p style="margin:0 0 4px"><strong>Lasku ${invoiceNo}</strong> · ${invoiceDate}</p>
        <p style="margin:0 0 4px">Saaja (ostaja): ${buyer.name}${buyer.yTunnus ? ` · Y-tunnus ${buyer.yTunnus}` : ""}</p>
        <p style="margin:0 0 4px">Veroton: ${fmtEur(tax.laborCents)}${tax.vatRegistered ? ` · ALV ${fmtPct(tax.vatRate)} ${fmtEur(tax.vatCents)}` : ""}</p>
        ${tax.withheld ? `<p style="margin:0 0 4px;color:#8a5a12">Ennakonpidätys ${fmtPct(tax.withholdingRate)}: −${fmtEur(tax.withholdingCents)} (tilitetään Verolle, luetaan hyväksesi verotuksessa)</p>` : ""}
        <p style="margin:8px 0 0;font-size:15px;font-weight:800">Tilillesi maksettu: ${fmtEur(tax.payableCents)}</p>
      </div>
      ${tax.withheld ? `<p style="margin:14px 0 0;font-size:12.5px;color:#8C8A82">Vinkki: kun rekisteröidyt ennakkoperintärekisteriin (ytj.fi), saat jatkossa koko summan tilille ja hoidat verot itse.</p>` : ""}
    </div>
  </div>
</body></html>`;
            try {
              await resend.emails.send({
                from: FROM_EMAIL,
                to: workerEmail,
                subject: `Sinun laskusi ${invoiceNo} — ${fmtEur(tax.payableCents)} · Puuhapatet`,
                html: workerHtml,
                attachments: [{ filename: `lasku-${invoiceNo}.pdf`, content: pdf.toString("base64") }],
              });
            } catch (e) {
              console.error("Worker self-copy invoice email error:", e);
            }
          }
        }
      } catch (e) {
        console.error("Worker invoice email error:", e);
      }

      res.json({ ok: true, member: (saved.crew || []).find((m) => m.id === mid), emailId });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AI ASSISTANT — public chat bot, live admin handoff, and in-admin assistant
  // ═══════════════════════════════════════════════════════════════════════════

  const MAX_MSG_LEN = 4000;
  const HISTORY_LIMIT = 20;  // turns kept as model context
  const DISPLAY_LIMIT = 100; // messages returned to the client for rendering

  // Lets the admin UI show a clear "add your API key" hint when AI is off.
  // Consumed by the admin assistant + dashboard briefing — "is the assistant
  // available", true when either the Claude or the Groq provider is configured.
  app.get("/api/ai-status", (_req, res) => res.json({ enabled: AI_ENABLED || ADMIN_AI_ENABLED }));

  function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Ordered oldest→newest. Order by id (monotonic) so same-second inserts are stable.
  async function loadHistory(conversationId: number, limit = DISPLAY_LIMIT) {
    const rows = await db.select().from(chatMessages)
      .where(eq(chatMessages.conversationId, conversationId))
      .orderBy(desc(chatMessages.id))
      .limit(limit);
    return rows.reverse();
  }

  // Detect when a visitor wants a real person, so the bot can offer a handoff.
  function wantsHuman(text: string): boolean {
    return /\b(ihmis|oikea(n|lle)? henkil|asiakaspalvelu|soit(a|taa|takaa)|yhteyden?otto|ota yhteyt|jutella tiimi|puhua jonku|real person|human|talk to (a|someone|the team)|call me|contact me)\b/i.test(text);
  }

  // ─── Public: visitor sends a message to the bot ────────────────────────────
  // Stateless by design. Conversation memory lives ONLY in the visitor's
  // browser session (sent up as `history` each turn) and clears when they
  // leave — we never persist casual chats. The ONLY thing that reaches the
  // team is an explicit handoff (see /api/chat/handoff), kept as a lead note.
  //
  // Body: { message, history?: [{role, content}], pageUrl? }
  // Returns: { reply, offerHandoff }
  app.post("/api/chat", async (req, res) => {
    try {
      const { message } = req.body ?? {};
      const clientHistory: { role?: string; content?: string }[] = Array.isArray(req.body?.history) ? req.body.history : [];
      const text = String(message ?? "").trim();
      if (!text) return res.status(400).json({ error: "Viesti puuttuu." });
      if (text.length > MAX_MSG_LEN) return res.status(400).json({ error: "Viesti on liian pitkä." });

      // Build model context from the browser-held history (user/assistant only).
      const historyTurns: ChatTurn[] = clientHistory
        .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .slice(-HISTORY_LIMIT)
        .map((m): ChatTurn => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content).slice(0, MAX_MSG_LEN) }));

      const turns: ChatTurn[] = [
        { role: "system", content: publicSystemPrompt() },
        ...historyTurns,
        { role: "user", content: text },
      ];
      const reply = await chatComplete(turns, { temperature: 0.3, maxTokens: 420 });

      // No AI → safe canned reply, and always offer to leave a note for the team.
      if (!reply) {
        return res.json({ reply: PUBLIC_FALLBACK_FI, offerHandoff: true });
      }
      // Otherwise offer a handoff only when the visitor seems to want a person.
      res.json({ reply, offerHandoff: wantsHuman(text) });
    } catch (e: any) {
      console.error("Chat error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Public: visitor leaves a note / contact request for the team ──────────
  // This is the ONLY public-chat action that is persisted. It creates a single
  // lead record (a note for the hosts to see as a stat) and emails the team.
  // We are not live, so the visitor is told the team will follow up.
  //
  // Body: { name?, email?, phone?, question?, transcript?: [{role, content}], pageUrl? }
  app.post("/api/chat/handoff", async (req, res) => {
    try {
      const { name, email, phone, question, pageUrl } = req.body ?? {};
      const transcript: { role?: string; content?: string }[] = Array.isArray(req.body?.transcript) ? req.body.transcript : [];
      const visitorName = name ? String(name).slice(0, 200) : null;
      const visitorEmail = email ? String(email).slice(0, 200) : null;
      const visitorPhone = phone ? String(phone).slice(0, 100) : null;
      const q = String(question ?? "").trim().slice(0, MAX_MSG_LEN);

      // Need at least a way to reach them.
      if (!visitorPhone && !visitorEmail) {
        return res.status(400).json({ error: "Anna puhelinnumero tai sähköposti." });
      }

      const convo = (await db.insert(chatConversations).values({
        sessionToken: randomUUID(),
        source: "public",
        status: "needs_human",
        visitorName,
        visitorEmail,
        visitorPhone,
        pageUrl: pageUrl ? String(pageUrl).slice(0, 500) : null,
        unread: true,
      }).returning())[0];

      // Snapshot the browser-held conversation so hosts have context, then the
      // visitor's explicit question/request as the headline message.
      const snapshot = transcript
        .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .slice(-HISTORY_LIMIT)
        .map(m => ({
          conversationId: convo.id,
          role: m.role === "assistant" ? "assistant" : "user",
          content: String(m.content).slice(0, MAX_MSG_LEN),
        }));
      if (snapshot.length) await db.insert(chatMessages).values(snapshot);
      await db.insert(chatMessages).values({
        conversationId: convo.id,
        role: "system",
        content: q
          ? `Kävijä pyysi yhteyttä tiimiin. Kysymys: ${q}`
          : "Kävijä pyysi yhteyttä Puuhapattien tiimiin.",
      });

      notifyAdminOfChat(convo.id, visitorName, visitorEmail, visitorPhone, q || "(kävijä pyysi henkilökohtaista yhteyttä)").catch(() => {});
      res.json({ ok: true });
    } catch (e: any) {
      console.error("Chat handoff error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // Email the team when a website chat needs a human.
  async function notifyAdminOfChat(
    conversationId: number,
    name?: string | null, email?: string | null, phone?: string | null, lastMsg?: string,
  ) {
    if (!resend) return;
    const contact = [
      name ? `Nimi: ${name}` : null,
      phone ? `Puhelin: ${phone}` : null,
      email ? `Sähköposti: ${email}` : null,
    ].filter(Boolean).join(" · ") || "Ei yhteystietoja vielä";
    const html = `<div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto">
      <div style="background:#2d5016;padding:24px 28px;border-radius:12px 12px 0 0">
        <p style="margin:0;color:#b8e07a;font-size:11px;letter-spacing:1px;text-transform:uppercase">Puuhapatet.fi</p>
        <h1 style="margin:6px 0 0;color:#fff;font-size:20px">Verkkochat tarvitsee sinua 💬</h1>
      </div>
      <div style="background:#fff;padding:24px 28px;border:1px solid #dde9c4;border-top:0;border-radius:0 0 12px 12px">
        <p style="margin:0 0 8px;color:#1a2e0a"><strong>${escapeHtml(contact)}</strong></p>
        <p style="margin:0 0 16px;color:#333;white-space:pre-wrap">${escapeHtml(lastMsg || "")}</p>
        <a href="https://puuhapatet.fi/admin/inbox" style="display:inline-block;background:#2d5016;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px">Avaa viestit adminissa</a>
        <p style="margin:16px 0 0;color:#6b8f3a;font-size:12px">Keskustelu #${conversationId} · ${new Date().toLocaleString("fi-FI")}</p>
      </div>
    </div>`;
    try {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: WORKER_NOTIFICATION_EMAILS,
        replyTo: email || undefined,
        subject: `Verkkochat: ${name || "kävijä"} odottaa vastausta`,
        html,
      });
    } catch (e) { console.error("Chat notify failed:", e); }
  }

  // ─── Admin: list website conversations (inbox) ─────────────────────────────
  app.get("/api/admin/chats", async (req, res) => {
    try {
      const status = req.query.status ? String(req.query.status) : null;
      const where = status
        ? and(eq(chatConversations.source, "public"), eq(chatConversations.status, status))
        : eq(chatConversations.source, "public");
      const rows = await db.select().from(chatConversations)
        .where(where)
        .orderBy(desc(chatConversations.lastMessageAt))
        .limit(100);
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Admin: unread conversation count (for the nav badge) ──────────────────
  app.get("/api/admin/chats-unread", async (_req, res) => {
    try {
      const rows = await db.select({ id: chatConversations.id }).from(chatConversations)
        .where(and(eq(chatConversations.source, "public"), eq(chatConversations.unread, true)));
      res.json({ count: rows.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Admin: read one conversation (marks it read) ──────────────────────────
  app.get("/api/admin/chats/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const convo = (await db.select().from(chatConversations).where(eq(chatConversations.id, id)).limit(1))[0];
      if (!convo) return res.status(404).json({ error: "Ei löytynyt." });
      await db.update(chatConversations).set({ unread: false }).where(eq(chatConversations.id, id));
      const messages = await loadHistory(id, 200);
      res.json({ ...convo, unread: false, messages });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Admin: reply live to a website visitor ────────────────────────────────
  app.post("/api/admin/chats/:id/reply", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { content, authorName } = req.body ?? {};
      const text = String(content ?? "").trim();
      if (!text) return res.status(400).json({ error: "Viesti puuttuu." });
      const convo = (await db.select().from(chatConversations).where(eq(chatConversations.id, id)).limit(1))[0];
      if (!convo) return res.status(404).json({ error: "Ei löytynyt." });

      await db.insert(chatMessages).values({
        conversationId: id, role: "admin", content: text, authorName: authorName || null,
      });
      // Admin replied → conversation is now human-handled
      await db.update(chatConversations)
        .set({ status: "human", unread: false, updatedAt: new Date(), lastMessageAt: new Date() })
        .where(eq(chatConversations.id, id));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Admin: update conversation status (close / hand back to bot) ──────────
  app.patch("/api/admin/chats/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { status } = req.body ?? {};
      if (!["bot", "needs_human", "human", "closed"].includes(String(status))) {
        return res.status(400).json({ error: "Virheellinen tila." });
      }
      await db.update(chatConversations)
        .set({ status: String(status), updatedAt: new Date() })
        .where(eq(chatConversations.id, id));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Admin: in-tool assistant (role-scoped operational help) ───────────────
  // Body: { message, userId, userName, role, history? }
  app.post("/api/admin/assistant", async (req, res) => {
    try {
      const { message, userId, userName, role } = req.body ?? {};
      const history: ChatTurn[] = Array.isArray(req.body?.history) ? req.body.history : [];
      const text = String(message ?? "").trim();
      if (!text) return res.status(400).json({ error: "Viesti puuttuu." });
      if (text.length > MAX_MSG_LEN) return res.status(400).json({ error: "Viesti on liian pitkä." });
      // The team assistant runs on Claude when ANTHROPIC_API_KEY is set, else the
      // Groq path. It's available if either provider is configured.
      if (!ADMIN_AI_ENABLED && !AI_ENABLED) {
        return res.json({ reply: "Tekoälyavustaja ei ole vielä käytössä — aseta ANTHROPIC_API_KEY (Claude) tai AI_API_KEY ympäristömuuttuja ottaaksesi sen käyttöön." });
      }

      const effectiveRole: "HOST" | "STAFF" = role === "HOST" ? "HOST" : "STAFF";
      const contextBlock = await buildAdminContext(String(userId || ""), userName || "tiimiläinen", effectiveRole);

      const adminTools: AiTool[] = effectiveRole === "HOST" ? [
        {
          type: "function",
          function: {
            name: "update_job",
            description: "EHDOTA keikan statuksen päivitystä tai muistiinpanon lisäämistä. EI muuta dataa heti — luo ehdotuksen jonka käyttäjä hyväksyy napilla. Käytä VAIN kun käyttäjä nimenomaisesti pyytää muuttamaan keikkaa (esim. 'merkitse keikka 12 valmiiksi'). ÄLÄ kutsu tätä pelkän kysymyksen tai jutustelun perusteella, äläkä kirjaa käyttäjän viestejä muistiinpanoiksi.",
            parameters: {
              type: "object",
              properties: {
                job_id: { type: "number", description: "Keikan ID-numero" },
                status: { type: "string", enum: ["lead", "scheduled", "in_progress", "done"], description: "Uusi tila (valinnainen)" },
                notes: { type: "string", description: "Lisättävä muistiinpano keikalle (valinnainen)" },
              },
              required: ["job_id"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "draft_followup_email",
            description: "Luonnostele yhteydenotto- tai muistutusviesti asiakkaalle. EI lähetä viestiä — palauttaa luonnoksen, jonka käyttäjä näkee ja hyväksyy itse napilla. Käytä aina kun halutaan lähestyä asiakasta sähköpostilla.",
            parameters: {
              type: "object",
              properties: {
                job_id: { type: "number", description: "Keikan ID-numero" },
                message: { type: "string", description: "Viesti asiakkaalle suomeksi. Laadukas, kohtelias, ei liioittelua. Kerro konkreettisesti taustasta: teemme ammattimaista ikkunanpesua Espoossa ja Helsingissä, referenssinä mm. iso FR8-kohde (vanha teknillinen yliopisto). 3–6 lausetta." },
                style: { 
                  type: "string", 
                  enum: ["henkikohtainen", "pro", "lyhyt"],
                  description: "Sähköpostin tyyli: 'henkikohtainen' = lyhyt persoonallinen (oletus), 'pro' = branded virallisempi, 'lyhyt' = pelkkä teksti ilman kuvia"
                },
              },
              required: ["job_id", "message"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "propose_prospects",
            description: "Ehdota uusia potentiaalisia asiakaskohteita (prospekteja), joihin kannattaisi olla yhteydessä — esim. Espoon rakennukset, taloyhtiöt tai yritykset. Tämä EI luo liidiä eikä lähetä mitään, vaan listaa perustellut ehdotukset käyttäjälle harkittavaksi.",
            parameters: {
              type: "object",
              properties: {
                area: { type: "string", description: "Kohdealue, esim. 'Tapiola', 'Otaniemi', 'Etelä-Espoo'" },
                building_type: { type: "string", description: "Kohdetyyppi, esim. 'taloyhtiö', 'toimistorakennus', 'liiketila', 'omakotitalo'" },
                count: { type: "number", description: "Montako ehdotusta (oletus 3, max 6)" },
              },
              required: ["area"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "create_lead_from_prospect",
            description: "EHDOTA uuden liidin (asiakas + keikka tilassa 'lead') lisäämistä. EI luo dataa heti — luo ehdotuksen jonka käyttäjä hyväksyy napilla. Käytä VAIN kun käyttäjä nimenomaisesti pyytää lisäämään tietyn ULKOPUOLISEN kohteen liidiksi ja antaa vähintään nimen + osoitteen/yhteystiedon. ÄLÄ KOSKAAN luo liidiä pelkän kysymyksen tai tiedonhaun perusteella (esim. 'paljonko tienasin'), äläkä käytä tiimiläisen tai käyttäjän omaa nimeä. Jos et ole varma, älä kutsu tätä — vastaa tekstillä.",
            parameters: {
              type: "object",
              properties: {
                name: { type: "string", description: "Yhteyshenkilön tai kohteen nimi (esim. 'As Oy Tapiolanranta')" },
                address: { type: "string", description: "Osoite tai sijainti, vapaamuotoinen" },
                phone: { type: "string", description: "Puhelin jos tiedossa, muuten tyhjä" },
                email: { type: "string", description: "Sähköposti jos tiedossa, muuten tyhjä" },
                description: { type: "string", description: "Lyhyt kuvaus keikasta / mihin oltaisiin yhteydessä" },
                notes: { type: "string", description: "Peruste prospektille (miksi tämä kohde, mistä idea)" },
              },
              required: ["name", "description"],
            },
          },
        },
      ] : [];

      const systemTurn: ChatTurn = { role: "system", content: adminSystemPrompt({ userName: userName || "tiimiläinen", role: effectiveRole, contextBlock }) };
      const historyTurns: ChatTurn[] = history.slice(-HISTORY_LIMIT).map((m): ChatTurn => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content || ""),
      }));
      const userTurn: ChatTurn = { role: "user", content: text };
      let turns: any[] = [systemTurn, ...historyTurns, userTurn];

      const toolResultNotes: string[] = [];
      // Puoliautonomia: AI ei lähetä sähköposteja itse. draft_followup_email
      // kerää luonnokset tänne, frontend näyttää ne ja käyttäjä hyväksyy napilla.
      const emailDrafts: Array<{
        jobId: number; customerName: string; email: string;
        style: OutreachStyle; message: string; warning?: string;
      }> = [];
      // Dataa muuttavat työkalut (update_job, create_lead_from_prospect) EIVÄT
      // suorita muutosta heti. Ne keräävät tänne EHDOTUKSEN, jonka frontend näyttää
      // kortteina ja käyttäjä hyväksyy napilla → /api/admin/assistant/apply-action.
      // Näin avustaja ei koskaan muuta keikkoja ilman käyttäjän nimenomaista lupaa.
      const pendingActions: Array<{
        id: string; type: "update_job" | "create_lead"; title: string;
        detail: string; payload: any;
      }> = [];
      for (let round = 0; round < 3; round++) {
        // Claude (Opus) for the team assistant when configured; otherwise Groq.
        const result = ADMIN_AI_ENABLED
          ? await chatCompleteWithToolsClaude(turns, adminTools, { maxTokens: 1500 })
          : await chatCompleteWithTools(turns, adminTools, { temperature: 0.4, maxTokens: 900 });

        if (!result.toolCalls || result.toolCalls.length === 0) {
          const reply = result.text ?? "En valitettavasti saanut yhteyttä tekoälypalveluun juuri nyt. Yritä hetken kuluttua uudelleen.";
          const fullReply = toolResultNotes.length > 0 ? toolResultNotes.join("\n") + "\n\n" + reply : reply;
          return res.json({
            reply: fullReply,
            drafts: emailDrafts.length ? emailDrafts : undefined,
            actions: pendingActions.length ? pendingActions : undefined,
          });
        }

        turns.push({ role: "assistant", content: result.text ?? "", tool_calls: result.toolCalls });

        for (const tc of result.toolCalls) {
          let toolResult = "";
          try {
            const args = JSON.parse(tc.function.arguments);
            if (tc.function.name === "update_job") {
              // Puoliautonominen: EI suorita muutosta — luo ehdotuksen jonka
              // käyttäjä hyväksyy napilla. Näin avustaja ei koskaan muokkaa
              // keikkaa ilman nimenomaista lupaa (esim. omin päin lisätyt notet).
              const jobRow = (await db.select().from(jobs).where(eq(jobs.id, args.job_id)).limit(1))[0];
              if (!jobRow) {
                toolResult = `Virhe: keikkaa #${args.job_id} ei löydy.`;
              } else if (!args.status && !args.notes) {
                toolResult = `Ei muutosta ehdotettavaksi keikalle #${args.job_id} (ei statusta eikä muistiinpanoa).`;
              } else {
                const customer = jobRow.customerId
                  ? (await db.select().from(customers).where(eq(customers.id, jobRow.customerId)).limit(1))[0]
                  : null;
                const changes = [
                  args.status ? `status → ${args.status}` : null,
                  args.notes ? `muistiinpano: "${String(args.notes).slice(0, 120)}"` : null,
                ].filter(Boolean).join(", ");
                pendingActions.push({
                  id: `act_${pendingActions.length + 1}`,
                  type: "update_job",
                  title: `Päivitä keikka #${args.job_id}${customer?.name ? ` · ${customer.name}` : ""}`,
                  detail: changes,
                  payload: { job_id: args.job_id, status: args.status || undefined, notes: args.notes || undefined },
                });
                toolResult = `Ehdotus luotu (EI vielä tehty): keikka #${args.job_id} — ${changes}. Käyttäjä näkee ehdotuksen ja hyväksyy sen itse napilla. ÄLÄ väitä että muutos on jo tehty.`;
              }
            } else if (tc.function.name === "draft_followup_email") {
              // Puoliautonominen: ei lähetä — luo luonnos jonka käyttäjä hyväksyy.
              const jobRow = (await db.select().from(jobs).where(eq(jobs.id, args.job_id)).limit(1))[0];
              if (!jobRow) {
                toolResult = `Virhe: keikkaa #${args.job_id} ei löydy.`;
              } else {
                const customer = jobRow.customerId
                  ? (await db.select().from(customers).where(eq(customers.id, jobRow.customerId)).limit(1))[0]
                  : null;
                if (!customer?.email) {
                  toolResult = `Keikalla #${args.job_id} ei ole asiakkaan sähköpostia — ei voi luonnostella lähetettävää viestiä.`;
                } else {
                  const style: OutreachStyle = (["henkikohtainen", "pro", "lyhyt"].includes(args.style) ? args.style : "henkikohtainen");
                  // Duplikaattisuoja: varoita jos yhteydenotto on lähetetty 30 pv sisällä
                  const notes = jobRow.notes || "";
                  const recentOutreach = notes.split("\n").some(line => {
                    if (!line.includes("yhteydenotto lähetetty")) return false;
                    const match = line.match(/\[(\d+)\.(\d+)\.(\d+)/);
                    if (!match) return false;
                    const [, d, m, y] = match;
                    const sent = new Date(Number(y), Number(m) - 1, Number(d));
                    return (Date.now() - sent.getTime()) < 30 * 24 * 60 * 60 * 1000;
                  });
                  const warning = recentOutreach
                    ? `Huom: tälle asiakkaalle on jo lähetetty yhteydenotto viimeisen 30 päivän aikana.`
                    : undefined;
                  emailDrafts.push({
                    jobId: args.job_id,
                    customerName: customer.name,
                    email: customer.email,
                    style,
                    message: String(args.message || ""),
                    warning,
                  });
                  toolResult = `Luonnos valmis asiakkaalle ${customer.name} <${customer.email}> (tyyli: ${style}). Viestiä EI ole vielä lähetetty — käyttäjä näkee luonnoksen ja hyväksyy sen itse.${warning ? " " + warning : ""}`;
                  toolResultNotes.push(`📝 Luonnostelin viestin asiakkaalle ${customer.name}. Tarkista alta ja lähetä napilla.`);
                }
              }
            } else if (tc.function.name === "propose_prospects") {
              // Pelkkä ehdotuslista — ei luo mitään dataa. AI tuottaa perustellut
              // kohteet vastaustekstinään; tämä työkalu vain ohjeistaa muodon.
              const n = Math.min(Math.max(Number(args.count) || 3, 1), 6);
              toolResult = `Tee ${n} konkreettista prospektiehdotusta alueelle "${args.area}"${args.building_type ? ` (tyyppi: ${args.building_type})` : ""}. ` +
                `Anna jokaiselle: kohteen tyyppi/nimi- idea, sijainti, ja lyhyt PERUSTE miksi tämä sopisi Puuhapatetille (esim. ikkunapinta-ala, alueen profiili, lähellä isoa referenssikohdetta). ` +
                `ÄLÄ keksi oikeiden ihmisten nimiä tai yhteystietoja. Muotoile selkeänä numeroituna listana. ` +
                `Lopuksi kerro, että käyttäjä voi pyytää lisäämään minkä tahansa ehdotuksen liidiksi.`;
            } else if (tc.function.name === "create_lead_from_prospect") {
              // Puoliautonominen: EI luo dataa — luo ehdotuksen jonka käyttäjä
              // hyväksyy napilla. Backstop weak models (esp. Groq) that fabricate
              // a "lead" from a plain question — e.g. naming it after the user with
              // the question as the reason. Reject obvious junk before proposing it.
              const leadName = String(args.name || "").trim();
              const leadDesc = String(args.description || "").trim();
              const hasContact = !!(args.address || args.phone || args.email);
              const teamNames = Array.from(new Set([userName, ...FOUNDER_IDS, "joonatan", "matias"]
                .map(s => String(s || "").toLowerCase().trim()).filter(Boolean)));
              const nameLc = leadName.toLowerCase();
              const looksLikeTeam = teamNames.some(t => nameLc === t || nameLc.includes(t) || t.includes(nameLc));
              // Description/notes that just echo an earnings/report question, not a real prospect.
              const echoesQuestion = /kysy|tienann|paljonko|ansait|montako|raportti|eilen|t[äa]n[äa][äa]n/i.test(leadDesc + " " + String(args.notes || ""));
              if (!leadName || !leadDesc) {
                toolResult = `Virhe: liidin ehdotukseen tarvitaan vähintään nimi ja kuvaus.`;
              } else if (!hasContact || looksLikeTeam || echoesQuestion) {
                toolResult = `Ehdotusta EI luotu: tämä ei näytä oikealta ulkopuoliselta prospektilta (puuttuva osoite/yhteystieto, tai nimi viittaa tiimiläiseen / käyttäjän kysymykseen). ÄLÄ ehdota liidiä ellei käyttäjä nimenomaisesti pyydä lisäämään tietyn ulkopuolisen kohteen (nimi + osoite). Vastaa käyttäjän viestiin tekstillä.`;
              } else {
                pendingActions.push({
                  id: `act_${pendingActions.length + 1}`,
                  type: "create_lead",
                  title: `Lisää liidi: ${String(args.name).slice(0, 80)}`,
                  detail: [String(args.description).slice(0, 120), args.address ? `📍 ${args.address}` : null, args.notes ? `Peruste: ${String(args.notes).slice(0, 100)}` : null].filter(Boolean).join(" · "),
                  payload: {
                    name: String(args.name).slice(0, 200),
                    address: args.address ? String(args.address).slice(0, 300) : "",
                    phone: args.phone ? String(args.phone).slice(0, 60) : "",
                    email: args.email ? String(args.email).slice(0, 200) : "",
                    description: String(args.description).slice(0, 500),
                    notes: args.notes ? String(args.notes).slice(0, 400) : "",
                  },
                });
                toolResult = `Ehdotus luotu (EI vielä tehty): liidi "${args.name}". Käyttäjä näkee ehdotuksen ja hyväksyy sen itse napilla. ÄLÄ väitä että liidi on jo lisätty.`;
              }
            } else {
              toolResult = `Tuntematon työkalu: ${tc.function.name}`;
            }
          } catch (e: any) {
            toolResult = `Virhe työkalun suorituksessa: ${e.message}`;
          }
          turns.push({ role: "tool", tool_call_id: tc.id, content: toolResult });
        }
      }
      res.json({
        reply: toolResultNotes.join("\n") || "Tein ehdotukset — tarkista ja hyväksy ne alta.",
        drafts: emailDrafts.length ? emailDrafts : undefined,
        actions: pendingActions.length ? pendingActions : undefined,
      });
    } catch (e: any) {
      console.error("Admin assistant error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Admin: apply an assistant-proposed action (HOST confirms) ──────────────
  // Puoliautonominen flow: avustaja ehdottaa (update_job / create_lead), käyttäjä
  // hyväksyy → tämä suorittaa muutoksen. Avustaja ei siis koskaan muuta dataa itse.
  // Body: { type: "update_job" | "create_lead", payload, role, userId }
  app.post("/api/admin/assistant/apply-action", async (req, res) => {
    try {
      const { type, payload, role, userId } = req.body ?? {};
      if (role !== "HOST") return res.status(403).json({ error: "Vain perustaja voi vahvistaa toimenpiteitä." });
      const p = payload ?? {};

      if (type === "update_job") {
        const jobId = Number(p.job_id);
        if (!jobId) return res.status(400).json({ error: "Keikan ID puuttuu." });
        const jobRow = (await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1))[0];
        if (!jobRow) return res.status(404).json({ error: `Keikkaa #${jobId} ei löydy.` });
        const updates: any = { updatedAt: new Date() };
        const validStatus = ["lead", "scheduled", "in_progress", "done"].includes(String(p.status));
        if (validStatus) updates.status = String(p.status);
        if (p.notes) updates.notes = (jobRow.notes || "") + "\n[" + new Date().toLocaleDateString("fi-FI") + " avustaja] " + String(p.notes).slice(0, 400);
        await db.update(jobs).set(updates).where(eq(jobs.id, jobId));
        const changes = [validStatus ? `status → ${p.status}` : null, p.notes ? "muistiinpano lisätty" : null].filter(Boolean).join(", ");
        return res.json({ ok: true, message: `Keikka #${jobId} päivitetty: ${changes || "ei muutosta"}.` });
      }

      if (type === "create_lead") {
        if (!p.name || !p.description) return res.status(400).json({ error: "Nimi ja kuvaus vaaditaan." });
        const [newCustomer] = await db.insert(customers).values({
          name: String(p.name).slice(0, 200),
          phone: String(p.phone || "").slice(0, 60),
          email: p.email ? String(p.email).slice(0, 200) : null,
          address: String(p.address || "—").slice(0, 300),
          notes: p.notes ? `[Prospekti — AI-ehdotus ${new Date().toLocaleDateString("fi-FI")}] ${String(p.notes).slice(0, 400)}` : null,
          ownedBy: String(userId || ""),
        }).returning();
        const [newJob] = await db.insert(jobs).values({
          customerId: newCustomer.id,
          description: String(p.description).slice(0, 500),
          agreedPrice: 0,
          status: "lead",
          notes: `[${new Date().toLocaleDateString("fi-FI")}] Liidi luotu AI:n prospektiehdotuksesta.${p.notes ? " Peruste: " + String(p.notes).slice(0, 200) : ""}`,
        }).returning();
        return res.json({ ok: true, message: `Liidi lisätty: ${newCustomer.name} (keikka #${newJob.id}).` });
      }

      return res.status(400).json({ error: `Tuntematon toimenpide: ${type}` });
    } catch (e: any) {
      console.error("Assistant apply-action error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Marketer AI offer assistant (Claude Opus) ──────────────────────────────
  // Helps a door-to-door marketer price a target against our real price lists,
  // estimate time, and build a valid, shareable offer. Prices ONLY through the
  // deterministic tools (no invented numbers); offers are proposed and the
  // marketer confirms (apply-action) before any data is written.

  /** Map a m² value to the right SQM_RANGES index for a house type. */
  function sqmIndexForHouse(house: HouseKey, sqm: number): number {
    const ranges = SQM_RANGES[house] || [];
    for (let i = 0; i < ranges.length; i++) {
      const nums = (ranges[i].label.match(/\d+/g) || []).map(Number);
      if (ranges[i].label.startsWith("alle")) { if (sqm < nums[0]) return i; }
      else if (ranges[i].label.startsWith("yli")) { return i; }
      else if (nums.length >= 2) { if (sqm <= nums[1]) return i; }
    }
    return Math.max(0, ranges.length - 1);
  }

  async function buildMarketerContext(marketerId: string): Promise<string> {
    const mid = marketerId.toLowerCase();
    let mineSummary = "Ei vielä omia liidejä.";
    try {
      const rows = mid ? await db.select().from(jobs).where(eq(jobs.marketerId, mid)) : [];
      const approved = rows.filter(r => r.submissionStatus === "approved");
      const pending = rows.filter(r => r.submissionStatus === "pending_review");
      const commission = approved.reduce((s, r) => s + (r.marketerCommissionCents || 0), 0);
      mineSummary = `Omia liidejä ${rows.length} (odottaa ${pending.length}, hyväksytty ${approved.length}). Ansaitut palkkiot yhteensä ${(commission / 100).toFixed(0)} €.`;
    } catch { /* ignore */ }
    const priceRef = HOUSE_TYPES.map(h => {
      const r = SQM_RANGES[h.key] || [];
      return `${h.label} ${r[0]?.price ?? 0}–${r[r.length - 1]?.price ?? 0} €`;
    }).join(", ");
    return [
      `Tavallinen neliöperusteinen hinnasto (kaikki pinnat, arvio): ${priceRef}.`,
      `Kertoimet: vain ulko ×0,58; tikas ×1,2 / 2.krs ×1,4; arvostettu alue ×1,1 / premium ×1,2.`,
      ``,
      CUSTOM_PRICING_SUMMARY,
      ``,
      `Myyjän palkkio: ${Math.round(MARKETER_COMMISSION_RATE * 100)} % toteutuvasta diilistä, ei kattoa.`,
      mineSummary,
    ].join("\n");
  }

  const marketerTools: AiTool[] = [
    {
      type: "function",
      function: {
        name: "price_per_m2",
        description: "Laske tavallisen kodin hinta neliöperusteisesti (omakoti/pari/rivi/kerrostalo). Palauttaa virallisen hinnan. Käytä tätä tavallisille kodeille.",
        parameters: {
          type: "object",
          properties: {
            house: { type: "string", enum: ["omakoti", "paritalo", "rivitalo", "kerrostalo"], description: "Kohdetyyppi" },
            sqm: { type: "number", description: "Asuinpinta-ala neliöinä (arvio riittää)" },
            tier: { type: "string", enum: ["all", "outside"], description: "all = sisä+ulko, outside = vain ulko" },
            height: { type: "string", enum: ["ground", "ladder", "second"], description: "Korkeus/pääsy" },
            area: { type: "string", enum: ["normal", "valued", "premium"], description: "Alueen arvotaso" },
            addons: { type: "array", items: { type: "string" }, description: "Lisäpalvelut: balcony, railing, mirror, canopy, gutter" },
          },
          required: ["house", "sqm"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "price_custom",
        description: "Laske ISON tai erikoiskohteen hinta JA aika-arvio ikkunamäärän ja ruutujen perusteella. Käytä kun kohde ei ole tavallinen koti (paljon ikkunoita, monta ruutua/ikkuna, taloyhtiö, liiketila).",
        parameters: {
          type: "object",
          properties: {
            windows: { type: "number", description: "Ikkunoiden lukumäärä" },
            panesPerWindow: { type: "number", description: "Ruutuja per ikkuna (oletus 2)" },
            tier: { type: "string", enum: ["all", "outside"], description: "all = sisä+ulko, outside = vain ulko" },
            height: { type: "string", enum: ["ground", "ladder", "second"], description: "Korkeus/pääsy" },
            area: { type: "string", enum: ["normal", "valued", "premium"], description: "Alueen arvotaso" },
            difficulty: { type: "string", enum: ["easy", "standard", "hard"], description: "Vaikeus (raamit, pääsy, likaisuus)" },
            addons: { type: "array", items: { type: "string" }, description: "Lisäpalvelut: balcony, railing, mirror, canopy, gutter" },
          },
          required: ["windows"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "create_offer",
        description: "EHDOTA valmista tarjousta asiakkaalle. EI luo mitään heti — tekee ehdotuksen, jonka myyjä hyväksyy napilla (→ liidi + jaettava /tarjous-linkki). Käytä VAIN kun sinulla on asiakkaan nimi + puhelin ja työkalulla laskettu hinta.",
        parameters: {
          type: "object",
          properties: {
            customerName: { type: "string", description: "Asiakkaan nimi" },
            customerPhone: { type: "string", description: "Asiakkaan puhelin" },
            customerAddress: { type: "string", description: "Osoite (valinnainen)" },
            description: { type: "string", description: "Lyhyt kuvaus työstä (mitä pestään)" },
            priceEur: { type: "number", description: "Tarjottava hinta euroina — käytä työkalun laskemaa hintaa" },
            estimatedHours: { type: "number", description: "Karkea kesto tunteina (valinnainen, isoissa kohteissa)" },
            notes: { type: "string", description: "Sisäinen muistiinpano (valinnainen)" },
          },
          required: ["customerName", "customerPhone", "priceEur", "description"],
        },
      },
    },
  ];

  app.post("/api/marketer/assistant", async (req, res) => {
    try {
      // Auth like the other /api/marketer/* endpoints: any logged-in user (the
      // server token role is "staff"/"host"; marketers are role-gated client-side).
      const sub = String((req as any).admin?.sub ?? "").toLowerCase();
      if (!sub) return res.status(403).json({ error: "Kirjautuminen vaaditaan." });
      const { message, userName } = req.body ?? {};
      const history: ChatTurn[] = Array.isArray(req.body?.history) ? req.body.history : [];
      const text = String(message ?? "").trim();
      if (!text) return res.status(400).json({ error: "Viesti puuttuu." });
      if (text.length > MAX_MSG_LEN) return res.status(400).json({ error: "Viesti on liian pitkä." });
      if (!ADMIN_AI_ENABLED && !AI_ENABLED) {
        return res.json({ reply: "Tekoälyapuri ei ole vielä käytössä — aseta ANTHROPIC_API_KEY ympäristömuuttuja." });
      }

      const contextBlock = await buildMarketerContext(sub);
      const systemTurn: ChatTurn = { role: "system", content: marketerAssistantPrompt({ marketerName: userName || "myyjä", contextBlock }) };
      const historyTurns: ChatTurn[] = history.slice(-HISTORY_LIMIT).map((m): ChatTurn => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content || ""),
      }));
      let turns: any[] = [systemTurn, ...historyTurns, { role: "user", content: text }];

      const eur = (c: number) => `${(c / 100).toLocaleString("fi-FI", { maximumFractionDigits: 0 })} €`;
      const pendingActions: Array<{ id: string; type: "create_offer"; title: string; detail: string; payload: any }> = [];

      for (let round = 0; round < 3; round++) {
        const result = ADMIN_AI_ENABLED
          ? await chatCompleteWithToolsClaude(turns, marketerTools, { maxTokens: 1500 })
          : await chatCompleteWithTools(turns, marketerTools, { temperature: 0.3, maxTokens: 900 });

        if (!result.toolCalls || result.toolCalls.length === 0) {
          return res.json({
            reply: result.text ?? "En valitettavasti saanut yhteyttä tekoälyyn juuri nyt. Yritä hetken kuluttua uudelleen.",
            actions: pendingActions.length ? pendingActions : undefined,
          });
        }
        turns.push({ role: "assistant", content: result.text ?? "", tool_calls: result.toolCalls });

        for (const tc of result.toolCalls) {
          let toolResult = "";
          try {
            const args = JSON.parse(tc.function.arguments);
            if (tc.function.name === "price_per_m2") {
              const house = String(args.house) as HouseKey;
              const sqmIndex = sqmIndexForHouse(house, Number(args.sqm) || 0);
              const cents = computeOfferCents({
                house, sqmIndex,
                tier: (args.tier || "all") as TierKey,
                height: (args.height || "ground") as HeightKey,
                area: (args.area || "normal") as AreaKey,
                addons: (Array.isArray(args.addons) ? args.addons : []) as AddonKey[],
              });
              const label = (SQM_RANGES[house] || [])[sqmIndex]?.label ?? "";
              toolResult = `Hinta: ${eur(cents)} (${house}, ${label}). Tämä on virallinen hinta — esitä se asiakkaalle.`;
            } else if (tc.function.name === "price_custom") {
              const input = {
                windows: Number(args.windows) || 0,
                panesPerWindow: args.panesPerWindow != null ? Number(args.panesPerWindow) : undefined,
                tier: (args.tier || "all") as TierKey,
                height: (args.height || "ground") as HeightKey,
                area: (args.area || "normal") as AreaKey,
                difficulty: (args.difficulty || "standard") as DifficultyKey,
                addons: (Array.isArray(args.addons) ? args.addons : []) as AddonKey[],
              };
              const cents = computeCustomOfferCents(input);
              const est = formatEstimate(estimateMinutes(input));
              toolResult = `Hinta: ${eur(cents)} (${input.windows} ikkunaa${input.panesPerWindow ? `, ${input.panesPerWindow} ruutua/ikkuna` : ""}). Aika-arvio: ${est.label}. Tämä on virallinen hinta — esitä se asiakkaalle.`;
            } else if (tc.function.name === "create_offer") {
              const name = String(args.customerName || "").trim();
              const phone = String(args.customerPhone || "").trim();
              const priceCents = Math.max(0, Math.round((Number(args.priceEur) || 0) * 100));
              if (!name || !phone) {
                toolResult = `Ehdotusta EI luotu: tarvitaan asiakkaan nimi ja puhelin.`;
              } else if (priceCents <= 0) {
                toolResult = `Ehdotusta EI luotu: laske ensin hinta price_per_m2- tai price_custom-työkalulla, älä arvaa.`;
              } else {
                const hrs = Number(args.estimatedHours) || 0;
                pendingActions.push({
                  id: `off_${pendingActions.length + 1}`,
                  type: "create_offer",
                  title: `Tarjous: ${name} — ${eur(priceCents)}`,
                  detail: [String(args.description || "Ikkunanpesu").slice(0, 140), args.customerAddress ? `📍 ${args.customerAddress}` : null, hrs ? `⏱ ~${hrs} h` : null].filter(Boolean).join(" · "),
                  payload: {
                    name: name.slice(0, 200),
                    phone: phone.slice(0, 60),
                    address: String(args.customerAddress || "").slice(0, 300),
                    description: String(args.description || "Ikkunanpesu").slice(0, 500),
                    priceCents,
                    notes: [args.notes ? String(args.notes) : "", hrs ? `Aika-arvio ~${hrs} h` : ""].filter(Boolean).join(" · ").slice(0, 400),
                  },
                });
                toolResult = `Tarjousehdotus luotu (EI vielä lähetetty): ${name}, ${eur(priceCents)}. Myyjä näkee ehdotuksen ja vahvistaa sen napilla. ÄLÄ väitä että tarjous on jo luotu.`;
              }
            } else {
              toolResult = `Tuntematon työkalu: ${tc.function.name}`;
            }
          } catch (e: any) {
            toolResult = `Virhe työkalun suorituksessa: ${e.message}`;
          }
          turns.push({ role: "tool", tool_call_id: tc.id, content: toolResult });
        }
      }
      res.json({
        reply: "Tein tarjousehdotuksen — tarkista ja vahvista se alta.",
        actions: pendingActions.length ? pendingActions : undefined,
      });
    } catch (e: any) {
      console.error("Marketer assistant error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // Marketer confirms an assistant-proposed offer → creates the lead + quote link.
  app.post("/api/marketer/assistant/apply-action", async (req, res) => {
    try {
      const sub = String((req as any).admin?.sub ?? "").toLowerCase();
      if (!sub) return res.status(403).json({ error: "Kirjautuminen vaaditaan." });
      const { type, payload } = req.body ?? {};
      if (type !== "create_offer") return res.status(400).json({ error: `Tuntematon toimenpide: ${type}` });
      const p = payload ?? {};
      if (!p.name || !p.phone) return res.status(400).json({ error: "Nimi ja puhelin vaaditaan." });
      const today = new Date().toLocaleDateString("fi-FI");
      const [newCustomer] = await db.insert(customers).values({
        name: String(p.name).slice(0, 200),
        phone: String(p.phone).slice(0, 60),
        email: null,
        address: String(p.address || "—").slice(0, 300),
        notes: `[Myyjän AI-tarjous ${today} · ${sub}]`,
        ownedBy: sub,
      }).returning();
      const price = Math.max(0, Math.round(Number(p.priceCents) || 0));
      const quoteToken = randomUUID().replace(/-/g, "").slice(0, 16);
      const [newJob] = await db.insert(jobs).values({
        customerId: newCustomer.id,
        description: (String(p.description || "").trim() || "Ikkunanpesu (myyjän liidi)").slice(0, 500),
        agreedPrice: price,
        status: "lead",
        submittedBy: sub,
        submissionStatus: "pending_review",
        marketerId: sub,
        quoteToken,
        quoteStatus: price > 0 ? "pending" : null,
        notes: p.notes ? `[${today}] ${String(p.notes).slice(0, 400)}` : null,
      }).returning();
      res.json({ ok: true, message: `Tarjous luotu: ${newCustomer.name} (keikka #${newJob.id}).`, quoteToken });
    } catch (e: any) {
      console.error("Marketer assistant apply-action error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Admin: lähetä AI:n luonnostelema yhteydenotto-sähköposti (hyväksyntä) ──
  // Puoliautonominen flow: AI luonnostelee, käyttäjä hyväksyy → tämä lähettää.
  // Body: { jobId, message, style, role }
  app.post("/api/admin/assistant/send-email", async (req, res) => {
    try {
      const { jobId, message, style, role } = req.body ?? {};
      if (role !== "HOST") return res.status(403).json({ error: "Vain perustaja voi lähettää viestejä." });
      if (!resend) return res.status(400).json({ error: "Sähköpostipalvelu ei käytössä." });
      const jid = Number(jobId);
      const msg = String(message ?? "").trim();
      if (!jid || !msg) return res.status(400).json({ error: "Keikka tai viesti puuttuu." });
      const st: OutreachStyle = (["henkikohtainen", "pro", "lyhyt"].includes(style) ? style : "henkikohtainen");

      const jobRow = (await db.select().from(jobs).where(eq(jobs.id, jid)).limit(1))[0];
      if (!jobRow) return res.status(404).json({ error: `Keikkaa #${jid} ei löydy.` });
      const customer = jobRow.customerId
        ? (await db.select().from(customers).where(eq(customers.id, jobRow.customerId)).limit(1))[0]
        : null;
      if (!customer?.email) return res.status(400).json({ error: "Asiakkaalla ei ole sähköpostiosoitetta." });

      const firstName = customer.name?.split(" ")[0] ?? customer.name ?? "";
      const today = new Date().toLocaleDateString("fi-FI");
      const html = buildOutreachEmailHtml(st, msg, firstName);

      await resend.emails.send({
        from: FROM_EMAIL,
        to: customer.email,
        subject: `Hei ${firstName} — terveisiä Puuhapatet!`,
        html,
      });

      const notes = jobRow.notes || "";
      const outreachNote = `[${today} yhteydenotto lähetetty sähköpostilla: ${customer.email} (tyyli: ${st})]`;
      await db.update(jobs).set({
        notes: notes ? notes + "\n" + outreachNote : outreachNote,
        updatedAt: new Date(),
      }).where(eq(jobs.id, jid));

      res.json({ ok: true, sentTo: customer.email, customerName: customer.name });
    } catch (e: any) {
      console.error("Assistant send-email error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // Assemble role-scoped operational data for the admin assistant.
  // HOST sees everything; STAFF sees only their own jobs/customers + general stats.
  async function buildAdminContext(userId: string, userName: string, role: "HOST" | "STAFF"): Promise<string> {
    const eur = (cents: number | null | undefined) =>
      ((cents ?? 0) / 100).toLocaleString("fi-FI", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " €";
    const fmtDate = (d: Date | null | undefined) => d ? new Date(d).toLocaleDateString("fi-FI") : "—";

    const allJobs = await db.select().from(jobs).orderBy(desc(jobs.updatedAt)).limit(200);
    const allCustomers = await db.select().from(customers);
    const customerById = new Map(allCustomers.map(c => [c.id, c]));

    // STAFF: restrict to jobs assigned to them. assignedTo / pendingWorkers are
    // comma-separated IDs or legacy full names — match on exact tokens so we
    // never leak another worker's jobs through a loose substring hit.
    const idLc = userId.trim().toLowerCase();
    const nameLc = userName.trim().toLowerCase();
    const ownsJob = (field: string | null) =>
      (field || "").split(",").map(s => s.trim().toLowerCase()).some(t => t && (t === idLc || t === nameLc));
    const visibleJobs = role === "HOST"
      ? allJobs
      : allJobs.filter(j => ownsJob(j.assignedTo) || ownsJob(j.pendingWorkers));

    const lines: string[] = [];
    lines.push(`Käyttäjä: ${userName} (${role}). Tämän hetki: ${new Date().toLocaleString("fi-FI")}.`);

    // Aggregate counts
    const byStatus: Record<string, number> = {};
    for (const j of visibleJobs) byStatus[j.status] = (byStatus[j.status] || 0) + 1;
    lines.push(`\nKeikat (${role === "HOST" ? "kaikki" : "omat"}): yhteensä ${visibleJobs.length} — ` +
      Object.entries(byStatus).map(([s, n]) => `${s}: ${n}`).join(", "));

    // In-progress jobs (currently being worked on)
    const inProgress = visibleJobs.filter(j => j.status === "in_progress").slice(0, 10);
    if (inProgress.length) {
      lines.push(`\nKäynnissä olevat keikat:`);
      for (const j of inProgress) {
        const c = customerById.get(j.customerId);
        lines.push(`- #${j.id} ${c?.name ?? "?"} · ${c?.address ?? "?"} · tekijä: ${j.assignedTo || "ei osoitettu"} · ${eur(j.agreedPrice)}`);
      }
    }

    // Upcoming scheduled jobs
    const upcoming = visibleJobs
      .filter(j => j.scheduledAt && new Date(j.scheduledAt) >= new Date(Date.now() - 86400000))
      .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime())
      .slice(0, 15);
    if (upcoming.length) {
      lines.push(`\nTulevat / ajoitetut keikat:`);
      for (const j of upcoming) {
        const c = customerById.get(j.customerId);
        lines.push(`- #${j.id} ${fmtDate(j.scheduledAt)} · ${c?.name ?? "?"} · ${c?.address ?? "?"} · ${j.status} · ${eur(j.agreedPrice)} · ${j.description.slice(0, 60)}`);
      }
    }

    // Open leads — with clear quote status for each
    const leads = visibleJobs.filter(j => j.status === "lead").slice(0, 20);
    if (leads.length) {
      lines.push(`\nAvoimet liidit:`);
      for (const j of leads) {
        const c = customerById.get(j.customerId);
        const notes = j.notes || "";
        const outreachLine = notes.split("\n").find(l => l.includes("yhteydenotto lähetetty"));
        const outreachSent = !!outreachLine;
        const quoteInfo = j.quoteToken
          ? (j.quoteStatus === "accepted" ? "tarjous HYVÄKSYTTY"
             : j.quoteStatus === "declined" ? "tarjous HYLÄTTY"
             : "tarjous lähetetty, odottaa vastausta")
          : outreachSent ? `yhteydenotto lähetetty (${outreachLine?.match(/\(tyyli: (\w+)\)/)?.[1] ?? "?"})`
          : "ei yhteydenottoa eikä tarjousta";
        lines.push(`- #${j.id} ${c?.name ?? "?"} · ${c?.phone ?? ""} · ${c?.address ?? ""} · ${quoteInfo} · ${eur(j.agreedPrice)}`);
      }
    }

    // Pending quotes on non-lead jobs
    const pendingQuotes = visibleJobs.filter(j => j.status !== "lead" && j.quoteStatus === "pending").slice(0, 10);
    if (pendingQuotes.length) {
      lines.push(`\nOdottavat tarjoukset (ei-liidi):`);
      for (const j of pendingQuotes) {
        const c = customerById.get(j.customerId);
        lines.push(`- #${j.id} ${c?.name ?? "?"} · ${j.status} · tarjous odottaa vastausta · ${eur(j.agreedPrice)}`);
      }
    }

    // Big window gigs (floor-plan projects) — progress + paydate status + the
    // customer contact, so the daily report can give a short status to relay
    // (e.g. to the FR8 customer contact).
    const bigGigs = visibleJobs.filter(j => (j as any).projectData);
    if (bigGigs.length) {
      lines.push(`\nIsot keikat (edistyminen — voit kertoa asiakkaalle lyhyen tilanteen):`);
      for (const j of bigGigs.slice(0, 5)) {
        const proj = parseProject((j as any).projectData ?? null);
        if (!proj) continue;
        const tot = computeProjectTotals(proj);
        const deal = fixedDealFor(proj);
        let total = tot.total, washed = tot.washed;
        // For a fixed deal track the LIVE billable (red) count — same scope the
        // worker/boss dashboards now use — so the AI reports the real situation.
        let marginLine = "";
        if (deal && deal.pricePerWindow > 0) {
          const dealBill = computeDealBilling(proj, deal);
          total = dealBill.billableTotal;
          washed = dealBill.billableWashed;
          if (role === "HOST" && total > 0) {
            const nominal = Math.round(deal.capCents / 100 / deal.pricePerWindow);
            const perWin = eur(Math.round(deal.capCents / total));
            // Flag a deviation from the agreed scope so the AI can raise it as an issue.
            const drift = total !== nominal
              ? ` HUOM: punaisia ikkunoita kartalla ${total}, sovittu mitoitus ${nominal} — tarkista (poikkeama ${total < nominal ? "−" : "+"}${Math.abs(total - nominal)} ikkunaa).`
              : "";
            // Per-window kate is dynamic (capCents / live red windows), so it is
            // NOT locked at the nominal €37,50 — with fewer red dots it is higher.
            // From a WORKER's window the founders keep (kate − työntekijän €/ikkuna),
            // esim. oletustyöntekijä 20 €/ikkuna. Omasta ikkunasta jää koko kate.
            const kateCents = Math.round(deal.capCents / total);
            const workerMargin = eur(Math.max(0, kateCents - DEFAULT_WORKER_PER_WINDOW_CENTS));
            marginLine = ` Sisäinen kate ${perWin}/ikkuna (kiinteä ${eur(deal.capCents)} jaettuna ${total} punaiselle; EI lukittu 37,50 €:oon — lasketaan kartan punaisista). Omasta ikkunasta perustajille jää koko kate ${perWin}; työntekijän ikkunasta jää kate ${workerMargin} (kate − työntekijän €/ikkuna, oletus 20 €), joka jaetaan perustajien kesken.${drift}`;
          }
        }
        const pct = total > 0 ? Math.round((washed / total) * 100) : 0;
        const pp = computePayProgress(total, washed);
        const gig = (j as any).gigData ? parseGig((j as any).gigData) : null;
        const contact = gig?.company?.contact || gig?.signature?.customer?.contactPerson || customerById.get(j.customerId)?.name;
        const gigName = gig?.company?.name || proj.building?.name || j.description;
        let invLine = "";
        if (gig && role === "HOST") {
          const gt = computeTotals(gig);
          invLine = ` Laskutettu ${eur(gt.invoicedCents)}, laskuttamatta ${eur(gt.uninvoicedCents)}.`;
        }
        const dealLine = deal && deal.capCents > 0 ? ` Sopimuksen kokonaisarvo ${eur(deal.capCents)} (kiinteä kattohinta).` : "";
        // The instalment is the FLAT agreed total split evenly (€6300 / 4 = 1 575 €).
        // State it explicitly so the assistant never derives it from the live red-window
        // count (which drifts, e.g. 1 565,63 € at 167 windows).
        const installmentLine = deal && deal.capCents > 0
          ? ` Yhden maksuerän suuruus ${eur(Math.round(deal.capCents / pp.periods))} (kiinteä: kokonaishinta jaettuna ${pp.periods} erään — älä laske ikkunamäärästä).`
          : "";
        // Pace / weekly throughput so the assistant can answer "miten viikko meni
        // / milloin valmista". Based on the retained activity log (an estimate).
        const eff = computeEfficiency(proj);
        const paceLine = ` Vauhti: tänään ${eff.todayWashed} ikkunaa, viim. 7 pv ${eff.weekWashed}, ka ${eff.perDay.toFixed(1)}/työpäivä` +
          (eff.etaWorkingDays != null ? `, arvio valmis ~${eff.etaWorkingDays} työpäivässä` : "") + ".";
        lines.push(`- #${j.id} ${gigName}: ${washed}/${total} ikkunaa pesty (${pct} %).${dealLine} Maksuerä ${pp.currentPeriod}/${pp.periods}, ${pp.done ? "kaikki erät katettu" : `${pp.toNext} ikkunaa seuraavaan maksuerään`}.${installmentLine}${paceLine}${invLine}${marginLine}${contact ? ` Asiakkaan yhteyshenkilö: ${contact}.` : ""}`);
      }
    }

    // HOST-only: financial overview
    if (role === "HOST") {
      const done = allJobs.filter(j => j.status === "done");
      const revenue = done.reduce((s, j) => s + (j.agreedPrice || 0), 0);
      lines.push(`\nTalous (vain perustajat): valmiita keikkoja ${done.length}, liikevaihto valmiista ${eur(revenue)}.`);
      lines.push(`Asiakkaita yhteensä: ${allCustomers.length}.`);

      // Ovelta ovelle -myyjien keräämät liidit + maksettavat palkkiot.
      const marketerLeads = allJobs.filter(j => j.submittedBy);
      if (marketerLeads.length) {
        const pending = marketerLeads.filter(j => j.submissionStatus === "pending_review").length;
        const approved = marketerLeads.filter(j => j.submissionStatus === "approved");
        const owed = new Map<string, { count: number; cents: number }>();
        for (const j of approved) {
          const mid = String(j.marketerId || j.submittedBy || "?");
          const cur = owed.get(mid) || { count: 0, cents: 0 };
          cur.count += 1; cur.cents += j.marketerCommissionCents || 0;
          owed.set(mid, cur);
        }
        const owedStr = Array.from(owed.entries())
          .map(([m, v]) => `${m}: ${v.count} diiliä, palkkiot ${eur(v.cents)}`).join("; ");
        lines.push(`Myyjien liidit: ${pending} odottaa tarkistusta, ${approved.length} hyväksytty.` +
          (owedStr ? ` Myyjille maksettavat palkkiot — ${owedStr}.` : ""));
      }

      // ── Omat ansiosi — HENKILÖKOHTAINEN, VAIN tälle käyttäjälle ──────────────
      // TÄRKEÄ TIETOSUOJA: emme listaa muiden perustajien tai työntekijöiden
      // euroja tähän yhteenvetoon. Jokainen perustaja näkee VAIN omat ansionsa,
      // joten kenenkään palkkatieto ei vuoda toisen käyttäjän AI-yhteenvetoon.
      // Lasketaan kiinteähintaisilta keikoilta (FR8): oma työ (omat ikkunat ×
      // sopimushinta/ikkuna) + passiivinen tuotto-osuus työntekijöiden työstä
      // ((sopimushinta − työntekijän palkkio) jaettuna perustajien kesken).
      const isFounderMember = (id: string, mRole?: string) => mRole === "host" || FOUNDER_IDS.includes(id);
      if (isFounderMember(userId)) {
        const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
        const todayMs = startOfToday.getTime();
        const weekStartMs = todayMs - 6 * 86400_000; // today + 6 prior days
        let todayOwn = 0, todayPassive = 0, totalOwn = 0, totalPassive = 0;
        // Per-day earnings for the last 7 days, so the assistant can answer
        // "entäs eilen / miten viikko meni". Keyed by local calendar day.
        const byDayOwn = new Map<string, number>();
        const byDayPassive = new Map<string, number>();
        const byDayTs = new Map<string, number>(); // representative ts per day (label/sort)

        // ── Todennettava jälki ("raha-avustaja"): emme anna vain euroa vaan myös
        // todisteen mistä se tulee — mikä ikkuna, kerros, aika ja KUKA sen merkitsi.
        // Näin käyttäjä voi tarkistaa esim. "miksi minulle on kirjattu 1 ikkuna,
        // kun en pessyt yhtään" (pomo on voinut merkitä sen hänen nimiinsä).
        const cap = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
        const nameById = new Map<string, string>([["joonatan", "Joonatan"], ["matias", "Matias"]]);
        for (const j of allJobs) {
          const pj = parseProject(j.projectData ?? null);
          for (const m of pj?.crew ?? []) if (m.id && m.name) nameById.set(m.id, m.name);
        }
        const nameOf = (id: string) => id ? (nameById.get(id) || cap(id)) : "?";
        const floorLabel = (f: string) => f === "K" ? "Kellari" : `${f}. kerros`;
        const hhmm = (ts: number) => new Date(ts).toLocaleTimeString("fi-FI", { hour: "2-digit", minute: "2-digit" });
        const dmHm = (ts: number) => `${new Date(ts).toLocaleDateString("fi-FI")} klo ${hhmm(ts)}`;
        const dayKeyOf = (ts: number) => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
        const dayLabel = (ts: number) => new Date(ts).toLocaleDateString("fi-FI", { weekday: "short", day: "numeric", month: "numeric" });
        // Windows credited to ME today (with who actually marked each one).
        const myToday: Array<{ floor: string; ts: number; markedBy: string; gig: string }> = [];
        // Windows credited to ME across the retained log (for "latest dot" lookups).
        const myRecent: Array<{ floor: string; ts: number; markedBy: string; gig: string }> = [];
        // Who washed how many today, across the founder's fixed-price gigs.
        const washedTodayBy = new Map<string, number>();

        for (const j of allJobs) {
          const project = parseProject(j.projectData ?? null);
          if (!project) continue;
          const deal = fixedDealFor(project);
          if (!deal) continue;
          const crew = project.crew ?? [];
          // DYNAMIC per-window kate from the dots (capCents / live red windows),
          // matching the dashboard — not the nominal €37,50. See daily-earnings.
          const billableTotal = allPoints(project).filter(p => p.p === deal.billablePriority).length;
          const kateCents = billableTotal > 0 ? Math.round(deal.capCents / billableTotal) : Math.round(deal.pricePerWindow * 100);
          const rateOf = (id: string, mRole?: string) =>
            isFounderMember(id, mRole) ? kateCents : (crew.find(c => c.id === id)?.perWindowCents ?? DEFAULT_WORKER_PER_WINDOW_CENTS);
          const founderCount = Math.max(1, crew.filter(c => isFounderMember(c.id, c.role)).length || FOUNDER_IDS.length);
          const effId = (id: string): string => {
            const mm = crew.find(c => c.id === id);
            const t = traineeForUserId(mm?.linkedUserId) || traineeForUserId(id) || traineeForName(mm?.name);
            return t ? t.responsibleLeaderId : id;
          };
          const mRoleOf = (id: string) => crew.find(c => c.id === id)?.role;
          const gigName = project.building?.name || j.description?.slice(0, 40) || `keikka #${j.id}`;

          // Today (log, deduped per key, billable priority only). The log is
          // newest-first, so the first entry seen per window is the latest mark.
          const seenToday = new Set<string>();
          const todayBy = new Map<string, number>();
          for (const l of project.log) {
            if (l.status !== "pesty" || l.p !== deal.billablePriority || l.ts < todayMs) continue;
            if (seenToday.has(l.key)) continue;
            seenToday.add(l.key);
            const w = effId(project.washedBy[l.key] || l.by || "");
            if (!w) continue;
            todayBy.set(w, (todayBy.get(w) || 0) + 1);
            washedTodayBy.set(w, (washedTodayBy.get(w) || 0) + 1);
            // If this window is credited to ME, record the evidence (who marked it).
            if (w === userId) myToday.push({ floor: l.floor, ts: l.ts, markedBy: l.by || "", gig: gigName });
          }

          // Recent windows credited to ME (across the whole retained log) so the
          // assistant can answer "which floor was the latest dot marked for me".
          const seenRecent = new Set<string>();
          for (const l of project.log) {
            if (l.status !== "pesty" || l.p !== deal.billablePriority) continue;
            if (seenRecent.has(l.key)) continue;
            seenRecent.add(l.key);
            if (effId(project.washedBy[l.key] || l.by || "") === userId) {
              myRecent.push({ floor: l.floor, ts: l.ts, markedBy: l.by || "", gig: gigName });
            }
          }
          let todayPool = 0;
          for (const [w, n] of Array.from(todayBy)) {
            if (!isFounderMember(w, mRoleOf(w))) todayPool += n * Math.max(0, kateCents - rateOf(w, mRoleOf(w)));
          }
          todayOwn += (todayBy.get(userId) || 0) * kateCents;
          todayPassive += Math.round(todayPool / founderCount);

          // Cumulative (final attribution, billable priority only).
          const washedBy2 = project.washedBy2 || {};
          const totalBy = new Map<string, number>();
          for (const p of allPoints(project)) {
            if (p.status !== "pesty" || p.p !== deal.billablePriority) continue;
            const second = washedBy2[p.key];
            const primary = effId(p.washedBy || "");
            if (primary) totalBy.set(primary, (totalBy.get(primary) || 0) + (second ? 0.5 : 1));
            if (second) { const s = effId(second); totalBy.set(s, (totalBy.get(s) || 0) + 0.5); }
          }
          let totalPool = 0;
          for (const [w, n] of Array.from(totalBy)) {
            if (!isFounderMember(w, mRoleOf(w))) totalPool += n * Math.max(0, kateCents - rateOf(w, mRoleOf(w)));
          }
          totalOwn += Math.round((totalBy.get(userId) || 0) * kateCents);
          totalPassive += Math.round(totalPool / founderCount);

          // Per-day breakdown for the last 7 days, deduped per (day, window).
          // Same own/pool math as "today", just grouped by calendar day so the
          // assistant can report yesterday / the week. (Based on the retained
          // log, which is capped — older days may be partial.)
          const seenDayKey = new Set<string>();
          const byDayWorker = new Map<string, Map<string, number>>();
          for (const l of project.log) {
            if (l.status !== "pesty" || l.p !== deal.billablePriority || l.ts < weekStartMs) continue;
            const dk = dayKeyOf(l.ts);
            const dedupe = dk + "|" + l.key;
            if (seenDayKey.has(dedupe)) continue;
            seenDayKey.add(dedupe);
            const w = effId(project.washedBy[l.key] || l.by || "");
            if (!w) continue;
            let mp = byDayWorker.get(dk);
            if (!mp) { mp = new Map(); byDayWorker.set(dk, mp); }
            mp.set(w, (mp.get(w) || 0) + 1);
            if (!byDayTs.has(dk) || l.ts > (byDayTs.get(dk) || 0)) byDayTs.set(dk, l.ts);
          }
          for (const [dk, mp] of Array.from(byDayWorker)) {
            let pool = 0;
            for (const [w, n] of Array.from(mp)) {
              if (!isFounderMember(w, mRoleOf(w))) pool += n * Math.max(0, kateCents - rateOf(w, mRoleOf(w)));
            }
            byDayOwn.set(dk, (byDayOwn.get(dk) || 0) + (mp.get(userId) || 0) * kateCents);
            byDayPassive.set(dk, (byDayPassive.get(dk) || 0) + Math.round(pool / founderCount));
          }
        }
        const todayTotal = todayOwn + todayPassive;
        const grand = totalOwn + totalPassive;
        if (grand > 0 || todayTotal > 0) {
          lines.push(
            `\nOmat ansiosi (HENKILÖKOHTAINEN — vain sinulle, ${userName}; älä koskaan kerro muille käyttäjille): ` +
            `tänään yhteensä ${eur(todayTotal)} — oma työ ${eur(todayOwn)} (${myToday.length} ikkunaa kirjattu sinulle tänään) + passiivinen tuotto-osuus ${eur(todayPassive)} ` +
            `(passiivinen kertyy vaikka et itse pesisi yhtään ikkunaa). ` +
            `Koko kertymäsi tähän mennessä ${eur(grand)} (oma työ ${eur(totalOwn)} + passiivinen ${eur(totalPassive)}).`,
          );

          // Who washed how many today (names) — "kuka pesi montako".
          if (washedTodayBy.size) {
            const tally = Array.from(washedTodayBy.entries())
              .sort((a, b) => b[1] - a[1])
              .map(([w, n]) => `${nameOf(w)} ${n}`)
              .join(", ");
            lines.push(`Tänään pestyt ikkunat (kuka pesi montako, todelliset merkinnät): ${tally}.`);
          }

          // Per-window evidence for MY credited windows today, so the assistant
          // can prove (or flag) each one: floor, time, and who marked it.
          if (myToday.length) {
            const detail = myToday
              .sort((a, b) => b.ts - a.ts)
              .slice(0, 12)
              .map(w => {
                const who = w.markedBy && w.markedBy !== userId
                  ? `merkitsi ${nameOf(w.markedBy)} (EI sinä itse)`
                  : w.markedBy === userId ? "merkitsit itse" : "merkitsijä ei tiedossa";
                return `${floorLabel(w.floor)}, klo ${hhmm(w.ts)}, ${who}`;
              })
              .join("; ");
            lines.push(`Sinulle tänään kirjatut ikkunat (todiste euroista): ${detail}.`);
          } else if (todayOwn === 0) {
            lines.push(`Sinulle ei ole tänään kirjattu yhtään ikkunaa omasta työstä — tämän päivän ansiosi ovat pelkkää passiivista tuotto-osuutta.`);
          }

          // The single latest dot marked as washed for ME (any day in the log).
          if (myRecent.length) {
            const latest = myRecent.sort((a, b) => b.ts - a.ts)[0];
            const who = latest.markedBy && latest.markedBy !== userId
              ? `merkitsi ${nameOf(latest.markedBy)} (ei sinä itse)`
              : latest.markedBy === userId ? "merkitsit itse" : "merkitsijä ei tiedossa";
            lines.push(`Viimeisin sinulle pestyksi merkitty ikkuna: ${floorLabel(latest.floor)} — ${latest.gig}, ${dmHm(latest.ts)}, ${who}.`);
          }

          // ── Eilen + viime 7 päivää (jotta avustaja osaa vastata "entäs eilen") ──
          const yKey = dayKeyOf(todayMs - 86400_000);
          const yOwn = byDayOwn.get(yKey) || 0;
          const yPassive = byDayPassive.get(yKey) || 0;
          if (yOwn || yPassive) {
            lines.push(`Eilen ansaitsit yhteensä ${eur(yOwn + yPassive)} (oma työ ${eur(yOwn)} + passiivinen ${eur(yPassive)}).`);
          } else {
            lines.push(`Eilen sinulle ei ole kirjattu ansioita.`);
          }
          // Daily list for the last 7 days, newest first, with a week total.
          const dayKeys = Array.from(new Set(Array.from(byDayOwn.keys()).concat(Array.from(byDayPassive.keys()))))
            .sort((a, b) => (byDayTs.get(b) || 0) - (byDayTs.get(a) || 0));
          if (dayKeys.length) {
            let weekTotal = 0;
            const parts = dayKeys.map(dk => {
              const tot = (byDayOwn.get(dk) || 0) + (byDayPassive.get(dk) || 0);
              weekTotal += tot;
              return `${dayLabel(byDayTs.get(dk) || todayMs)} ${eur(tot)}`;
            });
            lines.push(`Viimeiset 7 pv (ansiot/päivä): ${parts.join(", ")}. Viikon yhteensä ${eur(weekTotal)}. (Perustuu viimeisimpiin merkintöihin; vanhemmat päivät voivat olla osittaisia.)`);
          }
        }
      }
    } else {
      lines.push(`\nAsiakkaita näkyvissä: ${new Set(visibleJobs.map(j => j.customerId)).size}.`);
    }

    return lines.join("\n");
  }

  return httpServer;
}
