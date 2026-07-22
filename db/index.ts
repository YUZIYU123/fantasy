import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return drizzle(env.DB, { schema });
}

let schemaReady: Promise<unknown> | null = null;

export function ensureSchema() {
  if (schemaReady) return schemaReady;
  const d1 = env.DB;
  schemaReady = d1.batch([
    d1.prepare(`CREATE TABLE IF NOT EXISTS chapters (
      id text PRIMARY KEY NOT NULL,
      slug text NOT NULL UNIQUE,
      title text NOT NULL,
      summary text DEFAULT '' NOT NULL,
      cover_url text DEFAULT '' NOT NULL,
      sort_order integer DEFAULT 0 NOT NULL,
      status text DEFAULT 'draft' NOT NULL,
      draft_json text NOT NULL,
      published_json text,
      version integer DEFAULT 0 NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS chapter_versions (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      chapter_id text NOT NULL,
      version integer NOT NULL,
      snapshot_json text NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS assets (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      type text NOT NULL,
      url text NOT NULL,
      mime_type text NOT NULL,
      size integer NOT NULL,
      alt text DEFAULT '' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
  ]).catch((error) => { schemaReady = null; throw error; });
  return schemaReady;
}
