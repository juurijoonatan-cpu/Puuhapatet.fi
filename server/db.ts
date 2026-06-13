import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL puuttuu — tarkista ympäristömuuttujat");
}

// Hosted Postgres (Render/Supabase) requires SSL; a local dev database does not.
const isLocal = /@(localhost|127\.0\.0\.1)/.test(process.env.DATABASE_URL);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

export const db = drizzle(pool, { schema });
