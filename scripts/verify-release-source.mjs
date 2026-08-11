import { spawnSync } from "node:child_process";

const target = process.argv[2];
if (target !== "staging" && target !== "production") {
  throw new Error("发布来源检查只接受 staging 或 production");
}

function git(args, { inherit = false } = {}) {
  const result = spawnSync("git", args, { encoding: "utf8", stdio: inherit ? "inherit" : "pipe" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} 失败${result.stderr ? `：${result.stderr.trim()}` : ""}`);
  return result.stdout?.trim() || "";
}

git(["fetch", "--prune", "origin"], { inherit: true });
if (git(["status", "--porcelain"])) throw new Error("工作区不干净，拒绝发布");
const branch = git(["branch", "--show-current"]);
if (!branch) throw new Error("detached HEAD 不能发布");
if (target === "production" && branch !== "main") throw new Error("production 只能从 main 发布");
const upstream = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
const head = git(["rev-parse", "HEAD"]);
const upstreamHead = git(["rev-parse", upstream]);
if (head !== upstreamHead) throw new Error(`本地 HEAD 与上游 ${upstream} 不一致，拒绝发布`);
process.stdout.write(`发布来源已确认：${branch} ${head}\n`);
