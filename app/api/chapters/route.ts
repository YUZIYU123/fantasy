import { and, asc, desc, eq } from "drizzle-orm";
import { chapters, chapterVersions } from "../../../db/schema";
import { ensureSchema, getDb } from "../../../db";
import { demoStory, type ChapterRecord, type StoryDocument, validateStory } from "../../../lib/story";

function rowToRecord(row: typeof chapters.$inferSelect): ChapterRecord {
  const { draftJson, publishedJson, createdAt: _createdAt, ...record } = row;
  return { ...record, draft: JSON.parse(draftJson), published: publishedJson ? JSON.parse(publishedJson) : null };
}

async function ensureSeed() {
  await ensureSchema();
  const db = getDb();
  const existing = await db.select({ id: chapters.id }).from(chapters).limit(1);
  if (existing.length) return;
  await db.insert(chapters).values({
    id: "chapter-demo", slug: "fog-harbor", title: demoStory.title, summary: demoStory.summary,
    coverUrl: "", sortOrder: 1, status: "published", draftJson: JSON.stringify(demoStory),
    publishedJson: JSON.stringify(demoStory), version: 1,
  });
  await db.insert(chapterVersions).values({ chapterId: "chapter-demo", version: 1, snapshotJson: JSON.stringify(demoStory) });
}

function isAdmin(request: Request) {
  const url = new URL(request.url);
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return true;
  const email = request.headers.get("oai-authenticated-user-email");
  const allowed = process.env.ADMIN_EMAIL;
  return Boolean(email && (!allowed || email.toLowerCase() === allowed.toLowerCase()));
}

export async function GET(request: Request) {
  await ensureSeed();
  const db = getDb();
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") ?? "public";
  const slug = url.searchParams.get("slug");
  if (mode === "admin" && !isAdmin(request)) return Response.json({ error: "请先使用管理员账号登录" }, { status: 401 });
  let rows;
  if (slug) rows = await db.select().from(chapters).where(eq(chapters.slug, slug)).limit(1);
  else if (mode === "admin") rows = await db.select().from(chapters).orderBy(asc(chapters.sortOrder), desc(chapters.updatedAt));
  else rows = await db.select().from(chapters).where(eq(chapters.status, "published")).orderBy(asc(chapters.sortOrder));
  const records = rows.map(rowToRecord);
  return Response.json({ chapters: mode === "public" ? records.map(({ draft: _draft, ...record }) => record) : records });
}

export async function POST(request: Request) {
  if (!isAdmin(request)) return Response.json({ error: "无管理员权限" }, { status: 401 });
  await ensureSeed();
  const payload = await request.json() as { action: string; id?: string; story?: StoryDocument; meta?: Partial<ChapterRecord>; version?: number };
  const db = getDb();
  if (payload.action === "create" || payload.action === "duplicate") {
    let story = demoStory;
    if (payload.action === "duplicate" && payload.id) {
      const source = await db.select().from(chapters).where(eq(chapters.id, payload.id)).limit(1);
      if (source[0]) story = JSON.parse(source[0].draftJson);
    }
    const id = crypto.randomUUID();
    const slug = `chapter-${Date.now().toString(36)}`;
    const copy = structuredClone(story);
    copy.title = payload.action === "duplicate" ? `${copy.title}（副本）` : "未命名章节";
    await db.insert(chapters).values({ id, slug, title: copy.title, summary: copy.summary, coverUrl: copy.coverUrl, sortOrder: Date.now(), status: "draft", draftJson: JSON.stringify(copy) });
    return Response.json({ id }, { status: 201 });
  }
  if (!payload.id) return Response.json({ error: "缺少章节 ID" }, { status: 400 });
  const currentRows = await db.select().from(chapters).where(eq(chapters.id, payload.id)).limit(1);
  const current = currentRows[0];
  if (!current) return Response.json({ error: "章节不存在" }, { status: 404 });
  if (payload.action === "save" && payload.story) {
    await db.update(chapters).set({ title: payload.story.title, summary: payload.story.summary, coverUrl: payload.story.coverUrl, slug: payload.meta?.slug || current.slug, sortOrder: payload.meta?.sortOrder ?? current.sortOrder, draftJson: JSON.stringify(payload.story), updatedAt: new Date().toISOString() }).where(eq(chapters.id, payload.id));
  } else if (payload.action === "publish" && payload.story) {
    const errors = validateStory(payload.story);
    if (errors.length) return Response.json({ error: "发布校验失败", errors }, { status: 400 });
    const version = current.version + 1;
    await db.batch([
      db.update(chapters).set({ title: payload.story.title, summary: payload.story.summary, coverUrl: payload.story.coverUrl, status: "published", draftJson: JSON.stringify(payload.story), publishedJson: JSON.stringify(payload.story), version, updatedAt: new Date().toISOString() }).where(eq(chapters.id, payload.id)),
      db.insert(chapterVersions).values({ chapterId: payload.id, version, snapshotJson: JSON.stringify(payload.story) }),
    ]);
  } else if (payload.action === "offline") {
    await db.update(chapters).set({ status: "offline", updatedAt: new Date().toISOString() }).where(eq(chapters.id, payload.id));
  } else if (payload.action === "delete") {
    if (current.status !== "draft") return Response.json({ error: "只能删除未发布的草稿" }, { status: 400 });
    await db.delete(chapters).where(eq(chapters.id, payload.id));
  } else if (payload.action === "rollback" && payload.version) {
    const versions = await db.select().from(chapterVersions).where(and(eq(chapterVersions.chapterId, payload.id), eq(chapterVersions.version, payload.version))).limit(1);
    if (!versions[0]) return Response.json({ error: "版本不存在" }, { status: 404 });
    const snapshot = versions[0].snapshotJson;
    await db.update(chapters).set({ draftJson: snapshot, publishedJson: snapshot, status: "published", version: payload.version, updatedAt: new Date().toISOString() }).where(eq(chapters.id, payload.id));
  }
  return Response.json({ ok: true });
}

export async function DELETE() {
  return Response.json({ error: "请通过受保护的章节操作删除" }, { status: 405 });
}
