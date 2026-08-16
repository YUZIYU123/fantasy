import { accountLifecycle } from "../../../../db/account-runtime";
import { assertSameOrigin, authErrorResponse, clearSessionCookie } from "../../../../lib/auth";
import { sessionAuthorization } from "../../../../lib/session-authorization";
import { accountLifecycleResponse } from "../../../_account-lifecycle-http";

export async function GET(request: Request) {
  try {
    const actor = await sessionAuthorization.require(request);
    return accountLifecycleResponse(await accountLifecycle.execute({ action: "export-account-data", actorId: actor.id }));
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await sessionAuthorization.require(request);
    const body = await request.json() as { confirmation?: unknown };
    const result = await accountLifecycle.execute({
      action: "delete-account", request, actorId: actor.id, confirmation: String(body.confirmation || ""),
    });
    const response = accountLifecycleResponse(result);
    const headers = new Headers(response.headers);
    headers.set("set-cookie", clearSessionCookie(request));
    return new Response(response.body, { status: response.status, headers });
  } catch (error) {
    return authErrorResponse(error);
  }
}
