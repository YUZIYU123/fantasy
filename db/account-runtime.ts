import { env } from "cloudflare:workers";
import { createAccountLifecycle, type AccountRegistrationConfig } from "./account-lifecycle";
import { bookshelfLifecycle } from "./bookshelf-lifecycle";
import { BookshelfError } from "../lib/bookshelf-lifecycle";
import { hashToken } from "../lib/auth";
import { registrationResumeDirective } from "../lib/registration-intent";
import { companionLifecycle } from "./companion-lifecycle";

export type AccountRuntimeEnv = {
  ACCOUNT_OPERATION_SECRET?: string;
  ACCOUNT_CONTACT_EMAIL?: string;
  APP_ORIGIN?: string;
  AUTH_FROM_EMAIL?: string;
  LOCAL_AUTH_BYPASS?: string;
  PRIVACY_VERSION?: string;
  REGISTRATION_ENABLED?: string;
  RESEND_API_KEY?: string;
  TERMS_VERSION?: string;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_SITE_KEY?: string;
};

function runtimeValues() {
  return env as unknown as AccountRuntimeEnv;
}

async function registrationBookshelfOperationId(userId: string, novelId: string) {
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256", new TextEncoder().encode(`registration-bookshelf:${userId}:${novelId}`),
  ));
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = [...digest.slice(0, 16)].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function accountRegistrationConfigFrom(values: AccountRuntimeEnv): AccountRegistrationConfig {
  let allowedHostnames: string[] = [];
  if (values.APP_ORIGIN) {
    try {
      allowedHostnames = [new URL(values.APP_ORIGIN).hostname];
    } catch {
      allowedHostnames = [];
    }
  }
  const termsVersion = values.TERMS_VERSION || "draft";
  const privacyVersion = values.PRIVACY_VERSION || "draft";
  const localBypass = values.LOCAL_AUTH_BYPASS === "true"
    && allowedHostnames.length > 0
    && allowedHostnames.every((hostname) => hostname === "localhost" || hostname === "127.0.0.1");
  const productionReady = allowedHostnames.length > 0
    && termsVersion !== "draft"
    && privacyVersion !== "draft"
    && Boolean(values.TURNSTILE_SITE_KEY)
    && Boolean(values.TURNSTILE_SECRET_KEY)
    && Boolean(values.RESEND_API_KEY)
    && Boolean(values.AUTH_FROM_EMAIL)
    && Boolean(values.ACCOUNT_CONTACT_EMAIL);
  const operationSecurityReady = (values.ACCOUNT_OPERATION_SECRET?.length ?? 0) >= 32;
  return {
    registrationEnabled: values.REGISTRATION_ENABLED === "true" && (localBypass || (productionReady && operationSecurityReady)),
    termsVersion,
    privacyVersion,
    allowedHostnames,
  };
}

export function accountRegistrationConfig(): AccountRegistrationConfig {
  return accountRegistrationConfigFrom(runtimeValues());
}

const values = runtimeValues();
export const accountLifecycle = createAccountLifecycle({
  config: accountRegistrationConfigFrom(values),
  operationFingerprintSecret: values.ACCOUNT_OPERATION_SECRET || (values.LOCAL_AUTH_BYPASS === "true"
    ? "local-operation-fingerprint-secret-32-bytes"
    : ""),
  registrationIntent: {
    async resume({ userId, intent, request }) {
      const directive = registrationResumeDirective(intent);
      if (intent.kind !== "bookshelf" || !intent.targetId || !directive) return directive;
      const sourceKey = await hashToken(`bookshelf:${request.headers.get("cf-connecting-ip") || "unknown"}`);
      const operationId = await registrationBookshelfOperationId(userId, intent.targetId);
      try {
        await bookshelfLifecycle.execute({ kind: "account", id: userId }, {
          action: "add", novelId: intent.targetId, operationId, sourceKey,
        });
        return { ...directive, outcome: "succeeded" };
      } catch (error) {
        if (error instanceof BookshelfError && error.status === 404) return { ...directive, outcome: "unavailable" };
        try {
          const result = await bookshelfLifecycle.execute({ kind: "account", id: userId }, { action: "result", operationId });
          if ("status" in result && result.status === "succeeded") return { ...directive, outcome: "succeeded" };
          if ("status" in result && result.status === "failed") return { ...directive, outcome: "unavailable" };
        } catch {}
        return { ...directive, outcome: "failed" };
      }
    },
  },
  privateData: {
    async export(userId) {
      const [result, companion] = await Promise.all([
        bookshelfLifecycle.execute({ kind: "account", id: userId }, { action: "export" }),
        companionLifecycle.execute({ kind: "account", id: userId }, { action: "export" }),
      ]);
      return { bookshelf: "entries" in result ? result.entries : [], companion };
    },
    async purge(userId) {
      await Promise.all([
        bookshelfLifecycle.execute({ kind: "account", id: userId }, { action: "purge" }),
        companionLifecycle.execute({ kind: "account", id: userId }, { action: "purge" }),
      ]);
    },
    async cleanupOrphans() {
      await Promise.all([
        bookshelfLifecycle.execute({ kind: "system" }, { action: "cleanup" }),
        companionLifecycle.execute({ kind: "system" }, { action: "cleanup" }),
      ]);
    },
  },
});
