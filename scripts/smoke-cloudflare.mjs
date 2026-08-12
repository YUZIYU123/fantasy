import { readFile } from "node:fs/promises";

const target = process.argv[2];
if (target !== "staging" && target !== "production") throw new Error("冒烟测试只接受 staging 或 production");
const mode = process.argv[3] || "full";
if (mode !== "full" && mode !== "closed") throw new Error("冒烟模式只接受 full 或 closed");
const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
const configuredOrigin = config.env[target].vars.APP_ORIGIN;
const overrideName = `${target.toUpperCase()}_SMOKE_URL`;
const origin = String(process.env[overrideName] || configuredOrigin).replace(/\/$/, "");
const sessionCookie = process.env.SMOKE_SESSION_COOKIE || "";
if (mode === "full" && !sessionCookie) {
  throw new Error("SMOKE_SESSION_COOKIE 必须指向受控测试账号，不能跳过登录与写流程");
}

async function request(path, init = {}) {
  const response = await fetch(`${origin}${path}`, { ...init, signal: AbortSignal.timeout(10_000) });
  return response;
}

function expectStatus(response, expected, label) {
  if (!expected.includes(response.status)) throw new Error(`${label} 返回 ${response.status}，期望 ${expected.join("/")}`);
}

const health = await request("/api/health");
expectStatus(health, [200], "健康检查");
const healthPayload = await health.json();
if (healthPayload.ok !== true || healthPayload.environment !== target) throw new Error("健康检查环境标识无效");

for (const [path, label] of [["/", "首页"], ["/login", "登录页"]]) {
  expectStatus(await request(path), [200], label);
}

const novels = await request("/api/novels");
expectStatus(novels, [200], "核心读流程");
if (!Array.isArray((await novels.json()).novels)) throw new Error("核心读流程 payload 无效");

const deniedWrite = await request("/studio/api/novels", {
  method: "POST",
  headers: { "content-type": "application/json", origin },
  body: "{}",
});
expectStatus(deniedWrite, [401, 403], "未授权核心写流程");

if (mode === "closed") {
  const registrationConfig = await request("/api/auth/config");
  expectStatus(registrationConfig, [200], "注册关闭配置");
  if ((await registrationConfig.json()).registrationEnabled !== false) throw new Error("staging 注册未保持关闭");

  const registration = await request("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({
      email: "closed-smoke@example.invalid",
      displayName: "关闭注册冒烟",
      password: "closed-registration-smoke-password",
      turnstileToken: "must-not-be-used",
      ageConfirmed: true,
      termsAccepted: true,
      privacyAccepted: true,
    }),
  });
  expectStatus(registration, [503], "注册关闭拒绝");
  const registrationPayload = await registration.json();
  if (registrationPayload.error !== "账号注册尚未开放") throw new Error("注册关闭错误响应不稳定");
  process.stdout.write(`${target} closed 冒烟测试通过：${origin}\n`);
  process.exit(0);
}

const identity = await request("/api/auth/me", { headers: { cookie: sessionCookie } });
expectStatus(identity, [200], "登录会话");
if (!(await identity.json()).user) throw new Error("登录会话没有返回用户");

const memoryResponse = await request("/api/account/guide-memory", { headers: { cookie: sessionCookie } });
expectStatus(memoryResponse, [200], "核心写流程读取前态");
const memory = (await memoryResponse.json()).memory;
const originalAnalyticsAllowed = Boolean(memory?.registrationAnalyticsAllowed);
const desiredAnalyticsAllowed = !originalAnalyticsAllowed;

async function setAnalyticsPreference(allowed, label) {
  const response = await request("/api/account/guide-memory", {
    method: "PATCH",
    headers: { "content-type": "application/json", origin, cookie: sessionCookie },
    body: JSON.stringify({ analyticsAllowed: allowed }),
  });
  expectStatus(response, [200], label);
  const payload = await response.json();
  if (payload.memory?.registrationAnalyticsAllowed !== allowed) throw new Error(`${label} 未返回写入值`);
}

async function readAnalyticsPreference(label) {
  const response = await request("/api/account/guide-memory", { headers: { cookie: sessionCookie } });
  expectStatus(response, [200], label);
  return Boolean((await response.json()).memory?.registrationAnalyticsAllowed);
}

let writeFailure;
try {
  await setAnalyticsPreference(desiredAnalyticsAllowed, "已授权核心写流程");
  if (await readAnalyticsPreference("核心写流程回读") !== desiredAnalyticsAllowed) {
    throw new Error("核心写流程没有持久化变更");
  }
} catch (error) {
  writeFailure = error;
}

let restoreFailure;
try {
  await setAnalyticsPreference(originalAnalyticsAllowed, "恢复核心写流程前态");
  if (await readAnalyticsPreference("恢复后回读") !== originalAnalyticsAllowed) {
    throw new Error("核心写流程前态没有恢复");
  }
} catch (error) {
  restoreFailure = error;
}

if (writeFailure) throw writeFailure;
if (restoreFailure) throw restoreFailure;

process.stdout.write(`${target} 冒烟测试通过：${origin}\n`);
