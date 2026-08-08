import {
  creationLifecycle,
} from "../../../../db/creation-lifecycle";
import { creationLifecycleErrorResponse, creationLifecycleResponse, parseCreationCommand } from "../../../_creation-lifecycle-http";
import { adminAuthResponse, AdminAuthError, requireAdmin } from "../../../../lib/admin-auth";

const actor = { kind: "administrator" } as const;

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    return Response.json({ chapters: await creationLifecycle.list(actor, "chapter") });
  } catch (error) {
    const response = creationLifecycleErrorResponse(error);
    if (response) return response;
    if (error instanceof AdminAuthError) return adminAuthResponse(error);
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    const command = parseCreationCommand("chapter", await request.json());
    return creationLifecycleResponse(await creationLifecycle.execute(actor, command));
  } catch (error) {
    const response = creationLifecycleErrorResponse(error);
    if (response) return response;
    if (error instanceof AdminAuthError) return adminAuthResponse(error);
    throw error;
  }
}
