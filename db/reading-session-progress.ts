import { and, eq } from "drizzle-orm";
import { ensureSchema, getD1Binding, getDb } from ".";
import { chapterCompletionRecords, chapters, readingProgress } from "./schema";
import { AuthError } from "../lib/auth";
import {
  ReadingSessionError,
  validateReadingProgressUpdate,
  type ReadingProgressUpdate,
} from "../lib/reading-session";
import { normalizeStory } from "../lib/story";

function formatProgress(row: typeof readingProgress.$inferSelect) {
  let terminalEventIds: string[] = [];
  try {
    terminalEventIds = JSON.parse(row.terminalEventIdsJson) as string[];
  } catch {
    terminalEventIds = [];
  }
  return {
    id: row.id,
    userId: row.userId,
    chapterId: row.chapterId,
    version: row.chapterVersion,
    nodeId: row.nodeId,
    pageIndex: row.pageIndex,
    terminalEventIds,
    completedAt: null,
    updatedAt: row.updatedAt,
  };
}

export const readingSessionProgress = {
  async list(userId: string, chapterId?: string | null) {
    await ensureSchema();
    const rows = chapterId
      ? await getDb().select().from(readingProgress).where(and(
        eq(readingProgress.userId, userId),
        eq(readingProgress.chapterId, chapterId),
      )).limit(1)
      : await getDb().select().from(readingProgress).where(eq(readingProgress.userId, userId));
    if (!rows.length) return [];
    const chapterRows = await getDb().select({ id: chapters.id, version: chapters.version, status: chapters.status })
      .from(chapters);
    const current = new Map(chapterRows.map((chapter) => [chapter.id, chapter]));
    return rows.filter((row) => {
      const chapter = current.get(row.chapterId);
      return chapter?.status === "published" && chapter.version === row.chapterVersion;
    }).map(formatProgress);
  },

  async readFacts(userId: string, chapterId: string) {
    await ensureSchema();
    const chapterExists = (await getDb().select({ id: chapters.id }).from(chapters)
      .where(eq(chapters.id, chapterId)).limit(1))[0];
    if (!chapterExists) return { resume: null, completion: null };
    const [resumeRows, completionRows] = await Promise.all([
      getDb().select().from(readingProgress).where(and(
        eq(readingProgress.userId, userId),
        eq(readingProgress.chapterId, chapterId),
      )).limit(1),
      getDb().select().from(chapterCompletionRecords).where(and(
        eq(chapterCompletionRecords.userId, userId),
        eq(chapterCompletionRecords.chapterId, chapterId),
      )).limit(1),
    ]);
    const completion = completionRows[0];
    return {
      resume: resumeRows[0] ? formatProgress(resumeRows[0]) : null,
      completion: completion ? {
        chapterId: completion.chapterId,
        version: completion.chapterVersion,
        completedAt: completion.completedAt,
        updatedAt: completion.updatedAt,
      } : null,
    };
  },

  async save(userId: string, update: ReadingProgressUpdate) {
    await ensureSchema();
    if (!update.chapterId) throw new AuthError("阅读进度数据不完整");
    const chapterRows = await getDb().select().from(chapters).where(and(
      eq(chapters.id, update.chapterId),
      eq(chapters.status, "published"),
    )).limit(1);
    const chapter = chapterRows[0];
    if (!chapter?.publishedJson) throw new AuthError("章节尚未发布", 404);
    let validated: ReturnType<typeof validateReadingProgressUpdate>;
    try {
      validated = validateReadingProgressUpdate(normalizeStory(JSON.parse(chapter.publishedJson)), update);
    } catch (error) {
      if (error instanceof ReadingSessionError) throw new AuthError(error.message, error.status);
      throw error;
    }
    const id = `${userId}:${chapter.id}`;
    const d1 = getD1Binding();
    if (validated.completedAt) {
      const recordedAt = new Date().toISOString();
      await d1.batch([
        d1.prepare(`INSERT OR IGNORE INTO chapter_version_completion_facts
          (id, user_id, chapter_id, chapter_version, completed_at, recorded_at) VALUES (?, ?, ?, ?, ?, ?)`)
          .bind(`${id}:${chapter.version}`, userId, chapter.id, chapter.version, validated.completedAt, recordedAt),
        d1.prepare(`INSERT INTO chapter_completion_records
          (id, user_id, chapter_id, chapter_version, completed_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET chapter_version = excluded.chapter_version,
            completed_at = excluded.completed_at, updated_at = excluded.updated_at
          WHERE chapter_completion_records.updated_at < excluded.updated_at`)
          .bind(id, userId, chapter.id, chapter.version, validated.completedAt, validated.updatedAt),
        d1.prepare("DELETE FROM reading_progress WHERE id = ? AND updated_at <= ?").bind(id, validated.updatedAt),
        d1.prepare(`INSERT INTO novel_completion_frontiers
          (id, user_id, novel_id, chapter_ids_json, completed_at, updated_at)
          SELECT ?, ?, ?, json_group_array(id), ?, ? FROM chapters
          WHERE novel_id = ? AND status = 'published'
          HAVING COUNT(*) > 0 AND COUNT(*) = (
            SELECT COUNT(*) FROM chapter_completion_records completion
            JOIN chapters completed_chapter ON completed_chapter.id = completion.chapter_id
            WHERE completion.user_id = ? AND completed_chapter.novel_id = ? AND completed_chapter.status = 'published'
          )
          ON CONFLICT(id) DO UPDATE SET chapter_ids_json = excluded.chapter_ids_json,
            completed_at = excluded.completed_at, updated_at = excluded.updated_at
          WHERE novel_completion_frontiers.updated_at < excluded.updated_at`)
          .bind(`${userId}:${chapter.novelId}`, userId, chapter.novelId, validated.completedAt, validated.updatedAt,
            chapter.novelId, userId, chapter.novelId),
      ]);
      return;
    }
    await d1.prepare(`INSERT INTO reading_progress
      (id, user_id, chapter_id, chapter_version, node_id, page_index, terminal_event_ids_json, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM chapter_completion_records
        WHERE id = ? AND updated_at >= ?
      )
      ON CONFLICT(id) DO UPDATE SET
        chapter_version = excluded.chapter_version,
        node_id = excluded.node_id,
        page_index = excluded.page_index,
        terminal_event_ids_json = excluded.terminal_event_ids_json,
        updated_at = excluded.updated_at
      WHERE reading_progress.updated_at < excluded.updated_at`)
      .bind(
        id, userId, chapter.id, chapter.version, validated.nodeId, validated.pageIndex,
        JSON.stringify(validated.terminalEventIds), validated.updatedAt, id, validated.updatedAt,
      ).run();
  },
};
