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
