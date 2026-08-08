import { creationLifecycle } from "../../../../../db/creation-lifecycle";
import { creationLifecycleErrorResponse } from "../../../../_creation-lifecycle-http";
import { authErrorResponse, requireRole } from "../../../../../lib/auth";

export async function GET(request: Request) {
  try {
    const identity = await requireRole(request, ["author"]);
    const chapterId = new URL(request.url).searchParams.get("chapterId");
    if (!chapterId) return Response.json({ versions: [] });
    const versions = await creationLifecycle.listVersions({ kind: "author", id: identity.id }, "chapter", chapterId);
    return Response.json({ versions });
  } catch (error) {
    return creationLifecycleErrorResponse(error) ?? authErrorResponse(error);
  }
}
