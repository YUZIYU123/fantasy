import { env } from "cloudflare:workers";
import { getD1Binding } from "../../../db";

class PlatformDependencyError extends Error {
  constructor(readonly dependency: "D1" | "R2") {
    super(`${dependency}_unavailable`);
  }
}

async function checkDependency(dependency: "D1" | "R2", operation: () => Promise<unknown>) {
  try {
    await operation();
  } catch {
    throw new PlatformDependencyError(dependency);
  }
}

export async function GET() {
  try {
    const platform = env as unknown as { ASSET_BUCKET?: R2Bucket; DEPLOYMENT_ENV?: string };
    const bucket = platform.ASSET_BUCKET;
    if (!bucket) throw new Error("missing_r2_binding");
    await Promise.all([
      checkDependency("D1", () => getD1Binding().prepare("SELECT 1 AS healthy").first()),
      checkDependency("R2", () => bucket.head("__platform_healthcheck__")),
    ]);
    return Response.json({ ok: true, environment: platform.DEPLOYMENT_ENV || "unknown" }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    console.error(JSON.stringify({
      event: "platform_healthcheck_failed",
      dependency: error instanceof PlatformDependencyError ? error.dependency : "binding",
    }));
    return Response.json({ ok: false }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
