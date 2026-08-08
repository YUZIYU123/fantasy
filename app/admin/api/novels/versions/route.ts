import { desc, eq } from "drizzle-orm";
import { ensureSchema, getDb } from "../../../../../db";
import { novelVersions } from "../../../../../db/schema";
import { adminAuthResponse, requireAdmin } from "../../../../../lib/admin-auth";

export async function GET(request: Request) {
  try { await requireAdmin(request); } catch (error) { return adminAuthResponse(error); }
  await ensureSchema();
  const novelId = new URL(request.url).searchParams.get("novelId");
  if (!novelId) return Response.json({ versions: [] });
  const rows = await getDb().select({
    version: novelVersions.version,
    createdAt: novelVersions.createdAt,
  }).from(novelVersions).where(eq(novelVersions.novelId, novelId)).orderBy(desc(novelVersions.version));
  return Response.json({ versions: rows });
}
