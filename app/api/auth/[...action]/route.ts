import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { ensureSchema, getDb } from "../../../../db";
import { sessions, users } from "../../../../db/schema";
import {
  assertSameOrigin, authErrorResponse, AuthError, clearSessionCookie, consumeAuthToken,
  createAuthToken, createSession, enforceRateLimit, hashPassword, normalizeEmail,
  optionalSession, requireSession, revokeCurrentSession, sendAuthEmail, validatePassword, validateTurnstile,
  verifyPassword,
} from "../../../../lib/auth";

type Context = { params: Promise<{ action: string[] }> };

function actionName(values: string[]) {
  return values.join("/");
}

export async function GET(_request: Request, context: Context) {
  await ensureSchema();
  const action = actionName((await context.params).action);
  if (action === "me") {
    const user = await optionalSession(_request);
    return Response.json({ user });
  }
  if (action === "config") {
    const values = env as unknown as { TURNSTILE_SITE_KEY?: string };
    return Response.json({ turnstileSiteKey: values.TURNSTILE_SITE_KEY || "" });
  }
  return Response.json({ error: "不支持的账号操作" }, { status: 404 });
}

export async function POST(request: Request, context: Context) {
  try {
    await ensureSchema();
    assertSameOrigin(request);
    const action = actionName((await context.params).action);
    if (action === "logout") {
      await revokeCurrentSession(request);
      return Response.json({ ok: true }, { headers: { "set-cookie": clearSessionCookie(request) } });
    }
    const body = await request.json() as Record<string, unknown>;
    if (action === "register") return register(request, body);
    if (action === "login") return login(request, body);
    if (action === "verify-email") return verifyEmail(body);
    if (action === "forgot-password") return forgotPassword(request, body);
    if (action === "reset-password") return resetPassword(body);
    if (action === "profile") return updateProfile(request, body);
    return Response.json({ error: "不支持的账号操作" }, { status: 404 });
  } catch (error) {
    return authErrorResponse(error);
  }
}

async function updateProfile(request: Request, body: Record<string, unknown>) {
  const identity = await requireSession(request);
  const displayName = String(body.displayName || "").trim();
  if (!displayName || displayName.length > 40) throw new AuthError("昵称需要为 1–40 个字符");
  await getDb().update(users).set({
    displayName,
    updatedAt: new Date().toISOString(),
  }).where(eq(users.id, identity.id));
  return Response.json({ ok: true });
}

async function register(request: Request, body: Record<string, unknown>) {
  const email = normalizeEmail(String(body.email || ""));
  const displayName = String(body.displayName || "").trim();
  const password = String(body.password || "");
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError("请输入有效邮箱");
  if (!displayName || displayName.length > 40) throw new AuthError("昵称需要为 1–40 个字符");
  const passwordError = validatePassword(password);
  if (passwordError) throw new AuthError(passwordError);
  await enforceRateLimit(request, "register", email, 5, 30);
  await validateTurnstile(request, String(body.turnstileToken || ""), "register");
  const db = getDb();
  const existingRows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const existing = existingRows[0];
  if (existing?.status === "active" || existing?.status === "disabled") throw new AuthError("此邮箱已注册", 409);
  const userId = existing?.id || crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  if (existing) {
    await db.update(users).set({ displayName, passwordHash, updatedAt: new Date().toISOString() }).where(eq(users.id, existing.id));
  } else {
    await db.insert(users).values({ id: userId, email, displayName, passwordHash, role: "reader", status: "pending" });
  }
  const token = await createAuthToken(userId, "verify_email", 24 * 60 * 60_000);
  const delivery = await sendAuthEmail(request, email, "verify_email", token);
  return Response.json({ ok: true, message: "验证邮件已发送", ...delivery }, { status: 201 });
}

async function verifyEmail(body: Record<string, unknown>) {
  const token = String(body.token || "");
  if (!token || token.length > 256) throw new AuthError("验证链接无效");
  const userId = await consumeAuthToken(token, "verify_email");
  await getDb().update(users).set({
    status: "active",
    emailVerifiedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }).where(eq(users.id, userId));
  return Response.json({ ok: true });
}

async function login(request: Request, body: Record<string, unknown>) {
  const email = normalizeEmail(String(body.email || ""));
  if (email.length > 254) throw new AuthError("邮箱格式无效");
  const password = String(body.password || "");
  await enforceRateLimit(request, "login", email, 10, 15);
  const rows = await getDb().select().from(users).where(eq(users.email, email)).limit(1);
  const user = rows[0];
  if (!user || !await verifyPassword(password, user.passwordHash)) throw new AuthError("邮箱或密码错误", 401);
  if (user.status === "pending") throw new AuthError("请先验证邮箱", 403);
  if (user.status === "disabled") throw new AuthError("账号已被禁用", 403);
  const cookie = await createSession(user.id, request);
  return Response.json({
    user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role, status: user.status },
  }, { headers: { "set-cookie": cookie } });
}

async function forgotPassword(request: Request, body: Record<string, unknown>) {
  const email = normalizeEmail(String(body.email || ""));
  if (email.length > 254) throw new AuthError("邮箱格式无效");
  await enforceRateLimit(request, "forgot-password", email, 4, 60);
  await validateTurnstile(request, String(body.turnstileToken || ""), "forgot-password");
  const rows = await getDb().select().from(users).where(eq(users.email, email)).limit(1);
  const user = rows[0];
  let developmentToken: string | undefined;
  if (user?.status === "active") {
    const token = await createAuthToken(user.id, "reset_password", 30 * 60_000);
    const delivery = await sendAuthEmail(request, email, "reset_password", token);
    developmentToken = delivery.developmentToken;
  }
  return Response.json({ ok: true, message: "如果账号存在，重置邮件已经发送", ...(developmentToken ? { developmentToken } : {}) });
}

async function resetPassword(body: Record<string, unknown>) {
  const password = String(body.password || "");
  const passwordError = validatePassword(password);
  if (passwordError) throw new AuthError(passwordError);
  const token = String(body.token || "");
  if (!token || token.length > 256) throw new AuthError("重置链接无效");
  const userId = await consumeAuthToken(token, "reset_password");
  await getDb().batch([
    getDb().update(users).set({ passwordHash: await hashPassword(password), updatedAt: new Date().toISOString() }).where(eq(users.id, userId)),
    getDb().delete(sessions).where(eq(sessions.userId, userId)),
  ]);
  return Response.json({ ok: true });
}
