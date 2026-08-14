import { env } from "cloudflare:workers";
import { getD1Binding } from ".";
import { AuthError, hashToken, normalizeEmail } from "../lib/auth";

export interface AccountRateLimiter {
  enforce(
    request: Request,
    action: string,
    identity: string,
    maximum?: number,
    minutes?: number,
    clock?: () => Date,
  ): Promise<void>;
  cleanupExpired(before: string): Promise<number>;
}

function isLocalBypass(request: Request) {
  const hostname = new URL(request.url).hostname;
  return (hostname === "localhost" || hostname === "127.0.0.1")
    && (env as unknown as { LOCAL_AUTH_BYPASS?: string }).LOCAL_AUTH_BYPASS === "true";
}

export const d1AccountRateLimiter: AccountRateLimiter = {
  async enforce(request, action, identity, maximum = 8, minutes = 15, clock = () => new Date()) {
    if (isLocalBypass(request)) return;
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    const key = await hashToken(`${ip}:${normalizeEmail(identity)}`);
    const now = clock();
    const createdAt = now.toISOString().replace("T", " ").slice(0, 19);
    const since = new Date(now.getTime() - minutes * 60_000).toISOString().replace("T", " ").slice(0, 19);
    const d1 = getD1Binding();
    const inserted = await d1.prepare(`INSERT INTO auth_attempts (key, action, created_at)
      SELECT ?, ?, ? WHERE (
        SELECT COUNT(*) FROM auth_attempts WHERE key = ? AND action = ? AND created_at > ?
      ) < ?`).bind(key, action, createdAt, key, action, since, maximum).run();
    if (Number(inserted.meta.changes ?? 0) === 1) return;

    const oldest = await d1.prepare(`SELECT created_at AS createdAt FROM auth_attempts
      WHERE key = ? AND action = ? AND created_at > ? ORDER BY created_at ASC LIMIT 1`)
      .bind(key, action, since).first<{ createdAt: string }>();
    const oldestTime = oldest ? Date.parse(`${oldest.createdAt.replace(" ", "T")}Z`) : now.getTime();
    const retryAfterSeconds = Math.max(1, Math.ceil((oldestTime + minutes * 60_000 - now.getTime()) / 1000));
    throw new AuthError("操作过于频繁，请稍后再试", 429, retryAfterSeconds);
  },
  async cleanupExpired(before) {
    const result = await getD1Binding().prepare("DELETE FROM auth_attempts WHERE created_at <= ?").bind(before).run();
    return Number(result.meta.changes ?? 0);
  },
};

export function enforceRateLimit(
  request: Request,
  action: string,
  identity: string,
  maximum = 8,
  minutes = 15,
  clock = () => new Date(),
) {
  return d1AccountRateLimiter.enforce(request, action, identity, maximum, minutes, clock);
}
