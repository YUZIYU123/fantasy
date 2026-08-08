import {
  creationLifecycle,
  creationLifecycleErrorResponse,
  creationLifecycleResponse,
  type CreationCommand,
} from "../../../../db/creation-lifecycle";
import { adminAuthResponse, requireAdmin } from "../../../../lib/admin-auth";

const actor = { kind: "administrator" } as const;

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    return Response.json({ chapters: await creationLifecycle.list(actor, "chapter") });
  } catch (error) {
    return creationLifecycleErrorResponse(error) ?? adminAuthResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    const payload = await request.json() as Omit<CreationCommand, "entity">;
    return creationLifecycleResponse(await creationLifecycle.execute(actor, { ...payload, entity: "chapter" }));
  } catch (error) {
    return creationLifecycleErrorResponse(error) ?? adminAuthResponse(error);
  }
}
