import assert from "node:assert/strict";
import { test } from "node:test";
import {
  advanceCreatorWorkspaceAccess,
  createSessionAuthorization,
  resumeCreatorWorkspaceAccess,
  startCreatorWorkspaceAccess,
} from "../lib/session-authorization-module.ts";

function sharedCredentialAdapter(configured = false) {
  return {
    configured: () => configured,
    hasSession: async () => false,
    verify: async () => false,
    createSessionCookie: async () => "",
    clearSessionCookie: () => "",
  };
}

test("本地管理员入口在账号存储不可用时仍优先进入管理员后台", async () => {
  let accountLookups = 0;
  const authorization = createSessionAuthorization({
    findSessionAccount: async () => {
      accountLookups += 1;
      throw new Error("D1 unavailable");
    },
    localAdministratorEnabled: () => true,
    sharedCredential: sharedCredentialAdapter(),
  });

  const decision = await authorization.resolveCreatorAccess(
    new Request("http://localhost/creator"),
    "entry",
  );

  assert.deepEqual(decision, {
    outcome: "redirect",
    destination: "admin",
    redirectTo: "/admin",
    reason: "local_admin",
    accountRole: null,
    source: "local_bypass",
    administrator: { role: "admin", email: "local-admin@localhost", source: "local_bypass" },
    recoveryAvailable: false,
  });
  assert.equal(accountLookups, 0);
});

test("管理员账号从统一入口进入管理员后台", async () => {
  const authorization = createSessionAuthorization({
    findSessionAccount: async () => ({
      id: "admin-1",
      email: "admin@example.com",
      displayName: "管理员",
      role: "admin",
      status: "active",
      expiresAt: "2099-01-01T00:00:00.000Z",
    }),
    localAdministratorEnabled: () => false,
    sharedCredential: sharedCredentialAdapter(),
  });

  assert.deepEqual(await authorization.resolveCreatorAccess(
    new Request("https://fantasy.example/creator"),
    "entry",
  ), {
    outcome: "redirect",
    destination: "admin",
    redirectTo: "/admin",
    reason: "admin_account",
    accountRole: "admin",
    source: "account",
    administrator: { role: "admin", email: "admin@example.com", source: "account" },
    recoveryAvailable: false,
  });
});

test("作者账号进入作者工作台并从管理员后台纠正回作者工作台", async () => {
  const authorization = createSessionAuthorization({
    findSessionAccount: async () => ({
      id: "author-1",
      email: "author@example.com",
      displayName: "作者",
      role: "author",
      status: "active",
      expiresAt: "2099-01-01T00:00:00.000Z",
    }),
    localAdministratorEnabled: () => false,
    sharedCredential: sharedCredentialAdapter(),
  });
  const request = new Request("https://fantasy.example/creator");

  assert.deepEqual(await authorization.resolveCreatorAccess(request, "author_workspace"), {
    outcome: "allow",
    destination: "studio",
    redirectTo: null,
    reason: "author_account",
    accountRole: "author",
    source: null,
    administrator: null,
    recoveryAvailable: false,
  });
  assert.deepEqual(await authorization.resolveCreatorAccess(request, "admin_workspace"), {
    outcome: "redirect",
    destination: "studio",
    redirectTo: "/studio",
    reason: "author_account",
    accountRole: "author",
    source: null,
    administrator: null,
    recoveryAvailable: false,
  });
});

test("读者账号被拒绝进入工作台并获得明确的恢复密钥可用状态", async () => {
  const authorization = createSessionAuthorization({
    findSessionAccount: async () => ({
      id: "reader-1",
      email: "reader@example.com",
      displayName: "读者",
      role: "reader",
      status: "active",
      expiresAt: "2099-01-01T00:00:00.000Z",
    }),
    localAdministratorEnabled: () => false,
    sharedCredential: sharedCredentialAdapter(true),
  });
  const request = new Request("https://fantasy.example/creator");

  assert.deepEqual(await authorization.resolveCreatorAccess(request, "entry"), {
    outcome: "deny",
    destination: null,
    redirectTo: null,
    reason: "reader_account",
    accountRole: "reader",
    source: null,
    administrator: null,
    recoveryAvailable: false,
  });
  assert.deepEqual(await authorization.resolveCreatorAccess(request, "admin_workspace"), {
    outcome: "deny",
    destination: null,
    redirectTo: null,
    reason: "reader_account",
    accountRole: "reader",
    source: null,
    administrator: null,
    recoveryAvailable: true,
  });
});

test("未登录访问者由统一入口转到登录且管理员工作台明确恢复密钥不可用", async () => {
  const authorization = createSessionAuthorization({
    findSessionAccount: async () => null,
    localAdministratorEnabled: () => false,
    sharedCredential: sharedCredentialAdapter(false),
  });
  const request = new Request("https://fantasy.example/creator");

  assert.deepEqual(await authorization.resolveCreatorAccess(request, "entry"), {
    outcome: "redirect",
    destination: null,
    redirectTo: "/login?next=/creator",
    reason: "signed_out",
    accountRole: null,
    source: null,
    administrator: null,
    recoveryAvailable: false,
  });
  assert.deepEqual(await authorization.resolveCreatorAccess(request, "admin_workspace"), {
    outcome: "deny",
    destination: null,
    redirectTo: null,
    reason: "signed_out",
    accountRole: null,
    source: null,
    administrator: null,
    recoveryAvailable: false,
  });
});

test("有效的应急恢复会话只在管理员工作台授予管理员能力", async () => {
  const sharedCredential = sharedCredentialAdapter(true);
  sharedCredential.hasSession = async () => true;
  const authorization = createSessionAuthorization({
    findSessionAccount: async () => null,
    localAdministratorEnabled: () => false,
    sharedCredential,
  });

  assert.deepEqual(await authorization.resolveCreatorAccess(
    new Request("https://fantasy.example/admin"),
    "admin_workspace",
  ), {
    outcome: "allow",
    destination: "admin",
    redirectTo: null,
    reason: "shared_credential",
    accountRole: null,
    source: "shared_credential",
    administrator: { role: "admin", email: "creator", source: "shared_credential" },
    recoveryAvailable: false,
  });
});

test("管理员能力与创作入口复用同一角色优先级", async () => {
  const authorization = createSessionAuthorization({
    findSessionAccount: async () => {
      throw new Error("本地管理员不应查询账号存储");
    },
    localAdministratorEnabled: () => true,
    sharedCredential: sharedCredentialAdapter(),
  });

  assert.deepEqual(await authorization.requireAdministrator(
    new Request("http://localhost/admin/api/novels"),
  ), {
    role: "admin",
    email: "local-admin@localhost",
    source: "local_bypass",
  });
});

test("未配置应急恢复密钥时拒绝验证且不调用密钥 adapter", async () => {
  let verifications = 0;
  const sharedCredential = sharedCredentialAdapter(false);
  sharedCredential.verify = async () => {
    verifications += 1;
    return true;
  };
  const authorization = createSessionAuthorization({
    findSessionAccount: async () => null,
    localAdministratorEnabled: () => false,
    sharedCredential,
  });

  await assert.rejects(
    authorization.authenticateSharedCredential(
      new Request("https://fantasy.example/admin/api/session", {
        method: "POST",
        headers: { origin: "https://fantasy.example" },
      }),
      "recovery-key",
    ),
    (error) => error.status === 503 && error.message === "尚未配置创作者登录密钥",
  );
  assert.equal(verifications, 0);
});

test("入口决策直接给出完整跳转地址，不要求 React 推断登录规则", async () => {
  const authorization = createSessionAuthorization({
    findSessionAccount: async () => null,
    localAdministratorEnabled: () => false,
    sharedCredential: sharedCredentialAdapter(false),
  });

  const decision = await authorization.resolveCreatorAccess(
    new Request("https://fantasy.example/creator"),
    "entry",
  );

  assert.equal(decision.redirectTo, "/login?next=/creator");
});

test("管理员工作台决策一次解析即返回可用管理员身份", async () => {
  let accountLookups = 0;
  const authorization = createSessionAuthorization({
    findSessionAccount: async () => {
      accountLookups += 1;
      return {
        id: "admin-1",
        email: "admin@example.com",
        displayName: "管理员",
        role: "admin",
        status: "active",
        expiresAt: "2099-01-01T00:00:00.000Z",
      };
    },
    localAdministratorEnabled: () => false,
    sharedCredential: sharedCredentialAdapter(false),
  });

  const decision = await authorization.resolveCreatorAccess(
    new Request("https://fantasy.example/admin"),
    "admin_workspace",
  );

  assert.deepEqual(decision.administrator, {
    role: "admin",
    email: "admin@example.com",
    source: "account",
  });
  assert.equal(accountLookups, 1);
});

test("管理员接口按 actor 区分未登录与角色拒绝，不把未配置恢复密钥误报为服务故障", async () => {
  const signedOut = createSessionAuthorization({
    findSessionAccount: async () => null,
    localAdministratorEnabled: () => false,
    sharedCredential: sharedCredentialAdapter(false),
  });
  await assert.rejects(
    signedOut.requireAdministrator(new Request("https://fantasy.example/admin/api/novels")),
    (error) => error.status === 401 && error.message === "请先登录管理员账号",
  );

  const reader = createSessionAuthorization({
    findSessionAccount: async () => ({
      id: "reader-1",
      email: "reader@example.com",
      displayName: "读者",
      role: "reader",
      status: "active",
      expiresAt: "2099-01-01T00:00:00.000Z",
    }),
    localAdministratorEnabled: () => false,
    sharedCredential: sharedCredentialAdapter(true),
  });
  await assert.rejects(
    reader.requireAdministrator(new Request("https://fantasy.example/admin/api/novels")),
    (error) => error.status === 403 && error.message === "当前账号没有管理员权限",
  );
});

test("工作台权限状态机统一编排跳转、内容加载和一次权限恢复", () => {
  const started = startCreatorWorkspaceAccess();
  assert.deepEqual(started, { status: "resolving", staleRetries: 0, effect: { type: "check_access" } });

  const allowed = advanceCreatorWorkspaceAccess(started, {
    type: "access_resolved",
    decision: {
      outcome: "allow", destination: "admin", redirectTo: null, reason: "local_admin",
      accountRole: null, source: "local_bypass",
      administrator: { role: "admin", email: "local-admin@localhost", source: "local_bypass" },
      recoveryAvailable: false,
    },
  });
  assert.equal(allowed.effect.type, "load_content");

  const stale = advanceCreatorWorkspaceAccess(allowed, { type: "content_resolved", result: "access_stale" });
  assert.deepEqual(stale, { status: "resolving", staleRetries: 1, effect: { type: "check_access" } });

  const allowedAgain = advanceCreatorWorkspaceAccess(stale, {
    type: "access_resolved",
    decision: {
      outcome: "allow", destination: "admin", redirectTo: null, reason: "local_admin",
      accountRole: null, source: "local_bypass",
      administrator: { role: "admin", email: "local-admin@localhost", source: "local_bypass" },
      recoveryAvailable: false,
    },
  });
  const staleAgain = advanceCreatorWorkspaceAccess(allowedAgain, { type: "content_resolved", result: "access_stale" });
  assert.equal(staleAgain.status, "access_error");
  assert.equal(staleAgain.effect, null);
});

test("工作台权限状态机输出完整导航和稳定的内容失败状态", () => {
  const started = startCreatorWorkspaceAccess();
  const redirect = advanceCreatorWorkspaceAccess(started, {
    type: "access_resolved",
    decision: {
      outcome: "redirect", destination: "studio", redirectTo: "/studio", reason: "author_account",
      accountRole: "author", source: null, administrator: null, recoveryAvailable: false,
    },
  });
  assert.deepEqual(redirect.effect, { type: "navigate", to: "/studio" });

  const allowed = advanceCreatorWorkspaceAccess(started, {
    type: "access_resolved",
    decision: {
      outcome: "allow", destination: "admin", redirectTo: null, reason: "local_admin",
      accountRole: null, source: "local_bypass",
      administrator: { role: "admin", email: "local-admin@localhost", source: "local_bypass" },
      recoveryAvailable: false,
    },
  });
  const failed = advanceCreatorWorkspaceAccess(allowed, { type: "content_resolved", result: "failed" });
  assert.equal(failed.status, "content_error");
  assert.equal(failed.effect, null);
});

test("工作台写入与刷新结果通过同一状态机决定是否重新鉴权", () => {
  assert.deepEqual(resumeCreatorWorkspaceAccess("access_stale"), {
    status: "resolving",
    staleRetries: 1,
    effect: { type: "check_access" },
  });
  assert.equal(resumeCreatorWorkspaceAccess("loaded").status, "ready");
  assert.equal(resumeCreatorWorkspaceAccess("failed").status, "content_error");
});
