import { ensureSchema } from "../../../../db";
import { accountLifecycle } from "../../../../db/account-runtime";
import { assertSameOrigin, authErrorResponse } from "../../../../lib/auth";
import { sessionAuthorization } from "../../../../lib/session-authorization";
import { accountLifecycleResponse } from "../../../_account-lifecycle-http";

export async function GET(request: Request) {
  try {
    await ensureSchema();
    const actor = await sessionAuthorization.require(request);
    return accountLifecycle.execute({ action: "get-guide-memory", actorId: actor.id }).then(accountLifecycleResponse);
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    await ensureSchema();
    const actor = await sessionAuthorization.require(request);
    const body = await request.json() as Record<string, unknown>;
    if (typeof body.analyticsAllowed === "boolean" && !("preferences" in body)) {
      return accountLifecycle.execute({
        action: "set-registration-analytics-preference", actorId: actor.id, allowed: body.analyticsAllowed,
      }).then(accountLifecycleResponse);
    }
    return accountLifecycle.execute({
      action: "update-guide-memory", actorId: actor.id,
      preferences: body.preferences, completeGuide: body.completeGuide === true,
    }).then(accountLifecycleResponse);
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    await ensureSchema();
    const actor = await sessionAuthorization.require(request);
    return accountLifecycle.execute({ action: "clear-guide-memory", actorId: actor.id }).then(accountLifecycleResponse);
  } catch (error) {
    return authErrorResponse(error);
  }
}
