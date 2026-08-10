import { and, eq, isNull, lt } from "drizzle-orm";
import { ensureSchema, getDb } from ".";
import { chapters, readingProgress } from "./schema";
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
    completedAt: row.completedAt,
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
      : await getDb().select().from(readingProgress).where(and(
        eq(readingProgress.userId, userId),
        isNull(readingProgress.completedAt),
      ));
    return rows.map(formatProgress);
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
    await getDb().insert(readingProgress).values({
      id,
      userId,
      chapterId: chapter.id,
      chapterVersion: chapter.version,
      nodeId: validated.nodeId,
      pageIndex: validated.pageIndex,
      terminalEventIdsJson: JSON.stringify(validated.terminalEventIds),
      completedAt: validated.completedAt,
      updatedAt: validated.updatedAt,
    }).onConflictDoUpdate({
      target: readingProgress.id,
      set: {
        chapterVersion: chapter.version,
        nodeId: validated.nodeId,
        pageIndex: validated.pageIndex,
        terminalEventIdsJson: JSON.stringify(validated.terminalEventIds),
        completedAt: validated.completedAt,
        updatedAt: validated.updatedAt,
      },
      where: lt(readingProgress.updatedAt, validated.updatedAt),
    });
  },
};
