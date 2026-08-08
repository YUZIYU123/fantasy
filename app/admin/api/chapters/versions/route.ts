import { creationLifecycle, creationLifecycleErrorResponse } from "../../../../../db/creation-lifecycle";
import { adminAuthResponse, requireAdmin } from "../../../../../lib/admin-auth";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const chapterId = new URL(request.url).searchParams.get("chapterId");
    if (!chapterId) return Response.json({ versions: [] });
    const versions = await creationLifecycle.listVersions({ kind: "administrator" }, "chapter", chapterId);
    return Response.json({ versions });
  } catch (error) {
    return creationLifecycleErrorResponse(error) ?? adminAuthResponse(error);
  }
}
