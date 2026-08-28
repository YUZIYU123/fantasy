import { CompanionError } from "../lib/companion-lifecycle";
import { authErrorResponse } from "../lib/auth";

export function companionLifecycleResponse(result: unknown, status = 200) {
  return Response.json(result, { status, headers: { "cache-control": "private, no-store" } });
}

export function companionLifecycleErrorResponse(error: unknown) {
  if (error instanceof CompanionError) return Response.json({ error: error.message }, {
    status: error.status,
    headers: { "cache-control": "private, no-store" },
  });
  return authErrorResponse(error);
}
