import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { ensureSchema, getDb } from "../../../../db";
import { assets } from "../../../../db/schema";
import { assetStorageKey } from "../../../../lib/assets";

export async function GET(request: Request, context: { params: Promise<{ key: string[] }> }) {
  const { key } = await context.params;
  const joined = key.join("/");
  await ensureSchema();
  const rows = await getDb().select().from(assets).where(eq(assets.id, joined)).limit(1);
  const storageKey = rows[0]?.storageKey || (rows[0] ? assetStorageKey(rows[0].url) : joined);
  const rangeHeader = request.headers.get("range");
  let range: { offset: number; length: number } | undefined;
  let totalSize = 0;
  if (rangeHeader) {
    const head = await env.ASSET_BUCKET.head(storageKey);
    if (!head) return new Response("Not found", { status: 404 });
    totalSize = head.size;
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { "content-range": `bytes */${totalSize}` } });
    const start = match[1] ? Number(match[1]) : Math.max(0, totalSize - Number(match[2]));
    const end = match[2] && match[1] ? Math.min(Number(match[2]), totalSize - 1) : totalSize - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= totalSize) return new Response(null, { status: 416, headers: { "content-range": `bytes */${totalSize}` } });
    range = { offset: start, length: end - start + 1 };
  }
  const object = await env.ASSET_BUCKET.get(storageKey, range ? { range } : undefined);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  if (!headers.has("content-type") && rows[0]?.mimeType) headers.set("content-type", rows[0].mimeType);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  headers.set("x-content-type-options", "nosniff");
  headers.set("accept-ranges", "bytes");
  if (range) {
    headers.set("content-length", String(range.length));
    headers.set("content-range", `bytes ${range.offset}-${range.offset + range.length - 1}/${totalSize}`);
  }
  return new Response(object.body, { status: range ? 206 : 200, headers });
}
