import { env } from "cloudflare:workers";
import { AuthError } from "../lib/auth";

type AuthEnv = {
  ACCOUNT_CONTACT_EMAIL?: string;
  RESEND_API_KEY?: string;
  AUTH_FROM_EMAIL?: string;
  APP_ORIGIN?: string;
  TURNSTILE_SECRET_KEY?: string;
  LOCAL_AUTH_BYPASS?: string;
};

type ExternalAttempt = { signal: AbortSignal; idempotencyKey: string; allowedHostnames: string[] };
type TurnstileResult = { success?: boolean; action?: string; hostname?: string };

export function acceptsTurnstileResult(result: TurnstileResult, action: string, allowedHostnames: string[]) {
  return result.success === true
    && result.action === action
    && typeof result.hostname === "string"
    && allowedHostnames.includes(result.hostname);
}

function values() {
  return env as unknown as AuthEnv;
}

function isLocalBypass(request: Request) {
  const hostname = new URL(request.url).hostname;
  return (hostname === "localhost" || hostname === "127.0.0.1") && values().LOCAL_AUTH_BYPASS === "true";
}

export async function validateTurnstile(request: Request, token: string, action: string, attempt?: ExternalAttempt) {
  if (isLocalBypass(request)) return;
  const secret = values().TURNSTILE_SECRET_KEY;
  if (!secret) throw new AuthError("注册验证服务尚未配置", 503);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    signal: attempt?.signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      secret, response: token,
      remoteip: request.headers.get("cf-connecting-ip") || undefined,
      idempotency_key: attempt?.idempotencyKey ?? crypto.randomUUID(),
    }),
  });
  const result = await response.json() as TurnstileResult;
  if (!acceptsTurnstileResult(result, action, attempt?.allowedHostnames || [])) {
    throw new AuthError("人机验证失败，请重试", 400);
  }
}

export async function sendAuthEmail(
  request: Request,
  to: string,
  type: "verify_email" | "reset_password",
  token: string,
  attempt?: ExternalAttempt,
) {
  if (isLocalBypass(request)) return { developmentToken: token };
  const config = values();
  if (!config.RESEND_API_KEY || !config.AUTH_FROM_EMAIL || !config.APP_ORIGIN || !config.ACCOUNT_CONTACT_EMAIL) {
    throw new AuthError("邮件服务尚未配置", 503);
  }
  const path = type === "verify_email" ? "/verify-email" : "/reset-password";
  const link = `${config.APP_ORIGIN.replace(/\/$/, "")}${path}?token=${encodeURIComponent(token)}`;
  const subject = type === "verify_email" ? "验证你的幻界 Fantasy 账号" : "重置你的幻界 Fantasy 密码";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: attempt?.signal,
    headers: {
      authorization: `Bearer ${config.RESEND_API_KEY}`,
      "content-type": "application/json",
      "idempotency-key": attempt?.idempotencyKey ?? crypto.randomUUID(),
    },
    body: JSON.stringify({
      from: config.AUTH_FROM_EMAIL, to: [to], subject,
      text: `${subject}\n\n请在二十四小时内打开以下链接：\n${link}\n\n如果不是你本人操作，请忽略此邮件。如需帮助，请联系 ${config.ACCOUNT_CONTACT_EMAIL}。`,
      html: `<p>${subject}</p><p><a href="${link}">确认并进入幻界</a></p><p>链接在二十四小时内有效。如果不是你本人操作，请忽略此邮件。</p><p>如需帮助，请联系 ${config.ACCOUNT_CONTACT_EMAIL}。</p>`,
    }),
  });
  if (!response.ok) throw new AuthError("邮件发送失败，请稍后重试", 502);
  return {};
}
