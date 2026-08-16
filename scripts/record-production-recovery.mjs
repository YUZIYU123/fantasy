import { spawnSync } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} ${args.join(" ")} 失败`);
  }
  return result.stdout.trim();
}

function wranglerJson(args) {
  return JSON.parse(run("pnpm", ["exec", "wrangler", ...args, "--json"]));
}

async function main() {
  const d1 = wranglerJson([
    "d1",
    "time-travel",
    "info",
    "mist-page-fiction-db",
    "--env",
    "production",
  ]);
  if (typeof d1.bookmark !== "string" || !d1.bookmark) {
    throw new Error("无法记录 production D1 Time Travel bookmark");
  }

  const deployment = wranglerJson(["deployments", "status", "--env", "production"]);
  const versions = deployment.versions?.map((version) => ({
    versionId: version.version_id,
    percentage: version.percentage,
  })) || [];
  if (versions.length === 0 || versions.some((version) => typeof version.versionId !== "string")) {
    throw new Error("无法记录当前 production Worker version");
  }

  const gitCommit = run("git", ["rev-parse", "HEAD"]);
  const recordedAt = new Date().toISOString();
  const recoveryDirectory = process.env.FANTASY_RECOVERY_DIR
    || join(homedir(), ".backups", "fantasy", "recovery");
  await mkdir(recoveryDirectory, { recursive: true, mode: 0o700 });
  await chmod(recoveryDirectory, 0o700);
  const filename = `production-${recordedAt.replaceAll(":", "-")}-${gitCommit.slice(0, 12)}.json`;
  const path = join(recoveryDirectory, filename);
  const record = {
    recordedAt,
    gitCommit,
    d1: {
      database: "mist-page-fiction-db",
      bookmark: d1.bookmark,
    },
    worker: {
      name: "mist-page-fiction",
      deploymentId: deployment.id,
      versions,
    },
  };
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  await chmod(path, 0o600);
  process.stdout.write(`production 恢复记录已保存：${path}\n`);
  process.stdout.write(`D1 bookmark：${d1.bookmark}\n`);
  process.stdout.write(`Worker version：${versions.map((version) => version.versionId).join(", ")}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
