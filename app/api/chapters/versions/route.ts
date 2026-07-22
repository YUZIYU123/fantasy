import { desc, eq } from "drizzle-orm";
import { chapterVersions } from "../../../../db/schema";
import { ensureSchema, getDb } from "../../../../db";

export async function GET(request: Request) {
  const email = request.headers.get("oai-authenticated-user-email");
  const host = new URL(request.url).hostname;
  if (!email && host !== "localhost" && host !== "127.0.0.1") return Response.json({ error: "未登录" }, { status: 401 });
  const chapterId = new URL(request.url).searchParams.get("chapterId");
  if (!chapterId) return Response.json({ versions: [] });
  await ensureSchema();
  const rows = await getDb().select({ version: chapterVersions.version, createdAt: chapterVersions.createdAt }).from(chapterVersions).where(eq(chapterVersions.chapterId, chapterId)).orderBy(desc(chapterVersions.version));
  return Response.json({ versions: rows });
}
