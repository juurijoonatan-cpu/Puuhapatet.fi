import { pgTable, text, integer, timestamp, pgEnum, serial, boolean } from "drizzle-orm/pg-core";
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
  createdAt:         timestamp("created_at").defaultNow().notNull(),
  updatedAt:         timestamp("updated_at").defaultNow().notNull(),
});

export const jobsRelations = relations(jobs, ({ one, many }) => ({
  customer: one(customers, { fields: [jobs.customerId], references: [customers.id] }),
  expenses: many(expenses),
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
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
