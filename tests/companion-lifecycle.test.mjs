import assert from "node:assert/strict";
import test from "node:test";
import { CompanionLifecycle } from "../lib/companion-lifecycle.ts";

class MemoryCompanionStore {
  profiles = new Map();
  receipts = new Map();
  completions = new Map();
  activities = new Map();
  discoveries = new Map();
  readingOperations = new Set();
  inventory = new Map();
  failReset = false;
  afterListActivityFacts = null;
  afterListDiscoveryFacts = null;

  async readProfile(userId) { return this.profiles.get(userId) ?? null; }
  async readReceipt(userId, key) { return this.receipts.get(`${userId}:${key}`) ?? null; }
  async listCompletionFacts(userId) { return this.completions.get(userId) ?? []; }
  async listActivityFacts(userId) {
    const facts = structuredClone(this.activities.get(userId) ?? []);
    await this.afterListActivityFacts?.();
    this.afterListActivityFacts = null;
    return facts;
  }
  async listDiscoveryFacts(userId) {
    const facts = structuredClone(this.discoveries.get(userId) ?? []);
    await this.afterListDiscoveryFacts?.();
    this.afterListDiscoveryFacts = null;
    return facts;
  }
  async listMemoryCards() { return []; }
  async listRecentReceipts(userId) {
    return [...this.receipts.entries()].filter(([key]) => key.startsWith(`${userId}:`)).map(([, receipt]) => receipt);
  }
  async listInventory(userId) { return structuredClone(this.inventory.get(userId) ?? []); }
  async hasReadingOperation(userId, operationId) { return this.readingOperations.has(`${userId}:${operationId}`); }
  async readLastActivityAt(userId) {
    return (this.activities.get(userId) ?? []).at(-1)?.recordedAt ?? null;
  }
  async readPublishedChapter(chapterId, chapterVersion) {
    if (chapterId === "chapter-active" && chapterVersion === 2) return { nodeIds: ["node-a", "node-b"] };
    if (chapterId === "chapter-explore" && chapterVersion === 1) return { nodeIds: Array.from({ length: 12 }, (_, index) => `node-${index + 1}`) };
    return null;
  }
  async readChapterVersion(chapterId, chapterVersion) { return this.readPublishedChapter(chapterId, chapterVersion); }
  async recordReadingFacts(input) {
    const operationKey = `${input.userId}:${input.operationId}`;
    if (this.readingOperations.has(operationKey)) return "duplicate";
    this.readingOperations.add(operationKey);
    const activities = this.activities.get(input.userId) ?? [];
    activities.push({ date: input.date, seconds: input.seconds, operationId: input.operationId, chapterId: input.chapterId, recordedAt: input.recordedAt });
    this.activities.set(input.userId, activities);
    return "applied";
  }
  async recordDiscoveryFact(input) {
    const discoveries = this.discoveries.get(input.userId) ?? [];
    if (discoveries.some((fact) => fact.chapterId === input.chapterId && fact.chapterVersion === input.chapterVersion && fact.nodeId === input.nodeId)) return "duplicate";
    discoveries.push({ chapterId: input.chapterId, chapterVersion: input.chapterVersion, nodeId: input.nodeId, recordedAt: input.recordedAt });
    this.discoveries.set(input.userId, discoveries);
    return "applied";
  }
  async commit(input) {
    if (input.receipt && this.receipts.has(`${input.userId}:${input.receipt.key}`)) return "duplicate";
    const current = this.profiles.get(input.userId) ?? null;
    if ((current?.revision ?? null) !== input.expectedRevision) return "conflict";
    this.profiles.set(input.userId, structuredClone(input.next));
    if (input.receipt) this.receipts.set(`${input.userId}:${input.receipt.key}`, structuredClone(input.receipt));
    if (input.inventoryUnlock) {
      const inventory = this.inventory.get(input.userId) ?? [];
      if (!inventory.some((owned) => owned.type === input.inventoryUnlock.type && owned.itemId === input.inventoryUnlock.itemId)) {
        inventory.push(structuredClone(input.inventoryUnlock));
      }
      this.inventory.set(input.userId, inventory);
    }
    return "applied";
  }
  async export(userId) { return { profile: await this.readProfile(userId) }; }
  async reset(input) {
    if (this.failReset) throw new Error("simulated reset failure");
    const current = this.profiles.get(input.userId);
    if (current?.revision !== input.expectedRevision) return "conflict";
    await this.purge(input.userId);
    this.profiles.set(input.userId, structuredClone(input.next));
    return "applied";
  }
  async purge(userId) {
    this.profiles.delete(userId);
    this.activities.delete(userId);
    this.discoveries.delete(userId);
    this.inventory.delete(userId);
    for (const key of this.receipts.keys()) if (key.startsWith(`${userId}:`)) this.receipts.delete(key);
  }
  async cleanup() {}
}

test("CompanionLifecycle 首次完成章节版本奖励羁绊与雾光且重复完成不重复奖励", async () => {
  const store = new MemoryCompanionStore();
  const lifecycle = new CompanionLifecycle(store, () => new Date("2026-08-28T12:00:00.000Z"));
  const actor = { kind: "account", id: "reader-1" };
  store.completions.set(actor.id, [
    { chapterId: "chapter-1", chapterVersion: 3, completedAt: "2026-08-28T11:00:00.000Z", recordedAt: "2026-08-28T11:00:01.000Z" },
  ]);

  const first = await lifecycle.execute(actor, { action: "observe" });
  const replay = await lifecycle.execute(actor, { action: "observe" });

  assert.deepEqual({ bondXp: first.state.bondXp, mistlight: first.state.mistlight, level: first.state.level }, { bondXp: 40, mistlight: 20, level: 1 });
  assert.deepEqual({ bondXp: replay.state.bondXp, mistlight: replay.state.mistlight }, { bondXp: 40, mistlight: 20 });
});

test("CompanionLifecycle 轻度活力只降到三十并统一处理互动冷却与雾光消耗", async () => {
  const store = new MemoryCompanionStore();
  let now = new Date("2026-08-01T00:00:00.000Z");
  const lifecycle = new CompanionLifecycle(store, () => now);
  const actor = { kind: "account", id: "reader-care" };
  await lifecycle.execute(actor, { action: "observe" });
  now = new Date("2026-08-05T00:00:00.000Z");

  const touched = await lifecycle.execute(actor, { action: "interact", kind: "touch", operationId: "touch-1" });
  const cooldown = await lifecycle.execute(actor, { action: "interact", kind: "touch", operationId: "touch-2" });
  store.completions.set(actor.id, [
    { chapterId: "chapter-care", chapterVersion: 1, completedAt: now.toISOString(), recordedAt: now.toISOString() },
  ]);
  await lifecycle.execute(actor, { action: "observe" });
  const played = await lifecycle.execute(actor, { action: "interact", kind: "play", operationId: "play-1" });

  assert.deepEqual({ outcome: touched.outcome, vitality: touched.state.vitality }, { outcome: "restored", vitality: 85 });
  assert.deepEqual({ outcome: cooldown.outcome, vitality: cooldown.state.vitality }, { outcome: "cooldown", vitality: 85 });
  assert.deepEqual({ outcome: played.outcome, vitality: played.state.vitality, mistlight: played.state.mistlight }, { outcome: "restored", vitality: 100, mistlight: 17 });

  now = new Date("2026-09-30T00:00:00.000Z");
  const sleepy = await lifecycle.execute(actor, { action: "observe" });
  assert.deepEqual({ vitality: sleepy.state.vitality, mood: sleepy.state.mood }, { vitality: 30, mood: "sleepy" });
});

test("CompanionLifecycle 观察状态时补偿已经完成但尚未奖励的章节事实", async () => {
  const store = new MemoryCompanionStore();
  store.completions.set("reader-reconcile", [
    { chapterId: "chapter-old", chapterVersion: 2, completedAt: "2026-08-20T00:00:00.000Z", recordedAt: "2026-08-20T00:00:01.000Z" },
  ]);
  const lifecycle = new CompanionLifecycle(store, () => new Date("2026-08-28T00:00:00.000Z"));
  const actor = { kind: "account", id: "reader-reconcile" };

  const reconciled = await lifecycle.execute(actor, { action: "observe" });
  const replay = await lifecycle.execute(actor, { action: "observe" });

  assert.deepEqual({ bondXp: reconciled.state.bondXp, mistlight: reconciled.state.mistlight }, { bondXp: 40, mistlight: 20 });
  assert.deepEqual({ bondXp: replay.state.bondXp, mistlight: replay.state.mistlight }, { bondXp: 40, mistlight: 20 });
});

test("CompanionLifecycle 分别奖励同一章节的不同发布版本", async () => {
  const store = new MemoryCompanionStore();
  store.completions.set("reader-versions", [
    { chapterId: "chapter-versioned", chapterVersion: 1, completedAt: "2026-08-20T00:00:00.000Z", recordedAt: "2026-08-20T00:00:01.000Z" },
    { chapterId: "chapter-versioned", chapterVersion: 2, completedAt: "2026-08-27T00:00:00.000Z", recordedAt: "2026-08-27T00:00:01.000Z" },
  ]);
  const lifecycle = new CompanionLifecycle(store, () => new Date("2026-08-28T00:00:00.000Z"));
  const state = await lifecycle.execute({ kind: "account", id: "reader-versions" }, { action: "observe" });
  assert.deepEqual({ bondXp: state.state.bondXp, mistlight: state.state.mistlight }, { bondXp: 80, mistlight: 40 });
});

test("CompanionLifecycle 重置要求确认语且不会重新奖励重置前的阅读事实", async () => {
  const store = new MemoryCompanionStore();
  let now = new Date("2026-08-28T12:00:00.000Z");
  store.completions.set("reader-reset", [
    { chapterId: "chapter-before", chapterVersion: 1, completedAt: "2026-08-28T12:05:00.000Z", recordedAt: "2026-08-28T11:59:59.000Z" },
  ]);
  const lifecycle = new CompanionLifecycle(store, () => now);
  const actor = { kind: "account", id: "reader-reset" };
  await assert.rejects(
    lifecycle.execute(actor, { action: "reset", confirmation: "重置" }),
    /需要输入完整确认语/,
  );
  await lifecycle.execute(actor, { action: "observe" });
  const reset = await lifecycle.execute(actor, { action: "reset", confirmation: "重置小雾成长" });
  const observed = await lifecycle.execute(actor, { action: "observe" });
  assert.deepEqual({ bondXp: reset.state.bondXp, mistlight: reset.state.mistlight }, { bondXp: 0, mistlight: 0 });
  assert.deepEqual({ bondXp: observed.state.bondXp, mistlight: observed.state.mistlight }, { bondXp: 0, mistlight: 0 });

  now = new Date("2026-08-29T12:00:00.000Z");
  store.completions.get("reader-reset").push({
    chapterId: "chapter-after", chapterVersion: 1, completedAt: now.toISOString(),
    recordedAt: now.toISOString(),
  });
  const rewarded = await lifecycle.execute(actor, { action: "observe" });
  assert.deepEqual({ bondXp: rewarded.state.bondXp, mistlight: rewarded.state.mistlight }, { bondXp: 40, mistlight: 20 });
});

test("CompanionLifecycle 拒绝无账号成长、雾光不足和当日重复休息", async () => {
  const store = new MemoryCompanionStore();
  const lifecycle = new CompanionLifecycle(store, () => new Date("2026-08-28T12:00:00.000Z"));
  await assert.rejects(lifecycle.execute({ kind: "system" }, { action: "observe" }), /需要正常账号/);
  const actor = { kind: "account", id: "reader-rejections" };
  await assert.rejects(
    lifecycle.execute(actor, { action: "interact", kind: "play", operationId: "play-empty" }),
    /雾光不足/,
  );
  const firstRest = await lifecycle.execute(actor, { action: "interact", kind: "rest", operationId: "rest-first" });
  const secondRest = await lifecycle.execute(actor, { action: "interact", kind: "rest", operationId: "rest-second" });
  assert.equal(firstRest.outcome, "restored");
  assert.equal(secondRest.outcome, "cooldown");
});

test("CompanionLifecycle 重置失败时不丢失原有成长", async () => {
  const store = new MemoryCompanionStore();
  store.completions.set("reader-reset-failure", [
    { chapterId: "chapter-earned", chapterVersion: 1, completedAt: "2026-08-28T11:00:00.000Z", recordedAt: "2026-08-28T11:00:01.000Z" },
  ]);
  const lifecycle = new CompanionLifecycle(store, () => new Date("2026-08-28T12:00:00.000Z"));
  const actor = { kind: "account", id: "reader-reset-failure" };
  await lifecycle.execute(actor, { action: "observe" });
  store.failReset = true;
  await assert.rejects(
    lifecycle.execute(actor, { action: "reset", confirmation: "重置小雾成长" }),
    /simulated reset failure/,
  );
  const profile = await store.readProfile(actor.id);
  assert.deepEqual({ bondXp: profile.bondXp, mistlight: profile.mistlight }, { bondXp: 40, mistlight: 20 });
});

test("CompanionLifecycle 重置保持 revision 单调并拒绝重置前的陈旧提交", async () => {
  const store = new MemoryCompanionStore();
  const lifecycle = new CompanionLifecycle(store, () => new Date("2026-08-28T12:00:00.000Z"));
  const actor = { kind: "account", id: "reader-reset-cas" };
  await lifecycle.execute(actor, { action: "observe" });
  const stale = structuredClone(await store.readProfile(actor.id));

  const reset = await lifecycle.execute(actor, { action: "reset", confirmation: "重置小雾成长" });
  const staleResult = await store.commit({
    userId: actor.id,
    expectedRevision: stale.revision,
    next: { ...stale, revision: stale.revision + 1, bondXp: 40, mistlight: 20, rewardBaselineAt: null },
  });

  assert.equal(staleResult, "conflict");
  assert.equal((await store.readProfile(actor.id)).revision, stale.revision + 1);
  assert.deepEqual({ bondXp: reset.state.bondXp, mistlight: reset.state.mistlight }, { bondXp: 0, mistlight: 0 });
});

test("CompanionLifecycle 每五分钟奖励阅读且按自然日限制十羁绊与五雾光", async () => {
  const store = new MemoryCompanionStore();
  let now = new Date("2026-08-28T12:01:00.000Z");
  const lifecycle = new CompanionLifecycle(store, () => now);
  const actor = { kind: "account", id: "reader-active-window" };
  await lifecycle.execute(actor, { action: "record-node", chapterId: "chapter-active", chapterVersion: 2, nodeId: "node-a" });

  for (let minute = 1; minute <= 30; minute += 1) {
    now = new Date(`2026-08-28T12:${String(minute).padStart(2, "0")}:00.000Z`);
    await lifecycle.execute(actor, {
      action: "record-reading",
      chapterId: "chapter-active",
      chapterVersion: 2,
      nodeId: "node-a",
      windowStartedAt: new Date(now.getTime() - 60_000).toISOString(),
      operationId: `heartbeat-${minute}`,
    });
  }
  const state = await lifecycle.execute(actor, { action: "observe" });

  const duplicate = await lifecycle.execute(actor, {
    action: "record-reading", chapterId: "chapter-active", chapterVersion: 2, nodeId: "node-a",
    windowStartedAt: new Date(now.getTime() - 60_000).toISOString(), operationId: "heartbeat-30",
  });
  await assert.rejects(lifecycle.execute(actor, {
    action: "record-reading", chapterId: "chapter-active", chapterVersion: 2, nodeId: "node-a",
    windowStartedAt: new Date(now.getTime() - 60_000).toISOString(), operationId: "heartbeat-too-soon",
  }), /阅读窗口时间无效/);

  assert.deepEqual({ bondXp: state.state.bondXp, mistlight: state.state.mistlight }, { bondXp: 10, mistlight: 6 });
  assert.equal(duplicate.outcome, "duplicate");
});

test("CompanionLifecycle 每个章节版本最多奖励十个首次剧情节点", async () => {
  const store = new MemoryCompanionStore();
  let now = new Date("2026-08-28T13:00:00.000Z");
  const lifecycle = new CompanionLifecycle(store, () => now);
  const actor = { kind: "account", id: "reader-discovery-cap" };
  for (let index = 1; index <= 12; index += 1) {
    now = new Date(now.getTime() + 60_000);
    await lifecycle.execute(actor, {
      action: "record-node", chapterId: "chapter-explore", chapterVersion: 1, nodeId: `node-${index}`,
    });
  }
  const result = await lifecycle.execute(actor, { action: "observe" });
  assert.deepEqual({ bondXp: result.state.bondXp, mistlight: result.state.mistlight }, { bondXp: 0, mistlight: 10 });
});

test("CompanionLifecycle 重置水位拒绝已经加载但尚未结算的旧阅读窗口", async () => {
  const store = new MemoryCompanionStore();
  let now = new Date("2026-08-28T12:00:00.000Z");
  const lifecycle = new CompanionLifecycle(store, () => now);
  const actor = { kind: "account", id: "reader-stale-activity" };
  await lifecycle.execute(actor, { action: "observe" });
  store.activities.set(actor.id, [{ date: "2026-08-28", seconds: 300, operationId: "old-window", recordedAt: "2026-08-28T11:59:00.000Z" }]);
  store.afterListActivityFacts = async () => {
    now = new Date("2026-08-28T12:00:01.000Z");
    await lifecycle.execute(actor, { action: "reset", confirmation: "重置小雾成长" });
  };

  const observed = await lifecycle.execute(actor, { action: "observe" });
  assert.deepEqual({ bondXp: observed.state.bondXp, mistlight: observed.state.mistlight }, { bondXp: 0, mistlight: 0 });
});

test("CompanionLifecycle 重置水位拒绝已经加载但尚未结算的旧节点发现", async () => {
  const store = new MemoryCompanionStore();
  let now = new Date("2026-08-28T12:00:00.000Z");
  const lifecycle = new CompanionLifecycle(store, () => now);
  const actor = { kind: "account", id: "reader-stale-discovery" };
  await lifecycle.execute(actor, { action: "observe" });
  store.discoveries.set(actor.id, [{ chapterId: "chapter-active", chapterVersion: 2, nodeId: "node-a", recordedAt: "2026-08-28T11:59:00.000Z" }]);
  store.afterListDiscoveryFacts = async () => {
    now = new Date("2026-08-28T12:00:01.000Z");
    await lifecycle.execute(actor, { action: "reset", confirmation: "重置小雾成长" });
  };

  const observed = await lifecycle.execute(actor, { action: "observe" });
  assert.deepEqual({ bondXp: observed.state.bondXp, mistlight: observed.state.mistlight }, { bondXp: 0, mistlight: 0 });
});

test("CompanionLifecycle 按等级解锁动作并把收藏纳入重置", async () => {
  const store = new MemoryCompanionStore();
  const lifecycle = new CompanionLifecycle(store, () => new Date("2026-08-28T12:00:00.000Z"));
  const actor = { kind: "account", id: "reader-action-levels" };
  await assert.rejects(lifecycle.execute(actor, {
    action: "perform-action", itemId: "antenna-response",
  }), /羁绊等级 2/);
  store.completions.set(actor.id, Array.from({ length: 13 }, (_, index) => ({
    chapterId: `chapter-level-${index}`, chapterVersion: 1,
    completedAt: `2026-08-28T10:${String(index).padStart(2, "0")}:00.000Z`,
    recordedAt: `2026-08-28T10:${String(index).padStart(2, "0")}:01.000Z`,
  })));

  const observed = await lifecycle.execute(actor, { action: "observe" });
  assert.deepEqual(observed.collections.actions.map((item) => [item.id, item.owned]), [
    ["antenna-response", true], ["spin-hover", true], ["hug-memory", true],
  ]);
  assert.equal((await lifecycle.execute(actor, { action: "perform-action", itemId: "antenna-response" })).outcome, "performed");
  assert.equal((await lifecycle.execute(actor, { action: "perform-action", itemId: "spin-hover" })).outcome, "performed");
  assert.equal((await lifecycle.execute(actor, { action: "perform-action", itemId: "hug-memory" })).outcome, "performed");
  await lifecycle.execute(actor, { action: "reset", confirmation: "重置小雾成长" });
  const afterReset = await lifecycle.execute(actor, { action: "observe" });
  assert.equal(afterReset.collections.actions.some((item) => item.owned), false);
  await assert.rejects(lifecycle.execute(actor, {
    action: "perform-action", itemId: "antenna-response",
  }), /羁绊等级 2/);
});

test("CompanionLifecycle 购买与装备收藏幂等并稳定拒绝余额和所有权错误", async () => {
  const store = new MemoryCompanionStore();
  const lifecycle = new CompanionLifecycle(store, () => new Date("2026-08-28T12:00:00.000Z"));
  const actor = { kind: "account", id: "reader-collections" };
  store.completions.set(actor.id, Array.from({ length: 4 }, (_, index) => ({
    chapterId: `chapter-collection-${index}`, chapterVersion: 1,
    completedAt: `2026-08-28T11:0${index}:00.000Z`, recordedAt: `2026-08-28T11:0${index}:01.000Z`,
  })));
  await lifecycle.execute(actor, { action: "observe" });

  const purchase = await lifecycle.execute(actor, {
    action: "purchase", kind: "appearance", itemId: "starlight-cloak", operationId: "buy-stars",
  });
  const replay = await lifecycle.execute(actor, {
    action: "purchase", kind: "appearance", itemId: "starlight-cloak", operationId: "buy-stars",
  });
  const owned = await lifecycle.execute(actor, {
    action: "purchase", kind: "appearance", itemId: "starlight-cloak", operationId: "buy-stars-again",
  });
  const equipped = await lifecycle.execute(actor, {
    action: "equip", kind: "appearance", itemId: "starlight-cloak", operationId: "equip-stars",
  });

  assert.deepEqual({ purchase: purchase.state.mistlight, replay: replay.state.mistlight, owned: owned.state.mistlight }, { purchase: 20, replay: 20, owned: 20 });
  assert.equal(equipped.state.equippedAppearance, "starlight-cloak");
  await assert.rejects(lifecycle.execute(actor, {
    action: "purchase", kind: "appearance", itemId: "archive-cloak", operationId: "buy-stars",
  }), /操作标识已用于其他收藏请求/);
  await assert.rejects(lifecycle.execute(actor, {
    action: "equip", kind: "garden", itemId: "world-tree", operationId: "equip-stars",
  }), /操作标识已用于其他收藏请求/);
  await assert.rejects(lifecycle.execute(actor, {
    action: "purchase", kind: "garden", itemId: "star-nursery", operationId: "buy-expensive",
  }), /雾光不足/);
  await assert.rejects(lifecycle.execute(actor, {
    action: "equip", kind: "garden", itemId: "glowing-roots", operationId: "equip-unowned",
  }), /尚未拥有/);
  await assert.rejects(lifecycle.execute(actor, {
    action: "purchase", kind: "garden", itemId: "forged", operationId: "buy-forged",
  }), /收藏不存在/);
});
