import { AssetLifecycleError, type AssetLifecycleResult } from "../db/assets";

export function assetLifecycleResponse(result: AssetLifecycleResult) {
  if (result.kind === "folder") return Response.json({ folder: result.folder }, { status: 201 });
  if (result.kind === "asset") {
    return Response.json(result.sourceKey ? { asset: result.asset, sourceKey: result.sourceKey } : { asset: result.asset }, { status: 201 });
  }
  return Response.json({ ok: true });
}

export function assetLifecycleErrorResponse(error: unknown) {
  if (!(error instanceof AssetLifecycleError)) return null;
  return Response.json({ error: error.message, ...(error.references ? { references: error.references } : {}) }, { status: error.status });
}
