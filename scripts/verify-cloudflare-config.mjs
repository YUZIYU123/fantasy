import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const secretNames = [
  "CREATOR_PASSWORD_HASH",
  "CREATOR_SESSION_SECRET",
  "ACCOUNT_OPERATION_SECRET",
  "ELEVENLABS_API_KEY",
  "TURNSTILE_SECRET_KEY",
  "RESEND_API_KEY",
];

function fail(message) {
  throw new Error(`Cloudflare 配置无效：${message}`);
}

function environment(config, name) {
  const value = config.env?.[name];
  if (!value) fail(`缺少 ${name} 环境`);
  return value;
}

function assertBinding(value, name, binding) {
  const item = value?.[0];
  if (!item || item.binding !== binding) fail(`${name} 必须声明 ${binding} binding`);
  return item;
}

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}

export async function verifyCloudflareConfig({ requireRemote, requireRegistration } = {}) {
  const config = JSON.parse(await readFile(new URL("wrangler.jsonc", root), "utf8"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(config.compatibility_date || "")) fail("compatibility_date 缺失或格式错误");
  if (config.name !== "mist-page-fiction-unconfigured") fail("顶层必须是不可发布的未配置 Worker");

  const names = ["local", "staging", "production"];
  const resources = names.map((name) => {
    const value = environment(config, name);
    const d1 = assertBinding(value.d1_databases, name, "DB");
    const r2 = assertBinding(value.r2_buckets, name, "ASSET_BUCKET");
    if (d1.migrations_dir !== "drizzle") fail(`${name} 必须从 drizzle 读取 migrations`);
    if (typeof value.vars?.REGISTRATION_ENABLED !== "string") fail(`${name} 缺少 REGISTRATION_ENABLED`);
    if (value.vars?.DEPLOYMENT_ENV !== name) fail(`${name} 的 DEPLOYMENT_ENV 不匹配`);
    if (name !== "local") {
      if (!value.observability?.logs?.enabled || !value.observability?.traces?.enabled) {
        fail(`${name} 必须启用持久化 logs 和 traces`);
      }
      for (const secret of secretNames) {
        if (Object.hasOwn(value.vars || {}, secret)) fail(`${name} 把密钥 ${secret} 写进了 vars`);
        if (!value.secrets?.required?.includes(secret)) fail(`${name} 未声明 secret ${secret}`);
      }
      for (const key of Object.keys(value.vars || {})) {
        if (key.startsWith("LOCAL_")) fail(`${name} 不得包含本地绕过变量 ${key}`);
      }
    }
    return { name, value, d1, r2 };
  });

  if (new Set(resources.map(({ d1 }) => d1.database_name)).size !== resources.length) fail("D1 名称没有按环境隔离");
  if (new Set(resources.map(({ r2 }) => r2.bucket_name)).size !== resources.length) fail("R2 名称没有按环境隔离");
  for (const { name, value } of resources) {
    for (const unused of ["kv_namespaces", "durable_objects", "queues", "send_email"]) {
      if (Object.hasOwn(value, unused)) fail(`${name} 包含未批准的资源 ${unused}`);
    }
  }

  const targetName = requireRemote || requireRegistration;
  if (targetName) {
    if (!new Set(["staging", "production"]).has(targetName)) fail("远程检查只接受 staging 或 production");
    const target = resources.find(({ name }) => name === targetName);
    if (!isUuid(target.d1.database_id)) fail(`${targetName} 尚未填写真实 D1 database_id`);
    const other = resources.find(({ name }) => name !== "local" && name !== targetName);
    if (other?.d1.database_id && other.d1.database_id === target.d1.database_id) fail("staging 与 production D1 database_id 相同");
  }

  if (requireRegistration) {
    const target = environment(config, requireRegistration);
    const requiredVars = ["APP_ORIGIN", "TURNSTILE_SITE_KEY", "AUTH_FROM_EMAIL", "ACCOUNT_CONTACT_EMAIL"];
    if (target.vars.REGISTRATION_ENABLED !== "true") fail(`${requireRegistration} 注册开关仍为 false`);
    if ([target.vars.TERMS_VERSION, target.vars.PRIVACY_VERSION].some((value) => !value || value === "draft")) {
      fail(`${requireRegistration} 条款或隐私版本仍为 draft`);
    }
    for (const name of requiredVars) {
      if (!target.vars[name]) fail(`${requireRegistration} 缺少非敏感变量 ${name}`);
    }
    if (!String(target.vars.APP_ORIGIN).startsWith("https://")) fail(`${requireRegistration} APP_ORIGIN 必须使用 HTTPS`);
  }

  return config;
}

async function main() {
  const [mode, target] = process.argv.slice(2);
  if (!mode) await verifyCloudflareConfig();
  else if (mode === "--require-remote") await verifyCloudflareConfig({ requireRemote: target });
  else if (mode === "--require-registration") await verifyCloudflareConfig({ requireRegistration: target });
  else fail(`未知参数 ${mode}`);
  process.stdout.write("Cloudflare 配置检查通过。\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
