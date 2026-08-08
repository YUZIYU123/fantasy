import { desc, eq } from "drizzle-orm";
import { ensureSchema, getDb } from "../../../../../db";
import { chapters, chapterVersions } from "../../../../../db/schema";
import { authErrorResponse, AuthError, requireRole } from "../../../../../lib/auth";

export async function GET(request: Request) {
  try {
    await ensureSchema();
    const identity = await requireRole(request, ["author"]);
    const chapterId = new URL(request.url).searchParams.get("chapterId");
    if (!chapterId) return Response.json({ versions: [] });
    const chapterRows = await getDb().select({ ownerId: chapters.ownerId }).from(chapters)
      .where(eq(chapters.id, chapterId)).limit(1);
    if (!chapterRows[0] || chapterRows[0].ownerId !== identity.id) throw new AuthError("章节不存在", 404);
    const rows = await getDb().select({
      version: chapterVersions.version,
      createdAt: chapterVersions.createdAt,
    }).from(chapterVersions)
      .where(eq(chapterVersions.chapterId, chapterId))
      .orderBy(desc(chapterVersions.version));
    return Response.json({ versions: rows });
  } catch (error) {
    return authErrorResponse(error);
  }
}
