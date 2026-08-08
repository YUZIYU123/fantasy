import { env } from "cloudflare:workers";
import { optionalSession } from "./auth";

type AdminEnv = {
  CREATOR_PASSWORD_HASH?: string;
  CREATOR_SESSION_SECRET?: string;
  LOCAL_ADMIN_BYPASS?: string;
};

const SESSION_COOKIE = "fantasy_creator_session";
const SESSION_VERSION = "v1";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const encoder = new TextEncoder();

export type AdminIdentity = { role: "admin"; email: string };

function values() {
  return env as unknown as AdminEnv;
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
}

async function signSession(payload: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return bytesToHex(new Uint8Array(signature));
}

function readCookie(request: Request, name: string) {
  const cookie = request.headers.get("cookie") ?? "";
  for (const item of cookie.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === name) return item.slice(separator + 1).trim();
  }
  return "";
}

function cookieSecurity(request: Request) {
  return new URL(request.url).protocol === "https:" ? "; Secure" : "";
}

function assertAdminOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && origin && origin !== new URL(request.url).origin) {
    throw new AdminAuthError("请求来源无效", 403);
  }
}

async function hasCreatorSession(request: Request) {
  const secret = values().CREATOR_SESSION_SECRET;
  if (!secret || !creatorAuthConfigured()) return false;
  const [version, expiresAtText, signature] = readCookie(request, SESSION_COOKIE).split(".");
  const expiresAt = Number(expiresAtText);
  if (version !== SESSION_VERSION || !Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000) || !signature) {
    return false;
  }
  const expected = await signSession(`${version}.${expiresAt}`, secret);
  return constantTimeEqual(signature, expected);
}

export function creatorAuthConfigured() {
  const { CREATOR_PASSWORD_HASH, CREATOR_SESSION_SECRET } = values();
  return Boolean(
    CREATOR_PASSWORD_HASH?.match(/^[a-f0-9]{64}$/i)
    && CREATOR_SESSION_SECRET
    && CREATOR_SESSION_SECRET.length >= 32,
  );
}

export async function verifyCreatorPassword(password: string) {
  const expected = values().CREATOR_PASSWORD_HASH?.toLowerCase() ?? "";
  if (!creatorAuthConfigured() || !password || password.length > 256) return false;
  return constantTimeEqual(await sha256Hex(password), expected);
}

export async function createCreatorSessionCookie(request: Request) {
  const secret = values().CREATOR_SESSION_SECRET;
  if (!secret || !creatorAuthConfigured()) throw new AdminAuthError("尚未配置创作者登录密钥", 503);
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = `${SESSION_VERSION}.${expiresAt}`;
  const token = `${payload}.${await signSession(payload, secret)}`;
  return `${SESSION_COOKIE}=${token}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}${cookieSecurity(request)}`;
}

export function clearCreatorSessionCookie(request: Request) {
  return `${SESSION_COOKIE}=; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=0${cookieSecurity(request)}`;
}

export async function requireAdmin(request: Request): Promise<AdminIdentity> {
  const config = values();
  const hostname = new URL(request.url).hostname;
  const isLocal = hostname === "localhost" || hostname === "127.0.0.1";
  if (isLocal && config.LOCAL_ADMIN_BYPASS === "true") {
    assertAdminOrigin(request);
    return { role: "admin", email: "local-admin@localhost" };
  }

  if (await hasCreatorSession(request)) {
    assertAdminOrigin(request);
    return { role: "admin", email: "creator" };
  }

  const account = await optionalSession(request);
  if (account?.role === "admin") {
    assertAdminOrigin(request);
    return { role: "admin", email: account.email };
  }

  if (!creatorAuthConfigured()) throw new AdminAuthError("尚未配置创作者登录密钥", 503);
  throw new AdminAuthError("请先登录创作者账号", 401);
}

export class AdminAuthError extends Error {
  constructor(message: string, readonly status = 401) {
    super(message);
  }
}

export function adminAuthResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "管理员认证失败";
  const status = error instanceof AdminAuthError ? error.status : 401;
  return Response.json({ error: message }, {
    status,
    headers: { "cache-control": "no-store" },
  });
}
