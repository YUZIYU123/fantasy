export type CompanionActor = { kind: "account"; id: string } | { kind: "system" };

export type CompanionProfileRecord = {
  userId: string;
  revision: number;
  bondXp: number;
  vitality: number;
  mistlight: number;
  lastSeenAt: string;
  lastTouchAt: string | null;
  lastRestAt: string | null;
  rewardBaselineAt: string | null;
  equippedAppearance: string;
  equippedGarden: string;
  updatedAt: string;
};

export type CompanionReceipt = {
  key: string;
  kind: "completion" | "interaction" | "purchase";
  resultJson: string;
  createdAt: string;
};

export type CompanionCompletionFact = {
  chapterId: string;
  chapterVersion: number;
  completedAt: string;
  recordedAt: string;
};

export const COMPANION_RULES = {
  completionBondXp: 40,
  completionMistlight: 20,
  touchVitality: 5,
  touchCooldownHours: 6,
  playMistlight: 3,
  playVitality: 15,
  restVitality: 25,
} as const;

export interface CompanionStore {
  readProfile(userId: string): Promise<CompanionProfileRecord | null>;
  readReceipt(userId: string, key: string): Promise<CompanionReceipt | null>;
  listCompletionFacts(userId: string): Promise<CompanionCompletionFact[]>;
  commit(input: {
    userId: string;
    expectedRevision: number | null;
    next: CompanionProfileRecord;
    receipt?: CompanionReceipt;
  }): Promise<"applied" | "conflict" | "duplicate">;
  reset(input: {
    userId: string;
    expectedRevision: number;
    next: CompanionProfileRecord;
  }): Promise<"applied" | "conflict">;
  export(userId: string): Promise<Record<string, unknown>>;
  purge(userId: string): Promise<void>;
  cleanup(): Promise<void>;
}

export type CompanionView = {
  bondXp: number;
  level: number;
  bondInLevel: number;
  bondToNextLevel: number;
  vitality: number;
  mood: "bright" | "calm" | "sleepy";
  mistlight: number;
  equippedAppearance: string;
  equippedGarden: string;
};

export type CompanionCommand =
  | { action: "observe" }
  | { action: "interact"; kind: "touch" | "play" | "rest"; operationId: string }
  | { action: "reset"; confirmation: string }
  | { action: "export" }
  | { action: "purge" }
  | { action: "cleanup" };

export class CompanionError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

const defaultProfile = (userId: string, now: string): CompanionProfileRecord => ({
  userId,
  revision: 0,
  bondXp: 0,
  vitality: 100,
  mistlight: 0,
  lastSeenAt: now,
  lastTouchAt: null,
  lastRestAt: null,
  rewardBaselineAt: null,
  equippedAppearance: "default",
  equippedGarden: "world-tree",
  updatedAt: now,
});

export function createTrialCompanionProfile(userId: string, now: string): CompanionProfileRecord {
  return { ...defaultProfile(userId, now), vitality: 70, mistlight: 20 };
}

function view(profile: CompanionProfileRecord): CompanionView {
  return {
    bondXp: profile.bondXp,
    level: Math.floor(profile.bondXp / 100) + 1,
    bondInLevel: profile.bondXp % 100,
    bondToNextLevel: 100,
    vitality: profile.vitality,
    mood: profile.vitality >= 70 ? "bright" : profile.vitality >= 40 ? "calm" : "sleepy",
    mistlight: profile.mistlight,
    equippedAppearance: profile.equippedAppearance,
    equippedGarden: profile.equippedGarden,
  };
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function visit(profile: CompanionProfileRecord, now: string) {
  const elapsed = Math.max(0, Date.parse(now) - Date.parse(profile.lastSeenAt));
  const decayDays = Math.floor(Math.max(0, elapsed - 48 * HOUR) / DAY);
  return {
    ...profile,
    vitality: Math.max(30, profile.vitality - decayDays * 10),
    lastSeenAt: now,
    updatedAt: now,
  };
}

export class CompanionLifecycle {
  private readonly store: CompanionStore;
  private readonly clock: () => Date;

  constructor(
    store: CompanionStore,
    clock: () => Date = () => new Date(),
  ) { this.store = store; this.clock = clock; }

  private requireAccount(actor: CompanionActor) {
    if (actor.kind !== "account" || !actor.id) throw new CompanionError("需要正常账号才能保存小雾成长", 401);
    return actor.id;
  }

  private async profile(userId: string) {
    const existing = await this.store.readProfile(userId);
    if (existing) return existing;
    const now = this.clock().toISOString();
    const created = defaultProfile(userId, now);
    const outcome = await this.store.commit({ userId, expectedRevision: null, next: created });
    if (outcome === "applied") return created;
    const concurrent = await this.store.readProfile(userId);
    if (!concurrent) throw new CompanionError("小雾成长暂时不可用", 503);
    return concurrent;
  }

  private async rewardCompletion(userId: string, fact: CompanionCompletionFact) {
    if (!fact.chapterId || !Number.isInteger(fact.chapterVersion) || fact.chapterVersion < 1) {
      throw new CompanionError("章节完成事实无效");
    }
    const key = `completion:${fact.chapterId}:${fact.chapterVersion}`;
    if (await this.store.readReceipt(userId, key)) return "duplicate" as const;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.profile(userId);
      if (current.rewardBaselineAt && fact.recordedAt <= current.rewardBaselineAt) return "ineligible" as const;
      const now = this.clock().toISOString();
      const next: CompanionProfileRecord = {
        ...visit(current, now),
        revision: current.revision + 1,
        bondXp: current.bondXp + COMPANION_RULES.completionBondXp,
        mistlight: current.mistlight + COMPANION_RULES.completionMistlight,
        lastSeenAt: now,
        updatedAt: now,
      };
      const result = await this.store.commit({
        userId,
        expectedRevision: current.revision,
        next,
        receipt: { key, kind: "completion", resultJson: JSON.stringify({ bondXp: COMPANION_RULES.completionBondXp, mistlight: COMPANION_RULES.completionMistlight }), createdAt: now },
      });
      if (result === "applied") return "rewarded" as const;
      if (result === "duplicate") return "duplicate" as const;
    }
    throw new CompanionError("小雾成长发生冲突，请重试", 409);
  }

  async execute(actor: CompanionActor, command: CompanionCommand) {
    if (command.action === "cleanup") {
      if (actor.kind !== "system") throw new CompanionError("无权清理小雾成长", 403);
      await this.store.cleanup();
      return { ok: true as const };
    }
    const userId = this.requireAccount(actor);
    if (command.action === "export") return { growth: await this.store.export(userId) };
    if (command.action === "purge") {
      await this.store.purge(userId);
      return { ok: true as const };
    }
    if (command.action === "reset") {
      if (command.confirmation !== "重置小雾成长") throw new CompanionError("需要输入完整确认语");
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const current = await this.profile(userId);
        const now = this.clock().toISOString();
        const next = { ...defaultProfile(userId, now), revision: current.revision + 1, rewardBaselineAt: now };
        if (await this.store.reset({ userId, expectedRevision: current.revision, next }) === "applied") {
          return { ok: true as const, state: view(next) };
        }
      }
      throw new CompanionError("小雾成长发生冲突，请重试", 409);
    }
    if (command.action === "observe") {
      for (const fact of await this.store.listCompletionFacts(userId)) {
        await this.rewardCompletion(userId, fact);
      }
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const current = await this.profile(userId);
        const next = { ...visit(current, this.clock().toISOString()), revision: current.revision + 1 };
        if (await this.store.commit({ userId, expectedRevision: current.revision, next }) === "applied") {
          return { state: view(next) };
        }
      }
      throw new CompanionError("小雾成长发生冲突，请重试", 409);
    }
    if (command.action === "interact") {
      if (!command.operationId || command.operationId.length > 128) throw new CompanionError("互动操作标识无效");
      const key = `interaction:${command.operationId}`;
      const previous = await this.store.readReceipt(userId, key);
      if (previous) {
        const stored = JSON.parse(previous.resultJson) as { outcome?: "restored" | "cooldown" };
        return { outcome: stored.outcome ?? "duplicate", state: view(await this.profile(userId)) };
      }
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const current = await this.profile(userId);
        const now = this.clock().toISOString();
        let next = visit(current, now);
        let outcome: "restored" | "cooldown" = "restored";
        if (command.kind === "touch") {
          const coolingDown = Boolean(next.lastTouchAt && Date.parse(now) - Date.parse(next.lastTouchAt) < COMPANION_RULES.touchCooldownHours * HOUR);
          if (coolingDown) outcome = "cooldown";
          else next = { ...next, vitality: Math.min(100, next.vitality + COMPANION_RULES.touchVitality), lastTouchAt: now };
        } else if (command.kind === "play") {
          if (next.mistlight < COMPANION_RULES.playMistlight) throw new CompanionError("雾光不足", 409);
          next = { ...next, vitality: Math.min(100, next.vitality + COMPANION_RULES.playVitality), mistlight: next.mistlight - COMPANION_RULES.playMistlight };
        } else {
          const restedToday = next.lastRestAt?.slice(0, 10) === now.slice(0, 10);
          if (restedToday) outcome = "cooldown";
          else next = { ...next, vitality: Math.min(100, next.vitality + COMPANION_RULES.restVitality), lastRestAt: now };
        }
        next = { ...next, revision: current.revision + 1 };
        const result = await this.store.commit({
          userId,
          expectedRevision: current.revision,
          next,
          receipt: { key, kind: "interaction", resultJson: JSON.stringify({ outcome }), createdAt: now },
        });
        if (result === "applied") return { outcome, state: view(next) };
        if (result === "duplicate") {
          const receipt = await this.store.readReceipt(userId, key);
          const stored = receipt ? JSON.parse(receipt.resultJson) as { outcome?: "restored" | "cooldown" } : {};
          return { outcome: stored.outcome ?? "duplicate", state: view(await this.profile(userId)) };
        }
      }
      throw new CompanionError("小雾成长发生冲突，请重试", 409);
    }
    throw new CompanionError("不支持的小雾成长操作");
  }
}
