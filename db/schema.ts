import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const novels = sqliteTable("novels", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  ownerId: text("owner_id"),
  draftStatus: text("draft_status", { enum: ["draft", "submitted"] }).notNull().default("draft"),
  submittedAt: text("submitted_at"),
  reviewNote: text("review_note").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
  status: text("status", { enum: ["draft", "published", "offline"] }).notNull().default("draft"),
  draftJson: text("draft_json").notNull(),
  publishedJson: text("published_json"),
  version: integer("version").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("novels_owner_status_idx").on(table.ownerId, table.status),
  index("novels_status_sort_idx").on(table.status, table.sortOrder),
]);

export const novelVersions = sqliteTable("novel_versions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  novelId: text("novel_id").notNull(),
  version: integer("version").notNull(),
  snapshotJson: text("snapshot_json").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("novel_versions_novel_version_unique").on(table.novelId, table.version),
]);

export const chapters = sqliteTable("chapters", {
  id: text("id").primaryKey(),
  novelId: text("novel_id").notNull().default("legacy-global"),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  summary: text("summary").notNull().default(""),
  coverUrl: text("cover_url").notNull().default(""),
  ownerId: text("owner_id"),
  draftStatus: text("draft_status", { enum: ["draft", "submitted"] }).notNull().default("draft"),
  submittedAt: text("submitted_at"),
  reviewNote: text("review_note").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
  status: text("status", { enum: ["draft", "published", "offline"] }).notNull().default("draft"),
  draftJson: text("draft_json").notNull(),
  publishedJson: text("published_json"),
  version: integer("version").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("chapters_novel_status_sort_idx").on(table.novelId, table.status, table.sortOrder),
  index("chapters_owner_novel_idx").on(table.ownerId, table.novelId),
]);

export const chapterVersions = sqliteTable("chapter_versions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  chapterId: text("chapter_id").notNull(),
  version: integer("version").notNull(),
  snapshotJson: text("snapshot_json").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const assets = sqliteTable("assets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type", { enum: ["image", "audio", "video"] }).notNull(),
  url: text("url").notNull(),
  storageKey: text("storage_key").notNull().default(""),
  folderId: text("folder_id"),
  ownerId: text("owner_id"),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  duration: integer("duration").notNull().default(0),
  alt: text("alt").notNull().default(""),
  status: text("status", { enum: ["ready", "deleting", "delete_failed"] }).notNull().default("ready"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const assetFolders = sqliteTable("asset_folders", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ownerId: text("owner_id"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull().default(""),
  role: text("role", { enum: ["reader", "author", "admin"] }).notNull().default("reader"),
  status: text("status", { enum: ["pending", "active", "disabled"] }).notNull().default("pending"),
  emailVerifiedAt: text("email_verified_at"),
  lastVerificationSentAt: text("last_verification_sent_at"),
  pendingExpiresAt: text("pending_expires_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("users_email_unique").on(table.email),
  index("users_role_status_idx").on(table.role, table.status),
]);

export const registrationConsents = sqliteTable("registration_consents", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  ageConfirmedAt: text("age_confirmed_at").notNull(),
  termsVersion: text("terms_version").notNull(),
  privacyVersion: text("privacy_version").notNull(),
  confirmedAt: text("confirmed_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("registration_consents_user_unique").on(table.userId),
]);

export const accountOperationReceipts = sqliteTable("account_operation_receipts", {
  id: text("id").primaryKey(),
  idempotencyHash: text("idempotency_hash").notNull(),
  kind: text("kind", { enum: ["register", "resend", "restart"] }).notNull(),
  userId: text("user_id"),
  status: text("status", { enum: ["processing", "succeeded", "failed", "uncertain"] }).notNull(),
  resultJson: text("result_json").notNull().default("{}"),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("account_operation_receipts_idempotency_unique").on(table.idempotencyHash),
  index("account_operation_receipts_expiry_idx").on(table.expiresAt),
]);

export const accountPreferences = sqliteTable("account_preferences", {
  userId: text("user_id").primaryKey(),
  registrationAnalyticsAllowed: integer("registration_analytics_allowed", { mode: "boolean" }).notNull().default(false),
  readingPreferencesJson: text("reading_preferences_json").notNull().default("[]"),
  guideCompletedAt: text("guide_completed_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: text("expires_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
  index("sessions_user_idx").on(table.userId),
]);

export const authTokens = sqliteTable("auth_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  type: text("type", { enum: ["verify_email", "reset_password"] }).notNull(),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("auth_tokens_hash_unique").on(table.tokenHash),
  index("auth_tokens_user_type_idx").on(table.userId, table.type),
]);

export const readingProgress = sqliteTable("reading_progress", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  chapterVersion: integer("chapter_version").notNull().default(0),
  nodeId: text("node_id").notNull(),
  pageIndex: integer("page_index").notNull().default(0),
  terminalEventIdsJson: text("terminal_event_ids_json").notNull().default("[]"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("reading_progress_user_chapter_unique").on(table.userId, table.chapterId),
]);

export const chapterCompletionRecords = sqliteTable("chapter_completion_records", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  chapterVersion: integer("chapter_version").notNull().default(0),
  completedAt: text("completed_at").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("chapter_completion_records_user_chapter_unique").on(table.userId, table.chapterId),
  index("chapter_completion_records_user_time_idx").on(table.userId, table.completedAt),
]);

export const bookshelfEntries = sqliteTable("bookshelf_entries", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  novelId: text("novel_id").notNull(),
  publicSnapshotJson: text("public_snapshot_json").notNull().default("{}"),
  addedAt: text("added_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("bookshelf_entries_user_novel_unique").on(table.userId, table.novelId),
  index("bookshelf_entries_user_added_idx").on(table.userId, table.addedAt),
]);

export const novelCompletionFrontiers = sqliteTable("novel_completion_frontiers", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  novelId: text("novel_id").notNull(),
  chapterIdsJson: text("chapter_ids_json").notNull().default("[]"),
  completedAt: text("completed_at").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("novel_completion_frontiers_user_novel_unique").on(table.userId, table.novelId),
]);

export const bookshelfOperationReceipts = sqliteTable("bookshelf_operation_receipts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  operationDigest: text("operation_id").notNull(),
  action: text("action", { enum: ["add", "remove"] }).notNull(),
  novelId: text("novel_id").notNull(),
  status: text("status", { enum: ["processing", "succeeded", "failed", "uncertain"] }).notNull(),
  resultJson: text("result_json").notNull().default("{}"),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("bookshelf_operation_receipts_user_operation_unique").on(table.userId, table.operationDigest),
  index("bookshelf_operation_receipts_expiry_idx").on(table.expiresAt),
]);

export const bookshelfRateLimitAttempts = sqliteTable("bookshelf_rate_limit_attempts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  sourceKey: text("source_key").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("bookshelf_rate_limit_attempts_user_time_idx").on(table.userId, table.createdAt),
  index("bookshelf_rate_limit_attempts_source_time_idx").on(table.sourceKey, table.createdAt),
]);

export const bookshelfListSnapshots = sqliteTable("bookshelf_list_snapshots", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  total: integer("total").notNull(),
  expiresAt: text("expires_at").notNull(),
}, (table) => [
  index("bookshelf_list_snapshots_user_expiry_idx").on(table.userId, table.expiresAt),
]);

export const bookshelfListSnapshotChunks = sqliteTable("bookshelf_list_snapshot_chunks", {
  id: text("id").primaryKey(),
  snapshotId: text("snapshot_id").notNull(),
  userId: text("user_id").notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  entryIdsJson: text("entry_ids_json").notNull().default("[]"),
}, (table) => [
  uniqueIndex("bookshelf_list_snapshot_chunks_snapshot_chunk_unique").on(table.snapshotId, table.chunkIndex),
]);

export const authAttempts = sqliteTable("auth_attempts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull(),
  action: text("action").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("auth_attempts_key_action_time_idx").on(table.key, table.action, table.createdAt),
]);
