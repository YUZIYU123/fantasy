import { env } from "cloudflare:workers";
import { and, count, eq, gt } from "drizzle-orm";
import { getDb } from "../db";
import { authAttempts, authTokens, sessions, users } from "../db/schema";

export type UserRole = "reader" | "author" | "admin";
export type UserStatus = "pending" | "active" | "disabled";
export type SessionIdentity = {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
};

type AuthEnv = {
  RESEND_API_KEY?: string;
  AUTH_FROM_EMAIL?: string;
  APP_ORIGIN?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  LOCAL_AUTH_BYPASS?: string;
};

const SESSION_COOKIE = "mist_session";
const SESSION_DAYS = 30;
const PASSWORD_ITERATIONS = 210_000;

function authEnv() {
  return env as unknown as AuthEnv;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function validatePassword(value: string) {
  if (value.length < 10) return "密码至少需要 10 个字符";
  if (value.length > 128) return "密码不能超过 128 个字符";
  return "";
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PASSWORD_ITERATIONS }, key, 256);
  return `pbkdf2-sha256$${PASSWORD_ITERATIONS}$${bytesToBase64Url(salt)}$${bytesToBase64Url(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, iterationsValue, saltValue, hashValue] = encoded.split("$");
  if (algorithm !== "pbkdf2-sha256" || !iterationsValue || !saltValue || !hashValue) return false;
  const iterations = Number(iterationsValue);
  if (!Number.isInteger(iterations) || iterations < 100_000 || iterations > 1_000_000) return false;
  const salt = base64UrlToBytes(saltValue);
  const expected = base64UrlToBytes(hashValue);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, expected.length * 8));
  if (bits.length !== expected.length) return false;
  let difference = 0;
  bits.forEach((byte, index) => { difference |= byte ^ expected[index]; });
  return difference === 0;
}

export function randomToken(size = 32) {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(size)));
}

export async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return bytesToBase64Url(new Uint8Array(digest));
}

function cookieValue(request: Request, name: string) {
  const cookie = request.headers.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

export async function optionalSession(request: Request): Promise<SessionIdentity | null> {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await hashToken(token);
  const rows = await getDb().select({
    id: users.id,
    email: users.email,
    displayName: users.displayName,
    role: users.role,
    status: users.status,
    expiresAt: sessions.expiresAt,
  }).from(sessions).innerJoin(users, eq(sessions.userId, users.id)).where(eq(sessions.tokenHash, tokenHash)).limit(1);
  const row = rows[0];
  if (!row || row.status !== "active" || new Date(row.expiresAt).getTime() <= Date.now()) return null;
  return { id: row.id, email: row.email, displayName: row.displayName, role: row.role, status: row.status };
}

export async function requireSession(request: Request) {
  const identity = await optionalSession(request);
  if (!identity) throw new AuthError("请先登录", 401);
  return identity;
}

export async function requireRole(request: Request, allowed: UserRole[]) {
  const identity = await requireSession(request);
  if (!allowed.includes(identity.role)) throw new AuthError("当前账号没有此操作权限", 403);
  return identity;
}

export async function createSession(userId: string, request: Request) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  await getDb().insert(sessions).values({
    id: crypto.randomUUID(),
    userId,
    tokenHash: await hashToken(token),
    expiresAt,
  });
  const secure = new URL(request.url).protocol === "https:";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}${secure ? "; Secure" : ""}`;
}

export async function revokeCurrentSession(request: Request) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (token) await getDb().delete(sessions).where(eq(sessions.tokenHash, await hashToken(token)));
}

export function clearSessionCookie(request: Request) {
  const secure = new URL(request.url).protocol === "https:";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new AuthError("请求来源无效", 403);
}

function isLocalBypass(request: Request) {
  const hostname = new URL(request.url).hostname;
  return (hostname === "localhost" || hostname === "127.0.0.1") && authEnv().LOCAL_AUTH_BYPASS === "true";
}

export async function validateTurnstile(request: Request, token: string, action: string) {
  if (isLocalBypass(request)) return;
  const secret = authEnv().TURNSTILE_SECRET_KEY;
  if (!secret) throw new AuthError("注册验证服务尚未配置", 503);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      secret,
      response: token,
      remoteip: request.headers.get("cf-connecting-ip") || undefined,
      idempotency_key: crypto.randomUUID(),
    }),
  });
  const result = await response.json() as { success?: boolean; action?: string };
  if (!result.success || (result.action && result.action !== action)) throw new AuthError("人机验证失败，请重试", 400);
}

export async function enforceRateLimit(request: Request, action: string, email: string, maximum = 8, minutes = 15) {
  if (isLocalBypass(request)) return;
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const key = await hashToken(`${ip}:${normalizeEmail(email)}`);
  const since = new Date(Date.now() - minutes * 60_000).toISOString();
  const result = await getDb().select({ value: count() }).from(authAttempts).where(and(
    eq(authAttempts.key, key),
    eq(authAttempts.action, action),
    gt(authAttempts.createdAt, since),
  ));
  if ((result[0]?.value ?? 0) >= maximum) throw new AuthError("操作过于频繁，请稍后再试", 429);
  await getDb().insert(authAttempts).values({ key, action });
}

export async function createAuthToken(userId: string, type: "verify_email" | "reset_password", lifetimeMs: number) {
  const token = randomToken();
  await getDb().insert(authTokens).values({
    id: crypto.randomUUID(),
    userId,
    tokenHash: await hashToken(token),
    type,
    expiresAt: new Date(Date.now() + lifetimeMs).toISOString(),
  });
  return token;
}

export async function consumeAuthToken(token: string, type: "verify_email" | "reset_password") {
  const rows = await getDb().select().from(authTokens).where(and(
    eq(authTokens.tokenHash, await hashToken(token)),
    eq(authTokens.type, type),
  )).limit(1);
  const row = rows[0];
  if (!row || row.usedAt || new Date(row.expiresAt).getTime() <= Date.now()) throw new AuthError("链接无效或已过期", 400);
  await getDb().update(authTokens).set({ usedAt: new Date().toISOString() }).where(eq(authTokens.id, row.id));
  return row.userId;
}

export async function sendAuthEmail(request: Request, to: string, type: "verify_email" | "reset_password", token: string) {
  if (isLocalBypass(request)) return { developmentToken: token };
  const values = authEnv();
  if (!values.RESEND_API_KEY || !values.AUTH_FROM_EMAIL || !values.APP_ORIGIN) throw new AuthError("邮件服务尚未配置", 503);
  const path = type === "verify_email" ? "/verify-email" : "/reset-password";
  const link = `${values.APP_ORIGIN.replace(/\/$/, "")}${path}?token=${encodeURIComponent(token)}`;
  const subject = type === "verify_email" ? "验证你的幻界 Fantasy 账号" : "重置你的幻界 Fantasy 密码";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${values.RESEND_API_KEY}`,
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      from: values.AUTH_FROM_EMAIL,
      to: [to],
      subject,
      text: `${subject}\n\n请在有效期内打开以下链接：\n${link}`,
      html: `<p>${subject}</p><p><a href="${link}">继续操作</a></p><p>如果不是你本人操作，请忽略此邮件。</p>`,
    }),
  });
  if (!response.ok) throw new AuthError("邮件发送失败，请稍后重试", 502);
  return {};
}

export class AuthError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export function authErrorResponse(error: unknown) {
  if (error instanceof AuthError) return Response.json({ error: error.message }, { status: error.status });
  return Response.json({ error: "账号操作失败" }, { status: 500 });
}
