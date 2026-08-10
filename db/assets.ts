import { and, asc, desc, eq, isNull, or } from "drizzle-orm";
import { getDb } from ".";
import { assetFolders, assets, chapters, chapterVersions, novels, novelVersions } from "./schema";
import { enforceRateLimit } from "./rate-limit";
import {
  assetStorageKey,
  novelReferencesAsset,
  storyReferencesAsset,
  type AssetReference,
  type AssetType,
} from "../lib/assets";
import { normalizeSfxGenerationDuration, normalizeSfxPrompt, type SoundEffectProvider } from "../lib/sfx";
import { INTERACTION_PRESETS, normalizeNovel, normalizeStory, type InteractionPreset } from "../lib/story";
import type { TerminalSpeechProvider } from "../lib/tts";

export type AssetActor =
  | { kind: "administrator" }
  | { kind: "author"; id: string };

export type AssetCommand =
  | { action: "upload"; bucket: R2Bucket; file: File; duration: number; folderId: string | null; alt: string }
  | { action: "create-folder"; name?: string }
  | { action: "rename-folder"; id?: string; name?: string }
  | { action: "delete-folder"; id?: string }
  | { action: "update-asset"; id?: string; name?: string; folderId?: string | null }
  | { action: "delete"; id?: string; bucket: R2Bucket }
  | {
    action: "generate-sfx"; bucket: R2Bucket; provider: SoundEffectProvider; choiceText: string;
    rateLimit: { request: Request; identity: string };
    preset: string; prompt: string; generationDurationSeconds: number;
  }
  | {
    action: "generate-tts"; bucket: R2Bucket; provider: TerminalSpeechProvider;
    rateLimit: { request: Request; identity: string };
    text: string; voiceId: string; voiceName: string;
  };

export type AssetLifecycleResult =
  | { kind: "asset"; asset: Record<string, unknown>; sourceKey?: string }
  | { kind: "folder"; folder: { id: string; name: string } }
  | { kind: "ok" };

export class AssetLifecycleError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly references?: AssetReference[],
  ) {
    super(message);
  }
}

function fail(message: string, status = 400, references?: AssetReference[]): never {
  throw new AssetLifecycleError(message, status, references);
}

function ownerIdFor(actor: AssetActor) {
  return actor.kind === "author" ? actor.id : null;
}

function ownerWhere(actor: AssetActor, column: typeof assets.ownerId | typeof assetFolders.ownerId) {
  return actor.kind === "author" ? eq(column, actor.id) : isNull(column);
}

async function list(actor: AssetActor) {
  const db = getDb();
  if (actor.kind === "administrator") {
    const [assetRows, folders] = await Promise.all([
      db.select().from(assets).where(isNull(assets.ownerId)).orderBy(desc(assets.updatedAt)),
      db.select().from(assetFolders).where(isNull(assetFolders.ownerId)).orderBy(asc(assetFolders.name)),
    ]);
    return { assets: assetRows, folders };
  }
  const [assetRows, folders] = await Promise.all([
    db.select().from(assets).where(or(isNull(assets.ownerId), eq(assets.ownerId, actor.id))).orderBy(desc(assets.updatedAt)),
    db.select().from(assetFolders).where(eq(assetFolders.ownerId, actor.id)).orderBy(asc(assetFolders.name)),
  ]);
  return {
    assets: assetRows.map((asset) => ({ ...asset, canManage: asset.ownerId === actor.id })),
    folders,
  };
}

async function assertFolder(actor: AssetActor, folderId: string, message: string) {
  const rows = await getDb().select({ id: assetFolders.id }).from(assetFolders)
    .where(and(eq(assetFolders.id, folderId), ownerWhere(actor, assetFolders.ownerId))).limit(1);
  if (!rows[0]) fail(message, 404);
}

async function assertAsset(actor: AssetActor, id: string, forbiddenMessage: string) {
  const row = (await getDb().select().from(assets).where(eq(assets.id, id)).limit(1))[0];
  if (!row) fail("素材不存在", 404);
  if (row.ownerId !== ownerIdFor(actor)) fail(forbiddenMessage, 403);
  return row;
}

function fileType(file: File): AssetType | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type === "video/mp4" || file.type === "video/webm") return "video";
  return null;
}

async function upload(actor: AssetActor, command: Extract<AssetCommand, { action: "upload" }>): Promise<AssetLifecycleResult> {
  const type = fileType(command.file);
  if (!type) fail("仅支持图片、音频、MP4 和 WebM");
  const maximum = type === "image" ? 8 * 1024 * 1024 : type === "audio" ? 20 * 1024 * 1024 : 50 * 1024 * 1024;
  if (command.file.size > maximum) fail(`${type === "image" ? "图片" : type === "audio" ? "音频" : "视频"}文件过大`);
  const duration = Math.max(0, Number(command.duration) || 0);
  if (type === "video" && duration > 60) fail("视频不能超过 60 秒");
  if (command.folderId) await assertFolder(actor, command.folderId, actor.kind === "author" ? "素材文件夹不存在" : "文件夹不存在");
  const id = crypto.randomUUID();
  const storageKey = `${type}/${id}-${command.file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
  const row = {
    id, name: command.file.name.slice(0, 200), type, url: `/api/assets/${id}`, storageKey,
    folderId: command.folderId, ownerId: ownerIdFor(actor), mimeType: command.file.type,
    size: command.file.size, duration: Math.round(duration), alt: command.alt.slice(0, 500), status: "deleting" as const,
  };
  await getDb().insert(assets).values(row);
  try {
    await command.bucket.put(storageKey, command.file.stream(), { httpMetadata: { contentType: command.file.type } });
    await getDb().update(assets).set({ status: "ready", updatedAt: new Date().toISOString() }).where(eq(assets.id, id));
  } catch (error) {
    await getDb().update(assets).set({ status: "delete_failed", updatedAt: new Date().toISOString() }).where(eq(assets.id, id));
    throw error;
  }
  const now = new Date().toISOString();
  return { kind: "asset", asset: { ...row, status: "ready", createdAt: now, updatedAt: now } };
}

async function generatedFolder(ownerId: string | null, name: string) {
  const db = getDb();
  const rows = ownerId
    ? await db.select().from(assetFolders).where(and(eq(assetFolders.name, name), eq(assetFolders.ownerId, ownerId))).limit(1)
    : await db.select().from(assetFolders).where(and(eq(assetFolders.name, name), isNull(assetFolders.ownerId))).limit(1);
  return rows[0] ? { id: rows[0].id, created: false } : { id: crypto.randomUUID(), created: true };
}

async function storeGenerated(
  bucket: R2Bucket,
  values: { ownerId: string | null; folderName: string; prefix: string; name: string; bytes: Uint8Array; mimeType: string; extension: string; duration: number },
) {
  const folder = await generatedFolder(values.ownerId, values.folderName);
  const id = crypto.randomUUID();
  const storageKey = `audio/${values.prefix}/${values.ownerId || "global"}/${id}.${values.extension}`;
  const row = {
    id, name: values.name, type: "audio" as const, url: `/api/assets/${id}`, storageKey, folderId: folder.id,
    ownerId: values.ownerId, mimeType: values.mimeType, size: values.bytes.byteLength,
    duration: values.duration, alt: "", status: "deleting" as const,
  };
  const db = getDb();
  if (folder.created) {
    await db.batch([
      db.insert(assetFolders).values({ id: folder.id, name: values.folderName, ownerId: values.ownerId }),
      db.insert(assets).values(row),
    ]);
  } else {
    await db.insert(assets).values(row);
  }
  try {
    await bucket.put(storageKey, values.bytes, { httpMetadata: { contentType: values.mimeType } });
    await db.update(assets).set({ status: "ready", updatedAt: new Date().toISOString() }).where(eq(assets.id, id));
  } catch (error) {
    await db.update(assets).set({ status: "delete_failed", updatedAt: new Date().toISOString() }).where(eq(assets.id, id));
    throw error;
  }
  const now = new Date().toISOString();
  return { ...row, status: "ready", createdAt: now, updatedAt: now };
}

async function generateSfx(actor: AssetActor, command: Extract<AssetCommand, { action: "generate-sfx" }>): Promise<AssetLifecycleResult> {
  await enforceRateLimit(command.rateLimit.request, "sfx-generation-minute", command.rateLimit.identity, 5, 1);
  await enforceRateLimit(command.rateLimit.request, "sfx-generation-day", command.rateLimit.identity, 50, 1_440);
  const label = command.choiceText.trim().slice(0, 120);
  if (!label) fail("请先填写选项文字");
  if (!INTERACTION_PRESETS.includes(command.preset as InteractionPreset)) fail("不支持的互动动画");
  const generated = await command.provider.generate({
    prompt: normalizeSfxPrompt(command.prompt),
    generationDurationSeconds: normalizeSfxGenerationDuration(command.generationDurationSeconds),
    interactionPreset: command.preset as InteractionPreset,
  });
  const safeLabel = Array.from(label).slice(0, 18).join("").replace(/[\\/:*?"<>|]/g, "-");
  const asset = await storeGenerated(command.bucket, {
    ownerId: ownerIdFor(actor), folderName: "自动生成音效", prefix: "generated",
    name: `选项-${safeLabel}-${command.preset}.${generated.extension}`, bytes: generated.bytes,
    mimeType: generated.mimeType, extension: generated.extension, duration: Math.max(1, Math.ceil(generated.durationSeconds)),
  });
  return { kind: "asset", asset };
}

async function generateTts(actor: AssetActor, command: Extract<AssetCommand, { action: "generate-tts" }>): Promise<AssetLifecycleResult> {
  await enforceRateLimit(command.rateLimit.request, "tts-generation-minute", command.rateLimit.identity, 5, 1);
  await enforceRateLimit(command.rateLimit.request, "tts-generation-day", command.rateLimit.identity, 50, 1_440);
  const generated = await command.provider.generate({ voiceId: command.voiceId, text: command.text });
  const safeVoice = Array.from(command.voiceName.trim() || "AI音色").slice(0, 20).join("").replace(/[\\/:*?"<>|]/g, "-");
  const safeText = Array.from(command.text.trim()).slice(0, 16).join("").replace(/[\\/:*?"<>|]/g, "-");
  const asset = await storeGenerated(command.bucket, {
    ownerId: ownerIdFor(actor), folderName: "自动生成终端语音", prefix: "terminal",
    name: `终端-${safeVoice}-${safeText}.${generated.extension}`, bytes: generated.bytes,
    mimeType: generated.mimeType, extension: generated.extension, duration: 0,
  });
  return { kind: "asset", asset, sourceKey: generated.sourceKey };
}

async function referencesFor(asset: typeof assets.$inferSelect) {
  const db = getDb();
  const references: AssetReference[] = [];
  const novelRows = await db.select().from(novels);
  for (const row of novelRows) {
    for (const [version, json] of [["draft", row.draftJson], ["published", row.publishedJson]] as const) {
      if (!json) continue;
      const novel = normalizeNovel(JSON.parse(json));
      if (novelReferencesAsset(novel, asset)) references.push({ chapterId: row.id, chapterTitle: novel.name, version, nodeId: "novel", nodeTitle: "小说资料", field: "小说封面" });
    }
  }
  for (const version of await db.select().from(novelVersions)) {
    const novel = normalizeNovel(JSON.parse(version.snapshotJson));
    if (novelReferencesAsset(novel, asset)) references.push({ chapterId: version.novelId, chapterTitle: novel.name, version: `v${version.version}`, nodeId: "novel", nodeTitle: "小说资料", field: "小说封面" });
  }
  const chapterRows = await db.select().from(chapters);
  for (const row of chapterRows) {
    for (const [version, json] of [["draft", row.draftJson], ["published", row.publishedJson]] as const) {
      if (!json) continue;
      for (const ref of storyReferencesAsset(normalizeStory(JSON.parse(json)), asset)) references.push({ chapterId: row.id, chapterTitle: row.title, version, ...ref });
    }
  }
  for (const version of await db.select().from(chapterVersions)) {
    const chapter = chapterRows.find((item) => item.id === version.chapterId);
    for (const ref of storyReferencesAsset(normalizeStory(JSON.parse(version.snapshotJson)), asset)) references.push({ chapterId: version.chapterId, chapterTitle: chapter?.title || version.chapterId, version: `v${version.version}`, ...ref });
  }
  return references;
}

async function remove(actor: AssetActor, command: Extract<AssetCommand, { action: "delete" }>): Promise<AssetLifecycleResult> {
  if (!command.id) fail("缺少素材 ID");
  const asset = (await getDb().select().from(assets).where(eq(assets.id, command.id)).limit(1))[0];
  if (!asset) return { kind: "ok" };
  if (asset.ownerId !== ownerIdFor(actor)) fail(actor.kind === "author" ? "只能删除自己的素材" : "只能删除平台素材", 403);
  const references = await referencesFor(asset);
  if (references.length) fail("素材仍被章节引用", 409, references);
  const db = getDb();
  await db.update(assets).set({ status: "deleting", updatedAt: new Date().toISOString() }).where(eq(assets.id, asset.id));
  try {
    await command.bucket.delete(asset.storageKey || assetStorageKey(asset.url));
    await db.delete(assets).where(eq(assets.id, asset.id));
  } catch {
    await db.update(assets).set({ status: "delete_failed", updatedAt: new Date().toISOString() }).where(eq(assets.id, asset.id));
    fail("删除失败，可稍后重试", 500);
  }
  return { kind: "ok" };
}

async function mutate(actor: AssetActor, command: Exclude<AssetCommand, { action: "upload" | "delete" | "generate-sfx" | "generate-tts" }>): Promise<AssetLifecycleResult> {
  const db = getDb();
  if (command.action === "create-folder") {
    const name = command.name?.trim();
    if (!name || name.length > 80) fail("文件夹名称需要为 1–80 个字符");
    const id = crypto.randomUUID();
    await db.insert(assetFolders).values({ id, name, ownerId: ownerIdFor(actor) });
    return { kind: "folder", folder: { id, name } };
  }
  if (!command.id) fail("缺少资源 ID");
  if (command.action === "rename-folder" || command.action === "delete-folder") {
    await assertFolder(actor, command.id, "文件夹不存在");
    if (command.action === "rename-folder") {
      const name = command.name?.trim();
      if (!name || name.length > 80) fail(actor.kind === "administrator" ? "文件夹名称不能超过 80 个字符" : "文件夹名称需要为 1–80 个字符");
      await db.update(assetFolders).set({ name, updatedAt: new Date().toISOString() }).where(eq(assetFolders.id, command.id));
    } else {
      await db.batch([
        db.update(assets).set({ folderId: null, updatedAt: new Date().toISOString() })
          .where(and(eq(assets.folderId, command.id), ownerWhere(actor, assets.ownerId))),
        db.delete(assetFolders).where(eq(assetFolders.id, command.id)),
      ]);
    }
  } else if (command.action === "update-asset") {
    await assertAsset(actor, command.id, actor.kind === "author" ? "只能整理自己的素材" : "只能整理平台素材");
    if (command.folderId) await assertFolder(actor, command.folderId, "文件夹不存在");
    await db.update(assets).set({
      name: command.name?.trim().slice(0, 200) || undefined,
      folderId: command.folderId ?? null,
      updatedAt: new Date().toISOString(),
    }).where(eq(assets.id, command.id));
  } else fail("不支持的素材操作");
  return { kind: "ok" };
}

async function execute(actor: AssetActor, command: AssetCommand): Promise<AssetLifecycleResult> {
  if (command.action === "upload") return upload(actor, command);
  if (command.action === "delete") return remove(actor, command);
  if (command.action === "generate-sfx") return generateSfx(actor, command);
  if (command.action === "generate-tts") return generateTts(actor, command);
  return mutate(actor, command);
}

export const assetLifecycle = { list, execute };
