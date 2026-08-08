import { desc, eq } from "drizzle-orm";
import { ensureSchema, getDb } from "../../../../db";
import { sessions, users } from "../../../../db/schema";
import { adminAuthResponse, requireAdmin } from "../../../../lib/admin-auth";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    await ensureSchema();
    const rows = await getDb().select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      role: users.role,
      status: users.status,
      emailVerifiedAt: users.emailVerifiedAt,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    }).from(users).orderBy(desc(users.createdAt));
    return Response.json({ users: rows });
  } catch (error) {
    return adminAuthResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    await requireAdmin(request);
    await ensureSchema();
    const body = await request.json() as {
      id?: string;
      role?: "reader" | "author" | "admin";
      status?: "active" | "disabled";
    };
    if (!body.id) return Response.json({ error: "缺少用户 ID" }, { status: 400 });
    const rows = await getDb().select().from(users).where(eq(users.id, body.id)).limit(1);
    const user = rows[0];
    if (!user) return Response.json({ error: "用户不存在" }, { status: 404 });
    const role = body.role && ["reader", "author", "admin"].includes(body.role) ? body.role : undefined;
    const status = body.status && ["active", "disabled"].includes(body.status) ? body.status : undefined;
    if (!role && !status) return Response.json({ error: "没有可更新的字段" }, { status: 400 });
    await getDb().update(users).set({
      role,
      status,
      updatedAt: new Date().toISOString(),
    }).where(eq(users.id, body.id));
    if (status === "disabled") await getDb().delete(sessions).where(eq(sessions.userId, body.id));
    return Response.json({ ok: true });
  } catch (error) {
    return adminAuthResponse(error);
  }
}
