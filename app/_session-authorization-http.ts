import { SessionAuthorizationError } from "../lib/session-authorization-module";

export function sessionAuthorizationResponse(error: unknown) {
  if (error instanceof SessionAuthorizationError) {
    return Response.json({ error: error.message }, {
      status: error.status,
      headers: {
        "cache-control": "no-store",
        ...(error.retryAfter ? { "retry-after": String(error.retryAfter) } : {}),
      },
    });
  }
  return Response.json({ error: "权限检查失败，请稍后重试" }, {
    status: 503,
    headers: { "cache-control": "no-store" },
  });
}
