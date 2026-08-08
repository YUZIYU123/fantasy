import {
  creationLifecycle,
  creationLifecycleErrorResponse,
  creationLifecycleResponse,
  type CreationCommand,
} from "../../../../db/creation-lifecycle";
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
    const payload = await request.json() as Omit<CreationCommand, "entity">;
    const actor = { kind: "author", id: identity.id } as const;
    return creationLifecycleResponse(await creationLifecycle.execute(actor, { ...payload, entity: "novel" }));
  } catch (error) {
    return creationLifecycleErrorResponse(error) ?? authErrorResponse(error);
  }
}
