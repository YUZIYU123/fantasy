import type { AccountResult } from "../db/account-lifecycle";

export function accountLifecycleResponse(result: AccountResult) {
  return Response.json(result.body, {
    status: result.status,
    ...(result.cookie ? { headers: { "set-cookie": result.cookie } } : {}),
  });
}
