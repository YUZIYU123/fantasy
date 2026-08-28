import { createAccountLifecycle, MockAuthMailer, MockTurnstileVerifier } from "../db/account-lifecycle";
import { accountRegistrationConfigFrom } from "../db/account-runtime";
import { acceptsTurnstileResult } from "../db/account-providers";
import { drizzleD1AccountStore } from "../db/account-store";
import { d1AccountRateLimiter } from "../db/rate-limit";
import { MockRegistrationTelemetry } from "../lib/registration-telemetry";
import { AssetLifecycleError, assetLifecycle } from "../db/assets";
import { creationLifecycle } from "../db/creation-lifecycle";
import { readingSessionProgress } from "../db/reading-session-progress";
import { bookshelfLifecycle } from "../db/bookshelf-lifecycle";
import { companionLifecycle, drizzleD1CompanionStore } from "../db/companion-lifecycle";
import { sessionAuthorization } from "../lib/session-authorization";
import { AuthError, hashToken } from "../lib/auth";
import { CompanionLifecycle } from "../lib/companion-lifecycle";
import { createBlankNovel, createBlankStory, createStoryChoice } from "../lib/story";
import { getD1Binding } from "../db";

type TestEnv = { ASSET_BUCKET: R2Bucket };

async function createBookshelfFixture() {
  const author = { kind: "author" as const, id: crypto.randomUUID() };
  const administrator = { kind: "administrator" as const };
  const novelResult = await creationLifecycle.execute(author, { entity: "novel", action: "create" });
  if (novelResult.kind !== "created") throw new Error("小说创建失败");
  const novel = createBlankNovel();
  novel.name = "可靠书架小说"; novel.summary = "验证回执与顺序。";
  novel.coverUrl = "https://example.com/reliable-bookshelf.jpg"; novel.coverAlt = "可靠书架小说封面";
  await creationLifecycle.execute(author, { entity: "novel", action: "submit", id: novelResult.id, novel });
  await creationLifecycle.execute(administrator, { entity: "novel", action: "publish", id: novelResult.id, novel });
  const chapterResult = await creationLifecycle.execute(author, { entity: "chapter", action: "create", meta: { novelId: novelResult.id } });
  if (chapterResult.kind !== "created") throw new Error("章节创建失败");
  const story = createBlankStory();
  story.title = "可靠书架章节"; story.summary = "验证可靠写入。";
  story.openingImageUrl = "https://example.com/reliable-opening.jpg"; story.openingImageAlt = "可靠书架章节开场图";
  story.outroImageUrl = "https://example.com/reliable-outro.jpg"; story.outroImageAlt = "可靠书架章节收尾图";
  story.nodes[0].body = "可靠写入内容。"; story.nodes[0].canEndChapter = true;
  await creationLifecycle.execute(author, { entity: "chapter", action: "submit", id: chapterResult.id, story });
  await creationLifecycle.execute(administrator, { entity: "chapter", action: "publish", id: chapterResult.id, story });
  return { novelId: novelResult.id, chapterId: chapterResult.id, story, author, administrator };
}

const lifecycleWorker = {
  async fetch(request: Request, workerEnv: TestEnv) {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/health") return Response.json({ ok: true });

    if (pathname === "/reading-progress" && request.method === "GET") {
      return Response.json({ progress: await readingSessionProgress.list(crypto.randomUUID()) });
    }

    if (pathname === "/reading-progress-proofs" && request.method === "POST") {
      const actorId = crypto.randomUUID();
      const author = { kind: "author" as const, id: crypto.randomUUID() };
      const administrator = { kind: "administrator" as const };
      const novelResult = await creationLifecycle.execute(author, { entity: "novel", action: "create" });
      if (novelResult.kind !== "created") throw new Error("小说创建失败");
      const novel = createBlankNovel();
      novel.name = "阅读证明小说";
      novel.summary = "验证重读不会覆盖章节完成证明。";
      novel.coverUrl = "https://example.com/proof.jpg";
      novel.coverAlt = "阅读证明小说封面";
      await creationLifecycle.execute(author, { entity: "novel", action: "submit", id: novelResult.id, novel });
      await creationLifecycle.execute(administrator, { entity: "novel", action: "publish", id: novelResult.id, novel });
      const chapterResult = await creationLifecycle.execute(author, {
        entity: "chapter", action: "create", meta: { novelId: novelResult.id },
      });
      if (chapterResult.kind !== "created") throw new Error("章节创建失败");
      const story = createBlankStory();
      story.title = "完成证明章节";
      story.summary = "完成后重读。";
      story.openingImageUrl = "https://example.com/proof-opening.jpg";
      story.openingImageAlt = "完成证明章节开场图";
      story.outroImageUrl = "https://example.com/proof-outro.jpg";
      story.outroImageAlt = "完成证明章节收尾图";
      story.nodes[0].body = "读完以后再次从头阅读。";
      story.nodes[0].canEndChapter = true;
      await creationLifecycle.execute(author, { entity: "chapter", action: "submit", id: chapterResult.id, story });
      await creationLifecycle.execute(administrator, { entity: "chapter", action: "publish", id: chapterResult.id, story });
      const firstCompletedAt = "2026-08-16T01:00:00.000Z";
      await readingSessionProgress.save(actorId, {
        chapterId: chapterResult.id, nodeId: story.startNodeId, pageIndex: 0,
        updatedAt: firstCompletedAt, completed: true,
      });
      const afterCompletion = await readingSessionProgress.readFacts(actorId, chapterResult.id);
      await readingSessionProgress.save(actorId, {
        chapterId: chapterResult.id, nodeId: story.startNodeId, pageIndex: 0,
        updatedAt: "2026-08-16T01:01:00.000Z", completed: false,
      });
      const whileRereading = await readingSessionProgress.readFacts(actorId, chapterResult.id);
      const secondCompletedAt = "2026-08-16T01:02:00.000Z";
      await readingSessionProgress.save(actorId, {
        chapterId: chapterResult.id, nodeId: story.startNodeId, pageIndex: 0,
        updatedAt: secondCompletedAt, completed: true,
      });
      const afterRecompletion = await readingSessionProgress.readFacts(actorId, chapterResult.id);
      const orphanChapterId = crypto.randomUUID();
      await getD1Binding().prepare(`INSERT INTO chapter_completion_records
        (id, user_id, chapter_id, chapter_version, completed_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)`)
        .bind(`${actorId}:${orphanChapterId}`, actorId, orphanChapterId, secondCompletedAt, secondCompletedAt).run();
      const orphanFacts = await readingSessionProgress.readFacts(actorId, orphanChapterId);
      return Response.json({
        afterCompletion: { resumable: Boolean(afterCompletion.resume), completed: Boolean(afterCompletion.completion) },
        whileRereading: { resumable: Boolean(whileRereading.resume), completed: Boolean(whileRereading.completion) },
        afterRecompletion: {
          resumable: Boolean(afterRecompletion.resume), completed: Boolean(afterRecompletion.completion),
          proofRefreshed: afterRecompletion.completion?.completedAt === secondCompletedAt,
        },
        orphanHidden: !orphanFacts.completion && !orphanFacts.resume,
      });
    }

    if (pathname === "/companion-completion-recovery" && request.method === "POST") {
      const actorId = crypto.randomUUID();
      const fixture = await createBookshelfFixture();
      const secondFixture = await createBookshelfFixture();
      let failedRewardAttempts = 0;
      await readingSessionProgress.save(actorId, {
        chapterId: fixture.chapterId,
        nodeId: fixture.story.startNodeId,
        pageIndex: 0,
        updatedAt: "2026-08-28T10:00:00.000Z",
        completed: true,
      });
      const factsAfterFailure = await readingSessionProgress.readFacts(actorId, fixture.chapterId);
      const failingLifecycle = new CompanionLifecycle({
        ...drizzleD1CompanionStore,
        async commit() {
          failedRewardAttempts += 1;
          throw new Error("simulated companion write failure");
        },
      });
      try {
        await failingLifecycle.execute({ kind: "account", id: actorId }, { action: "observe" });
      } catch {}
      const reconciled = await companionLifecycle.execute(
        { kind: "account", id: actorId },
        { action: "observe" },
      );
      await readingSessionProgress.save(actorId, {
        chapterId: fixture.chapterId,
        nodeId: fixture.story.startNodeId,
        pageIndex: 0,
        updatedAt: "2026-08-28T10:01:00.000Z",
        completed: true,
      });
      const replay = await companionLifecycle.execute(
        { kind: "account", id: actorId },
        { action: "observe" },
      );
      const concurrentActorId = crypto.randomUUID();
      await getD1Binding().prepare(`INSERT INTO chapter_version_completion_facts
        (id, user_id, chapter_id, chapter_version, completed_at) VALUES (?, ?, ?, ?, ?)`)
        .bind(`${concurrentActorId}:${fixture.chapterId}:1`, concurrentActorId, fixture.chapterId, 1, "2026-08-28T09:00:00.000Z").run();
      const fixedLifecycle = new CompanionLifecycle(
        drizzleD1CompanionStore,
        () => new Date("2026-08-28T12:00:00.000Z"),
      );
      await fixedLifecycle.execute({ kind: "account", id: concurrentActorId }, { action: "observe" });
      await Promise.all([
        fixedLifecycle.execute({ kind: "account", id: concurrentActorId }, { action: "interact", kind: "play", operationId: "play-a" }),
        fixedLifecycle.execute({ kind: "account", id: concurrentActorId }, { action: "interact", kind: "play", operationId: "play-b" }),
      ]);
      const concurrent = await fixedLifecycle.execute({ kind: "account", id: concurrentActorId }, { action: "observe" });
      const resetActorId = crypto.randomUUID();
      await fixedLifecycle.execute({ kind: "account", id: resetActorId }, { action: "observe" });
      const staleProfile = await drizzleD1CompanionStore.readProfile(resetActorId);
      if (!staleProfile) throw new Error("重置并发测试缺少档案");
      await fixedLifecycle.execute(
        { kind: "account", id: resetActorId },
        { action: "reset", confirmation: "重置小雾成长" },
      );
      const staleResetCommit = await drizzleD1CompanionStore.commit({
        userId: resetActorId,
        expectedRevision: staleProfile.revision,
        next: {
          ...staleProfile,
          revision: staleProfile.revision + 1,
          bondXp: 40,
          mistlight: 20,
          rewardBaselineAt: null,
        },
      });
      const afterStaleResetCommit = await drizzleD1CompanionStore.readProfile(resetActorId);
      const readingActorId = crypto.randomUUID();
      const recordedAt = new Date();
      const readingCommand = {
        action: "record-reading" as const,
        chapterId: fixture.chapterId,
        chapterVersion: 1,
        nodeId: fixture.story.startNodeId,
        windowStartedAt: new Date(recordedAt.getTime() - 60_000).toISOString(),
        operationId: "reading-window-1",
      };
      await companionLifecycle.execute({ kind: "account", id: readingActorId }, {
        action: "record-node", chapterId: fixture.chapterId, chapterVersion: 1, nodeId: fixture.story.startNodeId,
      });
      await companionLifecycle.execute({ kind: "account", id: readingActorId }, readingCommand);
      await companionLifecycle.execute({ kind: "account", id: readingActorId }, readingCommand);
      const readingState = await companionLifecycle.execute({ kind: "account", id: readingActorId }, { action: "observe" });
      let forgedNodeRejected = false;
      try {
        await companionLifecycle.execute({ kind: "account", id: readingActorId }, {
          action: "record-node", chapterId: fixture.chapterId, chapterVersion: 1, nodeId: "forged-node",
        });
      } catch { forgedNodeRejected = true; }
      const racingReaderId = crypto.randomUUID();
      const racingClock = new Date();
      const racingLifecycle = new CompanionLifecycle(drizzleD1CompanionStore, () => racingClock);
      await Promise.allSettled([
        { operationId: "race-a", chapterId: fixture.chapterId, nodeId: fixture.story.startNodeId },
        { operationId: "race-b", chapterId: secondFixture.chapterId, nodeId: secondFixture.story.startNodeId },
      ].map(({ operationId, chapterId, nodeId }) => racingLifecycle.execute(
        { kind: "account", id: racingReaderId },
        {
          ...readingCommand,
          chapterId,
          nodeId,
          windowStartedAt: new Date(racingClock.getTime() - 60_000).toISOString(),
          operationId,
        },
      )));
      const racingExport = await racingLifecycle.execute({ kind: "account", id: racingReaderId }, { action: "export" });
      if (!("growth" in racingExport) || !racingExport.growth) throw new Error("并发心跳导出失败");
      const racingActivityFacts = racingExport.growth.activityFacts as unknown[];
      const staleReadingActorId = crypto.randomUUID();
      await fixedLifecycle.execute({ kind: "account", id: staleReadingActorId }, { action: "observe" });
      await getD1Binding().prepare(`INSERT INTO companion_activity_windows
        (id, user_id, activity_date, chapter_id, chapter_version, seconds, operation_id, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(
          crypto.randomUUID(), staleReadingActorId, "2026-08-28", fixture.chapterId, 1, 300, "stale-window", "2026-08-28T11:59:00.000Z",
        ).run();
      let resetDuringReconcile = false;
      const staleReadingLifecycle = new CompanionLifecycle({
        ...drizzleD1CompanionStore,
        async listActivityFacts(userId) {
          const facts = await drizzleD1CompanionStore.listActivityFacts(userId);
          if (userId === staleReadingActorId && !resetDuringReconcile) {
            resetDuringReconcile = true;
            await fixedLifecycle.execute({ kind: "account", id: userId }, { action: "reset", confirmation: "重置小雾成长" });
          }
          return facts;
        },
      }, () => new Date("2026-08-28T12:00:01.000Z"));
      const staleReadingState = await staleReadingLifecycle.execute(
        { kind: "account", id: staleReadingActorId }, { action: "observe" },
      );
      const memoryActorId = crypto.randomUUID();
      await readingSessionProgress.save(memoryActorId, {
        chapterId: fixture.chapterId, nodeId: fixture.story.startNodeId, pageIndex: 0,
        updatedAt: new Date().toISOString(), completed: true,
      });
      const memoryClock = new Date(Date.now() + 1_000);
      const memoryLifecycle = new CompanionLifecycle(drizzleD1CompanionStore, () => memoryClock);
      const memoryBeforeReset = await memoryLifecycle.execute({ kind: "account", id: memoryActorId }, { action: "observe" });
      await memoryLifecycle.execute({ kind: "account", id: memoryActorId }, { action: "reset", confirmation: "重置小雾成长" });
      const memoryAfterReset = await memoryLifecycle.execute({ kind: "account", id: memoryActorId }, { action: "observe" });
      const historicalExplorerId = crypto.randomUUID();
      const secondVersionStory = structuredClone(fixture.story);
      const secondNode = {
        ...structuredClone(secondVersionStory.nodes[0]),
        id: "historical-second-node",
        title: "历史版本后的新节点",
        choices: [],
        position: { x: 420, y: 50 },
      };
      secondVersionStory.nodes[0].choices = [createStoryChoice({ id: "to-second", label: "继续", targetId: secondNode.id })];
      secondVersionStory.nodes.push(secondNode);
      await creationLifecycle.execute(fixture.administrator, {
        entity: "chapter", action: "publish", id: fixture.chapterId, story: secondVersionStory,
      });
      await companionLifecycle.execute({ kind: "account", id: historicalExplorerId }, {
        action: "record-node", chapterId: fixture.chapterId, chapterVersion: 2, nodeId: fixture.story.startNodeId,
      });
      const thirdVersionStory = structuredClone(secondVersionStory);
      const thirdNode = {
        ...structuredClone(thirdVersionStory.nodes[0]),
        id: "historical-third-node",
        title: "又一个新节点",
        choices: [],
        position: { x: 800, y: 50 },
      };
      thirdVersionStory.nodes[1].choices = [createStoryChoice({ id: "to-third", label: "继续", targetId: thirdNode.id })];
      thirdVersionStory.nodes.push(thirdNode);
      await creationLifecycle.execute(fixture.administrator, {
        entity: "chapter", action: "publish", id: fixture.chapterId, story: thirdVersionStory,
      });
      const historicalExploration = await companionLifecycle.execute(
        { kind: "account", id: historicalExplorerId }, { action: "observe" },
      );
      const historicalRoute = "exploration" in historicalExploration
        ? historicalExploration.exploration?.find((route) => route.chapterId === fixture.chapterId && route.chapterVersion === 2)
        : null;
      if (!("state" in reconciled) || !reconciled.state || !("state" in replay) || !replay.state) {
        throw new Error("雾庭状态补偿失败");
      }
      if (!("state" in concurrent) || !concurrent.state) throw new Error("并发互动状态读取失败");
      return Response.json({
        failedRewardAttempts,
        readingCompleted: Boolean(factsAfterFailure.completion),
        reconciled: { bondXp: reconciled.state.bondXp, mistlight: reconciled.state.mistlight },
        replay: { bondXp: replay.state.bondXp, mistlight: replay.state.mistlight },
        concurrentMistlight: concurrent.state.mistlight,
        resetStaleCommit: staleResetCommit,
        resetBaselinePreserved: Boolean(afterStaleResetCommit?.rewardBaselineAt),
        duplicateWindowMistlight: "state" in readingState ? readingState.state?.mistlight : null,
        forgedNodeRejected,
        concurrentHeartbeatCount: racingActivityFacts.length,
        staleReadingRewardBlocked: "state" in staleReadingState && staleReadingState.state?.mistlight === 0,
        resetMemoryCounts: {
          before: "memories" in memoryBeforeReset ? memoryBeforeReset.memories?.length : null,
          after: "memories" in memoryAfterReset ? memoryAfterReset.memories?.length : null,
        },
        historicalExploration: historicalRoute
          ? { version: historicalRoute.chapterVersion, discovered: historicalRoute.discovered, total: historicalRoute.total }
          : null,
      });
    }

    if (pathname === "/companion-collections" && request.method === "POST") {
      const actorId = crypto.randomUUID();
      const actor = { kind: "account" as const, id: actorId };
      const now = "2026-08-28T12:00:00.000Z";
      const d1 = getD1Binding();
      await d1.batch(Array.from({ length: 5 }, (_, index) => d1.prepare(`INSERT INTO chapter_version_completion_facts
        (id, user_id, chapter_id, chapter_version, completed_at, recorded_at) VALUES (?, ?, ?, 1, ?, ?)`)
        .bind(`${actorId}:collection-${index}:1`, actorId, `collection-${index}`, now, now)));
      const lifecycle = new CompanionLifecycle(drizzleD1CompanionStore, () => new Date(now));
      await lifecycle.execute(actor, { action: "observe" });
      const purchases = await Promise.all([
        lifecycle.execute(actor, { action: "purchase", kind: "appearance", itemId: "starlight-cloak", operationId: "buy-stars-a" }),
        lifecycle.execute(actor, { action: "purchase", kind: "appearance", itemId: "starlight-cloak", operationId: "buy-stars-b" }),
      ]);
      const equipped = await lifecycle.execute(actor, {
        action: "equip", kind: "appearance", itemId: "starlight-cloak", operationId: "equip-stars",
      });
      const replay = await lifecycle.execute(actor, {
        action: "equip", kind: "appearance", itemId: "starlight-cloak", operationId: "equip-stars",
      });
      const exported = await lifecycle.execute(actor, { action: "export" });
      const receiptActorId = crypto.randomUUID();
      const receiptActor = { kind: "account" as const, id: receiptActorId };
      await d1.batch(Array.from({ length: 10 }, (_, index) => d1.prepare(`INSERT INTO chapter_version_completion_facts
        (id, user_id, chapter_id, chapter_version, completed_at, recorded_at) VALUES (?, ?, ?, 1, ?, ?)`)
        .bind(`${receiptActorId}:receipt-${index}:1`, receiptActorId, `receipt-${index}`, now, now)));
      await lifecycle.execute(receiptActor, { action: "observe" });
      const reusedOperation = await Promise.allSettled([
        lifecycle.execute(receiptActor, { action: "purchase", kind: "appearance", itemId: "archive-cloak", operationId: "shared-purchase" }),
        lifecycle.execute(receiptActor, { action: "purchase", kind: "garden", itemId: "glowing-roots", operationId: "shared-purchase" }),
      ]);

      const resetRaceActorId = crypto.randomUUID();
      const resetRaceActor = { kind: "account" as const, id: resetRaceActorId };
      await d1.prepare(`INSERT INTO companion_profiles
        (user_id, revision, bond_xp, vitality, mistlight, last_seen_at, updated_at)
        VALUES (?, 0, 100, 100, 0, ?, ?)`).bind(resetRaceActorId, now, now).run();
      let resetDuringInventoryRead = false;
      const racingStore = {
        ...drizzleD1CompanionStore,
        async listInventory(userId: string) {
          const inventory = await drizzleD1CompanionStore.listInventory(userId);
          if (userId === resetRaceActorId && !resetDuringInventoryRead) {
            resetDuringInventoryRead = true;
            await lifecycle.execute(resetRaceActor, { action: "reset", confirmation: "重置小雾成长" });
          }
          return inventory;
        },
      };
      const racedObservation = await new CompanionLifecycle(racingStore, () => new Date(now))
        .execute(resetRaceActor, { action: "observe" });
      const stranger = { kind: "account" as const, id: crypto.randomUUID() };
      let strangerRejected = false;
      try {
        await lifecycle.execute(stranger, {
          action: "equip", kind: "appearance", itemId: "starlight-cloak", operationId: "stranger-equip",
        });
      } catch { strangerRejected = true; }
      await lifecycle.execute(actor, { action: "reset", confirmation: "重置小雾成长" });
      const resetExport = await lifecycle.execute(actor, { action: "export" });
      const growth = ("growth" in exported ? exported.growth : {}) as Record<string, unknown>;
      const resetGrowth = ("growth" in resetExport ? resetExport.growth : {}) as Record<string, unknown>;
      return Response.json({
        purchaseMistlights: purchases.map((purchase) => "state" in purchase ? purchase.state?.mistlight : null),
        equippedAppearance: "state" in equipped ? equipped.state?.equippedAppearance : null,
        replayAppearance: "state" in replay ? replay.state?.equippedAppearance : null,
        inventory: (growth.inventory as unknown[] | undefined)?.length ?? null,
        reusedOperationSuccesses: reusedOperation.filter((result) => result.status === "fulfilled").length,
        reusedOperationConflicts: reusedOperation.filter((result) => result.status === "rejected" && String(result.reason).includes("操作标识已用于其他收藏请求")).length,
        resetRaceActionCount: "collections" in racedObservation ? racedObservation.collections?.actions.filter((item) => item.owned).length : null,
        strangerRejected,
        resetInventory: (resetGrowth.inventory as unknown[] | undefined)?.length ?? null,
        resetAppearance: (resetGrowth.profile as { equippedAppearance?: string } | undefined)?.equippedAppearance ?? null,
      });
    }

    if (pathname === "/bookshelf-membership" && request.method === "POST") {
      const owner = { kind: "account" as const, id: crypto.randomUUID() };
      const stranger = { kind: "account" as const, id: crypto.randomUUID() };
      const author = { kind: "author" as const, id: crypto.randomUUID() };
      const administrator = { kind: "administrator" as const };
      const novelResult = await creationLifecycle.execute(author, { entity: "novel", action: "create" });
      if (novelResult.kind !== "created") throw new Error("小说创建失败");
      const novel = createBlankNovel();
      novel.name = "书架小说";
      novel.summary = "验证私人书架。";
      novel.coverUrl = "https://example.com/bookshelf.jpg";
      novel.coverAlt = "书架小说封面";
      await creationLifecycle.execute(author, { entity: "novel", action: "submit", id: novelResult.id, novel });
      await creationLifecycle.execute(administrator, { entity: "novel", action: "publish", id: novelResult.id, novel });
      const chapterResult = await creationLifecycle.execute(author, { entity: "chapter", action: "create", meta: { novelId: novelResult.id } });
      if (chapterResult.kind !== "created") throw new Error("章节创建失败");
      const story = createBlankStory();
      story.title = "书架章节";
      story.summary = "可加入的公开章节。";
      story.openingImageUrl = "https://example.com/bookshelf-opening.jpg";
      story.openingImageAlt = "书架章节开场图";
      story.outroImageUrl = "https://example.com/bookshelf-outro.jpg";
      story.outroImageAlt = "书架章节收尾图";
      story.nodes[0].body = "公开内容。";
      story.nodes[0].canEndChapter = true;
      await creationLifecycle.execute(author, { entity: "chapter", action: "submit", id: chapterResult.id, story });
      await creationLifecycle.execute(administrator, { entity: "chapter", action: "publish", id: chapterResult.id, story });
      const first = await bookshelfLifecycle.execute(owner, { action: "add", novelId: novelResult.id, operationId: crypto.randomUUID(), sourceKey: "membership-owner" });
      const repeated = await bookshelfLifecycle.execute(owner, { action: "add", novelId: novelResult.id, operationId: crypto.randomUUID(), sourceKey: "membership-owner" });
      const ownerList = await bookshelfLifecycle.execute(owner, { action: "list" });
      const strangerList = await bookshelfLifecycle.execute(stranger, { action: "list" });
      let unavailableStatus = 0;
      try {
        await bookshelfLifecycle.execute(owner, { action: "add", novelId: crypto.randomUUID(), operationId: crypto.randomUUID(), sourceKey: "membership-owner" });
      } catch (error) {
        if (!(error instanceof Error) || !("status" in error)) throw error;
        unavailableStatus = Number(error.status);
      }
      return Response.json({
        first: first.kind, repeated: repeated.kind,
        ownerCount: "items" in ownerList ? ownerList.items.length : -1,
        strangerCount: "items" in strangerList ? strangerList.items.length : -1,
        unavailableStatus,
      });
    }

    if (pathname === "/bookshelf-removal" && request.method === "POST") {
      const actor = { kind: "account" as const, id: crypto.randomUUID() };
      const author = { kind: "author" as const, id: crypto.randomUUID() };
      const administrator = { kind: "administrator" as const };
      const novelResult = await creationLifecycle.execute(author, { entity: "novel", action: "create" });
      if (novelResult.kind !== "created") throw new Error("小说创建失败");
      const novel = createBlankNovel();
      novel.name = "移出小说"; novel.summary = "验证移出。";
      novel.coverUrl = "https://example.com/remove.jpg"; novel.coverAlt = "移出小说封面";
      await creationLifecycle.execute(author, { entity: "novel", action: "submit", id: novelResult.id, novel });
      await creationLifecycle.execute(administrator, { entity: "novel", action: "publish", id: novelResult.id, novel });
      const chapterResult = await creationLifecycle.execute(author, { entity: "chapter", action: "create", meta: { novelId: novelResult.id } });
      if (chapterResult.kind !== "created") throw new Error("章节创建失败");
      const story = createBlankStory();
      story.title = "移出章节"; story.summary = "保留进度。";
      story.openingImageUrl = "https://example.com/remove-opening.jpg"; story.openingImageAlt = "移出章节开场图";
      story.outroImageUrl = "https://example.com/remove-outro.jpg"; story.outroImageAlt = "移出章节收尾图";
      story.nodes[0].body = "进度内容。"; story.nodes[0].canEndChapter = true;
      await creationLifecycle.execute(author, { entity: "chapter", action: "submit", id: chapterResult.id, story });
      await creationLifecycle.execute(administrator, { entity: "chapter", action: "publish", id: chapterResult.id, story });
      await bookshelfLifecycle.execute(actor, { action: "add", novelId: novelResult.id, operationId: crypto.randomUUID(), sourceKey: "removal-actor" });
      await readingSessionProgress.save(actor.id, {
        chapterId: chapterResult.id, nodeId: story.startNodeId, pageIndex: 0,
        updatedAt: "2026-08-16T02:00:00.000Z", completed: false,
      });
      const first = await bookshelfLifecycle.execute(actor, { action: "remove", novelId: novelResult.id, operationId: crypto.randomUUID(), sourceKey: "removal-actor" });
      const repeated = await bookshelfLifecycle.execute(actor, { action: "remove", novelId: novelResult.id, operationId: crypto.randomUUID(), sourceKey: "removal-actor" });
      const list = await bookshelfLifecycle.execute(actor, { action: "list" });
      const facts = await readingSessionProgress.readFacts(actor.id, chapterResult.id);
      return Response.json({
        first: first.kind, repeated: repeated.kind,
        remaining: "items" in list ? list.items.length : -1,
        resumePreserved: Boolean(facts.resume),
      });
    }

    if (pathname === "/bookshelf-operation-order" && request.method === "POST") {
      const actor = { kind: "account" as const, id: crypto.randomUUID() };
      const fixture = await createBookshelfFixture();
      const sourceKey = `source-${crypto.randomUUID()}`;
      const addOperation = crypto.randomUUID();
      const removeOperation = crypto.randomUUID();
      await bookshelfLifecycle.execute(actor, {
        action: "add", novelId: fixture.novelId, operationId: addOperation, sourceKey,
      });
      await bookshelfLifecycle.execute(actor, {
        action: "remove", novelId: fixture.novelId, operationId: removeOperation, sourceKey,
      });
      const replay = await bookshelfLifecycle.execute(actor, {
        action: "add", novelId: fixture.novelId, operationId: addOperation, sourceKey,
      });
      const result = await bookshelfLifecycle.execute(actor, { action: "result", operationId: addOperation });
      const storedReceipt = await getD1Binding().prepare(`SELECT operation_id AS operationDigest
        FROM bookshelf_operation_receipts WHERE user_id = ? AND action = 'add' AND novel_id = ? LIMIT 1`)
        .bind(actor.id, fixture.novelId).first<{ operationDigest: string }>();
      const membership = await bookshelfLifecycle.execute(actor, { action: "membership", novelId: fixture.novelId });
      const unavailableOperation = crypto.randomUUID();
      let unavailableStatus = 0;
      try {
        await bookshelfLifecycle.execute(actor, {
          action: "add", novelId: crypto.randomUUID(), operationId: unavailableOperation, sourceKey,
        });
      } catch (error) {
        if (!(error instanceof Error) || !("status" in error)) throw error;
        unavailableStatus = Number(error.status);
      }
      const unavailableResult = await bookshelfLifecycle.execute(actor, { action: "result", operationId: unavailableOperation });
      let mismatchStatus = 0;
      try {
        await bookshelfLifecycle.execute(actor, {
          action: "remove", novelId: fixture.novelId, operationId: addOperation, sourceKey,
        });
      } catch (error) {
        if (!(error instanceof Error) || !("status" in error)) throw error;
        mismatchStatus = Number(error.status);
      }
      let rateLimited = 0;
      for (let index = 0; index < 27; index += 1) {
        await bookshelfLifecycle.execute(actor, {
          action: "remove", novelId: fixture.novelId, operationId: crypto.randomUUID(), sourceKey,
        });
      }
      try {
        await bookshelfLifecycle.execute(actor, {
          action: "add", novelId: fixture.novelId, operationId: crypto.randomUUID(), sourceKey,
        });
      } catch (error) {
        if (!(error instanceof Error) || !("status" in error)) throw error;
        rateLimited = Number(error.status);
      }
      const concurrentActor = { kind: "account" as const, id: crypto.randomUUID() };
      const concurrentResults = await Promise.all(Array.from({ length: 31 }, async () => {
        try {
          await bookshelfLifecycle.execute(concurrentActor, {
            action: "remove", novelId: fixture.novelId, operationId: crypto.randomUUID(), sourceKey: `concurrent-${concurrentActor.id}`,
          });
          return 200;
        } catch (error) {
          if (!(error instanceof Error) || !("status" in error)) throw error;
          return Number(error.status);
        }
      }));
      const orphanUserId = crypto.randomUUID();
      const orphanSnapshotId = crypto.randomUUID();
      await getD1Binding().batch([
        getD1Binding().prepare(`INSERT INTO bookshelf_list_snapshots (id, user_id, total, expires_at)
          VALUES (?, ?, 1, '2099-01-01T00:00:00.000Z')`).bind(orphanSnapshotId, orphanUserId),
        getD1Binding().prepare(`INSERT INTO bookshelf_list_snapshot_chunks
          (id, snapshot_id, user_id, chunk_index, entry_ids_json) VALUES (?, ?, ?, 0, '[]')`)
          .bind(`${orphanSnapshotId}:0`, orphanSnapshotId, orphanUserId),
      ]);
      await bookshelfLifecycle.execute({ kind: "system" }, { action: "cleanup" });
      const orphanSnapshots = await getD1Binding().prepare(`SELECT
        (SELECT COUNT(*) FROM bookshelf_list_snapshots WHERE user_id = ?) +
        (SELECT COUNT(*) FROM bookshelf_list_snapshot_chunks WHERE user_id = ?) AS count`)
        .bind(orphanUserId, orphanUserId).first<{ count: number }>();
      return Response.json({
        replayed: "replayed" in replay && replay.replayed === true,
        receiptStatus: "status" in result ? result.status : null,
        operationDigestLength: storedReceipt?.operationDigest.length ?? 0,
        operationStoredRaw: storedReceipt?.operationDigest === addOperation,
        unavailableStatus,
        unavailableReceiptStatus: "status" in unavailableResult ? unavailableResult.status : null,
        finalPresent: "present" in membership ? membership.present : null,
        mismatchStatus, rateLimited,
        concurrentAccepted: concurrentResults.filter((status) => status === 200).length,
        concurrentLimited: concurrentResults.filter((status) => status === 429).length,
        orphanSnapshotCount: orphanSnapshots?.count ?? -1,
      });
    }

    if (pathname === "/bookshelf-update-frontier" && request.method === "POST") {
      const actor = { kind: "account" as const, id: crypto.randomUUID() };
      const fixture = await createBookshelfFixture();
      await bookshelfLifecycle.execute(actor, { action: "add", novelId: fixture.novelId, operationId: crypto.randomUUID(), sourceKey: "frontier-actor" });
      await readingSessionProgress.save(actor.id, {
        chapterId: fixture.chapterId, nodeId: fixture.story.startNodeId, pageIndex: 0,
        updatedAt: "2026-08-16T04:00:00.000Z", completed: true,
      });
      const nextChapter = await creationLifecycle.execute(fixture.author, {
        entity: "chapter", action: "create", meta: { novelId: fixture.novelId },
      });
      if (nextChapter.kind !== "created") throw new Error("新章节创建失败");
      const story = createBlankStory();
      story.title = "后来发布的章节"; story.summary = "应显示有更新。";
      story.openingImageUrl = "https://example.com/new-opening.jpg"; story.openingImageAlt = "后来发布章节开场图";
      story.outroImageUrl = "https://example.com/new-outro.jpg"; story.outroImageAlt = "后来发布章节收尾图";
      story.nodes[0].body = "新章节内容。"; story.nodes[0].canEndChapter = true;
      await creationLifecycle.execute(fixture.author, { entity: "chapter", action: "submit", id: nextChapter.id, story });
      await creationLifecycle.execute(fixture.administrator, { entity: "chapter", action: "publish", id: nextChapter.id, story });
      const page = await bookshelfLifecycle.execute(actor, { action: "list" });
      return Response.json({ status: "items" in page ? page.items[0]?.status : null });
    }

    if (pathname === "/creation" && request.method === "POST") {
      const owner = { kind: "author" as const, id: crypto.randomUUID() };
      const stranger = { kind: "author" as const, id: crypto.randomUUID() };
      const created = await creationLifecycle.execute(owner, { entity: "novel", action: "create" });
      const [ownerNovels, strangerNovels] = await Promise.all([
        creationLifecycle.list(owner, "novel"),
        creationLifecycle.list(stranger, "novel"),
      ]);
      return Response.json({
        created,
        ownerIds: ownerNovels.map((novel) => novel.id),
        strangerIds: strangerNovels.map((novel) => novel.id),
      });
    }

    if (pathname === "/creation-matrix" && request.method === "POST") {
      const author = { kind: "author" as const, id: crypto.randomUUID() };
      const administrator = { kind: "administrator" as const };
      const novelActions: string[] = [];
      const novelCreated = await creationLifecycle.execute(author, { entity: "novel", action: "create" });
      if (novelCreated.kind !== "created") throw new Error("小说创建失败");
      novelActions.push("create");
      const novel = createBlankNovel();
      novel.name = "Module 小说";
      novel.summary = "通过 CreationLifecycle 公开接口验证完整转换矩阵。";
      novel.coverUrl = "https://example.com/novel.jpg";
      novel.coverAlt = "Module 小说封面";
      await creationLifecycle.execute(author, { entity: "novel", action: "save", id: novelCreated.id, novel });
      novelActions.push("save");
      const novelCopy = await creationLifecycle.execute(author, { entity: "novel", action: "duplicate", id: novelCreated.id });
      if (novelCopy.kind !== "created") throw new Error("小说复制失败");
      novelActions.push("duplicate");
      await creationLifecycle.execute(author, { entity: "novel", action: "delete", id: novelCopy.id });
      novelActions.push("delete");
      await creationLifecycle.execute(author, { entity: "novel", action: "submit", id: novelCreated.id, novel });
      novelActions.push("submit");
      await creationLifecycle.execute(author, { entity: "novel", action: "withdraw", id: novelCreated.id });
      novelActions.push("withdraw");
      await creationLifecycle.execute(author, { entity: "novel", action: "submit", id: novelCreated.id, novel });
      novelActions.push("submit");
      await creationLifecycle.execute(administrator, { entity: "novel", action: "reject", id: novelCreated.id, meta: { reviewNote: "补充说明" } });
      novelActions.push("reject");
      await creationLifecycle.execute(author, { entity: "novel", action: "submit", id: novelCreated.id, novel });
      novelActions.push("submit");
      await creationLifecycle.execute(administrator, { entity: "novel", action: "publish", id: novelCreated.id, novel });
      novelActions.push("publish");
      await creationLifecycle.execute(administrator, { entity: "novel", action: "offline", id: novelCreated.id });
      novelActions.push("offline");
      await creationLifecycle.execute(administrator, { entity: "novel", action: "rollback", id: novelCreated.id, version: 1 });
      novelActions.push("rollback");

      const chapterActions: string[] = [];
      const chapterCreated = await creationLifecycle.execute(author, {
        entity: "chapter", action: "create", meta: { novelId: novelCreated.id },
      });
      if (chapterCreated.kind !== "created") throw new Error("章节创建失败");
      chapterActions.push("create");
      const story = createBlankStory();
      story.title = "Module 章节";
      story.summary = "通过 CreationLifecycle 公开接口验证完整转换矩阵。";
      story.openingImageUrl = "https://example.com/opening.jpg";
      story.openingImageAlt = "章节开场图";
      story.outroImageUrl = "https://example.com/outro.jpg";
      story.outroImageAlt = "章节收尾图";
      story.nodes[0].body = "可发布的章节正文。";
      story.nodes[0].canEndChapter = true;
      await creationLifecycle.execute(author, { entity: "chapter", action: "save", id: chapterCreated.id, story });
      chapterActions.push("save");
      const chapterCopy = await creationLifecycle.execute(author, { entity: "chapter", action: "duplicate", id: chapterCreated.id });
      if (chapterCopy.kind !== "created") throw new Error("章节复制失败");
      chapterActions.push("duplicate");
      await creationLifecycle.execute(author, { entity: "chapter", action: "delete", id: chapterCopy.id });
      chapterActions.push("delete");
      await creationLifecycle.execute(author, { entity: "chapter", action: "submit", id: chapterCreated.id, story });
      chapterActions.push("submit");
      await creationLifecycle.execute(author, { entity: "chapter", action: "withdraw", id: chapterCreated.id });
      chapterActions.push("withdraw");
      await creationLifecycle.execute(author, { entity: "chapter", action: "submit", id: chapterCreated.id, story });
      chapterActions.push("submit");
      await creationLifecycle.execute(administrator, { entity: "chapter", action: "reject", id: chapterCreated.id, meta: { reviewNote: "补充结局" } });
      chapterActions.push("reject");
      await creationLifecycle.execute(author, { entity: "chapter", action: "submit", id: chapterCreated.id, story });
      chapterActions.push("submit");
      await creationLifecycle.execute(administrator, { entity: "chapter", action: "publish", id: chapterCreated.id, story });
      chapterActions.push("publish");
      await creationLifecycle.execute(administrator, { entity: "chapter", action: "offline", id: chapterCreated.id });
      chapterActions.push("offline");
      await creationLifecycle.execute(administrator, { entity: "novel", action: "offline", id: novelCreated.id });
      let chapterRollbackWithOfflineParentStatus = 0;
      try {
        await creationLifecycle.execute(administrator, { entity: "chapter", action: "rollback", id: chapterCreated.id, version: 1 });
      } catch (error) {
        if (!(error instanceof Error) || !("status" in error)) throw error;
        chapterRollbackWithOfflineParentStatus = Number(error.status);
      }
      await creationLifecycle.execute(administrator, { entity: "novel", action: "rollback", id: novelCreated.id, version: 1 });
      await creationLifecycle.execute(administrator, { entity: "chapter", action: "rollback", id: chapterCreated.id, version: 1 });
      chapterActions.push("rollback");
      const [novelVersions, chapterVersions] = await Promise.all([
        creationLifecycle.listVersions(administrator, "novel", novelCreated.id),
        creationLifecycle.listVersions(administrator, "chapter", chapterCreated.id),
      ]);
      return Response.json({
        novelActions, chapterActions,
        novelVersions: novelVersions.map((version) => version.version),
        chapterVersions: chapterVersions.map((version) => version.version),
        chapterRollbackWithOfflineParentStatus,
      });
    }

    if (pathname === "/creation-rejections" && request.method === "POST") {
      const owner = { kind: "author" as const, id: crypto.randomUUID() };
      const stranger = { kind: "author" as const, id: crypto.randomUUID() };
      const administrator = { kind: "administrator" as const };
      const statusOf = async (operation: () => Promise<unknown>) => {
        try {
          await operation();
          return 200;
        } catch (error) {
          if (!(error instanceof Error) || !("status" in error)) throw error;
          return Number(error.status);
        }
      };
      const created = await creationLifecycle.execute(owner, { entity: "novel", action: "create" });
      if (created.kind !== "created") throw new Error("小说创建失败");
      const novel = createBlankNovel();
      novel.name = "拒绝矩阵小说";
      novel.summary = "验证越权和非法状态转换。";
      novel.coverUrl = "https://example.com/rejections.jpg";
      novel.coverAlt = "拒绝矩阵小说封面";
      const crossOwnerSave = await statusOf(() => creationLifecycle.execute(stranger, { entity: "novel", action: "save", id: created.id, novel }));
      const crossOwnerDuplicate = await statusOf(() => creationLifecycle.execute(stranger, { entity: "novel", action: "duplicate", id: created.id }));
      const authorPublish = await statusOf(() => creationLifecycle.execute(owner, { entity: "novel", action: "publish", id: created.id, novel }));
      const administratorSubmit = await statusOf(() => creationLifecycle.execute(administrator, { entity: "novel", action: "submit", id: created.id, novel }));
      const withdrawDraft = await statusOf(() => creationLifecycle.execute(owner, { entity: "novel", action: "withdraw", id: created.id }));
      await creationLifecycle.execute(owner, { entity: "novel", action: "submit", id: created.id, novel });
      const repeatedSubmit = await statusOf(() => creationLifecycle.execute(owner, { entity: "novel", action: "submit", id: created.id, novel }));
      await creationLifecycle.execute(administrator, { entity: "novel", action: "reject", id: created.id, meta: { reviewNote: "请修改" } });
      const rejectDraft = await statusOf(() => creationLifecycle.execute(administrator, { entity: "novel", action: "reject", id: created.id, meta: { reviewNote: "请修改" } }));
      await creationLifecycle.execute(administrator, { entity: "novel", action: "publish", id: created.id, novel });
      const authorDeletePublished = await statusOf(() => creationLifecycle.execute(owner, { entity: "novel", action: "delete", id: created.id }));
      const administratorDeletePublished = await statusOf(() => creationLifecycle.execute(administrator, { entity: "novel", action: "delete", id: created.id }));
      return Response.json({
        crossOwnerSave, crossOwnerDuplicate, authorPublish, administratorSubmit, withdrawDraft,
        repeatedSubmit, rejectDraft, authorDeletePublished, administratorDeletePublished,
      });
    }

    if (pathname === "/assets" && request.method === "POST") {
      const actor = { kind: "administrator" as const };
      const uploaded = await assetLifecycle.execute(actor, {
        action: "upload",
        bucket: workerEnv.ASSET_BUCKET,
        file: new File(["asset-contract"], "contract.txt.png", { type: "image/png" }),
        duration: 0,
        folderId: null,
        alt: "contract",
      });
      if (uploaded.kind !== "asset") throw new Error("素材上传没有返回素材");
      const id = String(uploaded.asset.id);
      const deleted = await assetLifecycle.execute(actor, { action: "delete", id, bucket: workerEnv.ASSET_BUCKET });
      const repeated = await assetLifecycle.execute(actor, { action: "delete", id, bucket: workerEnv.ASSET_BUCKET });
      const remaining = await assetLifecycle.list(actor);
      return Response.json({ uploaded, deleted, repeated, remainingIds: remaining.assets.map((asset) => asset.id) });
    }

    if (pathname === "/asset-matrix" && request.method === "POST") {
      const actor = { kind: "administrator" as const };
      const operations: string[] = [];
      const folder = await assetLifecycle.execute(actor, { action: "create-folder", name: "Module 素材" });
      if (folder.kind !== "folder") throw new Error("文件夹创建失败");
      operations.push("create-folder");
      const uploaded = await assetLifecycle.execute(actor, {
        action: "upload", bucket: workerEnv.ASSET_BUCKET,
        file: new File(["image"], "module.png", { type: "image/png" }),
        duration: 0, folderId: folder.folder.id, alt: "Module 图片",
      });
      if (uploaded.kind !== "asset") throw new Error("素材上传失败");
      operations.push("upload");
      await assetLifecycle.execute(actor, {
        action: "update-asset", id: String(uploaded.asset.id), name: "整理后的图片", folderId: null,
      });
      operations.push("update-asset");
      await assetLifecycle.execute(actor, { action: "rename-folder", id: folder.folder.id, name: "已重命名素材" });
      operations.push("rename-folder");
      await assetLifecycle.execute(actor, { action: "delete-folder", id: folder.folder.id });
      operations.push("delete-folder");

      const sfx = await assetLifecycle.execute(actor, {
        action: "generate-sfx", bucket: workerEnv.ASSET_BUCKET,
        rateLimit: { request, identity: `sfx-${crypto.randomUUID()}@example.com` },
        provider: {
          id: "mock",
          async generate() {
            return { bytes: new Uint8Array([1, 2, 3]), mimeType: "audio/mpeg" as const, extension: "mp3" as const, durationSeconds: 1, provider: "mock" };
          },
        },
        choiceText: "打开门", preset: "glow", prompt: "清晰的开门提示音", generationDurationSeconds: 1,
      });
      if (sfx.kind !== "asset") throw new Error("音效生成失败");
      operations.push("generate-sfx");
      const tts = await assetLifecycle.execute(actor, {
        action: "generate-tts", bucket: workerEnv.ASSET_BUCKET,
        rateLimit: { request, identity: `tts-${crypto.randomUUID()}@example.com` },
        provider: {
          async listVoices() { return []; },
          async generate() {
            return { bytes: new Uint8Array([4, 5, 6]), mimeType: "audio/mpeg" as const, extension: "mp3" as const, sourceKey: "mock-source" };
          },
        },
        text: "任务已更新", voiceId: "mock-voice", voiceName: "Module 音色",
      });
      if (tts.kind !== "asset") throw new Error("语音生成失败");
      operations.push("generate-tts");

      const referenced = await assetLifecycle.execute(actor, {
        action: "upload", bucket: workerEnv.ASSET_BUCKET,
        file: new File(["cover"], "referenced.png", { type: "image/png" }),
        duration: 0, folderId: null, alt: "被引用封面",
      });
      if (referenced.kind !== "asset") throw new Error("引用素材上传失败");
      const novelCreated = await creationLifecycle.execute(actor, { entity: "novel", action: "create" });
      if (novelCreated.kind !== "created") throw new Error("引用小说创建失败");
      const novel = createBlankNovel();
      novel.name = "素材引用小说";
      novel.summary = "验证素材引用保护。";
      novel.coverAssetId = String(referenced.asset.id);
      novel.coverUrl = String(referenced.asset.url);
      novel.coverAlt = "素材引用小说封面";
      await creationLifecycle.execute(actor, { entity: "novel", action: "save", id: novelCreated.id, novel });
      let referenceStatus = 0;
      try {
        await assetLifecycle.execute(actor, { action: "delete", id: String(referenced.asset.id), bucket: workerEnv.ASSET_BUCKET });
      } catch (error) {
        if (!(error instanceof AssetLifecycleError)) throw error;
        referenceStatus = error.status;
      }
      operations.push("reference-block");

      const retryable = await assetLifecycle.execute(actor, {
        action: "upload", bucket: workerEnv.ASSET_BUCKET,
        file: new File(["retry"], "retry.png", { type: "image/png" }),
        duration: 0, folderId: null, alt: "重试素材",
      });
      if (retryable.kind !== "asset") throw new Error("重试素材上传失败");
      const retryId = String(retryable.asset.id);
      const failingBucket = { async delete() { throw new Error("storage unavailable"); } } as unknown as R2Bucket;
      try {
        await assetLifecycle.execute(actor, { action: "delete", id: retryId, bucket: failingBucket });
      } catch (error) {
        if (!(error instanceof AssetLifecycleError) || error.status !== 500) throw error;
      }
      operations.push("delete-failed");
      const failedStatus = (await assetLifecycle.list(actor)).assets.find((asset) => asset.id === retryId)?.status;
      await assetLifecycle.execute(actor, { action: "delete", id: retryId, bucket: workerEnv.ASSET_BUCKET });
      operations.push("delete-retry");
      const retryRemoved = !(await assetLifecycle.list(actor)).assets.some((asset) => asset.id === retryId);
      return Response.json({
        operations,
        upload: {
          type: uploaded.asset.type, mimeType: uploaded.asset.mimeType,
          duration: uploaded.asset.duration, status: uploaded.asset.status,
        },
        generated: { sfxType: sfx.asset.type, ttsType: tts.asset.type, sourceKey: tts.sourceKey },
        referenceStatus, failedStatus, retryRemoved,
      });
    }

    if (pathname === "/asset-ownership" && request.method === "POST") {
      const owner = { kind: "author" as const, id: crypto.randomUUID() };
      const stranger = { kind: "author" as const, id: crypto.randomUUID() };
      const administrator = { kind: "administrator" as const };
      const statusOf = async (operation: () => Promise<unknown>) => {
        try {
          await operation();
          return 200;
        } catch (error) {
          if (!(error instanceof AssetLifecycleError)) throw error;
          return error.status;
        }
      };
      const authorAsset = await assetLifecycle.execute(owner, {
        action: "upload", bucket: workerEnv.ASSET_BUCKET,
        file: new File(["author"], "author.png", { type: "image/png" }),
        duration: 0, folderId: null, alt: "作者素材",
      });
      const platformAsset = await assetLifecycle.execute(administrator, {
        action: "upload", bucket: workerEnv.ASSET_BUCKET,
        file: new File(["platform"], "platform.png", { type: "image/png" }),
        duration: 0, folderId: null, alt: "平台素材",
      });
      if (authorAsset.kind !== "asset" || platformAsset.kind !== "asset") throw new Error("素材上传失败");
      const authorAssetId = String(authorAsset.asset.id);
      const platformAssetId = String(platformAsset.asset.id);
      return Response.json({
        strangerCanSeeAuthorAsset: (await assetLifecycle.list(stranger)).assets.some((asset) => asset.id === authorAssetId),
        strangerUpdate: await statusOf(() => assetLifecycle.execute(stranger, { action: "update-asset", id: authorAssetId, name: "越权" })),
        strangerDelete: await statusOf(() => assetLifecycle.execute(stranger, { action: "delete", id: authorAssetId, bucket: workerEnv.ASSET_BUCKET })),
        authorUpdatePlatform: await statusOf(() => assetLifecycle.execute(owner, { action: "update-asset", id: platformAssetId, name: "越权" })),
      });
    }

    if (pathname === "/asset-generation-rate-limit" && request.method === "POST") {
      const actor = { kind: "author" as const, id: crypto.randomUUID() };
      const identity = `asset-limit-${crypto.randomUUID()}@example.com`;
      const limitedRequest = () => new Request(request.url, {
        method: "POST", headers: { origin: new URL(request.url).origin, "cf-connecting-ip": "203.0.113.20" },
      });
      const generate = () => assetLifecycle.execute(actor, {
        action: "generate-sfx", bucket: workerEnv.ASSET_BUCKET,
        rateLimit: { request: limitedRequest(), identity },
        provider: {
          id: "mock",
          async generate() {
            return { bytes: new Uint8Array([1]), mimeType: "audio/mpeg" as const, extension: "mp3" as const, durationSeconds: 1, provider: "mock" };
          },
        },
        choiceText: "频控", preset: "glow", prompt: "频控测试音效", generationDurationSeconds: 1,
      });
      for (let index = 0; index < 5; index += 1) await generate();
      let rateLimited = 0;
      try {
        await generate();
      } catch (error) {
        if (!(error instanceof AuthError)) throw error;
        rateLimited = error.status;
      }
      return Response.json({ generated: 5, rateLimited });
    }

    if (pathname === "/account-registration-disabled" && request.method === "POST") {
      const lifecycle = createAccountLifecycle({
        config: {
          registrationEnabled: false,
          termsVersion: "2026-08-11",
          privacyVersion: "2026-08-11",
          allowedHostnames: [new URL(request.url).hostname],
        },
        turnstile: new MockTurnstileVerifier(),
        mailer: new MockAuthMailer(),
      });
      try {
        await lifecycle.execute({
          action: "register",
          request: new Request(request.url, { method: "POST", headers: { origin: new URL(request.url).origin } }),
          email: `disabled-${crypto.randomUUID()}@example.com`,
          displayName: "关闭注册",
          password: "disabled-registration-password",
          turnstileToken: "disabled-token",
        });
        throw new Error("关闭注册后仍然创建了账号");
      } catch (error) {
        if (!(error instanceof AuthError)) throw error;
        return Response.json({ status: error.status, message: error.message });
      }
    }

    if (pathname === "/account-registration-runtime-config" && request.method === "POST") {
      const incomplete = accountRegistrationConfigFrom({
        REGISTRATION_ENABLED: "true", TERMS_VERSION: "draft", PRIVACY_VERSION: "draft",
      });
      const localPreview = accountRegistrationConfigFrom({
        REGISTRATION_ENABLED: "true", LOCAL_AUTH_BYPASS: "true",
        APP_ORIGIN: "http://127.0.0.1:8787",
        TERMS_VERSION: "preview", PRIVACY_VERSION: "preview",
      });
      const unsafeBypass = accountRegistrationConfigFrom({
        REGISTRATION_ENABLED: "true", LOCAL_AUTH_BYPASS: "true",
        APP_ORIGIN: "https://production.example.com",
        TERMS_VERSION: "preview", PRIVACY_VERSION: "preview",
      });
      const productionReady = accountRegistrationConfigFrom({
        REGISTRATION_ENABLED: "true", TERMS_VERSION: "2026-08-11", PRIVACY_VERSION: "2026-08-11",
        APP_ORIGIN: "https://preview.example.com", TURNSTILE_SITE_KEY: "site", TURNSTILE_SECRET_KEY: "secret",
        RESEND_API_KEY: "resend", AUTH_FROM_EMAIL: "小雾 <guide@example.com>", ACCOUNT_CONTACT_EMAIL: "support@example.com",
        ACCOUNT_OPERATION_SECRET: "preview-operation-fingerprint-secret-32-bytes",
      });
      return Response.json({
        incomplete, localPreview, unsafeBypass, productionReady,
        turnstile: {
          accepted: acceptsTurnstileResult({
            success: true, action: "register", hostname: "preview.example.com",
          }, "register", ["preview.example.com"]),
          missingAction: acceptsTurnstileResult({
            success: true, hostname: "preview.example.com",
          }, "register", ["preview.example.com"]),
          wrongHostname: acceptsTurnstileResult({
            success: true, action: "register", hostname: "evil.example.com",
          }, "register", ["preview.example.com"]),
        },
      });
    }

    if (pathname === "/account-registration-create" && request.method === "POST") {
      const turnstile = new MockTurnstileVerifier();
      const mailer = new MockAuthMailer();
      const lifecycle = createAccountLifecycle({ turnstile, mailer });
      const lifecycleRequest = () => new Request(request.url, {
        method: "POST",
        headers: { origin: new URL(request.url).origin, "cf-connecting-ip": crypto.randomUUID() },
      });
      const email = `guided-${crypto.randomUUID()}@example.com`;
      const statusOf = async (overrides: Record<string, unknown>) => {
        try {
          const result = await lifecycle.execute({
            action: "register",
            request: lifecycleRequest(),
            email: `${crypto.randomUUID()}@example.com`,
            displayName: "小雾旅伴",
            password: "十五字符以上的安全密码 phrase",
            turnstileToken: "guided-token",
            ageConfirmed: true,
            termsAccepted: true,
            privacyAccepted: true,
            ...overrides,
          });
          return result.status ?? 200;
        } catch (error) {
          if (!(error instanceof AuthError)) throw error;
          return error.status;
        }
      };
      const missingAge = await statusOf({ ageConfirmed: false });
      const missingTerms = await statusOf({ termsAccepted: false });
      const shortPassword = await statusOf({ password: "twelve-chars" });
      const registration = await lifecycle.execute({
        action: "register",
        request: lifecycleRequest(),
        email,
        displayName: "小雾旅伴",
        password: "十五字符以上的安全密码 phrase",
        turnstileToken: "guided-token",
        ageConfirmed: true,
        termsAccepted: true,
        privacyAccepted: true,
      });
      return Response.json({
        missingAge,
        missingTerms,
        shortPassword,
        registration,
        turnstile: turnstile.calls.at(-1),
        mail: mailer.calls.at(-1),
      });
    }

    if (pathname === "/account-activation" && request.method === "POST") {
      const mailer = new MockAuthMailer();
      const lifecycle = createAccountLifecycle({ turnstile: new MockTurnstileVerifier(), mailer });
      const lifecycleRequest = (cookie = "") => new Request(request.url, {
        method: "POST",
        headers: { origin: new URL(request.url).origin, ...(cookie ? { cookie } : {}) },
      });
      const email = `activation-${crypto.randomUUID()}@example.com`;
      await lifecycle.execute({
        action: "register", request: lifecycleRequest(), email, displayName: "激活旅伴",
        password: "activation-password-123", turnstileToken: "activation-token",
        ageConfirmed: true, termsAccepted: true, privacyAccepted: true,
      });
      const token = mailer.calls.at(-1)?.token;
      if (!token) throw new Error("没有生成验证 token");
      const inspection = await lifecycle.execute({ action: "inspect-email-verification", token });
      let pendingLogin = 0;
      try {
        await lifecycle.execute({ action: "login", request: lifecycleRequest(), email, password: "activation-password-123" });
      } catch (error) {
        if (!(error instanceof AuthError)) throw error;
        pendingLogin = error.status;
      }
      const activation = await lifecycle.execute({
        action: "activate-account",
        request: lifecycleRequest(),
        token,
        intent: { kind: "bookshelf", targetId: "novel-42" },
      });
      const identity = activation.cookie ? await sessionAuthorization.optional(lifecycleRequest(activation.cookie)) : null;
      const usedWithMatchingSession = identity
        ? await lifecycle.execute({ action: "inspect-email-verification", token, actorId: identity.id })
        : null;
      let repeated = 0;
      try {
        await lifecycle.execute({ action: "activate-account", request: lifecycleRequest(), token });
      } catch (error) {
        if (!(error instanceof AuthError)) throw error;
        repeated = error.status;
      }

      const disabledEmail = `disabled-activation-${crypto.randomUUID()}@example.com`;
      await lifecycle.execute({
        action: "register", request: lifecycleRequest(), email: disabledEmail, displayName: "禁用旅伴",
        password: "disabled-activation-password-123", turnstileToken: "disabled-activation-token",
        ageConfirmed: true, termsAccepted: true, privacyAccepted: true,
      });
      const disabledToken = mailer.calls.at(-1)?.token;
      if (!disabledToken) throw new Error("没有禁用账号 token");
      const listed = await lifecycle.execute({ action: "list-users" });
      const disabledId = (listed.body.users as Array<{ id: string; email: string }>).find((user) => user.email === disabledEmail)?.id;
      if (!disabledId) throw new Error("没有禁用账号");
      await lifecycle.execute({ action: "update-user", id: disabledId, status: "disabled" });
      let disabledActivation = 0;
      try {
        await lifecycle.execute({ action: "activate-account", request: lifecycleRequest(), token: disabledToken });
      } catch (error) {
        if (!(error instanceof AuthError)) throw error;
        disabledActivation = error.status;
      }
      return Response.json({ inspection, pendingLogin, activation, identity, usedWithMatchingSession, repeated, disabledActivation });
    }

    if (pathname === "/account-bookshelf-intent" && request.method === "POST") {
      const fixture = await createBookshelfFixture();
      const mailer = new MockAuthMailer();
      const lifecycle = createAccountLifecycle({
        turnstile: new MockTurnstileVerifier(), mailer,
        registrationIntent: {
          async resume({ userId, intent }) {
            if (intent.kind !== "bookshelf" || !intent.targetId) return { kind: "cross-device" as const, mode: "welcome" as const };
            await bookshelfLifecycle.execute({ kind: "account", id: userId }, {
              action: "add", novelId: intent.targetId,
              operationId: crypto.randomUUID(), sourceKey: "activation-source",
            });
            return { ...intent, mode: "automatic" as const, outcome: "succeeded" as const };
          },
        },
        privateData: {
          async export(userId) {
            const result = await bookshelfLifecycle.execute({ kind: "account", id: userId }, { action: "export" });
            return { bookshelf: "entries" in result ? result.entries : [] };
          },
          async purge(userId) {
            await bookshelfLifecycle.execute({ kind: "account", id: userId }, { action: "purge" });
          },
          async cleanupOrphans() {
            await bookshelfLifecycle.execute({ kind: "system" }, { action: "cleanup" });
          },
        },
      });
      const lifecycleRequest = () => new Request(request.url, {
        method: "POST", headers: { origin: new URL(request.url).origin, "cf-connecting-ip": "203.0.113.55" },
      });
      const email = `bookshelf-intent-${crypto.randomUUID()}@example.com`;
      await lifecycle.execute({
        action: "register", request: lifecycleRequest(), email, displayName: "书架旅伴",
        password: "bookshelf-intent-password-123", turnstileToken: "intent-token",
        ageConfirmed: true, termsAccepted: true, privacyAccepted: true,
      });
      const token = mailer.calls.at(-1)?.token;
      if (!token) throw new Error("没有生成验证 token");
      const activation = await lifecycle.execute({
        action: "activate-account", request: lifecycleRequest(), token,
        intent: { kind: "bookshelf", targetId: fixture.novelId },
      });
      const user = activation.body.user as { id: string };
      const membership = await bookshelfLifecycle.execute({ kind: "account", id: user.id }, {
        action: "membership", novelId: fixture.novelId,
      });
      const exported = await lifecycle.execute({ action: "export-account-data", actorId: user.id });
      await lifecycle.execute({
        action: "delete-account", request: lifecycleRequest(), actorId: user.id, confirmation: "永久删除我的账号",
      });
      const membershipAfterDeletion = await bookshelfLifecycle.execute({ kind: "account", id: user.id }, {
        action: "membership", novelId: fixture.novelId,
      });
      return Response.json({
        directive: activation.body.resumeDirective,
        present: "present" in membership && membership.present,
        exportCount: Array.isArray(exported.body.bookshelf) ? exported.body.bookshelf.length : -1,
        presentAfterDeletion: "present" in membershipAfterDeletion && membershipAfterDeletion.present,
        accountDeleted: !(await drizzleD1AccountStore.findById(user.id)),
      });
    }

    if (pathname === "/account-resend" && request.method === "POST") {
      let now = new Date("2026-08-11T00:00:00.000Z");
      const mailer = new MockAuthMailer();
      const lifecycle = createAccountLifecycle({
        turnstile: new MockTurnstileVerifier(), mailer, clock: () => now,
      });
      const lifecycleRequest = () => new Request(request.url, {
        method: "POST", headers: { origin: new URL(request.url).origin, "cf-connecting-ip": "203.0.113.40" },
      });
      const email = `resend-${crypto.randomUUID()}@example.com`;
      await lifecycle.execute({
        action: "register", request: lifecycleRequest(), email, displayName: "重发旅伴",
        password: "resend-password-12345", turnstileToken: "initial-token",
        ageConfirmed: true, termsAccepted: true, privacyAccepted: true,
      });
      let immediateStatus = 0;
      let retryAfterSeconds = 0;
      try {
        await lifecycle.execute({ action: "resend-verification", request: lifecycleRequest(), email, turnstileToken: "too-soon" });
      } catch (error) {
        if (!(error instanceof AuthError)) throw error;
        immediateStatus = error.status;
        retryAfterSeconds = error.retryAfterSeconds ?? 0;
      }
      now = new Date("2026-08-11T00:01:01.000Z");
      const resent = await lifecycle.execute({
        action: "resend-verification", request: lifecycleRequest(), email, turnstileToken: "resend-token",
      });
      return Response.json({ immediateStatus, retryAfterSeconds, resent, mailCalls: mailer.calls.length });
    }

    if (pathname === "/account-restart" && request.method === "POST") {
      let now = new Date("2026-08-11T00:00:00.000Z");
      const mailer = new MockAuthMailer();
      const rateLimitIdentities: string[] = [];
      const lifecycle = createAccountLifecycle({
        turnstile: new MockTurnstileVerifier(), mailer, clock: () => now,
        rateLimiter: {
          async enforce(_request, _action, identity) { rateLimitIdentities.push(identity); },
          async cleanupExpired() { return 0; },
        },
      });
      const lifecycleRequest = () => new Request(request.url, {
        method: "POST", headers: { origin: new URL(request.url).origin, "cf-connecting-ip": "203.0.113.41" },
      });
      const currentEmail = `restart-${crypto.randomUUID()}@example.com`;
      const newEmail = `restarted-${crypto.randomUUID()}@example.com`;
      await lifecycle.execute({
        action: "register", request: lifecycleRequest(), email: currentEmail, displayName: "旧昵称",
        password: "original-password-123", turnstileToken: "initial-token",
        ageConfirmed: true, termsAccepted: true, privacyAccepted: true,
      });
      const oldToken = mailer.calls.at(-1)?.token;
      if (!oldToken) throw new Error("没有旧 token");
      now = new Date("2026-08-11T00:01:01.000Z");
      const restarted = await lifecycle.execute({
        action: "restart-registration", request: lifecycleRequest(), currentEmail, email: newEmail,
        displayName: "新昵称", password: "replacement-password-456", turnstileToken: "restart-token",
        ageConfirmed: true, termsAccepted: true, privacyAccepted: true,
      });
      const restartRateLimitIdentity = rateLimitIdentities.at(-1);
      const newToken = mailer.calls.at(-1)?.token;
      if (!newToken) throw new Error("没有新 token");
      const oldInspection = await lifecycle.execute({ action: "inspect-email-verification", token: oldToken });
      const newInspection = await lifecycle.execute({ action: "inspect-email-verification", token: newToken });
      const successfulMailCalls = mailer.calls.length;

      now = new Date("2026-08-12T00:00:00.000Z");
      const failureEmail = `restart-failure-${crypto.randomUUID()}@example.com`;
      await lifecycle.execute({
        action: "register", request: lifecycleRequest(), email: failureEmail, displayName: "失败前昵称",
        password: "restart-failure-password-123", turnstileToken: "failure-initial-token",
        ageConfirmed: true, termsAccepted: true, privacyAccepted: true,
      });
      const expiryBeforeFailure = (await drizzleD1AccountStore.findByEmail(failureEmail))?.pendingExpiresAt;
      now = new Date("2026-08-13T00:00:00.000Z");
      const failedNewEmail = `restart-failed-new-${crypto.randomUUID()}@example.com`;
      const failingLifecycle = createAccountLifecycle({
        turnstile: new MockTurnstileVerifier(),
        mailer: new MockAuthMailer({}, new AuthError("邮件发送失败，请稍后重试", 502)),
        clock: () => now,
        externalRetries: 0,
      });
      let failedStatus = 0;
      try {
        await failingLifecycle.execute({
          action: "restart-registration", request: lifecycleRequest(), currentEmail: failureEmail, email: failedNewEmail,
          displayName: "失败后昵称", password: "restart-failed-new-password-123", turnstileToken: "failure-restart-token",
          ageConfirmed: true, termsAccepted: true, privacyAccepted: true,
        });
      } catch (error) {
        if (!(error instanceof AuthError)) throw error;
        failedStatus = error.status;
      }
      const expiryAfterFailure = (await drizzleD1AccountStore.findByEmail(failedNewEmail))?.pendingExpiresAt;
      return Response.json({
        restarted, oldInspection, newInspection, mailCalls: successfulMailCalls,
        failedStatus, expiryBeforeFailure, expiryAfterFailure,
        restartRateLimitIdentity,
      });
    }

    if (pathname === "/account-operation-receipt" && request.method === "POST") {
      const requestForLifecycle = () => new Request(request.url, {
        method: "POST", headers: { origin: new URL(request.url).origin, "cf-connecting-ip": "203.0.113.42" },
      });
      const recoveryMailKeys: string[] = [];
      let recoveryMailCalls = 0;
      const recoveringMailer = {
        async send(
          _request: Request,
          _to: string,
          _type: "verify_email" | "reset_password",
          _token: string,
          attempt?: { signal: AbortSignal; idempotencyKey: string; allowedHostnames: string[] },
        ) {
          recoveryMailCalls += 1;
          if (attempt) recoveryMailKeys.push(attempt.idempotencyKey);
          if (recoveryMailCalls === 1) {
            await new Promise<never>((_resolve, reject) => {
              attempt?.signal.addEventListener("abort", () => reject(new Error("external request aborted")), { once: true });
            });
          }
          return {};
        },
      };
      const timeoutLifecycle = createAccountLifecycle({
        turnstile: new MockTurnstileVerifier(), mailer: recoveringMailer, externalTimeoutMs: 5, externalRetries: 0,
      });
      const timeoutOperationId = crypto.randomUUID();
      const timeoutEmail = `uncertain-${crypto.randomUUID()}@example.com`;
      const timeoutCommand = {
        action: "register" as const, request: requestForLifecycle(), email: timeoutEmail,
        displayName: "不确定旅伴", password: "uncertain-password-123", turnstileToken: "uncertain-token",
        ageConfirmed: true, termsAccepted: true, privacyAccepted: true, operationId: timeoutOperationId,
      };
      try {
        await timeoutLifecycle.execute(timeoutCommand);
      } catch (error) {
        if (!(error instanceof AuthError) || error.status !== 504) throw error;
      }
      const uncertain = await timeoutLifecycle.execute({ action: "get-registration-outcome", operationId: timeoutOperationId });
      const recovered = await timeoutLifecycle.execute(timeoutCommand);
      const recoveredOutcome = await timeoutLifecycle.execute({ action: "get-registration-outcome", operationId: timeoutOperationId });
      const recoveredAccounts = (await timeoutLifecycle.execute({ action: "list-users" }).then((result) => result.body.users)) as Array<{ email: string }>;

      const successMailer = new MockAuthMailer();
      const successLifecycle = createAccountLifecycle({ turnstile: new MockTurnstileVerifier(), mailer: successMailer });
      const successOperationId = crypto.randomUUID();
      const command = {
        action: "register" as const, request: requestForLifecycle(), email: `idempotent-${crypto.randomUUID()}@example.com`,
        displayName: "幂等旅伴", password: "idempotent-password-123", turnstileToken: "idempotent-token",
        ageConfirmed: true, termsAccepted: true, privacyAccepted: true, operationId: successOperationId,
      };
      const first = await successLifecycle.execute(command);
      const repeated = await successLifecycle.execute(command);
      const receipt = await drizzleD1AccountStore.findOperationReceipt(await hashToken(successOperationId));
      const receiptBody = JSON.parse(receipt?.resultJson || "{}") as { requestHash?: string };
      const offlinePasswordGuess = await hashToken(JSON.stringify({
        kind: "register", email: command.email, displayName: command.displayName,
        passwordHash: await hashToken(command.password), ageConfirmed: true,
        termsAccepted: true, privacyAccepted: true, analyticsAllowed: false,
        termsVersion: "development", privacyVersion: "development",
      }));
      const offlinePersonalGuess = await hashToken(JSON.stringify({
        kind: "register", email: command.email, displayName: command.displayName,
        ageConfirmed: true, termsAccepted: true, privacyAccepted: true, analyticsAllowed: false,
        termsVersion: "development", privacyVersion: "development",
      }));
      return Response.json({
        uncertain, recovered, recoveredOutcome,
        recoveryMailCalls, recoveryMailSameKey: new Set(recoveryMailKeys).size === 1,
        recoveredAccountCount: recoveredAccounts.filter((account) => account.email === timeoutEmail).length,
        first, repeated, successMailCalls: successMailer.calls.length,
        receiptMatchesOfflinePasswordGuess: receiptBody.requestHash === offlinePasswordGuess,
        receiptMatchesOfflinePersonalGuess: receiptBody.requestHash === offlinePersonalGuess,
      });
    }

    if (pathname === "/account-registration-rate-limit" && request.method === "POST") {
      let now = new Date("2026-08-11T00:00:00.000Z");
      const mailer = new MockAuthMailer();
      const turnstile = new MockTurnstileVerifier();
      const lifecycle = createAccountLifecycle({ turnstile, mailer, clock: () => now });
      const lifecycleRequest = () => new Request(request.url, {
        method: "POST", headers: { origin: new URL(request.url).origin, "cf-connecting-ip": "203.0.113.43" },
      });
      const email = `shared-limit-${crypto.randomUUID()}@example.com`;
      await lifecycle.execute({
        action: "register", request: lifecycleRequest(), email, displayName: "频控旅伴",
        password: "rate-limit-password-123", turnstileToken: "initial-token",
        ageConfirmed: true, termsAccepted: true, privacyAccepted: true,
      });
      for (let index = 1; index < 5; index += 1) {
        now = new Date(now.getTime() + 61_000);
        await lifecycle.execute({
          action: "resend-verification", request: lifecycleRequest(), email, turnstileToken: `resend-${index}`,
        });
      }
      now = new Date(now.getTime() + 61_000);
      let limitedStatus = 0;
      let retryAfterSeconds = 0;
      try {
        await lifecycle.execute({
          action: "resend-verification", request: lifecycleRequest(), email, turnstileToken: "blocked-resend",
        });
      } catch (error) {
        if (!(error instanceof AuthError)) throw error;
        limitedStatus = error.status;
        retryAfterSeconds = error.retryAfterSeconds ?? 0;
      }
      return Response.json({
        limitedStatus, retryAfterSeconds, mailCalls: mailer.calls.length, turnstileCalls: turnstile.calls.length,
      });
    }

    if (pathname === "/account-rate-limit-concurrency" && request.method === "POST") {
      const rateRequest = () => new Request(request.url, {
        headers: { "cf-connecting-ip": "203.0.113.44" },
      });
      const identity = `concurrent-${crypto.randomUUID()}@example.com`;
      const results = await Promise.allSettled(Array.from({ length: 6 }, () => d1AccountRateLimiter.enforce(
        rateRequest(), "concurrent-registration", identity, 5, 30, () => new Date("2026-08-11T00:00:00.000Z"),
      )));
      return Response.json({
        accepted: results.filter((result) => result.status === "fulfilled").length,
        limited: results.filter((result) => result.status === "rejected"
          && result.reason instanceof AuthError && result.reason.status === 429).length,
      });
    }

    if (pathname === "/account-expired-registration-cleanup" && request.method === "POST") {
      let now = new Date("2026-08-11T00:00:00.000Z");
      const mailer = new MockAuthMailer();
      const lifecycle = createAccountLifecycle({ turnstile: new MockTurnstileVerifier(), mailer, clock: () => now });
      const lifecycleRequest = (cookie = "") => new Request(request.url, {
        method: "POST",
        headers: {
          origin: new URL(request.url).origin,
          "cf-connecting-ip": crypto.randomUUID(),
          ...(cookie ? { cookie } : {}),
        },
      });
      const pendingEmail = `expired-pending-${crypto.randomUUID()}@example.com`;
      await d1AccountRateLimiter.enforce(
        lifecycleRequest(), "expired-attempt", pendingEmail, 5, 30,
        () => new Date("2026-08-01T00:00:00.000Z"),
      );
      await lifecycle.execute({
        action: "register", request: lifecycleRequest(), email: pendingEmail, displayName: "过期待验证旅伴",
        password: "expired-pending-password-123", turnstileToken: "pending-token",
        ageConfirmed: true, termsAccepted: true, privacyAccepted: true,
      });
      const pendingToken = mailer.calls.at(-1)?.token;
      if (!pendingToken) throw new Error("没有待验证 token");

      const activeEmail = `cleanup-active-${crypto.randomUUID()}@example.com`;
      const activePassword = "cleanup-active-password-123";
      await lifecycle.execute({
        action: "register", request: lifecycleRequest(), email: activeEmail, displayName: "正常旅伴",
        password: activePassword, turnstileToken: "active-token",
        ageConfirmed: true, termsAccepted: true, privacyAccepted: true,
      });
      const activeToken = mailer.calls.at(-1)?.token;
      if (!activeToken) throw new Error("没有正常账号 token");
      await lifecycle.execute({ action: "activate-account", request: lifecycleRequest(), token: activeToken });

      now = new Date("2026-08-18T00:00:01.000Z");
      const cleanup = await lifecycle.execute({ action: "cleanup-expired-pending-accounts" });
      const expiredInspection = await lifecycle.execute({ action: "inspect-email-verification", token: pendingToken });
      const activeLogin = await lifecycle.execute({
        action: "login", request: lifecycleRequest(), email: activeEmail, password: activePassword,
      });
      const notYetEmail = `not-yet-expired-${crypto.randomUUID()}@example.com`;
      await lifecycle.execute({
        action: "register", request: lifecycleRequest(), email: notYetEmail, displayName: "未到期旅伴",
        password: "not-yet-expired-password-123", turnstileToken: "not-yet-token",
        ageConfirmed: true, termsAccepted: true, privacyAccepted: true,
      });
      const notYetToken = mailer.calls.at(-1)?.token;
      if (!notYetToken) throw new Error("没有未到期 token");
      const repeatedCleanup = await lifecycle.execute({ action: "cleanup-expired-pending-accounts" });
      const notYetInspection = await lifecycle.execute({ action: "inspect-email-verification", token: notYetToken });
      return Response.json({
        cleanup, expiredInspection, repeatedCleanup, notYetInspection,
        activeStatus: (activeLogin.body.user as { status: string }).status,
      });
    }

    if (pathname === "/account-registration-telemetry" && request.method === "POST") {
      const telemetry = new MockRegistrationTelemetry();
      const mailer = new MockAuthMailer();
      const lifecycle = createAccountLifecycle({ turnstile: new MockTurnstileVerifier(), mailer, telemetry });
      const lifecycleRequest = () => new Request(request.url, {
        method: "POST", headers: { origin: new URL(request.url).origin, "cf-connecting-ip": crypto.randomUUID() },
      });
      await lifecycle.execute({
        action: "record-registration-event", analyticsAllowed: false,
        event: { flow: "register", stage: "invitation", outcome: "shown" },
      });
      const declinedEmail = `analytics-declined-${crypto.randomUUID()}@example.com`;
      await lifecycle.execute({
        action: "register", request: lifecycleRequest(), email: declinedEmail, displayName: "不参与分析",
        password: "analytics-declined-password-123", turnstileToken: "declined-token",
        ageConfirmed: true, termsAccepted: true, privacyAccepted: true, analyticsAllowed: false,
      });
      const declinedToken = mailer.calls.at(-1)?.token;
      if (!declinedToken) throw new Error("没有拒绝分析账号 token");
      await lifecycle.execute({
        action: "activate-account", request: lifecycleRequest(), token: declinedToken, analyticsAllowed: false,
      });
      const declinedEventCount = telemetry.events.length;

      await lifecycle.execute({
        action: "record-registration-event", analyticsAllowed: true,
        event: { flow: "register", stage: "invitation", outcome: "shown" },
      });
      const allowedEmail = `analytics-allowed-${crypto.randomUUID()}@example.com`;
      await lifecycle.execute({
        action: "register", request: lifecycleRequest(), email: allowedEmail, displayName: "参与分析",
        password: "analytics-allowed-password-123", turnstileToken: "allowed-token",
        ageConfirmed: true, termsAccepted: true, privacyAccepted: true, analyticsAllowed: true,
      });
      const allowedToken = mailer.calls.at(-1)?.token;
      if (!allowedToken) throw new Error("没有允许分析账号 token");
      await lifecycle.execute({
        action: "activate-account", request: lifecycleRequest(), token: allowedToken,
        intent: { kind: "cross-device" }, analyticsAllowed: true,
      });
      return Response.json({
        declinedEventCount,
        events: telemetry.events,
        serializedEvents: JSON.stringify(telemetry.events),
        privateValues: [declinedEmail, allowedEmail, "不参与分析", "参与分析", "analytics-allowed-password-123", allowedToken],
      });
    }

    if (pathname === "/account-guide-memory" && request.method === "POST") {
      const mailer = new MockAuthMailer();
      const lifecycle = createAccountLifecycle({ turnstile: new MockTurnstileVerifier(), mailer });
      const lifecycleRequest = (cookie = "") => new Request(request.url, {
        method: "POST", headers: {
          origin: new URL(request.url).origin,
          "cf-connecting-ip": crypto.randomUUID(),
          ...(cookie ? { cookie } : {}),
        },
      });
      const createActiveAccount = async (label: string) => {
        const email = `guide-${label}-${crypto.randomUUID()}@example.com`;
        await lifecycle.execute({
          action: "register", request: lifecycleRequest(), email, displayName: `向导记忆${label}`,
          password: `guide-memory-${label}-password-123`, turnstileToken: `${label}-token`,
          ageConfirmed: true, termsAccepted: true, privacyAccepted: true,
        });
        const token = mailer.calls.at(-1)?.token;
        if (!token) throw new Error("没有向导记忆验证 token");
        const activation = await lifecycle.execute({ action: "activate-account", request: lifecycleRequest(), token });
        if (!activation.cookie) throw new Error("没有向导记忆会话");
        return activation.cookie;
      };
      const ownerCookie = await createActiveAccount("owner");
      const strangerCookie = await createActiveAccount("stranger");
      const owner = await sessionAuthorization.require(lifecycleRequest(ownerCookie));
      const stranger = await sessionAuthorization.require(lifecycleRequest(strangerCookie));

      const declined = await lifecycle.execute({ action: "get-guide-memory", actorId: owner.id });
      const accepted = await lifecycle.execute({
        action: "update-guide-memory", actorId: owner.id,
        preferences: ["奇幻", "不在白名单", "轻松", "奇幻"], completeGuide: true,
      });
      const crossDevice = await lifecycle.execute({ action: "get-guide-memory", actorId: owner.id });
      const strangerView = await lifecycle.execute({ action: "get-guide-memory", actorId: stranger.id });
      const changed = await lifecycle.execute({
        action: "update-guide-memory", actorId: owner.id, preferences: ["悬疑"], completeGuide: true,
      });
      const cleared = await lifecycle.execute({ action: "clear-guide-memory", actorId: owner.id });
      return Response.json({ declined, accepted, crossDevice, strangerView, changed, cleared });
    }

    if (pathname === "/account" && request.method === "POST") {
      const turnstile = new MockTurnstileVerifier();
      const mailer = new MockAuthMailer();
      const lifecycle = createAccountLifecycle({ turnstile, mailer });
      const lifecycleRequest = () => new Request(request.url, {
        method: "POST",
        headers: { origin: new URL(request.url).origin },
      });
      const email = `module-${crypto.randomUUID()}@example.com`;
      const password = "contract-password-123";
      const registration = await lifecycle.execute({
        action: "register",
        request: lifecycleRequest(),
        email,
        displayName: "Module Contract",
        password,
        turnstileToken: "contract-token",
        ageConfirmed: true, termsAccepted: true, privacyAccepted: true,
      });
      const token = mailer.calls[0]?.token;
      if (!token) throw new Error("注册没有生成验证 token");
      const verification = await lifecycle.execute({ action: "verify-email", request: lifecycleRequest(), token });
      const login = await lifecycle.execute({ action: "login", request: lifecycleRequest(), email, password });
      return Response.json({ registration, verification, login, turnstileCalls: turnstile.calls, mailCalls: mailer.calls });
    }

    if (pathname === "/account-matrix" && request.method === "POST") {
      const mailer = new MockAuthMailer();
      const lifecycle = createAccountLifecycle({ turnstile: new MockTurnstileVerifier(), mailer });
      const operations: string[] = [];
      const lifecycleRequest = (cookie = "") => new Request(request.url, {
        method: "POST",
        headers: { origin: new URL(request.url).origin, ...(cookie ? { cookie } : {}) },
      });
      const email = `account-matrix-${crypto.randomUUID()}@example.com`;
      const password = "contract-password-123";
      const newPassword = "replacement-password-456";
      await lifecycle.execute({
        action: "register", request: lifecycleRequest(), email, displayName: "Account Matrix",
        password, turnstileToken: "register-token",
        ageConfirmed: true, termsAccepted: true, privacyAccepted: true,
      });
      operations.push("register");
      const verificationToken = mailer.calls.at(-1)?.token;
      if (!verificationToken) throw new Error("没有验证 token");
      await lifecycle.execute({ action: "verify-email", request: lifecycleRequest(), token: verificationToken });
      operations.push("verify-email");
      const firstLogin = await lifecycle.execute({ action: "login", request: lifecycleRequest(), email, password });
      if (!firstLogin.cookie) throw new Error("首次登录没有 cookie");
      operations.push("login");
      const user = firstLogin.body.user as { id: string };
      await lifecycle.execute({ action: "profile", actorId: user.id, displayName: "Updated Matrix" });
      operations.push("profile");
      const forgotExisting = await lifecycle.execute({
        action: "forgot-password", request: lifecycleRequest(), email, turnstileToken: "forgot-token",
      });
      operations.push("forgot-password");
      const resetToken = mailer.calls.at(-1)?.token;
      if (!resetToken) throw new Error("没有重置 token");
      const forgotMissing = await lifecycle.execute({
        action: "forgot-password", request: lifecycleRequest(),
        email: `missing-${crypto.randomUUID()}@example.com`, turnstileToken: "missing-token",
      });
      await lifecycle.execute({ action: "reset-password", request: lifecycleRequest(), token: resetToken, password: newPassword });
      operations.push("reset-password");
      const oldSessionAfterReset = await sessionAuthorization.optional(lifecycleRequest(firstLogin.cookie));
      let resetReuseStatus = 0;
      try {
        await lifecycle.execute({ action: "reset-password", request: lifecycleRequest(), token: resetToken, password: newPassword });
      } catch (error) {
        if (!(error instanceof AuthError)) throw error;
        resetReuseStatus = error.status;
      }
      const secondLogin = await lifecycle.execute({ action: "login", request: lifecycleRequest(), email, password: newPassword });
      if (!secondLogin.cookie) throw new Error("重置后登录没有 cookie");
      operations.push("login");
      await lifecycle.execute({ action: "update-user", id: user.id, role: "author" });
      operations.push("update-role");
      const roleAfterUpdate = (await sessionAuthorization.requireRole(lifecycleRequest(secondLogin.cookie), ["author"])).role;
      const listed = await lifecycle.execute({ action: "list-users" });
      if (!(listed.body.users as Array<{ id: string }>).some((item) => item.id === user.id)) throw new Error("账号列表缺少目标账号");
      operations.push("list-users");
      await lifecycle.execute({ action: "logout", request: lifecycleRequest(secondLogin.cookie) });
      operations.push("logout");
      const sessionAfterLogout = await sessionAuthorization.optional(lifecycleRequest(secondLogin.cookie));
      const thirdLogin = await lifecycle.execute({ action: "login", request: lifecycleRequest(), email, password: newPassword });
      if (!thirdLogin.cookie) throw new Error("禁用前登录没有 cookie");
      operations.push("login");
      await lifecycle.execute({ action: "update-user", id: user.id, status: "disabled" });
      operations.push("update-status");
      const sessionAfterDisable = await sessionAuthorization.optional(lifecycleRequest(thirdLogin.cookie));
      return Response.json({
        operations,
        forgotExistingMessage: forgotExisting.body.message,
        forgotMissingMessage: forgotMissing.body.message,
        resetReuseStatus,
        oldSessionAfterReset,
        roleAfterUpdate,
        sessionAfterLogout,
        sessionAfterDisable,
      });
    }

    if (pathname === "/authorization" && request.method === "POST") {
      const mailer = new MockAuthMailer();
      const lifecycle = createAccountLifecycle({ turnstile: new MockTurnstileVerifier(), mailer });
      const lifecycleRequest = (cookie = "") => new Request(request.url, {
        method: "POST",
        headers: { origin: new URL(request.url).origin, ...(cookie ? { cookie } : {}) },
      });
      const email = `authorization-${crypto.randomUUID()}@example.com`;
      const password = "contract-password-123";
      await lifecycle.execute({
        action: "register", request: lifecycleRequest(), email, displayName: "Authorization Contract",
        password, turnstileToken: "authorization-token",
        ageConfirmed: true, termsAccepted: true, privacyAccepted: true,
      });
      const token = mailer.calls[0]?.token;
      if (!token) throw new Error("注册没有生成验证 token");
      await lifecycle.execute({ action: "verify-email", request: lifecycleRequest(), token });
      const login = await lifecycle.execute({ action: "login", request: lifecycleRequest(), email, password });
      if (!login.cookie) throw new Error("登录没有创建 session cookie");
      const authorizedRequest = lifecycleRequest(login.cookie);
      const before = await sessionAuthorization.require(authorizedRequest);
      await lifecycle.execute({ action: "update-user", id: before.id, role: "admin" });
      const administrator = await sessionAuthorization.requireAdministrator(authorizedRequest);
      await lifecycle.execute({ action: "update-user", id: before.id, status: "disabled" });
      const after = await sessionAuthorization.optional(authorizedRequest);
      return Response.json({ before, administrator, after });
    }

    if (pathname === "/account-mail-timeout" && request.method === "POST") {
      const mailer = new MockAuthMailer({}, undefined, true);
      const lifecycle = createAccountLifecycle({
        turnstile: new MockTurnstileVerifier(), mailer, externalTimeoutMs: 5, externalRetries: 1,
      });
      const email = `mail-timeout-${crypto.randomUUID()}@example.com`;
      try {
        await lifecycle.execute({
          action: "register",
          request: new Request(request.url, { method: "POST", headers: { origin: new URL(request.url).origin } }),
          email,
          displayName: "Mail Timeout",
          password: "contract-password-123",
          turnstileToken: "contract-token",
          ageConfirmed: true, termsAccepted: true, privacyAccepted: true,
        });
        throw new Error("邮件超时没有失败");
      } catch (error) {
        if (!(error instanceof AuthError)) throw error;
        const pending = await drizzleD1AccountStore.findByEmail(email);
        return Response.json({
          status: error.status, message: error.message, calls: mailer.calls.length,
          pendingExpiresAt: pending?.pendingExpiresAt || null,
        });
      }
    }

    if (pathname === "/account-port-resilience" && request.method === "POST") {
      const requestForLifecycle = () => new Request(request.url, {
        method: "POST", headers: { origin: new URL(request.url).origin },
      });
      const hangingTurnstile = new MockTurnstileVerifier(undefined, true);
      const timeoutLifecycle = createAccountLifecycle({
        turnstile: hangingTurnstile, mailer: new MockAuthMailer(), externalTimeoutMs: 5, externalRetries: 1,
      });
      let turnstileTimeoutStatus = 0;
      try {
        await timeoutLifecycle.execute({
          action: "register", request: requestForLifecycle(),
          email: `turnstile-timeout-${crypto.randomUUID()}@example.com`, displayName: "Turnstile Timeout",
          password: "contract-password-123", turnstileToken: "timeout-token",
          ageConfirmed: true, termsAccepted: true, privacyAccepted: true,
        });
      } catch (error) {
        if (!(error instanceof AuthError)) throw error;
        turnstileTimeoutStatus = error.status;
      }

      let mailCalls = 0;
      const mailIdempotencyKeys: string[] = [];
      const retryingMailer = {
        async send(...args: [Request, string, "verify_email" | "reset_password", string, { idempotencyKey: string }?]) {
          const attempt = args[4];
          mailCalls += 1;
          if (attempt) mailIdempotencyKeys.push(attempt.idempotencyKey);
          if (mailCalls === 1) throw new AuthError("邮件发送失败，请稍后重试", 502);
          return {};
        },
      };
      const retryLifecycle = createAccountLifecycle({
        turnstile: new MockTurnstileVerifier(), mailer: retryingMailer, externalTimeoutMs: 50, externalRetries: 1,
      });
      const registration = await retryLifecycle.execute({
        action: "register", request: requestForLifecycle(),
        email: `mail-retry-${crypto.randomUUID()}@example.com`, displayName: "Mail Retry",
        password: "contract-password-123", turnstileToken: "retry-token",
        ageConfirmed: true, termsAccepted: true, privacyAccepted: true,
      });
      return Response.json({
        turnstileTimeout: {
          status: turnstileTimeoutStatus,
          calls: hangingTurnstile.calls.length,
          sameKey: new Set(hangingTurnstile.idempotencyKeys).size === 1,
        },
        mailRetry: { status: registration.status, calls: mailCalls, sameKey: new Set(mailIdempotencyKeys).size === 1 },
      });
    }

    if (pathname === "/account-forgot-enumeration" && request.method === "POST") {
      const requestForLifecycle = () => new Request(request.url, {
        method: "POST", headers: { origin: new URL(request.url).origin },
      });
      const setupMailer = new MockAuthMailer();
      const setup = createAccountLifecycle({ turnstile: new MockTurnstileVerifier(), mailer: setupMailer });
      const email = `forgot-enumeration-${crypto.randomUUID()}@example.com`;
      await setup.execute({
        action: "register", request: requestForLifecycle(), email, displayName: "Forgot Enumeration",
        password: "contract-password-123", turnstileToken: "register-token",
        ageConfirmed: true, termsAccepted: true, privacyAccepted: true,
      });
      const verificationToken = setupMailer.calls.at(-1)?.token;
      if (!verificationToken) throw new Error("没有验证 token");
      await setup.execute({ action: "verify-email", request: requestForLifecycle(), token: verificationToken });
      const lifecycle = createAccountLifecycle({
        turnstile: new MockTurnstileVerifier(), mailer: new MockAuthMailer({}, undefined, true),
        externalTimeoutMs: 5, externalRetries: 1,
      });
      const outcome = async (candidate: string) => {
        try {
          const result = await lifecycle.execute({
            action: "forgot-password", request: requestForLifecycle(), email: candidate, turnstileToken: "forgot-token",
          });
          return { status: result.status ?? 200, message: result.body.message };
        } catch (error) {
          if (!(error instanceof AuthError)) throw error;
          return { status: error.status, message: error.message };
        }
      };
      return Response.json({
        existing: await outcome(email),
        missing: await outcome(`missing-${crypto.randomUUID()}@example.com`),
      });
    }

    if (pathname === "/account-security" && request.method === "POST") {
      const lifecycleRequest = () => new Request(request.url, {
        method: "POST", headers: { origin: new URL(request.url).origin, "cf-connecting-ip": crypto.randomUUID() },
      });
      const statusOf = async (operation: () => Promise<unknown>) => {
        try {
          await operation();
          return 200;
        } catch (error) {
          if (!(error instanceof AuthError)) throw error;
          return error.status;
        }
      };
      const mailer = new MockAuthMailer();
      const lifecycle = createAccountLifecycle({ turnstile: new MockTurnstileVerifier(), mailer });
      const email = `account-security-${crypto.randomUUID()}@example.com`;
      const password = "contract-password-123";
      await lifecycle.execute({
        action: "register", request: lifecycleRequest(), email, displayName: "Account Security",
        password, turnstileToken: "register-token",
        ageConfirmed: true, termsAccepted: true, privacyAccepted: true,
      });
      const pendingLogin = await statusOf(() => lifecycle.execute({ action: "login", request: lifecycleRequest(), email, password }));
      const verificationToken = mailer.calls.at(-1)?.token;
      if (!verificationToken) throw new Error("没有验证 token");
      await lifecycle.execute({ action: "verify-email", request: lifecycleRequest(), token: verificationToken });
      const login = await lifecycle.execute({ action: "login", request: lifecycleRequest(), email, password });
      const user = login.body.user as { id: string };

      const expiredVerificationMailer = new MockAuthMailer();
      const expiredVerificationLifecycle = createAccountLifecycle({
        turnstile: new MockTurnstileVerifier(), mailer: expiredVerificationMailer, verificationTokenLifetimeMs: -1,
      });
      await expiredVerificationLifecycle.execute({
        action: "register", request: lifecycleRequest(), email: `expired-${crypto.randomUUID()}@example.com`,
        displayName: "Expired Verification", password, turnstileToken: "expired-token",
        ageConfirmed: true, termsAccepted: true, privacyAccepted: true,
      });
      const expiredVerificationToken = expiredVerificationMailer.calls.at(-1)?.token;
      if (!expiredVerificationToken) throw new Error("没有过期验证 token");
      const expiredVerification = await statusOf(() => expiredVerificationLifecycle.execute({
        action: "verify-email", request: lifecycleRequest(), token: expiredVerificationToken,
      }));

      const resetMailer = new MockAuthMailer();
      const resetLifecycle = createAccountLifecycle({
        turnstile: new MockTurnstileVerifier(), mailer: resetMailer, resetTokenLifetimeMs: -1,
      });
      await resetLifecycle.execute({
        action: "forgot-password", request: lifecycleRequest(), email, turnstileToken: "forgot-token",
      });
      const expiredResetToken = resetMailer.calls.at(-1)?.token;
      if (!expiredResetToken) throw new Error("没有过期重置 token");
      const expiredReset = await statusOf(() => resetLifecycle.execute({
        action: "reset-password", request: lifecycleRequest(), token: expiredResetToken, password: "replacement-password-456",
      }));
      await lifecycle.execute({ action: "update-user", id: user.id, status: "disabled" });
      const disabledLogin = await statusOf(() => lifecycle.execute({ action: "login", request: lifecycleRequest(), email, password }));

      const limitedEmail = `limited-${crypto.randomUUID()}@example.com`;
      const limitedRequest = () => new Request(request.url, {
        method: "POST", headers: { origin: new URL(request.url).origin, "cf-connecting-ip": "203.0.113.10" },
      });
      for (let index = 0; index < 4; index += 1) {
        await lifecycle.execute({
          action: "forgot-password", request: limitedRequest(), email: limitedEmail, turnstileToken: `limited-${index}`,
        });
      }
      const rateLimited = await statusOf(() => lifecycle.execute({
        action: "forgot-password", request: limitedRequest(), email: limitedEmail, turnstileToken: "limited-final",
      }));
      return Response.json({ pendingLogin, disabledLogin, expiredVerification, expiredReset, rateLimited });
    }

    return Response.json({ error: "not implemented" }, { status: 501 });
  },
};

export default lifecycleWorker;
