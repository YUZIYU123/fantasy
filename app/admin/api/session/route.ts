import {
  sessionAuthorization,
} from "../../../../lib/session-authorization";
import { sessionAuthorizationResponse } from "../../../_session-authorization-http";

const noStore = { "cache-control": "no-store" };

export async function GET(request: Request) {
  try {
    const decision = await sessionAuthorization.resolveCreatorAccess(request, "admin_workspace");
    if (decision.outcome === "redirect") {
      return Response.json({ authenticated: false, ...decision }, { headers: noStore });
    }
    if (decision.outcome === "deny") {
      return Response.json({ authenticated: false, ...decision }, { headers: noStore });
    }
    const identity = decision.administrator;
    if (!identity) return sessionAuthorizationResponse(new Error("管理员身份缺失"));
    return Response.json({ authenticated: true, ...decision, role: identity.role, email: identity.email }, { headers: noStore });
  } catch (error) {
    return sessionAuthorizationResponse(error);
  }
}

export async function POST(request: Request) {
  let password = "";
  try {
    const body = await request.json() as { password?: unknown };
    password = typeof body.password === "string" ? body.password : "";
  } catch {
    return Response.json({ error: "登录请求格式无效" }, { status: 400 });
  }
  try {
    const cookie = await sessionAuthorization.authenticateSharedCredential(request, password);
    return Response.json({ authenticated: true, role: "admin" }, { headers: { ...noStore, "set-cookie": cookie } });
  } catch (error) {
    return sessionAuthorizationResponse(error);
  }
}

export async function DELETE(request: Request) {
  return Response.json({ authenticated: false }, {
    headers: { ...noStore, "set-cookie": sessionAuthorization.clearSharedCredential(request) },
  });
}
