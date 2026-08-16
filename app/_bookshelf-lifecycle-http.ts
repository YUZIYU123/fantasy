import { BookshelfError } from "../lib/bookshelf-lifecycle";
import { SessionAuthorizationError } from "../lib/session-authorization-module";

export function bookshelfLifecycleResponse(result: unknown, status = 200) {
  return Response.json(result, { status, headers: { "cache-control": "private, no-store" } });
}

export function bookshelfLifecycleErrorResponse(error: unknown) {
  if (error instanceof BookshelfError || error instanceof SessionAuthorizationError) {
    const retryAfterSeconds = "retryAfterSeconds" in error ? error.retryAfterSeconds : undefined;
    return Response.json({ error: error.message, ...(retryAfterSeconds ? { retryAfterSeconds } : {}) }, {
      status: error.status,
      headers: { "cache-control": "private, no-store", ...(retryAfterSeconds ? { "retry-after": String(retryAfterSeconds) } : {}) },
    });
  }
  return Response.json({ error: "书架暂时不可用，请稍后重试" }, {
    status: 503,
    headers: { "cache-control": "private, no-store" },
  });
}
