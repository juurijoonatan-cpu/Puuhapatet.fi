import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { db } from "./db";
import { sql } from "drizzle-orm";

const app = express();
const httpServer = createServer(app);

app.use(cors({
  origin: ["https://puuhapatet.fi", "http://localhost:5000", "http://localhost:3000"],
  credentials: true,
}));

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "8mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "8mb" }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Auto-migrate: add new columns if they don't exist yet
  for (const stmt of [
    sql`ALTER TABLE jobs      ADD COLUMN IF NOT EXISTS waive_fee        boolean NOT NULL DEFAULT false`,
    sql`ALTER TABLE jobs      ADD COLUMN IF NOT EXISTS pending_workers  text`,
    sql`ALTER TABLE jobs      ADD COLUMN IF NOT EXISTS payment_method   text`,
    sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS owned_by         text`,
    sql`ALTER TABLE jobs      ADD COLUMN IF NOT EXISTS quote_token      text`,
    sql`ALTER TABLE jobs      ADD COLUMN IF NOT EXISTS quote_status     text`,
    sql`ALTER TABLE jobs      ADD COLUMN IF NOT EXISTS suggested_times  text`,
    sql`ALTER TABLE jobs      ADD COLUMN IF NOT EXISTS customer_message text`,
    sql`ALTER TABLE jobs      ADD COLUMN IF NOT EXISTS quote_video_url  text`,
    sql`ALTER TABLE jobs      ADD COLUMN IF NOT EXISTS is_taloyhtiio        boolean NOT NULL DEFAULT false`,
    sql`ALTER TABLE jobs      ADD COLUMN IF NOT EXISTS taloyhtiio_approved  boolean NOT NULL DEFAULT false`,
    sql`ALTER TABLE jobs      ADD COLUMN IF NOT EXISTS unit_count           integer`,
    sql`ALTER TABLE jobs      ADD COLUMN IF NOT EXISTS property_image_url   text`,
    sql`ALTER TABLE jobs      ADD COLUMN IF NOT EXISTS taloyhtiio_name      text`,
    sql`ALTER TABLE jobs      ADD COLUMN IF NOT EXISTS unit_responses       text`,
    sql`ALTER TABLE jobs      ADD COLUMN IF NOT EXISTS is_yritys            boolean NOT NULL DEFAULT false`,
    sql`ALTER TABLE jobs      ADD COLUMN IF NOT EXISTS is_custom_gig        boolean NOT NULL DEFAULT false`,
    sql`ALTER TABLE jobs      ADD COLUMN IF NOT EXISTS gig_data             text`,
    sql`ALTER TABLE jobs      ADD COLUMN IF NOT EXISTS project_data         text`,
    sql`ALTER TABLE jobs      ADD COLUMN IF NOT EXISTS board_contact_name   text`,
    sql`ALTER TABLE jobs      ADD COLUMN IF NOT EXISTS board_contact_email  text`,
    sql`ALTER TABLE jobs      ADD COLUMN IF NOT EXISTS board_contact_phone  text`,
    // Door-to-door marketer lead capture + founder triage
    sql`ALTER TABLE jobs      ADD COLUMN IF NOT EXISTS submitted_by              text`,
    sql`ALTER TABLE jobs      ADD COLUMN IF NOT EXISTS submission_status         text`,
    sql`ALTER TABLE jobs      ADD COLUMN IF NOT EXISTS marketer_id               text`,
    sql`ALTER TABLE jobs      ADD COLUMN IF NOT EXISTS marketer_commission_cents integer`,
    sql`ALTER TABLE jobs      ADD COLUMN IF NOT EXISTS billed_by                 text`,
    sql`CREATE TABLE IF NOT EXISTS founder_settlements (
      id         serial PRIMARY KEY,
      from_id    text NOT NULL,
      to_id      text NOT NULL,
      cents      integer NOT NULL,
      invoice_no text,
      created_at timestamp NOT NULL DEFAULT now()
    )`,
    // Evidence-based billed_by backfill from the founders' SENT invoices
    // (screenshots of the actual customer invoices, July 2026): Matias billed
    // Ilmari Salmio (440 €), Elisa Stenvall (339 €) and Rami Inkiläinen
    // (200 €); Joonatan billed Stina Pitkänen (339 €) and the Apajapolku
    // apartment gig (130 €). IS NULL guard = a manual correction in the
    // Verotus view always wins and this never runs over it.
    sql`UPDATE jobs SET billed_by = 'matias' WHERE billed_by IS NULL AND customer_id IN (
      SELECT id FROM customers WHERE name ILIKE '%Ilmari Salmio%' OR name ILIKE '%Elisa Stenvall%' OR name ILIKE '%Rami Inkil%'
    )`,
    sql`UPDATE jobs SET billed_by = 'joonatan' WHERE billed_by IS NULL AND customer_id IN (
      SELECT id FROM customers WHERE name ILIKE '%Stina Pitk%' OR name ILIKE '%Apajapolku%' OR address ILIKE '%Apajapolku%'
    )`,
    sql`ALTER TABLE users     ADD COLUMN IF NOT EXISTS member_agreement     text`,
    sql`CREATE UNIQUE INDEX IF NOT EXISTS jobs_quote_token_unique ON jobs(quote_token) WHERE quote_token IS NOT NULL`,
    // Chat / AI assistant tables
    sql`CREATE TABLE IF NOT EXISTS chat_conversations (
      id              serial PRIMARY KEY,
      session_token   text NOT NULL,
      source          text NOT NULL DEFAULT 'public',
      status          text NOT NULL DEFAULT 'bot',
      visitor_name    text,
      visitor_email   text,
      visitor_phone   text,
      user_id         text,
      user_role       text,
      unread          boolean NOT NULL DEFAULT false,
      page_url        text,
      created_at      timestamp NOT NULL DEFAULT now(),
      updated_at      timestamp NOT NULL DEFAULT now(),
      last_message_at timestamp NOT NULL DEFAULT now()
    )`,
    sql`CREATE TABLE IF NOT EXISTS chat_messages (
      id              serial PRIMARY KEY,
      conversation_id integer NOT NULL REFERENCES chat_conversations(id),
      role            text NOT NULL,
      content         text NOT NULL,
      author_name     text,
      created_at      timestamp NOT NULL DEFAULT now()
    )`,
    sql`CREATE INDEX IF NOT EXISTS chat_conversations_session_idx ON chat_conversations(session_token)`,
    sql`CREATE INDEX IF NOT EXISTS chat_messages_conversation_idx ON chat_messages(conversation_id)`,
  ]) {
    try { await db.execute(stmt); } catch (e: any) { console.warn("Migration warning:", e.message); }
  }

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
