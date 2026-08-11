import { env } from "cloudflare:workers";
import { getD1Binding } from "../../../db";

export async function GET() {
  try {
    const bucket = (env as unknown as { ASSET_BUCKET?: R2Bucket }).ASSET_BUCKET;
    if (!bucket) throw new Error("missing_r2_binding");
    await Promise.all([
      getD1Binding().prepare("SELECT 1 AS healthy").first(),
      bucket.head("__platform_healthcheck__"),
    ]);
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error(JSON.stringify({
      event: "platform_healthcheck_failed",
      errorType: error instanceof Error ? error.name : "UnknownError",
    }));
    return Response.json({ ok: false }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
