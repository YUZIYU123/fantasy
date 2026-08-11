export const REGISTRATION_DRAFT_KEY = "fantasy:registration-draft";
const REGISTRATION_DRAFT_TTL_MS = 24 * 60 * 60_000;

import { normalizeRegistrationIntent, type RegistrationIntent } from "./registration-intent";

export type RegistrationDraft = {
  schemaVersion: 1;
  savedAt: string;
  step: number;
  displayName: string;
  email: string;
  intent?: RegistrationIntent;
};

export interface RegistrationDraftStore {
  load(): RegistrationDraft | null;
  save(draft: RegistrationDraft): void;
  clear(): void;
}

function sanitizeDraft(value: unknown, now: number): RegistrationDraft | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== 1 || typeof candidate.savedAt !== "string") return null;
  const savedAt = Date.parse(candidate.savedAt);
  if (!Number.isFinite(savedAt) || now - savedAt >= REGISTRATION_DRAFT_TTL_MS || savedAt > now + 60_000) return null;
  const step = Number(candidate.step);
  const safeStep = Number.isInteger(step) ? Math.max(0, Math.min(step, 4)) : 0;
  const intent = normalizeRegistrationIntent(candidate.intent);
  return {
    schemaVersion: 1,
    savedAt: new Date(savedAt).toISOString(),
    step: safeStep,
    displayName: typeof candidate.displayName === "string" ? candidate.displayName.slice(0, 40) : "",
    email: typeof candidate.email === "string" ? candidate.email.slice(0, 254) : "",
    ...(intent ? { intent } : {}),
  };
}

export function createRegistrationDraftStore(storage: Storage, now = () => Date.now()): RegistrationDraftStore {
  return {
    load() {
      try {
        const raw = storage.getItem(REGISTRATION_DRAFT_KEY);
        if (!raw) return null;
        const draft = sanitizeDraft(JSON.parse(raw), now());
        if (!draft) storage.removeItem(REGISTRATION_DRAFT_KEY);
        else storage.setItem(REGISTRATION_DRAFT_KEY, JSON.stringify(draft));
        return draft;
      } catch {
        storage.removeItem(REGISTRATION_DRAFT_KEY);
        return null;
      }
    },
    save(draft) {
      const safe = sanitizeDraft(draft, now());
      if (safe) storage.setItem(REGISTRATION_DRAFT_KEY, JSON.stringify(safe));
    },
    clear() {
      storage.removeItem(REGISTRATION_DRAFT_KEY);
    },
  };
}

export const browserRegistrationDraftStore: RegistrationDraftStore = {
  load: () => createRegistrationDraftStore(window.localStorage).load(),
  save: (draft) => createRegistrationDraftStore(window.localStorage).save(draft),
  clear: () => createRegistrationDraftStore(window.localStorage).clear(),
};
