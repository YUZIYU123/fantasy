import { AuthError, type SessionIdentity, type UserRole } from "./auth";
import {
  AdminAuthError,
  clearCreatorSessionCookie,
  createCreatorSessionCookie,
  creatorAuthConfigured,
  hasCreatorSession,
  localAdminBypassEnabled,
  verifyCreatorPassword,
} from "./admin-auth";
import { findSessionAccountByToken } from "../db/session-identity";

const creatorAttempts = new Map<string, { count: number; resetAt: number }>();
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const ATTEMPT_LIMIT = 8;

export class AdministratorCapabilityError extends AdminAuthError {
  constructor(message: string, status: number, readonly retryAfter?: number) { super(message, status); }
}

async function authenticateSharedCredential(request: Request, password: string) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new AdministratorCapabilityError("请求来源无效", 403);
  if (!creatorAuthConfigured()) throw new AdministratorCapabilityError("尚未配置创作者登录密钥", 503);
  const key = request.headers.get("cf-connecting-ip") || "unknown";
  const now = Date.now();
  const current = creatorAttempts.get(key);
  const state = !current || current.resetAt <= now ? { count: 0, resetAt: now + ATTEMPT_WINDOW_MS } : current;
  if (state.count >= ATTEMPT_LIMIT) {
    throw new AdministratorCapabilityError("登录尝试过多，请稍后再试", 429, Math.ceil((state.resetAt - now) / 1000));
  }
  if (!await verifyCreatorPassword(password)) {
    state.count += 1;
    creatorAttempts.set(key, state);
    throw new AdministratorCapabilityError("创作者密码不正确", 401);
  }
  creatorAttempts.delete(key);
  return createCreatorSessionCookie(request);
}

function assertAdministratorOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && origin && origin !== new URL(request.url).origin) {
    throw new AdministratorCapabilityError("请求来源无效", 403);
  }
}

function sessionToken(request: Request) {
  const cookie = request.headers.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === "mist_session") return decodeURIComponent(rest.join("="));
  }
  return "";
}

async function optionalSessionIdentity(request: Request): Promise<SessionIdentity | null> {
  const token = sessionToken(request);
  if (!token) return null;
  const account = await findSessionAccountByToken(token);
  if (!account || account.status !== "active" || new Date(account.expiresAt).getTime() <= Date.now()) return null;
  return {
    id: account.id,
    email: account.email,
    displayName: account.displayName,
    role: account.role,
    status: account.status,
  };
}

async function requireSessionIdentity(request: Request) {
  const identity = await optionalSessionIdentity(request);
  if (!identity) throw new AuthError("请先登录", 401);
  return identity;
}

async function requireSessionRole(request: Request, roles: UserRole[]) {
  const identity = await requireSessionIdentity(request);
  if (!roles.includes(identity.role)) throw new AuthError("当前账号没有此操作权限", 403);
  return identity;
}

async function requireAdministrator(request: Request) {
  assertAdministratorOrigin(request);
  if (localAdminBypassEnabled(request)) return { role: "admin" as const, email: "local-admin@localhost" };
  if (await hasCreatorSession(request)) return { role: "admin" as const, email: "creator" };
  const account = await optionalSessionIdentity(request);
  if (account?.role === "admin") return { role: "admin" as const, email: account.email };
  if (!creatorAuthConfigured()) throw new AdministratorCapabilityError("尚未配置创作者登录密钥", 503);
  throw new AdministratorCapabilityError("请先登录创作者账号", 401);
}

export const sessionAuthorization = {
  optional: optionalSessionIdentity,
  require: requireSessionIdentity,
  async requireRole(request: Request, roles: UserRole[]) {
    return requireSessionRole(request, roles);
  },
  requireAdministrator,
  authenticateSharedCredential,
  clearSharedCredential: clearCreatorSessionCookie,
};
