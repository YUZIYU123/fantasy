import {
  creationLifecycle,
} from "../../../../db/creation-lifecycle";
import { creationLifecycleErrorResponse, creationLifecycleResponse, parseCreationCommand } from "../../../_creation-lifecycle-http";
import { adminAuthResponse, AdminAuthError } from "../../../../lib/admin-auth";
import { sessionAuthorization } from "../../../../lib/session-authorization";

const actor = { kind: "administrator" } as const;

export async function GET(request: Request) {
  try {
    await sessionAuthorization.requireAdministrator(request);
    return Response.json({ novels: await creationLifecycle.list(actor, "novel") });
  } catch (error) {
    const response = creationLifecycleErrorResponse(error);
    if (response) return response;
    if (error instanceof AdminAuthError) return adminAuthResponse(error);
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    await sessionAuthorization.requireAdministrator(request);
    const command = parseCreationCommand("novel", await request.json());
    return creationLifecycleResponse(await creationLifecycle.execute(actor, command));
  } catch (error) {
    const response = creationLifecycleErrorResponse(error);
    if (response) return response;
    if (error instanceof AdminAuthError) return adminAuthResponse(error);
    throw error;
  }
}
