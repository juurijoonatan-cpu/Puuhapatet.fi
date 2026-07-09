/**
 * Upload helpers — create-or-update a Drive file, tracked in `drive_files`
 * so re-uploading the same logical document (same `kind` + `sourceKey`)
 * updates the SAME Drive file in place instead of piling up duplicates.
 */
import { Readable } from "stream";
import { eq, and } from "drizzle-orm";
import { db } from "../db";
import { driveFiles } from "@shared/schema";
import { getDrive, isDriveConfigured } from "./client";
import { ensurePath } from "./folders";

const SHEET_MIME = "application/vnd.google-apps.spreadsheet";

async function upsertTracking(kind: string, sourceKey: string, fileId: string, folderId: string, webViewLink?: string | null) {
  const existing = await db.select().from(driveFiles)
    .where(and(eq(driveFiles.kind, kind), eq(driveFiles.sourceKey, sourceKey)));
  if (existing[0]) {
    await db.update(driveFiles)
      .set({ driveFileId: fileId, driveFolderId: folderId, webViewLink, updatedAt: new Date() })
      .where(eq(driveFiles.id, existing[0].id));
  } else {
    await db.insert(driveFiles).values({ kind, sourceKey, driveFileId: fileId, driveFolderId: folderId, webViewLink });
  }
}

interface UploadTarget {
  /** Folder path segments from the configured Drive root, e.g. ["Laskut", "2026", "Asiakaslaskut"]. */
  folderPath: string[];
  filename: string;
  /** Dedupe/update-in-place key — same (kind, sourceKey) always targets the same Drive file. */
  kind: string;
  sourceKey: string;
}

/**
 * Upload (or update) a PDF. Best-effort: returns null and logs a warning on
 * any failure (missing config, Drive API error) rather than throwing — a
 * failed backup must never break the invoice/report flow that triggered it.
 */
export async function uploadPdf(target: UploadTarget, buffer: Buffer): Promise<string | null> {
  if (!isDriveConfigured()) return null;
  try {
    const drive = getDrive()!;
    const folderId = await ensurePath(target.folderPath);
    const existing = await db.select().from(driveFiles)
      .where(and(eq(driveFiles.kind, target.kind), eq(driveFiles.sourceKey, target.sourceKey)));
    const media = { mimeType: "application/pdf", body: Readable.from(buffer) };

    let fileId: string;
    let webViewLink: string | null | undefined;
    if (existing[0]) {
      const updated = await drive.files.update({ fileId: existing[0].driveFileId, media, fields: "id, webViewLink" });
      fileId = updated.data.id!;
      webViewLink = updated.data.webViewLink;
    } else {
      const created = await drive.files.create({
        requestBody: { name: target.filename, parents: [folderId] },
        media,
        fields: "id, webViewLink",
      });
      fileId = created.data.id!;
      webViewLink = created.data.webViewLink;
    }
    await upsertTracking(target.kind, target.sourceKey, fileId, folderId, webViewLink);
    return fileId;
  } catch (e) {
    console.warn(`Drive-varmuuskopio epäonnistui (${target.kind}/${target.sourceKey}):`, (e as Error).message);
    return null;
  }
}

/**
 * Upload (or update) tabular data as a native Google Sheet — CSV content is
 * converted automatically by Drive when the target mimeType is
 * application/vnd.google-apps.spreadsheet (both on create AND on update of
 * an existing Sheet's content, per the Drive API v3 contract).
 */
export async function uploadAsSheet(target: UploadTarget, csvContent: string): Promise<string | null> {
  if (!isDriveConfigured()) return null;
  try {
    const drive = getDrive()!;
    const folderId = await ensurePath(target.folderPath);
    const existing = await db.select().from(driveFiles)
      .where(and(eq(driveFiles.kind, target.kind), eq(driveFiles.sourceKey, target.sourceKey)));
    // Prepend a UTF-8 BOM so Google Sheets/Excel read Finnish characters (ä/ö) correctly.
    const media = { mimeType: "text/csv", body: Readable.from("﻿" + csvContent) };

    let fileId: string;
    let webViewLink: string | null | undefined;
    if (existing[0]) {
      const updated = await drive.files.update({ fileId: existing[0].driveFileId, media, fields: "id, webViewLink" });
      fileId = updated.data.id!;
      webViewLink = updated.data.webViewLink;
    } else {
      const created = await drive.files.create({
        requestBody: { name: target.filename, parents: [folderId], mimeType: SHEET_MIME },
        media,
        fields: "id, webViewLink",
      });
      fileId = created.data.id!;
      webViewLink = created.data.webViewLink;
    }
    await upsertTracking(target.kind, target.sourceKey, fileId, folderId, webViewLink);
    return fileId;
  } catch (e) {
    console.warn(`Drive-varmuuskopio epäonnistui (${target.kind}/${target.sourceKey}):`, (e as Error).message);
    return null;
  }
}

export async function getTrackedFile(kind: string, sourceKey: string) {
  const rows = await db.select().from(driveFiles).where(and(eq(driveFiles.kind, kind), eq(driveFiles.sourceKey, sourceKey)));
  return rows[0] ?? null;
}
