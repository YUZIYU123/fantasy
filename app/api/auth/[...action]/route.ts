import { env } from "cloudflare:workers";
import { ensureSchema } from "../../../../db";
import type { AccountCommand } from "../../../../db/account-lifecycle";
import { accountLifecycle, accountRegistrationConfig } from "../../../../db/account-runtime";
import { accountLifecycleResponse } from "../../../_account-lifecycle-http";
import { authErrorResponse, clearSessionCookie } from "../../../../lib/auth";
import { sessionAuthorization } from "../../../../lib/session-authorization";
import { sessionAuthorizationResponse } from "../../../_session-authorization-http";
import { normalizeRegistrationTelemetryEvent } from "../../../../lib/registration-telemetry";

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
  if (action === "verify-email") {
    const token = new URL(request.url).searchParams.get("token") || "";
    const actor = await sessionAuthorization.optional(request);
    return accountLifecycleResponse(await accountLifecycle.execute({
      action: "inspect-email-verification", token, actorId: actor?.id,
    }));
  }
  if (action === "registration-outcome") {
    const operationId = new URL(request.url).searchParams.get("operationId") || "";
    return accountLifecycleResponse(await accountLifecycle.execute({ action: "get-registration-outcome", operationId }));
  }
  if (action === "me") return Response.json({ user: await sessionAuthorization.optional(request) });
  if (action === "config") {
    return Response.json({
      turnstileSiteKey: (env as unknown as { TURNSTILE_SITE_KEY?: string }).TURNSTILE_SITE_KEY || "",
      registrationEnabled: accountRegistrationConfig().registrationEnabled,
    });
  }
  return Response.json({ error: "不支持的账号操作" }, { status: 404 });
}

function commandFor(action: string, request: Request, body: Record<string, unknown>): AccountCommand | null {
  if (action === "register") return {
    action,
    request,
    email: String(body.email || ""),
    displayName: String(body.displayName || ""),
    password: String(body.password || ""),
    turnstileToken: String(body.turnstileToken || ""),
    ageConfirmed: body.ageConfirmed === true,
    termsAccepted: body.termsAccepted === true,
    privacyAccepted: body.privacyAccepted === true,
    analyticsAllowed: body.analyticsAllowed === true,
    operationId: typeof body.operationId === "string" ? body.operationId : undefined,
  };
  if (action === "login") return { action, request, email: String(body.email || ""), password: String(body.password || "") };
  if (action === "verify-email" || action === "activate-account") return {
    action: "activate-account",
    request,
    token: String(body.token || ""),
    intent: body.intent && typeof body.intent === "object" ? body.intent as never : null,
    analyticsAllowed: body.analyticsAllowed === true,
  };
  if (action === "resend-verification") return {
    action,
    request,
    email: String(body.email || ""),
    turnstileToken: String(body.turnstileToken || ""),
    analyticsAllowed: body.analyticsAllowed === true,
    operationId: typeof body.operationId === "string" ? body.operationId : undefined,
  };
  if (action === "restart-registration") return {
    action,
    request,
    currentEmail: String(body.currentEmail || ""),
    email: String(body.email || ""),
    displayName: String(body.displayName || ""),
    password: String(body.password || ""),
    turnstileToken: String(body.turnstileToken || ""),
    ageConfirmed: body.ageConfirmed === true,
    termsAccepted: body.termsAccepted === true,
    privacyAccepted: body.privacyAccepted === true,
    analyticsAllowed: body.analyticsAllowed === true,
    operationId: typeof body.operationId === "string" ? body.operationId : undefined,
  };
  if (action === "record-registration-event") {
    const event = normalizeRegistrationTelemetryEvent(body.event);
    return event ? { action, event, analyticsAllowed: body.analyticsAllowed === true } : null;
  }
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
      return accountLifecycleResponse(await accountLifecycle.execute({
        action, actorId: actor.id, displayName: String(body.displayName || ""),
      }));
    }
    const command = commandFor(action, request, await request.json() as Record<string, unknown>);
    if (!command) return Response.json({ error: "不支持的账号操作" }, { status: 404 });
    return accountLifecycleResponse(await accountLifecycle.execute(command));
  } catch (error) {
    return authErrorResponse(error);
  }
}
