import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { createCloudflareRuntime } from "./cloudflare-runtime-harness.mjs";

const port = 43600 + (process.pid % 300);
const runtime = createCloudflareRuntime({
  main: fileURLToPath(new URL("./lifecycle-worker.ts", import.meta.url)),
  port,
  readinessPath: "/health",
  vars: { LOCAL_AUTH_BYPASS: "true" },
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

test("AssetLifecycle 通过公开接口补偿式删除且重复删除幂等", async () => {
  const response = await fetch(`${runtime.origin}/assets`, { method: "POST" });
  assert.equal(response.status, 200, runtime.output);
  const payload = await response.json();
  assert.equal(payload.uploaded.kind, "asset");
  assert.equal(payload.deleted.kind, "ok");
  assert.equal(payload.repeated.kind, "ok");
  assert.equal(payload.remainingIds.includes(payload.uploaded.asset.id), false);
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

test("SessionAuthorization 每次请求读取最新账号状态", async () => {
  const response = await fetch(`${runtime.origin}/authorization`, { method: "POST" });
  assert.equal(response.status, 200, runtime.output);
  const payload = await response.json();
  assert.equal(payload.before.status, "active");
  assert.equal(payload.after, null);
});
