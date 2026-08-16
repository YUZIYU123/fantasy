export type RegistrationIntent = {
  kind: "bookshelf" | "progress" | "cross-device";
  targetId?: string;
};

export type RegistrationResumeDirective = RegistrationIntent & {
  mode: "automatic" | "confirm" | "welcome";
  outcome?: "succeeded" | "unavailable" | "failed";
};

const safeTarget = /^[a-zA-Z0-9_-]{1,128}$/;

export function normalizeRegistrationIntent(value: unknown): RegistrationIntent | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind !== "bookshelf" && candidate.kind !== "progress" && candidate.kind !== "cross-device") return null;
  if (candidate.kind === "cross-device") return { kind: "cross-device" };
  if (typeof candidate.targetId !== "string" || !safeTarget.test(candidate.targetId)) return null;
  return { kind: candidate.kind, targetId: candidate.targetId };
}

export function registrationResumeDirective(value: unknown): RegistrationResumeDirective | null {
  const intent = normalizeRegistrationIntent(value);
  if (!intent) return null;
  if (intent.kind === "cross-device") return { ...intent, mode: "welcome" };
  if (intent.kind === "bookshelf") return { ...intent, mode: "automatic" };
  return { ...intent, mode: "confirm" };
}
