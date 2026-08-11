import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { createCloudflareRuntime } from "./cloudflare-runtime-harness.mjs";

const port = 43600 + (process.pid % 300);
const runtime = createCloudflareRuntime({
  main: fileURLToPath(new URL("./lifecycle-worker.ts", import.meta.url)),
  port,
  readinessPath: "/health",
  vars: { LOCAL_AUTH_BYPASS: "false" },
});

before(() => runtime.start());
after(() => runtime.stop());

test("CreationLifecycle 通过公开接口创建并按作者隔离小说", async () => {
  const response = await fetch(`${runtime.origin}/creation`, { method: "POST" });
  assert.equal(response.status, 200, runtime.output);
  const payload = await response.json();
  assert.equal(payload.created.kind, "created");
  assert.equal(payload.ownerIds.includes(payload.created.id), true);
  assert.equal(payload.strangerIds.includes(payload.created.id), false);
});

test("CreationLifecycle 公开接口覆盖小说与章节完整转换矩阵", async () => {
  const response = await fetch(`${runtime.origin}/creation-matrix`, { method: "POST" });
  assert.equal(response.status, 200, runtime.output);
  const payload = await response.json();
  const expected = ["create", "save", "duplicate", "delete", "submit", "withdraw", "submit", "reject", "submit", "publish", "offline", "rollback"];
  assert.deepEqual(payload.novelActions, expected);
  assert.deepEqual(payload.chapterActions, expected);
  assert.deepEqual(payload.novelVersions, [3, 2, 1]);
  assert.deepEqual(payload.chapterVersions, [2, 1]);
  assert.equal(payload.chapterRollbackWithOfflineParentStatus, 400);
});

test("CreationLifecycle 公开接口拒绝越权和非法状态转换", async () => {
  const response = await fetch(`${runtime.origin}/creation-rejections`, { method: "POST" });
  assert.equal(response.status, 200, runtime.output);
  assert.deepEqual(await response.json(), {
    crossOwnerSave: 403,
    crossOwnerDuplicate: 403,
    authorPublish: 400,
    administratorSubmit: 400,
    withdrawDraft: 400,
    repeatedSubmit: 400,
    rejectDraft: 400,
    authorDeletePublished: 400,
    administratorDeletePublished: 400,
  });
});

test("AssetLifecycle 通过公开接口补偿式删除且重复删除幂等", async () => {
  const response = await fetch(`${runtime.origin}/assets`, { method: "POST" });
  assert.equal(response.status, 200, runtime.output);
  const payload = await response.json();
  assert.equal(payload.uploaded.kind, "asset");
  assert.equal(payload.deleted.kind, "ok");
  assert.equal(payload.repeated.kind, "ok");
  assert.equal(payload.remainingIds.includes(payload.uploaded.asset.id), false);
});

test("AssetLifecycle 公开接口覆盖整理、生成、引用保护和失败重试", async () => {
  const response = await fetch(`${runtime.origin}/asset-matrix`, { method: "POST" });
  assert.equal(response.status, 200, runtime.output);
  const payload = await response.json();
  assert.deepEqual(payload.operations, [
    "create-folder", "upload", "update-asset", "rename-folder", "delete-folder",
    "generate-sfx", "generate-tts", "reference-block", "delete-failed", "delete-retry",
  ]);
  assert.deepEqual(payload.upload, { type: "image", mimeType: "image/png", duration: 0, status: "ready" });
  assert.equal(payload.generated.sfxType, "audio");
  assert.equal(payload.generated.ttsType, "audio");
  assert.equal(payload.generated.sourceKey, "mock-source");
  assert.equal(payload.referenceStatus, 409);
  assert.equal(payload.failedStatus, "delete_failed");
  assert.equal(payload.retryRemoved, true);
});

test("AssetLifecycle 公开接口隔离作者素材和平台素材管理权", async () => {
  const response = await fetch(`${runtime.origin}/asset-ownership`, { method: "POST" });
  assert.equal(response.status, 200, runtime.output);
  assert.deepEqual(await response.json(), {
    strangerCanSeeAuthorAsset: false,
    strangerUpdate: 403,
    strangerDelete: 403,
    authorUpdatePlatform: 403,
  });
});

test("AssetLifecycle 在公开生成命令内统一执行频控", async () => {
  const response = await fetch(`${runtime.origin}/asset-generation-rate-limit`, { method: "POST" });
  assert.equal(response.status, 200, runtime.output);
  assert.deepEqual(await response.json(), { generated: 5, rateLimited: 429 });
});

test("AccountLifecycle 通过公开端口完成注册、验证与登录", async () => {
  const response = await fetch(`${runtime.origin}/account`, { method: "POST" });
  assert.equal(response.status, 200, runtime.output);
  const payload = await response.json();
  assert.equal(payload.registration.status, 201);
  assert.deepEqual(payload.turnstileCalls, [{ token: "contract-token", action: "register" }]);
  assert.equal(payload.mailCalls.length, 1);
  assert.equal(payload.mailCalls[0].type, "verify_email");
  assert.equal(payload.verification.body.ok, true);
  assert.equal(payload.login.body.user.status, "active");
  assert.match(payload.login.cookie, /^mist_session=/);
});

test("账号注册关闭时 AccountLifecycle 返回稳定不可用状态", async () => {
  const response = await fetch(`${runtime.origin}/account-registration-disabled`, { method: "POST" });
  assert.equal(response.status, 200, runtime.output);
  assert.deepEqual(await response.json(), {
    status: 503,
    message: "账号注册尚未开放",
  });
});

test("账号注册 composition root 在必要配置缺失时保持关闭", async () => {
  const response = await fetch(`${runtime.origin}/account-registration-runtime-config`, { method: "POST" });
  assert.equal(response.status, 200, runtime.output);
  const payload = await response.json();
  assert.equal(payload.incomplete.registrationEnabled, false);
  assert.equal(payload.localPreview.registrationEnabled, true);
  assert.deepEqual(payload.localPreview.allowedHostnames, ["127.0.0.1"]);
  assert.equal(payload.unsafeBypass.registrationEnabled, false);
  assert.equal(payload.productionReady.registrationEnabled, true);
  assert.deepEqual(payload.productionReady.allowedHostnames, ["preview.example.com"]);
  assert.deepEqual(payload.turnstile, { accepted: true, missingAction: false, wrongHostname: false });
});

test("访客确认资格与注册同意后创建待验证账号", async () => {
  const response = await fetch(`${runtime.origin}/account-registration-create`, { method: "POST" });
  assert.equal(response.status, 200, runtime.output);
  const payload = await response.json();
  assert.deepEqual({
    missingAge: payload.missingAge,
    missingTerms: payload.missingTerms,
    shortPassword: payload.shortPassword,
  }, { missingAge: 400, missingTerms: 400, shortPassword: 400 });
  assert.equal(payload.registration.status, 201);
  assert.equal(payload.registration.body.state, "awaiting_email");
  assert.equal(payload.registration.body.accountStatus, "pending");
  assert.deepEqual(payload.turnstile, { token: "guided-token", action: "register" });
  assert.equal(payload.mail.type, "verify_email");
});

test("访客明确确认邮箱后原子激活账号并建立会话", async () => {
  const response = await fetch(`${runtime.origin}/account-activation`, { method: "POST" });
  assert.equal(response.status, 200, runtime.output);
  const payload = await response.json();
  assert.deepEqual(payload.inspection.body, { state: "ready" });
  assert.equal(payload.pendingLogin, 403);
  assert.equal(payload.activation.body.state, "active");
  assert.deepEqual(payload.activation.body.resumeDirective, {
    kind: "bookshelf",
    targetId: "novel-42",
    mode: "confirm",
  });
  assert.match(payload.activation.cookie, /^mist_session=/);
  assert.equal(payload.identity.status, "active");
  assert.deepEqual(payload.usedWithMatchingSession.body, { state: "active_session" });
  assert.equal(payload.repeated, 400);
  assert.equal(payload.disabledActivation, 400);
});

test("待验证账号在六十秒后可重发验证邮件", async () => {
  const response = await fetch(`${runtime.origin}/account-resend`, { method: "POST" });
  assert.equal(response.status, 200, runtime.output);
  const payload = await response.json();
  assert.equal(payload.immediateStatus, 429);
  assert.equal(payload.retryAfterSeconds, 60);
  assert.equal(payload.resent.body.state, "awaiting_email");
  assert.equal(payload.resent.body.resent, true);
  assert.equal(payload.mailCalls, 2);
});

test("待验证账号重新开始会原子替换凭据并作废旧链接", async () => {
  const response = await fetch(`${runtime.origin}/account-restart`, { method: "POST" });
  assert.equal(response.status, 200, runtime.output);
  const payload = await response.json();
  assert.equal(payload.restarted.body.state, "awaiting_email");
  assert.equal(payload.restarted.body.restarted, true);
  assert.equal(payload.oldInspection.body.state, "used");
  assert.equal(payload.newInspection.body.state, "ready");
  assert.equal(payload.mailCalls, 2);
  assert.equal(payload.failedStatus, 502);
  assert.equal(payload.expiryAfterFailure, payload.expiryBeforeFailure);
});

test("注册操作超时可查询结果且重复提交保持幂等", async () => {
  const response = await fetch(`${runtime.origin}/account-operation-receipt`, { method: "POST" });
  assert.equal(response.status, 200, runtime.output);
  const payload = await response.json();
  assert.equal(payload.uncertain.body.state, "uncertain");
  assert.equal(payload.recovered.status, 201);
  assert.equal(payload.recoveredOutcome.body.state, "succeeded");
  assert.equal(payload.recoveryMailCalls, 2);
  assert.equal(payload.recoveryMailSameKey, true);
  assert.equal(payload.recoveredAccountCount, 1);
  assert.equal(payload.first.status, 201);
  assert.deepEqual(payload.repeated.body, payload.first.body);
  assert.equal(payload.successMailCalls, 1);
});

test("注册与重发共享频控且拒绝发生在外部调用之前", async () => {
  const response = await fetch(`${runtime.origin}/account-registration-rate-limit`, { method: "POST" });
  assert.equal(response.status, 200, runtime.output);
  const payload = await response.json();
  assert.equal(payload.limitedStatus, 429);
  assert.ok(payload.retryAfterSeconds > 0);
  assert.equal(payload.mailCalls, 5);
  assert.equal(payload.turnstileCalls, 5);
});

test("AccountLifecycle 清理七天未验证账号且保留正常账号", async () => {
  const response = await fetch(`${runtime.origin}/account-expired-registration-cleanup`, { method: "POST" });
  assert.equal(response.status, 200, runtime.output);
  const payload = await response.json();
  assert.ok(payload.cleanup.body.removedPendingAccounts >= 1);
  assert.equal(payload.expiredInspection.body.state, "invalid");
  assert.equal(payload.activeStatus, "active");
  assert.equal(payload.repeatedCleanup.body.removedPendingAccounts, 0);
  assert.equal(payload.notYetInspection.body.state, "ready");
});

test("注册分析遵守独立选择且事件不包含个人内容", async () => {
  const response = await fetch(`${runtime.origin}/account-registration-telemetry`, { method: "POST" });
  assert.equal(response.status, 200, runtime.output);
  const payload = await response.json();
  assert.equal(payload.declinedEventCount, 0);
  assert.deepEqual(payload.events.map((event) => `${event.stage}:${event.outcome}`), [
    "invitation:shown", "mail_delivery:succeeded", "account_activation:succeeded", "intent_resume:succeeded",
  ]);
  for (const privateValue of payload.privateValues) assert.equal(payload.serializedEvents.includes(privateValue), false);
});

test("账号使用者通过授权边界同步、修改并清除自己的向导记忆", async () => {
  const response = await fetch(`${runtime.origin}/account-guide-memory`, { method: "POST" });
  assert.equal(response.status, 200, runtime.output);
  const payload = await response.json();
  assert.deepEqual(payload.declined.body.memory.preferences, []);
  assert.equal(payload.declined.body.memory.guideCompletedAt, null);
  assert.deepEqual(payload.accepted.body.memory.preferences, ["奇幻", "轻松"]);
  assert.ok(payload.accepted.body.memory.guideCompletedAt);
  assert.deepEqual(payload.crossDevice.body.memory.preferences, ["奇幻", "轻松"]);
  assert.deepEqual(payload.strangerView.body.memory.preferences, []);
  assert.deepEqual(payload.changed.body.memory.preferences, ["悬疑"]);
  assert.deepEqual(payload.cleared.body.memory.preferences, []);
  assert.equal(payload.cleared.body.memory.guideCompletedAt, null);
});

test("AccountLifecycle 公开接口覆盖找回、重置、资料、角色与状态矩阵", async () => {
  const response = await fetch(`${runtime.origin}/account-matrix`, { method: "POST" });
  assert.equal(response.status, 200, runtime.output);
  const payload = await response.json();
  assert.deepEqual(payload.operations, [
    "register", "verify-email", "login", "profile", "forgot-password", "reset-password",
    "login", "update-role", "list-users", "logout", "login", "update-status",
  ]);
  assert.equal(payload.forgotExistingMessage, payload.forgotMissingMessage);
  assert.equal(payload.resetReuseStatus, 400);
  assert.equal(payload.oldSessionAfterReset, null);
  assert.equal(payload.roleAfterUpdate, "author");
  assert.equal(payload.sessionAfterLogout, null);
  assert.equal(payload.sessionAfterDisable, null);
});

test("SessionAuthorization 每次请求读取最新账号状态", async () => {
  const response = await fetch(`${runtime.origin}/authorization`, { method: "POST" });
  assert.equal(response.status, 200, runtime.output);
  const payload = await response.json();
  assert.equal(payload.before.status, "active");
  assert.deepEqual(payload.administrator, { role: "admin", email: payload.before.email, source: "account" });
  assert.equal(payload.after, null);
});

test("ReadingSession 通过公开接口读取云端进度", async () => {
  const response = await fetch(`${runtime.origin}/reading-progress`);
  assert.equal(response.status, 200, runtime.output);
  assert.deepEqual(await response.json(), { progress: [] });
});

test("AccountLifecycle 对邮件超时执行有限重试并返回稳定错误", async () => {
  const response = await fetch(`${runtime.origin}/account-mail-timeout`, { method: "POST" });
  assert.equal(response.status, 200, runtime.output);
  const payload = await response.json();
  assert.equal(payload.status, 504);
  assert.equal(payload.message, "邮件发送超时，请稍后重试");
  assert.equal(payload.calls, 2);
  assert.ok(payload.pendingExpiresAt);
});

test("AccountLifecycle 的 Turnstile 超时与邮件瞬时失败可通过 port 验证", async () => {
  const response = await fetch(`${runtime.origin}/account-port-resilience`, { method: "POST" });
  assert.equal(response.status, 200, runtime.output);
  const payload = await response.json();
  assert.deepEqual(payload.turnstileTimeout, { status: 504, calls: 2, sameKey: true });
  assert.deepEqual(payload.mailRetry, { status: 201, calls: 2, sameKey: true });
});

test("AccountLifecycle 在邮件超时时仍保持找回密码不可枚举", async () => {
  const response = await fetch(`${runtime.origin}/account-forgot-enumeration`, { method: "POST" });
  assert.equal(response.status, 200, runtime.output);
  const payload = await response.json();
  assert.deepEqual(payload.existing, payload.missing);
  assert.deepEqual(payload.existing, { status: 200, message: "如果账号存在，重置邮件已经发送" });
});

test("AccountLifecycle 公开接口覆盖待验证、禁用、过期 token 与频控", async () => {
  const response = await fetch(`${runtime.origin}/account-security`, { method: "POST" });
  assert.equal(response.status, 200, runtime.output);
  assert.deepEqual(await response.json(), {
    pendingLogin: 403,
    disabledLogin: 403,
    expiredVerification: 400,
    expiredReset: 400,
    rateLimited: 429,
  });
});
