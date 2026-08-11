import { env } from "cloudflare:workers";
import { createAccountLifecycle, type AccountRegistrationConfig } from "./account-lifecycle";

export type AccountRuntimeEnv = {
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
  const localBypass = values.LOCAL_AUTH_BYPASS === "true";
  const productionReady = allowedHostnames.length > 0
    && termsVersion !== "draft"
    && privacyVersion !== "draft"
    && Boolean(values.TURNSTILE_SITE_KEY)
    && Boolean(values.TURNSTILE_SECRET_KEY)
    && Boolean(values.RESEND_API_KEY)
    && Boolean(values.AUTH_FROM_EMAIL)
    && Boolean(values.ACCOUNT_CONTACT_EMAIL);
  return {
    registrationEnabled: values.REGISTRATION_ENABLED === "true" && (localBypass || productionReady),
    termsVersion,
    privacyVersion,
    allowedHostnames: localBypass && allowedHostnames.length === 0 ? ["localhost", "127.0.0.1"] : allowedHostnames,
  };
}

export function accountRegistrationConfig(): AccountRegistrationConfig {
  return accountRegistrationConfigFrom(runtimeValues());
}

export const accountLifecycle = createAccountLifecycle({ config: accountRegistrationConfig() });
