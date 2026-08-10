import { env } from "cloudflare:workers";
import { and, count, eq, gt } from "drizzle-orm";
import { getDb } from ".";
import { authAttempts } from "./schema";
import { AuthError, hashToken, normalizeEmail } from "../lib/auth";

function isLocalBypass(request: Request) {
  const hostname = new URL(request.url).hostname;
  return (hostname === "localhost" || hostname === "127.0.0.1")
    && (env as unknown as { LOCAL_AUTH_BYPASS?: string }).LOCAL_AUTH_BYPASS === "true";
}

export async function enforceRateLimit(request: Request, action: string, identity: string, maximum = 8, minutes = 15) {
  if (isLocalBypass(request)) return;
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const key = await hashToken(`${ip}:${normalizeEmail(identity)}`);
  // SQLite CURRENT_TIMESTAMP uses `YYYY-MM-DD HH:mm:ss`.
  const since = new Date(Date.now() - minutes * 60_000).toISOString().replace("T", " ").slice(0, 19);
  const result = await getDb().select({ value: count() }).from(authAttempts).where(and(
    eq(authAttempts.key, key), eq(authAttempts.action, action), gt(authAttempts.createdAt, since),
  ));
  if ((result[0]?.value ?? 0) >= maximum) throw new AuthError("操作过于频繁，请稍后再试", 429);
  await getDb().insert(authAttempts).values({ key, action });
}
