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

export type CompanionActivityFact = { date: string; seconds: number; operationId: string; recordedAt: string };
export type CompanionDiscoveryFact = {
  chapterId: string;
  chapterVersion: number;
  nodeId: string;
  recordedAt: string;
};
export type CompanionMemoryCard = {
  chapterId: string;
  chapterVersion: number;
  chapterTitle: string;
  novelName: string;
  coverUrl: string;
  coverAlt: string;
  completedAt: string;
};
export type CompanionInventoryRecord = {
  type: "action" | "appearance" | "garden";
  itemId: string;
  unlockedAt: string;
};

export const COMPANION_COLLECTION_CATALOG = {
  actions: [
    { id: "antenna-response", name: "触角回应", requiredLevel: 2 },
    { id: "spin-hover", name: "旋转悬浮", requiredLevel: 4 },
    { id: "hug-memory", name: "抱住记忆页", requiredLevel: 6 },
  ],
  appearances: [
    { id: "starlight-cloak", name: "星辉斗篷", price: 60 },
    { id: "archive-cloak", name: "档案斗篷", price: 90 },
  ],
  gardens: [
    { id: "glowing-roots", name: "萤光树根", price: 80 },
    { id: "star-nursery", name: "星苗圃", price: 120 },
  ],
} as const;

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
  listActivityFacts(userId: string): Promise<CompanionActivityFact[]>;
  listDiscoveryFacts(userId: string): Promise<CompanionDiscoveryFact[]>;
  listMemoryCards(userId: string): Promise<CompanionMemoryCard[]>;
  listRecentReceipts(userId: string): Promise<CompanionReceipt[]>;
  listInventory(userId: string): Promise<CompanionInventoryRecord[]>;
  hasReadingOperation(userId: string, operationId: string): Promise<boolean>;
  readLastActivityAt(userId: string): Promise<string | null>;
  readPublishedChapter(chapterId: string, chapterVersion: number): Promise<{ nodeIds: string[] } | null>;
  readChapterVersion(chapterId: string, chapterVersion: number): Promise<{ nodeIds: string[] } | null>;
  recordReadingFacts(input: {
    userId: string;
    chapterId: string;
    chapterVersion: number;
    nodeId: string;
    date: string;
    seconds: number;
    operationId: string;
    recordedAt: string;
  }): Promise<"applied" | "duplicate">;
  recordDiscoveryFact(input: CompanionDiscoveryFact & { userId: string }): Promise<"applied" | "duplicate">;
  commit(input: {
    userId: string;
    expectedRevision: number | null;
    next: CompanionProfileRecord;
    receipt?: CompanionReceipt;
    inventoryUnlock?: CompanionInventoryRecord;
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

export type CompanionCollections = {
  actions: Array<(typeof COMPANION_COLLECTION_CATALOG.actions)[number] & { owned: boolean }>;
  appearances: Array<(typeof COMPANION_COLLECTION_CATALOG.appearances)[number] & { owned: boolean; equipped: boolean }>;
  gardens: Array<(typeof COMPANION_COLLECTION_CATALOG.gardens)[number] & { owned: boolean; equipped: boolean }>;
};

export type CompanionActionId = (typeof COMPANION_COLLECTION_CATALOG.actions)[number]["id"];
export type CompanionAppearanceId = (typeof COMPANION_COLLECTION_CATALOG.appearances)[number]["id"];
export type CompanionGardenId = (typeof COMPANION_COLLECTION_CATALOG.gardens)[number]["id"];

export type CompanionCommand =
  | { action: "observe" }
  | { action: "record-reading"; chapterId: string; chapterVersion: number; nodeId: string; windowStartedAt: string; operationId: string }
  | { action: "record-node"; chapterId: string; chapterVersion: number; nodeId: string }
  | { action: "interact"; kind: "touch" | "play" | "rest"; operationId: string }
  | { action: "perform-action"; itemId: string }
  | { action: "purchase"; kind: "appearance" | "garden"; itemId: string; operationId: string }
  | { action: "equip"; kind: "appearance" | "garden"; itemId: string; operationId: string }
  | { action: "reset"; confirmation: string }
  | { action: "export" }
  | { action: "purge" }
  | { action: "cleanup" };

export class CompanionError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

function assertCollectionReceipt(
  receipt: CompanionReceipt,
  expected: { outcome: "purchased" | "equipped"; kind: "appearance" | "garden"; itemId: string },
) {
  let stored: Partial<typeof expected> = {};
  try { stored = JSON.parse(receipt.resultJson) as Partial<typeof expected>; } catch {}
  if (stored.outcome !== expected.outcome || stored.kind !== expected.kind || stored.itemId !== expected.itemId) {
    throw new CompanionError("操作标识已用于其他收藏请求", 409);
  }
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

async function collections(store: CompanionStore, profile: CompanionProfileRecord): Promise<CompanionCollections> {
  const inventory = await store.listInventory(profile.userId);
  const owned = new Set(inventory.map((item) => `${item.type}:${item.itemId}`));
  return {
    actions: COMPANION_COLLECTION_CATALOG.actions.map((item) => ({ ...item, owned: owned.has(`action:${item.id}`) })),
    appearances: COMPANION_COLLECTION_CATALOG.appearances.map((item) => ({
      ...item, owned: owned.has(`appearance:${item.id}`), equipped: profile.equippedAppearance === item.id,
    })),
    gardens: COMPANION_COLLECTION_CATALOG.gardens.map((item) => ({
      ...item, owned: owned.has(`garden:${item.id}`), equipped: profile.equippedGarden === item.id,
    })),
  };
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const activityDate = (date: Date) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
}).format(date);

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

  private async rewardReadingFact(
    userId: string,
    key: string,
    bondXp: number,
    mistlight: number,
    factRecordedAt: string,
    now: string,
  ) {
    if (await this.store.readReceipt(userId, key)) return;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.profile(userId);
      if (current.rewardBaselineAt && factRecordedAt <= current.rewardBaselineAt) return;
      const next: CompanionProfileRecord = {
        ...visit(current, now),
        revision: current.revision + 1,
        bondXp: current.bondXp + bondXp,
        mistlight: current.mistlight + mistlight,
      };
      const result = await this.store.commit({
        userId,
        expectedRevision: current.revision,
        next,
        receipt: { key, kind: "completion", resultJson: JSON.stringify({ bondXp, mistlight }), createdAt: now },
      });
      if (result === "applied" || result === "duplicate") return;
    }
    throw new CompanionError("小雾成长发生冲突，请重试", 409);
  }

  private async reconcileReading(userId: string) {
    const now = this.clock().toISOString();
    const activitiesByDate = new Map<string, CompanionActivityFact[]>();
    for (const fact of await this.store.listActivityFacts(userId)) {
      activitiesByDate.set(fact.date, [...(activitiesByDate.get(fact.date) ?? []), fact]);
    }
    for (const [date, facts] of activitiesByDate) {
      let seconds = 0;
      let rewardedWindows = 0;
      for (const fact of facts.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))) {
        seconds += fact.seconds;
        const availableWindows = Math.min(5, Math.floor(seconds / 300));
        while (rewardedWindows < availableWindows) {
          rewardedWindows += 1;
          await this.rewardReadingFact(userId, `activity:${date}:${rewardedWindows}`, 2, 1, fact.recordedAt, now);
        }
      }
    }
    const discoveries = [...await this.store.listDiscoveryFacts(userId)].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
    const counts = new Map<string, number>();
    for (const fact of discoveries) {
      const group = `${fact.chapterId}:${fact.chapterVersion}`;
      const count = counts.get(group) ?? 0;
      counts.set(group, count + 1);
      if (count >= 10) continue;
      await this.rewardReadingFact(userId, `discovery:${group}:${fact.nodeId}`, 0, 1, fact.recordedAt, now);
    }
  }

  private async reconcileLevelActions(userId: string) {
    for (let attempt = 0; attempt < COMPANION_COLLECTION_CATALOG.actions.length * 2; attempt += 1) {
      const current = await this.profile(userId);
      const inventory = await this.store.listInventory(userId);
      const owned = new Set(inventory.filter((item) => item.type === "action").map((item) => item.itemId));
      const unlock = COMPANION_COLLECTION_CATALOG.actions.find((item) => (
        item.requiredLevel <= view(current).level && !owned.has(item.id)
      ));
      if (!unlock) return;
      const now = this.clock().toISOString();
      const result = await this.store.commit({
        userId,
        expectedRevision: current.revision,
        next: { ...current, revision: current.revision + 1, updatedAt: now },
        inventoryUnlock: { type: "action", itemId: unlock.id, unlockedAt: now },
      });
      if (result === "applied") continue;
    }
    throw new CompanionError("小雾动作解锁发生冲突，请重试", 409);
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
      await this.reconcileReading(userId);
      await this.reconcileLevelActions(userId);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const current = await this.profile(userId);
        const next = { ...visit(current, this.clock().toISOString()), revision: current.revision + 1 };
        if (await this.store.commit({ userId, expectedRevision: current.revision, next }) === "applied") {
          const discoveries = await this.store.listDiscoveryFacts(userId);
          const groups = new Map<string, CompanionDiscoveryFact[]>();
          for (const fact of discoveries) {
            const key = `${fact.chapterId}:${fact.chapterVersion}`;
            groups.set(key, [...(groups.get(key) ?? []), fact]);
          }
          const exploration = await Promise.all([...groups.values()].map(async (facts) => {
            const first = facts[0];
            const chapter = await this.store.readChapterVersion(first.chapterId, first.chapterVersion);
            return { chapterId: first.chapterId, chapterVersion: first.chapterVersion, discovered: facts.length, total: chapter?.nodeIds.length ?? facts.length };
          }));
          return {
            state: view(next),
            collections: await collections(this.store, next),
            memories: await this.store.listMemoryCards(userId),
            recentRewards: (await this.store.listRecentReceipts(userId)).filter((receipt) => receipt.kind === "completion").map((receipt) => ({
              kind: receipt.kind, result: JSON.parse(receipt.resultJson) as Record<string, number>, createdAt: receipt.createdAt,
            })),
            exploration,
          };
        }
      }
      throw new CompanionError("小雾成长发生冲突，请重试", 409);
    }
    if (command.action === "perform-action") {
      const item = COMPANION_COLLECTION_CATALOG.actions.find((candidate) => candidate.id === command.itemId);
      if (!item) throw new CompanionError("动作不存在", 404);
      await this.reconcileLevelActions(userId);
      const current = await this.profile(userId);
      const inventory = await this.store.listInventory(userId);
      if (!inventory.some((owned) => owned.type === "action" && owned.itemId === item.id)) {
        throw new CompanionError(`羁绊等级 ${item.requiredLevel} 才能使用该动作`, 409);
      }
      return {
        outcome: "performed" as const,
        itemId: item.id,
        state: view(current),
        collections: await collections(this.store, current),
      };
    }
    if (command.action === "purchase") {
      if (!command.operationId || command.operationId.length > 128) throw new CompanionError("收藏操作标识无效");
      const catalog = command.kind === "appearance"
        ? COMPANION_COLLECTION_CATALOG.appearances
        : COMPANION_COLLECTION_CATALOG.gardens;
      const item = catalog.find((candidate) => candidate.id === command.itemId);
      if (!item) throw new CompanionError("收藏不存在", 404);
      const key = `purchase:${command.operationId}`;
      const expectedReceipt = { outcome: "purchased" as const, kind: command.kind, itemId: item.id };
      const previous = await this.store.readReceipt(userId, key);
      if (previous) {
        assertCollectionReceipt(previous, expectedReceipt);
        const current = await this.profile(userId);
        return { outcome: "purchased" as const, state: view(current), collections: await collections(this.store, current) };
      }
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const inventory = await this.store.listInventory(userId);
        if (inventory.some((owned) => owned.type === command.kind && owned.itemId === item.id)) {
          const current = await this.profile(userId);
          return { outcome: "owned" as const, state: view(current), collections: await collections(this.store, current) };
        }
        const current = await this.profile(userId);
        if (current.mistlight < item.price) throw new CompanionError("雾光不足", 409);
        const now = this.clock().toISOString();
        const next = { ...visit(current, now), revision: current.revision + 1, mistlight: current.mistlight - item.price };
        const result = await this.store.commit({
          userId, expectedRevision: current.revision, next,
          receipt: { key, kind: "purchase", resultJson: JSON.stringify(expectedReceipt), createdAt: now },
          inventoryUnlock: { type: command.kind, itemId: item.id, unlockedAt: now },
        });
        if (result === "applied") {
          return { outcome: "purchased" as const, state: view(next), collections: await collections(this.store, next) };
        }
        if (result === "duplicate") {
          const receipt = await this.store.readReceipt(userId, key);
          if (!receipt) throw new CompanionError("收藏操作结果暂时不可用", 503);
          assertCollectionReceipt(receipt, expectedReceipt);
          const saved = await this.profile(userId);
          return { outcome: "purchased" as const, state: view(saved), collections: await collections(this.store, saved) };
        }
      }
      throw new CompanionError("小雾成长发生冲突，请重试", 409);
    }
    if (command.action === "equip") {
      if (!command.operationId || command.operationId.length > 128) throw new CompanionError("收藏操作标识无效");
      const defaultItem = command.kind === "appearance" ? "default" : "world-tree";
      const validItems = command.kind === "appearance"
        ? COMPANION_COLLECTION_CATALOG.appearances
        : COMPANION_COLLECTION_CATALOG.gardens;
      if (command.itemId !== defaultItem && !validItems.some((item) => item.id === command.itemId)) {
        throw new CompanionError("收藏不存在", 404);
      }
      const key = `equip:${command.operationId}`;
      const expectedReceipt = { outcome: "equipped" as const, kind: command.kind, itemId: command.itemId };
      const previous = await this.store.readReceipt(userId, key);
      if (previous) {
        assertCollectionReceipt(previous, expectedReceipt);
        const current = await this.profile(userId);
        return { outcome: "equipped" as const, state: view(current), collections: await collections(this.store, current) };
      }
      if (command.itemId !== defaultItem) {
        const inventory = await this.store.listInventory(userId);
        if (!inventory.some((item) => item.type === command.kind && item.itemId === command.itemId)) {
          throw new CompanionError("尚未拥有该收藏", 409);
        }
      }
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const current = await this.profile(userId);
        const now = this.clock().toISOString();
        const next = {
          ...visit(current, now), revision: current.revision + 1,
          ...(command.kind === "appearance" ? { equippedAppearance: command.itemId } : { equippedGarden: command.itemId }),
        };
        const result = await this.store.commit({
          userId, expectedRevision: current.revision, next,
          receipt: { key, kind: "purchase", resultJson: JSON.stringify(expectedReceipt), createdAt: now },
        });
        if (result === "applied") {
          return { outcome: "equipped" as const, state: view(next), collections: await collections(this.store, next) };
        }
        if (result === "duplicate") {
          const receipt = await this.store.readReceipt(userId, key);
          if (!receipt) throw new CompanionError("收藏操作结果暂时不可用", 503);
          assertCollectionReceipt(receipt, expectedReceipt);
          const saved = await this.profile(userId);
          return { outcome: "equipped" as const, state: view(saved), collections: await collections(this.store, saved) };
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
    if (command.action === "record-reading") {
      if (!command.operationId || command.operationId.length > 128) throw new CompanionError("阅读窗口标识无效");
      if (await this.store.hasReadingOperation(userId, command.operationId)) {
        await this.reconcileReading(userId);
        return { outcome: "duplicate" as const, state: view(await this.profile(userId)) };
      }
      const context = await this.store.readPublishedChapter(command.chapterId, command.chapterVersion);
      if (!context) throw new CompanionError("章节版本不可用于成长", 409);
      if (!context.nodeIds.includes(command.nodeId)) throw new CompanionError("剧情节点不存在", 409);
      const now = this.clock();
      const startedAt = Date.parse(command.windowStartedAt);
      if (!Number.isFinite(startedAt) || startedAt > now.getTime()) throw new CompanionError("阅读窗口时间无效");
      let seconds = Math.min(90, Math.floor((now.getTime() - startedAt) / 1000));
      const lastActivityAt = await this.store.readLastActivityAt(userId);
      if (lastActivityAt) seconds = Math.min(seconds, Math.floor((now.getTime() - Date.parse(lastActivityAt)) / 1000));
      if (seconds < 1) throw new CompanionError("阅读窗口时间无效");
      await this.store.recordReadingFacts({
        userId,
        chapterId: command.chapterId,
        chapterVersion: command.chapterVersion,
        nodeId: command.nodeId,
        date: activityDate(now),
        seconds,
        operationId: command.operationId,
        recordedAt: now.toISOString(),
      });
      await this.reconcileReading(userId);
      return { outcome: "recorded" as const, state: view(await this.profile(userId)) };
    }
    if (command.action === "record-node") {
      const context = await this.store.readPublishedChapter(command.chapterId, command.chapterVersion);
      if (!context) throw new CompanionError("章节版本不可用于成长", 409);
      if (!context.nodeIds.includes(command.nodeId)) throw new CompanionError("剧情节点不存在", 409);
      const result = await this.store.recordDiscoveryFact({
        userId, chapterId: command.chapterId, chapterVersion: command.chapterVersion,
        nodeId: command.nodeId, recordedAt: this.clock().toISOString(),
      });
      await this.reconcileReading(userId);
      return { outcome: result, state: view(await this.profile(userId)) };
    }
    throw new CompanionError("不支持的小雾成长操作");
  }
}
