import { CreationLifecycleError } from "../db/creation-lifecycle";

export const publicCreationHeaders = { "cache-control": "public, max-age=30, s-maxage=60" };

export function publicCreationErrorResponse(error: unknown, fallback: string) {
  if (error instanceof CreationLifecycleError) {
    return Response.json({ error: error.message }, {
      status: error.status,
      headers: { "cache-control": "no-store" },
    });
  }
  return Response.json({ error: fallback }, {
    status: 503,
    headers: { "cache-control": "no-store" },
  });
}
