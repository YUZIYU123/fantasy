import { env } from "cloudflare:workers";
import { createAccountLifecycle, type AccountRegistrationConfig } from "./account-lifecycle";

type AccountRuntimeEnv = {
  APP_ORIGIN?: string;
  PRIVACY_VERSION?: string;
  REGISTRATION_ENABLED?: string;
  TERMS_VERSION?: string;
};

function runtimeValues() {
  return env as unknown as AccountRuntimeEnv;
}

export function accountRegistrationConfig(): AccountRegistrationConfig {
  const values = runtimeValues();
  let allowedHostnames: string[] = [];
  if (values.APP_ORIGIN) {
    try {
      allowedHostnames = [new URL(values.APP_ORIGIN).hostname];
    } catch {
      allowedHostnames = [];
    }
  }
  return {
    registrationEnabled: values.REGISTRATION_ENABLED === "true",
    termsVersion: values.TERMS_VERSION || "draft",
    privacyVersion: values.PRIVACY_VERSION || "draft",
    allowedHostnames,
  };
}

export const accountLifecycle = createAccountLifecycle({ config: accountRegistrationConfig() });
