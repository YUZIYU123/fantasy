import {
  adminAuthResponse,
  clearCreatorSessionCookie,
  createCreatorSessionCookie,
  creatorAuthConfigured,
  requireAdmin,
  verifyCreatorPassword,
} from "../../../../lib/admin-auth";

const attempts = new Map<string, { count: number; resetAt: number }>();
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const ATTEMPT_LIMIT = 8;

function clientKey(request: Request) {
  return request.headers.get("cf-connecting-ip") || "unknown";
}

function attemptState(request: Request) {
  const key = clientKey(request);
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    const fresh = { count: 0, resetAt: now + ATTEMPT_WINDOW_MS };
    attempts.set(key, fresh);
    return { key, state: fresh };
  }
  return { key, state: current };
}

export async function GET(request: Request) {
  try {
    const identity = await requireAdmin(request);
    return Response.json({ authenticated: true, role: identity.role, email: identity.email }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return adminAuthResponse(error);
  }
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: "请求来源无效" }, { status: 403 });
  }
  if (!creatorAuthConfigured()) {
    return Response.json({ error: "尚未配置创作者登录密钥" }, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }

  const { key, state } = attemptState(request);
  if (state.count >= ATTEMPT_LIMIT) {
    return Response.json({ error: "登录尝试过多，请稍后再试" }, {
      status: 429,
      headers: {
        "cache-control": "no-store",
        "retry-after": String(Math.ceil((state.resetAt - Date.now()) / 1000)),
      },
    });
  }

  let password = "";
  try {
    const body = await request.json() as { password?: unknown };
    password = typeof body.password === "string" ? body.password : "";
  } catch {
    return Response.json({ error: "登录请求格式无效" }, { status: 400 });
  }

  if (!await verifyCreatorPassword(password)) {
    state.count += 1;
    attempts.set(key, state);
    return Response.json({ error: "创作者密码不正确" }, {
      status: 401,
      headers: { "cache-control": "no-store" },
    });
  }

  attempts.delete(key);
  return Response.json({ authenticated: true, role: "admin" }, {
    headers: {
      "cache-control": "no-store",
      "set-cookie": await createCreatorSessionCookie(request),
    },
  });
}

export async function DELETE(request: Request) {
  return Response.json({ authenticated: false }, {
    headers: {
      "cache-control": "no-store",
      "set-cookie": clearCreatorSessionCookie(request),
    },
  });
}
