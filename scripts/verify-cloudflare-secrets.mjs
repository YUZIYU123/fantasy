import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const target = process.argv[2];
if (target !== "staging" && target !== "production") throw new Error("secret 检查只接受 staging 或 production");
const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
const required = config.env[target].secrets?.required || [];
const result = spawnSync("pnpm", ["exec", "wrangler", "secret", "list", "--env", target, "--format", "json"], {
  encoding: "utf8",
});
if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || "无法读取 Cloudflare secrets\n");
  process.exitCode = 1;
} else {
  const remote = JSON.parse(result.stdout);
  const available = new Set(remote.map((item) => item.name));
  const missing = required.filter((name) => !available.has(name));
  if (missing.length > 0) throw new Error(`${target} 缺少 Cloudflare secrets：${missing.join(", ")}`);
  process.stdout.write(`${target} Cloudflare secret 名称检查通过。\n`);
}
