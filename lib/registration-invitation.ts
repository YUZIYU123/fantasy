import { normalizeRegistrationIntent, type RegistrationIntent } from "./registration-intent";

const proactiveDismissedKey = "fantasy:registration-invitation-dismissed";

export interface RegistrationInvitationStore {
  shouldProactivelyInvite(): boolean;
  dismissProactiveInvitation(): void;
}

export function createRegistrationInvitationStore(storage: Storage): RegistrationInvitationStore {
  return {
    shouldProactivelyInvite: () => storage.getItem(proactiveDismissedKey) !== "1",
    dismissProactiveInvitation: () => storage.setItem(proactiveDismissedKey, "1"),
  };
}

export const browserRegistrationInvitationStore: RegistrationInvitationStore = {
  shouldProactivelyInvite: () => createRegistrationInvitationStore(window.sessionStorage).shouldProactivelyInvite(),
  dismissProactiveInvitation: () => createRegistrationInvitationStore(window.sessionStorage).dismissProactiveInvitation(),
};

export function registrationInvitationHref(value: unknown) {
  const intent = normalizeRegistrationIntent(value);
  if (!intent) return "/register";
  const params = new URLSearchParams({ intent: intent.kind });
  if (intent.targetId) params.set("target", intent.targetId);
  return `/register?${params.toString()}`;
}

export function registrationInvitationCopy(intent: RegistrationIntent) {
  if (intent.kind === "bookshelf") return "想把这本小说加入自己的书架吗？建立账号后，我才能替你安全保管。";
  if (intent.kind === "progress") return "想让这段阅读进度跟着你去别的设备吗？建立账号后就可以同步。";
  return "想在不同设备继续这段旅程吗？建立账号后，我会替你接上。";
}
