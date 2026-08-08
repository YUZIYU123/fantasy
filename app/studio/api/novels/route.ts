import { asc, desc, eq, isNull, or } from "drizzle-orm";
import { ensureSchema, getDb } from "../../../../db";
import { ensureLegacyNovels, rowToNovel } from "../../../../db/novels";
import { assets, chapters, novels } from "../../../../db/schema";
import { validateNovelAssetReferences } from "../../../../lib/assets";
import { assertSameOrigin, authErrorResponse, AuthError, requireRole } from "../../../../lib/auth";
import {
  createBlankNovel,
  normalizeNovel,
  type NovelDocument,
  type NovelRecord,
  validateNovel,
} from "../../../../lib/story";

export async function GET(request: Request) {
  try {
    await ensureSchema();
    await ensureLegacyNovels();
    const identity = await requireRole(request, ["author"]);
    const rows = await getDb().select().from(novels).where(eq(novels.ownerId, identity.id))
      .orderBy(asc(novels.sortOrder), desc(novels.updatedAt));
    return Response.json({ novels: rows.map(rowToNovel) });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await ensureSchema();
    assertSameOrigin(request);
    await ensureLegacyNovels();
    const identity = await requireRole(request, ["author"]);
    const payload = await request.json() as {
      action?: string;
      id?: string;
      novel?: NovelDocument;
      meta?: Partial<NovelRecord>;
    };
    const db = getDb();
    if (payload.action === "create" || payload.action === "duplicate") {
      let novel = createBlankNovel();
      if (payload.action === "duplicate" && payload.id) {
        const source = await db.select().from(novels).where(eq(novels.id, payload.id)).limit(1);
        if (!source[0] || source[0].ownerId !== identity.id) throw new AuthError("只能复制自己的小说", 403);
        novel = normalizeNovel(JSON.parse(source[0].draftJson));
      }
      const id = crypto.randomUUID();
      const copy = structuredClone(novel);
      copy.name = payload.action === "duplicate" ? `${copy.name}（副本）` : "未命名小说";
      await db.insert(novels).values({
        id,
        slug: `novel-${Date.now().toString(36)}-${id.slice(0, 6)}`,
        ownerId: identity.id,
        sortOrder: Date.now(),
        draftJson: JSON.stringify(copy),
      });
      return Response.json({ id }, { status: 201 });
    }
    if (!payload.id) throw new AuthError("缺少小说 ID");
    const rows = await db.select().from(novels).where(eq(novels.id, payload.id)).limit(1);
    const current = rows[0];
    if (!current) throw new AuthError("小说不存在", 404);
    if (current.ownerId !== identity.id) throw new AuthError("不能修改其他作者的小说", 403);
    if (payload.action === "save" && payload.novel) {
      if (current.draftStatus === "submitted") throw new AuthError("审核中的小说资料已锁定，请先撤回");
      const novel = normalizeNovel(payload.novel);
      await db.update(novels).set({
        slug: String(payload.meta?.slug || current.slug).slice(0, 100),
        sortOrder: payload.meta?.sortOrder ?? current.sortOrder,
        draftJson: JSON.stringify(novel),
        reviewNote: "",
        updatedAt: new Date().toISOString(),
      }).where(eq(novels.id, current.id));
    } else if (payload.action === "submit" && payload.novel) {
      if (current.draftStatus === "submitted") throw new AuthError("小说资料已在审核中");
      const novel = normalizeNovel(payload.novel);
      const assetRows = await db.select({
        id: assets.id, url: assets.url, type: assets.type, status: assets.status,
      }).from(assets).where(or(isNull(assets.ownerId), eq(assets.ownerId, identity.id)));
      const errors = [...validateNovel(novel), ...validateNovelAssetReferences(novel, assetRows)];
      if (errors.length) return Response.json({ error: "提交审核校验失败", errors }, { status: 400 });
      await db.update(novels).set({
        draftJson: JSON.stringify(novel),
        draftStatus: "submitted",
        submittedAt: new Date().toISOString(),
        reviewNote: "",
        updatedAt: new Date().toISOString(),
      }).where(eq(novels.id, current.id));
    } else if (payload.action === "withdraw") {
      if (current.draftStatus !== "submitted") throw new AuthError("小说资料当前不在审核中");
      await db.update(novels).set({ draftStatus: "draft", submittedAt: null, updatedAt: new Date().toISOString() })
        .where(eq(novels.id, current.id));
    } else if (payload.action === "delete") {
      const linked = await db.select({ id: chapters.id }).from(chapters).where(eq(chapters.novelId, current.id)).limit(1);
      if (linked[0]) throw new AuthError("请先删除该小说下的草稿章节");
      if (current.status !== "draft" || current.draftStatus !== "draft") throw new AuthError("只能删除未发布且未提交审核的小说");
      await db.delete(novels).where(eq(novels.id, current.id));
    } else {
      throw new AuthError("不支持的小说操作");
    }
    return Response.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}
