import { env } from "cloudflare:workers";
import { and, asc, desc, eq, isNull, or } from "drizzle-orm";
import { ensureSchema, getDb } from "../../../../db";
import { assets, assetFolders, chapters, chapterVersions, novels, novelVersions } from "../../../../db/schema";
import { assetStorageKey, novelReferencesAsset, storyReferencesAsset, type AssetReference, type AssetType } from "../../../../lib/assets";
import { assertSameOrigin, authErrorResponse, AuthError, requireRole } from "../../../../lib/auth";
import { normalizeNovel, normalizeStory } from "../../../../lib/story";

export async function GET(request: Request) {
  try {
    await ensureSchema();
    const identity = await requireRole(request, ["author"]);
    const db = getDb();
    const [assetRows, folders] = await Promise.all([
      db.select().from(assets).where(or(isNull(assets.ownerId), eq(assets.ownerId, identity.id))).orderBy(desc(assets.updatedAt)),
      db.select().from(assetFolders).where(eq(assetFolders.ownerId, identity.id)).orderBy(asc(assetFolders.name)),
    ]);
    return Response.json({
      assets: assetRows.map((asset) => ({ ...asset, canManage: asset.ownerId === identity.id })),
      folders,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await ensureSchema();
    assertSameOrigin(request);
    const identity = await requireRole(request, ["author"]);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new AuthError("请选择文件");
    const type: AssetType | null = file.type.startsWith("image/")
      ? "image"
      : file.type.startsWith("audio/")
        ? "audio"
        : file.type === "video/mp4" || file.type === "video/webm" ? "video" : null;
    if (!type) throw new AuthError("仅支持图片、音频、MP4 和 WebM");
    const maximum = type === "image" ? 8 * 1024 * 1024 : type === "audio" ? 20 * 1024 * 1024 : 50 * 1024 * 1024;
    if (file.size > maximum) throw new AuthError(`${type === "image" ? "图片" : type === "audio" ? "音频" : "视频"}文件过大`);
    const duration = Math.max(0, Number(form.get("duration")) || 0);
    if (type === "video" && duration > 60) throw new AuthError("视频不能超过 60 秒");
    const folderId = String(form.get("folderId") || "") || null;
    if (folderId) {
      const folders = await getDb().select({ ownerId: assetFolders.ownerId }).from(assetFolders)
        .where(eq(assetFolders.id, folderId)).limit(1);
      if (!folders[0] || folders[0].ownerId !== identity.id) throw new AuthError("素材文件夹不存在", 404);
    }
    const id = crypto.randomUUID();
    const storageKey = `${type}/${id}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
    await env.ASSET_BUCKET.put(storageKey, file.stream(), { httpMetadata: { contentType: file.type } });
    const row = {
      id,
      name: file.name.slice(0, 200),
      type,
      url: `/api/assets/${id}`,
      storageKey,
      folderId,
      ownerId: identity.id,
      mimeType: file.type,
      size: file.size,
      duration: Math.round(duration),
      alt: String(form.get("alt") || "").slice(0, 500),
      status: "ready" as const,
    };
    await getDb().insert(assets).values(row);
    return Response.json({ asset: row }, { status: 201 });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    await ensureSchema();
    assertSameOrigin(request);
    const identity = await requireRole(request, ["author"]);
    const body = await request.json() as { action?: string; id?: string; name?: string; folderId?: string | null };
    const db = getDb();
    if (body.action === "create-folder") {
      const name = body.name?.trim();
      if (!name || name.length > 80) throw new AuthError("文件夹名称需要为 1–80 个字符");
      const id = crypto.randomUUID();
      await db.insert(assetFolders).values({ id, name, ownerId: identity.id });
      return Response.json({ folder: { id, name } }, { status: 201 });
    }
    if (!body.id) throw new AuthError("缺少资源 ID");
    if (body.action === "rename-folder" || body.action === "delete-folder") {
      const folders = await db.select().from(assetFolders).where(eq(assetFolders.id, body.id)).limit(1);
      if (!folders[0] || folders[0].ownerId !== identity.id) throw new AuthError("文件夹不存在", 404);
      if (body.action === "rename-folder") {
        const name = body.name?.trim();
        if (!name || name.length > 80) throw new AuthError("文件夹名称需要为 1–80 个字符");
        await db.update(assetFolders).set({ name, updatedAt: new Date().toISOString() }).where(eq(assetFolders.id, body.id));
      } else {
        await db.update(assets).set({ folderId: null, updatedAt: new Date().toISOString() })
          .where(and(eq(assets.folderId, body.id), eq(assets.ownerId, identity.id)));
        await db.delete(assetFolders).where(eq(assetFolders.id, body.id));
      }
    } else if (body.action === "update-asset") {
      const assetRows = await db.select().from(assets).where(eq(assets.id, body.id)).limit(1);
      if (!assetRows[0] || assetRows[0].ownerId !== identity.id) throw new AuthError("只能整理自己的素材", 403);
      if (body.folderId) {
        const folders = await db.select().from(assetFolders).where(eq(assetFolders.id, body.folderId)).limit(1);
        if (!folders[0] || folders[0].ownerId !== identity.id) throw new AuthError("文件夹不存在", 404);
      }
      await db.update(assets).set({
        name: body.name?.trim().slice(0, 200) || undefined,
        folderId: body.folderId ?? null,
        updatedAt: new Date().toISOString(),
      }).where(eq(assets.id, body.id));
    } else {
      throw new AuthError("不支持的素材操作");
    }
    return Response.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await ensureSchema();
    assertSameOrigin(request);
    const identity = await requireRole(request, ["author"]);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new AuthError("缺少素材 ID");
    const db = getDb();
    const assetRows = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
    const asset = assetRows[0];
    if (!asset) throw new AuthError("素材不存在", 404);
    if (asset.ownerId !== identity.id) throw new AuthError("只能删除自己的素材", 403);
    const references: AssetReference[] = [];
    const novelRows = await db.select().from(novels).where(eq(novels.ownerId, identity.id));
    for (const novelRow of novelRows) {
      for (const [version, json] of [["draft", novelRow.draftJson], ["published", novelRow.publishedJson]] as const) {
        if (!json) continue;
        const novel = normalizeNovel(JSON.parse(json));
        if (novelReferencesAsset(novel, asset)) references.push({ chapterId: novelRow.id, chapterTitle: novel.name, version, nodeId: "novel", nodeTitle: "小说资料", field: "小说封面" });
      }
    }
    const novelVersionRows = await db.select().from(novelVersions);
    for (const version of novelVersionRows.filter((item) => novelRows.some((novel) => novel.id === item.novelId))) {
      const novel = normalizeNovel(JSON.parse(version.snapshotJson));
      if (novelReferencesAsset(novel, asset)) references.push({ chapterId: version.novelId, chapterTitle: novel.name, version: `v${version.version}`, nodeId: "novel", nodeTitle: "小说资料", field: "小说封面" });
    }
    const chapterRows = await db.select().from(chapters);
    for (const chapter of chapterRows) {
      for (const [version, json] of [["draft", chapter.draftJson], ["published", chapter.publishedJson]] as const) {
        if (!json) continue;
        for (const ref of storyReferencesAsset(normalizeStory(JSON.parse(json)), asset)) {
          references.push({ chapterId: chapter.id, chapterTitle: chapter.title, version, ...ref });
        }
      }
    }
    const versionRows = await db.select().from(chapterVersions);
    for (const version of versionRows) {
      const chapter = chapterRows.find((item) => item.id === version.chapterId);
      for (const ref of storyReferencesAsset(normalizeStory(JSON.parse(version.snapshotJson)), asset)) {
        references.push({
          chapterId: version.chapterId,
          chapterTitle: chapter?.title || version.chapterId,
          version: `v${version.version}`,
          ...ref,
        });
      }
    }
    if (references.length) return Response.json({ error: "素材仍被章节引用", references }, { status: 409 });
    await db.update(assets).set({ status: "deleting", updatedAt: new Date().toISOString() }).where(eq(assets.id, id));
    try {
      await env.ASSET_BUCKET.delete(asset.storageKey || assetStorageKey(asset.url));
      await db.delete(assets).where(eq(assets.id, id));
    } catch {
      await db.update(assets).set({ status: "delete_failed", updatedAt: new Date().toISOString() }).where(eq(assets.id, id));
      throw new AuthError("删除失败，可稍后重试", 500);
    }
    return Response.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}
