import { eq } from "drizzle-orm";
import { getDb } from ".";
import { sessions, users } from "./schema";
import { AuthError, hashToken, type SessionIdentity, type UserRole } from "../lib/auth";

function sessionToken(request: Request) {
  const cookie = request.headers.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === "mist_session") return decodeURIComponent(rest.join("="));
  }
  return "";
}

export async function optionalSessionIdentity(request: Request): Promise<SessionIdentity | null> {
  const token = sessionToken(request);
  if (!token) return null;
  const rows = await getDb().select({
    id: users.id, email: users.email, displayName: users.displayName, role: users.role,
    status: users.status, expiresAt: sessions.expiresAt,
  }).from(sessions).innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.tokenHash, await hashToken(token))).limit(1);
  const row = rows[0];
  if (!row || row.status !== "active" || new Date(row.expiresAt).getTime() <= Date.now()) return null;
  return { id: row.id, email: row.email, displayName: row.displayName, role: row.role, status: row.status };
}

export async function requireSessionIdentity(request: Request) {
  const identity = await optionalSessionIdentity(request);
  if (!identity) throw new AuthError("请先登录", 401);
  return identity;
}

export async function requireSessionRole(request: Request, roles: UserRole[]) {
  const identity = await requireSessionIdentity(request);
  if (!roles.includes(identity.role)) throw new AuthError("当前账号没有此操作权限", 403);
  return identity;
}
