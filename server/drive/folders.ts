/**
 * Idempotent Drive folder creation — walks a path of folder names from the
 * configured root, creating any segment that doesn't exist yet. Always
 * queries Drive rather than caching ids across process restarts, so a human
 * reorganizing the target Drive folder never leaves this pointing at a
 * stale/deleted folder.
 *
 * Folder layout (see docs/google-drive-backup.md for the full rationale):
 *   <root>/
 *     Laskut/<vuosi>/Asiakaslaskut/
 *     Laskut/<vuosi>/Sisäiset laskut/
 *     Kirjanpito/<Founder>/<vuosi>/
 *     Ennustelaskelmat/<Founder>/
 */
import { getDrive, rootFolderId } from "./client";

const FOLDER_MIME = "application/vnd.google-apps.folder";

async function findOrCreateFolder(name: string, parentId: string): Promise<string> {
  const drive = getDrive();
  if (!drive) throw new Error("Drive ei ole konfiguroitu");
  const escaped = name.replace(/'/g, "\\'");
  const q = `mimeType = '${FOLDER_MIME}' and '${parentId}' in parents and name = '${escaped}' and trashed = false`;
  const found = await drive.files.list({ q, fields: "files(id, name)", pageSize: 1 });
  const existing = found.data.files?.[0];
  if (existing?.id) return existing.id;

  const created = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] },
    fields: "id",
  });
  if (!created.data.id) throw new Error(`Kansion "${name}" luonti epäonnistui`);
  return created.data.id;
}

/** Ensure every segment in `path` exists under the configured root, in order. Returns the deepest folder's id. */
export async function ensurePath(path: string[]): Promise<string> {
  let parentId = rootFolderId();
  for (const segment of path) {
    parentId = await findOrCreateFolder(segment, parentId);
  }
  return parentId;
}
