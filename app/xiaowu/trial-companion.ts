import {
  CompanionLifecycle,
  createTrialCompanionProfile,
  type CompanionProfileRecord,
  type CompanionReceipt,
  type CompanionStore,
} from "../../lib/companion-lifecycle";

export const TRIAL_COMPANION_KEY = "fantasy-xiaowu-garden-trial-v1";
const TRIAL_USER_ID = "browser-session-trial";

type TrialSnapshot = {
  profile: CompanionProfileRecord;
  receipts: CompanionReceipt[];
};

class SessionCompanionStore implements CompanionStore {
  constructor(private readonly storage: Storage, private readonly clock: () => Date) {}

  private readSnapshot(): TrialSnapshot | null {
    try {
      const value = this.storage.getItem(TRIAL_COMPANION_KEY);
      return value ? JSON.parse(value) as TrialSnapshot : null;
    } catch {
      return null;
    }
  }

  private writeSnapshot(snapshot: TrialSnapshot) {
    this.storage.setItem(TRIAL_COMPANION_KEY, JSON.stringify(snapshot));
  }

  private snapshot() {
    const existing = this.readSnapshot();
    if (existing) return existing;
    const created = { profile: createTrialCompanionProfile(TRIAL_USER_ID, this.clock().toISOString()), receipts: [] };
    this.writeSnapshot(created);
    return created;
  }

  async readProfile(userId: string) {
    return userId === TRIAL_USER_ID ? structuredClone(this.snapshot().profile) : null;
  }

  async readReceipt(userId: string, key: string) {
    if (userId !== TRIAL_USER_ID) return null;
    return structuredClone(this.snapshot().receipts.find((receipt) => receipt.key === key) ?? null);
  }

  async listCompletionFacts() { return []; }
  async listActivityFacts() { return []; }
  async listDiscoveryFacts() { return []; }
  async listMemoryCards() { return []; }
  async listRecentReceipts() { return []; }
  async hasReadingOperation() { return false; }
  async readLastActivityAt() { return null; }
  async readPublishedChapter() { return null; }
  async readChapterVersion() { return null; }
  async recordReadingFacts() { return "duplicate" as const; }
  async recordDiscoveryFact() { return "duplicate" as const; }

  async commit(input: Parameters<CompanionStore["commit"]>[0]) {
    if (input.userId !== TRIAL_USER_ID) return "conflict" as const;
    const snapshot = this.snapshot();
    if (input.receipt && snapshot.receipts.some((receipt) => receipt.key === input.receipt?.key)) return "duplicate" as const;
    if (snapshot.profile.revision !== input.expectedRevision) return "conflict" as const;
    this.writeSnapshot({
      profile: structuredClone(input.next),
      receipts: input.receipt ? [...snapshot.receipts, structuredClone(input.receipt)] : snapshot.receipts,
    });
    return "applied" as const;
  }

  async reset(input: { userId: string; expectedRevision: number; next: CompanionProfileRecord }) {
    if (input.userId !== TRIAL_USER_ID) return "conflict" as const;
    const snapshot = this.snapshot();
    if (snapshot.profile.revision !== input.expectedRevision) return "conflict" as const;
    this.writeSnapshot({ profile: structuredClone(input.next), receipts: [] });
    return "applied" as const;
  }

  async export(userId: string) {
    return userId === TRIAL_USER_ID ? structuredClone(this.snapshot()) : {};
  }

  async purge(userId: string) {
    if (userId === TRIAL_USER_ID) this.storage.removeItem(TRIAL_COMPANION_KEY);
  }

  async cleanup() {}
}

export function createSessionCompanion(storage: Storage, clock: () => Date = () => new Date()) {
  return {
    actor: { kind: "account" as const, id: TRIAL_USER_ID },
    lifecycle: new CompanionLifecycle(new SessionCompanionStore(storage, clock), clock),
  };
}
