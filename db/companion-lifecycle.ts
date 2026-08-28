import { and, desc, eq } from "drizzle-orm";
import { ensureSchema, getD1Binding, getDb } from ".";
import {
  chapterVersionCompletionFacts, chapters, chapterVersions, companionActivityWindows, companionDiscoveries,
  companionProfiles, companionRewardReceipts,
} from "./schema";
import { normalizeStory } from "../lib/story";
import {
  CompanionLifecycle,
  type CompanionProfileRecord,
  type CompanionStore,
} from "../lib/companion-lifecycle";

function profileRecord(row: typeof companionProfiles.$inferSelect): CompanionProfileRecord {
  return {
    userId: row.userId,
    revision: row.revision,
    bondXp: row.bondXp,
    vitality: row.vitality,
    mistlight: row.mistlight,
    lastSeenAt: row.lastSeenAt,
    lastTouchAt: row.lastTouchAt,
    lastRestAt: row.lastRestAt,
    rewardBaselineAt: row.rewardBaselineAt,
    equippedAppearance: row.equippedAppearance,
    equippedGarden: row.equippedGarden,
    updatedAt: row.updatedAt,
  };
}

export const drizzleD1CompanionStore: CompanionStore = {
  async readProfile(userId) {
    await ensureSchema();
    const row = (await getDb().select().from(companionProfiles)
      .where(eq(companionProfiles.userId, userId)).limit(1))[0];
    return row ? profileRecord(row) : null;
  },
  async readReceipt(userId, key) {
    await ensureSchema();
    const row = (await getDb().select().from(companionRewardReceipts).where(and(
      eq(companionRewardReceipts.userId, userId),
      eq(companionRewardReceipts.receiptKey, key),
    )).limit(1))[0];
    return row ? { key: row.receiptKey, kind: row.kind, resultJson: row.resultJson, createdAt: row.createdAt } : null;
  },
  async listCompletionFacts(userId) {
    await ensureSchema();
    return (await getDb().select({
      chapterId: chapterVersionCompletionFacts.chapterId,
      chapterVersion: chapterVersionCompletionFacts.chapterVersion,
      completedAt: chapterVersionCompletionFacts.completedAt,
      recordedAt: chapterVersionCompletionFacts.recordedAt,
    }).from(chapterVersionCompletionFacts).where(eq(chapterVersionCompletionFacts.userId, userId)));
  },
  async listActivityFacts(userId) {
    await ensureSchema();
    return (await getDb().select().from(companionActivityWindows)
      .where(eq(companionActivityWindows.userId, userId))).map((row) => ({
      date: row.activityDate, seconds: row.seconds, operationId: row.operationId, recordedAt: row.recordedAt,
    }));
  },
  async listDiscoveryFacts(userId) {
    await ensureSchema();
    return (await getDb().select().from(companionDiscoveries)
      .where(eq(companionDiscoveries.userId, userId))).map((row) => ({
      chapterId: row.chapterId, chapterVersion: row.chapterVersion, nodeId: row.nodeId, recordedAt: row.recordedAt,
    }));
  },
  async listMemoryCards(userId) {
    await ensureSchema();
    const result = await getD1Binding().prepare(`SELECT f.chapter_id AS chapterId,
        f.chapter_version AS chapterVersion, f.completed_at AS completedAt,
        COALESCE(json_extract(v.snapshot_json, '$.title'), json_extract(c.published_json, '$.title'), c.title) AS chapterTitle,
        COALESCE(json_extract(n.published_json, '$.name'), '未知作品') AS novelName,
        COALESCE(json_extract(n.published_json, '$.coverUrl'), '') AS coverUrl,
        COALESCE(json_extract(n.published_json, '$.coverAlt'), '小说封面') AS coverAlt
      FROM chapter_version_completion_facts f
      JOIN chapters c ON c.id = f.chapter_id
      JOIN novels n ON n.id = c.novel_id
      LEFT JOIN chapter_versions v ON v.chapter_id = f.chapter_id AND v.version = f.chapter_version
      JOIN companion_profiles p ON p.user_id = f.user_id
      WHERE f.user_id = ? AND (p.reward_baseline_at IS NULL OR f.recorded_at > p.reward_baseline_at)
      ORDER BY f.completed_at DESC LIMIT 50`).bind(userId).all<{
        chapterId: string; chapterVersion: number; completedAt: string; chapterTitle: string;
        novelName: string; coverUrl: string; coverAlt: string;
      }>();
    return result.results;
  },
  async listRecentReceipts(userId) {
    await ensureSchema();
    return (await getDb().select().from(companionRewardReceipts)
      .where(eq(companionRewardReceipts.userId, userId))
      .orderBy(desc(companionRewardReceipts.createdAt)).limit(10)).map((row) => ({
      key: row.receiptKey, kind: row.kind, resultJson: row.resultJson, createdAt: row.createdAt,
    }));
  },
  async hasReadingOperation(userId, operationId) {
    await ensureSchema();
    return Boolean((await getDb().select({ id: companionActivityWindows.id }).from(companionActivityWindows).where(and(
      eq(companionActivityWindows.userId, userId), eq(companionActivityWindows.operationId, operationId),
    )).limit(1))[0]);
  },
  async readLastActivityAt(userId) {
    await ensureSchema();
    const row = (await getDb().select({ recordedAt: companionActivityWindows.recordedAt }).from(companionActivityWindows)
      .where(eq(companionActivityWindows.userId, userId))
      .orderBy(desc(companionActivityWindows.recordedAt)).limit(1))[0];
    return row?.recordedAt ?? null;
  },
  async readPublishedChapter(chapterId, chapterVersion) {
    await ensureSchema();
    const row = (await getDb().select().from(chapters).where(and(
      eq(chapters.id, chapterId), eq(chapters.status, "published"), eq(chapters.version, chapterVersion),
    )).limit(1))[0];
    if (!row?.publishedJson) return null;
    const story = normalizeStory(JSON.parse(row.publishedJson));
    return { nodeIds: story.nodes.map((node) => node.id) };
  },
  async readChapterVersion(chapterId, chapterVersion) {
    await ensureSchema();
    const version = (await getDb().select({ snapshotJson: chapterVersions.snapshotJson }).from(chapterVersions).where(and(
      eq(chapterVersions.chapterId, chapterId), eq(chapterVersions.version, chapterVersion),
    )).limit(1))[0];
    if (version) return { nodeIds: normalizeStory(JSON.parse(version.snapshotJson)).nodes.map((node) => node.id) };
    return this.readPublishedChapter(chapterId, chapterVersion);
  },
  async recordReadingFacts(input) {
    await ensureSchema();
    const d1 = getD1Binding();
    const result = await d1.prepare(`INSERT INTO companion_activity_windows
        (id, user_id, activity_date, chapter_id, chapter_version, seconds, operation_id, recorded_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (
          SELECT 1 FROM companion_activity_windows
          WHERE user_id = ? AND julianday(recorded_at) >= julianday(?) - (1.0 / 86400.0)
        ) ON CONFLICT(user_id, operation_id) DO NOTHING`)
        .bind(`${input.userId}:${input.operationId}`, input.userId, input.date, input.chapterId,
          input.chapterVersion, input.seconds, input.operationId, input.recordedAt,
          input.userId, input.recordedAt).run();
    return Number(result.meta.changes ?? 0) === 1 ? "applied" : "duplicate";
  },
  async recordDiscoveryFact(input) {
    await ensureSchema();
    const result = await getD1Binding().prepare(`INSERT INTO companion_discoveries
      (id, user_id, chapter_id, chapter_version, node_id, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, chapter_id, chapter_version, node_id) DO NOTHING`)
      .bind(`${input.userId}:${input.chapterId}:${input.chapterVersion}:${input.nodeId}`, input.userId,
        input.chapterId, input.chapterVersion, input.nodeId, input.recordedAt).run();
    return Number(result.meta.changes ?? 0) === 1 ? "applied" : "duplicate";
  },
  async commit(input) {
    await ensureSchema();
    if (input.receipt && await this.readReceipt(input.userId, input.receipt.key)) return "duplicate";
    const next = input.next;
    const commitToken = crypto.randomUUID();
    const values = [
      next.bondXp, next.vitality, next.mistlight, next.lastSeenAt, next.lastTouchAt,
      next.lastRestAt, next.rewardBaselineAt, next.equippedAppearance, next.equippedGarden, next.updatedAt,
    ] as const;
    const d1 = getD1Binding();
    const profileStatement = input.expectedRevision === null
      ? d1.prepare(`INSERT INTO companion_profiles
        (user_id, revision, commit_token, bond_xp, vitality, mistlight, last_seen_at, last_touch_at, last_rest_at,
          reward_baseline_at, equipped_appearance, equipped_garden, updated_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM companion_profiles WHERE user_id = ?)`)
        .bind(input.userId, next.revision, commitToken, ...values, input.userId)
      : d1.prepare(`UPDATE companion_profiles SET revision = ?, commit_token = ?, bond_xp = ?, vitality = ?, mistlight = ?,
          last_seen_at = ?, last_touch_at = ?, last_rest_at = ?, reward_baseline_at = ?,
          equipped_appearance = ?, equipped_garden = ?, updated_at = ?
        WHERE user_id = ? AND revision = ?
          AND NOT EXISTS (SELECT 1 FROM companion_reward_receipts WHERE user_id = ? AND receipt_key = ?)`)
        .bind(next.revision, commitToken, ...values, input.userId, input.expectedRevision, input.userId, input.receipt?.key ?? "");
    const statements = [profileStatement];
    if (input.receipt) {
      statements.push(d1.prepare(`INSERT INTO companion_reward_receipts
        (id, user_id, receipt_key, kind, result_json, created_at)
        SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (
          SELECT 1 FROM companion_profiles WHERE user_id = ? AND commit_token = ?
        ) AND NOT EXISTS (
          SELECT 1 FROM companion_reward_receipts WHERE user_id = ? AND receipt_key = ?
        )`).bind(
        `${input.userId}:${input.receipt.key}`, input.userId, input.receipt.key, input.receipt.kind,
        input.receipt.resultJson, input.receipt.createdAt, input.userId, commitToken,
        input.userId, input.receipt.key,
      ));
    }
    const results = await d1.batch(statements);
    if (Number(results[0]?.meta.changes ?? 0) === 1) return "applied";
    if (input.receipt && await this.readReceipt(input.userId, input.receipt.key)) return "duplicate";
    return "conflict";
  },
  async export(userId) {
    await ensureSchema();
    const [profile, receipts, completionFacts, activityFacts, discoveryFacts] = await Promise.all([
      this.readProfile(userId),
      getDb().select({
        key: companionRewardReceipts.receiptKey,
        kind: companionRewardReceipts.kind,
        result: companionRewardReceipts.resultJson,
        createdAt: companionRewardReceipts.createdAt,
      }).from(companionRewardReceipts).where(eq(companionRewardReceipts.userId, userId)),
      this.listCompletionFacts(userId),
      this.listActivityFacts(userId),
      this.listDiscoveryFacts(userId),
    ]);
    return { profile, receipts, completionFacts, activityFacts, discoveryFacts };
  },
  async reset(input) {
    await ensureSchema();
    const commitToken = crypto.randomUUID();
    const d1 = getD1Binding();
    const results = await d1.batch([
      d1.prepare(`DELETE FROM companion_activity_windows WHERE user_id = ? AND EXISTS (
        SELECT 1 FROM companion_profiles WHERE user_id = ? AND revision = ?
      )`).bind(input.userId, input.userId, input.expectedRevision),
      d1.prepare(`DELETE FROM companion_discoveries WHERE user_id = ? AND EXISTS (
        SELECT 1 FROM companion_profiles WHERE user_id = ? AND revision = ?
      )`).bind(input.userId, input.userId, input.expectedRevision),
      d1.prepare(`DELETE FROM companion_reward_receipts WHERE user_id = ? AND EXISTS (
        SELECT 1 FROM companion_profiles WHERE user_id = ? AND revision = ?
      )`).bind(input.userId, input.userId, input.expectedRevision),
      d1.prepare(`UPDATE companion_profiles SET revision = ?, commit_token = ?, bond_xp = ?, vitality = ?,
          mistlight = ?, last_seen_at = ?, last_touch_at = ?, last_rest_at = ?, reward_baseline_at = ?,
          equipped_appearance = ?, equipped_garden = ?, updated_at = ?
        WHERE user_id = ? AND revision = ?`)
        .bind(
          input.next.revision, commitToken, input.next.bondXp, input.next.vitality, input.next.mistlight,
          input.next.lastSeenAt, input.next.lastTouchAt, input.next.lastRestAt, input.next.rewardBaselineAt,
          input.next.equippedAppearance, input.next.equippedGarden, input.next.updatedAt,
          input.userId, input.expectedRevision,
        ),
    ]);
    return Number(results[3]?.meta.changes ?? 0) === 1 ? "applied" : "conflict";
  },
  async purge(userId) {
    await ensureSchema();
    const d1 = getD1Binding();
    await d1.batch([
      d1.prepare("DELETE FROM companion_activity_windows WHERE user_id = ?").bind(userId),
      d1.prepare("DELETE FROM companion_discoveries WHERE user_id = ?").bind(userId),
      d1.prepare("DELETE FROM companion_reward_receipts WHERE user_id = ?").bind(userId),
      d1.prepare("DELETE FROM companion_profiles WHERE user_id = ?").bind(userId),
    ]);
  },
  async cleanup() {
    await ensureSchema();
    const d1 = getD1Binding();
    await d1.batch([
      d1.prepare("DELETE FROM companion_activity_windows WHERE user_id NOT IN (SELECT id FROM users)"),
      d1.prepare("DELETE FROM companion_discoveries WHERE user_id NOT IN (SELECT id FROM users)"),
      d1.prepare("DELETE FROM companion_reward_receipts WHERE user_id NOT IN (SELECT id FROM users)"),
      d1.prepare("DELETE FROM companion_profiles WHERE user_id NOT IN (SELECT id FROM users)"),
    ]);
  },
};

export const companionLifecycle = new CompanionLifecycle(drizzleD1CompanionStore);
