import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function json(path) {
  return JSON.parse(await readFile(new URL(path, root), "utf8"));
}

test("Cloudflare local、staging 与 production 配置和资源彼此隔离", async () => {
  const config = await json("wrangler.jsonc");
  const environments = {
    local: config.env?.local,
    staging: config.env?.staging,
    production: config.env?.production,
  };
  assert.equal(config.name, "mist-page-fiction-unconfigured");
  assert.match(config.compatibility_date, /^\d{4}-\d{2}-\d{2}$/);

  for (const [name, environment] of Object.entries(environments)) {
    assert.ok(environment, `缺少 ${name} Wrangler 环境`);
    assert.equal(environment.d1_databases?.[0]?.binding, "DB");
    assert.equal(environment.d1_databases?.[0]?.migrations_dir, "drizzle");
    assert.equal(environment.r2_buckets?.[0]?.binding, "ASSET_BUCKET");
    assert.equal(typeof environment.vars?.REGISTRATION_ENABLED, "string");
    assert.equal(environment.vars?.DEPLOYMENT_ENV, name);
  }

  assert.equal(environments.staging.name, "mist-page-fiction-staging");
  assert.equal(environments.local.name, "mist-page-fiction-local");
  assert.equal(environments.production.name, "mist-page-fiction");
  assert.notEqual(environments.local.d1_databases[0].database_name, environments.staging.d1_databases[0].database_name);
  assert.notEqual(environments.staging.d1_databases[0].database_name, environments.production.d1_databases[0].database_name);
  assert.notEqual(environments.local.r2_buckets[0].bucket_name, environments.staging.r2_buckets[0].bucket_name);
  assert.notEqual(environments.staging.r2_buckets[0].bucket_name, environments.production.r2_buckets[0].bucket_name);
  assert.equal(environments.production.observability.logs.enabled, true);
  assert.equal(environments.production.observability.traces.enabled, true);
});

test("关闭注册环境只要求共享创作者凭据", async () => {
  const { requiredSecretsForEnvironment } = await import("../scripts/verify-cloudflare-config.mjs");

  assert.deepEqual(requiredSecretsForEnvironment({ REGISTRATION_ENABLED: "false" }), [
    "CREATOR_PASSWORD_HASH",
    "CREATOR_SESSION_SECRET",
  ]);
  assert.deepEqual(requiredSecretsForEnvironment({ REGISTRATION_ENABLED: "true" }), [
    "CREATOR_PASSWORD_HASH",
    "CREATOR_SESSION_SECRET",
    "ACCOUNT_OPERATION_SECRET",
    "TURNSTILE_SECRET_KEY",
    "RESEND_API_KEY",
  ]);
});

test("production migration 前记录可恢复的 D1 bookmark 与 Worker version", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "fantasy-recovery-test-"));
  const binaryDirectory = join(temporaryRoot, "bin");
  const recoveryDirectory = join(temporaryRoot, "recovery");
  await mkdir(binaryDirectory);
  const pnpmStub = join(binaryDirectory, "pnpm");
  await writeFile(pnpmStub, `#!/bin/sh
case "$*" in
  *"d1 time-travel info"*) printf '%s\\n' '{"bookmark":"bookmark-before-release"}' ;;
  *"deployments status"*) printf '%s\\n' '{"id":"deployment-before-release","versions":[{"version_id":"worker-version-before-release","percentage":100}]}' ;;
  *) exit 64 ;;
esac
`);
  await chmod(pnpmStub, 0o700);

  const result = spawnSync(process.execPath, ["scripts/record-production-recovery.mjs"], {
    cwd: new URL("../", import.meta.url),
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${binaryDirectory}:${process.env.PATH}`,
      FANTASY_RECOVERY_DIR: recoveryDirectory,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  const files = await readdir(recoveryDirectory);
  assert.equal(files.length, 1);
  const recoveryFile = join(recoveryDirectory, files[0]);
  const record = JSON.parse(await readFile(recoveryFile, "utf8"));
  assert.equal(record.d1.bookmark, "bookmark-before-release");
  assert.equal(record.worker.versions[0].versionId, "worker-version-before-release");
  assert.equal((await stat(recoveryDirectory)).mode & 0o777, 0o700);
  assert.equal((await stat(recoveryFile)).mode & 0o777, 0o600);
});

test("密钥只声明名称且本地统一使用 .dev.vars", async () => {
  const [config, ignored, example] = await Promise.all([
    json("wrangler.jsonc"),
    readFile(new URL(".gitignore", root), "utf8"),
    readFile(new URL(".dev.vars.example", root), "utf8"),
  ]);
  const secretNames = [
    "CREATOR_PASSWORD_HASH",
    "CREATOR_SESSION_SECRET",
    "ACCOUNT_OPERATION_SECRET",
    "ELEVENLABS_API_KEY",
    "TURNSTILE_SECRET_KEY",
    "RESEND_API_KEY",
  ];
  assert.match(ignored, /^\.env\*$/m);
  assert.match(ignored, /^\.dev\.vars\*$/m);
  assert.match(ignored, /^!\.dev\.vars\.example$/m);
  assert.match(example, /LOCAL_AUTH_BYPASS=true/);
  for (const environment of [config.env.staging, config.env.production]) {
    for (const name of secretNames) {
      assert.equal(Object.hasOwn(environment.vars, name), false, `${name} 不得写入 vars`);
    }
    const { requiredSecretsForEnvironment } = await import("../scripts/verify-cloudflare-config.mjs");
    assert.deepEqual(environment.secrets.required, requiredSecretsForEnvironment(environment.vars));
  }
});

test("D1 migrations 连续、被 Wrangler 追踪且发布命令显式选择环境", async () => {
  const [files, journal, packageJson, workflow, sourceGate, smoke, delivery] = await Promise.all([
    readdir(new URL("drizzle", root)),
    json("drizzle/meta/_journal.json"),
    json("package.json"),
    readFile(new URL(".github/workflows/verify.yml", root), "utf8"),
    readFile(new URL("scripts/verify-release-source.mjs", root), "utf8"),
    readFile(new URL("scripts/smoke-cloudflare.mjs", root), "utf8"),
    readFile(new URL("docs/cloudflare-delivery.md", root), "utf8"),
  ]);
  const migrations = files.filter((file) => /^\d{4}_.+\.sql$/.test(file)).sort();
  assert.deepEqual(migrations.map((file) => Number(file.slice(0, 4))), migrations.map((_, index) => index));
  assert.equal(journal.entries.length, migrations.length);
  assert.match(packageJson.scripts["db:migrate:staging"], /--env staging/);
  assert.match(packageJson.scripts["db:migrate:production"], /--env production/);
  assert.match(packageJson.scripts["db:migrate:staging"], /release:source:staging/);
  assert.match(packageJson.scripts["release:recovery:production"], /release:source:production/);
  assert.match(packageJson.scripts["release:recovery:production"], /record-production-recovery\.mjs/);
  assert.match(packageJson.scripts["db:migrate:production"], /release:recovery:production/);
  assert.match(packageJson.scripts["deploy:staging"], /--env staging/);
  assert.match(packageJson.scripts["deploy:production"], /--env production/);
  assert.match(packageJson.scripts["deploy:staging"], /db:migrate:staging/);
  assert.match(packageJson.scripts["deploy:production"], /db:migrate:production/);
  assert.match(packageJson.scripts["deploy:staging"], /cf:secrets:staging/);
  assert.match(packageJson.scripts["deploy:production"], /cf:secrets:production/);
  assert.match(packageJson.scripts["release:check"], /build:production/);
  for (const gate of ["typecheck", "lint", "db:migrate:local", "test", "cf:config:check"]) {
    assert.match(packageJson.scripts["release:check"], new RegExp(gate.replaceAll(":", "\\:")));
  }
  assert.match(workflow, /pnpm release:check/);
  assert.match(sourceGate, /upstream !== "origin\/main"/);
  assert.match(sourceGate, /upstream\.startsWith\("origin\/"\)/);
  assert.match(smoke, /desiredAnalyticsAllowed = !originalAnalyticsAllowed/);
  assert.match(smoke, /恢复核心写流程前态/);
  assert.match(smoke, /mode === "closed"/);
  assert.match(smoke, /registrationEnabled !== false/);
  assert.match(smoke, /\$\{target\} 注册未保持关闭/);
  assert.match(smoke, /注册关闭拒绝/);
  assert.match(packageJson.scripts["test:smoke:staging:closed"], /smoke-cloudflare\.mjs staging closed/);
  assert.match(packageJson.scripts["test:smoke:production:closed"], /smoke-cloudflare\.mjs production closed/);
  const stagingMigration = delivery.indexOf("pnpm db:migrate:staging");
  const mergeApprovedPr = delivery.indexOf("Merge the approved PR");
  assert.ok(stagingMigration >= 0 && stagingMigration < mergeApprovedPr, "staging 验收必须发生在合并 PR 之前");
  assert.ok(delivery.lastIndexOf("pnpm deploy:staging") > mergeApprovedPr, "合并后必须从 main 重新部署 staging");
});

test("AccountLifecycle 业务规则只依赖 AccountStore interface", async () => {
  const lifecycle = await readFile(new URL("db/account-lifecycle.ts", root), "utf8");
  assert.doesNotMatch(lifecycle, /from "drizzle-orm"/);
  assert.doesNotMatch(lifecycle, /from "\."/);
  assert.doesNotMatch(lifecycle, /from "\.\/schema"/);
  assert.doesNotMatch(lifecycle, /\bgetDb\(/);
});
