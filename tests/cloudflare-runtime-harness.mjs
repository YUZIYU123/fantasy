import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

export function createCloudflareRuntime({ main, port, vars = {}, readinessPath = "/", launcher = "wrangler" }) {
  let server;
  let output = "";
  let persistencePath;
  let configPath;
  const origin = `http://localhost:${port}`;

  async function start() {
    persistencePath = await mkdtemp(join(tmpdir(), "mist-page-lifecycle-test-"));
    configPath = join(persistencePath, "wrangler.test.json");
    const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
    delete config.$schema;
    delete config.routes;
    config.main = main;
    config.vars = { ...config.vars, ...vars };
    config.d1_databases = config.d1_databases.map((database) => ({
      ...database,
      migrations_dir: join(projectRoot, "drizzle"),
    }));
    await writeFile(configPath, JSON.stringify(config));
    const migration = spawnSync("pnpm", [
      "exec", "wrangler", "d1", "migrations", "apply", "mist-page-fiction-db", "--local",
      "--persist-to", persistencePath,
    ], { cwd: projectRoot, env: process.env, encoding: "utf8" });
    assert.equal(migration.status, 0, `本地 D1 迁移失败：\n${migration.stdout}\n${migration.stderr}`);
    const command = launcher === "vinext"
      ? ["exec", "vinext", "dev", "--port", String(port)]
      : ["exec", "wrangler", "dev", "--config", configPath, "--port", String(port), "--persist-to", persistencePath];
    const runtimeEnv = launcher === "vinext" ? {
      ...process.env,
      WRANGLER_LOG_PATH: ".wrangler/test.log",
      CLOUDFLARE_PERSIST_PATH: persistencePath,
      CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH: configPath,
      CLOUDFLARE_DISABLE_INSPECTOR: "true",
    } : process.env;
    server = spawn("pnpm", command, { cwd: projectRoot, env: runtimeEnv, stdio: ["ignore", "pipe", "pipe"] });
    const collect = (chunk) => { output = `${output}${chunk}`.slice(-20_000); };
    server.stdout.on("data", collect);
    server.stderr.on("data", collect);

    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (server.exitCode !== null) throw new Error(`测试 Worker 提前退出：\n${output}`);
      try {
        const response = await fetch(`${origin}${readinessPath}`);
        if (response.status < 500) return;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`等待测试 Worker 超时：\n${output}`);
  }

  async function stop() {
    if (server && server.exitCode === null) {
      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 2_000);
        server.once("exit", () => { clearTimeout(timeout); resolve(); });
        server.kill("SIGTERM");
      });
    }
    if (persistencePath) await rm(persistencePath, { recursive: true, force: true });
  }

  function executeD1(sql) {
    const result = spawnSync("pnpm", [
      "exec", "wrangler", "d1", "execute", "mist-page-fiction-db", "--local",
      "--persist-to", persistencePath, "--command", sql,
    ], { cwd: projectRoot, env: process.env, encoding: "utf8" });
    assert.equal(result.status, 0, `本地 D1 命令失败：\n${result.stdout}\n${result.stderr}`);
  }

  return { origin, start, stop, executeD1, get output() { return output; } };
}
