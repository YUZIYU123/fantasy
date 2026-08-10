import { env } from "cloudflare:workers";
import { ensureSchema } from "../../../../db";
import { accountLifecycle, type AccountCommand } from "../../../../db/account-lifecycle";
import { accountLifecycleResponse } from "../../../_account-lifecycle-http";
import { authErrorResponse, clearSessionCookie } from "../../../../lib/auth";
import { sessionAuthorization } from "../../../../lib/session-authorization";
import { sessionAuthorizationResponse } from "../../../_session-authorization-http";

type Context = { params: Promise<{ action: string[] }> };

function actionName(values: string[]) {
  return values.join("/");
}

export async function GET(request: Request, context: Context) {
  const action = actionName((await context.params).action);
  if (action === "creator-entry") {
    try {
      const decision = await sessionAuthorization.resolveCreatorAccess(request, "entry");
      return Response.json({
        destination: decision.destination,
        redirectTo: decision.redirectTo,
        reason: decision.reason,
        accountRole: decision.accountRole,
      }, { headers: { "cache-control": "no-store" } });
    } catch (error) {
      return sessionAuthorizationResponse(error);
    }
  }
  await ensureSchema();
  if (action === "me") return Response.json({ user: await sessionAuthorization.optional(request) });
  if (action === "config") {
    return Response.json({ turnstileSiteKey: (env as unknown as { TURNSTILE_SITE_KEY?: string }).TURNSTILE_SITE_KEY || "" });
  }
  return Response.json({ error: "不支持的账号操作" }, { status: 404 });
}

function commandFor(action: string, request: Request, body: Record<string, unknown>): AccountCommand | null {
  if (action === "register") return { action, request, email: String(body.email || ""), displayName: String(body.displayName || ""), password: String(body.password || ""), turnstileToken: String(body.turnstileToken || "") };
  if (action === "login") return { action, request, email: String(body.email || ""), password: String(body.password || "") };
  if (action === "verify-email") return { action, request, token: String(body.token || "") };
  if (action === "forgot-password") return { action, request, email: String(body.email || ""), turnstileToken: String(body.turnstileToken || "") };
  if (action === "reset-password") return { action, request, token: String(body.token || ""), password: String(body.password || "") };
  return null;
}

export async function POST(request: Request, context: Context) {
  try {
    await ensureSchema();
    const action = actionName((await context.params).action);
    if (action === "logout") {
      const result = await accountLifecycle.execute({ action, request });
      return Response.json(result.body, { headers: { "set-cookie": clearSessionCookie(request) } });
    }
    if (action === "profile") {
      const body = await request.json() as Record<string, unknown>;
      const actor = await sessionAuthorization.require(request);
      return accountLifecycle.execute({ action, actorId: actor.id, displayName: String(body.displayName || "") }).then(accountLifecycleResponse);
    }
    const command = commandFor(action, request, await request.json() as Record<string, unknown>);
    if (!command) return Response.json({ error: "不支持的账号操作" }, { status: 404 });
    // Keep the existing route's asynchronous error mapping behavior for HTTP compatibility.
    return accountLifecycle.execute(command).then(accountLifecycleResponse);
  } catch (error) {
    return authErrorResponse(error);
  }
}
