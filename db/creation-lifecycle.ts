import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { getDb } from ".";
import { ensureSeed, rowToChapter } from "./chapters";
import { rowToNovel } from "./novels";
import { assets, chapters, chapterVersions, novels, novelVersions } from "./schema";
import { validateNovelAssetReferences, validateStoryAssetReferences } from "../lib/assets";
import {
  createBlankNovel,
  createBlankStory,
  countStoryBodyCharacters,
  normalizeNovel,
  normalizeStory,
  validateNovel,
  validateStory,
  validateStoryBodyLengths,
  validateStoryInputLengths,
  validateStoryMedia,
  SHORT_STORY_MAX_LENGTH,
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
  | { entity: "novel"; action: "convert"; id: string; format: "serial" | "short" }
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

type ShortCommand =
  | { entity: "short"; action: "create" }
  | { entity: "short"; action: "save" | "submit" | "publish"; id: string; novel: NovelDocument; story: StoryDocument; meta?: NovelMeta }
  | { entity: "short"; action: "withdraw" | "offline" | "delete"; id: string }
  | { entity: "short"; action: "reject"; id: string; meta: NovelMeta }
  | { entity: "short"; action: "rollback"; id: string; version: number };

export type CreationCommand = NovelCommand | ChapterCommand | ShortCommand;

export type CreationResult =
  | { kind: "created"; id: string; chapterId?: string }
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

type ExistingCreationAction = Exclude<NovelCommand["action"] | ChapterCommand["action"], "create" | "duplicate">;
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

type FormatConversionState = {
  format: string;
  formatLockedAt: string | null;
  version: number;
  status: string;
  draftStatus: string;
};

type ChapterConversionState = Pick<FormatConversionState, "version" | "status" | "draftStatus">;

function availableFormatConversion(current: FormatConversionState, linked: ChapterConversionState[]) {
  if (current.formatLockedAt || current.version > 0 || current.status !== "draft" || current.draftStatus !== "draft") return null;
  if (current.format === "short") return "serial" as const;
  if (linked.length > 1 || linked.some((chapter) => (
    chapter.draftStatus !== "draft" || chapter.status !== "draft" || chapter.version > 0
  ))) return null;
  return "short" as const;
}

async function list(actor: CreationActor, entity: "novel"): Promise<NovelRecord[]>;
async function list(actor: CreationActor, entity: "chapter"): Promise<ChapterRecord[]>;
async function list(actor: CreationActor, entity: "novel" | "chapter") {
  await ensureSeed();
  const db = getDb();
  if (entity === "novel") {
    const rows = actor.kind === "author"
      ? await db.select().from(novels).where(eq(novels.ownerId, actor.id)).orderBy(asc(novels.sortOrder), desc(novels.updatedAt))
      : await db.select().from(novels).orderBy(asc(novels.sortOrder), desc(novels.updatedAt));
    return Promise.all(rows.map(async (row) => {
      const linked = await db.select({
        draftStatus: chapters.draftStatus, status: chapters.status, version: chapters.version,
      }).from(chapters).where(eq(chapters.novelId, row.id));
      return { ...rowToNovel(row), convertibleTo: availableFormatConversion(row, linked) };
    }));
  }
  const rows = actor.kind === "author"
    ? await db.select().from(chapters).where(eq(chapters.ownerId, actor.id)).orderBy(asc(chapters.sortOrder), desc(chapters.updatedAt))
    : await db.select().from(chapters).orderBy(asc(chapters.sortOrder), desc(chapters.updatedAt));
  const parentIds = [...new Set(rows.map((row) => row.novelId))];
  const shortParents = new Set<string>();
  for (const id of parentIds) {
    const parent = (await db.select({ format: novels.format }).from(novels).where(eq(novels.id, id)).limit(1))[0];
    if (parent?.format === "short") shortParents.add(id);
  }
  return rows.filter((row) => !shortParents.has(row.novelId)).map(rowToChapter);
}

async function listShorts(actor: CreationActor) {
  await ensureSeed();
  const db = getDb();
  const novelRows = actor.kind === "author"
    ? await db.select().from(novels).where(and(eq(novels.ownerId, actor.id), eq(novels.format, "short")))
    : await db.select().from(novels).where(eq(novels.format, "short"));
  const result: Array<{ novel: NovelRecord; chapter: ChapterRecord }> = [];
  for (const row of novelRows) {
    const bodyRows = await db.select().from(chapters).where(eq(chapters.novelId, row.id));
    if (bodyRows.length === 1) result.push({ novel: rowToNovel(row), chapter: rowToChapter(bodyRows[0]) });
  }
  return result;
}

async function listPublicNovels(slug?: string | null) {
  await ensureSeed();
  const db = getDb();
  const novelRows = slug
    ? await db.select().from(novels).where(and(eq(novels.slug, slug), eq(novels.status, "published"))).limit(1)
    : await db.select().from(novels).where(eq(novels.status, "published")).orderBy(asc(novels.sortOrder));
  const result = [];
  for (const row of novelRows) {
    const chapterRows = await db.select().from(chapters)
      .where(and(eq(chapters.novelId, row.id), eq(chapters.status, "published")))
      .orderBy(asc(chapters.sortOrder));
    if (chapterRows.length === 0) continue;
    const novel = rowToNovel(row);
    const publicChapters = chapterRows.map(rowToChapter);
    const stories = publicChapters.flatMap((chapter) => chapter.published ? [chapter.published] : []);
    result.push({
      id: novel.id, slug: novel.slug, sortOrder: novel.sortOrder, status: novel.status,
      version: novel.version, format: novel.format,
      wordCount: stories.reduce((total, story) => total + countStoryBodyCharacters(story), 0),
      interactive: stories.some((story) => story.nodes.length > 1 || story.nodes.some((node) => node.choices.length > 0)),
      published: novel.published,
      chapters: publicChapters.map((chapter) => ({
        id: chapter.id, novelId: chapter.novelId, slug: chapter.slug, title: chapter.title,
        summary: chapter.summary, sortOrder: chapter.sortOrder, version: chapter.version,
        published: chapter.published, updatedAt: chapter.updatedAt,
      })),
      updatedAt: novel.updatedAt,
    });
  }
  return result;
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
      formatLockedAt: sql`coalesce(format_locked_at, CURRENT_TIMESTAMP)`,
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

function syncShortDocuments(novelInput: NovelDocument, storyInput: StoryDocument, previousNovelInput?: NovelDocument) {
  const openingInheritanceWasExplicit = Object.hasOwn(storyInput, "openingUsesNovelCover");
  const outroInheritanceWasExplicit = Object.hasOwn(storyInput, "outroUsesNovelCover");
  const novel = normalizeNovel(novelInput);
  const story = normalizeStory(storyInput);
  const previousNovel = previousNovelInput ? normalizeNovel(previousNovelInput) : null;
  story.title = novel.name;
  story.summary = novel.summary;
  const openingWasPreviousCover = Boolean(previousNovel)
    && story.openingImageAssetId === previousNovel!.coverAssetId
    && story.openingImageUrl === previousNovel!.coverUrl;
  if (story.openingUsesNovelCover || (!openingInheritanceWasExplicit && openingWasPreviousCover) || (!story.openingImageAssetId && !story.openingImageUrl)) {
    story.openingImageAssetId = novel.coverAssetId;
    story.openingImageUrl = novel.coverUrl;
    story.openingImageAlt = novel.coverAlt;
    story.openingImagePresentation = { ...novel.coverPresentation };
    story.coverAssetId = novel.coverAssetId;
    story.coverUrl = novel.coverUrl;
    story.coverAlt = novel.coverAlt;
    story.openingUsesNovelCover = true;
  }
  const outroWasPreviousCover = Boolean(previousNovel)
    && story.outroImageAssetId === previousNovel!.coverAssetId
    && story.outroImageUrl === previousNovel!.coverUrl;
  if (story.outroUsesNovelCover || (!outroInheritanceWasExplicit && outroWasPreviousCover) || (!story.outroImageAssetId && !story.outroImageUrl)) {
    story.outroImageAssetId = novel.coverAssetId;
    story.outroImageUrl = novel.coverUrl;
    story.outroImageAlt = novel.coverAlt;
    story.outroImagePresentation = { ...novel.coverPresentation };
    story.outroUsesNovelCover = true;
  }
  return { novel, story };
}

function validateShortStory(story: StoryDocument) {
  const errors = validateStory(story, { validateBodyLengths: false });
  const wordCount = countStoryBodyCharacters(story);
  if (wordCount > SHORT_STORY_MAX_LENGTH) {
    errors.push(`短篇正文为 ${wordCount} 字，超过 ${SHORT_STORY_MAX_LENGTH} 字上限`);
  }
  return errors;
}

async function publishShortSnapshot(
  novelId: string,
  chapterId: string,
  novel: NovelDocument,
  story: StoryDocument,
) {
  const db = getDb();
  const novelSnapshot = JSON.stringify(novel);
  const storySnapshot = JSON.stringify(story);
  const updatedAt = new Date().toISOString();
  await db.batch([
    db.insert(novelVersions).select(sql`SELECT NULL, ${novelId}, max(
        (SELECT version FROM novels WHERE id = ${novelId}),
        coalesce((SELECT max(version) FROM novel_versions WHERE novel_id = ${novelId}), 0)
      ) + 1, ${novelSnapshot}, CURRENT_TIMESTAMP`),
    db.insert(chapterVersions).select(sql`SELECT NULL, ${chapterId}, max(
        (SELECT version FROM chapters WHERE id = ${chapterId}),
        coalesce((SELECT max(version) FROM chapter_versions WHERE chapter_id = ${chapterId}), 0)
      ) + 1, ${storySnapshot}, CURRENT_TIMESTAMP`),
    db.update(novels).set({
      status: "published", draftStatus: "draft", submittedAt: null, reviewNote: "",
      formatLockedAt: sql`coalesce(format_locked_at, CURRENT_TIMESTAMP)`,
      draftJson: novelSnapshot, publishedJson: novelSnapshot,
      version: sql`(SELECT max(version) FROM novel_versions WHERE novel_id = ${novelId})`,
      updatedAt,
    }).where(eq(novels.id, novelId)),
    db.update(chapters).set({
      title: story.title, summary: story.summary, coverUrl: story.openingImageUrl,
      status: "published", draftStatus: "draft", submittedAt: null, reviewNote: "",
      draftJson: storySnapshot, publishedJson: storySnapshot,
      version: sql`(SELECT max(version) FROM chapter_versions WHERE chapter_id = ${chapterId})`,
      updatedAt,
    }).where(eq(chapters.id, chapterId)),
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
      if (source[0]?.format === "short") fail("请通过短篇整体操作复制短篇", 409);
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
  if (command.action === "convert") {
    if (command.format !== "serial" && command.format !== "short") fail("作品形态无效");
    if (actor.kind === "author" && current.ownerId !== actor.id) fail("不能修改其他作者的小说", 403);
    if (current.format === command.format) return { kind: "ok" };
    const linked = await db.select().from(chapters).where(eq(chapters.novelId, current.id));
    if (availableFormatConversion(current, linked) !== command.format) fail("作品当前不可转换为该形态", 409);
    if (command.format === "short" && linked.length === 0) {
      const chapterId = crypto.randomUUID();
      const story = createBlankStory();
      const novel = normalizeNovel(JSON.parse(current.draftJson));
      story.title = novel.name;
      story.summary = novel.summary;
      story.nodes[0].canEndChapter = true;
      const now = Date.now();
      await db.batch([
        db.update(novels).set({ format: "short", updatedAt: new Date().toISOString() }).where(eq(novels.id, current.id)),
        db.insert(chapters).values({
          id: chapterId, novelId: current.id,
          slug: `short-body-${now.toString(36)}-${chapterId.slice(0, 6)}`,
          title: story.title, summary: story.summary, coverUrl: story.openingImageUrl,
          ownerId: current.ownerId, draftStatus: "draft", sortOrder: now, status: "draft",
          draftJson: JSON.stringify(story),
        }),
      ]);
    } else {
      await db.update(novels).set({ format: command.format, updatedAt: new Date().toISOString() }).where(eq(novels.id, current.id));
    }
    return { kind: "ok" };
  }
  if (current.format === "short") fail("短篇必须通过整体生命周期操作", 409);
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
      formatLockedAt: sql`coalesce(format_locked_at, CURRENT_TIMESTAMP)`,
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
    const parent = await db.select({ ownerId: novels.ownerId, format: novels.format }).from(novels).where(eq(novels.id, novelId)).limit(1);
    if (!parent[0] || (actor.kind === "author" && parent[0].ownerId !== actor.id)) {
      fail(actor.kind === "author" ? "所属小说不存在" : "所属小说不存在", 404);
    }
    if (parent[0].format === "short") fail("短篇只能保留唯一内部章节", 409);
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
  const parent = (await db.select({ format: novels.format }).from(novels).where(eq(novels.id, current.novelId)).limit(1))[0];
  if (parent?.format === "short") fail("短篇正文必须通过短篇整体生命周期操作", 409);
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
    const updatedAt = new Date().toISOString();
    await db.batch([
      db.update(chapters).set({
        title: story.title, summary: story.summary, coverUrl: story.openingImageUrl,
        draftJson: JSON.stringify(story), draftStatus: "submitted", submittedAt: updatedAt,
        reviewNote: "", updatedAt,
      }).where(eq(chapters.id, current.id)),
      db.update(novels).set({
        formatLockedAt: sql`coalesce(format_locked_at, CURRENT_TIMESTAMP)`, updatedAt,
      }).where(eq(novels.id, current.novelId)),
    ]);
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

async function executeShort(actor: CreationActor, command: ShortCommand): Promise<CreationResult> {
  const db = getDb();
  if (command.action === "create") {
    const id = crypto.randomUUID();
    const chapterId = crypto.randomUUID();
    const now = Date.now();
    const novel = createBlankNovel();
    novel.name = "未命名短篇";
    const story = createBlankStory();
    story.title = novel.name;
    story.nodes[0].canEndChapter = true;
    story.openingUsesNovelCover = true;
    story.outroUsesNovelCover = true;
    await db.batch([
      db.insert(novels).values({
        id,
        slug: `short-${now.toString(36)}-${id.slice(0, 6)}`,
        ownerId: ownerIdFor(actor),
        format: "short",
        sortOrder: now,
        draftJson: JSON.stringify(novel),
      }),
      db.insert(chapters).values({
        id: chapterId,
        novelId: id,
        slug: `short-body-${now.toString(36)}-${chapterId.slice(0, 6)}`,
        title: story.title,
        summary: story.summary,
        coverUrl: story.openingImageUrl,
        ownerId: ownerIdFor(actor),
        draftStatus: "draft",
        sortOrder: now,
        status: "draft",
        draftJson: JSON.stringify(story),
      }),
    ]);
    return { kind: "created", id, chapterId };
  }

  const current = (await db.select().from(novels).where(eq(novels.id, command.id)).limit(1))[0];
  if (!current || current.format !== "short") fail("短篇不存在", 404);
  const bodyRows = await db.select().from(chapters).where(eq(chapters.novelId, current.id));
  if (bodyRows.length !== 1) fail("短篇正文结构异常，请联系管理员", 409);
  const body = bodyRows[0];
  if (actor.kind === "author" && (current.ownerId !== actor.id || body.ownerId !== actor.id)) fail("不能修改其他作者的短篇", 403);
  const reviewNote = enforceCreationPolicy(actor, "novel", command.action, current, command.action === "reject" ? command.meta.reviewNote : undefined);
  enforceCreationPolicy(actor, "chapter", command.action, body, command.action === "reject" ? command.meta.reviewNote : undefined);
  const updatedAt = new Date().toISOString();

  if (command.action === "save") {
    const { novel, story } = syncShortDocuments(command.novel, command.story, JSON.parse(current.draftJson));
    const errors = validateStoryInputLengths(story);
    if (errors.length) fail("草稿字数校验失败", 400, errors);
    await db.batch([
      db.update(novels).set({
        slug: String(command.meta?.slug || current.slug).slice(0, 100),
        sortOrder: command.meta?.sortOrder ?? current.sortOrder,
        draftJson: JSON.stringify(novel),
        ...(actor.kind === "administrator" ? { draftStatus: "draft" as const, submittedAt: null } : {}),
        reviewNote: "", updatedAt,
      }).where(eq(novels.id, current.id)),
      db.update(chapters).set({
        title: story.title, summary: story.summary, coverUrl: story.openingImageUrl,
        draftJson: JSON.stringify(story),
        ...(actor.kind === "administrator" ? { draftStatus: "draft" as const, submittedAt: null } : {}),
        reviewNote: "", updatedAt,
      }).where(eq(chapters.id, body.id)),
    ]);
  } else if (actor.kind === "author" && command.action === "submit") {
    const { novel, story } = syncShortDocuments(command.novel, command.story, JSON.parse(current.draftJson));
    const available = await availableAssets(actor);
    const errors = [
      ...validateNovel(novel), ...validateNovelAssetReferences(novel, available),
      ...validateShortStory(story), ...validateStoryMedia(story), ...validateStoryAssetReferences(story, available),
    ];
    if (errors.length) fail("提交审核校验失败", 400, [...new Set(errors)]);
    await db.batch([
      db.update(novels).set({
        draftJson: JSON.stringify(novel), draftStatus: "submitted", submittedAt: updatedAt,
        formatLockedAt: sql`coalesce(format_locked_at, CURRENT_TIMESTAMP)`, reviewNote: "", updatedAt,
      }).where(eq(novels.id, current.id)),
      db.update(chapters).set({
        title: story.title, summary: story.summary, coverUrl: story.openingImageUrl,
        draftJson: JSON.stringify(story), draftStatus: "submitted", submittedAt: updatedAt,
        reviewNote: "", updatedAt,
      }).where(eq(chapters.id, body.id)),
    ]);
  } else if (actor.kind === "author" && command.action === "withdraw") {
    await db.batch([
      db.update(novels).set({ draftStatus: "draft", submittedAt: null, updatedAt }).where(eq(novels.id, current.id)),
      db.update(chapters).set({ draftStatus: "draft", submittedAt: null, updatedAt }).where(eq(chapters.id, body.id)),
    ]);
  } else if (actor.kind === "administrator" && command.action === "publish") {
    const { novel, story } = syncShortDocuments(command.novel, command.story, JSON.parse(current.draftJson));
    const available = await availableAssets(actor);
    const errors = [
      ...validateNovel(novel), ...validateNovelAssetReferences(novel, available),
      ...validateShortStory(story), ...validateStoryMedia(story), ...validateStoryAssetReferences(story, available),
    ];
    if (errors.length) fail("发布校验失败", 400, [...new Set(errors)]);
    await publishShortSnapshot(current.id, body.id, novel, story);
  } else if (actor.kind === "administrator" && command.action === "offline") {
    await db.batch([
      db.update(novels).set({ status: "offline", updatedAt }).where(eq(novels.id, current.id)),
      db.update(chapters).set({ status: "offline", updatedAt }).where(eq(chapters.id, body.id)),
    ]);
  } else if (actor.kind === "administrator" && command.action === "reject") {
    await db.batch([
      db.update(novels).set({ draftStatus: "draft", submittedAt: null, reviewNote, updatedAt }).where(eq(novels.id, current.id)),
      db.update(chapters).set({ draftStatus: "draft", submittedAt: null, reviewNote, updatedAt }).where(eq(chapters.id, body.id)),
    ]);
  } else if (command.action === "delete") {
    await db.batch([
      db.delete(chapters).where(eq(chapters.id, body.id)),
      db.delete(novels).where(eq(novels.id, current.id)),
    ]);
  } else if (actor.kind === "administrator" && command.action === "rollback") {
    const [novelVersionRows, chapterVersionRows] = await Promise.all([
      db.select().from(novelVersions).where(and(eq(novelVersions.novelId, current.id), eq(novelVersions.version, command.version))).limit(1),
      db.select().from(chapterVersions).where(and(eq(chapterVersions.chapterId, body.id), eq(chapterVersions.version, command.version))).limit(1),
    ]);
    if (!novelVersionRows[0] || !chapterVersionRows[0]) fail("短篇版本不存在", 404);
    await publishShortSnapshot(
      current.id,
      body.id,
      normalizeNovel(JSON.parse(novelVersionRows[0].snapshotJson)),
      normalizeStory(JSON.parse(chapterVersionRows[0].snapshotJson)),
    );
  } else {
    fail("不支持的短篇操作");
  }
  return { kind: "ok", ...(command.action === "save" ? { updatedAt } : {}) };
}

async function execute(actor: CreationActor, command: CreationCommand) {
  await ensureSeed();
  if (command.entity === "novel") return executeNovel(actor, command);
  if (command.entity === "chapter") return executeChapter(actor, command);
  return executeShort(actor, command);
}

export const creationLifecycle = { list, listShorts, listPublicNovels, listVersions, execute };
