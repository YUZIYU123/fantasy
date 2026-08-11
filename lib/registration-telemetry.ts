export type RegistrationTelemetryEvent = {
  flow: "register" | "resend" | "restart" | "activate";
  stage: "invitation" | "step" | "mail_delivery" | "account_activation" | "intent_resume" | "recovery";
  outcome: "shown" | "continued" | "succeeded" | "skipped" | "rejected" | "failed" | "uncertain";
};

const flows = new Set<RegistrationTelemetryEvent["flow"]>(["register", "resend", "restart", "activate"]);
const stages = new Set<RegistrationTelemetryEvent["stage"]>([
  "invitation", "step", "mail_delivery", "account_activation", "intent_resume", "recovery",
]);
const outcomes = new Set<RegistrationTelemetryEvent["outcome"]>([
  "shown", "continued", "succeeded", "skipped", "rejected", "failed", "uncertain",
]);

export function normalizeRegistrationTelemetryEvent(value: unknown): RegistrationTelemetryEvent | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (!flows.has(candidate.flow as RegistrationTelemetryEvent["flow"])
    || !stages.has(candidate.stage as RegistrationTelemetryEvent["stage"])
    || !outcomes.has(candidate.outcome as RegistrationTelemetryEvent["outcome"])) return null;
  return {
    flow: candidate.flow as RegistrationTelemetryEvent["flow"],
    stage: candidate.stage as RegistrationTelemetryEvent["stage"],
    outcome: candidate.outcome as RegistrationTelemetryEvent["outcome"],
  };
}

export interface RegistrationTelemetry {
  record(event: RegistrationTelemetryEvent): void | Promise<void>;
}

export const workerRegistrationTelemetry: RegistrationTelemetry = {
  record(event) {
    console.info({ event: "registration_funnel", ...event });
  },
};

export class MockRegistrationTelemetry implements RegistrationTelemetry {
  readonly events: RegistrationTelemetryEvent[] = [];
  record(event: RegistrationTelemetryEvent) {
    this.events.push({ ...event });
  }
}

const preferenceKey = "fantasy:registration-analytics";

export const browserRegistrationAnalyticsPreference = {
  load() {
    try {
      return localStorage.getItem(preferenceKey) === "allowed";
    } catch {
      return false;
    }
  },
  save(allowed: boolean) {
    try {
      localStorage.setItem(preferenceKey, allowed ? "allowed" : "declined");
    } catch {
      // Registration remains usable when browser storage is unavailable.
    }
  },
};
