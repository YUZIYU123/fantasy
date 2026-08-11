import type { AccountResult } from "../db/account-lifecycle";

export function accountLifecycleResponse(result: AccountResult) {
  return Response.json(result.body, {
    status: result.status,
    headers: {
      "cache-control": "private, no-store",
      ...(result.cookie ? { "set-cookie": result.cookie } : {}),
    },
  });
}
