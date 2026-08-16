import assert from "node:assert/strict";
import { test } from "node:test";
import { BookshelfError, BookshelfLifecycle } from "../lib/bookshelf-lifecycle.ts";

function snapshot(name) {
  return { name, summary: `${name}简介`, coverUrl: "", coverAlt: `${name}封面` };
}

class MemoryBookshelfStore {
  novels = new Map(); entries = new Map(); facts = new Map(); receipts = new Map(); attempts = []; frontiers = new Map(); snapshots = new Map();
  factsUnavailable = new Set(); frontierBatches = 0;
  async findNovel(id) { return this.novels.get(id) || null; }
  async findEntry(userId, novelId) { return this.entries.get(`${userId}:${novelId}`) || null; }
  async addEntry(userId, novel, now) {
    const id = `${userId}:${novel.id}`;
    if (this.entries.has(id)) return "already_present";
    this.entries.set(id, { id, userId, novelId: novel.id, publicSnapshot: novel.published, addedAt: now });
    return "added";
  }
  async removeEntry(userId, novelId) { return this.entries.delete(`${userId}:${novelId}`) ? "removed" : "already_absent"; }
  async listEntries(userId) { return [...this.entries.values()].filter((entry) => entry.userId === userId); }
  async listResolvedEntries(userId, entryIds) {
    const wanted = entryIds ? new Set(entryIds) : null;
    return (await this.listEntries(userId)).filter((entry) => !wanted || wanted.has(entry.id)).map((entry) => {
      const key = `${userId}:${entry.novelId}`;
      const base = this.facts.get(key) || { resumes: [], completions: [], frontier: null };
      return {
        entry, novel: this.novels.get(entry.novelId) || null,
        facts: this.factsUnavailable.has(key) ? null : { ...base, frontier: this.frontiers.get(key) || base.frontier },
      };
    });
  }
  async createListSnapshot(userId, entryIds, expiresAt) {
    const id = crypto.randomUUID(); this.snapshots.set(id, { userId, entryIds, expiresAt }); return id;
  }
  async readListSnapshot(userId, snapshotId, offset, limit, now) {
    const value = this.snapshots.get(snapshotId);
    if (!value || value.userId !== userId || value.expiresAt <= now) return null;
    return { entryIds: value.entryIds.slice(offset, offset + limit), total: value.entryIds.length };
  }
  async readFacts(userId, novelId) {
    const value = this.facts.get(`${userId}:${novelId}`) || { resumes: [], completions: [], frontier: null };
    return { ...value, frontier: this.frontiers.get(`${userId}:${novelId}`) || value.frontier };
  }
  async rememberFrontiers(userId, updates, now) {
    this.frontierBatches += 1;
    for (const { novelId, chapterIds } of updates) this.frontiers.set(`${userId}:${novelId}`, { chapterIds, completedAt: now });
  }
  async findReceipt(userId, operationId) { return this.receipts.get(`${userId}:${operationId}`) || null; }
  async countAttempts(userId, sourceKey, since) {
    const rows = this.attempts.filter((row) => row.createdAt >= since);
    return {
      account: rows.filter((row) => row.userId === userId).length,
      source: rows.filter((row) => row.sourceKey === sourceKey).length,
      earliest: rows[0]?.createdAt || null,
    };
  }
  async applyOperation(input) {
    const receiptKey = `${input.userId}:${input.operationId}`;
    const existing = this.receipts.get(receiptKey);
    if (existing) return { outcome: existing.result.outcome };
    const recent = this.attempts.filter((row) => row.createdAt >= input.since);
    if (recent.filter((row) => row.userId === input.userId).length >= input.accountLimit
      || recent.filter((row) => row.sourceKey === input.sourceKey).length >= input.sourceLimit) {
      return { rateLimited: true, retryAt: new Date(Date.parse(recent[0]?.createdAt || input.now) + 60_000).toISOString() };
    }
    if (input.action === "add" && (!input.novel || input.novel.status !== "published" || !input.novel.published || !input.novel.chapters.length)) {
      this.receipts.set(receiptKey, {
        operationId: input.operationId, action: input.action, novelId: input.novelId,
        status: "failed", result: { reason: "unavailable" }, expiresAt: input.expiresAt,
      });
      this.attempts.push({ userId: input.userId, sourceKey: input.sourceKey, createdAt: input.now });
      return { unavailable: true };
    }
    const outcome = input.action === "add"
      ? await this.addEntry(input.userId, input.novel, input.now)
      : await this.removeEntry(input.userId, input.novelId);
    this.receipts.set(receiptKey, {
      operationId: input.operationId, action: input.action, novelId: input.novelId,
      status: "succeeded", result: { outcome }, expiresAt: input.expiresAt,
    });
    this.attempts.push({ userId: input.userId, sourceKey: input.sourceKey, createdAt: input.now });
    return { outcome };
  }
  async cleanup(before) {
    let receipts = 0;
    for (const [key, receipt] of this.receipts) if (receipt.expiresAt <= before) { this.receipts.delete(key); receipts += 1; }
    const attempts = this.attempts.length;
    this.attempts = [];
    return { receipts, attempts, orphans: 0 };
  }
  async purge(userId) {
    for (const [key, entry] of this.entries) if (entry.userId === userId) this.entries.delete(key);
    for (const key of this.receipts.keys()) if (key.startsWith(`${userId}:`)) this.receipts.delete(key);
  }
}

function novel(id, chapters = [{ id: `${id}-1`, version: 1, publishedAt: "2026-08-01T00:00:00.000Z" }], status = "published") {
  return { id, slug: id, status, published: snapshot(id), chapters };
}

test("BookshelfLifecycle 统一推导状态、排序和继续阅读目标", async () => {
  const store = new MemoryBookshelfStore();
  const actor = { kind: "account", id: "reader" };
  const now = "2026-08-16T03:00:00.000Z";
  const lifecycle = new BookshelfLifecycle(store, () => now);
  for (const id of ["reading", "updated", "unstarted", "read", "unavailable"]) {
    const chapters = id === "updated" ? [
      { id: "updated-1", version: 1, publishedAt: "2026-08-01T00:00:00.000Z" },
      { id: "updated-2", version: 1, publishedAt: "2026-08-15T00:00:00.000Z" },
    ] : undefined;
    store.novels.set(id, novel(id, chapters, id === "unavailable" ? "offline" : "published"));
    await store.addEntry(actor.id, store.novels.get(id), now);
  }
  store.facts.set("reader:reading", { resumes: [
    { chapterId: "reading-1", version: 0, nodeId: "stale", pageIndex: 0, updatedAt: "2026-08-16T02:59:00.000Z" },
    { chapterId: "reading-1", version: 1, nodeId: "current", pageIndex: 2, updatedAt: "2026-08-16T02:58:00.000Z" },
  ], completions: [], frontier: null });
  store.facts.set("reader:updated", {
    resumes: [], completions: [{ chapterId: "updated-1", completedAt: "2026-08-02T00:00:00.000Z" }],
    frontier: { chapterIds: ["updated-1"], completedAt: "2026-08-02T00:00:00.000Z" },
  });
  store.facts.set("reader:read", { resumes: [], completions: [{ chapterId: "read-1", completedAt: now }], frontier: null });
  const page = await lifecycle.execute(actor, { action: "list" });
  assert.deepEqual(page.items.map((item) => item.status), ["reading", "updated", "unstarted", "read", "unavailable"]);
  assert.deepEqual(page.items[0].action, { kind: "continue", chapterId: "reading-1" });
  assert.deepEqual(page.items[1].action, { kind: "view", novelId: "updated" });
});

test("BookshelfLifecycle 每页二十条且拒绝损坏 cursor", async () => {
  const store = new MemoryBookshelfStore();
  const lifecycle = new BookshelfLifecycle(store);
  const actor = { kind: "account", id: "reader" };
  for (let index = 0; index < 25; index += 1) {
    const value = novel(`novel-${index}`); store.novels.set(value.id, value);
    await store.addEntry(actor.id, value, `2026-08-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`);
  }
  const first = await lifecycle.execute(actor, { action: "list" });
  const removedId = first.items[0].id;
  store.entries.delete(removedId);
  const second = await lifecycle.execute(actor, { action: "list", cursor: first.nextCursor });
  assert.equal(first.items.length, 20); assert.equal(second.items.length, 5);
  assert.equal(new Set([...first.items, ...second.items].map((item) => item.id)).size, 25);
  await assert.rejects(() => lifecycle.execute(actor, { action: "list", cursor: "broken" }), BookshelfError);
});

test("BookshelfLifecycle 回执重放不覆盖后续意图并执行双维度频控", async () => {
  const store = new MemoryBookshelfStore();
  const value = novel("novel"); store.novels.set(value.id, value);
  const actor = { kind: "account", id: "reader" };
  const lifecycle = new BookshelfLifecycle(store, () => "2026-08-16T03:00:00.000Z", undefined, {
    accountWritesPerMinute: 2, sourceWritesPerMinute: 2, receiptLifetimeMs: 86_400_000,
  });
  const addOperation = crypto.randomUUID();
  const removeOperation = crypto.randomUUID();
  const thirdOperation = crypto.randomUUID();
  const first = await lifecycle.execute(actor, { action: "add", novelId: value.id, operationId: addOperation, sourceKey: "source" });
  const removed = await lifecycle.execute(actor, { action: "remove", novelId: value.id, operationId: removeOperation, sourceKey: "source" });
  const replay = await lifecycle.execute(actor, { action: "add", novelId: value.id, operationId: addOperation, sourceKey: "source" });
  assert.equal(first.kind, "added"); assert.equal(removed.kind, "removed"); assert.equal(replay.replayed, true);
  assert.equal((await lifecycle.execute(actor, { action: "membership", novelId: value.id })).present, false);
  await assert.rejects(
    () => lifecycle.execute(actor, { action: "add", novelId: value.id, operationId: thirdOperation, sourceKey: "source" }),
    (error) => error instanceof BookshelfError && error.status === 429,
  );
  await assert.rejects(
    () => lifecycle.execute(actor, { action: "remove", novelId: "other", operationId: addOperation, sourceKey: "source" }),
    (error) => error instanceof BookshelfError && error.status === 409,
  );
});

test("BookshelfLifecycle 过期回执不重放旧成功，确定失败可稳定查询", async () => {
  const store = new MemoryBookshelfStore();
  const value = novel("novel"); store.novels.set(value.id, value);
  const actor = { kind: "account", id: "reader" };
  let now = "2026-08-16T03:00:00.000Z";
  const lifecycle = new BookshelfLifecycle(store, () => now, undefined, {
    accountWritesPerMinute: 30, sourceWritesPerMinute: 120, receiptLifetimeMs: 1_000,
  });
  const operationId = crypto.randomUUID();
  await lifecycle.execute(actor, { action: "add", novelId: value.id, operationId, sourceKey: "source" });
  now = "2026-08-16T03:00:02.000Z";
  await store.removeEntry(actor.id, value.id);
  await assert.rejects(
    () => lifecycle.execute(actor, { action: "add", novelId: value.id, operationId, sourceKey: "source" }),
    (error) => error instanceof BookshelfError && error.status === 409 && error.message.includes("当前不在书架"),
  );
  const unavailableOperation = crypto.randomUUID();
  await assert.rejects(
    () => lifecycle.execute(actor, { action: "add", novelId: "missing", operationId: unavailableOperation, sourceKey: "source" }),
    (error) => error instanceof BookshelfError && error.status === 404,
  );
  const failed = await lifecycle.execute(actor, { action: "result", operationId: unavailableOperation });
  assert.equal(failed.status, "failed");
  await assert.rejects(
    () => lifecycle.execute(actor, { action: "add", novelId: "missing", operationId: unavailableOperation, sourceKey: "source" }),
    (error) => error instanceof BookshelfError && error.status === 404,
  );
});

test("BookshelfLifecycle 已完成的同版本章节重新上线仍保持已读", async () => {
  const store = new MemoryBookshelfStore();
  const value = novel("novel", [
    { id: "novel-1", version: 1, publishedAt: "2026-08-01T00:00:00.000Z" },
    { id: "novel-2", version: 1, publishedAt: "2026-08-02T00:00:00.000Z" },
  ]);
  store.novels.set(value.id, value);
  await store.addEntry("reader", value, "2026-08-01T00:00:00.000Z");
  store.facts.set("reader:novel", {
    resumes: [],
    completions: [{ chapterId: "novel-1", completedAt: "2026-08-03T00:00:00.000Z" }, { chapterId: "novel-2", completedAt: "2026-08-03T00:00:00.000Z" }],
    frontier: { chapterIds: ["novel-1"], completedAt: "2026-08-03T00:00:00.000Z" },
  });
  const page = await new BookshelfLifecycle(store).execute({ kind: "account", id: "reader" }, { action: "list" });
  assert.equal(page.items[0].status, "read");
});

test("BookshelfLifecycle 阅读事实故障降级为未知且前沿只批量回填一次", async () => {
  const store = new MemoryBookshelfStore();
  for (const id of ["read-a", "read-b", "unknown"]) {
    const value = novel(id); store.novels.set(id, value);
    await store.addEntry("reader", value, "2026-08-01T00:00:00.000Z");
    store.facts.set(`reader:${id}`, { resumes: [], completions: [{ chapterId: `${id}-1`, completedAt: "2026-08-02T00:00:00.000Z" }], frontier: null });
  }
  store.factsUnavailable.add("reader:unknown");
  const lifecycle = new BookshelfLifecycle(store);
  const first = await lifecycle.execute({ kind: "account", id: "reader" }, { action: "list" });
  assert.equal(first.items.find((item) => item.novelId === "unknown").status, "unknown");
  assert.equal(store.frontierBatches, 1);
  await lifecycle.execute({ kind: "account", id: "reader" }, { action: "list" });
  assert.equal(store.frontierBatches, 1);
});

test("BookshelfLifecycle 导出和清除只作用于当前账号", async () => {
  const store = new MemoryBookshelfStore();
  const value = novel("novel"); store.novels.set(value.id, value);
  await store.addEntry("owner", value, "2026-08-16T00:00:00.000Z");
  await store.addEntry("other", value, "2026-08-16T00:00:00.000Z");
  const lifecycle = new BookshelfLifecycle(store);
  const exported = await lifecycle.execute({ kind: "account", id: "owner" }, { action: "export" });
  assert.deepEqual(exported.entries, [{ novelId: "novel", addedAt: "2026-08-16T00:00:00.000Z" }]);
  await lifecycle.execute({ kind: "account", id: "owner" }, { action: "purge" });
  assert.equal((await store.listEntries("owner")).length, 0);
  assert.equal((await store.listEntries("other")).length, 1);
});

test("BookshelfLifecycle telemetry 只记录白名单结果和耗时", async () => {
  const store = new MemoryBookshelfStore();
  const value = novel("private-novel"); store.novels.set(value.id, value);
  const events = [];
  const lifecycle = new BookshelfLifecycle(store, () => "2026-08-16T03:00:00.000Z", {
    record(event) { events.push(event); },
  }, { accountWritesPerMinute: 2, sourceWritesPerMinute: 2, receiptLifetimeMs: 86_400_000 });
  const actor = { kind: "account", id: "private-reader" };
  const addOperation = crypto.randomUUID();
  await lifecycle.execute(actor, { action: "add", novelId: value.id, operationId: addOperation, sourceKey: "private-source" });
  await lifecycle.execute(actor, { action: "add", novelId: value.id, operationId: addOperation, sourceKey: "private-source" });
  await lifecycle.execute(actor, { action: "remove", novelId: value.id, operationId: crypto.randomUUID(), sourceKey: "private-source" });
  await assert.rejects(
    () => lifecycle.execute(actor, { action: "remove", novelId: value.id, operationId: crypto.randomUUID(), sourceKey: "private-source" }),
    (error) => error instanceof BookshelfError && error.status === 429,
  );
  await lifecycle.execute({ kind: "system" }, { action: "cleanup" });
  assert.deepEqual(events.map((event) => event.result), ["succeeded", "replayed", "succeeded", "rate_limited", "cleaned"]);
  for (const event of events) {
    assert.ok(Object.keys(event).every((key) => ["result", "action", "durationMs"].includes(key)));
    assert.equal(typeof event.durationMs, "number");
  }
  const serialized = JSON.stringify(events);
  assert.equal(serialized.includes("private-reader"), false);
  assert.equal(serialized.includes("private-novel"), false);
  assert.equal(serialized.includes("private-source"), false);
});
