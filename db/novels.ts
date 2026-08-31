import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from ".";
import { chapters, novels, novelVersions } from "./schema";
import {
  createBlankNovel,
  normalizeNovel,
  normalizeStory,
  type NovelDocument,
  type NovelRecord,
} from "../lib/story";

export function rowToNovel(row: typeof novels.$inferSelect): NovelRecord {
  return {
    id: row.id,
    slug: row.slug,
    ownerId: row.ownerId,
    format: row.format ?? "serial",
    formatLockedAt: row.formatLockedAt ?? null,
    convertibleTo: null,
    draftStatus: row.draftStatus,
    submittedAt: row.submittedAt,
    reviewNote: row.reviewNote,
    sortOrder: row.sortOrder,
    status: row.status,
    version: row.version,
    draft: normalizeNovel(JSON.parse(row.draftJson)),
    published: row.publishedJson ? normalizeNovel(JSON.parse(row.publishedJson)) : null,
    updatedAt: row.updatedAt,
  };
}

let backfillReady: Promise<void> | null = null;

function legacyNovelId(ownerId: string | null) {
  const safeOwner = ownerId?.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80) || "global";
  return `legacy-novel-${safeOwner}`;
}

function novelFromStory(storyJson: string): NovelDocument {
  const story = normalizeStory(JSON.parse(storyJson));
  const novel = createBlankNovel();
  novel.name = story.title || novel.name;
  novel.summary = story.summary;
  novel.coverAssetId = story.openingImageAssetId || story.coverAssetId;
  novel.coverUrl = story.openingImageUrl || story.coverUrl;
  novel.coverAlt = story.openingImageAlt || story.coverAlt;
  novel.coverPresentation = story.openingImagePresentation;
  return novel;
}

async function backfillLegacyNovels() {
  const db = getDb();
  const legacyRows = await db.select().from(chapters)
    .where(eq(chapters.novelId, "legacy-global"))
    .orderBy(asc(chapters.sortOrder), asc(chapters.createdAt));
  const owners = new Map<string, typeof legacyRows>();
  for (const row of legacyRows) {
    const key = row.ownerId ?? "__global__";
    owners.set(key, [...(owners.get(key) ?? []), row]);
  }
  for (const rows of owners.values()) {
    const first = rows[0];
    if (!first) continue;
    const id = legacyNovelId(first.ownerId);
    const existing = await db.select({ id: novels.id }).from(novels).where(eq(novels.id, id)).limit(1);
    if (!existing[0]) {
      const draft = novelFromStory(first.draftJson);
      const firstPublished = rows.find((row) => row.status === "published" && row.publishedJson);
      const published = firstPublished?.publishedJson ? novelFromStory(firstPublished.publishedJson) : null;
      await db.insert(novels).values({
        id,
        slug: `legacy-${first.slug}`.slice(0, 100),
        ownerId: first.ownerId,
        sortOrder: first.sortOrder,
        status: published ? "published" : "draft",
        draftJson: JSON.stringify(draft),
        publishedJson: published ? JSON.stringify(published) : null,
        version: published ? 1 : 0,
      });
      if (published) {
        await db.insert(novelVersions).values({
          novelId: id,
          version: 1,
          snapshotJson: JSON.stringify(published),
        });
      }
    }
    if (first.ownerId) {
      await db.update(chapters).set({ novelId: id })
        .where(and(eq(chapters.novelId, "legacy-global"), eq(chapters.ownerId, first.ownerId)));
    } else {
      await db.update(chapters).set({ novelId: id })
        .where(and(eq(chapters.novelId, "legacy-global"), isNull(chapters.ownerId)));
    }
  }
}

export function ensureLegacyNovels() {
  if (!backfillReady) {
    backfillReady = backfillLegacyNovels().catch((error) => {
      backfillReady = null;
      throw error;
    });
  }
  return backfillReady;
}
