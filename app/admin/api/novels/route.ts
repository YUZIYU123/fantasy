import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { ensureSeed } from "../../../../db/chapters";
import { rowToNovel } from "../../../../db/novels";
import { assets, chapters, novels, novelVersions } from "../../../../db/schema";
import { adminAuthResponse, requireAdmin } from "../../../../lib/admin-auth";
import { validateNovelAssetReferences } from "../../../../lib/assets";
import {
  createBlankNovel,
  normalizeNovel,
  type NovelDocument,
  type NovelRecord,
  validateNovel,
} from "../../../../lib/story";

export async function GET(request: Request) {
  try { await requireAdmin(request); } catch (error) { return adminAuthResponse(error); }
  await ensureSeed();
  const rows = await getDb().select().from(novels).orderBy(asc(novels.sortOrder), desc(novels.updatedAt));
  return Response.json({ novels: rows.map(rowToNovel) });
}

export async function POST(request: Request) {
  try { await requireAdmin(request); } catch (error) { return adminAuthResponse(error); }
  await ensureSeed();
  const payload = await request.json() as {
    action?: string;
    id?: string;
    novel?: NovelDocument;
    meta?: Partial<NovelRecord>;
    version?: number;
  };
  const db = getDb();
  if (payload.action === "create" || payload.action === "duplicate") {
    let novel = createBlankNovel();
    if (payload.action === "duplicate" && payload.id) {
      const source = await db.select().from(novels).where(eq(novels.id, payload.id)).limit(1);
      if (source[0]) novel = normalizeNovel(JSON.parse(source[0].draftJson));
    }
    const id = crypto.randomUUID();
    const copy = structuredClone(novel);
    copy.name = payload.action === "duplicate" ? `${copy.name}（副本）` : "未命名小说";
    await db.insert(novels).values({
      id,
      slug: `novel-${Date.now().toString(36)}-${id.slice(0, 6)}`,
      ownerId: null,
      sortOrder: Date.now(),
      draftJson: JSON.stringify(copy),
    });
    return Response.json({ id }, { status: 201 });
  }
  if (!payload.id) return Response.json({ error: "缺少小说 ID" }, { status: 400 });
  const rows = await db.select().from(novels).where(eq(novels.id, payload.id)).limit(1);
  const current = rows[0];
  if (!current) return Response.json({ error: "小说不存在" }, { status: 404 });
  if (payload.action === "save" && payload.novel) {
    const novel = normalizeNovel(payload.novel);
    await db.update(novels).set({
      slug: String(payload.meta?.slug || current.slug).slice(0, 100),
      sortOrder: payload.meta?.sortOrder ?? current.sortOrder,
      draftJson: JSON.stringify(novel),
      draftStatus: "draft",
      submittedAt: null,
      reviewNote: "",
      updatedAt: new Date().toISOString(),
    }).where(eq(novels.id, current.id));
  } else if (payload.action === "publish" && payload.novel) {
    const novel = normalizeNovel(payload.novel);
    const assetRows = await db.select({
      id: assets.id, url: assets.url, type: assets.type, status: assets.status,
    }).from(assets);
    const errors = [...validateNovel(novel), ...validateNovelAssetReferences(novel, assetRows)];
    if (errors.length) return Response.json({ error: "发布校验失败", errors }, { status: 400 });
    const latest = await db.select({ version: novelVersions.version }).from(novelVersions)
      .where(eq(novelVersions.novelId, current.id)).orderBy(desc(novelVersions.version)).limit(1);
    const version = Math.max(current.version, latest[0]?.version ?? 0) + 1;
    await db.batch([
      db.update(novels).set({
        status: "published",
        draftStatus: "draft",
        submittedAt: null,
        reviewNote: "",
        draftJson: JSON.stringify(novel),
        publishedJson: JSON.stringify(novel),
        version,
        updatedAt: new Date().toISOString(),
      }).where(eq(novels.id, current.id)),
      db.insert(novelVersions).values({ novelId: current.id, version, snapshotJson: JSON.stringify(novel) }),
    ]);
  } else if (payload.action === "offline") {
    await db.update(novels).set({ status: "offline", updatedAt: new Date().toISOString() }).where(eq(novels.id, current.id));
  } else if (payload.action === "reject") {
    if (current.draftStatus !== "submitted") return Response.json({ error: "小说当前不在审核中" }, { status: 400 });
    const reviewNote = String(payload.meta?.reviewNote || "").trim();
    if (!reviewNote || reviewNote.length > 500) return Response.json({ error: "请填写 1–500 字的驳回原因" }, { status: 400 });
    await db.update(novels).set({
      draftStatus: "draft", submittedAt: null, reviewNote, updatedAt: new Date().toISOString(),
    }).where(eq(novels.id, current.id));
  } else if (payload.action === "delete") {
    const linked = await db.select({ id: chapters.id }).from(chapters).where(eq(chapters.novelId, current.id)).limit(1);
    if (linked[0]) return Response.json({ error: "请先删除该小说下的草稿章节" }, { status: 400 });
    if (current.status !== "draft") return Response.json({ error: "只能删除未发布的小说草稿" }, { status: 400 });
    await db.delete(novels).where(eq(novels.id, current.id));
  } else if (payload.action === "rollback" && payload.version) {
    const versions = await db.select().from(novelVersions).where(and(
      eq(novelVersions.novelId, current.id),
      eq(novelVersions.version, payload.version),
    )).limit(1);
    if (!versions[0]) return Response.json({ error: "版本不存在" }, { status: 404 });
    const snapshot = JSON.stringify(normalizeNovel(JSON.parse(versions[0].snapshotJson)));
    const latest = await db.select({ version: novelVersions.version }).from(novelVersions)
      .where(eq(novelVersions.novelId, current.id)).orderBy(desc(novelVersions.version)).limit(1);
    const version = Math.max(current.version, latest[0]?.version ?? 0) + 1;
    await db.batch([
      db.update(novels).set({
        draftJson: snapshot, publishedJson: snapshot, status: "published", version, updatedAt: new Date().toISOString(),
      }).where(eq(novels.id, current.id)),
      db.insert(novelVersions).values({ novelId: current.id, version, snapshotJson: snapshot }),
    ]);
  } else {
    return Response.json({ error: "不支持的小说操作" }, { status: 400 });
  }
  return Response.json({ ok: true });
}
