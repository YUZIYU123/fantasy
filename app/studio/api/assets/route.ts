import { env } from "cloudflare:workers";
import { assetLifecycle } from "../../../../db/assets";
import { assetLifecycleErrorResponse, assetLifecycleResponse } from "../../../_asset-lifecycle-http";
import { assertSameOrigin, authErrorResponse, requireRole } from "../../../../lib/auth";

export async function GET(request: Request) {
  try {
    const identity = await requireRole(request, ["author"]);
    return Response.json(await assetLifecycle.list({ kind: "author", id: identity.id }));
  } catch (error) {
    return assetLifecycleErrorResponse(error) ?? authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const identity = await requireRole(request, ["author"]);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "请选择文件" }, { status: 400 });
    return assetLifecycleResponse(await assetLifecycle.execute({ kind: "author", id: identity.id }, {
      action: "upload", bucket: env.ASSET_BUCKET, file,
      duration: Number(form.get("duration")) || 0,
      folderId: String(form.get("folderId") || "") || null,
      alt: String(form.get("alt") || ""),
    }));
  } catch (error) {
    return assetLifecycleErrorResponse(error) ?? authErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const identity = await requireRole(request, ["author"]);
    const body = await request.json() as { action: "create-folder" | "rename-folder" | "delete-folder" | "update-asset"; id?: string; name?: string; folderId?: string | null };
    return assetLifecycleResponse(await assetLifecycle.execute({ kind: "author", id: identity.id }, body));
  } catch (error) {
    return assetLifecycleErrorResponse(error) ?? authErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const identity = await requireRole(request, ["author"]);
    return assetLifecycleResponse(await assetLifecycle.execute({ kind: "author", id: identity.id }, {
      action: "delete", id: new URL(request.url).searchParams.get("id") || undefined, bucket: env.ASSET_BUCKET,
    }));
  } catch (error) {
    return assetLifecycleErrorResponse(error) ?? authErrorResponse(error);
  }
}
