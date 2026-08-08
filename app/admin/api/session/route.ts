import { adminAuthResponse } from "../../../../lib/admin-auth";
import { administratorCapability, AdministratorCapabilityError } from "../../../../lib/session-authorization";

const noStore = { "cache-control": "no-store" };

export async function GET(request: Request) {
  try {
    const identity = await administratorCapability.require(request);
    return Response.json({ authenticated: true, role: identity.role, email: identity.email }, { headers: noStore });
  } catch (error) {
    return adminAuthResponse(error);
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
    const cookie = await administratorCapability.authenticateSharedCredential(request, password);
    return Response.json({ authenticated: true, role: "admin" }, { headers: { ...noStore, "set-cookie": cookie } });
  } catch (error) {
    if (error instanceof AdministratorCapabilityError) {
      return Response.json({ error: error.message }, {
        status: error.status,
        headers: { ...noStore, ...(error.retryAfter ? { "retry-after": String(error.retryAfter) } : {}) },
      });
    }
    return adminAuthResponse(error);
  }
}

export async function DELETE(request: Request) {
  return Response.json({ authenticated: false }, {
    headers: { ...noStore, "set-cookie": administratorCapability.clearSharedCredential(request) },
  });
}
