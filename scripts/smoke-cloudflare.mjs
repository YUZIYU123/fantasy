import { readFile } from "node:fs/promises";

const target = process.argv[2];
if (target !== "staging" && target !== "production") throw new Error("冒烟测试只接受 staging 或 production");
const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
const configuredOrigin = config.env[target].vars.APP_ORIGIN;
const overrideName = `${target.toUpperCase()}_SMOKE_URL`;
const origin = String(process.env[overrideName] || configuredOrigin).replace(/\/$/, "");
const sessionCookie = process.env.SMOKE_SESSION_COOKIE || "";

async function request(path, init = {}) {
  const response = await fetch(`${origin}${path}`, { ...init, signal: AbortSignal.timeout(10_000) });
  return response;
}

function expectStatus(response, expected, label) {
  if (!expected.includes(response.status)) throw new Error(`${label} 返回 ${response.status}，期望 ${expected.join("/")}`);
}

const health = await request("/api/health");
expectStatus(health, [200], "健康检查");
if ((await health.json()).ok !== true) throw new Error("健康检查 payload 无效");

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

if (sessionCookie) {
  const identity = await request("/api/auth/me", { headers: { cookie: sessionCookie } });
  expectStatus(identity, [200], "登录会话");
  if (!(await identity.json()).user) throw new Error("登录会话没有返回用户");
}

process.stdout.write(`${target} 冒烟测试通过：${origin}\n`);
