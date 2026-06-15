/**
 * Allekirjoitettujen sopimusten tallennus adminille.
 *
 * POST  /api/contract  → tallentaa allekirjoitetun sopimuksen tiedostoksi
 *                        (JSON + itsenäinen HTML) hakemistoon data/signed-contracts.
 * GET   /api/contract  → listaa tallennetut sopimukset adminin näkymää varten.
 *
 * Huom: staattisessa hostingissa (esim. GitHub Pages) tätä reittiä ei ole.
 * Siksi asiakaspuoli tallentaa sopimuksen myös localStorageen ja lataa sen
 * tiedostona, joten allekirjoitus ei katoa, vaikka palvelinta ei olisi.
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildSignedHtml, signedFileName } from "@/lib/signedFile";
import type { SignedContract } from "@/lib/contract";

const DIR = path.join(process.cwd(), "data", "signed-contracts");

function baseName(signed: SignedContract) {
  const d = new Date(signed.signedAt);
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(
    d.getDate()
  ).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
  const who = (signed.customer.legalName || "tilaaja")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${signed.contractId}_${who}_${stamp}`;
}

export async function POST(req: Request) {
  let signed: SignedContract;
  try {
    signed = (await req.json()) as SignedContract;
  } catch {
    return Response.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  if (!signed?.signatureDataUrl || !signed?.customer?.legalName) {
    return Response.json({ ok: false, error: "missing fields" }, { status: 400 });
  }

  try {
    await mkdir(DIR, { recursive: true });
    const base = baseName(signed);
    await writeFile(path.join(DIR, `${base}.json`), JSON.stringify(signed, null, 2), "utf8");
    await writeFile(path.join(DIR, `${base}.html`), buildSignedHtml(signed), "utf8");
    return Response.json({ ok: true, file: `${base}.json`, download: signedFileName(signed) });
  } catch (e) {
    // Vain luku -tiedostojärjestelmä tms. — kerro, ettei palvelintallennus onnistunut.
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "write failed", storedLocally: true },
      { status: 200 }
    );
  }
}

export async function GET(req: Request) {
  // ?file=NAME.html → palauttaa yksittäisen allekirjoitetun sopimuksen HTML:nä.
  const url = new URL(req.url);
  const wanted = url.searchParams.get("file");
  if (wanted) {
    // Estä polkuhyökkäykset: sallitaan vain pelkkä tiedostonimi.
    if (wanted.includes("/") || wanted.includes("..") || !wanted.endsWith(".html")) {
      return new Response("bad request", { status: 400 });
    }
    try {
      const html = await readFile(path.join(DIR, wanted), "utf8");
      return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    } catch {
      return new Response("not found", { status: 404 });
    }
  }

  try {
    const files = await readdir(DIR).catch(() => [] as string[]);
    const jsons = files.filter((f) => f.endsWith(".json"));
    const items = await Promise.all(
      jsons.map(async (f) => {
        try {
          const raw = await readFile(path.join(DIR, f), "utf8");
          const s = JSON.parse(raw) as SignedContract;
          return {
            file: f,
            contractId: s.contractId,
            signedAt: s.signedAt,
            order: s.order,
            legalName: s.customer?.legalName,
            signerName: s.signerName,
          };
        } catch {
          return null;
        }
      })
    );
    return Response.json({ ok: true, items: items.filter(Boolean) });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "read failed" }, { status: 200 });
  }
}
