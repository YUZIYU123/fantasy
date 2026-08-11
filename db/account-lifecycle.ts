import { sendAuthEmail, validateTurnstile } from "./account-providers";
import { enforceRateLimit } from "./rate-limit";
import { drizzleD1AccountStore, type AccountStore } from "./account-store";
import {
  AuthError,
  assertSameOrigin,
  hashPassword,
  hashToken,
  normalizeEmail,
  validatePassword,
  verifyPassword,
  type UserRole,
  type UserStatus,
  AUTH_SESSION_COOKIE,
  randomToken,
} from "../lib/auth";
import { registrationResumeDirective, type RegistrationIntent } from "../lib/registration-intent";
import {
  workerRegistrationTelemetry,
  type RegistrationTelemetry,
  type RegistrationTelemetryEvent,
} from "../lib/registration-telemetry";
import { normalizeReaderPreferences } from "../lib/terminal";

const SESSION_DAYS = 30;

function cookieValue(request: Request, name: string) {
  const cookie = request.headers.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

export interface TurnstileVerifier {
  verify(request: Request, token: string, action: string, attempt?: ExternalAttempt): Promise<void>;
}

export interface AuthMailer {
  send(request: Request, to: string, type: "verify_email" | "reset_password", token: string, attempt?: ExternalAttempt): Promise<{ developmentToken?: string }>;
}

type ExternalAttempt = { signal: AbortSignal; idempotencyKey: string; allowedHostnames: string[] };

export const productionTurnstileVerifier: TurnstileVerifier = { verify: validateTurnstile };
export const productionAuthMailer: AuthMailer = { send: sendAuthEmail };

export class MockTurnstileVerifier implements TurnstileVerifier {
  readonly calls: Array<{ token: string; action: string }> = [];
  readonly idempotencyKeys: string[] = [];
  constructor(private readonly failure?: Error, private readonly hangs = false) {}
  async verify(_request: Request, token: string, action: string, attempt?: ExternalAttempt) {
    this.calls.push({ token, action });
    if (attempt) this.idempotencyKeys.push(attempt.idempotencyKey);
    if (this.failure) throw this.failure;
    if (this.hangs) await waitForAbort(attempt?.signal);
  }
}

export class MockAuthMailer implements AuthMailer {
  readonly calls: Array<{ to: string; type: "verify_email" | "reset_password"; token: string }> = [];
  readonly idempotencyKeys: string[] = [];
  constructor(
    private readonly result: { developmentToken?: string } = {},
    private readonly failure?: Error,
    private readonly hangs = false,
  ) {}
  async send(_request: Request, to: string, type: "verify_email" | "reset_password", token: string, attempt?: ExternalAttempt) {
    this.calls.push({ to, type, token });
    if (attempt) this.idempotencyKeys.push(attempt.idempotencyKey);
    if (this.failure) throw this.failure;
    if (this.hangs) await waitForAbort(attempt?.signal);
    return this.result;
  }
}

function waitForAbort(signal?: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal?.aborted) reject(new Error("external request aborted"));
    else signal?.addEventListener("abort", () => reject(new Error("external request aborted")), { once: true });
  });
}

async function executeExternal<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  retries: number,
  timeoutError: () => AuthError,
) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await operation(controller.signal);
    } catch (error) {
      if (attempt === retries) {
        if (controller.signal.aborted) throw timeoutError();
        throw error;
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  throw timeoutError();
}

export type AccountCommand =
  | {
    action: "register";
    request: Request;
    email: string;
    displayName: string;
    password: string;
    turnstileToken: string;
    ageConfirmed?: boolean;
    termsAccepted?: boolean;
    privacyAccepted?: boolean;
    analyticsAllowed?: boolean;
    operationId?: string;
    retryingUncertain?: boolean;
    operationToken?: string;
    externalIdempotencyBase?: string;
  }
  | { action: "inspect-email-verification"; token: string; actorId?: string }
  | { action: "activate-account"; request: Request; token: string; intent?: RegistrationIntent | null; analyticsAllowed?: boolean }
  | {
    action: "resend-verification";
    request: Request;
    email: string;
    turnstileToken: string;
    analyticsAllowed?: boolean;
    operationId?: string;
    retryingUncertain?: boolean;
    operationToken?: string;
    externalIdempotencyBase?: string;
  }
  | {
    action: "restart-registration";
    request: Request;
    currentEmail: string;
    email: string;
    displayName: string;
    password: string;
    turnstileToken: string;
    ageConfirmed?: boolean;
    termsAccepted?: boolean;
    privacyAccepted?: boolean;
    analyticsAllowed?: boolean;
    operationId?: string;
    retryingUncertain?: boolean;
    operationToken?: string;
    externalIdempotencyBase?: string;
  }
  | { action: "record-registration-event"; analyticsAllowed?: boolean; event: RegistrationTelemetryEvent }
  | { action: "get-guide-memory"; actorId: string }
  | { action: "update-guide-memory"; actorId: string; preferences: unknown; completeGuide: boolean }
  | { action: "clear-guide-memory"; actorId: string }
  | { action: "set-registration-analytics-preference"; actorId: string; allowed: boolean }
  | { action: "get-registration-outcome"; operationId: string }
  | { action: "cleanup-expired-pending-accounts" }
  | { action: "verify-email"; request: Request; token: string }
  | { action: "login"; request: Request; email: string; password: string }
  | { action: "forgot-password"; request: Request; email: string; turnstileToken: string }
  | { action: "reset-password"; request: Request; token: string; password: string }
  | { action: "profile"; actorId: string; displayName: string }
  | { action: "logout"; request: Request }
  | { action: "list-users" }
  | { action: "update-user"; id: string; role?: UserRole; status?: Extract<UserStatus, "active" | "disabled"> };

export type AccountResult = {
  status?: number;
  body: Record<string, unknown>;
  cookie?: string;
};

export type AccountRegistrationConfig = {
  registrationEnabled: boolean;
  termsVersion: string;
  privacyVersion: string;
  allowedHostnames: string[];
};

const testRegistrationConfig: AccountRegistrationConfig = {
  registrationEnabled: true,
  termsVersion: "development",
  privacyVersion: "development",
  allowedHostnames: ["localhost", "127.0.0.1"],
};

function validEmail(value: string) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function createAccountLifecycle({
  config = testRegistrationConfig,
  store = drizzleD1AccountStore,
  turnstile = productionTurnstileVerifier,
  mailer = productionAuthMailer,
  externalTimeoutMs = 8_000,
  externalRetries = 1,
  verificationTokenLifetimeMs = 24 * 60 * 60_000,
  resetTokenLifetimeMs = 30 * 60_000,
  clock = () => new Date(),
  telemetry = workerRegistrationTelemetry,
}: {
  config?: AccountRegistrationConfig;
  store?: AccountStore;
  turnstile?: TurnstileVerifier;
  mailer?: AuthMailer;
  externalTimeoutMs?: number;
  externalRetries?: number;
  verificationTokenLifetimeMs?: number;
  resetTokenLifetimeMs?: number;
  clock?: () => Date;
  telemetry?: RegistrationTelemetry;
} = {}) {
  async function createSession(userId: string, request: Request) {
    const token = randomToken();
    const expiresAt = new Date(clock().getTime() + SESSION_DAYS * 86_400_000).toISOString();
    await store.createSession({ id: crypto.randomUUID(), userId, tokenHash: await hashToken(token), expiresAt });
    const secure = new URL(request.url).protocol === "https:";
    return `${AUTH_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}${secure ? "; Secure" : ""}`;
  }

  async function revokeCurrentSession(request: Request) {
    const token = cookieValue(request, AUTH_SESSION_COOKIE);
    if (token) await store.revokeSession(await hashToken(token));
  }

  async function createPasswordResetToken(userId: string) {
    const token = randomToken();
    await store.createPasswordResetToken({
      id: crypto.randomUUID(), userId, tokenHash: await hashToken(token), type: "reset_password",
      expiresAt: new Date(clock().getTime() + resetTokenLifetimeMs).toISOString(),
    });
    return token;
  }

  async function consumePasswordReset(token: string, passwordHash: string) {
    const now = clock().toISOString();
    const consumed = await store.consumePasswordReset({
      tokenHash: await hashToken(token),
      usedMarker: `${now}:${crypto.randomUUID()}`,
      now,
      passwordHash,
    });
    if (!consumed) throw new AuthError("链接无效或已过期");
  }

  async function recordIfAllowed(allowed: boolean | undefined, event: RegistrationTelemetryEvent) {
    if (allowed === true) await telemetry.record(event);
  }

  async function executeWithReceipt(
    operationId: string,
    kind: "register" | "resend" | "restart",
    requestHash: string,
    operation: (retryingUncertain: boolean, operationToken: string, externalIdempotencyBase: string) => Promise<AccountResult>,
  ): Promise<AccountResult> {
    if (!operationId || operationId.length > 128) throw new AuthError("操作标识无效");
    const idempotencyHash = await hashToken(operationId);
    const operationToken = await hashToken(`verification:${operationId}`);
    const externalIdempotencyBase = await hashToken(`external:${operationId}`);
    let receipt = await store.findOperationReceipt(idempotencyHash);
    const receiptBody = receipt ? JSON.parse(receipt.resultJson) as {
      requestHash?: string;
      result?: AccountResult;
      failure?: { error?: string; status?: number; retryAfterSeconds?: number };
    } : null;
    if (receipt && (receipt.kind !== kind || receiptBody?.requestHash !== requestHash)) {
      throw new AuthError("操作标识与当前请求不匹配，请重新提交", 409, undefined, "operation_mismatch");
    }
    if (receipt?.status === "succeeded" && receiptBody?.result) return receiptBody.result;
    if (receipt?.status === "failed") {
      const failure = receiptBody?.failure || {};
      throw new AuthError(failure.error || "账号操作失败", failure.status || 400, failure.retryAfterSeconds);
    }
    if (receipt?.status === "processing") return { status: 202, body: { state: "processing" } };
    let retryingUncertain = false;
    if (receipt?.status === "uncertain") {
      retryingUncertain = await store.claimUncertainOperationReceipt(idempotencyHash, clock().toISOString());
      if (!retryingUncertain) return { status: 202, body: { state: "processing" } };
    }
    const nowDate = clock();
    if (!receipt) {
      try {
        await store.createOperationReceipt({
          id: crypto.randomUUID(), idempotencyHash, kind, status: "processing", resultJson: JSON.stringify({ requestHash }),
          expiresAt: new Date(nowDate.getTime() + 24 * 60 * 60_000).toISOString(), updatedAt: nowDate.toISOString(),
        });
      } catch {
        receipt = await store.findOperationReceipt(idempotencyHash);
        if (receipt) return executeWithReceipt(operationId, kind, requestHash, operation);
        throw new AuthError("账号操作暂时不可用", 503);
      }
    }
    try {
      const result = await operation(retryingUncertain, operationToken, externalIdempotencyBase);
      const safeBody = { ...result.body };
      delete safeBody.developmentToken;
      const storedResult = { ...result, body: safeBody };
      await store.finishOperationReceipt(idempotencyHash, {
        status: "succeeded", resultJson: JSON.stringify({ requestHash, result: storedResult }), updatedAt: clock().toISOString(),
      });
      return result;
    } catch (error) {
      const authError = error instanceof AuthError ? error : new AuthError("账号操作失败", 500);
      await store.finishOperationReceipt(idempotencyHash, {
        status: authError.status === 504 ? "uncertain" : "failed",
        resultJson: JSON.stringify({ requestHash, failure: {
          error: authError.message, status: authError.status, retryAfterSeconds: authError.retryAfterSeconds,
        } }),
        updatedAt: clock().toISOString(),
      });
      throw error;
    }
  }

  async function execute(command: AccountCommand): Promise<AccountResult> {
    if ("request" in command) assertSameOrigin(command.request);
    if (command.action === "record-registration-event") {
      await recordIfAllowed(command.analyticsAllowed, command.event);
      return { body: { ok: true } };
    }
    if (command.action === "cleanup-expired-pending-accounts") {
      return { body: await store.cleanupExpired(clock().toISOString()) };
    }
    if (command.action === "get-guide-memory") {
      const preference = await store.findAccountPreferences(command.actorId);
      return { body: { memory: {
        preferences: normalizeReaderPreferences(preference ? JSON.parse(preference.readingPreferencesJson) : []),
        guideCompletedAt: preference?.guideCompletedAt ?? null,
        updatedAt: preference?.updatedAt ?? null,
        registrationAnalyticsAllowed: preference?.registrationAnalyticsAllowed ?? false,
      } } };
    }
    if (command.action === "update-guide-memory") {
      if (!command.completeGuide) throw new AuthError("需要明确确认同步阅读偏好");
      const preferences = normalizeReaderPreferences(command.preferences);
      const now = clock().toISOString();
      await store.updateGuideMemory({
        userId: command.actorId,
        readingPreferencesJson: JSON.stringify(preferences),
        guideCompletedAt: now,
        updatedAt: now,
      });
      return execute({ action: "get-guide-memory", actorId: command.actorId });
    }
    if (command.action === "clear-guide-memory") {
      await store.clearGuideMemory(command.actorId, clock().toISOString());
      return execute({ action: "get-guide-memory", actorId: command.actorId });
    }
    if (command.action === "set-registration-analytics-preference") {
      await store.setRegistrationAnalyticsPreference(command.actorId, command.allowed, clock().toISOString());
      return execute({ action: "get-guide-memory", actorId: command.actorId });
    }
    if (command.action === "get-registration-outcome") {
      if (!command.operationId || command.operationId.length > 128) throw new AuthError("操作标识无效");
      const receipt = await store.findOperationReceipt(await hashToken(command.operationId));
      if (!receipt) return { body: { state: "not_found" } };
      const stored = JSON.parse(receipt.resultJson) as { result?: AccountResult; failure?: Record<string, unknown> };
      if (receipt.status === "succeeded") return { body: { state: "succeeded", result: stored.result || {} } };
      if (receipt.status === "failed") return { body: { state: "failed", result: stored.failure || {} } };
      return { body: { state: receipt.status === "processing" ? "processing" : "uncertain" } };
    }
    if (command.action === "register" && command.operationId) {
      const requestHash = await hashToken(JSON.stringify({
        kind: "register", email: normalizeEmail(command.email), displayName: command.displayName.trim(),
        passwordHash: await hashToken(command.password), ageConfirmed: command.ageConfirmed === true,
        termsAccepted: command.termsAccepted === true, privacyAccepted: command.privacyAccepted === true,
        analyticsAllowed: command.analyticsAllowed === true, termsVersion: config.termsVersion, privacyVersion: config.privacyVersion,
      }));
      return executeWithReceipt(command.operationId, "register", requestHash, (retryingUncertain, operationToken, externalIdempotencyBase) => execute({
        ...command, operationId: undefined, retryingUncertain, operationToken, externalIdempotencyBase,
      }));
    }
    if (command.action === "resend-verification" && command.operationId) {
      const requestHash = await hashToken(JSON.stringify({
        kind: "resend", email: normalizeEmail(command.email), analyticsAllowed: command.analyticsAllowed === true,
      }));
      return executeWithReceipt(command.operationId, "resend", requestHash, (retryingUncertain, operationToken, externalIdempotencyBase) => execute({
        ...command, operationId: undefined, retryingUncertain, operationToken, externalIdempotencyBase,
      }));
    }
    if (command.action === "restart-registration" && command.operationId) {
      const requestHash = await hashToken(JSON.stringify({
        kind: "restart", currentEmail: normalizeEmail(command.currentEmail), email: normalizeEmail(command.email),
        displayName: command.displayName.trim(), passwordHash: await hashToken(command.password),
        ageConfirmed: command.ageConfirmed === true, termsAccepted: command.termsAccepted === true,
        privacyAccepted: command.privacyAccepted === true, analyticsAllowed: command.analyticsAllowed === true,
        termsVersion: config.termsVersion, privacyVersion: config.privacyVersion,
      }));
      return executeWithReceipt(command.operationId, "restart", requestHash, (retryingUncertain, operationToken, externalIdempotencyBase) => execute({
        ...command, operationId: undefined, retryingUncertain, operationToken, externalIdempotencyBase,
      }));
    }
    if (command.action === "register") {
      if (!config.registrationEnabled) throw new AuthError("账号注册尚未开放", 503);
      if (!command.ageConfirmed) throw new AuthError("需要确认已满十四周岁");
      if (!command.termsAccepted || !command.privacyAccepted) throw new AuthError("需要确认服务条款和隐私政策");
      const email = normalizeEmail(command.email);
      const displayName = command.displayName.trim();
      if (!validEmail(email)) throw new AuthError("请输入有效邮箱");
      if (!displayName || displayName.length > 40) throw new AuthError("昵称需要为 1–40 个字符");
      const passwordError = validatePassword(command.password);
      if (passwordError) throw new AuthError(passwordError);
      await enforceRateLimit(command.request, "registration-email", email, 5, 30, clock);
      const turnstileIdempotencyKey = command.externalIdempotencyBase
        ? `${command.externalIdempotencyBase}:turnstile`
        : crypto.randomUUID();
      await executeExternal(
        (signal) => turnstile.verify(command.request, command.turnstileToken, "register", {
          signal, idempotencyKey: turnstileIdempotencyKey, allowedHostnames: config.allowedHostnames,
        }),
        externalTimeoutMs, externalRetries, () => new AuthError("人机验证超时，请重试", 504),
      );
      const existing = await store.findByEmail(email);
      if (existing && !(command.retryingUncertain && existing.status === "pending")) {
        throw new AuthError(existing.status === "pending" ? "账号正在等待邮箱确认" : "此邮箱已注册", 409);
      }
      const userId = existing?.id || crypto.randomUUID();
      const nowDate = clock();
      const now = nowDate.toISOString();
      const token = command.operationToken || randomToken();
      if (!existing) {
        await store.createPendingRegistration({
          user: {
            id: userId,
            email,
            displayName,
            passwordHash: await hashPassword(command.password),
            role: "reader",
            status: "pending",
            pendingExpiresAt: new Date(nowDate.getTime() + 7 * 86_400_000).toISOString(),
          },
          consent: {
            id: crypto.randomUUID(), userId, ageConfirmedAt: now,
            termsVersion: config.termsVersion, privacyVersion: config.privacyVersion, confirmedAt: now,
          },
          preference: {
            userId, registrationAnalyticsAllowed: command.analyticsAllowed === true, updatedAt: now,
          },
          token: {
            id: crypto.randomUUID(), userId, tokenHash: await hashToken(token), type: "verify_email",
            expiresAt: new Date(nowDate.getTime() + verificationTokenLifetimeMs).toISOString(),
          },
        });
      }
      const mailIdempotencyKey = command.externalIdempotencyBase
        ? `${command.externalIdempotencyBase}:mail`
        : crypto.randomUUID();
      const delivery = await executeExternal(
        (signal) => mailer.send(command.request, email, "verify_email", token, {
          signal, idempotencyKey: mailIdempotencyKey, allowedHostnames: config.allowedHostnames,
        }),
        externalTimeoutMs, externalRetries, () => new AuthError("邮件发送超时，请稍后重试", 504),
      );
      const sentDate = clock();
      const sentAt = sentDate.toISOString();
      await store.markVerificationSent(userId, sentAt, new Date(sentDate.getTime() + 7 * 86_400_000).toISOString());
      await recordIfAllowed(command.analyticsAllowed, { flow: "register", stage: "mail_delivery", outcome: "succeeded" });
      return {
        status: 201,
        body: { ok: true, state: "awaiting_email", accountStatus: "pending", message: "验证邮件已发送", ...delivery },
      };
    }
    if (command.action === "resend-verification") {
      if (!config.registrationEnabled) throw new AuthError("账号注册尚未开放", 503);
      const email = normalizeEmail(command.email);
      if (!validEmail(email)) throw new AuthError("请输入有效邮箱");
      const account = await store.findByEmail(email);
      if (!account) return { body: { ok: true, state: "recovery_unavailable" } };
      if (account.status === "active") return {
        status: 409,
        body: { state: "existing_account", nextActions: ["login", "forgot-password"] },
      };
      if (account.status === "disabled") throw new AuthError("账号当前不可用", 403);
      const nowDate = clock();
      if (typeof command.analyticsAllowed === "boolean") {
        await store.setRegistrationAnalyticsPreference(account.id, command.analyticsAllowed, nowDate.toISOString());
      }
      if (account.lastVerificationSentAt) {
        const remainingMs = 60_000 - (nowDate.getTime() - Date.parse(account.lastVerificationSentAt));
        if (remainingMs > 0) throw new AuthError("请稍后再发送验证邮件", 429, Math.ceil(remainingMs / 1000));
      }
      await enforceRateLimit(command.request, "registration-email", email, 5, 30, clock);
      const turnstileIdempotencyKey = command.externalIdempotencyBase
        ? `${command.externalIdempotencyBase}:turnstile`
        : crypto.randomUUID();
      await executeExternal(
        (signal) => turnstile.verify(command.request, command.turnstileToken, "resend-verification", {
          signal, idempotencyKey: turnstileIdempotencyKey, allowedHostnames: config.allowedHostnames,
        }),
        externalTimeoutMs, externalRetries, () => new AuthError("人机验证超时，请重试", 504),
      );
      const token = command.operationToken || randomToken();
      if (!command.retryingUncertain) {
        await store.createEmailVerificationToken({
          id: crypto.randomUUID(),
          userId: account.id,
          tokenHash: await hashToken(token),
          type: "verify_email",
          expiresAt: new Date(nowDate.getTime() + verificationTokenLifetimeMs).toISOString(),
        });
      }
      const mailIdempotencyKey = command.externalIdempotencyBase
        ? `${command.externalIdempotencyBase}:mail`
        : crypto.randomUUID();
      const delivery = await executeExternal(
        (signal) => mailer.send(command.request, email, "verify_email", token, {
          signal, idempotencyKey: mailIdempotencyKey, allowedHostnames: config.allowedHostnames,
        }),
        externalTimeoutMs, externalRetries, () => new AuthError("邮件发送超时，请稍后重试", 504),
      );
      const sentDate = clock();
      await store.markVerificationSent(account.id, sentDate.toISOString(), new Date(sentDate.getTime() + 7 * 86_400_000).toISOString());
      await recordIfAllowed(command.analyticsAllowed, { flow: "resend", stage: "mail_delivery", outcome: "succeeded" });
      return { body: { ok: true, state: "awaiting_email", resent: true, message: "验证邮件已重新发送", ...delivery } };
    }
    if (command.action === "restart-registration") {
      if (!config.registrationEnabled) throw new AuthError("账号注册尚未开放", 503);
      if (!command.ageConfirmed) throw new AuthError("需要确认已满十四周岁");
      if (!command.termsAccepted || !command.privacyAccepted) throw new AuthError("需要确认服务条款和隐私政策");
      const currentEmail = normalizeEmail(command.currentEmail);
      const email = normalizeEmail(command.email);
      const displayName = command.displayName.trim();
      if (!validEmail(currentEmail) || !validEmail(email)) throw new AuthError("请输入有效邮箱");
      if (!displayName || displayName.length > 40) throw new AuthError("昵称需要为 1–40 个字符");
      const passwordError = validatePassword(command.password);
      if (passwordError) throw new AuthError(passwordError);
      const account = await store.findByEmail(command.retryingUncertain ? email : currentEmail);
      if (!account || account.status !== "pending") throw new AuthError("待验证账号不可恢复", 409);
      const conflicting = await store.findByEmail(email);
      if (conflicting && conflicting.id !== account.id) throw new AuthError("此邮箱已注册", 409);
      await enforceRateLimit(command.request, "registration-email", currentEmail, 5, 30, clock);
      const turnstileIdempotencyKey = command.externalIdempotencyBase
        ? `${command.externalIdempotencyBase}:turnstile`
        : crypto.randomUUID();
      await executeExternal(
        (signal) => turnstile.verify(command.request, command.turnstileToken, "restart-registration", {
          signal, idempotencyKey: turnstileIdempotencyKey, allowedHostnames: config.allowedHostnames,
        }),
        externalTimeoutMs, externalRetries, () => new AuthError("人机验证超时，请重试", 504),
      );
      const nowDate = clock();
      const now = nowDate.toISOString();
      const token = command.operationToken || randomToken();
      if (!command.retryingUncertain) {
        const updated = await store.restartPendingRegistration({
          userId: account.id,
          email,
          displayName,
          passwordHash: await hashPassword(command.password),
          consent: {
            ageConfirmedAt: now, termsVersion: config.termsVersion,
            privacyVersion: config.privacyVersion, confirmedAt: now,
          },
          analyticsAllowed: command.analyticsAllowed === true,
          revokedMarker: `revoked:${now}:${crypto.randomUUID()}`,
          token: {
            id: crypto.randomUUID(), userId: account.id, tokenHash: await hashToken(token),
            type: "verify_email", expiresAt: new Date(nowDate.getTime() + verificationTokenLifetimeMs).toISOString(),
          },
        });
        if (!updated) throw new AuthError("账号状态已经变化，请重新开始", 409);
      }
      const mailIdempotencyKey = command.externalIdempotencyBase
        ? `${command.externalIdempotencyBase}:mail`
        : crypto.randomUUID();
      const delivery = await executeExternal(
        (signal) => mailer.send(command.request, email, "verify_email", token, {
          signal, idempotencyKey: mailIdempotencyKey, allowedHostnames: config.allowedHostnames,
        }),
        externalTimeoutMs, externalRetries, () => new AuthError("邮件发送超时，请稍后重试", 504),
      );
      const sentDate = clock();
      await store.markVerificationSent(account.id, sentDate.toISOString(), new Date(sentDate.getTime() + 7 * 86_400_000).toISOString());
      await recordIfAllowed(command.analyticsAllowed, { flow: "restart", stage: "mail_delivery", outcome: "succeeded" });
      return { body: { ok: true, state: "awaiting_email", restarted: true, message: "账号注册已重新开始", ...delivery } };
    }
    if (command.action === "inspect-email-verification") {
      if (!command.token || command.token.length > 256) return { body: { state: "invalid" } };
      const inspection = await store.inspectEmailVerification(await hashToken(command.token), clock().toISOString());
      return { body: {
        state: inspection.state === "used" && inspection.userId === command.actorId ? "active_session" : inspection.state,
      } };
    }
    if (command.action === "activate-account") {
      if (!command.token || command.token.length > 256) throw new AuthError("验证链接无效");
      const nowDate = clock();
      const now = nowDate.toISOString();
      const sessionToken = randomToken();
      const sessionExpiresAt = new Date(nowDate.getTime() + SESSION_DAYS * 86_400_000).toISOString();
      const user = await store.activateAccount({
        tokenHash: await hashToken(command.token),
        usedMarker: `${now}:${crypto.randomUUID()}`,
        now,
        session: {
          id: crypto.randomUUID(),
          tokenHash: await hashToken(sessionToken),
          expiresAt: sessionExpiresAt,
        },
      });
      if (!user) throw new AuthError("验证链接无效或已过期");
      if (typeof command.analyticsAllowed === "boolean") {
        await store.setRegistrationAnalyticsPreference(user.id, command.analyticsAllowed, now);
      }
      await recordIfAllowed(command.analyticsAllowed, {
        flow: "activate", stage: "account_activation", outcome: "succeeded",
      });
      await recordIfAllowed(command.analyticsAllowed, {
        flow: "activate", stage: "intent_resume", outcome: command.intent ? "succeeded" : "skipped",
      });
      const secure = new URL(command.request.url).protocol === "https:";
      return {
        body: {
          ok: true,
          state: "active",
          user: { id: user.id, displayName: user.displayName, role: user.role, status: user.status },
          resumeDirective: registrationResumeDirective(command.intent),
        },
        cookie: `${AUTH_SESSION_COOKIE}=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}${secure ? "; Secure" : ""}`,
      };
    }
    if (command.action === "verify-email") {
      return execute({ action: "activate-account", request: command.request, token: command.token });
    }
    if (command.action === "login") {
      const email = normalizeEmail(command.email);
      if (email.length > 254) throw new AuthError("邮箱格式无效");
      await enforceRateLimit(command.request, "login", email, 10, 15, clock);
      const user = await store.findByEmail(email);
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
      await enforceRateLimit(command.request, "forgot-password", email, 4, 60, clock);
      const turnstileIdempotencyKey = crypto.randomUUID();
      await executeExternal(
        (signal) => turnstile.verify(command.request, command.turnstileToken, "forgot-password", {
          signal, idempotencyKey: turnstileIdempotencyKey, allowedHostnames: config.allowedHostnames,
        }),
        externalTimeoutMs, externalRetries, () => new AuthError("人机验证超时，请重试", 504),
      );
      const user = await store.findByEmail(email);
      let developmentToken: string | undefined;
      if (user?.status === "active") {
        try {
          const token = await createPasswordResetToken(user.id);
          const mailIdempotencyKey = crypto.randomUUID();
          developmentToken = (await executeExternal(
            (signal) => mailer.send(command.request, email, "reset_password", token, {
              signal, idempotencyKey: mailIdempotencyKey, allowedHostnames: config.allowedHostnames,
            }),
            externalTimeoutMs, externalRetries, () => new AuthError("邮件发送超时，请稍后重试", 504),
          )).developmentToken;
        } catch {
          // Password recovery intentionally returns the same response for every address.
        }
      }
      return { body: { ok: true, message: "如果账号存在，重置邮件已经发送", ...(developmentToken ? { developmentToken } : {}) } };
    }
    if (command.action === "reset-password") {
      const passwordError = validatePassword(command.password);
      if (passwordError) throw new AuthError(passwordError);
      if (!command.token || command.token.length > 256) throw new AuthError("重置链接无效");
      const passwordHash = await hashPassword(command.password);
      await consumePasswordReset(command.token, passwordHash);
      return { body: { ok: true } };
    }
    if (command.action === "profile") {
      const displayName = command.displayName.trim();
      if (!displayName || displayName.length > 40) throw new AuthError("昵称需要为 1–40 个字符");
      await store.updateDisplayName(command.actorId, displayName, clock().toISOString());
      return { body: { ok: true } };
    }
    if (command.action === "logout") {
      await revokeCurrentSession(command.request);
      return { body: { ok: true } };
    }
    if (command.action === "list-users") {
      const rows = await store.listUsers();
      return { body: { users: rows.map((user) => ({
        id: user.id, email: user.email, displayName: user.displayName, role: user.role, status: user.status,
        emailVerifiedAt: user.emailVerifiedAt, createdAt: user.createdAt, updatedAt: user.updatedAt,
      })) } };
    }
    const user = await store.findById(command.id);
    if (!user) throw new AuthError("用户不存在", 404);
    const role = command.role && ["reader", "author", "admin"].includes(command.role) ? command.role : undefined;
    const status = command.status && ["active", "disabled"].includes(command.status) ? command.status : undefined;
    if (!role && !status) throw new AuthError("没有可更新的字段");
    await store.updateUser({ id: command.id, role, status, updatedAt: clock().toISOString() });
    return { body: { ok: true } };
  }
  return { execute, registrationConfig: () => ({ ...config, allowedHostnames: [...config.allowedHostnames] }) };
}

export const accountLifecycle = createAccountLifecycle();
