import { readFile } from "node:fs/promises";

const target = process.argv[2];
if (target !== "staging" && target !== "production") throw new Error("冒烟测试只接受 staging 或 production");
const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
const configuredOrigin = config.env[target].vars.APP_ORIGIN;
const overrideName = `${target.toUpperCase()}_SMOKE_URL`;
const origin = String(process.env[overrideName] || configuredOrigin).replace(/\/$/, "");
const sessionCookie = process.env.SMOKE_SESSION_COOKIE || "";
if (!sessionCookie) throw new Error("SMOKE_SESSION_COOKIE 必须指向受控测试账号，不能跳过登录与写流程");

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

const identity = await request("/api/auth/me", { headers: { cookie: sessionCookie } });
expectStatus(identity, [200], "登录会话");
if (!(await identity.json()).user) throw new Error("登录会话没有返回用户");

const memoryResponse = await request("/api/account/guide-memory", { headers: { cookie: sessionCookie } });
expectStatus(memoryResponse, [200], "核心写流程读取前态");
const memory = (await memoryResponse.json()).memory;
const verifiedWrite = await request("/api/account/guide-memory", {
  method: "PATCH",
  headers: { "content-type": "application/json", origin, cookie: sessionCookie },
  body: JSON.stringify({ analyticsAllowed: Boolean(memory?.registrationAnalyticsAllowed) }),
});
expectStatus(verifiedWrite, [200], "已授权幂等核心写流程");

process.stdout.write(`${target} 冒烟测试通过：${origin}\n`);
