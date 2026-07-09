/**
 * Google Drive backup — auth client.
 *
 * Optional feature: without GOOGLE_SERVICE_ACCOUNT_KEY configured, every
 * caller in this module tree no-ops (same pattern as RESEND_API_KEY /
 * AI_API_KEY elsewhere in this app — a missing key disables the feature,
 * never breaks the request that triggered it). See
 * docs/google-drive-backup.md for how to create and configure the service
 * account.
 */
import { google, drive_v3 } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/drive"];

let cachedDrive: drive_v3.Drive | null | undefined;

function loadCredentials(): { client_email: string; private_key: string } | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) return null;
  try {
    const json = JSON.parse(raw);
    if (!json.client_email || !json.private_key) return null;
    return { client_email: json.client_email, private_key: json.private_key };
  } catch {
    console.warn("GOOGLE_SERVICE_ACCOUNT_KEY is set but is not valid JSON — Drive backup disabled.");
    return null;
  }
}

export function isDriveConfigured(): boolean {
  return !!loadCredentials() && !!process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
}

/** Lazily-created singleton Drive client, or null if not configured. */
export function getDrive(): drive_v3.Drive | null {
  if (cachedDrive !== undefined) return cachedDrive;
  const creds = loadCredentials();
  if (!creds || !process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID) {
    cachedDrive = null;
    return null;
  }
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: SCOPES,
  });
  cachedDrive = google.drive({ version: "v3", auth });
  return cachedDrive;
}

export function rootFolderId(): string {
  const id = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (!id) throw new Error("GOOGLE_DRIVE_ROOT_FOLDER_ID puuttuu");
  return id;
}
