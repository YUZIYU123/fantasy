import { AuthError, type SessionIdentity, type UserRole } from "./auth.ts";

export type CreatorAccessSurface = "entry" | "admin_workspace" | "author_workspace";
export type CreatorEntryReason = "local_admin" | "admin_account" | "shared_credential" | "author_account" | "reader_account" | "signed_out";
export type AdministratorSource = "local_bypass" | "account" | "shared_credential";
export type AdministratorIdentity = {
  role: "admin";
  email: string;
  source: AdministratorSource;
};

export type CreatorAccessDecision = {
  outcome: "allow" | "redirect" | "deny";
  destination: "admin" | "studio" | null;
  redirectTo: "/admin" | "/studio" | "/login?next=/creator" | null;
  reason: CreatorEntryReason;
  accountRole: UserRole | null;
  source: AdministratorSource | null;
  administrator: AdministratorIdentity | null;
  recoveryAvailable: boolean;
};

export type SharedCredentialAdapter = {
  configured(): boolean;
  hasSession(request: Request): Promise<boolean>;
  verify(password: string): Promise<boolean>;
  createSessionCookie(request: Request): Promise<string>;
  clearSessionCookie(request: Request): string;
};

export type SessionAccountRecord = SessionIdentity & { expiresAt: string };

export type CreatorContentResult = "loaded" | "access_stale" | "failed";
export type CreatorWorkspaceAccessState = {
  status: "resolving" | "ready" | "denied" | "navigating" | "access_error" | "content_error";
  staleRetries: number;
  decision?: CreatorAccessDecision;
  effect: { type: "check_access" } | { type: "load_content" } | { type: "navigate"; to: string } | null;
};
export type CreatorWorkspaceAccessEvent =
  | { type: "access_resolved"; decision: CreatorAccessDecision }
  | { type: "access_failed" }
  | { type: "content_resolved"; result: CreatorContentResult };

export function startCreatorWorkspaceAccess(): CreatorWorkspaceAccessState {
  return { status: "resolving", staleRetries: 0, effect: { type: "check_access" } };
}

export function advanceCreatorWorkspaceAccess(
  state: CreatorWorkspaceAccessState,
  event: CreatorWorkspaceAccessEvent,
): CreatorWorkspaceAccessState {
  if (event.type === "access_failed") {
    return { ...state, status: "access_error", effect: null };
  }
  if (event.type === "access_resolved") {
    const { decision } = event;
    if (decision.redirectTo) {
      return { ...state, status: "navigating", decision, effect: { type: "navigate", to: decision.redirectTo } };
    }
    if (decision.outcome !== "allow") {
      return { ...state, status: "denied", decision, effect: null };
    }
    return { ...state, status: "resolving", decision, effect: { type: "load_content" } };
  }
  if (event.result === "loaded") return { ...state, status: "ready", effect: null };
  if (event.result === "failed") return { ...state, status: "content_error", effect: null };
  if (state.staleRetries >= 1) return { ...state, status: "access_error", effect: null };
  return { status: "resolving", staleRetries: state.staleRetries + 1, effect: { type: "check_access" } };
}

export function resumeCreatorWorkspaceAccess(result: CreatorContentResult) {
  return advanceCreatorWorkspaceAccess(
    { status: "ready", staleRetries: 0, effect: null },
    { type: "content_resolved", result },
  );
}

export class SessionAuthorizationError extends AuthError {
  readonly retryAfter?: number;

  constructor(message: string, status = 401, retryAfter?: number) {
    super(message, status);
    this.retryAfter = retryAfter;
  }
}

export function createSessionAuthorization({
  findSessionAccount,
  localAdministratorEnabled,
  sharedCredential,
  now = Date.now,
}: {
  findSessionAccount(token: string): Promise<SessionAccountRecord | null>;
  localAdministratorEnabled(request: Request): boolean;
  sharedCredential: SharedCredentialAdapter;
  now?: () => number;
}) {
  const attempts = new Map<string, { count: number; resetAt: number }>();
  const attemptWindowMs = 15 * 60 * 1000;
  const attemptLimit = 8;

  function sessionToken(request: Request) {
    const cookie = request.headers.get("cookie") || "";
    for (const part of cookie.split(";")) {
      const [key, ...rest] = part.trim().split("=");
      if (key === "mist_session") return decodeURIComponent(rest.join("="));
    }
    return "";
  }

  async function resolveAccount(request: Request): Promise<SessionIdentity | null> {
    const account = await findSessionAccount(sessionToken(request));
    if (!account || account.status !== "active" || new Date(account.expiresAt).getTime() <= now()) return null;
    return {
      id: account.id,
      email: account.email,
      displayName: account.displayName,
      role: account.role,
      status: account.status,
    };
  }

  async function resolveCreatorAccess(
    request: Request,
    surface: CreatorAccessSurface,
  ): Promise<CreatorAccessDecision> {
    if (localAdministratorEnabled(request)) {
      return {
        outcome: surface === "admin_workspace" ? "allow" : "redirect",
        destination: "admin",
        redirectTo: surface === "admin_workspace" ? null : "/admin",
        reason: "local_admin",
        accountRole: null,
        source: "local_bypass",
        administrator: { role: "admin", email: "local-admin@localhost", source: "local_bypass" },
        recoveryAvailable: false,
      };
    }

    if (surface === "admin_workspace" && await sharedCredential.hasSession(request)) {
      return {
        outcome: "allow",
        destination: "admin",
        redirectTo: null,
        reason: "shared_credential",
        accountRole: null,
        source: "shared_credential",
        administrator: { role: "admin", email: "creator", source: "shared_credential" },
        recoveryAvailable: false,
      };
    }

    const account = await resolveAccount(request);
    if (account?.role === "admin") {
      return {
        outcome: surface === "admin_workspace" ? "allow" : "redirect",
        destination: "admin",
        redirectTo: surface === "admin_workspace" ? null : "/admin",
        reason: "admin_account",
        accountRole: "admin",
        source: "account",
        administrator: { role: "admin", email: account.email, source: "account" },
        recoveryAvailable: false,
      };
    }
    if (account?.role === "author") {
      return {
        outcome: surface === "author_workspace" ? "allow" : "redirect",
        destination: "studio",
        redirectTo: surface === "author_workspace" ? null : "/studio",
        reason: "author_account",
        accountRole: "author",
        source: null,
        administrator: null,
        recoveryAvailable: false,
      };
    }
    if (account?.role === "reader") {
      return {
        outcome: "deny",
        destination: null,
        redirectTo: null,
        reason: "reader_account",
        accountRole: "reader",
        source: null,
        administrator: null,
        recoveryAvailable: surface === "admin_workspace" && sharedCredential.configured(),
      };
    }
    return {
      outcome: surface === "entry" ? "redirect" : "deny",
      destination: null,
      redirectTo: surface === "entry" || surface === "author_workspace" ? "/login?next=/creator" : null,
      reason: "signed_out",
      accountRole: null,
      source: null,
      administrator: null,
      recoveryAvailable: surface === "admin_workspace" && sharedCredential.configured(),
    };
  }

  async function requireAdministrator(request: Request): Promise<AdministratorIdentity> {
    const origin = request.headers.get("origin");
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)
      && origin && origin !== new URL(request.url).origin) {
      throw new SessionAuthorizationError("请求来源无效", 403);
    }
    const decision = await resolveCreatorAccess(request, "admin_workspace");
    if (decision.outcome !== "allow" || !decision.administrator) {
      if (decision.accountRole) {
        throw new SessionAuthorizationError("当前账号没有管理员权限", 403);
      }
      throw new SessionAuthorizationError("请先登录管理员账号", 401);
    }
    return decision.administrator;
  }

  async function authenticateSharedCredential(request: Request, password: string) {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) {
      throw new SessionAuthorizationError("请求来源无效", 403);
    }
    if (!sharedCredential.configured()) {
      throw new SessionAuthorizationError("尚未配置创作者登录密钥", 503);
    }
    const key = request.headers.get("cf-connecting-ip") || "unknown";
    const currentTime = now();
    const current = attempts.get(key);
    const state = !current || current.resetAt <= currentTime
      ? { count: 0, resetAt: currentTime + attemptWindowMs }
      : current;
    if (state.count >= attemptLimit) {
      throw new SessionAuthorizationError(
        "登录尝试过多，请稍后再试",
        429,
        Math.ceil((state.resetAt - currentTime) / 1000),
      );
    }
    if (!await sharedCredential.verify(password)) {
      state.count += 1;
      attempts.set(key, state);
      throw new SessionAuthorizationError("创作者密码不正确", 401);
    }
    attempts.delete(key);
    return sharedCredential.createSessionCookie(request);
  }

  async function requireAccount(request: Request) {
    const account = await resolveAccount(request);
    if (!account) throw new AuthError("请先登录", 401);
    return account;
  }

  async function requireRole(request: Request, roles: UserRole[]) {
    const account = await requireAccount(request);
    if (!roles.includes(account.role)) throw new AuthError("当前账号没有此操作权限", 403);
    return account;
  }

  return {
    optional: resolveAccount,
    require: requireAccount,
    requireRole,
    resolveCreatorAccess,
    requireAdministrator,
    authenticateSharedCredential,
    clearSharedCredential: sharedCredential.clearSessionCookie,
  };
}
