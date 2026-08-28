import { and, eq, gt, gte, inArray, or } from "drizzle-orm";
import { ensureSchema, getD1Binding, getDb } from ".";
import {
  bookshelfEntries, bookshelfListSnapshotChunks, bookshelfListSnapshots, bookshelfOperationReceipts,
  bookshelfRateLimitAttempts, chapterCompletionRecords, chapters, novelCompletionFrontiers, novels, readingProgress,
} from "./schema";
import {
  BookshelfLifecycle, type BookshelfEntryRecord, type BookshelfPublicSnapshot,
  type BookshelfReadingFacts, type BookshelfStore,
} from "../lib/bookshelf-lifecycle";

function parseSnapshot(value: string): BookshelfPublicSnapshot {
  try {
    const parsed = JSON.parse(value) as Partial<BookshelfPublicSnapshot>;
    return {
      name: String(parsed.name || "作品已不可用"), summary: String(parsed.summary || ""),
      coverUrl: String(parsed.coverUrl || ""), coverAlt: String(parsed.coverAlt || parsed.name || "小说封面"),
    };
  } catch {
    return { name: "作品已不可用", summary: "", coverUrl: "", coverAlt: "小说封面" };
  }
}

function entryRecord(row: typeof bookshelfEntries.$inferSelect): BookshelfEntryRecord {
  return {
    id: row.id, userId: row.userId, novelId: row.novelId,
    publicSnapshot: parseSnapshot(row.publicSnapshotJson), addedAt: row.addedAt,
  };
}

async function queryChunks<T>(ids: string[], query: (ids: string[]) => Promise<T[]>) {
  const rows: T[] = [];
  for (let offset = 0; offset < ids.length; offset += 80) rows.push(...await query(ids.slice(offset, offset + 80)));
  return rows;
}

async function operationDigest(operationId: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(operationId));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export const drizzleD1BookshelfStore: BookshelfStore = {
  async findNovel(novelId) {
    await ensureSchema();
    const row = (await getDb().select().from(novels).where(eq(novels.id, novelId)).limit(1))[0];
    if (!row) return null;
    const chapterRows = await getDb().select().from(chapters).where(and(
      eq(chapters.novelId, novelId), eq(chapters.status, "published"),
    ));
    const published = row.publishedJson ? parseSnapshot(row.publishedJson) : null;
    return {
      id: row.id, slug: row.slug, status: row.status, published,
      chapters: chapterRows.map((chapter) => ({ id: chapter.id, version: chapter.version, publishedAt: chapter.updatedAt })),
    };
  },

  async findEntry(userId, novelId) {
    await ensureSchema();
    const row = (await getDb().select().from(bookshelfEntries).where(and(
      eq(bookshelfEntries.userId, userId), eq(bookshelfEntries.novelId, novelId),
    )).limit(1))[0];
    return row ? entryRecord(row) : null;
  },

  async addEntry(userId, novel, now) {
    await ensureSchema();
    const id = `${userId}:${novel.id}`;
    const result = await getD1Binding().prepare(`INSERT INTO bookshelf_entries
      (id, user_id, novel_id, public_snapshot_json, added_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
      .bind(id, userId, novel.id, JSON.stringify(novel.published), now, now).run();
    return result.meta.changes ? "added" : "already_present";
  },

  async removeEntry(userId, novelId) {
    await ensureSchema();
    const result = await getD1Binding().prepare("DELETE FROM bookshelf_entries WHERE user_id = ? AND novel_id = ?")
      .bind(userId, novelId).run();
    return result.meta.changes ? "removed" : "already_absent";
  },

  async listEntries(userId) {
    await ensureSchema();
    return (await getDb().select().from(bookshelfEntries).where(eq(bookshelfEntries.userId, userId))).map(entryRecord);
  },

  async listResolvedEntries(userId, entryIds) {
    await ensureSchema();
    const entryRows = entryIds
      ? entryIds.length ? await getDb().select().from(bookshelfEntries).where(and(
        eq(bookshelfEntries.userId, userId), inArray(bookshelfEntries.id, entryIds),
      )) : []
      : await getDb().select().from(bookshelfEntries).where(eq(bookshelfEntries.userId, userId));
    const entries = entryRows.map(entryRecord);
    if (!entries.length) return [];
    const novelIdList = [...new Set(entries.map((entry) => entry.novelId))];
    const novelIds = new Set(novelIdList);
    const [novelRows, relevantChapters] = await Promise.all([
      queryChunks(novelIdList, (ids) => getDb().select().from(novels).where(inArray(novels.id, ids))),
      queryChunks(novelIdList, (ids) => getDb().select().from(chapters).where(inArray(chapters.novelId, ids))),
    ]);
    const chaptersByNovel = new Map<string, typeof relevantChapters>();
    const chapterNovel = new Map<string, string>();
    for (const chapter of relevantChapters) {
      chapterNovel.set(chapter.id, chapter.novelId);
      const values = chaptersByNovel.get(chapter.novelId) || [];
      values.push(chapter);
      chaptersByNovel.set(chapter.novelId, values);
    }
    const novelById = new Map(novelRows.filter((row) => novelIds.has(row.id)).map((row) => [row.id, row]));
    const relevantChapterIds = relevantChapters.map((chapter) => chapter.id);
    let resumeRows: Array<typeof readingProgress.$inferSelect> = [];
    let completionRows: Array<typeof chapterCompletionRecords.$inferSelect> = [];
    let frontierRows: Array<typeof novelCompletionFrontiers.$inferSelect> = [];
    let readingFactsAvailable = true;
    try {
      [resumeRows, completionRows, frontierRows] = await Promise.all([
        queryChunks(relevantChapterIds, (ids) => getDb().select().from(readingProgress).where(and(
          eq(readingProgress.userId, userId), inArray(readingProgress.chapterId, ids),
        ))),
        queryChunks(relevantChapterIds, (ids) => getDb().select().from(chapterCompletionRecords).where(and(
          eq(chapterCompletionRecords.userId, userId), inArray(chapterCompletionRecords.chapterId, ids),
        ))),
        queryChunks(novelIdList, (ids) => getDb().select().from(novelCompletionFrontiers).where(and(
          eq(novelCompletionFrontiers.userId, userId), inArray(novelCompletionFrontiers.novelId, ids),
        ))),
      ]);
    } catch {
      readingFactsAvailable = false;
    }
    const frontierByNovel = new Map(frontierRows.map((row) => [row.novelId, row]));
    return entries.map((entry) => {
      const row = novelById.get(entry.novelId);
      const novelChapters = (chaptersByNovel.get(entry.novelId) || []).filter((chapter) => chapter.status === "published");
      const novel = row ? {
        id: row.id, slug: row.slug, status: row.status,
        published: row.publishedJson ? parseSnapshot(row.publishedJson) : null,
        chapters: novelChapters.map((chapter) => ({ id: chapter.id, version: chapter.version, publishedAt: chapter.updatedAt })),
      } : null;
      const frontier = frontierByNovel.get(entry.novelId);
      let frontierIds: string[] = [];
      try { frontierIds = JSON.parse(frontier?.chapterIdsJson || "[]") as string[]; } catch {}
      return {
        entry, novel,
        facts: readingFactsAvailable ? {
          resumes: resumeRows.filter((resume) => chapterNovel.get(resume.chapterId) === entry.novelId).map((resume) => ({
            chapterId: resume.chapterId, version: resume.chapterVersion, nodeId: resume.nodeId,
            pageIndex: resume.pageIndex, updatedAt: resume.updatedAt,
          })),
          completions: completionRows.filter((completion) => chapterNovel.get(completion.chapterId) === entry.novelId)
            .map((completion) => ({ chapterId: completion.chapterId, completedAt: completion.completedAt })),
          frontier: frontier ? { chapterIds: frontierIds, completedAt: frontier.completedAt } : null,
        } : null,
      };
    });
  },

  async createListSnapshot(userId, orderedEntryIds, expiresAt) {
    await ensureSchema();
    const snapshotId = crypto.randomUUID();
    const chunkSize = 200;
    const d1 = getD1Binding();
    const statements = [d1.prepare(`INSERT INTO bookshelf_list_snapshots (id, user_id, total, expires_at)
      VALUES (?, ?, ?, ?)`).bind(snapshotId, userId, orderedEntryIds.length, expiresAt)];
    for (let offset = 0; offset < orderedEntryIds.length; offset += chunkSize) {
      const chunkIndex = Math.floor(offset / chunkSize);
      statements.push(d1.prepare(`INSERT INTO bookshelf_list_snapshot_chunks
        (id, snapshot_id, user_id, chunk_index, entry_ids_json) VALUES (?, ?, ?, ?, ?)`)
        .bind(`${snapshotId}:${chunkIndex}`, snapshotId, userId, chunkIndex, JSON.stringify(orderedEntryIds.slice(offset, offset + chunkSize))));
    }
    await d1.batch(statements);
    return snapshotId;
  },

  async readListSnapshot(userId, snapshotId, offset, limit, now) {
    await ensureSchema();
    const header = (await getDb().select().from(bookshelfListSnapshots).where(and(
      eq(bookshelfListSnapshots.id, snapshotId), eq(bookshelfListSnapshots.userId, userId),
      gt(bookshelfListSnapshots.expiresAt, now),
    )).limit(1))[0];
    if (!header || offset >= header.total) return null;
    const firstChunk = Math.floor(offset / 200);
    const lastChunk = Math.floor((Math.min(header.total, offset + limit) - 1) / 200);
    const rows = await getDb().select().from(bookshelfListSnapshotChunks).where(and(
      eq(bookshelfListSnapshotChunks.snapshotId, snapshotId), eq(bookshelfListSnapshotChunks.userId, userId),
      inArray(bookshelfListSnapshotChunks.chunkIndex, firstChunk === lastChunk ? [firstChunk] : [firstChunk, lastChunk]),
    ));
    const ids: string[] = [];
    for (const row of rows.sort((a, b) => a.chunkIndex - b.chunkIndex)) {
      try { ids.push(...JSON.parse(row.entryIdsJson) as string[]); } catch {}
    }
    const relativeOffset = offset - firstChunk * 200;
    return { entryIds: ids.slice(relativeOffset, relativeOffset + limit), total: header.total };
  },

  async readFacts(userId, novelId): Promise<BookshelfReadingFacts> {
    await ensureSchema();
    const chapterRows = await getDb().select({ id: chapters.id }).from(chapters).where(eq(chapters.novelId, novelId));
    const chapterIds = chapterRows.map((chapter) => chapter.id);
    if (!chapterIds.length) return { resumes: [], completions: [], frontier: null };
    const [resumes, completions, frontiers] = await Promise.all([
      getDb().select().from(readingProgress).where(and(eq(readingProgress.userId, userId), inArray(readingProgress.chapterId, chapterIds))),
      getDb().select().from(chapterCompletionRecords).where(and(eq(chapterCompletionRecords.userId, userId), inArray(chapterCompletionRecords.chapterId, chapterIds))),
      getDb().select().from(novelCompletionFrontiers).where(and(
        eq(novelCompletionFrontiers.userId, userId), eq(novelCompletionFrontiers.novelId, novelId),
      )).limit(1),
    ]);
    let frontierChapterIds: string[] = [];
    try { frontierChapterIds = JSON.parse(frontiers[0]?.chapterIdsJson || "[]") as string[]; } catch {}
    return {
      resumes: resumes.map((resume) => ({
        chapterId: resume.chapterId, version: resume.chapterVersion, nodeId: resume.nodeId,
        pageIndex: resume.pageIndex, updatedAt: resume.updatedAt,
      })),
      completions: completions.map((completion) => ({ chapterId: completion.chapterId, completedAt: completion.completedAt })),
      frontier: frontiers[0] ? { chapterIds: frontierChapterIds, completedAt: frontiers[0].completedAt } : null,
    };
  },

  async rememberFrontiers(userId, updates, now) {
    await ensureSchema();
    if (!updates.length) return;
    const d1 = getD1Binding();
    for (let offset = 0; offset < updates.length; offset += 80) {
      await d1.batch(updates.slice(offset, offset + 80).map(({ novelId, chapterIds }) => d1.prepare(`INSERT INTO novel_completion_frontiers
        (id, user_id, novel_id, chapter_ids_json, completed_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET chapter_ids_json = excluded.chapter_ids_json,
          completed_at = excluded.completed_at, updated_at = excluded.updated_at`)
        .bind(`${userId}:${novelId}`, userId, novelId, JSON.stringify(chapterIds), now, now)));
    }
  },

  async findReceipt(userId, operationId) {
    await ensureSchema();
    const digest = await operationDigest(operationId);
    const row = (await getDb().select().from(bookshelfOperationReceipts).where(and(
      eq(bookshelfOperationReceipts.userId, userId), eq(bookshelfOperationReceipts.operationDigest, digest),
    )).limit(1))[0];
    if (!row) return null;
    let result: Record<string, unknown> = {};
    try { result = JSON.parse(row.resultJson) as Record<string, unknown>; } catch {}
    return {
      operationId, action: row.action, novelId: row.novelId,
      status: row.status, result, expiresAt: row.expiresAt,
    };
  },

  async applyOperation(input) {
    await ensureSchema();
    const d1 = getD1Binding();
    const digest = await operationDigest(input.operationId);
    const receiptId = `${input.userId}:${digest}`;
    const entryId = `${input.userId}:${input.novelId}`;
    const before = await this.findEntry(input.userId, input.novelId);
    const outcome = input.action === "add"
      ? before ? "already_present" : "added"
      : before ? "removed" : "already_absent";
    const attemptId = crypto.randomUUID();
    const receiptGuard = "NOT EXISTS (SELECT 1 FROM bookshelf_operation_receipts WHERE user_id = ? AND operation_id = ?)";
    const attemptGuard = "EXISTS (SELECT 1 FROM bookshelf_rate_limit_attempts WHERE id = ?)";
    const eligibility = `EXISTS (SELECT 1 FROM novels
      WHERE id = ? AND status = 'published' AND published_json IS NOT NULL
        AND EXISTS (SELECT 1 FROM chapters WHERE novel_id = ? AND status = 'published'))`;
    const mutation = input.action === "add"
      ? d1.prepare(`INSERT INTO bookshelf_entries
          (id, user_id, novel_id, public_snapshot_json, added_at, updated_at)
          SELECT ?, ?, ?, ?, ?, ? WHERE ${attemptGuard} AND ${receiptGuard} AND ${eligibility}
          ON CONFLICT(id) DO NOTHING`)
          .bind(
            entryId, input.userId, input.novelId, JSON.stringify(input.novel?.published ?? {}), input.now, input.now,
            attemptId, input.userId, digest, input.novelId, input.novelId,
          )
      : d1.prepare(`DELETE FROM bookshelf_entries WHERE user_id = ? AND novel_id = ? AND ${attemptGuard} AND ${receiptGuard}`)
          .bind(input.userId, input.novelId, attemptId, input.userId, digest);
    const receiptEligibility = input.action === "add" ? ` AND ${eligibility}` : "";
    const statements = [
      d1.prepare(`INSERT INTO bookshelf_rate_limit_attempts (id, user_id, source_key, created_at)
        SELECT ?, ?, ?, ? WHERE ${receiptGuard}
          AND (SELECT COUNT(*) FROM bookshelf_rate_limit_attempts WHERE user_id = ? AND created_at >= ?) < ?
          AND (SELECT COUNT(*) FROM bookshelf_rate_limit_attempts WHERE source_key = ? AND created_at >= ?) < ?`)
        .bind(
          attemptId, input.userId, input.sourceKey, input.now, input.userId, digest,
          input.userId, input.since, input.accountLimit, input.sourceKey, input.since, input.sourceLimit,
        ),
      mutation,
      d1.prepare(`INSERT INTO bookshelf_operation_receipts
        (id, user_id, operation_id, action, novel_id, status, result_json, expires_at, created_at, updated_at)
        SELECT ?, ?, ?, ?, ?, 'succeeded', ?, ?, ?, ? WHERE ${attemptGuard}${receiptEligibility}
        ON CONFLICT(id) DO NOTHING`)
        .bind(
          receiptId, input.userId, digest, input.action, input.novelId, JSON.stringify({ outcome }),
          input.expiresAt, input.now, input.now, attemptId,
          ...(input.action === "add" ? [input.novelId, input.novelId] : []),
        ),
    ];
    if (input.action === "add") {
      statements.push(d1.prepare(`INSERT INTO bookshelf_operation_receipts
        (id, user_id, operation_id, action, novel_id, status, result_json, expires_at, created_at, updated_at)
        SELECT ?, ?, ?, 'add', ?, 'failed', ?, ?, ?, ? WHERE ${attemptGuard} AND ${receiptGuard} AND NOT ${eligibility}
        ON CONFLICT(id) DO NOTHING`)
        .bind(
          receiptId, input.userId, digest, input.novelId, JSON.stringify({ reason: "unavailable" }),
          input.expiresAt, input.now, input.now, attemptId, input.userId, digest, input.novelId, input.novelId,
        ));
    }
    await d1.batch(statements);
    const receipt = await this.findReceipt(input.userId, input.operationId);
    if (receipt?.status === "failed" && receipt.result.reason === "unavailable") return { unavailable: true };
    if (receipt) return { outcome: String(receipt.result.outcome || outcome) as "added" | "already_present" | "removed" | "already_absent" };
    if (input.action === "add") {
      const current = await this.findNovel(input.novelId);
      if (!current || current.status !== "published" || !current.published || current.chapters.length === 0) return { unavailable: true };
    }
    const attempts = await getDb().select().from(bookshelfRateLimitAttempts).where(and(
      or(eq(bookshelfRateLimitAttempts.userId, input.userId), eq(bookshelfRateLimitAttempts.sourceKey, input.sourceKey)),
      gte(bookshelfRateLimitAttempts.createdAt, input.since),
    ));
    const accountRows = attempts.filter((row) => row.userId === input.userId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const sourceRows = attempts.filter((row) => row.sourceKey === input.sourceKey).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const retryCandidates = [
      ...(accountRows.length >= input.accountLimit ? [accountRows[0].createdAt] : []),
      ...(sourceRows.length >= input.sourceLimit ? [sourceRows[0].createdAt] : []),
    ];
    const limitingAttempt = retryCandidates.sort().at(-1) || input.now;
    return { rateLimited: true, retryAt: new Date(Date.parse(limitingAttempt) + 60_000).toISOString() };
  },

  async cleanup(before) {
    await ensureSchema();
    const attemptsBefore = new Date(Date.parse(before) - 60_000).toISOString();
    const results = await getD1Binding().batch([
      getD1Binding().prepare("DELETE FROM bookshelf_operation_receipts WHERE expires_at <= ?").bind(before),
      getD1Binding().prepare("DELETE FROM bookshelf_rate_limit_attempts WHERE created_at < ?").bind(attemptsBefore),
      getD1Binding().prepare("DELETE FROM bookshelf_list_snapshot_chunks WHERE snapshot_id IN (SELECT id FROM bookshelf_list_snapshots WHERE expires_at <= ?)").bind(before),
      getD1Binding().prepare("DELETE FROM bookshelf_list_snapshots WHERE expires_at <= ?").bind(before),
      getD1Binding().prepare("DELETE FROM bookshelf_list_snapshot_chunks WHERE user_id NOT IN (SELECT id FROM users) OR snapshot_id NOT IN (SELECT id FROM bookshelf_list_snapshots)"),
      getD1Binding().prepare("DELETE FROM bookshelf_list_snapshots WHERE user_id NOT IN (SELECT id FROM users)"),
      getD1Binding().prepare("DELETE FROM bookshelf_entries WHERE user_id NOT IN (SELECT id FROM users)"),
      getD1Binding().prepare("DELETE FROM bookshelf_operation_receipts WHERE user_id NOT IN (SELECT id FROM users)"),
      getD1Binding().prepare("DELETE FROM bookshelf_rate_limit_attempts WHERE user_id NOT IN (SELECT id FROM users)"),
      getD1Binding().prepare("DELETE FROM novel_completion_frontiers WHERE user_id NOT IN (SELECT id FROM users)"),
      getD1Binding().prepare("DELETE FROM reading_progress WHERE user_id NOT IN (SELECT id FROM users)"),
      getD1Binding().prepare("DELETE FROM chapter_completion_records WHERE user_id NOT IN (SELECT id FROM users)"),
      getD1Binding().prepare("DELETE FROM chapter_version_completion_facts WHERE user_id NOT IN (SELECT id FROM users)"),
      getD1Binding().prepare("DELETE FROM reading_progress WHERE chapter_id NOT IN (SELECT id FROM chapters)"),
      getD1Binding().prepare("DELETE FROM chapter_completion_records WHERE chapter_id NOT IN (SELECT id FROM chapters)"),
      getD1Binding().prepare("DELETE FROM chapter_version_completion_facts WHERE chapter_id NOT IN (SELECT id FROM chapters)"),
    ]);
    return {
      receipts: results[0].meta.changes,
      attempts: results[1].meta.changes,
      orphans: results.slice(4).reduce((total, result) => total + result.meta.changes, 0),
    };
  },

  async purge(userId) {
    await ensureSchema();
    const d1 = getD1Binding();
    await d1.batch([
      d1.prepare("DELETE FROM bookshelf_entries WHERE user_id = ?").bind(userId),
      d1.prepare("DELETE FROM novel_completion_frontiers WHERE user_id = ?").bind(userId),
      d1.prepare("DELETE FROM bookshelf_operation_receipts WHERE user_id = ?").bind(userId),
      d1.prepare("DELETE FROM bookshelf_rate_limit_attempts WHERE user_id = ?").bind(userId),
      d1.prepare("DELETE FROM bookshelf_list_snapshot_chunks WHERE user_id = ?").bind(userId),
      d1.prepare("DELETE FROM bookshelf_list_snapshots WHERE user_id = ?").bind(userId),
      d1.prepare("DELETE FROM reading_progress WHERE user_id = ?").bind(userId),
      d1.prepare("DELETE FROM chapter_completion_records WHERE user_id = ?").bind(userId),
      d1.prepare("DELETE FROM chapter_version_completion_facts WHERE user_id = ?").bind(userId),
    ]);
  },
};

export const bookshelfLifecycle = new BookshelfLifecycle(drizzleD1BookshelfStore, undefined, {
  record(event) { console.log(JSON.stringify({ component: "bookshelf", ...event })); },
});
