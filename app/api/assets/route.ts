import { env } from "cloudflare:workers";
import { desc } from "drizzle-orm";
import { assets } from "../../../db/schema";
import { ensureSchema, getDb } from "../../../db";

export async function GET() {
  await ensureSchema();
  return Response.json({ assets: await getDb().select().from(assets).orderBy(desc(assets.createdAt)) });
}

export async function POST(request: Request) {
  const email = request.headers.get("oai-authenticated-user-email");
  const host = new URL(request.url).hostname;
  if (!email && host !== "localhost" && host !== "127.0.0.1") return Response.json({ error: "未登录" }, { status: 401 });
  const form = await request.formData();
  await ensureSchema();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "请选择文件" }, { status: 400 });
  const isImage = file.type.startsWith("image/");
  const isAudio = file.type.startsWith("audio/");
  if (!isImage && !isAudio) return Response.json({ error: "仅支持图片和音频" }, { status: 400 });
  const max = isImage ? 8 * 1024 * 1024 : 20 * 1024 * 1024;
  if (file.size > max) return Response.json({ error: `文件不能超过 ${isImage ? 8 : 20}MB` }, { status: 400 });
  const id = crypto.randomUUID();
  const key = `${isImage ? "images" : "audio"}/${id}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
  await env.ASSET_BUCKET.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
  const url = `/api/assets/${encodeURIComponent(key)}`;
  await getDb().insert(assets).values({ id, name: file.name, type: isImage ? "image" : "audio", url, mimeType: file.type, size: file.size, alt: String(form.get("alt") || "") });
  return Response.json({ asset: { id, name: file.name, type: isImage ? "image" : "audio", url } }, { status: 201 });
}
