import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { ensureSeed, rowToChapter } from "../../../db/chapters";
import { rowToNovel } from "../../../db/novels";
import { chapters, novels } from "../../../db/schema";

export async function GET(request: Request) {
  await ensureSeed();
  const db = getDb();
  const search = new URL(request.url).searchParams;
  const slug = search.get("slug");
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
    result.push({
      id: novel.id,
      slug: novel.slug,
      sortOrder: novel.sortOrder,
      status: novel.status,
      version: novel.version,
      published: novel.published,
      chapters: chapterRows.map(rowToChapter).map((chapter) => ({
        id: chapter.id,
        novelId: chapter.novelId,
        slug: chapter.slug,
        title: chapter.title,
        summary: chapter.summary,
        sortOrder: chapter.sortOrder,
        version: chapter.version,
        published: chapter.published,
        updatedAt: chapter.updatedAt,
      })),
      updatedAt: novel.updatedAt,
    });
  }
  return Response.json({ novels: result }, {
    headers: { "cache-control": "public, max-age=30, s-maxage=60" },
  });
}
