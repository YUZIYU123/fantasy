import { and, asc, eq } from "drizzle-orm";
import { chapters, novels } from "../../../db/schema";
import { ensureSeed, rowToChapter } from "../../../db/chapters";
import { getDb } from "../../../db";

export async function GET(request: Request) {
  await ensureSeed();
  const db = getDb();
  const search = new URL(request.url).searchParams;
  const slug = search.get("slug");
  const novelId = search.get("novelId");
  const rows = slug
    ? await db.select().from(chapters).where(and(eq(chapters.slug, slug), eq(chapters.status, "published"))).limit(1)
    : novelId
      ? await db.select().from(chapters).where(and(eq(chapters.novelId, novelId), eq(chapters.status, "published"))).orderBy(asc(chapters.sortOrder))
      : await db.select().from(chapters).where(eq(chapters.status, "published")).orderBy(asc(chapters.sortOrder));
  const parentRows = await db.select({ id: novels.id }).from(novels).where(eq(novels.status, "published"));
  const publishedNovelIds = new Set(parentRows.map((row) => row.id));
  const records = rows.filter((row) => publishedNovelIds.has(row.novelId)).map(rowToChapter).map((record) => ({
    id: record.id, novelId: record.novelId, slug: record.slug, title: record.title, summary: record.summary, coverUrl: record.coverUrl,
    sortOrder: record.sortOrder, status: record.status, version: record.version, published: record.published, updatedAt: record.updatedAt,
  }));
  return Response.json({ chapters: records });
}
