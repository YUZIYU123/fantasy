import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
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

type NovelMeta = Pick<Partial<NovelRecord>, "slug" | "sortOrder"> & { reviewNote?: string };
type ChapterMeta = Pick<Partial<ChapterRecord>, "slug" | "sortOrder" | "novelId"> & { reviewNote?: string };

type NovelCommand =
  | { entity: "novel"; action: "create" }
  | { entity: "novel"; action: "duplicate"; id?: string }
  | { entity: "novel"; action: "save" | "submit" | "publish"; id: string; novel: NovelDocument; meta?: NovelMeta }
  | { entity: "novel"; action: "withdraw" | "offline" | "delete"; id: string }
  | { entity: "novel"; action: "reject"; id: string; meta: NovelMeta }
  | { entity: "novel"; action: "rollback"; id: string; version: number };

type ChapterCommand =
  | { entity: "chapter"; action: "create"; meta: ChapterMeta }
  | { entity: "chapter"; action: "duplicate"; id?: string }
  | { entity: "chapter"; action: "save" | "submit" | "publish"; id: string; story: StoryDocument; meta?: ChapterMeta }
  | { entity: "chapter"; action: "withdraw" | "offline" | "delete"; id: string }
  | { entity: "chapter"; action: "reject"; id: string; meta: ChapterMeta }
  | { entity: "chapter"; action: "rollback"; id: string; version: number };

export type CreationCommand = NovelCommand | ChapterCommand;

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

type ExistingCreationAction = Exclude<CreationCommand["action"], "create" | "duplicate">;
type CreationState = { ownerId: string | null; status: string; draftStatus: string };

const creationMessages = {
  novel: {
    forbidden: "不能修改其他作者的小说",
    locked: "审核中的小说资料已锁定，请先撤回",
    submitted: "小说资料已在审核中",
    notSubmitted: "小说资料当前不在审核中",
    notReviewing: "小说当前不在审核中",
    authorDelete: "只能删除未发布且未提交审核的小说",
    administratorDelete: "只能删除未发布的小说草稿",
    unsupported: "不支持的小说操作",
  },
  chapter: {
    forbidden: "不能修改其他作者的章节",
    locked: "审核中的草稿已锁定，请先撤回",
    submitted: "章节已在审核中",
    notSubmitted: "章节当前不在审核中",
    notReviewing: "章节当前不在审核中",
    authorDelete: "只能删除未发布且未提交审核的草稿",
    administratorDelete: "只能删除未发布的草稿",
    unsupported: "不支持的章节操作",
  },
} as const;

function enforceCreationPolicy(
  actor: CreationActor,
  entity: "novel" | "chapter",
  action: ExistingCreationAction,
  current: CreationState,
  reviewNoteValue?: string,
) {
  const message = creationMessages[entity];
  if (actor.kind === "author" && current.ownerId !== actor.id) fail(message.forbidden, 403);
  const allowed = actor.kind === "author"
    ? ["save", "submit", "withdraw", "delete"]
    : ["save", "publish", "offline", "reject", "delete", "rollback"];
  if (!allowed.includes(action)) fail(message.unsupported);
  if (action === "save" && actor.kind === "author" && current.draftStatus === "submitted") fail(message.locked);
  if (action === "submit" && current.draftStatus === "submitted") fail(message.submitted);
  if (action === "withdraw" && current.draftStatus !== "submitted") fail(message.notSubmitted);
  if (action === "reject" && current.draftStatus !== "submitted") fail(message.notReviewing);
  if (action === "delete" && actor.kind === "author" && (current.status !== "draft" || current.draftStatus !== "draft")) {
    fail(message.authorDelete);
  }
  if (action === "delete" && actor.kind === "administrator" && current.status !== "draft") fail(message.administratorDelete);
  if (action === "reject") {
    const reviewNote = String(reviewNoteValue || "").trim();
    if (!reviewNote || reviewNote.length > 500) fail("请填写 1–500 字的驳回原因");
    return reviewNote;
  }
  return "";
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

async function publishNovelSnapshot(id: string, snapshot: string) {
  const db = getDb();
  await db.batch([
    db.insert(novelVersions).select(sql`SELECT NULL, ${id}, max(
        (SELECT version FROM novels WHERE id = ${id}),
        coalesce((SELECT max(version) FROM novel_versions WHERE novel_id = ${id}), 0)
      ) + 1, ${snapshot}, CURRENT_TIMESTAMP`),
    db.update(novels).set({
      status: "published", draftStatus: "draft", submittedAt: null, reviewNote: "",
      draftJson: snapshot, publishedJson: snapshot,
      version: sql`(SELECT max(version) FROM novel_versions WHERE novel_id = ${id})`,
      updatedAt: new Date().toISOString(),
    }).where(eq(novels.id, id)),
  ]);
}

async function publishChapterSnapshot(id: string, story: StoryDocument) {
  const db = getDb();
  const snapshot = JSON.stringify(story);
  await db.batch([
    db.insert(chapterVersions).select(sql`SELECT NULL, ${id}, max(
        (SELECT version FROM chapters WHERE id = ${id}),
        coalesce((SELECT max(version) FROM chapter_versions WHERE chapter_id = ${id}), 0)
      ) + 1, ${snapshot}, CURRENT_TIMESTAMP`),
    db.update(chapters).set({
      title: story.title, summary: story.summary, coverUrl: story.openingImageUrl,
      status: "published", draftStatus: "draft", submittedAt: null, reviewNote: "",
      draftJson: snapshot, publishedJson: snapshot,
      version: sql`(SELECT max(version) FROM chapter_versions WHERE chapter_id = ${id})`,
      updatedAt: new Date().toISOString(),
    }).where(eq(chapters.id, id)),
  ]);
}

async function assertPublishedParent(novelId: string) {
  const parent = (await getDb().select({ status: novels.status }).from(novels).where(eq(novels.id, novelId)).limit(1))[0];
  if (!parent || parent.status !== "published") fail("请先发布所属小说资料，再发布章节");
}

async function executeNovel(actor: CreationActor, command: NovelCommand): Promise<CreationResult> {
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
  const reviewNote = enforceCreationPolicy(actor, "novel", command.action, current, command.action === "reject" ? command.meta.reviewNote : undefined);

  if (command.action === "save" && command.novel) {
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
    const novel = normalizeNovel(command.novel);
    const errors = [...validateNovel(novel), ...validateNovelAssetReferences(novel, await availableAssets(actor))];
    if (errors.length) fail("提交审核校验失败", 400, errors);
    await db.update(novels).set({
      draftJson: JSON.stringify(novel), draftStatus: "submitted", submittedAt: new Date().toISOString(),
      reviewNote: "", updatedAt: new Date().toISOString(),
    }).where(eq(novels.id, current.id));
  } else if (actor.kind === "author" && command.action === "withdraw") {
    await db.update(novels).set({ draftStatus: "draft", submittedAt: null, updatedAt: new Date().toISOString() })
      .where(eq(novels.id, current.id));
  } else if (actor.kind === "administrator" && command.action === "publish" && command.novel) {
    const novel = normalizeNovel(command.novel);
    const errors = [...validateNovel(novel), ...validateNovelAssetReferences(novel, await availableAssets(actor))];
    if (errors.length) fail("发布校验失败", 400, errors);
    await publishNovelSnapshot(current.id, JSON.stringify(novel));
  } else if (actor.kind === "administrator" && command.action === "offline") {
    await db.update(novels).set({ status: "offline", updatedAt: new Date().toISOString() }).where(eq(novels.id, current.id));
  } else if (actor.kind === "administrator" && command.action === "reject") {
    await db.update(novels).set({ draftStatus: "draft", submittedAt: null, reviewNote, updatedAt: new Date().toISOString() })
      .where(eq(novels.id, current.id));
  } else if (command.action === "delete") {
    const linked = await db.select({ id: chapters.id }).from(chapters).where(eq(chapters.novelId, current.id)).limit(1);
    if (linked[0]) fail("请先删除该小说下的草稿章节");
    await db.delete(novels).where(eq(novels.id, current.id));
  } else if (actor.kind === "administrator" && command.action === "rollback" && command.version) {
    const versions = await db.select().from(novelVersions).where(and(
      eq(novelVersions.novelId, current.id), eq(novelVersions.version, command.version),
    )).limit(1);
    if (!versions[0]) fail("版本不存在", 404);
    const snapshot = JSON.stringify(normalizeNovel(JSON.parse(versions[0].snapshotJson)));
    await publishNovelSnapshot(current.id, snapshot);
  } else {
    fail("不支持的小说操作");
  }
  return { kind: "ok" };
}

async function executeChapter(actor: CreationActor, command: ChapterCommand): Promise<CreationResult> {
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
  const reviewNote = enforceCreationPolicy(actor, "chapter", command.action, current, command.action === "reject" ? command.meta.reviewNote : undefined);
  let updatedAt: string | undefined;

  if (command.action === "save" && command.story) {
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
    const story = normalizeStory(command.story);
    const errors = [...validateStory(story), ...validateStoryMedia(story), ...validateStoryAssetReferences(story, await availableAssets(actor))];
    if (errors.length) fail("提交审核校验失败", 400, errors);
    await db.update(chapters).set({
      title: story.title, summary: story.summary, coverUrl: story.openingImageUrl,
      draftJson: JSON.stringify(story), draftStatus: "submitted", submittedAt: new Date().toISOString(),
      reviewNote: "", updatedAt: new Date().toISOString(),
    }).where(eq(chapters.id, current.id));
  } else if (actor.kind === "author" && command.action === "withdraw") {
    await db.update(chapters).set({ draftStatus: "draft", submittedAt: null, updatedAt: new Date().toISOString() })
      .where(eq(chapters.id, current.id));
  } else if (actor.kind === "administrator" && command.action === "publish" && command.story) {
    await assertPublishedParent(current.novelId);
    const story = normalizeStory(command.story);
    const errors = [...validateStory(story), ...validateStoryMedia(story), ...validateStoryAssetReferences(story, await availableAssets(actor))];
    if (errors.length) fail("发布校验失败", 400, errors);
    await publishChapterSnapshot(current.id, story);
  } else if (actor.kind === "administrator" && command.action === "offline") {
    await db.update(chapters).set({ status: "offline", updatedAt: new Date().toISOString() }).where(eq(chapters.id, current.id));
  } else if (actor.kind === "administrator" && command.action === "reject") {
    await db.update(chapters).set({ draftStatus: "draft", submittedAt: null, reviewNote, updatedAt: new Date().toISOString() })
      .where(eq(chapters.id, current.id));
  } else if (command.action === "delete") {
    await db.delete(chapters).where(eq(chapters.id, current.id));
  } else if (actor.kind === "administrator" && command.action === "rollback" && command.version) {
    await assertPublishedParent(current.novelId);
    const versionRows = await db.select().from(chapterVersions).where(and(
      eq(chapterVersions.chapterId, current.id), eq(chapterVersions.version, command.version),
    )).limit(1);
    if (!versionRows[0]) fail("版本不存在", 404);
    const story = normalizeStory(JSON.parse(versionRows[0].snapshotJson));
    await publishChapterSnapshot(current.id, story);
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
