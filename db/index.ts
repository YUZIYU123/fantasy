import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Configure the binding in wrangler.jsonc before using the database."
    );
  }

  return drizzle(env.DB, { schema });
}

export function getD1Binding() {
  if (!env.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  return env.DB;
}

let schemaReady: Promise<unknown> | null = null;

export function ensureSchema() {
  if (schemaReady) return schemaReady;
  const d1 = env.DB;
  schemaReady = d1.batch([
    d1.prepare("SELECT id FROM novels LIMIT 0"),
    d1.prepare("SELECT id FROM novel_versions LIMIT 0"),
    d1.prepare("SELECT id FROM chapters LIMIT 0"),
    d1.prepare("SELECT novel_id FROM chapters LIMIT 0"),
    d1.prepare("SELECT id FROM chapter_versions LIMIT 0"),
    d1.prepare("SELECT storage_key, folder_id, duration, status, updated_at FROM assets LIMIT 0"),
    d1.prepare("SELECT owner_id FROM asset_folders LIMIT 0"),
    d1.prepare("SELECT owner_id, draft_status, submitted_at, review_note FROM chapters LIMIT 0"),
    d1.prepare("SELECT owner_id FROM assets LIMIT 0"),
    d1.prepare("SELECT id FROM users LIMIT 0"),
    d1.prepare("SELECT id FROM sessions LIMIT 0"),
    d1.prepare("SELECT id FROM auth_tokens LIMIT 0"),
    d1.prepare("SELECT id FROM registration_consents LIMIT 0"),
    d1.prepare("SELECT id FROM account_operation_receipts LIMIT 0"),
    d1.prepare("SELECT user_id FROM account_preferences LIMIT 0"),
    d1.prepare("SELECT user_id, revision, commit_token FROM companion_profiles LIMIT 0"),
    d1.prepare("SELECT id, receipt_key FROM companion_reward_receipts LIMIT 0"),
    d1.prepare("SELECT id, terminal_event_ids_json FROM reading_progress LIMIT 0"),
    d1.prepare("SELECT id, completed_at FROM chapter_completion_records LIMIT 0"),
    d1.prepare("SELECT id, chapter_version FROM chapter_version_completion_facts LIMIT 0"),
    d1.prepare("SELECT id, public_snapshot_json FROM bookshelf_entries LIMIT 0"),
    d1.prepare("SELECT id, chapter_ids_json FROM novel_completion_frontiers LIMIT 0"),
    d1.prepare("SELECT id, operation_id FROM bookshelf_operation_receipts LIMIT 0"),
    d1.prepare("SELECT id, source_key FROM bookshelf_rate_limit_attempts LIMIT 0"),
    d1.prepare("SELECT id, total FROM bookshelf_list_snapshots LIMIT 0"),
    d1.prepare("SELECT id, chunk_index FROM bookshelf_list_snapshot_chunks LIMIT 0"),
    d1.prepare("SELECT id FROM auth_attempts LIMIT 0"),
  ]).catch((error: unknown) => {
    schemaReady = null;
    throw new Error("D1 结构尚未迁移，请先运行 pnpm db:migrate:local 或 pnpm db:migrate:remote", { cause: error });
  });
  return schemaReady;
}
