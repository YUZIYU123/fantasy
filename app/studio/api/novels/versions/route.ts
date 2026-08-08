import { desc, eq } from "drizzle-orm";
import { ensureSchema, getDb } from "../../../../../db";
import { novels, novelVersions } from "../../../../../db/schema";
import { authErrorResponse, AuthError, requireRole } from "../../../../../lib/auth";

export async function GET(request: Request) {
  try {
    await ensureSchema();
    const identity = await requireRole(request, ["author"]);
    const novelId = new URL(request.url).searchParams.get("novelId");
    if (!novelId) return Response.json({ versions: [] });
    const rows = await getDb().select({ ownerId: novels.ownerId }).from(novels).where(eq(novels.id, novelId)).limit(1);
    if (!rows[0] || rows[0].ownerId !== identity.id) throw new AuthError("小说不存在", 404);
    const versions = await getDb().select({
      version: novelVersions.version,
      createdAt: novelVersions.createdAt,
    }).from(novelVersions).where(eq(novelVersions.novelId, novelId)).orderBy(desc(novelVersions.version));
    return Response.json({ versions });
  } catch (error) {
    return authErrorResponse(error);
  }
}
