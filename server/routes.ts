import type { Express } from "express";
import { type Server } from "http";
import { eq, desc, sql, ne, and } from "drizzle-orm";
import { Resend } from "resend";
import { db } from "./db";
import { customers, jobs, expenses, workerPayments, investments, startupBonusUsages, users, insertCustomerSchema, insertJobSchema, insertExpenseSchema, insertInvestmentSchema, insertStartupBonusUsageSchema } from "@shared/schema";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
// Ennen kuin puuhapatet.fi-domain on vahvistettu Resendissä, käytä onboarding@resend.dev
const FROM_EMAIL = process.env.FROM_EMAIL || "Puuhapatet <onboarding@resend.dev>";
// Optional: protect the calendar feed with a token (set CALENDAR_TOKEN env var on Render)
const CALENDAR_TOKEN = process.env.CALENDAR_TOKEN || null;

function escapeIcs(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function toIcsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {

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
        .where(and(ne(jobs.status, "cancelled"), ne(jobs.status, "done")));

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
      // Counts: all non-cancelled jobs
      const [counts] = await db.select({
        totalJobs: sql<number>`count(*) filter (where ${jobs.status} != 'cancelled')`,
        upcoming:  sql<number>`count(*) filter (where ${jobs.status} = 'scheduled')`,
      }).from(jobs);

      // Financial figures: done jobs only (completed work)
      const doneJobs = await db.select().from(jobs).where(eq(jobs.status, "done"));
      const allExpenses = await db.select().from(expenses);

      const expensesByJob: Record<number, number> = {};
      for (const e of allExpenses) {
        expensesByJob[e.jobId] = (expensesByJob[e.jobId] ?? 0) + e.amount;
      }

      let totalRevenue = 0, totalExpenses = 0, serviceFeeTotal = 0;
      for (const job of doneJobs) {
        const jobExp = expensesByJob[job.id] ?? 0;
        totalRevenue += job.agreedPrice;
        totalExpenses += jobExp;
        // Service fee: 10% of net revenue (same formula as workers/stats)
        serviceFeeTotal += Math.round(Math.max(0, job.agreedPrice - jobExp) * 0.10);
      }
      const netIncome = totalRevenue - totalExpenses - serviceFeeTotal;

      res.json({
        totalJobs:       Number(counts.totalJobs),
        totalRevenue,    // senttiä — valmistuneista keikoista
        totalExpenses,   // senttiä
        serviceFeeTotal, // senttiä — 10 % nettotuloista
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
      const doneJobs = await db.select().from(jobs).where(eq(jobs.status, "done"));
      const allExpenses = await db.select().from(expenses);
      const allPayments = await db.select().from(workerPayments);

      const expensesByJob: Record<number, number> = {};
      for (const e of allExpenses) {
        expensesByJob[e.jobId] = (expensesByJob[e.jobId] ?? 0) + e.amount;
      }

      const totalPaidByWorker: Record<string, number> = {};
      for (const p of allPayments) {
        totalPaidByWorker[p.workerId] = (totalPaidByWorker[p.workerId] ?? 0) + p.amountPaid;
      }

      const workerFeesTotal: Record<string, number> = {};
      const workerJobCount: Record<string, number> = {};

      for (const job of doneJobs) {
        const jobExpenses = expensesByJob[job.id] ?? 0;
        const netRevenue = Math.max(0, job.agreedPrice - jobExpenses);
        const serviceFee = Math.round(netRevenue * 0.10);
        const workerIds = normalizeWorkerIds(job.assignedTo);
        if (workerIds.length === 0) continue;
        const feePerWorker = Math.round(serviceFee / workerIds.length);
        for (const wid of workerIds) {
          workerFeesTotal[wid] = (workerFeesTotal[wid] ?? 0) + feePerWorker;
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

      res.json({ workerFees, workerJobCount, brandCash });
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
            ? `This service qualifies for the Finnish <strong>household tax deduction</strong>. You can reclaim 40% of the labour cost in your taxes — up to €2,250 per person per year. This invoice serves as documentation, no separate receipt needed.<br><br>More info: <a href="https://vero.fi/en/individuals/tax-cards-and-tax-returns/deductions/household-deduction/" style="color:#047857;font-weight:600">vero.fi (household deduction)</a>`
            : `Tämä palvelu on <strong>kotitalousvähennyskelpoinen</strong>. Voit hakea verotuksessa 40 % työn osuudesta takaisin — enintään 2 250 € / henkilö / vuosi. Lasku toimii dokumenttina, ei erillistä kuittia tarvita.<br><br>Lisätietoa: <a href="https://vero.fi/kotitalousvahennys" style="color:#047857;font-weight:600">vero.fi/kotitalousvähennys</a>`
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
        to, bcc, quoteId, customerName, customerAddress,
        items, total, validDays, customMessage,
        workerName, workerPhone, workerEmail, lang,
      } = req.body;

      if (!to || !customerName || !quoteId || !items?.length) {
        return res.status(400).json({ error: "Puuttuvia kenttiä" });
      }

      const isEn      = lang === "en";
      const firstName = (customerName as string).split(" ")[0];
      const today     = new Date().toLocaleDateString(isEn ? "en-GB" : "fi-FI");
      const vDays     = validDays || 14;
      const validUntil = new Date(Date.now() + vDays * 24 * 60 * 60 * 1000)
        .toLocaleDateString(isEn ? "en-GB" : "fi-FI");

      const kotitalous = Math.round(Number(total) * 0.65);

      // ── Default intro — reads naturally, pushes conversion ──────────────
      const defaultIntro = isEn
        ? `Hi ${firstName}! Here's the quote we put together based on your property. Everything's included — no hidden extras. If you have questions or want to adjust anything, just give us a call.`
        : `Hei ${firstName}! Tässä on kartoituksen perusteella tekemämme tarjous. Kaikki on hinnoiteltu avoimesti — ei piilokuluia. Jos jokin mietityttää tai haluatte muokata jotain, soittakaa rohkeasti.`;

      const introText = customMessage
        ? (customMessage as string).replace(/\n/g, "<br>")
        : defaultIntro;

      // ── Service rows — title + optional detail on second line ────────────
      const serviceRowsHtml = (items as Array<{ title: string; detail: string; price: number }>)
        .map((item, idx) => `
          <tr style="border-bottom:1px solid #f1f5f9;background:${idx % 2 === 1 ? "#f8fafc" : "#ffffff"}">
            <td style="padding:14px 20px 14px 0;vertical-align:top">
              <p style="margin:0;color:#0f172a;font-size:14px;font-weight:600">${item.title}</p>
              ${item.detail ? `<p style="margin:3px 0 0;color:#64748b;font-size:12px">${item.detail}</p>` : ""}
            </td>
            <td style="padding:14px 0;text-align:right;vertical-align:top;white-space:nowrap">
              <span style="color:#0f172a;font-size:15px;font-weight:700">${Number(item.price).toFixed(0)} €</span>
            </td>
          </tr>
        `).join("");

      const html = `
<!DOCTYPE html>
<html lang="${isEn ? "en" : "fi"}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f1f5f9">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9"><tr><td align="center" style="padding:32px 16px">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

  <!-- HEADER -->
  <tr>
    <td style="background:#18181b;border-radius:16px 16px 0 0;padding:32px 36px 28px">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <p style="margin:0;color:#ffffff;font-size:24px;font-weight:800;letter-spacing:-0.4px">Puuhapatet.</p>
            <p style="margin:4px 0 0;color:#52525b;font-size:12px">Ikkunapesu &middot; Pihapalvelut &middot; Nurmikko</p>
          </td>
          <td style="text-align:right;vertical-align:top;padding-top:2px">
            <span style="display:inline-block;background:#4a5d4f;color:#bbf7d0;font-size:10px;font-weight:700;letter-spacing:2px;padding:4px 12px;border-radius:20px;text-transform:uppercase">${isEn ? "QUOTE" : "TARJOUS"}</span>
          </td>
        </tr>
      </table>
      <div style="margin-top:24px;padding-top:18px;border-top:1px solid #27272a">
        <p style="font-family:'Courier New',Courier,monospace;color:#d4d4d8;font-size:15px;font-weight:700;margin:0 0 4px;letter-spacing:1.5px">${quoteId}</p>
        <p style="color:#52525b;font-size:12px;margin:0">${today} &nbsp;&middot;&nbsp; ${isEn ? "Valid until" : "Voimassa"} <strong style="color:#a1a1aa">${validUntil}</strong></p>
      </div>
    </td>
  </tr>

  <!-- TO / FROM -->
  <tr>
    <td style="background:#fafafa;border-left:1px solid #e4e4e7;border-right:1px solid #e4e4e7">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding:18px 36px;border-right:1px solid #e4e4e7;width:50%;vertical-align:top">
            <p style="margin:0 0 6px;color:#a1a1aa;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase">${isEn ? "FOR" : "ASIAKKAALLE"}</p>
            <p style="margin:0 0 2px;color:#18181b;font-size:14px;font-weight:700">${customerName}</p>
            ${customerAddress ? `<p style="margin:0;color:#71717a;font-size:12px;line-height:1.5">${customerAddress}</p>` : ""}
          </td>
          <td style="padding:18px 36px;width:50%;text-align:right;vertical-align:top">
            <p style="margin:0 0 6px;color:#a1a1aa;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase">${isEn ? "FROM" : "LÄHETTÄJÄ"}</p>
            <p style="margin:0 0 2px;color:#18181b;font-size:14px;font-weight:700">${workerName || "Puuhapatet"}</p>
            ${workerPhone ? `<p style="margin:0;color:#71717a;font-size:12px">${workerPhone}</p>` : ""}
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- BODY -->
  <tr>
    <td style="background:#ffffff;border:1px solid #e4e4e7;border-top:none;padding:32px 36px">

      <!-- Intro -->
      <p style="margin:0 0 28px;color:#3f3f46;font-size:15px;line-height:1.75">${introText}</p>

      <!-- Services -->
      <p style="margin:0 0 10px;color:#a1a1aa;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase">${isEn ? "SERVICES" : "PALVELUT"}</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-top:2px solid #18181b">
        <tbody>${serviceRowsHtml}</tbody>
      </table>

      <!-- Total -->
      <table width="100%" cellpadding="0" cellspacing="0" style="border-top:2px solid #18181b;margin-top:0">
        <tr>
          <td style="padding:16px 0;color:#18181b;font-size:15px;font-weight:700">${isEn ? "Total" : "Yhteensä"}</td>
          <td style="padding:16px 0;text-align:right;color:#18181b;font-size:28px;font-weight:900">${Number(total).toFixed(0)} €</td>
        </tr>
      </table>

      <!-- Kotitalousvähennys — the real price hero ─────────────────────── -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px">
        <tr>
          <td style="background:#f0fdf4;border-radius:12px;padding:18px 20px;border-left:4px solid #22c55e">
            <p style="margin:0 0 6px;font-weight:700;color:#166534;font-size:10px;letter-spacing:1px;text-transform:uppercase">${isEn ? "HOUSEHOLD TAX DEDUCTION — YOUR ACTUAL COST" : "KOTITALOUSVÄHENNYS — TOSIASIALLINEN HINTASI"}</p>
            <p style="margin:0 0 8px;color:#15803d;font-size:14px;line-height:1.65">
              ${isEn
                ? `This service qualifies for the <strong>Finnish household tax deduction</strong>. You can reclaim 40% of the labour portion from your taxes — your real out-of-pocket cost is approx. <strong style="font-size:16px">${kotitalous} €</strong>.`
                : `Tämä palvelu on <strong>kotitalousvähennyskelpoinen</strong>. Työn osuudesta saat 40 % takaisin verotuksessa — tosiasiallinen kustannuksesi on vain noin <strong style="font-size:16px">${kotitalous} €</strong>.`
              }
            </p>
            <p style="margin:0;color:#16a34a;font-size:12px">
              ${isEn
                ? "This quote works as documentation — no separate receipt needed."
                : "Tämä tarjous käy dokumenttina veroilmoitukseen, erillistä kuittia ei tarvita."}
            </p>
          </td>
        </tr>
      </table>

      <!-- Validity ──────────────────────────────────────────────────────── -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px">
        <tr>
          <td style="background:#fffbeb;border-radius:12px;padding:14px 20px;border-left:4px solid #f59e0b">
            <p style="margin:0;color:#78350f;font-size:13px;line-height:1.6">
              <strong>${isEn ? "Offer valid until" : "Tarjous voimassa"} ${validUntil}</strong>${isEn ? "." : " asti."}
              ${isEn
                ? " After this date prices may be revised — confirm early to lock in this price."
                : " Tämän jälkeen hintoja saatetaan tarkistaa — vahvista ajoissa, niin hinta pysyy."}
            </p>
          </td>
        </tr>
      </table>

      <!-- CTA ───────────────────────────────────────────────────────────── -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px">
        <tr>
          <td style="text-align:center;padding:0 0 8px">
            <p style="color:#52525b;font-size:14px;margin:0 0 16px;line-height:1.65">
              ${isEn
                ? "Ready to go? One call or click and we'll confirm the time."
                : "Valmis? Yksi soitto tai klikkaus, ja vahvistetaan aika."}
            </p>
            ${workerPhone
              ? `<a href="tel:${workerPhone}" style="display:inline-block;background:#18181b;color:#ffffff;padding:13px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;margin:4px">📞 ${isEn ? "Call us" : "Soita"} — ${workerPhone}</a>`
              : ""
            }
            <br>
            <a href="https://puuhapatet.fi/tilaus" style="display:inline-block;background:#4a5d4f;color:#ffffff;padding:13px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;margin:8px 4px 4px">${isEn ? "Book online →" : "Varaa verkossa →"}</a>
          </td>
        </tr>
      </table>

    </td>
  </tr>

  <!-- FOOTER -->
  <tr>
    <td style="background:#fafafa;border:1px solid #e4e4e7;border-top:none;border-radius:0 0 16px 16px;padding:18px 36px">
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:12px;color:#71717a">
        <tr>
          <td style="vertical-align:top">
            <strong style="color:#18181b">${workerName || "Puuhapatet"}</strong><br>
            ${workerPhone ? `${workerPhone}<br>` : ""}
            ${workerEmail ? `<a href="mailto:${workerEmail}" style="color:#71717a;text-decoration:none">${workerEmail}</a>` : ""}
          </td>
          <td style="text-align:right;vertical-align:top">
            <strong style="color:#18181b">Puuhapatet</strong><br>
            <a href="mailto:info@puuhapatet.fi" style="color:#71717a;text-decoration:none">info@puuhapatet.fi</a><br>
            <a href="https://puuhapatet.fi" style="color:#71717a;text-decoration:none">puuhapatet.fi</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>

</table>
</td></tr></table>
</body>
</html>`;

      const subject = isEn
        ? `Your quote from Puuhapatet — ${Number(total).toFixed(0)} €`
        : `Tarjous ${quoteId} — ${Number(total).toFixed(0)} € (Puuhapatet)`;

      const result = await resend.emails.send({
        from: FROM_EMAIL,
        to,
        ...(bcc ? { bcc } : {}),
        subject,
        html,
      });

      res.json({ ok: true, id: result.data?.id });
    } catch (e: any) {
      console.error("Quote email error:", e);
      res.status(500).json({ error: e.message || "Sähköpostin lähetys epäonnistui" });
    }
  });

  // ─── Admin user passwords (cross-device persistent) ─────────────────────────
  // Note: client-side gate only, not a real security boundary.

  app.get("/api/admin/user-password/:userId", async (req, res) => {
    try {
      const [row] = await db.select({ pw: users.passwordHash }).from(users).where(eq(users.username, req.params.userId));
      res.json({ password: row?.pw ?? null }); // null = caller should use default
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/user-password/:userId", async (req, res) => {
    try {
      const userId = req.params.userId;
      const { password } = req.body;
      if (!password || password.length < 4) return res.status(400).json({ error: "Liian lyhyt salasana" });
      const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.username, userId));
      if (existing) {
        await db.update(users).set({ passwordHash: password }).where(eq(users.username, userId));
      } else {
        await db.insert(users).values({ name: userId, username: userId, passwordHash: password, role: "staff" });
      }
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
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

  return httpServer;
}
