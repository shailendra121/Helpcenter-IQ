import { Pool } from "pg";

/**
 * Shared Postgres connection pool. See ADR-0002 — single Postgres +
 * pgvector store, DATABASE_URL from .env.
 */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});