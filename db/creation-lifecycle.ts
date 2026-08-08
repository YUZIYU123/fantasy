import { and, asc, desc, eq, isNull, or } from "drizzle-orm";
import { getDb } from ".";
import { ensureSeed, rowToChapter } from "./chapters";
import { rowToNovel } from "./novels";
import { assets, chapters, chapterVersions, novels, novelVersions } from "./schema";
import { validateNovelAssetReferences, validateStoryAssetReferences } from "../lib/assets";
import {
  createBlankNovel,
  createBlankStory,
  normalizeNovel,
  normalizeStory,
  validateNovel,
  validateStory,
  validateStoryBodyLengths,
  validateStoryInputLengths,
  validateStoryMedia,
  type ChapterRecord,
  type NovelDocument,
  type NovelRecord,
  type StoryDocument,
} from "../lib/story";

export type CreationActor =
  | { kind: "administrator" }
  | { kind: "author"; id: string };

export type CreationCommand = {
  entity: "novel" | "chapter";
  action: string;
  id?: string;
  novel?: NovelDocument;
  story?: StoryDocument;
  meta?: Partial<NovelRecord & ChapterRecord> & { reviewNote?: string };
  version?: number;
};

export type CreationResult =
  | { kind: "created"; id: string }
  | { kind: "ok"; updatedAt?: string };

export class CreationLifecycleError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly errors?: string[],
  ) {
    super(message);
  }
}

function fail(message: string, status = 400, errors?: string[]): never {
  throw new CreationLifecycleError(message, status, errors);
}

function ownerIdFor(actor: CreationActor) {
  return actor.kind === "author" ? actor.id : null;
}

async function list(actor: CreationActor, entity: "novel" | "chapter") {
  await ensureSeed();
  const db = getDb();
  if (entity === "novel") {
    const rows = actor.kind === "author"
      ? await db.select().from(novels).where(eq(novels.ownerId, actor.id)).orderBy(asc(novels.sortOrder), desc(novels.updatedAt))
      : await db.select().from(novels).orderBy(asc(novels.sortOrder), desc(novels.updatedAt));
    return rows.map(rowToNovel);
  }
  const rows = actor.kind === "author"
    ? await db.select().from(chapters).where(eq(chapters.ownerId, actor.id)).orderBy(asc(chapters.sortOrder), desc(chapters.updatedAt))
    : await db.select().from(chapters).orderBy(asc(chapters.sortOrder), desc(chapters.updatedAt));
  return rows.map(rowToChapter);
}

async function listVersions(actor: CreationActor, entity: "novel" | "chapter", id: string) {
  await ensureSeed();
  const db = getDb();
  if (actor.kind === "author") {
    const rows = entity === "novel"
      ? await db.select({ ownerId: novels.ownerId }).from(novels).where(eq(novels.id, id)).limit(1)
      : await db.select({ ownerId: chapters.ownerId }).from(chapters).where(eq(chapters.id, id)).limit(1);
    if (!rows[0] || rows[0].ownerId !== actor.id) fail(entity === "novel" ? "小说不存在" : "章节不存在", 404);
  }
  return entity === "novel"
    ? await db.select({ version: novelVersions.version, createdAt: novelVersions.createdAt })
      .from(novelVersions).where(eq(novelVersions.novelId, id)).orderBy(desc(novelVersions.version))
    : await db.select({ version: chapterVersions.version, createdAt: chapterVersions.createdAt })
      .from(chapterVersions).where(eq(chapterVersions.chapterId, id)).orderBy(desc(chapterVersions.version));
}

async function availableAssets(actor: CreationActor) {
  const db = getDb();
  const selection = { id: assets.id, url: assets.url, type: assets.type, status: assets.status };
  return actor.kind === "author"
    ? db.select(selection).from(assets).where(or(isNull(assets.ownerId), eq(assets.ownerId, actor.id)))
    : db.select(selection).from(assets);
}

async function executeNovel(actor: CreationActor, command: CreationCommand): Promise<CreationResult> {
  const db = getDb();
  if (command.action === "create" || command.action === "duplicate") {
    let novel = createBlankNovel();
    if (command.action === "duplicate" && command.id) {
      const source = await db.select().from(novels).where(eq(novels.id, command.id)).limit(1);
      if (actor.kind === "author" && (!source[0] || source[0].ownerId !== actor.id)) fail("只能复制自己的小说", 403);
      if (source[0]) novel = normalizeNovel(JSON.parse(source[0].draftJson));
    }
    const id = crypto.randomUUID();
    const copy = structuredClone(novel);
    copy.name = command.action === "duplicate" ? `${copy.name}（副本）` : "未命名小说";
    await db.insert(novels).values({
      id,
      slug: `novel-${Date.now().toString(36)}-${id.slice(0, 6)}`,
      ownerId: ownerIdFor(actor),
      sortOrder: Date.now(),
      draftJson: JSON.stringify(copy),
    });
    return { kind: "created", id };
  }
  if (!command.id) fail("缺少小说 ID");
  const rows = await db.select().from(novels).where(eq(novels.id, command.id)).limit(1);
  const current = rows[0];
  if (!current) fail("小说不存在", 404);
  if (actor.kind === "author" && current.ownerId !== actor.id) fail("不能修改其他作者的小说", 403);

  if (command.action === "save" && command.novel) {
    if (actor.kind === "author" && current.draftStatus === "submitted") fail("审核中的小说资料已锁定，请先撤回");
    const novel = normalizeNovel(command.novel);
    await db.update(novels).set({
      slug: String(command.meta?.slug || current.slug).slice(0, 100),
      sortOrder: command.meta?.sortOrder ?? current.sortOrder,
      draftJson: JSON.stringify(novel),
      ...(actor.kind === "administrator" ? { draftStatus: "draft" as const, submittedAt: null } : {}),
      reviewNote: "",
      updatedAt: new Date().toISOString(),
    }).where(eq(novels.id, current.id));
  } else if (actor.kind === "author" && command.action === "submit" && command.novel) {
    if (current.draftStatus === "submitted") fail("小说资料已在审核中");
    const novel = normalizeNovel(command.novel);
    const errors = [...validateNovel(novel), ...validateNovelAssetReferences(novel, await availableAssets(actor))];
    if (errors.length) fail("提交审核校验失败", 400, errors);
    await db.update(novels).set({
      draftJson: JSON.stringify(novel), draftStatus: "submitted", submittedAt: new Date().toISOString(),
      reviewNote: "", updatedAt: new Date().toISOString(),
    }).where(eq(novels.id, current.id));
  } else if (actor.kind === "author" && command.action === "withdraw") {
    if (current.draftStatus !== "submitted") fail("小说资料当前不在审核中");
    await db.update(novels).set({ draftStatus: "draft", submittedAt: null, updatedAt: new Date().toISOString() })
      .where(eq(novels.id, current.id));
  } else if (actor.kind === "administrator" && command.action === "publish" && command.novel) {
    const novel = normalizeNovel(command.novel);
    const errors = [...validateNovel(novel), ...validateNovelAssetReferences(novel, await availableAssets(actor))];
    if (errors.length) fail("发布校验失败", 400, errors);
    const latest = await db.select({ version: novelVersions.version }).from(novelVersions)
      .where(eq(novelVersions.novelId, current.id)).orderBy(desc(novelVersions.version)).limit(1);
    const version = Math.max(current.version, latest[0]?.version ?? 0) + 1;
    const snapshot = JSON.stringify(novel);
    await db.batch([
      db.update(novels).set({
        status: "published", draftStatus: "draft", submittedAt: null, reviewNote: "",
        draftJson: snapshot, publishedJson: snapshot, version, updatedAt: new Date().toISOString(),
      }).where(eq(novels.id, current.id)),
      db.insert(novelVersions).values({ novelId: current.id, version, snapshotJson: snapshot }),
    ]);
  } else if (actor.kind === "administrator" && command.action === "offline") {
    await db.update(novels).set({ status: "offline", updatedAt: new Date().toISOString() }).where(eq(novels.id, current.id));
  } else if (actor.kind === "administrator" && command.action === "reject") {
    if (current.draftStatus !== "submitted") fail("小说当前不在审核中");
    const reviewNote = String(command.meta?.reviewNote || "").trim();
    if (!reviewNote || reviewNote.length > 500) fail("请填写 1–500 字的驳回原因");
    await db.update(novels).set({ draftStatus: "draft", submittedAt: null, reviewNote, updatedAt: new Date().toISOString() })
      .where(eq(novels.id, current.id));
  } else if (command.action === "delete") {
    const linked = await db.select({ id: chapters.id }).from(chapters).where(eq(chapters.novelId, current.id)).limit(1);
    if (linked[0]) fail("请先删除该小说下的草稿章节");
    if (actor.kind === "author" && (current.status !== "draft" || current.draftStatus !== "draft")) {
      fail("只能删除未发布且未提交审核的小说");
    }
    if (actor.kind === "administrator" && current.status !== "draft") fail("只能删除未发布的小说草稿");
    await db.delete(novels).where(eq(novels.id, current.id));
  } else if (actor.kind === "administrator" && command.action === "rollback" && command.version) {
    const versions = await db.select().from(novelVersions).where(and(
      eq(novelVersions.novelId, current.id), eq(novelVersions.version, command.version),
    )).limit(1);
    if (!versions[0]) fail("版本不存在", 404);
    const snapshot = JSON.stringify(normalizeNovel(JSON.parse(versions[0].snapshotJson)));
    const latest = await db.select({ version: novelVersions.version }).from(novelVersions)
      .where(eq(novelVersions.novelId, current.id)).orderBy(desc(novelVersions.version)).limit(1);
    const version = Math.max(current.version, latest[0]?.version ?? 0) + 1;
    await db.batch([
      db.update(novels).set({ draftJson: snapshot, publishedJson: snapshot, status: "published", version, updatedAt: new Date().toISOString() })
        .where(eq(novels.id, current.id)),
      db.insert(novelVersions).values({ novelId: current.id, version, snapshotJson: snapshot }),
    ]);
  } else {
    fail("不支持的小说操作");
  }
  return { kind: "ok" };
}

async function executeChapter(actor: CreationActor, command: CreationCommand): Promise<CreationResult> {
  const db = getDb();
  if (command.action === "create" || command.action === "duplicate") {
    let story = createBlankStory();
    let sourceNovelId: string | undefined;
    if (command.action === "duplicate" && command.id) {
      const source = (await db.select().from(chapters).where(eq(chapters.id, command.id)).limit(1))[0];
      if (actor.kind === "author" && (!source || source.ownerId !== actor.id)) fail("只能复制自己的章节", 403);
      if (source) {
        story = normalizeStory(JSON.parse(source.draftJson));
        sourceNovelId = source.novelId;
      }
    }
    const novelId = command.action === "duplicate" ? sourceNovelId : command.meta?.novelId;
    if (!novelId) fail("请先选择小说");
    const parent = await db.select({ ownerId: novels.ownerId }).from(novels).where(eq(novels.id, novelId)).limit(1);
    if (!parent[0] || (actor.kind === "author" && parent[0].ownerId !== actor.id)) {
      fail(actor.kind === "author" ? "所属小说不存在" : "所属小说不存在", 404);
    }
    const id = crypto.randomUUID();
    const copy = structuredClone(story);
    copy.title = command.action === "duplicate" ? `${copy.title}（副本）` : "未命名章节";
    await db.insert(chapters).values({
      id, novelId, slug: `chapter-${Date.now().toString(36)}-${id.slice(0, 6)}`,
      title: copy.title, summary: copy.summary, coverUrl: copy.openingImageUrl,
      ownerId: ownerIdFor(actor), draftStatus: "draft", sortOrder: Date.now(), status: "draft",
      draftJson: JSON.stringify(copy),
    });
    return { kind: "created", id };
  }
  if (!command.id) fail("缺少章节 ID");
  const current = (await db.select().from(chapters).where(eq(chapters.id, command.id)).limit(1))[0];
  if (!current) fail("章节不存在", 404);
  if (actor.kind === "author" && current.ownerId !== actor.id) fail("不能修改其他作者的章节", 403);
  let updatedAt: string | undefined;

  if (command.action === "save" && command.story) {
    if (actor.kind === "author" && current.draftStatus === "submitted") fail("审核中的草稿已锁定，请先撤回");
    const story = normalizeStory(command.story);
    const errors = [...validateStoryBodyLengths(story), ...validateStoryInputLengths(story)];
    if (errors.length) fail("草稿字数校验失败", 400, errors);
    updatedAt = new Date().toISOString();
    await db.update(chapters).set({
      title: story.title, summary: story.summary, coverUrl: story.openingImageUrl,
      slug: String(command.meta?.slug || current.slug).slice(0, 100),
      sortOrder: command.meta?.sortOrder ?? current.sortOrder,
      draftJson: JSON.stringify(story),
      ...(actor.kind === "administrator" ? { draftStatus: "draft" as const, submittedAt: null } : {}),
      reviewNote: "", updatedAt,
    }).where(eq(chapters.id, current.id));
  } else if (actor.kind === "author" && command.action === "submit" && command.story) {
    if (current.draftStatus === "submitted") fail("章节已在审核中");
    const story = normalizeStory(command.story);
    const errors = [...validateStory(story), ...validateStoryMedia(story), ...validateStoryAssetReferences(story, await availableAssets(actor))];
    if (errors.length) fail("提交审核校验失败", 400, errors);
    await db.update(chapters).set({
      title: story.title, summary: story.summary, coverUrl: story.openingImageUrl,
      draftJson: JSON.stringify(story), draftStatus: "submitted", submittedAt: new Date().toISOString(),
      reviewNote: "", updatedAt: new Date().toISOString(),
    }).where(eq(chapters.id, current.id));
  } else if (actor.kind === "author" && command.action === "withdraw") {
    if (current.draftStatus !== "submitted") fail("章节当前不在审核中");
    await db.update(chapters).set({ draftStatus: "draft", submittedAt: null, updatedAt: new Date().toISOString() })
      .where(eq(chapters.id, current.id));
  } else if (actor.kind === "administrator" && command.action === "publish" && command.story) {
    const parent = (await db.select({ status: novels.status }).from(novels).where(eq(novels.id, current.novelId)).limit(1))[0];
    if (!parent || parent.status !== "published") fail("请先发布所属小说资料，再发布章节");
    const story = normalizeStory(command.story);
    const errors = [...validateStory(story), ...validateStoryMedia(story), ...validateStoryAssetReferences(story, await availableAssets(actor))];
    if (errors.length) fail("发布校验失败", 400, errors);
    const latest = await db.select({ version: chapterVersions.version }).from(chapterVersions)
      .where(eq(chapterVersions.chapterId, current.id)).orderBy(desc(chapterVersions.version)).limit(1);
    const version = Math.max(current.version, latest[0]?.version ?? 0) + 1;
    const snapshot = JSON.stringify(story);
    await db.batch([
      db.update(chapters).set({
        title: story.title, summary: story.summary, coverUrl: story.openingImageUrl,
        status: "published", draftStatus: "draft", submittedAt: null, reviewNote: "",
        draftJson: snapshot, publishedJson: snapshot, version, updatedAt: new Date().toISOString(),
      }).where(eq(chapters.id, current.id)),
      db.insert(chapterVersions).values({ chapterId: current.id, version, snapshotJson: snapshot }),
    ]);
  } else if (actor.kind === "administrator" && command.action === "offline") {
    await db.update(chapters).set({ status: "offline", updatedAt: new Date().toISOString() }).where(eq(chapters.id, current.id));
  } else if (actor.kind === "administrator" && command.action === "reject") {
    if (current.draftStatus !== "submitted") fail("章节当前不在审核中");
    const reviewNote = String(command.meta?.reviewNote || "").trim();
    if (!reviewNote || reviewNote.length > 500) fail("请填写 1–500 字的驳回原因");
    await db.update(chapters).set({ draftStatus: "draft", submittedAt: null, reviewNote, updatedAt: new Date().toISOString() })
      .where(eq(chapters.id, current.id));
  } else if (command.action === "delete") {
    if (actor.kind === "author" && (current.status !== "draft" || current.draftStatus !== "draft")) {
      fail("只能删除未发布且未提交审核的草稿");
    }
    if (actor.kind === "administrator" && current.status !== "draft") fail("只能删除未发布的草稿");
    await db.delete(chapters).where(eq(chapters.id, current.id));
  } else if (actor.kind === "administrator" && command.action === "rollback" && command.version) {
    const versionRows = await db.select().from(chapterVersions).where(and(
      eq(chapterVersions.chapterId, current.id), eq(chapterVersions.version, command.version),
    )).limit(1);
    if (!versionRows[0]) fail("版本不存在", 404);
    const snapshot = JSON.stringify(normalizeStory(JSON.parse(versionRows[0].snapshotJson)));
    const latest = await db.select({ version: chapterVersions.version }).from(chapterVersions)
      .where(eq(chapterVersions.chapterId, current.id)).orderBy(desc(chapterVersions.version)).limit(1);
    const version = Math.max(current.version, latest[0]?.version ?? 0) + 1;
    await db.batch([
      db.update(chapters).set({
        title: JSON.parse(snapshot).title, summary: JSON.parse(snapshot).summary,
        coverUrl: JSON.parse(snapshot).openingImageUrl, draftJson: snapshot, publishedJson: snapshot,
        status: "published", version, updatedAt: new Date().toISOString(),
      }).where(eq(chapters.id, current.id)),
      db.insert(chapterVersions).values({ chapterId: current.id, version, snapshotJson: snapshot }),
    ]);
  } else {
    fail("不支持的章节操作");
  }
  return { kind: "ok", ...(updatedAt ? { updatedAt } : {}) };
}

async function execute(actor: CreationActor, command: CreationCommand) {
  await ensureSeed();
  return command.entity === "novel" ? executeNovel(actor, command) : executeChapter(actor, command);
}

export const creationLifecycle = { list, listVersions, execute };

export function creationLifecycleResponse(result: CreationResult) {
  return result.kind === "created"
    ? Response.json({ id: result.id }, { status: 201 })
    : Response.json({ ok: true, ...(result.updatedAt ? { updatedAt: result.updatedAt } : {}) });
}

export function creationLifecycleErrorResponse(error: unknown) {
  if (error instanceof CreationLifecycleError) {
    return Response.json({ error: error.message, ...(error.errors ? { errors: error.errors } : {}) }, { status: error.status });
  }
  return null;
}
