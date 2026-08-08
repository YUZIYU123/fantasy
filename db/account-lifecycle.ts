import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { getDb } from ".";
import { authTokens, sessions, users } from "./schema";
import {
  AuthError,
  assertSameOrigin,
  createAuthToken,
  createSession,
  enforceRateLimit,
  hashPassword,
  hashToken,
  normalizeEmail,
  revokeCurrentSession,
  sendAuthEmail,
  validatePassword,
  validateTurnstile,
  verifyPassword,
  type UserRole,
  type UserStatus,
} from "../lib/auth";
import { sessionAuthorization } from "../lib/session-authorization";

export interface TurnstileVerifier {
  verify(request: Request, token: string, action: string): Promise<void>;
}

export interface AuthMailer {
  send(request: Request, to: string, type: "verify_email" | "reset_password", token: string): Promise<{ developmentToken?: string }>;
}

export const productionTurnstileVerifier: TurnstileVerifier = { verify: validateTurnstile };
export const productionAuthMailer: AuthMailer = { send: sendAuthEmail };

export class MockTurnstileVerifier implements TurnstileVerifier {
  readonly calls: Array<{ token: string; action: string }> = [];
  constructor(private readonly failure?: Error) {}
  async verify(_request: Request, token: string, action: string) {
    this.calls.push({ token, action });
    if (this.failure) throw this.failure;
  }
}

export class MockAuthMailer implements AuthMailer {
  readonly calls: Array<{ to: string; type: "verify_email" | "reset_password"; token: string }> = [];
  constructor(private readonly result: { developmentToken?: string } = {}, private readonly failure?: Error) {}
  async send(_request: Request, to: string, type: "verify_email" | "reset_password", token: string) {
    this.calls.push({ to, type, token });
    if (this.failure) throw this.failure;
    return this.result;
  }
}

export type AccountCommand =
  | { action: "register"; request: Request; email: string; displayName: string; password: string; turnstileToken: string }
  | { action: "verify-email"; request: Request; token: string }
  | { action: "login"; request: Request; email: string; password: string }
  | { action: "forgot-password"; request: Request; email: string; turnstileToken: string }
  | { action: "reset-password"; request: Request; token: string; password: string }
  | { action: "profile"; request: Request; displayName: string }
  | { action: "logout"; request: Request }
  | { action: "list-users" }
  | { action: "update-user"; id: string; role?: UserRole; status?: Extract<UserStatus, "active" | "disabled"> };

export type AccountResult = {
  status?: number;
  body: Record<string, unknown>;
  cookie?: string;
};

function validEmail(value: string) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function consumeToken(
  token: string,
  type: "verify_email" | "reset_password",
  passwordHash?: string,
) {
  const tokenHash = await hashToken(token);
  const db = getDb();
  const row = (await db.select().from(authTokens).where(and(
    eq(authTokens.tokenHash, tokenHash), eq(authTokens.type, type), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date().toISOString()),
  )).limit(1))[0];
  if (!row) throw new AuthError("链接无效或已过期");
  const now = new Date().toISOString();
  const marker = `${now}:${crypto.randomUUID()}`;
  const consume = db.update(authTokens).set({ usedAt: marker }).where(and(
    eq(authTokens.id, row.id), isNull(authTokens.usedAt), gt(authTokens.expiresAt, now),
  ));
  const validUserId = sql<string>`(SELECT user_id FROM auth_tokens WHERE id = ${row.id} AND used_at IS NULL AND expires_at > ${now})`;
  if (type === "verify_email") {
    await db.batch([
      db.update(users).set({ status: "active", emailVerifiedAt: now, updatedAt: now }).where(eq(users.id, validUserId)),
      consume,
    ]);
  } else {
    await db.batch([
      db.update(users).set({ passwordHash: passwordHash!, updatedAt: now }).where(eq(users.id, validUserId)),
      db.delete(sessions).where(eq(sessions.userId, validUserId)),
      consume,
    ]);
  }
  const consumed = (await db.select({ usedAt: authTokens.usedAt }).from(authTokens).where(eq(authTokens.id, row.id)).limit(1))[0];
  if (consumed?.usedAt !== marker) throw new AuthError("链接无效或已过期");
}

export function createAccountLifecycle({
  turnstile = productionTurnstileVerifier,
  mailer = productionAuthMailer,
}: { turnstile?: TurnstileVerifier; mailer?: AuthMailer } = {}) {
  async function execute(command: AccountCommand): Promise<AccountResult> {
    const db = getDb();
    if ("request" in command) assertSameOrigin(command.request);
    if (command.action === "register") {
      const email = normalizeEmail(command.email);
      const displayName = command.displayName.trim();
      if (!validEmail(email)) throw new AuthError("请输入有效邮箱");
      if (!displayName || displayName.length > 40) throw new AuthError("昵称需要为 1–40 个字符");
      const passwordError = validatePassword(command.password);
      if (passwordError) throw new AuthError(passwordError);
      await enforceRateLimit(command.request, "register", email, 5, 30);
      await turnstile.verify(command.request, command.turnstileToken, "register");
      const existing = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
      if (existing?.status === "active" || existing?.status === "disabled") throw new AuthError("此邮箱已注册", 409);
      const userId = existing?.id || crypto.randomUUID();
      const passwordHash = await hashPassword(command.password);
      if (existing) await db.update(users).set({ displayName, passwordHash, updatedAt: new Date().toISOString() }).where(eq(users.id, existing.id));
      else await db.insert(users).values({ id: userId, email, displayName, passwordHash, role: "reader", status: "pending" });
      const token = await createAuthToken(userId, "verify_email", 24 * 60 * 60_000);
      const delivery = await mailer.send(command.request, email, "verify_email", token);
      return { status: 201, body: { ok: true, message: "验证邮件已发送", ...delivery } };
    }
    if (command.action === "verify-email") {
      if (!command.token || command.token.length > 256) throw new AuthError("验证链接无效");
      await consumeToken(command.token, "verify_email");
      return { body: { ok: true } };
    }
    if (command.action === "login") {
      const email = normalizeEmail(command.email);
      if (email.length > 254) throw new AuthError("邮箱格式无效");
      await enforceRateLimit(command.request, "login", email, 10, 15);
      const user = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
      if (!user || !await verifyPassword(command.password, user.passwordHash)) throw new AuthError("邮箱或密码错误", 401);
      if (user.status === "pending") throw new AuthError("请先验证邮箱", 403);
      if (user.status === "disabled") throw new AuthError("账号已被禁用", 403);
      return {
        body: { user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role, status: user.status } },
        cookie: await createSession(user.id, command.request),
      };
    }
    if (command.action === "forgot-password") {
      const email = normalizeEmail(command.email);
      if (email.length > 254) throw new AuthError("邮箱格式无效");
      await enforceRateLimit(command.request, "forgot-password", email, 4, 60);
      await turnstile.verify(command.request, command.turnstileToken, "forgot-password");
      const user = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
      let developmentToken: string | undefined;
      if (user?.status === "active") {
        const token = await createAuthToken(user.id, "reset_password", 30 * 60_000);
        developmentToken = (await mailer.send(command.request, email, "reset_password", token)).developmentToken;
      }
      return { body: { ok: true, message: "如果账号存在，重置邮件已经发送", ...(developmentToken ? { developmentToken } : {}) } };
    }
    if (command.action === "reset-password") {
      const passwordError = validatePassword(command.password);
      if (passwordError) throw new AuthError(passwordError);
      if (!command.token || command.token.length > 256) throw new AuthError("重置链接无效");
      const passwordHash = await hashPassword(command.password);
      await consumeToken(command.token, "reset_password", passwordHash);
      return { body: { ok: true } };
    }
    if (command.action === "profile") {
      const identity = await sessionAuthorization.require(command.request);
      const displayName = command.displayName.trim();
      if (!displayName || displayName.length > 40) throw new AuthError("昵称需要为 1–40 个字符");
      await db.update(users).set({ displayName, updatedAt: new Date().toISOString() }).where(eq(users.id, identity.id));
      return { body: { ok: true } };
    }
    if (command.action === "logout") {
      await revokeCurrentSession(command.request);
      return { body: { ok: true } };
    }
    if (command.action === "list-users") {
      const rows = await db.select({
        id: users.id, email: users.email, displayName: users.displayName, role: users.role, status: users.status,
        emailVerifiedAt: users.emailVerifiedAt, createdAt: users.createdAt, updatedAt: users.updatedAt,
      }).from(users).orderBy(desc(users.createdAt));
      return { body: { users: rows } };
    }
    const user = (await db.select().from(users).where(eq(users.id, command.id)).limit(1))[0];
    if (!user) throw new AuthError("用户不存在", 404);
    const role = command.role && ["reader", "author", "admin"].includes(command.role) ? command.role : undefined;
    const status = command.status && ["active", "disabled"].includes(command.status) ? command.status : undefined;
    if (!role && !status) throw new AuthError("没有可更新的字段");
    await db.batch([
      db.update(users).set({ role, status, updatedAt: new Date().toISOString() }).where(eq(users.id, command.id)),
      ...(status === "disabled" ? [db.delete(sessions).where(eq(sessions.userId, command.id))] : []),
    ]);
    return { body: { ok: true } };
  }
  return { execute };
}

export const accountLifecycle = createAccountLifecycle();
