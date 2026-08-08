import {
  creationLifecycle,
} from "../../../../db/creation-lifecycle";
import { creationLifecycleErrorResponse, creationLifecycleResponse, parseCreationCommand } from "../../../_creation-lifecycle-http";
import { assertSameOrigin, authErrorResponse, requireRole } from "../../../../lib/auth";

export async function GET(request: Request) {
  try {
    const identity = await requireRole(request, ["author"]);
    const actor = { kind: "author", id: identity.id } as const;
    return Response.json({ novels: await creationLifecycle.list(actor, "novel") });
  } catch (error) {
    return creationLifecycleErrorResponse(error) ?? authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const identity = await requireRole(request, ["author"]);
    const command = parseCreationCommand("novel", await request.json());
    const actor = { kind: "author", id: identity.id } as const;
    return creationLifecycleResponse(await creationLifecycle.execute(actor, command));
  } catch (error) {
    return creationLifecycleErrorResponse(error) ?? authErrorResponse(error);
  }
}
