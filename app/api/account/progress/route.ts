import { and, eq, isNull, lt } from "drizzle-orm";
import { ensureSchema, getDb } from "../../../../db";
import { chapters, readingProgress } from "../../../../db/schema";
import { assertSameOrigin, authErrorResponse, AuthError, requireSession } from "../../../../lib/auth";
import { applyTerminalTaskEvents, normalizeStory } from "../../../../lib/story";

export async function GET(request: Request) {
  try {
    await ensureSchema();
    const identity = await requireSession(request);
    const chapterId = new URL(request.url).searchParams.get("chapterId");
    const rows = chapterId
      ? await getDb().select().from(readingProgress).where(and(eq(readingProgress.userId, identity.id), eq(readingProgress.chapterId, chapterId))).limit(1)
      : await getDb().select().from(readingProgress).where(and(
        eq(readingProgress.userId, identity.id),
        isNull(readingProgress.completedAt),
      ));
    const formatted = rows.map((row) => ({
      ...row,
      version: row.chapterVersion,
      terminalEventIds: (() => {
        try { return JSON.parse(row.terminalEventIdsJson) as string[]; } catch { return []; }
      })(),
      terminalEventIdsJson: undefined,
    }));
    return Response.json({ progress: chapterId ? formatted[0] || null : formatted });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    await ensureSchema();
    assertSameOrigin(request);
    const identity = await requireSession(request);
    const body = await request.json() as {
      chapterId?: string;
      nodeId?: string;
      pageIndex?: number;
      updatedAt?: string;
      completed?: boolean;
      terminalEventIds?: string[];
    };
    if (!body.chapterId || !body.nodeId) throw new AuthError("阅读进度数据不完整");
    const chapterRows = await getDb().select().from(chapters).where(and(eq(chapters.id, body.chapterId), eq(chapters.status, "published"))).limit(1);
    const chapter = chapterRows[0];
    if (!chapter?.publishedJson) throw new AuthError("章节尚未发布", 404);
    const story = normalizeStory(JSON.parse(chapter.publishedJson));
    const progressNode = story.nodes.find((node) => node.id === body.nodeId);
    if (!progressNode) throw new AuthError("阅读节点已失效", 409);
    if (body.completed && !progressNode.canEndChapter) throw new AuthError("只能在允许结束本章的节点完成章节", 409);
    const requestedTerminalEventIds = Array.isArray(body.terminalEventIds)
      ? body.terminalEventIds.filter((id): id is string => typeof id === "string" && id.length <= 100).slice(0, 200)
      : [];
    const terminalEventIds = applyTerminalTaskEvents(story, requestedTerminalEventIds).appliedIds;
    const id = `${identity.id}:${chapter.id}`;
    const now = Date.now();
    const requestedTime = body.updatedAt && Number.isFinite(Date.parse(body.updatedAt))
      ? Date.parse(body.updatedAt)
      : now;
    const updatedAt = new Date(Math.min(requestedTime, now + 5 * 60 * 1000)).toISOString();
    const completedAt = body.completed ? updatedAt : null;
    await getDb().insert(readingProgress).values({
      id,
      userId: identity.id,
      chapterId: chapter.id,
      chapterVersion: chapter.version,
      nodeId: body.nodeId,
      pageIndex: Math.max(0, Math.floor(Number(body.pageIndex) || 0)),
      terminalEventIdsJson: JSON.stringify(terminalEventIds),
      completedAt,
      updatedAt,
    }).onConflictDoUpdate({
      target: readingProgress.id,
      set: {
        chapterVersion: chapter.version,
        nodeId: body.nodeId,
        pageIndex: Math.max(0, Math.floor(Number(body.pageIndex) || 0)),
        terminalEventIdsJson: JSON.stringify(terminalEventIds),
        completedAt,
        updatedAt,
      },
      where: lt(readingProgress.updatedAt, updatedAt),
    });
    return Response.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}
