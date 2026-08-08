import { creationLifecycle } from "../../../../../db/creation-lifecycle";
import { creationLifecycleErrorResponse } from "../../../../_creation-lifecycle-http";
import { adminAuthResponse, AdminAuthError, requireAdmin } from "../../../../../lib/admin-auth";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const chapterId = new URL(request.url).searchParams.get("chapterId");
    if (!chapterId) return Response.json({ versions: [] });
    const versions = await creationLifecycle.listVersions({ kind: "administrator" }, "chapter", chapterId);
    return Response.json({ versions });
  } catch (error) {
    const response = creationLifecycleErrorResponse(error);
    if (response) return response;
    if (error instanceof AdminAuthError) return adminAuthResponse(error);
    throw error;
  }
}
