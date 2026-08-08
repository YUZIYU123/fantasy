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
    return Response.json({ novels: await creationLifecycle.list(actor, "novel") });
  } catch (error) {
    return creationLifecycleErrorResponse(error) ?? adminAuthResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    const payload = await request.json() as Omit<CreationCommand, "entity">;
    return creationLifecycleResponse(await creationLifecycle.execute(actor, { ...payload, entity: "novel" }));
  } catch (error) {
    return creationLifecycleErrorResponse(error) ?? adminAuthResponse(error);
  }
}
