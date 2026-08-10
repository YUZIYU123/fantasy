import { eq } from "drizzle-orm";
import { getDb } from ".";
import { sessions, users } from "./schema";
import { hashToken } from "../lib/auth";

export async function findSessionAccountByToken(token: string) {
  const rows = await getDb().select({
    id: users.id, email: users.email, displayName: users.displayName, role: users.role,
    status: users.status, expiresAt: sessions.expiresAt,
  }).from(sessions).innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.tokenHash, await hashToken(token))).limit(1);
  return rows[0] ?? null;
}
