import { pgTable, text, integer, timestamp, pgEnum, serial } from "drizzle-orm/pg-core";
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
  id:        serial("id").primaryKey(),
  name:      text("name").notNull(),
  phone:     text("phone").notNull(),
  email:     text("email"),
  address:   text("address").notNull(),
  notes:     text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const customersRelations = relations(customers, ({ many }) => ({
  jobs: many(jobs),
}));

export const insertCustomerSchema = createInsertSchema(customers).omit({ id: true, createdAt: true });
export type Customer = typeof customers.$inferSelect;
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;

// ─── Jobs ─────────────────────────────────────────────────────────────────────

export const jobs = pgTable("jobs", {
  id:          serial("id").primaryKey(),
  customerId:  integer("customer_id").references(() => customers.id).notNull(),
  scheduledAt: timestamp("scheduled_at"),
  description: text("description").notNull(),
  agreedPrice: integer("agreed_price").notNull(),  // senttiä (€ × 100)
  status:      jobStatusEnum("status").default("lead").notNull(),
  assignedTo:  text("assigned_to"),               // yrittäjän nimi
  notes:       text("notes"),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
  updatedAt:   timestamp("updated_at").defaultNow().notNull(),
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
