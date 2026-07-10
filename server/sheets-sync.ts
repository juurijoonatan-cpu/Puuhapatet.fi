/**
 * Kirjanpito → Google Sheets + Drive -synkka (ks. docs/kirjanpito-sheets-integraatio.md).
 *
 * Yksi Google-palvelutili omistaa/hallinnoi yhtä Drive-juurikansiota (PDF:t,
 * kansio per tekijä) ja yhtä Sheetiä (rakenteinen loki, rivi per lasku).
 * Laiska alustus samalla kaavalla kuin Resend: jos ympäristömuuttujia ei ole,
 * kaikki no-oppaa hiljaa eikä vaadi mitään paikallisessa kehityksessä.
 *
 * Kutsuja EI koskaan saa kaatua tämän takia — jokainen julkinen funktio
 * nielee omat virheensä ja kirjaa ne `externalSyncLog`-tauluun.
 */
import { google } from "googleapis";
import { eq, and, desc, sql } from "drizzle-orm";
import { Readable } from "stream";
import { db } from "./db";
import { driveWorkerFolders, externalSyncLog } from "@shared/schema";
import type { BuyerSnapshot } from "@shared/billers";
import type { TaxBreakdown } from "@shared/tax";

const SHEET_ID = process.env.GOOGLE_SHEETS_LASKUTUS_ID || "";
const ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_LASKUTUS_FOLDER_ID || "";
const SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";

export function isSheetsSyncEnabled(): boolean {
  return !!SERVICE_ACCOUNT_JSON && !!SHEET_ID && !!ROOT_FOLDER_ID;
}

let authClient: InstanceType<typeof google.auth.GoogleAuth> | null = null;
function getAuth() {
  if (!authClient) {
    authClient = new google.auth.GoogleAuth({
      credentials: JSON.parse(SERVICE_ACCOUNT_JSON),
      scopes: ["https://www.googleapis.com/auth/drive", "https://www.googleapis.com/auth/spreadsheets"],
    });
  }
  return authClient;
}
function drive() { return google.drive({ version: "v3", auth: getAuth() as any }); }
function sheets() { return google.sheets({ version: "v4", auth: getAuth() as any }); }

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 500 * Math.pow(3, i)));
    }
  }
  throw lastErr;
}

/** Hakee (tai luo) tekijän Drive-kansion juurikansion alle. Kansio-ID
 *  välimuistitetaan `driveWorkerFolders`-tauluun, jotta jokainen lasku ei
 *  tee ylimääräistä Drive-hakua. Jakaa kansion tekijän omalle Google-tilille
 *  (jos sähköposti tiedossa) VAIN kerran, ensimmäisellä luontikerralla —
 *  best-effort, epäonnistuminen (esim. ei Google-tiliä) ei vaikuta mihinkään. */
async function ensureWorkerFolder(workerId: string, workerName: string, workerEmail?: string): Promise<string> {
  const [cached] = await db.select().from(driveWorkerFolders).where(eq(driveWorkerFolders.workerId, workerId));
  if (cached) return cached.folderId;

  const d = drive();
  const safeName = `${workerName} (${workerId})`;
  const existing = await withRetry(() => d.files.list({
    q: `'${ROOT_FOLDER_ID}' in parents and name = '${safeName.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id)",
  }));
  let folderId = existing.data.files?.[0]?.id;
  if (!folderId) {
    const created = await withRetry(() => d.files.create({
      requestBody: { name: safeName, mimeType: "application/vnd.google-apps.folder", parents: [ROOT_FOLDER_ID] },
      fields: "id",
    }));
    folderId = created.data.id ?? undefined;
  }
  if (!folderId) throw new Error("Drive-kansion luonti epäonnistui (ei id:tä)");

  let sharedWithEmail: string | null = null;
  if (workerEmail) {
    try {
      await withRetry(() => d.permissions.create({
        fileId: folderId!,
        requestBody: { type: "user", role: "reader", emailAddress: workerEmail },
        sendNotificationEmail: false,
      }));
      sharedWithEmail = workerEmail;
    } catch {
      // Ei Google-tiliä tuolla osoitteella tms. — ei este, tekijä saa laskunsa silti sähköpostitse.
    }
  }
  await db.insert(driveWorkerFolders).values({ workerId, folderId, sharedWithEmail });
  return folderId;
}

async function alreadySynced(recordType: string, recordId: string): Promise<boolean> {
  const [row] = await db.select().from(externalSyncLog)
    .where(and(eq(externalSyncLog.recordType, recordType), eq(externalSyncLog.recordId, recordId), eq(externalSyncLog.success, true)));
  return !!row;
}

async function logSync(params: { recordType: string; recordId: string; jobId: number; memberId: string; success: boolean; error?: string }) {
  await db.insert(externalSyncLog).values({
    recordType: params.recordType, recordId: params.recordId, jobId: params.jobId, memberId: params.memberId,
    target: "sheets_drive", success: params.success, error: params.error,
  });
}

export interface PayoutSyncParams {
  jobId: number;
  memberId: string;
  payoutId: string;
  workerName: string;
  workerYTunnus?: string;
  workerEmail?: string;
  invoiceNo: string;
  invoiceDate: string;
  windows: number;
  note?: string;
  buyer: BuyerSnapshot;
  tax: TaxBreakdown;
  pdfBuffer: Buffer;
}

/** Ydinfunktio: yksi tekijän lasku Driveen (PDF) + Sheetsiin (rivi). Idempotentti
 *  (`recordId` = payoutId) — uusintakutsu jo onnistuneelle laskulle ei tee mitään.
 *  Nielee KAIKKI virheet ja kirjaa ne `externalSyncLog`:iin; ei koskaan heitä. */
export async function syncPayoutRecord(p: PayoutSyncParams): Promise<void> {
  if (!isSheetsSyncEnabled()) return;
  try {
    if (await alreadySynced("payout", p.payoutId)) return;

    const folderId = await ensureWorkerFolder(p.memberId, p.workerName, p.workerEmail);
    const d = drive();
    const uploaded = await withRetry(() => d.files.create({
      requestBody: { name: `Lasku-${p.invoiceNo}.pdf`, parents: [folderId] },
      media: { mimeType: "application/pdf", body: bufferToStream(p.pdfBuffer) },
      fields: "id, webViewLink",
    }));
    const driveLink = uploaded.data.webViewLink || `https://drive.google.com/file/d/${uploaded.data.id}`;

    const fmtEur = (c: number) => (c / 100).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const row = [
      p.invoiceDate, p.invoiceNo, p.workerName, p.workerYTunnus || "",
      p.buyer.name + (p.buyer.yTunnus ? ` (${p.buyer.yTunnus})` : ""),
      p.windows, fmtEur(p.tax.laborCents), fmtEur(p.tax.vatCents), fmtEur(p.tax.withholdingCents),
      fmtEur(p.tax.payableCents), "maksettu", p.jobId, driveLink,
    ];
    await withRetry(() => sheets().spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "A1",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [row] },
    }));

    await logSync({ recordType: "payout", recordId: p.payoutId, jobId: p.jobId, memberId: p.memberId, success: true });
  } catch (e: any) {
    console.error("syncPayoutRecord failed:", e?.message || e);
    await logSync({ recordType: "payout", recordId: p.payoutId, jobId: p.jobId, memberId: p.memberId, success: false, error: e?.message || String(e) })
      .catch((logErr) => console.error("syncPayoutRecord: log write also failed:", logErr));
  }
}

function bufferToStream(buf: Buffer) {
  return Readable.from(buf);
}

/** Viimeisimmät synkkayritykset + onnistumis/epäonnistumis-laskuri, admin-UI:ta varten. */
export async function getSyncStatus(limit = 20) {
  const recent = await db.select().from(externalSyncLog).orderBy(desc(externalSyncLog.syncedAt)).limit(limit);
  const [successRow] = await db.select({ count: sql<number>`count(*)::int` }).from(externalSyncLog).where(eq(externalSyncLog.success, true));
  const [failureRow] = await db.select({ count: sql<number>`count(*)::int` }).from(externalSyncLog).where(eq(externalSyncLog.success, false));
  return { enabled: isSheetsSyncEnabled(), recent, successCount: successRow?.count ?? 0, failureCount: failureRow?.count ?? 0 };
}
