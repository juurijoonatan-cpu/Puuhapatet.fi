import { pgTable, text, integer, timestamp, pgEnum, serial, boolean, unique } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const jobStatusEnum = pgEnum("job_status", [
  "lead",
  "scheduled",
  "in_progress",
  "done",
  "cancelled",
]);

// ─── Customers ────────────────────────────────────────────────────────────────

export const customers = pgTable("customers", {
  id:          serial("id").primaryKey(),
  name:        text("name").notNull(),       // contact person (yhteyshenkilö)
  phone:       text("phone").notNull(),
  email:       text("email"),
  address:     text("address").notNull(),
  notes:       text("notes"),
  ownedBy:     text("owned_by"),             // user ID of the "owner" when no jobs yet
  isYritys:    boolean("is_yritys").default(false),
  companyName: text("company_name"),         // yrityksen nimi
  yTunnus:     text("y_tunnus"),             // Y-tunnus (FI business ID)
  createdAt:   timestamp("created_at").defaultNow().notNull(),
});

export const customersRelations = relations(customers, ({ many }) => ({
  jobs: many(jobs),
}));

export const insertCustomerSchema = createInsertSchema(customers).omit({ id: true, createdAt: true });
export type Customer = typeof customers.$inferSelect;
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;

// ─── Jobs ─────────────────────────────────────────────────────────────────────

export const jobs = pgTable("jobs", {
  id:                serial("id").primaryKey(),
  customerId:        integer("customer_id").references(() => customers.id).notNull(),
  scheduledAt:       timestamp("scheduled_at"),
  description:       text("description").notNull(),
  agreedPrice:       integer("agreed_price").notNull(),  // senttiä (€ × 100)
  status:            jobStatusEnum("status").default("lead").notNull(),
  assignedTo:        text("assigned_to"),               // yrittäjän nimi
  notes:             text("notes"),
  customerSignature: text("customer_signature"),         // base64 data URL
  staffSignature:    text("staff_signature"),            // base64 data URL
  waiveFee:          boolean("waive_fee").default(false).notNull(),
  pendingWorkers:    text("pending_workers"),   // comma-separated invited user IDs not yet confirmed
  paymentMethod:     text("payment_method"),    // "käteinen"|"mobilepay"|"tilisiirto"|"kortti"
  quoteToken:        text("quote_token"),        // unique token for customer quote portal URL
  quoteStatus:       text("quote_status"),       // "pending"|"accepted"|"declined"
  suggestedTimes:    text("suggested_times"),    // JSON: string[] of ISO datetimes from customer
  customerMessage:   text("customer_message"),   // customer's freeform message from quote portal
  quoteVideoUrl:     text("quote_video_url"),    // optional YouTube/Vimeo/MP4 URL shown on portal
  // Taloyhtiö (housing company) quote fields
  isTaloyhtiio:      boolean("is_taloyhtiio").default(false).notNull(),
  taloyhtiioApproved: boolean("taloyhtiio_approved").default(false).notNull(),
  unitCount:         integer("unit_count"),       // number of apartments
  propertyImageUrl:  text("property_image_url"), // image URL for the property
  taloyhtiioName:    text("taloyhtiio_name"),    // housing company name
  unitResponses:     text("unit_responses"),     // JSON: [{unitId,unitName,status,email,times,message}]
  // Board rep billing contact (collected at approval time)
  boardContactName:  text("board_contact_name"),
  boardContactEmail: text("board_contact_email"),
  boardContactPhone: text("board_contact_phone"),
  // Business (yritys) quote
  isYritys:          boolean("is_yritys").default(false).notNull(),
  // Custom gig (cap-pricing / kattomalli contract job)
  isCustomGig:       boolean("is_custom_gig").default(false).notNull(),
  gigData:           text("gig_data"),           // JSON: GigData (shared/gig.ts)
  // Project / floor-plan window tool (FR8 projektinäkymä)
  projectData:       text("project_data"),       // JSON: ProjectData (shared/project.ts)
  // Founder (biller) whose Y-tunnus collected the customer's money for this job.
  // Set automatically when the summary/invoice email is sent; editable in the
  // Verotus view. Drives per-founder ALV turnover + founder cross-invoicing.
  billedBy:          text("billed_by"),            // admin user id ("joonatan"|"matias")
  // Marketer (ovelta ovelle -myyjä) lead capture + founder triage
  submittedBy:       text("submitted_by"),        // admin/marketer user id who captured this lead
  submissionStatus:  text("submission_status"),   // null (normal) | "pending_review" | "approved" | "rejected"
  marketerId:        text("marketer_id"),          // user id credited with the commission (usually = submittedBy)
  marketerCommissionCents: integer("marketer_commission_cents"), // snapshotted flat €/deal at acceptance
  createdAt:         timestamp("created_at").defaultNow().notNull(),
  updatedAt:         timestamp("updated_at").defaultNow().notNull(),
});

export const jobsRelations = relations(jobs, ({ one, many }) => ({
  customer: one(customers, { fields: [jobs.customerId], references: [customers.id] }),
  expenses: many(expenses),
  eraInvoices: many(eraInvoices),
}));

export const insertJobSchema = createInsertSchema(jobs).omit({ id: true, createdAt: true, updatedAt: true });
export type Job = typeof jobs.$inferSelect;
export type InsertJob = z.infer<typeof insertJobSchema>;

// ─── Expenses ─────────────────────────────────────────────────────────────────

export const expenses = pgTable("expenses", {
  id:          serial("id").primaryKey(),
  jobId:       integer("job_id").references(() => jobs.id).notNull(),
  description: text("description").notNull(),
  amount:      integer("amount").notNull(),  // senttiä (€ × 100)
  createdAt:   timestamp("created_at").defaultNow().notNull(),
});

export const expensesRelations = relations(expenses, ({ one }) => ({
  job: one(jobs, { fields: [expenses.jobId], references: [jobs.id] }),
}));

// ─── Founder settlements (bossien vastalaskut) ────────────────────────────────
// Each row records an ISSUED founder-to-founder settlement invoice. The
// founder-settlement endpoint subtracts these from the cumulative cross-debt,
// so already-invoiced euros are never billed twice.
export const founderSettlements = pgTable("founder_settlements", {
  id:        serial("id").primaryKey(),
  fromId:    text("from_id").notNull(),  // debtor — pays the invoice
  toId:      text("to_id").notNull(),    // creditor — issued the invoice
  cents:     integer("cents").notNull(),
  invoiceNo: text("invoice_no"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type FounderSettlement = typeof founderSettlements.$inferSelect;

export const insertExpenseSchema = createInsertSchema(expenses).omit({ id: true, createdAt: true });
export type Expense = typeof expenses.$inferSelect;
export type InsertExpense = z.infer<typeof insertExpenseSchema>;

// ─── Worker Payments (palvelumaksuvelkojen kirjaukset) ───────────────────────

export const workerPayments = pgTable("worker_payments", {
  id:         serial("id").primaryKey(),
  workerId:   text("worker_id").notNull(),      // "joonatan" | "matias"
  amountPaid: integer("amount_paid").notNull(), // senttiä
  paidAt:     timestamp("paid_at").defaultNow().notNull(),
  note:       text("note"),
});

export const insertWorkerPaymentSchema = createInsertSchema(workerPayments).omit({ id: true, paidAt: true });
export type WorkerPayment = typeof workerPayments.$inferSelect;
export type InsertWorkerPayment = z.infer<typeof insertWorkerPaymentSchema>;

// ─── FR8 era-invoices (erälaskutus) ───────────────────────────────────────────
// Yksi rivi = yksi lasku, joko tekijän itsensä johtajalle laskuttama työkorvaus
// ("tekijä", myyjä=tekijä, ostaja=erän mukaan valittu johtaja) tai kahden
// johtajan välinen ristiinlasku ("johtaja_valinen", myyjä=lähettävä johtaja,
// ostaja=toinen johtaja). Laskentaperusteet ks. shared/era-billing.ts ja
// docs/fr8-era-laskutus-plan.md. `rivit` tallentaa JSON-muodossa sekä käsin
// syötetyt lähtötiedot (pestyt_ikkunat/sovittu_muutos/ennakko per tekijä tai
// johtaja) että lasketut tulokset (EraBillingResult) — muuttumaton tilannekuva
// lähetyshetkeltä, jotta PDF voidaan regeneroida deterministisesti jälkikäteen
// eikä laskua tarvitse tallentaa binäärinä.
//
// Lukitus: kun `tila` siirtyy pois "luonnos"-tilasta (`sentAt` asetetaan),
// palvelimen tulee estää rivin muokkaus ja uudelleenlähetys — korjaus on aina
// uusi lasku, ei tämän rivin päivitys (ks. speksin kohta 4, muuttumattomuus).
export const eraInvoices = pgTable("era_invoices", {
  id:                     serial("id").primaryKey(),
  jobId:                  integer("job_id").references(() => jobs.id).notNull(),
  kind:                   text("kind").notNull(),              // "tekija" | "johtaja_valinen"
  senderId:               text("sender_id").notNull(),          // myyjä: tekijän workerId tai johtajan id
  recipientId:            text("recipient_id").notNull(),       // ostaja: johtajan id (erän mukaan reititetty)
  eraNumbers:             text("era_numbers").notNull(),        // JSON int[], esim. "[1,2,3]" tai "[4]"
  rivit:                  text("rivit").notNull(),               // JSON: lähtötiedot + EraBillingResult-tilannekuva
  totalCents:             integer("total_cents").notNull(),      // S (johtaja_valinen) tai maksettavaCents (tekija)
  xCents:                 integer("x_cents"),                    // €/ikkuna (vain johtaja_valinen)
  kateCents:              integer("kate_cents"),                 // vain johtaja_valinen
  katePerJohtajaCents:    integer("kate_per_johtaja_cents"),      // vain johtaja_valinen
  manualAdjustmentCents:  integer("manual_adjustment_cents").notNull().default(0), // vapaa muokkauskenttä
  dueDate:                text("due_date"),                      // eräpäivä, johtajan valitsema (ISO "YYYY-MM-DD")
  tila:                   text("tila").notNull().default("luonnos"), // luonnos|lähetetty|hyväksytty|hylätty
  invoiceNumber:          text("invoice_number"),                // juokseva, per laskuttaja — asetetaan lähetettäessä
  referenceNumber:        text("reference_number"),              // viitenumero — asetetaan lähetettäessä
  createdAt:              timestamp("created_at").defaultNow().notNull(),
  sentAt:                 timestamp("sent_at"),                  // lukitushetki (lähetetty/hyväksytty)
  respondedAt:            timestamp("responded_at"),             // tekijän/toisen osapuolen hyväksyntä/hylkäys
});

export const eraInvoicesRelations = relations(eraInvoices, ({ one, many }) => ({
  job: one(jobs, { fields: [eraInvoices.jobId], references: [jobs.id] }),
  emails: many(eraInvoiceEmails),
}));

export const insertEraInvoiceSchema = createInsertSchema(eraInvoices).omit({
  id: true, createdAt: true, sentAt: true, respondedAt: true,
});
export type EraInvoice = typeof eraInvoices.$inferSelect;
export type InsertEraInvoice = z.infer<typeof insertEraInvoiceSchema>;

// ─── FR8 era-invoice email log (sähköposti_loki) ──────────────────────────────

export const eraInvoiceEmails = pgTable("era_invoice_emails", {
  id:         serial("id").primaryKey(),
  invoiceId:  integer("invoice_id").references(() => eraInvoices.id).notNull(),
  recipients: text("recipients").notNull(),  // JSON string[] of email addresses
  success:    boolean("success").notNull().default(true),
  error:      text("error"),                 // best-effort: virheen kuvaus jos lähetys epäonnistui
  sentAt:     timestamp("sent_at").defaultNow().notNull(),
});

export const eraInvoiceEmailsRelations = relations(eraInvoiceEmails, ({ one }) => ({
  invoice: one(eraInvoices, { fields: [eraInvoiceEmails.invoiceId], references: [eraInvoices.id] }),
}));

export const insertEraInvoiceEmailSchema = createInsertSchema(eraInvoiceEmails).omit({ id: true, sentAt: true });
export type EraInvoiceEmail = typeof eraInvoiceEmails.$inferSelect;
export type InsertEraInvoiceEmail = z.infer<typeof insertEraInvoiceEmailSchema>;

// ─── Investments (välineet ja hankinnat) ─────────────────────────────────────

export const investments = pgTable("investments", {
  id:          serial("id").primaryKey(),
  description: text("description").notNull(),
  amount:      integer("amount").notNull(),       // senttiä (€ × 100)
  category:    text("category").notNull().default("välineet"), // välineet | kuljetukset | muu
  boughtBy:    text("bought_by").notNull(),        // "joonatan" | "matias"
  splitWith:   text("split_with"),                 // null = oma, toisen ID = 50/50
  bonusBy:     text("bonus_by"),                   // null | "boughtBy" | "splitWith" | "both" — aloitustuella rahoitettu
  purchasedAt: timestamp("purchased_at").defaultNow().notNull(),
  note:        text("note"),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
});

export const insertInvestmentSchema = createInsertSchema(investments).omit({ id: true, createdAt: true });
export type Investment = typeof investments.$inferSelect;
export type InsertInvestment = z.infer<typeof insertInvestmentSchema>;

// ─── Startup bonus usages (aloitustuen käyttö) ────────────────────────────────

export const startupBonusUsages = pgTable("startup_bonus_usages", {
  id:           serial("id").primaryKey(),
  userId:       text("user_id").notNull(),         // "joonatan" | "matias"
  amount:       integer("amount").notNull(),        // senttiä (€ × 100) — käytetty summa tästä tukirahasta
  description:  text("description").notNull(),
  category:     text("category").notNull().default("muu"), // välineet | kuljetukset | muu
  usedAt:       timestamp("used_at").defaultNow().notNull(),
  investmentId: integer("investment_id"),           // jos linkitetty investointiin
  createdAt:    timestamp("created_at").defaultNow().notNull(),
});

export const insertStartupBonusUsageSchema = createInsertSchema(startupBonusUsages).omit({ id: true, createdAt: true });
export type StartupBonusUsage = typeof startupBonusUsages.$inferSelect;
export type InsertStartupBonusUsage = z.infer<typeof insertStartupBonusUsageSchema>;

// ─── Users (admin accounts — seeded, ei itserekisteröitymistä) ───────────────

export const users = pgTable("users", {
  id:           serial("id").primaryKey(),
  name:         text("name").notNull(),
  username:     text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role:         text("role").notNull().default("staff"), // host | staff
  memberAgreement: text("member_agreement"),             // JSON: MemberAgreementSignature
  createdAt:    timestamp("created_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

// ─── Chat / AI assistant ──────────────────────────────────────────────────────
// One row per conversation. Two sources:
//   "public" — website visitor talking to the customer-facing bot / live admin
//   "admin"  — internal staff using the in-admin assistant
export const chatConversations = pgTable("chat_conversations", {
  id:            serial("id").primaryKey(),
  sessionToken:  text("session_token").notNull(),                  // anonymous visitor token, or admin user id
  source:        text("source").notNull().default("public"),       // "public" | "admin"
  status:        text("status").notNull().default("bot"),          // public: bot|needs_human|human|closed
  visitorName:   text("visitor_name"),
  visitorEmail:  text("visitor_email"),
  visitorPhone:  text("visitor_phone"),
  userId:        text("user_id"),                                  // admin user id (source = admin)
  userRole:      text("user_role"),                                // HOST | STAFF (source = admin)
  unread:        boolean("unread").notNull().default(false),       // admin has an unseen visitor message
  pageUrl:       text("page_url"),                                 // where the visitor opened the chat
  createdAt:     timestamp("created_at").defaultNow().notNull(),
  updatedAt:     timestamp("updated_at").defaultNow().notNull(),
  lastMessageAt: timestamp("last_message_at").defaultNow().notNull(),
});

export const chatMessages = pgTable("chat_messages", {
  id:             serial("id").primaryKey(),
  conversationId: integer("conversation_id").references(() => chatConversations.id).notNull(),
  role:           text("role").notNull(),     // "user" | "assistant" | "admin" | "system"
  content:        text("content").notNull(),
  authorName:     text("author_name"),         // admin display name when role = "admin"
  createdAt:      timestamp("created_at").defaultNow().notNull(),
});

export const chatConversationsRelations = relations(chatConversations, ({ many }) => ({
  messages: many(chatMessages),
}));

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  conversation: one(chatConversations, { fields: [chatMessages.conversationId], references: [chatConversations.id] }),
}));

export const insertChatConversationSchema = createInsertSchema(chatConversations).omit({ id: true, createdAt: true, updatedAt: true, lastMessageAt: true });
export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({ id: true, createdAt: true });
export type ChatConversation = typeof chatConversations.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertChatConversation = z.infer<typeof insertChatConversationSchema>;

// ─── Kirjanpito → Google Sheets + Drive -synkka ───────────────────────────────
// Ks. docs/kirjanpito-sheets-integraatio.md. Yksi Drive-kansio per tekijä
// (ID välimuistitettu tähän, ettei jokainen lasku tee ylimääräistä Drive-hakua),
// ja jokaisesta synkkayrityksestä (onnistunut tai ei) jää rivi lokiin — sama
// idea kuin eraInvoiceEmails, mutta laskutyyppi-agnostinen (recordType).

export const driveWorkerFolders = pgTable("drive_worker_folders", {
  id:              serial("id").primaryKey(),
  workerId:        text("worker_id").notNull().unique(),
  folderId:        text("folder_id").notNull(),
  sharedWithEmail: text("shared_with_email"),  // jos kansio on jaettu tekijän omalle Google-tilille
  createdAt:       timestamp("created_at").defaultNow().notNull(),
});

export const externalSyncLog = pgTable("external_sync_log", {
  id:         serial("id").primaryKey(),
  recordType: text("record_type").notNull(),   // "payout" (vaihe 1); "era_invoice" myöhemmin
  recordId:   text("record_id").notNull(),      // payout.id
  jobId:      integer("job_id").notNull(),
  memberId:   text("member_id").notNull(),
  target:     text("target").notNull().default("sheets_drive"),
  success:    boolean("success").notNull(),
  error:      text("error"),
  syncedAt:   timestamp("synced_at").defaultNow().notNull(),
});

export const insertDriveWorkerFolderSchema = createInsertSchema(driveWorkerFolders).omit({ id: true, createdAt: true });
export const insertExternalSyncLogSchema = createInsertSchema(externalSyncLog).omit({ id: true, syncedAt: true });
export type DriveWorkerFolder = typeof driveWorkerFolders.$inferSelect;
export type ExternalSyncLog = typeof externalSyncLog.$inferSelect;
export type InsertDriveWorkerFolder = z.infer<typeof insertDriveWorkerFolderSchema>;
export type InsertExternalSyncLog = z.infer<typeof insertExternalSyncLogSchema>;
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;

// ─── Kirjanpito (double-entry bookkeeping, FAS) ───────────────────────────────
//
// One fully separate, self-balancing set of books per "kirjanpitovelvollinen"
// (accounting entity — a `ledger`). Today that's the two founders' own
// toiminimi (Joonatan, Matias); a future Oy is just another ledger row with
// entityType "oy" — no schema change needed. Every journal entry is derived
// automatically from the underlying source data (jobs, expenses, investments,
// founder settlements) by server/finance/post.ts — nothing here is hand-typed.
// See docs/talous-kirjanpito.md for the full design + posting rules.

export const ledgerEntityTypeEnum = pgEnum("ledger_entity_type", ["toiminimi", "oy"]);

export const ledgers = pgTable("ledgers", {
  id:         text("id").primaryKey(),          // "joonatan" | "matias" (future: "oy")
  name:       text("name").notNull(),
  yTunnus:    text("y_tunnus"),
  entityType: ledgerEntityTypeEnum("entity_type").notNull().default("toiminimi"),
  createdAt:  timestamp("created_at").defaultNow().notNull(),
});

export type Ledger = typeof ledgers.$inferSelect;

// ─── Fiscal years (tilikaudet) ─────────────────────────────────────────────────

export const fiscalYears = pgTable("fiscal_years", {
  id:        serial("id").primaryKey(),
  ledgerId:  text("ledger_id").references(() => ledgers.id).notNull(),
  startDate: timestamp("start_date").notNull(),
  endDate:   timestamp("end_date").notNull(),
  isClosed:  boolean("is_closed").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  oneYearPerLedger: unique().on(t.ledgerId, t.startDate),
}));

export type FiscalYear = typeof fiscalYears.$inferSelect;

// ─── Chart of accounts (tilikartta) ────────────────────────────────────────────

export const accountTypeEnum = pgEnum("account_type", ["asset", "liability", "equity", "revenue", "expense"]);

export const accounts = pgTable("accounts", {
  id:               serial("id").primaryKey(),
  ledgerId:         text("ledger_id").references(() => ledgers.id).notNull(),
  code:             text("code").notNull(),      // FAS-style tilinumero, e.g. "1910"
  name:             text("name").notNull(),
  accountType:      accountTypeEnum("account_type").notNull(),
  // Standard accounts created by ensureLedger() and used by the auto-poster;
  // kept apart from any future user-added accounts so the poster's targets
  // are never accidentally renamed/removed from the UI.
  isSystemAccount:  boolean("is_system_account").notNull().default(false),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  oneCodePerLedger: unique().on(t.ledgerId, t.code),
}));

export type Account = typeof accounts.$inferSelect;

// ─── Journal (päiväkirja) & general ledger (pääkirja) ──────────────────────────
//
// journalEntries = one row per bookkeeping event (a tapahtuma — one invoice,
// one expense, one inter-founder settlement...). journalLines = its debit/
// credit rows; every entry's lines must sum debit = credit (enforced by the
// poster, not the DB — see server/finance/post.ts `postEntry`).
//
// The pääkirja (general ledger, grouped by account) is not a separate table —
// it is journalLines joined to accounts, grouped by account (a view, computed
// on read in server/finance/reports.ts) so it can never drift from the
// päiväkirja.

export const journalSourceTypeEnum = pgEnum("journal_source_type", [
  "customer_invoice",   // asiakaslasku (mukaan lukien FR8-erät)
  "internal_invoice",   // yrittäjien välinen lasku (founder settlement)
  "expense",            // kirjattu kulu (jobiin liitetty kuitti)
  "investment",         // väline-/kalustohankinta
  "manual",             // käsin lisätty korjausvienti (varattu tulevaa varten)
]);

export const journalEntries = pgTable("journal_entries", {
  id:          serial("id").primaryKey(),
  ledgerId:    text("ledger_id").references(() => ledgers.id).notNull(),
  fiscalYearId: integer("fiscal_year_id").references(() => fiscalYears.id).notNull(),
  entryNumber: integer("entry_number").notNull(),    // juokseva numero per ledger (päiväkirjan tapahtumanro)
  date:        timestamp("date").notNull(),          // kirjanpitopäivä (tapahtuman pvm)
  description: text("description").notNull(),
  sourceType:  journalSourceTypeEnum("source_type").notNull(),
  // Stable dedupe key (e.g. "job:123:era:2", "expense:55", "settlement:9") —
  // makes the auto-rebuild idempotent: same source always produces exactly
  // one entry per ledger, never duplicated on re-run.
  sourceKey:   text("source_key").notNull(),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  oneEntryPerSource: unique().on(t.ledgerId, t.sourceKey),
  oneNumberPerLedger: unique().on(t.ledgerId, t.entryNumber),
}));

export const journalLines = pgTable("journal_lines", {
  id:          serial("id").primaryKey(),
  entryId:     integer("entry_id").references(() => journalEntries.id).notNull(),
  accountId:   integer("account_id").references(() => accounts.id).notNull(),
  debitCents:  integer("debit_cents").notNull().default(0),
  creditCents: integer("credit_cents").notNull().default(0),
  lineNo:      integer("line_no").notNull().default(0),
});

export const journalEntriesRelations = relations(journalEntries, ({ many, one }) => ({
  lines: many(journalLines),
  fiscalYear: one(fiscalYears, { fields: [journalEntries.fiscalYearId], references: [fiscalYears.id] }),
}));

export const journalLinesRelations = relations(journalLines, ({ one }) => ({
  entry: one(journalEntries, { fields: [journalLines.entryId], references: [journalEntries.id] }),
  account: one(accounts, { fields: [journalLines.accountId], references: [accounts.id] }),
}));

export type JournalEntry = typeof journalEntries.$inferSelect;
export type JournalLine = typeof journalLines.$inferSelect;

// ─── Forecast (ennustelaskelma) ────────────────────────────────────────────────
//
// Purely a planning tool — a forecast line never touches the real ledger.
// One row = one recurring or one-off projected income/expense line.

export const forecastKindEnum = pgEnum("forecast_kind", ["income", "expense"]);

export const forecastEntries = pgTable("forecast_entries", {
  id:         serial("id").primaryKey(),
  ledgerId:   text("ledger_id").references(() => ledgers.id).notNull(),
  label:      text("label").notNull(),
  kind:       forecastKindEnum("kind").notNull(),
  amountCents: integer("amount_cents").notNull(),      // per kuukausi
  startMonth: text("start_month").notNull(),           // "YYYY-MM"
  endMonth:   text("end_month"),                       // null = toistuu toistaiseksi
  recurring:  boolean("recurring").notNull().default(true), // false = kertaluonteinen (vain startMonth)
  category:   text("category").notNull().default("muu"),
  createdAt:  timestamp("created_at").defaultNow().notNull(),
});

export const insertForecastEntrySchema = createInsertSchema(forecastEntries).omit({ id: true, createdAt: true });
export type ForecastEntry = typeof forecastEntries.$inferSelect;
export type InsertForecastEntry = z.infer<typeof insertForecastEntrySchema>;

// ─── Google Drive backup tracking (Talous ja verotus, Osa 2) ──────────────────
//
// Tracks which document/report is already saved in Drive and under which
// file id, so re-uploads update the SAME Drive file in place instead of
// creating duplicates. See server/drive/*.ts and docs/google-drive-backup.md.

export const driveFiles = pgTable("drive_files", {
  id:            serial("id").primaryKey(),
  kind:          text("kind").notNull(),        // "customer_invoice" | "worker_invoice" | "internal_invoice" | "chart_of_accounts" | "journal" | "general_ledger" | "income_statement" | "balance_sheet" | "forecast"
  sourceKey:     text("source_key").notNull(),  // stable key, e.g. "job:123:era:2", "joonatan:2026"
  driveFileId:   text("drive_file_id").notNull(),
  driveFolderId: text("drive_folder_id"),
  webViewLink:   text("web_view_link"),
  updatedAt:     timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  oneFilePerSource: unique().on(t.kind, t.sourceKey),
}));

export type DriveFile = typeof driveFiles.$inferSelect;
