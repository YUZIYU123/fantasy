import { env } from "cloudflare:workers";
import { asc, desc, eq } from "drizzle-orm";
import { ensureSchema, getDb } from "../../../../db";
import { assets, assetFolders, chapters, chapterVersions, novels, novelVersions } from "../../../../db/schema";
import { adminAuthResponse, requireAdmin } from "../../../../lib/admin-auth";
import { assetStorageKey, novelReferencesAsset, storyReferencesAsset, type AssetReference, type AssetType } from "../../../../lib/assets";
import { normalizeNovel, normalizeStory } from "../../../../lib/story";

export async function GET(request: Request) {
  try { await requireAdmin(request); } catch (error) { return adminAuthResponse(error); }
  await ensureSchema();
  const db = getDb();
  const [assetRows, folders] = await Promise.all([
    db.select().from(assets).orderBy(desc(assets.updatedAt)),
    db.select().from(assetFolders).orderBy(asc(assetFolders.name)),
  ]);
  return Response.json({ assets: assetRows, folders });
}

export async function POST(request: Request) {
  try { await requireAdmin(request); } catch (error) { return adminAuthResponse(error); }
  await ensureSchema();
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "请选择文件" }, { status: 400 });
  const type: AssetType | null = file.type.startsWith("image/") ? "image" : file.type.startsWith("audio/") ? "audio" : file.type === "video/mp4" || file.type === "video/webm" ? "video" : null;
  if (!type) return Response.json({ error: "仅支持图片、音频、MP4 和 WebM" }, { status: 400 });
  const max = type === "image" ? 8 * 1024 * 1024 : type === "audio" ? 20 * 1024 * 1024 : 50 * 1024 * 1024;
  if (file.size > max) return Response.json({ error: `${type === "image" ? "图片" : type === "audio" ? "音频" : "视频"}文件过大` }, { status: 400 });
  const duration = Math.max(0, Number(form.get("duration")) || 0);
  if (type === "video" && duration > 60) return Response.json({ error: "视频不能超过 60 秒" }, { status: 400 });
  const id = crypto.randomUUID();
  const storageKey = `${type}/${id}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
  await env.ASSET_BUCKET.put(storageKey, file.stream(), { httpMetadata: { contentType: file.type } });
  const url = `/api/assets/${id}`;
  const row = { id, name: file.name.slice(0, 200), type, url, storageKey, folderId: String(form.get("folderId") || "") || null, ownerId: null, mimeType: file.type, size: file.size, duration: Math.round(duration), alt: String(form.get("alt") || "").slice(0, 500), status: "ready" as const };
  await getDb().insert(assets).values(row);
  return Response.json({ asset: { ...row, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }, { status: 201 });
}

export async function PATCH(request: Request) {
  try { await requireAdmin(request); } catch (error) { return adminAuthResponse(error); }
  await ensureSchema();
  const body = await request.json() as { action: string; id?: string; name?: string; folderId?: string | null };
  const db = getDb();
  if (body.action === "create-folder") {
    const name = body.name?.trim();
    if (!name || name.length > 80) return Response.json({ error: "文件夹名称需要为 1–80 个字符" }, { status: 400 });
    const id = crypto.randomUUID();
    await db.insert(assetFolders).values({ id, name });
    return Response.json({ folder: { id, name } }, { status: 201 });
  }
  if (body.action === "rename-folder" && body.id && body.name?.trim()) {
    if (body.name.trim().length > 80) return Response.json({ error: "文件夹名称不能超过 80 个字符" }, { status: 400 });
    await db.update(assetFolders).set({ name: body.name.trim(), updatedAt: new Date().toISOString() }).where(eq(assetFolders.id, body.id));
  } else if (body.action === "delete-folder" && body.id) {
    await db.update(assets).set({ folderId: null, updatedAt: new Date().toISOString() }).where(eq(assets.folderId, body.id));
    await db.delete(assetFolders).where(eq(assetFolders.id, body.id));
  } else if (body.action === "update-asset" && body.id) {
    await db.update(assets).set({ name: body.name?.trim().slice(0, 200) || undefined, folderId: body.folderId ?? null, updatedAt: new Date().toISOString() }).where(eq(assets.id, body.id));
  } else return Response.json({ error: "不支持的素材操作" }, { status: 400 });
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  try { await requireAdmin(request); } catch (error) { return adminAuthResponse(error); }
  await ensureSchema();
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "缺少素材 ID" }, { status: 400 });
  const db = getDb();
  const assetRows = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
  const asset = assetRows[0];
  if (!asset) return Response.json({ error: "素材不存在" }, { status: 404 });
  const references: AssetReference[] = [];
  const novelRows = await db.select().from(novels);
  for (const novelRow of novelRows) {
    for (const [version, json] of [["draft", novelRow.draftJson], ["published", novelRow.publishedJson]] as const) {
      if (!json) continue;
      const novel = normalizeNovel(JSON.parse(json));
      if (novelReferencesAsset(novel, asset)) references.push({ chapterId: novelRow.id, chapterTitle: novel.name, version, nodeId: "novel", nodeTitle: "小说资料", field: "小说封面" });
    }
  }
  const novelVersionRows = await db.select().from(novelVersions);
  for (const version of novelVersionRows) {
    const novel = normalizeNovel(JSON.parse(version.snapshotJson));
    if (novelReferencesAsset(novel, asset)) references.push({ chapterId: version.novelId, chapterTitle: novel.name, version: `v${version.version}`, nodeId: "novel", nodeTitle: "小说资料", field: "小说封面" });
  }
  const chapterRows = await db.select().from(chapters);
  for (const chapter of chapterRows) {
    for (const [version, json] of [["draft", chapter.draftJson], ["published", chapter.publishedJson]] as const) {
      if (!json) continue;
      for (const ref of storyReferencesAsset(normalizeStory(JSON.parse(json)), asset)) references.push({ chapterId: chapter.id, chapterTitle: chapter.title, version, ...ref });
    }
  }
  const versionRows = await db.select().from(chapterVersions);
  for (const version of versionRows) {
    const chapter = chapterRows.find((item) => item.id === version.chapterId);
    for (const ref of storyReferencesAsset(normalizeStory(JSON.parse(version.snapshotJson)), asset)) references.push({ chapterId: version.chapterId, chapterTitle: chapter?.title || version.chapterId, version: `v${version.version}`, ...ref });
  }
  if (references.length) return Response.json({ error: "素材仍被章节引用", references }, { status: 409 });
  await db.update(assets).set({ status: "deleting", updatedAt: new Date().toISOString() }).where(eq(assets.id, id));
  try {
    await env.ASSET_BUCKET.delete(asset.storageKey || assetStorageKey(asset.url));
    await db.delete(assets).where(eq(assets.id, id));
    return Response.json({ ok: true });
  } catch {
    await db.update(assets).set({ status: "delete_failed", updatedAt: new Date().toISOString() }).where(eq(assets.id, id));
    return Response.json({ error: "删除失败，可稍后重试" }, { status: 500 });
  }
}
