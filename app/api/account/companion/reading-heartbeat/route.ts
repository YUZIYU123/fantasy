import { companionLifecycle } from "../../../../../db/companion-lifecycle";
import { assertSameOrigin } from "../../../../../lib/auth";
import { sessionAuthorization } from "../../../../../lib/session-authorization";
import { companionLifecycleErrorResponse, companionLifecycleResponse } from "../../../../_companion-lifecycle-http";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const identity = await sessionAuthorization.require(request);
    const body = await request.json() as {
      fact?: string;
      chapterId?: string;
      chapterVersion?: number;
      nodeId?: string;
      windowStartedAt?: string;
      operationId?: string;
    };
    const actor = { kind: "account" as const, id: identity.id };
    if (body.fact === "node-arrival") {
      return companionLifecycleResponse(await companionLifecycle.execute(actor, {
        action: "record-node",
        chapterId: body.chapterId || "",
        chapterVersion: Number(body.chapterVersion),
        nodeId: body.nodeId || "",
      }));
    }
    return companionLifecycleResponse(await companionLifecycle.execute(actor, {
        action: "record-reading",
        chapterId: body.chapterId || "",
        chapterVersion: Number(body.chapterVersion),
        nodeId: body.nodeId || "",
        windowStartedAt: body.windowStartedAt || "",
        operationId: body.operationId || "",
      }));
  } catch (error) {
    return companionLifecycleErrorResponse(error);
  }
}
