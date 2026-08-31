export type BookshelfActor = { kind: "account"; id: string } | { kind: "system" };

export type BookshelfPublicSnapshot = {
  name: string;
  summary: string;
  coverUrl: string;
  coverAlt: string;
  format?: "serial" | "short";
};

export type BookshelfNovelFacts = {
  id: string;
  slug: string;
  status: "draft" | "published" | "offline";
  format?: "serial" | "short";
  published: BookshelfPublicSnapshot | null;
  chapters: Array<{ id: string; version: number; publishedAt: string }>;
};

export type BookshelfEntryRecord = {
  id: string;
  userId: string;
  novelId: string;
  publicSnapshot: BookshelfPublicSnapshot;
  addedAt: string;
};

export type BookshelfReadingFacts = {
  resumes: Array<{ chapterId: string; version: number; nodeId: string; pageIndex: number; updatedAt: string }>;
  completions: Array<{ chapterId: string; completedAt: string }>;
  frontier: { chapterIds: string[]; completedAt: string } | null;
};

export type BookshelfResolvedEntry = {
  entry: BookshelfEntryRecord;
  novel: BookshelfNovelFacts | null;
  facts: BookshelfReadingFacts | null;
};

export interface BookshelfStore {
  findNovel(novelId: string): Promise<BookshelfNovelFacts | null>;
  findEntry(userId: string, novelId: string): Promise<BookshelfEntryRecord | null>;
  addEntry(userId: string, novel: BookshelfNovelFacts, now: string): Promise<"added" | "already_present">;
  removeEntry(userId: string, novelId: string): Promise<"removed" | "already_absent">;
  listEntries(userId: string): Promise<BookshelfEntryRecord[]>;
  listResolvedEntries(userId: string, entryIds?: string[]): Promise<BookshelfResolvedEntry[]>;
  createListSnapshot(userId: string, orderedEntryIds: string[], expiresAt: string): Promise<string>;
  readListSnapshot(userId: string, snapshotId: string, offset: number, limit: number, now: string): Promise<{ entryIds: string[]; total: number } | null>;
  readFacts(userId: string, novelId: string): Promise<BookshelfReadingFacts>;
  rememberFrontiers(userId: string, updates: Array<{ novelId: string; chapterIds: string[] }>, now: string): Promise<void>;
  findReceipt(userId: string, operationId: string): Promise<BookshelfReceipt | null>;
  applyOperation(input: {
    userId: string; operationId: string; action: "add" | "remove"; novelId: string;
    novel: BookshelfNovelFacts | null; now: string; expiresAt: string; sourceKey: string;
    since: string; accountLimit: number; sourceLimit: number;
  }): Promise<
    | { outcome: "added" | "already_present" | "removed" | "already_absent" }
    | { rateLimited: true; retryAt: string }
    | { unavailable: true }
  >;
  cleanup(before: string): Promise<{ receipts: number; attempts: number; orphans: number }>;
  purge(userId: string): Promise<void>;
}

export type BookshelfReceipt = {
  operationId: string;
  action: "add" | "remove";
  novelId: string;
  status: "processing" | "succeeded" | "failed" | "uncertain";
  result: Record<string, unknown>;
  expiresAt: string;
};

export interface BookshelfTelemetry {
  record(event: { result: "succeeded" | "replayed" | "rate_limited" | "cleaned"; action?: "add" | "remove"; durationMs: number }): void | Promise<void>;
}

export type BookshelfStatus = "reading" | "updated" | "unstarted" | "read" | "unavailable" | "unknown";

export type BookshelfItem = {
  id: string;
  novelId: string;
  slug: string | null;
  public: BookshelfPublicSnapshot;
  format: "serial" | "short";
  status: BookshelfStatus;
  statusLabel: "阅读中" | "有更新" | "未开始" | "已读" | "暂不可读" | "暂时无法确认";
  addedAt: string;
  action: { kind: "continue"; chapterId: string } | { kind: "view"; novelId: string } | { kind: "unavailable" };
};

export type BookshelfCommand =
  | { action: "add"; novelId: string; operationId: string; sourceKey: string }
  | { action: "remove"; novelId: string; operationId: string; sourceKey: string }
  | { action: "membership"; novelId: string }
  | { action: "list"; cursor?: string | null; limit?: number }
  | { action: "resolve-entry"; novelId: string }
  | { action: "result"; operationId: string }
  | { action: "cleanup" }
  | { action: "export" }
  | { action: "purge" };

export class BookshelfError extends Error {
  readonly status: number;
  readonly retryAfterSeconds?: number;
  constructor(message: string, status = 400, retryAfterSeconds?: number) {
    super(message);
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const statusOrder: Record<BookshelfStatus, number> = {
  reading: 0, updated: 1, unstarted: 2, read: 3, unavailable: 4, unknown: 5,
};

const labels: Record<BookshelfStatus, BookshelfItem["statusLabel"]> = {
  reading: "阅读中", updated: "有更新", unstarted: "未开始", read: "已读",
  unavailable: "暂不可读", unknown: "暂时无法确认",
};
const operationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cursorState(cursor?: string | null) {
  if (!cursor) return null;
  try {
    const value = JSON.parse(atob(cursor)) as { offset?: unknown; snapshotId?: unknown };
    if (typeof value.offset !== "number" || value.offset < 0) throw new Error();
    if (typeof value.snapshotId !== "string" || !operationIdPattern.test(value.snapshotId)) throw new Error();
    return { offset: Math.floor(value.offset), snapshotId: value.snapshotId };
  } catch {
    throw new BookshelfError("书架分页标识无效", 400);
  }
}

function entrySortTime(item: BookshelfItem, facts: BookshelfReadingFacts, novel: BookshelfNovelFacts | null) {
  if (item.status === "reading") {
    return facts.resumes.reduce((latest, resume) => resume.updatedAt > latest ? resume.updatedAt : latest, "");
  }
  if (item.status === "updated" && novel) {
    const frontier = new Set(facts.frontier?.chapterIds ?? []);
    return novel.chapters.filter((chapter) => !frontier.has(chapter.id))
      .reduce((latest, chapter) => chapter.publishedAt > latest ? chapter.publishedAt : latest, "");
  }
  return item.addedAt;
}

export class BookshelfLifecycle {
  private readonly store: BookshelfStore;
  private readonly now: () => string;
  private readonly telemetry: BookshelfTelemetry;
  private readonly config: { accountWritesPerMinute: number; sourceWritesPerMinute: number; receiptLifetimeMs: number };

  constructor(
    store: BookshelfStore,
    now = () => new Date().toISOString(),
    telemetry: BookshelfTelemetry = { record() {} },
    config = { accountWritesPerMinute: 30, sourceWritesPerMinute: 120, receiptLifetimeMs: 86_400_000 },
  ) {
    this.store = store;
    this.now = now;
    this.telemetry = telemetry;
    this.config = config;
  }

  async execute(actor: BookshelfActor, command: BookshelfCommand) {
    if (actor.kind === "system") {
      if (command.action !== "cleanup") throw new BookshelfError("系统身份只能执行维护操作", 403);
      const result = await this.store.cleanup(this.now());
      await this.telemetry.record({ result: "cleaned", durationMs: 0 });
      return { kind: "cleaned" as const, ...result };
    }
    if (!actor.id) throw new BookshelfError("需要正常账号", 401);
    if (command.action === "result") {
      if (!operationIdPattern.test(command.operationId)) throw new BookshelfError("操作标识无效");
      const receipt = await this.store.findReceipt(actor.id, command.operationId);
      if (!receipt || receipt.expiresAt <= this.now()) return { kind: "operation-result" as const, status: "not_found" as const };
      return { kind: "operation-result" as const, status: receipt.status, result: receipt.result };
    }
    if (command.action === "cleanup") throw new BookshelfError("账号不能执行系统维护操作", 403);
    if (command.action === "add" || command.action === "remove") {
      const started = Date.now();
      if (!operationIdPattern.test(command.operationId)) throw new BookshelfError("操作标识无效");
      const existing = await this.store.findReceipt(actor.id, command.operationId);
      if (existing) {
        if (existing.action !== command.action || existing.novelId !== command.novelId) {
          throw new BookshelfError("操作标识已用于另一个书架动作", 409);
        }
        if (existing.expiresAt <= this.now()) {
          const present = Boolean(await this.store.findEntry(actor.id, command.novelId));
          throw new BookshelfError(`操作回执已过期；当前${present ? "已在" : "不在"}书架，请用新操作标识重试`, 409);
        }
        await this.telemetry.record({ result: "replayed", action: command.action, durationMs: Date.now() - started });
        if (existing.status === "failed" && existing.result.reason === "unavailable") {
          throw new BookshelfError("这部小说当前不能加入书架", 404);
        }
        return { kind: String(existing.result.outcome || "already_present"), novelId: command.novelId, replayed: true };
      }
      const now = this.now();
      const since = new Date(Date.parse(now) - 60_000).toISOString();
      const novel = command.action === "add" ? await this.store.findNovel(command.novelId) : null;
      const applied = await this.store.applyOperation({
        userId: actor.id, operationId: command.operationId, action: command.action,
        novelId: command.novelId, novel, now,
        expiresAt: new Date(Date.parse(now) + this.config.receiptLifetimeMs).toISOString(), sourceKey: command.sourceKey, since,
        accountLimit: this.config.accountWritesPerMinute, sourceLimit: this.config.sourceWritesPerMinute,
      });
      if ("rateLimited" in applied) {
        const retryAfterSeconds = Math.max(1, Math.ceil((Date.parse(applied.retryAt) - Date.parse(now)) / 1000));
        await this.telemetry.record({ result: "rate_limited", action: command.action, durationMs: Date.now() - started });
        throw new BookshelfError(`操作太频繁，请在 ${retryAfterSeconds} 秒后重试`, 429, retryAfterSeconds);
      }
      if ("unavailable" in applied) throw new BookshelfError("这部小说当前不能加入书架", 404);
      await this.telemetry.record({ result: "succeeded", action: command.action, durationMs: Date.now() - started });
      return { kind: applied.outcome, novelId: command.novelId, operationId: command.operationId };
    }
    if (command.action === "membership") {
      return { kind: "membership" as const, present: Boolean(await this.store.findEntry(actor.id, command.novelId)) };
    }
    if (command.action === "purge") {
      await this.store.purge(actor.id);
      return { kind: "purged" as const };
    }
    if (command.action === "export") {
      const entries = await this.store.listEntries(actor.id);
      return { kind: "export" as const, entries: entries.map(({ novelId, addedAt }) => ({ novelId, addedAt })) };
    }
    if (command.action === "resolve-entry") {
      const entry = await this.store.findEntry(actor.id, command.novelId);
      const resolved = entry ? await this.store.listResolvedEntries(actor.id, [entry.id]) : [];
      const value = resolved[0] ? this.resolve(resolved[0]) : null;
      if (value) await this.backfillFrontiers(actor.id, [value]);
      const item = value?.item ?? null;
      if (!item) throw new BookshelfError("书架条目不存在", 404);
      return { kind: "entry" as const, item };
    }
    return this.list(actor.id, command.cursor, command.limit);
  }

  private async list(userId: string, cursor?: string | null, requestedLimit = 20) {
    const limit = Math.min(20, Math.max(1, Math.floor(requestedLimit || 20)));
    const cursorValue = cursorState(cursor);
    if (cursorValue) {
      const snapshot = await this.store.readListSnapshot(userId, cursorValue.snapshotId, cursorValue.offset, limit, this.now());
      if (!snapshot) throw new BookshelfError("书架分页已过期，请重新加载", 409);
      const values = await this.store.listResolvedEntries(userId, snapshot.entryIds);
      const byId = new Map(values.map((value) => [value.entry.id, value]));
      const resolved = snapshot.entryIds.flatMap((id) => byId.has(id) ? [this.resolve(byId.get(id)!)] : []);
      await this.backfillFrontiers(userId, resolved);
      const items = resolved.map((value) => value.item);
      const nextOffset = Math.min(cursorValue.offset + limit, snapshot.total);
      return {
        kind: "page" as const, items,
        nextCursor: nextOffset < snapshot.total
          ? btoa(JSON.stringify({ snapshotId: cursorValue.snapshotId, offset: nextOffset })) : null,
      };
    }
    const resolved = (await this.store.listResolvedEntries(userId)).map((value) => this.resolve(value));
    resolved.sort((a, b) => statusOrder[a.item.status] - statusOrder[b.item.status]
      || entrySortTime(b.item, b.facts, b.novel).localeCompare(entrySortTime(a.item, a.facts, a.novel))
      || a.item.id.localeCompare(b.item.id));
    const items = resolved.slice(0, limit).map(({ item }) => item);
    await this.backfillFrontiers(userId, resolved);
    if (resolved.length <= limit) return { kind: "page" as const, items, nextCursor: null };
    const snapshotId = await this.store.createListSnapshot(
      userId, resolved.map(({ item }) => item.id), new Date(Date.parse(this.now()) + 3_600_000).toISOString(),
    );
    return { kind: "page" as const, items, nextCursor: btoa(JSON.stringify({ snapshotId, offset: limit })) };
  }

  private resolve(value: BookshelfResolvedEntry) {
      const { entry, novel } = value;
      const facts = value.facts;
      const readable = Boolean(novel && novel.status === "published" && novel.published && novel.chapters.length);
      if (!readable) {
        const item: BookshelfItem = {
          id: entry.id, novelId: entry.novelId, slug: novel?.slug ?? null,
          public: novel?.published ?? entry.publicSnapshot, format: novel?.format ?? entry.publicSnapshot.format ?? "serial", status: "unavailable", statusLabel: labels.unavailable,
          addedAt: entry.addedAt, action: { kind: "unavailable" },
        };
        return { item, facts: facts ?? { resumes: [], completions: [], frontier: null }, novel, frontierUpdate: null };
      }
      if (!facts) {
        const item: BookshelfItem = {
          id: entry.id, novelId: entry.novelId, slug: novel?.slug ?? null,
          public: novel?.published ?? entry.publicSnapshot, format: novel?.format ?? entry.publicSnapshot.format ?? "serial", status: "unknown", statusLabel: labels.unknown,
          addedAt: entry.addedAt, action: { kind: "view", novelId: entry.novelId },
        };
        return { item, facts: { resumes: [], completions: [], frontier: null }, novel };
      }
      const chapters = novel?.chapters ?? [];
      const versions = new Map(chapters.map((chapter) => [chapter.id, chapter.version]));
      const validResumes = facts.resumes.filter((resume) => versions.get(resume.chapterId) === resume.version);
      const completionIds = new Set(facts.completions.map((completion) => completion.chapterId));
      const allRead = readable && chapters.every((chapter) => completionIds.has(chapter.id));
      const chapterIds = chapters.map((chapter) => chapter.id);
      const frontierIds = facts.frontier?.chapterIds ?? [];
      const frontierUpdate = allRead && (frontierIds.length !== chapterIds.length
        || chapterIds.some((chapterId) => !frontierIds.includes(chapterId))) ? { novelId: entry.novelId, chapterIds } : null;
      const hasNewChapter = Boolean(facts.frontier && chapters.some((chapter) => !facts.frontier!.chapterIds.includes(chapter.id)));
      const status: BookshelfStatus = !readable ? "unavailable"
        : validResumes.length ? "reading"
        : allRead ? "read"
        : hasNewChapter ? "updated"
        : completionIds.size ? "reading" : "unstarted";
      const latestResume = [...validResumes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      const item: BookshelfItem = {
        id: entry.id, novelId: entry.novelId, slug: novel?.slug ?? null,
        public: novel?.published ?? entry.publicSnapshot, format: novel?.format ?? entry.publicSnapshot.format ?? "serial", status, statusLabel: labels[status], addedAt: entry.addedAt,
        action: status === "unavailable" ? { kind: "unavailable" }
          : latestResume ? { kind: "continue", chapterId: latestResume.chapterId }
          : { kind: "view", novelId: entry.novelId },
      };
      return { item, facts: { ...facts, resumes: validResumes }, novel, frontierUpdate };
  }

  private async backfillFrontiers(userId: string, values: Array<{ frontierUpdate?: { novelId: string; chapterIds: string[] } | null }>) {
    const updates = values.flatMap((value) => value.frontierUpdate ? [value.frontierUpdate] : []);
    if (updates.length) await this.store.rememberFrontiers(userId, updates, this.now());
  }
}
