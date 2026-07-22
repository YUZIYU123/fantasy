import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const chapters = sqliteTable("chapters", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  summary: text("summary").notNull().default(""),
  coverUrl: text("cover_url").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
  status: text("status", { enum: ["draft", "published", "offline"] }).notNull().default("draft"),
  draftJson: text("draft_json").notNull(),
  publishedJson: text("published_json"),
  version: integer("version").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

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
  type: text("type", { enum: ["image", "audio"] }).notNull(),
  url: text("url").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  alt: text("alt").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
