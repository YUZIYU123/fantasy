import { accountLifecycle } from "../../../../db/account-lifecycle";
import { accountLifecycleResponse } from "../../../_account-lifecycle-http";
import { AuthError, authErrorResponse, type UserRole } from "../../../../lib/auth";
import { SessionAuthorizationError, sessionAuthorization } from "../../../../lib/session-authorization";
import { sessionAuthorizationResponse } from "../../../_session-authorization-http";

export async function GET(request: Request) {
  try {
    await sessionAuthorization.requireAdministrator(request);
    return accountLifecycleResponse(await accountLifecycle.execute({ action: "list-users" }));
  } catch (error) {
    if (error instanceof SessionAuthorizationError) return sessionAuthorizationResponse(error);
    return error instanceof AuthError ? authErrorResponse(error) : sessionAuthorizationResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    await sessionAuthorization.requireAdministrator(request);
    const body = await request.json() as { id?: string; role?: UserRole; status?: "active" | "disabled" };
    if (!body.id) return Response.json({ error: "缺少用户 ID" }, { status: 400 });
    return accountLifecycleResponse(await accountLifecycle.execute({ action: "update-user", id: body.id, role: body.role, status: body.status }));
  } catch (error) {
    if (error instanceof SessionAuthorizationError) return sessionAuthorizationResponse(error);
    return error instanceof AuthError ? authErrorResponse(error) : sessionAuthorizationResponse(error);
  }
}
