import { accountLifecycle } from "../../../../db/account-lifecycle";
import { accountLifecycleResponse } from "../../../_account-lifecycle-http";
import { adminAuthResponse } from "../../../../lib/admin-auth";
import { AuthError, authErrorResponse, type UserRole } from "../../../../lib/auth";
import { administratorCapability } from "../../../../lib/session-authorization";

export async function GET(request: Request) {
  try {
    await administratorCapability.require(request);
    return accountLifecycleResponse(await accountLifecycle.execute({ action: "list-users" }));
  } catch (error) {
    return error instanceof AuthError ? authErrorResponse(error) : adminAuthResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    await administratorCapability.require(request);
    const body = await request.json() as { id?: string; role?: UserRole; status?: "active" | "disabled" };
    if (!body.id) return Response.json({ error: "缺少用户 ID" }, { status: 400 });
    return accountLifecycleResponse(await accountLifecycle.execute({ action: "update-user", id: body.id, role: body.role, status: body.status }));
  } catch (error) {
    return error instanceof AuthError ? authErrorResponse(error) : adminAuthResponse(error);
  }
}
