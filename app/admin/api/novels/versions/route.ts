import { creationLifecycle } from "../../../../../db/creation-lifecycle";
import { creationLifecycleErrorResponse } from "../../../../_creation-lifecycle-http";
import { SessionAuthorizationError, sessionAuthorization } from "../../../../../lib/session-authorization";
import { sessionAuthorizationResponse } from "../../../../_session-authorization-http";

export async function GET(request: Request) {
  try {
    await sessionAuthorization.requireAdministrator(request);
    const novelId = new URL(request.url).searchParams.get("novelId");
    if (!novelId) return Response.json({ versions: [] });
    const versions = await creationLifecycle.listVersions({ kind: "administrator" }, "novel", novelId);
    return Response.json({ versions });
  } catch (error) {
    const response = creationLifecycleErrorResponse(error);
    if (response) return response;
    if (error instanceof SessionAuthorizationError) return sessionAuthorizationResponse(error);
    throw error;
  }
}
