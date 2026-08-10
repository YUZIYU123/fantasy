export type UserRole = "reader" | "author" | "admin";
export type UserStatus = "pending" | "active" | "disabled";
export type SessionIdentity = {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
};

export const AUTH_SESSION_COOKIE = "mist_session";
const PASSWORD_ITERATIONS = 210_000;

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

export function clearSessionCookie(request: Request) {
  const secure = new URL(request.url).protocol === "https:";
  return `${AUTH_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new AuthError("请求来源无效", 403);
}

export class AuthError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export function authErrorResponse(error: unknown) {
  if (error instanceof AuthError) return Response.json({ error: error.message }, { status: error.status });
  return Response.json({ error: "账号操作失败" }, { status: 500 });
}
