import { env } from "cloudflare:workers";
import { assetLifecycle } from "../../../../db/assets";
import { assetLifecycleErrorResponse, assetLifecycleResponse, parseAssetMutation } from "../../../_asset-lifecycle-http";
import { adminAuthResponse, AdminAuthError, requireAdmin } from "../../../../lib/admin-auth";

const actor = { kind: "administrator" } as const;

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    return Response.json(await assetLifecycle.list(actor));
  } catch (error) {
    const response = assetLifecycleErrorResponse(error);
    if (response) return response;
    if (error instanceof AdminAuthError) return adminAuthResponse(error);
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "请选择文件" }, { status: 400 });
    return assetLifecycleResponse(await assetLifecycle.execute(actor, {
      action: "upload", bucket: env.ASSET_BUCKET, file,
      duration: Number(form.get("duration")) || 0,
      folderId: String(form.get("folderId") || "") || null,
      alt: String(form.get("alt") || ""),
    }));
  } catch (error) {
    const response = assetLifecycleErrorResponse(error);
    if (response) return response;
    if (error instanceof AdminAuthError) return adminAuthResponse(error);
    throw error;
  }
}

export async function PATCH(request: Request) {
  try {
    await requireAdmin(request);
    const body = parseAssetMutation(await request.json());
    return assetLifecycleResponse(await assetLifecycle.execute(actor, body));
  } catch (error) {
    const response = assetLifecycleErrorResponse(error);
    if (response) return response;
    if (error instanceof AdminAuthError) return adminAuthResponse(error);
    throw error;
  }
}

export async function DELETE(request: Request) {
  try {
    await requireAdmin(request);
    return assetLifecycleResponse(await assetLifecycle.execute(actor, {
      action: "delete", id: new URL(request.url).searchParams.get("id") || undefined, bucket: env.ASSET_BUCKET,
    }));
  } catch (error) {
    const response = assetLifecycleErrorResponse(error);
    if (response) return response;
    if (error instanceof AdminAuthError) return adminAuthResponse(error);
    throw error;
  }
}
