import { companionLifecycle } from "../../../../../db/companion-lifecycle";
import { assertSameOrigin } from "../../../../../lib/auth";
import { CompanionError } from "../../../../../lib/companion-lifecycle";
import { sessionAuthorization } from "../../../../../lib/session-authorization";
import { companionLifecycleErrorResponse, companionLifecycleResponse } from "../../../../_companion-lifecycle-http";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const identity = await sessionAuthorization.require(request);
    const body = await request.json() as { action?: string; kind?: string; itemId?: string; operationId?: string; confirmation?: string };
    if (body.action === "reset") {
      return companionLifecycleResponse(await companionLifecycle.execute(
        { kind: "account", id: identity.id },
        { action: "reset", confirmation: body.confirmation || "" },
      ));
    }
    if (body.action === "purchase" || body.action === "equip") {
      if (body.kind !== "appearance" && body.kind !== "garden") throw new CompanionError("收藏类型无效");
      return companionLifecycleResponse(await companionLifecycle.execute(
        { kind: "account", id: identity.id },
        { action: body.action, kind: body.kind, itemId: body.itemId || "", operationId: body.operationId || "" },
      ));
    }
    if (body.action === "perform-action") {
      return companionLifecycleResponse(await companionLifecycle.execute(
        { kind: "account", id: identity.id },
        { action: "perform-action", itemId: body.itemId || "" },
      ));
    }
    if (body.action !== "touch" && body.action !== "play" && body.action !== "rest") {
      throw new CompanionError("小雾互动无效");
    }
    return companionLifecycleResponse(await companionLifecycle.execute(
      { kind: "account", id: identity.id },
      { action: "interact", kind: body.action, operationId: body.operationId || "" },
    ));
  } catch (error) {
    return companionLifecycleErrorResponse(error);
  }
}
