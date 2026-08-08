import { asc, desc, eq, isNull, or } from "drizzle-orm";
import { ensureSchema, getDb } from "../../../../db";
import { rowToChapter } from "../../../../db/chapters";
import { assets, chapters, novels } from "../../../../db/schema";
import { validateStoryAssetReferences } from "../../../../lib/assets";
import { assertSameOrigin, authErrorResponse, AuthError, requireRole } from "../../../../lib/auth";
import {
  createBlankStory, normalizeStory, type ChapterRecord, type StoryDocument,
  validateStory, validateStoryBodyLengths, validateStoryInputLengths, validateStoryMedia,
} from "../../../../lib/story";

export async function GET(request: Request) {
  try {
    await ensureSchema();
    const identity = await requireRole(request, ["author"]);
    const rows = await getDb().select().from(chapters)
      .where(eq(chapters.ownerId, identity.id))
      .orderBy(asc(chapters.sortOrder), desc(chapters.updatedAt));
    return Response.json({ chapters: rows.map(rowToChapter) });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await ensureSchema();
    assertSameOrigin(request);
    const identity = await requireRole(request, ["author"]);
    const payload = await request.json() as {
      action?: string;
      id?: string;
      story?: StoryDocument;
      meta?: Partial<ChapterRecord>;
    };
    const db = getDb();
    if (payload.action === "create" || payload.action === "duplicate") {
      let story = createBlankStory();
      if (payload.action === "duplicate" && payload.id) {
        const sourceRows = await db.select().from(chapters).where(eq(chapters.id, payload.id)).limit(1);
        const source = sourceRows[0];
        if (!source || source.ownerId !== identity.id) throw new AuthError("只能复制自己的章节", 403);
        story = normalizeStory(JSON.parse(source.draftJson));
      }
      const id = crypto.randomUUID();
      const copy = structuredClone(story);
      const novelId = payload.action === "duplicate"
        ? (await db.select({ novelId: chapters.novelId }).from(chapters).where(eq(chapters.id, payload.id!)).limit(1))[0]?.novelId
        : payload.meta?.novelId;
      if (!novelId) throw new AuthError("请先选择小说");
      const parent = await db.select({ ownerId: novels.ownerId }).from(novels).where(eq(novels.id, novelId)).limit(1);
      if (!parent[0] || parent[0].ownerId !== identity.id) throw new AuthError("所属小说不存在", 404);
      copy.title = payload.action === "duplicate" ? `${copy.title}（副本）` : "未命名章节";
      await db.insert(chapters).values({
        id,
        novelId,
        slug: `chapter-${Date.now().toString(36)}-${id.slice(0, 6)}`,
        title: copy.title,
        summary: copy.summary,
        coverUrl: copy.openingImageUrl,
        ownerId: identity.id,
        draftStatus: "draft",
        sortOrder: Date.now(),
        status: "draft",
        draftJson: JSON.stringify(copy),
      });
      return Response.json({ id }, { status: 201 });
    }
    if (!payload.id) throw new AuthError("缺少章节 ID");
    const currentRows = await db.select().from(chapters).where(eq(chapters.id, payload.id)).limit(1);
    const current = currentRows[0];
    if (!current) throw new AuthError("章节不存在", 404);
    if (current.ownerId !== identity.id) throw new AuthError("不能修改其他作者的章节", 403);
    let savedAt: string | null = null;

    if (payload.action === "save" && payload.story) {
      if (current.draftStatus === "submitted") throw new AuthError("审核中的草稿已锁定，请先撤回");
      const story = normalizeStory(payload.story);
      const errors = [...validateStoryBodyLengths(story), ...validateStoryInputLengths(story)];
      if (errors.length) return Response.json({ error: "草稿字数校验失败", errors }, { status: 400 });
      savedAt = new Date().toISOString();
      await db.update(chapters).set({
        title: story.title,
        summary: story.summary,
        coverUrl: story.openingImageUrl,
        slug: String(payload.meta?.slug || current.slug).slice(0, 100),
        sortOrder: payload.meta?.sortOrder ?? current.sortOrder,
        draftJson: JSON.stringify(story),
        reviewNote: "",
        updatedAt: savedAt,
      }).where(eq(chapters.id, current.id));
    } else if (payload.action === "submit" && payload.story) {
      if (current.draftStatus === "submitted") throw new AuthError("章节已在审核中");
      const story = normalizeStory(payload.story);
      const assetRows = await db.select({
        id: assets.id, url: assets.url, type: assets.type, status: assets.status,
      }).from(assets).where(or(isNull(assets.ownerId), eq(assets.ownerId, identity.id)));
      const errors = [
        ...validateStory(story),
        ...validateStoryMedia(story),
        ...validateStoryAssetReferences(story, assetRows),
      ];
      if (errors.length) return Response.json({ error: "提交审核校验失败", errors }, { status: 400 });
      await db.update(chapters).set({
        title: story.title,
        summary: story.summary,
        coverUrl: story.openingImageUrl,
        draftJson: JSON.stringify(story),
        draftStatus: "submitted",
        submittedAt: new Date().toISOString(),
        reviewNote: "",
        updatedAt: new Date().toISOString(),
      }).where(eq(chapters.id, current.id));
    } else if (payload.action === "withdraw") {
      if (current.draftStatus !== "submitted") throw new AuthError("章节当前不在审核中");
      await db.update(chapters).set({
        draftStatus: "draft",
        submittedAt: null,
        updatedAt: new Date().toISOString(),
      }).where(eq(chapters.id, current.id));
    } else if (payload.action === "delete") {
      if (current.status !== "draft" || current.draftStatus !== "draft") {
        throw new AuthError("只能删除未发布且未提交审核的草稿");
      }
      await db.delete(chapters).where(eq(chapters.id, current.id));
    } else {
      throw new AuthError("不支持的章节操作");
    }
    return Response.json({ ok: true, ...(savedAt ? { updatedAt: savedAt } : {}) });
  } catch (error) {
    return authErrorResponse(error);
  }
}
