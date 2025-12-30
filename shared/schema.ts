import { z } from "zod";

export const WorkflowStatusEnum = z.enum([
  "DRAFT",
  "NEW", 
  "SCHEDULED",
  "IN_PROGRESS",
  "DONE",
  "CANCELLED"
]);

export type WorkflowStatus = z.infer<typeof WorkflowStatusEnum>;

export const jobSchema = z.object({
  JobID: z.string(),
  WorkflowStatus: WorkflowStatusEnum,
  AssignedTo: z.string().optional().default(""),
  Source: z.enum(["WEBAPP", "MANUAL"]),
  CustomerName: z.string().min(2, "Nimi vaaditaan"),
  CustomerPhone: z.string().min(6, "Puhelinnumero vaaditaan"),
  CustomerEmail: z.string().email("Virheellinen sähköposti").optional().or(z.literal("")),
  Address: z.string().min(5, "Osoite vaaditaan"),
  PreferredTime: z.string().min(1, "Toivottu aika vaaditaan"),
  ServicePackage: z.string().min(1, "Valitse palvelu"),
  AdditionalServices: z.array(z.string()).optional().default([]),
  Notes: z.string().optional().default(""),
  EstimatedPrice: z.number().optional(),
  CreatedAt: z.string().optional(),
  UpdatedAt: z.string().optional(),
});

export type Job = z.infer<typeof jobSchema>;

export const insertJobSchema = jobSchema.omit({
  CreatedAt: true,
  UpdatedAt: true,
});

export type InsertJob = z.infer<typeof insertJobSchema>;

export const bookingFormSchema = z.object({
  CustomerName: z.string().min(2, "Nimi vaaditaan (vähintään 2 merkkiä)"),
  CustomerPhone: z.string().min(6, "Puhelinnumero vaaditaan"),
  CustomerEmail: z.string().email("Virheellinen sähköposti").optional().or(z.literal("")),
  Address: z.string().min(5, "Osoite vaaditaan (vähintään 5 merkkiä)"),
  PreferredTime: z.string().min(1, "Valitse toivottu ajankohta"),
  ServicePackage: z.string().min(1, "Valitse palvelu"),
  AdditionalServices: z.array(z.string()).optional().default([]),
  Notes: z.string().optional().default(""),
});

export type BookingFormData = z.infer<typeof bookingFormSchema>;

export const packageSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  durationMinutes: z.number(),
  price: z.number(),
  category: z.string().optional(),
  active: z.boolean().default(true),
});

export type Package = z.infer<typeof packageSchema>;

export interface HealthResponse {
  ok: boolean;
  ts: string;
}

export interface PackagesResponse {
  ok: boolean;
  packages: Package[];
}

export interface UpsertJobResponse {
  ok: boolean;
  jobId?: string;
  message?: string;
  error?: string;
}

export interface GetJobResponse {
  ok: boolean;
  job?: Job;
  error?: string;
}

export interface ListJobsResponse {
  ok: boolean;
  jobs: Job[];
  total?: number;
  error?: string;
}

export const users = {};
export const insertUserSchema = z.object({
  username: z.string(),
  password: z.string(),
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = { id: string; username: string; password: string };
