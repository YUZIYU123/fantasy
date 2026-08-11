import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { createCloudflareRuntime } from "./cloudflare-runtime-harness.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const port = 43900 + (process.pid % 200);
const runtime = createCloudflareRuntime({
  main: `${projectRoot}/worker/index.ts`,
  port,
  readinessPath: "/api/novels",
  launcher: "vinext",
  vars: {
    LOCAL_ADMIN_BYPASS: "true",
    LOCAL_AUTH_BYPASS: "true",
    REGISTRATION_ENABLED: "true",
  },
});

before(() => runtime.start());
after(() => runtime.stop());

test("本地空账号环境通过创作入口进入管理员后台并保留平台作品", async () => {
  const usersResponse = await fetch(`${runtime.origin}/admin/api/users`);
  assert.equal(usersResponse.status, 200, runtime.output);
  assert.deepEqual((await usersResponse.json()).users, []);

  const createResponse = await fetch(`${runtime.origin}/admin/api/novels`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: runtime.origin },
    body: JSON.stringify({ action: "create" }),
  });
  assert.equal(createResponse.status, 201, runtime.output);
  const createdId = (await createResponse.json()).id;

  const entryResponse = await fetch(`${runtime.origin}/api/auth/creator-entry`);
  assert.equal(entryResponse.status, 200, runtime.output);
  assert.deepEqual(await entryResponse.json(), {
    destination: "admin",
    redirectTo: "/admin",
    reason: "local_admin",
    accountRole: null,
  });

  const sessionResponse = await fetch(`${runtime.origin}/admin/api/session`);
  assert.equal(sessionResponse.status, 200, runtime.output);
  assert.deepEqual(await sessionResponse.json(), {
    authenticated: true,
    outcome: "allow",
    destination: "admin",
    redirectTo: null,
    reason: "local_admin",
    accountRole: null,
    source: "local_bypass",
    administrator: { role: "admin", email: "local-admin@localhost", source: "local_bypass" },
    recoveryAvailable: false,
    role: "admin",
    email: "local-admin@localhost",
  });

  const novelsResponse = await fetch(`${runtime.origin}/admin/api/novels`);
  assert.equal(novelsResponse.status, 200, runtime.output);
  assert.equal((await novelsResponse.json()).novels.some((novel) => novel.id === createdId), true);
});
