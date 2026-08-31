import { creationLifecycle } from "../../../../db/creation-lifecycle";
import { creationLifecycleErrorResponse, creationLifecycleResponse, parseCreationCommand } from "../../../_creation-lifecycle-http";
import { SessionAuthorizationError, sessionAuthorization } from "../../../../lib/session-authorization";
import { sessionAuthorizationResponse } from "../../../_session-authorization-http";

export async function GET(request: Request) {
  try {
    await sessionAuthorization.requireAdministrator(request);
    return Response.json({ shorts: await creationLifecycle.listShorts({ kind: "administrator" }) });
  } catch (error) {
    const response = creationLifecycleErrorResponse(error);
    if (response) return response;
    if (error instanceof SessionAuthorizationError) return sessionAuthorizationResponse(error);
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    await sessionAuthorization.requireAdministrator(request);
    const command = parseCreationCommand("short", await request.json());
    return creationLifecycleResponse(await creationLifecycle.execute({ kind: "administrator" }, command));
  } catch (error) {
    const response = creationLifecycleErrorResponse(error);
    if (response) return response;
    if (error instanceof SessionAuthorizationError) return sessionAuthorizationResponse(error);
    throw error;
  }
}
