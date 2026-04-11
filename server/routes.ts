import type { Express } from "express";
import { type Server } from "http";
import { eq, desc, sql, ne } from "drizzle-orm";
import { db } from "./db";
import { customers, jobs, expenses, insertCustomerSchema, insertJobSchema, insertExpenseSchema } from "@shared/schema";

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {

  // ─── Health ──────────────────────────────────────────────────────────────────
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, ts: new Date().toISOString() });
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
      const data = insertJobSchema.parse(req.body);
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
      const [totals] = await db.select({
        totalJobs:    sql<number>`count(*)`,
        totalRevenue: sql<number>`coalesce(sum(${jobs.agreedPrice}), 0)`,
        upcoming:     sql<number>`count(*) filter (where ${jobs.status} = 'scheduled')`,
      }).from(jobs);

      const [expenseTotals] = await db.select({
        totalExpenses: sql<number>`coalesce(sum(${expenses.amount}), 0)`,
      }).from(expenses);

      const totalRevenue = Number(totals.totalRevenue);
      const totalExpenses = Number(expenseTotals.totalExpenses);
      const serviceFeeTotal = Math.round(totalRevenue * 0.10); // 10% palvelumaksu
      const netIncome = totalRevenue - totalExpenses - serviceFeeTotal;

      res.json({
        totalJobs:       Number(totals.totalJobs),
        totalRevenue,    // senttiä
        totalExpenses,   // senttiä
        serviceFeeTotal, // senttiä — maksamaton palvelumaksu brändille
        netIncome,       // senttiä — verotettava nettotulo
        upcoming:        Number(totals.upcoming),
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

  // Returns accumulated service-fee debt per worker across all "done" jobs
  app.get("/api/workers/stats", async (_req, res) => {
    try {
      const doneJobs = await db.select().from(jobs).where(eq(jobs.status, "done"));
      const allExpenses = await db.select().from(expenses);

      const expensesByJob: Record<number, number> = {};
      for (const e of allExpenses) {
        expensesByJob[e.jobId] = (expensesByJob[e.jobId] ?? 0) + e.amount;
      }

      const workerFees: Record<string, number> = {};
      const workerJobCount: Record<string, number> = {};

      for (const job of doneJobs) {
        const jobExpenses = expensesByJob[job.id] ?? 0;
        const netRevenue = Math.max(0, job.agreedPrice - jobExpenses);
        const serviceFee = Math.round(netRevenue * 0.10);
        const workerIds = normalizeWorkerIds(job.assignedTo);
        if (workerIds.length === 0) continue;
        const feePerWorker = Math.round(serviceFee / workerIds.length);
        for (const wid of workerIds) {
          workerFees[wid] = (workerFees[wid] ?? 0) + feePerWorker;
          workerJobCount[wid] = (workerJobCount[wid] ?? 0) + 1;
        }
      }

      res.json({ workerFees, workerJobCount });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  return httpServer;
}
