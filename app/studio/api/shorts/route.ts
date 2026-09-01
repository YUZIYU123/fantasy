import { creationLifecycle } from "../../../../db/creation-lifecycle";
import { creationLifecycleErrorResponse, creationLifecycleResponse, parseCreationCommand } from "../../../_creation-lifecycle-http";
import { assertSameOrigin, authErrorResponse } from "../../../../lib/auth";
import { sessionAuthorization } from "../../../../lib/session-authorization";

export async function GET(request: Request) {
  try {
    const identity = await sessionAuthorization.requireRole(request, ["author"]);
    return Response.json({ shorts: await creationLifecycle.listShorts({ kind: "author", id: identity.id }) });
  } catch (error) {
    return creationLifecycleErrorResponse(error) ?? authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const identity = await sessionAuthorization.requireRole(request, ["author"]);
    const command = parseCreationCommand("short", await request.json());
    return creationLifecycleResponse(await creationLifecycle.execute({ kind: "author", id: identity.id }, command));
  } catch (error) {
    return creationLifecycleErrorResponse(error) ?? authErrorResponse(error);
  }
}
