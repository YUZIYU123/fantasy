import { AssetLifecycleError, type AssetCommand, type AssetLifecycleResult } from "../db/assets";

type MutationCommand = Extract<AssetCommand, { action: "create-folder" | "rename-folder" | "delete-folder" | "update-asset" }>;

export function parseAssetMutation(input: unknown): MutationCommand {
  const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
  if (!["create-folder", "rename-folder", "delete-folder", "update-asset"].includes(String(body.action || ""))) {
    throw new AssetLifecycleError("不支持的素材操作");
  }
  return body as MutationCommand;
}

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
