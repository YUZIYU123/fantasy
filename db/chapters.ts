import { chapters } from "./schema";
import { ensureSchema } from ".";
import { ensureLegacyNovels } from "./novels";
import { normalizeStory, type ChapterRecord } from "../lib/story";

export function rowToChapter(row: typeof chapters.$inferSelect): ChapterRecord {
  return {
    id: row.id, novelId: row.novelId, slug: row.slug, title: row.title, summary: row.summary, coverUrl: row.coverUrl,
    ownerId: row.ownerId, draftStatus: row.draftStatus, submittedAt: row.submittedAt, reviewNote: row.reviewNote,
    sortOrder: row.sortOrder, status: row.status, version: row.version, updatedAt: row.updatedAt,
    draft: normalizeStory(JSON.parse(row.draftJson)),
    published: row.publishedJson ? normalizeStory(JSON.parse(row.publishedJson)) : null,
  };
}

export async function ensureSeed() {
  await ensureSchema();
  await ensureLegacyNovels();
}
