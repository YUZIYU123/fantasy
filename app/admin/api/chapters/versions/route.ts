import { desc, eq } from "drizzle-orm";
import { chapterVersions } from "../../../../../db/schema";
import { ensureSchema, getDb } from "../../../../../db";
import { adminAuthResponse, requireAdmin } from "../../../../../lib/admin-auth";

export async function GET(request: Request) {
  try { await requireAdmin(request); } catch (error) { return adminAuthResponse(error); }
  const chapterId = new URL(request.url).searchParams.get("chapterId");
  if (!chapterId) return Response.json({ versions: [] });
  await ensureSchema();
  const rows = await getDb().select({ version: chapterVersions.version, createdAt: chapterVersions.createdAt }).from(chapterVersions).where(eq(chapterVersions.chapterId, chapterId)).orderBy(desc(chapterVersions.version));
  return Response.json({ versions: rows });
}
