import { createAccountLifecycle, MockAuthMailer, MockTurnstileVerifier } from "../db/account-lifecycle";
import { AssetLifecycleError, assetLifecycle } from "../db/assets";
import { creationLifecycle } from "../db/creation-lifecycle";
import { readingSessionProgress } from "../db/reading-session-progress";
import { sessionAuthorization } from "../lib/session-authorization";
import { AuthError } from "../lib/auth";
import { createBlankNovel, createBlankStory } from "../lib/story";

type TestEnv = { ASSET_BUCKET: R2Bucket };

const lifecycleWorker = {
  async fetch(request: Request, workerEnv: TestEnv) {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/health") return Response.json({ ok: true });

    if (pathname === "/reading-progress" && request.method === "GET") {
      return Response.json({ progress: await readingSessionProgress.list(crypto.randomUUID()) });
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
        });
        throw new Error("邮件超时没有失败");
      } catch (error) {
        if (!(error instanceof AuthError)) throw error;
        return Response.json({ status: error.status, message: error.message, calls: mailer.calls.length });
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
