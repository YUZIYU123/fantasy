import { companionLifecycle } from "../../../../db/companion-lifecycle";
import { sessionAuthorization } from "../../../../lib/session-authorization";
import { companionLifecycleErrorResponse, companionLifecycleResponse } from "../../../_companion-lifecycle-http";

export async function GET(request: Request) {
  try {
    const identity = await sessionAuthorization.require(request);
    return companionLifecycleResponse(await companionLifecycle.execute(
      { kind: "account", id: identity.id },
      { action: "observe" },
    ));
  } catch (error) {
    return companionLifecycleErrorResponse(error);
  }
}
