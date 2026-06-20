import type { Express } from "express";
import { type Server } from "http";
import { eq, desc, sql, ne, and } from "drizzle-orm";
import { Resend } from "resend";
import bwipjs from "bwip-js";
import PDFDocument from "pdfkit";
import rateLimit from "express-rate-limit";
import { db } from "./db";
import { customers, jobs, expenses, workerPayments, investments, startupBonusUsages, users, chatConversations, chatMessages, insertCustomerSchema, insertJobSchema, insertExpenseSchema, insertInvestmentSchema, insertStartupBonusUsageSchema } from "@shared/schema";
import { feeRateForWorker, effectiveJobTotal } from "@shared/team";
import { randomUUID, createHash, createHmac, timingSafeEqual, scryptSync, randomBytes } from "crypto";
import {
  AI_ENABLED, chatComplete, chatCompleteWithTools, publicSystemPrompt, adminSystemPrompt,
  PUBLIC_FALLBACK_FI, type ChatTurn, type AiTool,
} from "./ai";
import { sanitizeGigData, computeTotals, emptyGigData, signatureRequired, gigStatus, type GigData } from "@shared/gig";
import { sanitizeMemberSignature } from "@shared/member-agreement";
import { sanitizeProjectData, computeProjectTotals, computeWorkerStats, syncGigSectorsFromProject, emptyProjectData, type ProjectData } from "@shared/project";
import {
  sanitizeCrew, sanitizeCrewMember, newCrewToken, findCrewByToken, crewMemberStats, isOnboarded,
  DEFAULT_WORKER_PER_WINDOW_CENTS, MAX_SIGNATURE_DATAURL_LEN, type CrewMember,
} from "@shared/crew";
import { WORKER_AGREEMENTS, REQUIRED_AGREEMENT_IDS, WORKER_AGREEMENT_VERSION } from "@shared/worker-agreements";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
// Ennen kuin puuhapatet.fi-domain on vahvistettu Resendissä, käytä onboarding@resend.dev
const FROM_EMAIL = process.env.FROM_EMAIL || "Puuhapatet <onboarding@resend.dev>";
// Optional: protect the calendar feed with a token (set CALENDAR_TOKEN env var on Render)
const CALENDAR_TOKEN = process.env.CALENDAR_TOKEN || null;
// Notification email list — override via WORKER_EMAILS env var (comma-separated)
const WORKER_NOTIFICATION_EMAILS: string[] = process.env.WORKER_EMAILS
  ? process.env.WORKER_EMAILS.split(",").map(e => e.trim()).filter(Boolean)
  : ["joonatan@puuhapatet.fi", "matias@puuhapatet.fi"];
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
  { method: "POST", re: /^\/api\/crew\/[^/]+\/(auth|onboard|window|hours|note)$/ },
  { method: "POST", re: /^\/api\/crew\/[^/]+\/payout\/[^/]+\/approve$/ },
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

    // Parties: worker (seller) → Puuhapatet (buyer)
    doc.fill(GRAY).font("Helvetica-Bold").fontSize(7).text("LASKUTTAJA (MYYJÄ)", 48, y, { width: colW });
    doc.text("LASKUN SAAJA (OSTAJA)", 48 + colW + 16, y, { width: colW });
    y += 14;
    doc.fill(INK).font("Helvetica-Bold").fontSize(10);
    doc.text(params.workerName || "Alihankkija", 48, y, { width: colW });
    doc.text("Puuhapatet", 48 + colW + 16, y, { width: colW });
    y += 14;
    doc.fill(GRAY).font("Helvetica").fontSize(9);
    const leftStartY = y;
    if (params.workerYTunnus) { doc.text(`Y-tunnus: ${params.workerYTunnus}`, 48, y, { width: colW }); y += 12; }
    if (params.workerAddress) { doc.text(params.workerAddress, 48, y, { width: colW }); y += 12; }
    if (params.workerIban) { doc.text(`IBAN: ${params.workerIban}`, 48, y, { width: colW }); y += 12; }
    doc.text("Y-tunnus: —", 48 + colW + 16, leftStartY, { width: colW });
    doc.text("info@puuhapatet.fi · puuhapatet.fi", 48 + colW + 16, leftStartY + 12, { width: colW });

    y = Math.max(y, leftStartY + 36) + 18;

    // Line item
    doc.rect(48, y, pageW, 26).fill("#F1F5F9");
    doc.fill(GRAY).font("Helvetica-Bold").fontSize(8);
    doc.text("KUVAUS", 60, y + 9, { width: pageW - 140 });
    doc.text("YHTEENSÄ", 48 + pageW - 100, y + 9, { width: 88, align: "right" });
    y += 26;

    const desc = params.note || `Ikkunanpesutyö${params.windows ? ` — ${params.windows} ikkunaa` : ""}`;
    doc.fill(INK).font("Helvetica").fontSize(10).text(desc, 60, y + 8, { width: pageW - 140 });
    doc.font("Helvetica-Bold").text(fmtEur(params.amountCents), 48 + pageW - 100, y + 8, { width: 88, align: "right" });
    y += 34;
    doc.moveTo(48, y).lineTo(48 + pageW, y).strokeColor("#E2E8F0").stroke();
    y += 12;

    // Total
    doc.fill(GRAY).font("Helvetica").fontSize(9).text("Veroton summa", 48 + pageW - 220, y, { width: 120, align: "right" });
    doc.fill(INK).font("Helvetica").fontSize(9).text(fmtEur(params.amountCents), 48 + pageW - 100, y, { width: 88, align: "right" });
    y += 16;
    doc.fill(NAVY).font("Helvetica-Bold").fontSize(13).text("Maksettavaa", 48 + pageW - 220, y, { width: 120, align: "right" });
    doc.text(fmtEur(params.amountCents), 48 + pageW - 100, y, { width: 88, align: "right" });
    y += 30;

    // VAT note (alv-rekisteröitymätön pienyrittäjä, oletus)
    doc.fill(GRAY).font("Helvetica").fontSize(8).text(
      "Arvonlisäveroa ei lisätä (AVL 3 §, vähäinen toiminta). Lasku alihankintatyöstä Puuhapatetille.",
      48, y, { width: pageW },
    );
    y += 24;
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
      if (stored) {
        ok = verifyPassword(String(password), stored);
      } else if (ADMIN_DEFAULT_PASSWORD) {
        // Account has no password yet → accept the one-time default.
        ok = String(password) === ADMIN_DEFAULT_PASSWORD;
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
      res.json({ ok: true, token, role });
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
        // rate (founders 10 %, staff 25 %).
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
        serviceFeeTotal, // senttiä — palvelumaksut (perustajat 10 %, työntekijät 25 %)
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
          // Each worker's fee uses their own role's rate (10 % / 25 %).
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
        senderName, senderAddress,
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
                ${workers[0]?.yTunnus ? `<div style="color:#6b7280;font-size:12px;margin-top:2px">Y-tunnus: ${workers[0].yTunnus}</div>` : ""}
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
          const senderWorker = workers[0];
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
      gig.log.push({ t: Date.now(), text: `Sopimus allekirjoitettu sähköisesti: ${signerName} (${legalName})` });
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
              <p style="color:#8C8A82">Allekirjoittaja: ${signerName}${gig.signature?.place ? " · " + gig.signature.place : ""}<br>Aika: ${new Date().toLocaleString("fi-FI")}</p>
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
        message, isFinal,
      } = req.body as Record<string, any>;

      const recipient = to || gig.company?.email;
      if (!recipient) return res.status(400).json({ error: "Vastaanottajan sähköposti puuttuu" });

      const totalsBefore = computeTotals(gig);
      const amountCents = totalsBefore.uninvoicedCents;
      if (amountCents <= 0) return res.status(400).json({ error: "Ei laskutettavaa kertymää" });

      // Bill only the units washed since the previous invoice, per sector, so the
      // line items sum exactly to the amount due now.
      const fmtEur = (c: number) => (c / 100).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
      const lineRows = gig.sectors.map((s) => {
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

      const invoiceNo = `${gig.contractId || "PT"}-${(gig.payments.length + 1).toString().padStart(2, "0")}`;
      const accruedSoFar = totalsBefore.accruedCents;
      const previouslyInvoiced = totalsBefore.invoicedCents;

      const html = `
<!DOCTYPE html><html lang="fi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F6F4EE;font-family:'Poppins',ui-sans-serif,system-ui,-apple-system,sans-serif">
  <div style="max-width:600px;margin:24px auto;background:#FFFFFF;border-radius:14px;overflow:hidden;border:1px solid #E4E1D7">
    <div style="padding:28px 32px;border-bottom:1px solid #E4E1D7">
      <p style="margin:0;color:#1A1A1A;font-size:20px;font-weight:700;letter-spacing:-0.3px">Puuhapatet</p>
      <p style="margin:4px 0 0;color:#8C8A82;font-size:13px">${isFinal ? "Loppulasku" : "Osalasku"} · ${invoiceNo}${gig.contractId ? ` · sopimus ${gig.contractId}` : ""}</p>
    </div>
    <div style="padding:24px 32px">
      <p style="margin:0 0 4px;color:#8C8A82;font-size:11px;letter-spacing:1px;text-transform:uppercase">Laskutettava</p>
      <p style="margin:0 0 16px;color:#1A1A1A;font-size:15px;font-weight:600">${gig.company?.name || job.description}</p>
      ${message ? `<p style="margin:0 0 20px;color:#1A1A1A;font-size:14px;line-height:1.7;white-space:pre-wrap">${String(message).replace(/</g, "&lt;")}</p>` : ""}
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-top:2px solid #1A1A1A;margin-top:8px">
        <tbody>${lineRows}</tbody>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px">
        <tr><td style="padding:8px 0;color:#8C8A82;font-size:13px">Kertymä yhteensä</td><td style="padding:8px 0;text-align:right;color:#8C8A82;font-size:13px;font-variant-numeric:tabular-nums">${fmtEur(accruedSoFar)}</td></tr>
        ${previouslyInvoiced > 0 ? `<tr><td style="padding:4px 0;color:#8C8A82;font-size:13px">Aiemmin laskutettu</td><td style="padding:4px 0;text-align:right;color:#8C8A82;font-size:13px;font-variant-numeric:tabular-nums">−${fmtEur(previouslyInvoiced)}</td></tr>` : ""}
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

      const bccArr = bcc ? String(bcc).split(",").map((s) => s.trim()).filter(Boolean) : undefined;
      const result = await resend.emails.send({
        from: FROM_EMAIL,
        to: recipient,
        ...(bccArr?.length ? { bcc: bccArr } : {}),
        subject: `${isFinal ? "Loppulasku" : "Osalasku"} ${invoiceNo} — ${fmtEur(amountCents)} · Puuhapatet`,
        html,
      });

      // Advance per-sector invoiced markers, then refresh the summary fields.
      gig.sectors.forEach((s) => { s.invoicedWashed = s.washed; });
      const totalsAfter = computeTotals(gig);
      gig.invoicedThrough = totalsAfter.invoicedWashed;
      gig.invoicedCents = totalsAfter.invoicedCents;
      gig.payments.push({
        t: Date.now(), countThrough: totalsAfter.invoicedWashed, amountCents,
        to: recipient, note: isFinal ? "Loppulasku" : "Osalasku", emailId: result.data?.id,
      });
      gig.log.push({ t: Date.now(), text: `${isFinal ? "Loppulasku" : "Osalasku"} ${invoiceNo} lähetetty: ${fmtEur(amountCents)} → ${recipient}` });
      gig.updatedAt = Date.now();
      await db.update(jobs).set({ gigData: JSON.stringify(gig), updatedAt: new Date() }).where(eq(jobs.id, id));

      res.json({ ok: true, id: result.data?.id, amountCents, gigData: gig });
    } catch (e: any) {
      console.error("Gig invoice error:", e);
      res.status(500).json({ error: e.message || "Laskun lähetys epäonnistui" });
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
        onboarded: isOnboarded(member, REQUIRED_AGREEMENT_IDS, WORKER_AGREEMENT_VERSION),
        profile: member.profile ?? null,
        signedAgreementIds: member.agreements
          .filter((a) => a.version === WORKER_AGREEMENT_VERSION)
          .map((a) => a.agreementId),
        notes: member.notes,
        // The worker's own billing details (their Y-tunnus + IBAN), used to
        // prefill the payout-approval form and their auto-generated invoice.
        billing: {
          name: member.profile?.fullName ?? member.name,
          yTunnus: member.profile?.yTunnus ?? null,
          iban: member.profile?.iban ?? null,
          address: member.profile?.city ?? null,
        },
      },
      // Puuhapatet -> worker payouts (newest-first). The worker sees and approves
      // these; the gig price/cap stays hidden as always.
      payouts: (member.payouts || []).slice().sort((a, b) => b.createdAt - a.createdAt),
      building: project.building,
      pricePerWindow: member.perWindowCents / 100, // worker's OWN rate, not the gig price
      marks: project.marks,
      statuses: project.statuses,
      washedBy: project.washedBy,
      customMarks: project.customMarks,
      posOverrides: project.posOverrides,
      deleted: project.deleted,
      hours: stats.hours,
      stats,
      agreementVersion: WORKER_AGREEMENT_VERSION,
      requiredAgreementIds: REQUIRED_AGREEMENT_IDS,
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
      const onboarded = isOnboarded(
        { ...merged, onboardedAt: Date.now() } as CrewMember,
        REQUIRED_AGREEMENT_IDS, WORKER_AGREEMENT_VERSION,
      );
      merged.onboardedAt = onboarded ? Date.now() : member.onboardedAt;

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
      if (!isOnboarded(member, REQUIRED_AGREEMENT_IDS, WORKER_AGREEMENT_VERSION)) {
        return res.status(403).json({ error: "Allekirjoita sopimukset ensin" });
      }
      const key = String(req.body?.key ?? "").slice(0, 64);
      const status = req.body?.status === "pesty" || req.body?.status === "kesken" ? req.body.status : "ei";
      if (!key) return res.status(400).json({ error: "key puuttuu" });

      if (status === "ei") {
        // Only clear a window the worker owns (or that nobody owns).
        if (!project.washedBy[key] || project.washedBy[key] === member.id) {
          delete project.statuses[key];
          delete project.washedBy[key];
        }
      } else {
        project.statuses[key] = status;
        if (status === "pesty") project.washedBy[key] = member.id;
        else delete project.washedBy[key];
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
      const b = (req.body?.billing ?? {}) as Record<string, any>;
      payout.status = "hyvaksytty";
      payout.approvedAt = Date.now();
      payout.billing = {
        name: String(b.name ?? member.profile?.fullName ?? member.name).slice(0, 160) || undefined,
        yTunnus: String(b.yTunnus ?? member.profile?.yTunnus ?? "").slice(0, 40) || undefined,
        iban: String(b.iban ?? member.profile?.iban ?? "").slice(0, 40) || undefined,
        address: String(b.address ?? "").slice(0, 240) || undefined,
      };
      project.crew = (project.crew || []).map((m) => (m.id === member.id ? { ...m, payouts: list } : m));
      const saved = await saveProject(job, project);
      const savedMember = findCrewByToken(saved, member.token)!;
      res.json({ ok: true, view: workerView(saved, savedMember) });
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
      const { project } = loaded;
      // Mask admin-linked workers (e.g. Petrus Aalto) from this gig's roster
      // entirely — they are not part of FR8 in the coming weeks. The redirect
      // guard still protects their personal /tyo link if it's ever opened.
      const crew = (project.crew || [])
        .filter((m) => !m.adminLinked)
        .map((m) => ({
          member: m,
          stats: crewMemberStats(project, m),
          onboarded: isOnboarded(m, REQUIRED_AGREEMENT_IDS, WORKER_AGREEMENT_VERSION),
        }));
      res.json({ ok: true, crew, building: project.building, version: WORKER_AGREEMENT_VERSION });
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
      const amountCents = Math.floor(Number(req.body?.amountCents));
      if (!Number.isFinite(amountCents) || amountCents <= 0) {
        return res.status(400).json({ error: "Virheellinen summa" });
      }
      const payout = {
        id: `po_${randomUUID().slice(0, 12)}`,
        amountCents: Math.min(amountCents, 1_000_000_00),
        windows: Math.max(0, Math.floor(Number(req.body?.windows) || 0)),
        note: req.body?.note ? String(req.body.note).slice(0, 200) : undefined,
        status: "ilmoitettu" as const,
        createdAt: Date.now(),
      };
      const payouts = [payout, ...(member.payouts || [])];
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

      const billing = payout.billing || {};
      const workerName = billing.name || member.profile?.fullName || member.name;
      const workerYTunnus = billing.yTunnus || member.profile?.yTunnus || undefined;
      const workerIban = billing.iban || member.profile?.iban || undefined;
      const workerAddress = billing.address || member.profile?.city || undefined;
      const paidCount = payouts.filter((p) => p.status === "maksettu").length;
      const invoiceNo = `${member.id.toUpperCase().slice(0, 6)}-${String(paidCount + 1).padStart(2, "0")}`;
      const now = Date.now();
      const invoiceDate = new Date(now).toLocaleDateString("fi-FI");

      payout.status = "maksettu";
      payout.paidAt = now;
      payout.invoiceNo = invoiceNo;
      payout.billing = { name: workerName, yTunnus: workerYTunnus, iban: workerIban, address: workerAddress };

      project.crew = (project.crew || []).map((m) => (m.id === mid ? { ...m, payouts } : m));
      const saved = await saveProject(job, project);

      // Generate the worker's invoice PDF and email it to the team (best-effort).
      const fmtEur = (c: number) => (c / 100).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
      let emailId: string | undefined;
      try {
        const pdf = await generateWorkerInvoicePdf({
          invoiceNo, workerName, workerYTunnus, workerAddress, workerIban,
          windows: payout.windows, amountCents: payout.amountCents,
          note: payout.note, invoiceDate, paidDate: invoiceDate,
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
        <strong>${workerName}</strong> on hyväksynyt ja maksu on merkitty maksetuksi.
        Liitteenä alihankkijan lasku Puuhapatetille.
      </p>
      <table width="100%" style="border-collapse:collapse;border-top:2px solid #1A1A1A">
        <tr><td style="padding:10px 0;font-size:14px;color:#1A1A1A">${payout.note || "Ikkunanpesutyö"}${payout.windows ? ` · ${payout.windows} ikkunaa` : ""}</td>
        <td style="padding:10px 0;text-align:right;font-size:16px;font-weight:800;color:#1A1A1A">${fmtEur(payout.amountCents)}</td></tr>
      </table>
      <div style="background:#F6F4EE;border-radius:12px;padding:16px 20px;margin-top:16px;font-size:13px;color:#1A1A1A">
        <p style="margin:0 0 4px">Laskuttaja: ${workerName}${workerYTunnus ? ` · Y-tunnus ${workerYTunnus}` : ""}</p>
        ${workerIban ? `<p style="margin:0">IBAN: ${workerIban}</p>` : ""}
      </div>
    </div>
  </div>
</body></html>`;
          const result = await resend.emails.send({
            from: FROM_EMAIL,
            to: WORKER_NOTIFICATION_EMAILS,
            subject: `Alihankkijan lasku ${invoiceNo} — ${workerName} · ${fmtEur(payout.amountCents)}`,
            html,
            attachments: [{ filename: `lasku-${invoiceNo}.pdf`, content: pdf.toString("base64") }],
          });
          emailId = result.data?.id;
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
  app.get("/api/ai-status", (_req, res) => res.json({ enabled: AI_ENABLED }));

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
      if (!AI_ENABLED) {
        return res.json({ reply: "Tekoälyavustaja ei ole vielä käytössä — aseta AI_API_KEY ympäristömuuttuja ottaaksesi sen käyttöön." });
      }

      const effectiveRole: "HOST" | "STAFF" = role === "HOST" ? "HOST" : "STAFF";
      const contextBlock = await buildAdminContext(String(userId || ""), userName || "tiimiläinen", effectiveRole);

      const adminTools: AiTool[] = effectiveRole === "HOST" ? [
        {
          type: "function",
          function: {
            name: "update_job",
            description: "Päivitä keikan status tai lisää muistiinpano. Käytä kun käyttäjä pyytää päivittämään keikan tilan tai lisäämään huomion.",
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
            name: "send_followup_email",
            description: "Lähetä muistutusviesti tai yhteydenottopyyntö asiakkaalle. Käytä vain kun käyttäjä pyytää lähettämään viestin asiakkaalle.",
            parameters: {
              type: "object",
              properties: {
                job_id: { type: "number", description: "Keikan ID-numero" },
                message: { type: "string", description: "Viesti asiakkaalle suomeksi (lyhyt, max 3 lausetta)" },
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
      ] : [];

      const systemTurn: ChatTurn = { role: "system", content: adminSystemPrompt({ userName: userName || "tiimiläinen", role: effectiveRole, contextBlock }) };
      const historyTurns: ChatTurn[] = history.slice(-HISTORY_LIMIT).map((m): ChatTurn => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content || ""),
      }));
      const userTurn: ChatTurn = { role: "user", content: text };
      let turns: any[] = [systemTurn, ...historyTurns, userTurn];

      const toolResultNotes: string[] = [];
      for (let round = 0; round < 3; round++) {
        const result = await chatCompleteWithTools(turns, adminTools, { temperature: 0.4, maxTokens: 900 });

        if (!result.toolCalls || result.toolCalls.length === 0) {
          const reply = result.text ?? "En valitettavasti saanut yhteyttä tekoälypalveluun juuri nyt. Yritä hetken kuluttua uudelleen.";
          const fullReply = toolResultNotes.length > 0 ? toolResultNotes.join("\n") + "\n\n" + reply : reply;
          return res.json({ reply: fullReply });
        }

        turns.push({ role: "assistant", content: result.text ?? "", tool_calls: result.toolCalls });

        for (const tc of result.toolCalls) {
          let toolResult = "";
          try {
            const args = JSON.parse(tc.function.arguments);
            if (tc.function.name === "update_job") {
              const jobRow = (await db.select().from(jobs).where(eq(jobs.id, args.job_id)).limit(1))[0];
              if (!jobRow) {
                toolResult = `Virhe: keikkaa #${args.job_id} ei löydy.`;
              } else {
                const updates: any = { updatedAt: new Date() };
                if (args.status) updates.status = args.status;
                if (args.notes) updates.notes = (jobRow.notes || "") + "\n[" + new Date().toLocaleDateString("fi-FI") + "] " + args.notes;
                await db.update(jobs).set(updates).where(eq(jobs.id, args.job_id));
                const changes = [args.status ? `status → ${args.status}` : null, args.notes ? "muistiinpano lisätty" : null].filter(Boolean).join(", ");
                toolResult = `Keikka #${args.job_id} päivitetty: ${changes}.`;
                toolResultNotes.push(`✓ ${toolResult}`);
              }
            } else if (tc.function.name === "send_followup_email") {
              if (!resend) {
                toolResult = "Virhe: sähköpostipalvelu ei käytössä.";
              } else {
                const jobRow = (await db.select().from(jobs).where(eq(jobs.id, args.job_id)).limit(1))[0];
                if (!jobRow) {
                  toolResult = `Virhe: keikkaa #${args.job_id} ei löydy.`;
                } else {
                  const customer = jobRow.customerId
                    ? (await db.select().from(customers).where(eq(customers.id, jobRow.customerId)).limit(1))[0]
                    : null;
                  if (!customer?.email) {
                    toolResult = `Keikalla #${args.job_id} ei ole asiakkaan sähköpostia — ei voitu lähettää.`;
                  } else {
                    // Duplicate protection: check if outreach sent in last 30 days
                    const notes = jobRow.notes || "";
                    const recentOutreach = notes.split("\n").some(line => {
                      if (!line.includes("yhteydenotto lähetetty")) return false;
                      const match = line.match(/\[(\d+)\.(\d+)\.(\d+)/);
                      if (!match) return false;
                      const [, d, m, y] = match;
                      const sent = new Date(Number(y), Number(m) - 1, Number(d));
                      return (Date.now() - sent.getTime()) < 30 * 24 * 60 * 60 * 1000;
                    });
                    if (recentOutreach) {
                      toolResult = `⚠️ Asiakkaalle ${customer.name} on jo lähetetty yhteydenotto viimeisen 30 päivän aikana. Jos haluat lähettää uudelleen, sano niin erikseen.`;
                    } else {
                      const style = args.style || "henkikohtainen";
                      const firstName = customer.name?.split(" ")[0] ?? customer.name ?? "";
                      const today = new Date().toLocaleDateString("fi-FI");
                      const msg = (args.message as string).replace(/\n/g, "<br>");
                      const msgPlain = args.message as string;

                      let html = "";

                      if (style === "lyhyt") {
                        // Plain text style — no images, minimal HTML
                        html = `<!DOCTYPE html>
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

                      } else if (style === "pro") {
                        // Branded professional with green header + photo
                        html = `<!DOCTYPE html>
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

                      } else {
                        // henkikohtainen (default) — simple, warm, personal feel
                        html = `<!DOCTYPE html>
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

                      await resend.emails.send({
                        from: FROM_EMAIL,
                        to: customer.email,
                        subject: `Hei ${firstName} — terveisiä Puuhapatet!`,
                        html,
                      });

                      // Mark outreach in job notes
                      const outreachNote = `[${today} yhteydenotto lähetetty sähköpostilla: ${customer.email} (tyyli: ${style})]`;
                      await db.update(jobs).set({
                        notes: notes ? notes + "\n" + outreachNote : outreachNote,
                        updatedAt: new Date()
                      }).where(eq(jobs.id, args.job_id));

                      toolResult = `Viesti lähetetty (${style}) asiakkaalle ${customer.name} <${customer.email}>.`;
                      toolResultNotes.push(`✓ ${toolResult}`);
                    }
                  }
                }
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
      res.json({ reply: toolResultNotes.join("\n") || "Toimenpiteet suoritettu." });
    } catch (e: any) {
      console.error("Admin assistant error:", e);
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

    // HOST-only: financial overview
    if (role === "HOST") {
      const done = allJobs.filter(j => j.status === "done");
      const revenue = done.reduce((s, j) => s + (j.agreedPrice || 0), 0);
      lines.push(`\nTalous (vain perustajat): valmiita keikkoja ${done.length}, liikevaihto valmiista ${eur(revenue)}.`);
      lines.push(`Asiakkaita yhteensä: ${allCustomers.length}.`);
    } else {
      lines.push(`\nAsiakkaita näkyvissä: ${new Set(visibleJobs.map(j => j.customerId)).size}.`);
    }

    return lines.join("\n");
  }

  return httpServer;
}
