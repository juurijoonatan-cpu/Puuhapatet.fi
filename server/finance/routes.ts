/**
 * HTTP surface for the double-entry ledger ("Talous ja verotus" -osion uusi
 * kirjanpito). Registered from server/routes.ts via registerFinanceRoutes().
 * Every GET here rebuilds the ledger first (server/finance/post.ts) so the
 * numbers are always current — no separate "sync" step exists or is needed.
 */
import type { Express } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { forecastEntries, insertForecastEntrySchema } from "@shared/schema";
import { ledgerList, getChartOfAccounts, getJournal, getGeneralLedger, getIncomeStatement, getBalanceSheet, getFinanceSummary } from "./reports";
import { monthRange, projectMonths } from "./forecast";

function parseYear(v: unknown): number {
  const y = Number(v);
  return Number.isFinite(y) && y > 1900 ? y : new Date().getFullYear();
}

function requireLedgerId(v: unknown): string {
  const id = String(v ?? "");
  if (!id) throw Object.assign(new Error("ledgerId puuttuu"), { status: 400 });
  return id;
}

export function registerFinanceRoutes(app: Express) {
  // Kirjanpito on perustajien omaa, yksityiskohtaista talousdataa (per Y-tunnus) —
  // samalla "vain perustaja" -periaatteella kuin muissakin rahaa hallitsevissa
  // admin-reiteissä (esim. laskutuserien hallinta, server/routes.ts).
  app.use("/api/finance", (req, res, next) => {
    if ((req as any).admin?.role !== "host") return res.status(403).json({ error: "Vain perustaja voi käsitellä kirjanpitoa." });
    next();
  });

  app.get("/api/finance/ledgers", async (_req, res) => {
    res.json({ ledgers: ledgerList() });
  });

  app.get("/api/finance/chart-of-accounts", async (req, res) => {
    try {
      const ledgerId = requireLedgerId(req.query.ledgerId);
      res.json({ accounts: await getChartOfAccounts(ledgerId) });
    } catch (e: any) {
      res.status(e.status ?? 500).json({ error: e.message });
    }
  });

  app.get("/api/finance/journal", async (req, res) => {
    try {
      const ledgerId = requireLedgerId(req.query.ledgerId);
      const year = req.query.year ? parseYear(req.query.year) : undefined;
      res.json({ entries: await getJournal(ledgerId, year) });
    } catch (e: any) {
      res.status(e.status ?? 500).json({ error: e.message });
    }
  });

  app.get("/api/finance/general-ledger", async (req, res) => {
    try {
      const ledgerId = requireLedgerId(req.query.ledgerId);
      const year = req.query.year ? parseYear(req.query.year) : undefined;
      res.json({ accounts: await getGeneralLedger(ledgerId, year) });
    } catch (e: any) {
      res.status(e.status ?? 500).json({ error: e.message });
    }
  });

  app.get("/api/finance/income-statement", async (req, res) => {
    try {
      const ledgerId = requireLedgerId(req.query.ledgerId);
      res.json(await getIncomeStatement(ledgerId, parseYear(req.query.year)));
    } catch (e: any) {
      res.status(e.status ?? 500).json({ error: e.message });
    }
  });

  app.get("/api/finance/balance-sheet", async (req, res) => {
    try {
      const ledgerId = requireLedgerId(req.query.ledgerId);
      const asOf = req.query.asOf ? new Date(String(req.query.asOf)) : new Date();
      res.json(await getBalanceSheet(ledgerId, asOf));
    } catch (e: any) {
      res.status(e.status ?? 500).json({ error: e.message });
    }
  });

  app.get("/api/finance/summary", async (req, res) => {
    try {
      const ledgerId = requireLedgerId(req.query.ledgerId);
      res.json(await getFinanceSummary(ledgerId, parseYear(req.query.year)));
    } catch (e: any) {
      res.status(e.status ?? 500).json({ error: e.message });
    }
  });

  // ─── Ennustelaskelma (forecast) — planning only, never touches the ledger ──

  app.get("/api/finance/forecast", async (req, res) => {
    try {
      const ledgerId = requireLedgerId(req.query.ledgerId);
      const rows = await db.select().from(forecastEntries).where(eq(forecastEntries.ledgerId, ledgerId));
      res.json({ entries: rows });
    } catch (e: any) {
      res.status(e.status ?? 500).json({ error: e.message });
    }
  });

  app.post("/api/finance/forecast", async (req, res) => {
    try {
      const data = insertForecastEntrySchema.parse(req.body);
      const [row] = await db.insert(forecastEntries).values(data).returning();
      res.status(201).json(row);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.patch("/api/finance/forecast/:id", async (req, res) => {
    try {
      const [row] = await db.update(forecastEntries).set(req.body)
        .where(eq(forecastEntries.id, Number(req.params.id))).returning();
      if (!row) return res.status(404).json({ error: "Ei löydy" });
      res.json(row);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete("/api/finance/forecast/:id", async (req, res) => {
    try {
      await db.delete(forecastEntries).where(eq(forecastEntries.id, Number(req.params.id)));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/finance/forecast/projection", async (req, res) => {
    try {
      const ledgerId = requireLedgerId(req.query.ledgerId);
      const now = new Date();
      const defaultStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const defaultEndDate = new Date(now.getFullYear(), now.getMonth() + 11, 1);
      const defaultEnd = `${defaultEndDate.getFullYear()}-${String(defaultEndDate.getMonth() + 1).padStart(2, "0")}`;
      const start = String(req.query.start || defaultStart);
      const end = String(req.query.end || defaultEnd);
      const rows = await db.select().from(forecastEntries).where(eq(forecastEntries.ledgerId, ledgerId));
      const months = projectMonths(rows, monthRange(start, end));
      res.json({ months });
    } catch (e: any) {
      res.status(e.status ?? 500).json({ error: e.message });
    }
  });
}
