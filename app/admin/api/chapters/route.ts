import { and, asc, desc, eq } from "drizzle-orm";
import { assets, chapters, chapterVersions, novels } from "../../../../db/schema";
import { ensureSeed, rowToChapter } from "../../../../db/chapters";
import { getDb } from "../../../../db";
import { adminAuthResponse, requireAdmin } from "../../../../lib/admin-auth";
import { validateStoryAssetReferences } from "../../../../lib/assets";
import {
  createBlankStory, normalizeStory, type ChapterRecord, type StoryDocument,
  validateStory, validateStoryBodyLengths, validateStoryInputLengths, validateStoryMedia,
} from "../../../../lib/story";

export async function GET(request: Request) {
  try { await requireAdmin(request); } catch (error) { return adminAuthResponse(error); }
  await ensureSeed();
  const rows = await getDb().select().from(chapters).orderBy(asc(chapters.sortOrder), desc(chapters.updatedAt));
  return Response.json({ chapters: rows.map(rowToChapter) });
}

export async function POST(request: Request) {
  try { await requireAdmin(request); } catch (error) { return adminAuthResponse(error); }
  await ensureSeed();
  const payload = await request.json() as { action: string; id?: string; story?: StoryDocument; meta?: Partial<ChapterRecord>; version?: number };
  const db = getDb();
  if (payload.action === "create" || payload.action === "duplicate") {
    let story = createBlankStory();
    if (payload.action === "duplicate" && payload.id) {
      const source = await db.select().from(chapters).where(eq(chapters.id, payload.id)).limit(1);
      if (source[0]) story = normalizeStory(JSON.parse(source[0].draftJson));
    }
    const id = crypto.randomUUID();
    const slug = `chapter-${Date.now().toString(36)}`;
    const copy = structuredClone(story);
    const novelId = payload.action === "duplicate"
      ? (await db.select({ novelId: chapters.novelId }).from(chapters).where(eq(chapters.id, payload.id!)).limit(1))[0]?.novelId
      : payload.meta?.novelId;
    if (!novelId) return Response.json({ error: "请先选择小说" }, { status: 400 });
    const parent = await db.select({ id: novels.id }).from(novels).where(eq(novels.id, novelId)).limit(1);
    if (!parent[0]) return Response.json({ error: "所属小说不存在" }, { status: 404 });
    copy.title = payload.action === "duplicate" ? `${copy.title}（副本）` : "未命名章节";
    await db.insert(chapters).values({
      id, novelId, slug, title: copy.title, summary: copy.summary, coverUrl: copy.openingImageUrl,
      ownerId: null, draftStatus: "draft", sortOrder: Date.now(), status: "draft",
      draftJson: JSON.stringify(copy),
    });
    return Response.json({ id }, { status: 201 });
  }
  if (!payload.id) return Response.json({ error: "缺少章节 ID" }, { status: 400 });
  const currentRows = await db.select().from(chapters).where(eq(chapters.id, payload.id)).limit(1);
  const current = currentRows[0];
  if (!current) return Response.json({ error: "章节不存在" }, { status: 404 });
  let savedAt: string | null = null;
  if (payload.action === "save" && payload.story) {
    const story = normalizeStory(payload.story);
    const errors = [...validateStoryBodyLengths(story), ...validateStoryInputLengths(story)];
    if (errors.length) return Response.json({ error: "草稿字数校验失败", errors }, { status: 400 });
    savedAt = new Date().toISOString();
    await db.update(chapters).set({
      title: story.title, summary: story.summary, coverUrl: story.openingImageUrl,
      slug: payload.meta?.slug || current.slug, sortOrder: payload.meta?.sortOrder ?? current.sortOrder,
      draftJson: JSON.stringify(story), draftStatus: "draft", submittedAt: null, reviewNote: "",
      updatedAt: savedAt,
    }).where(eq(chapters.id, payload.id));
  } else if (payload.action === "publish" && payload.story) {
    const story = normalizeStory(payload.story);
    const parent = await db.select({ status: novels.status }).from(novels).where(eq(novels.id, current.novelId)).limit(1);
    if (parent[0]?.status !== "published") {
      return Response.json({ error: "请先发布所属小说资料，再发布章节" }, { status: 400 });
    }
    const assetRows = await db.select({ id: assets.id, url: assets.url, type: assets.type, status: assets.status }).from(assets);
    const errors = [...validateStory(story), ...validateStoryMedia(story), ...validateStoryAssetReferences(story, assetRows)];
    if (errors.length) return Response.json({ error: "发布校验失败", errors }, { status: 400 });
    const latestRows = await db.select({ version: chapterVersions.version }).from(chapterVersions).where(eq(chapterVersions.chapterId, payload.id)).orderBy(desc(chapterVersions.version)).limit(1);
    const version = Math.max(current.version, latestRows[0]?.version ?? 0) + 1;
    await db.batch([
      db.update(chapters).set({
        title: story.title, summary: story.summary, coverUrl: story.openingImageUrl,
        status: "published", draftStatus: "draft", submittedAt: null, reviewNote: "",
        draftJson: JSON.stringify(story), publishedJson: JSON.stringify(story), version,
        updatedAt: new Date().toISOString(),
      }).where(eq(chapters.id, payload.id)),
      db.insert(chapterVersions).values({ chapterId: payload.id, version, snapshotJson: JSON.stringify(story) }),
    ]);
  } else if (payload.action === "offline") {
    await db.update(chapters).set({ status: "offline", updatedAt: new Date().toISOString() }).where(eq(chapters.id, payload.id));
  } else if (payload.action === "reject") {
    if (current.draftStatus !== "submitted") return Response.json({ error: "章节当前不在审核中" }, { status: 400 });
    const reviewNote = String(payload.meta?.reviewNote || "").trim();
    if (!reviewNote || reviewNote.length > 500) return Response.json({ error: "请填写 1–500 字的驳回原因" }, { status: 400 });
    await db.update(chapters).set({
      draftStatus: "draft", submittedAt: null, reviewNote, updatedAt: new Date().toISOString(),
    }).where(eq(chapters.id, payload.id));
  } else if (payload.action === "delete") {
    if (current.status !== "draft") return Response.json({ error: "只能删除未发布的草稿" }, { status: 400 });
    await db.delete(chapters).where(eq(chapters.id, payload.id));
  } else if (payload.action === "rollback" && payload.version) {
    const versions = await db.select().from(chapterVersions).where(and(eq(chapterVersions.chapterId, payload.id), eq(chapterVersions.version, payload.version))).limit(1);
    if (!versions[0]) return Response.json({ error: "版本不存在" }, { status: 404 });
    const snapshot = JSON.stringify(normalizeStory(JSON.parse(versions[0].snapshotJson)));
    const latestRows = await db.select({ version: chapterVersions.version }).from(chapterVersions).where(eq(chapterVersions.chapterId, payload.id)).orderBy(desc(chapterVersions.version)).limit(1);
    const version = Math.max(current.version, latestRows[0]?.version ?? 0) + 1;
    await db.batch([
      db.update(chapters).set({ draftJson: snapshot, publishedJson: snapshot, status: "published", version, updatedAt: new Date().toISOString() }).where(eq(chapters.id, payload.id)),
      db.insert(chapterVersions).values({ chapterId: payload.id, version, snapshotJson: snapshot }),
    ]);
  } else return Response.json({ error: "不支持的章节操作" }, { status: 400 });
  return Response.json({ ok: true, ...(savedAt ? { updatedAt: savedAt } : {}) });
}
