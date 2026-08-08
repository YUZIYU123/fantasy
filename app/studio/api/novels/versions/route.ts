import { creationLifecycle, creationLifecycleErrorResponse } from "../../../../../db/creation-lifecycle";
import { authErrorResponse, requireRole } from "../../../../../lib/auth";

export async function GET(request: Request) {
  try {
    const identity = await requireRole(request, ["author"]);
    const novelId = new URL(request.url).searchParams.get("novelId");
    if (!novelId) return Response.json({ versions: [] });
    const versions = await creationLifecycle.listVersions({ kind: "author", id: identity.id }, "novel", novelId);
    return Response.json({ versions });
  } catch (error) {
    return creationLifecycleErrorResponse(error) ?? authErrorResponse(error);
  }
}
