import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { storyFixture } from "./story-fixture.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const port = 43100 + (process.pid % 500);
const origin = `http://localhost:${port}`;
let server;
let serverOutput = "";
let persistencePath;
let testWranglerPath;
let adminCookie = "";
let adminNovelId = "";

async function requestJson(path, { method = "GET", cookie = "", body } = {}) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json", origin }),
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { response, payload: await response.json() };
}

function publishableStory(title) {
  const story = structuredClone(storyFixture());
  story.title = title;
  story.coverAssetId = "";
  story.coverUrl = "https://example.com/test-cover.jpg";
  story.openingImageAssetId = "";
  story.openingImageUrl = "https://example.com/test-opening.jpg";
  story.openingImageAlt = `${title}开场图`;
  story.outroImageAssetId = "";
  story.outroImageUrl = "https://example.com/test-outro.jpg";
  return story;
}

async function createAuthorAccount(label) {
  const email = `${label}-${process.pid}@example.com`;
  const registration = await requestJson("/api/auth/register", {
    method: "POST",
    body: { email, displayName: label, password: "test-password-123", turnstileToken: "" },
  });
  assert.equal(registration.response.status, 201);
  const verification = await requestJson("/api/auth/verify-email", {
    method: "POST",
    body: { token: registration.payload.developmentToken },
  });
  assert.equal(verification.response.status, 200);
  const login = await requestJson("/api/auth/login", {
    method: "POST",
    body: { email, password: "test-password-123" },
  });
  assert.equal(login.response.status, 200);
  const cookie = login.response.headers.get("set-cookie")?.split(";")[0] || "";
  const users = (await requestJson("/admin/api/users", { cookie: adminCookie })).payload.users;
  const user = users.find((candidate) => candidate.email === email);
  assert.ok(user);
  const promotion = await requestJson("/admin/api/users", {
    method: "PATCH",
    cookie: adminCookie,
    body: { id: user.id, role: "author" },
  });
  assert.equal(promotion.response.status, 200);
  return { cookie, id: user.id };
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server?.exitCode !== null) throw new Error(`开发服务器提前退出：\n${serverOutput}`);
    try {
      const response = await fetch(`${origin}/api/chapters`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`等待开发服务器超时：\n${serverOutput}`);
}

before(async () => {
  persistencePath = await mkdtemp(join(tmpdir(), "mist-page-d1-test-"));
  testWranglerPath = join(persistencePath, "wrangler.test.json");
  const wranglerConfig = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  delete wranglerConfig.$schema;
  wranglerConfig.main = join(projectRoot, "worker/index.ts");
  wranglerConfig.vars = {
    CREATOR_PASSWORD_HASH: createHash("sha256").update("test-creator-password").digest("hex"),
    CREATOR_SESSION_SECRET: "test-session-secret-that-is-at-least-32-characters",
    LOCAL_ADMIN_BYPASS: "false",
    LOCAL_AUTH_BYPASS: "true",
  };
  wranglerConfig.d1_databases = wranglerConfig.d1_databases.map((database) => ({
    ...database,
    migrations_dir: join(projectRoot, "drizzle"),
  }));
  await writeFile(testWranglerPath, JSON.stringify(wranglerConfig));
  const migration = spawnSync("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "mist-page-fiction-db", "--local", "--persist-to", persistencePath], {
    cwd: projectRoot,
    env: process.env,
    encoding: "utf8",
  });
  assert.equal(migration.status, 0, `本地 D1 迁移失败：\n${migration.stdout}\n${migration.stderr}`);
  server = spawn("pnpm", ["exec", "vinext", "dev", "--port", String(port)], {
    cwd: projectRoot,
    env: {
      ...process.env,
      WRANGLER_LOG_PATH: ".wrangler/test.log",
      CLOUDFLARE_PERSIST_PATH: persistencePath,
      CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH: testWranglerPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const collect = (chunk) => { serverOutput = `${serverOutput}${chunk}`.slice(-20_000); };
  server.stdout.on("data", collect);
  server.stderr.on("data", collect);
  await waitForServer();
});

after(async () => {
  if (server && server.exitCode === null) {
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 2_000);
      server.once("exit", () => { clearTimeout(timeout); resolve(); });
      server.kill("SIGTERM");
    });
  }
  if (persistencePath) await rm(persistencePath, { recursive: true, force: true });
});

test("公开页面与后台页面由 Vinext Worker 正常渲染", async () => {
  const [home, admin] = await Promise.all([fetch(`${origin}/`), fetch(`${origin}/admin`)]);
  assert.equal(home.status, 200);
  assert.equal(admin.status, 200);
  assert.match(home.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.match(admin.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.match(await home.text(), /幻界|Fantasy/i);
  assert.match(await admin.text(), /创作后台/);
});

test("公开 API 只返回已发布内容，创作者登录后才能访问管理员 API", async () => {
  const published = await fetch(`${origin}/api/chapters`);
  assert.equal(published.status, 200);
  const payload = await published.json();
  assert.ok(payload.chapters.every((chapter) => chapter.status === "published" && chapter.published && !("draft" in chapter)));

  const publicWrite = await fetch(`${origin}/api/chapters`, { method: "POST" });
  assert.equal(publicWrite.status, 405);
  const adminRead = await fetch(`${origin}/admin/api/chapters`);
  assert.equal(adminRead.status, 401);
  assert.match((await adminRead.json()).error, /创作者账号/);
  const login = await fetch(`${origin}/admin/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ password: "test-creator-password" }),
  });
  assert.equal(login.status, 200);
  adminCookie = login.headers.get("set-cookie")?.split(";")[0] || "";
  assert.match(adminCookie, /^fantasy_creator_session=v1\./);
  const session = await fetch(`${origin}/admin/api/session`, { headers: { cookie: adminCookie } });
  assert.equal(session.status, 200);
  assert.deepEqual(await session.json(), {
    authenticated: true,
    role: "admin",
    email: "creator",
  });
  const createdNovel = await fetch(`${origin}/admin/api/novels`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, cookie: adminCookie },
    body: JSON.stringify({ action: "create" }),
  });
  assert.equal(createdNovel.status, 201);
  adminNovelId = (await createdNovel.json()).id;
  const novelRows = (await (await fetch(`${origin}/admin/api/novels`, { headers: { cookie: adminCookie } })).json()).novels;
  const novelDraft = structuredClone(novelRows[0].draft);
  novelDraft.name = "测试小说";
  novelDraft.summary = "测试小说简介";
  novelDraft.coverAssetId = "";
  novelDraft.coverUrl = "https://example.com/novel-cover.jpg";
  novelDraft.coverAlt = "测试小说封面";
  const publishNovel = await fetch(`${origin}/admin/api/novels`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, cookie: adminCookie },
    body: JSON.stringify({ action: "publish", id: adminNovelId, novel: novelDraft }),
  });
  assert.equal(publishNovel.status, 200, await publishNovel.text());
  const created = await fetch(`${origin}/admin/api/chapters`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, cookie: adminCookie },
    body: JSON.stringify({ action: "create", meta: { novelId: adminNovelId } }),
  });
  assert.equal(created.status, 201);
  const chapters = (await (await fetch(`${origin}/admin/api/chapters`, { headers: { cookie: adminCookie } })).json()).chapters;
  assert.equal(chapters.length, 1);
  assert.equal(chapters[0].title, "未命名章节");
  assert.equal(chapters[0].draft.nodes.length, 1);
  assert.equal(chapters[0].draft.nodes[0].body, "");
});

test("读者注册验证登录后可访问云端进度，管理员可升级为作者", async () => {
  const email = `reader-${process.pid}@example.com`;
  const register = await fetch(`${origin}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ email, displayName: "测试读者", password: "test-password-123", turnstileToken: "" }),
  });
  assert.equal(register.status, 201);
  const registration = await register.json();
  assert.ok(registration.developmentToken);
  const verify = await fetch(`${origin}/api/auth/verify-email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ token: registration.developmentToken }),
  });
  assert.equal(verify.status, 200);
  const login = await fetch(`${origin}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ email, password: "test-password-123" }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie");
  assert.match(cookie ?? "", /^mist_session=/);
  assert.match(cookie ?? "", /HttpOnly/);
  assert.match(cookie ?? "", /SameSite=Lax/);
  const me = await fetch(`${origin}/api/auth/me`, { headers: { cookie: cookie.split(";")[0] } });
  assert.equal((await me.json()).user.role, "reader");
  const sessionCookie = cookie.split(";")[0];
  const progress = await fetch(`${origin}/api/account/progress`, { headers: { cookie: sessionCookie } });
  assert.equal(progress.status, 200);
  assert.deepEqual((await progress.json()).progress, []);
  const adminChapters = (await (await fetch(`${origin}/admin/api/chapters`, { headers: { cookie: adminCookie } })).json()).chapters;
  const publishedStory = structuredClone(storyFixture());
  publishedStory.coverAssetId = "";
  publishedStory.coverUrl = "https://example.com/test-cover.jpg";
  publishedStory.openingImageAssetId = "";
  publishedStory.openingImageUrl = "https://example.com/test-cover.jpg";
  publishedStory.openingImageAlt = "测试开场图";
  publishedStory.outroImageAssetId = "";
  publishedStory.outroImageUrl = "https://example.com/test-outro.jpg";
  publishedStory.nodes[0].choices[0].terminalFeedbackEnabled = true;
  publishedStory.nodes[0].choices[0].terminalMessage = "任务状态已更新";
  publishedStory.nodes[0].choices[0].terminalSpeak = false;
  publishedStory.nodes[0].choices[0].terminalTaskActions = [{ id: "task-status-active", type: "setTaskStatus", task: null, objective: null, objectiveId: "", status: "active" }];
  const publish = await fetch(`${origin}/admin/api/chapters`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, cookie: adminCookie },
    body: JSON.stringify({ action: "publish", id: adminChapters[0].id, story: publishedStory }),
  });
  assert.equal(publish.status, 200, await publish.text());
  const baseTime = Date.now() - 10_000;
  const putProgress = (body) => fetch(`${origin}/api/account/progress`, {
    method: "PUT",
    headers: { "content-type": "application/json", origin, cookie: sessionCookie },
    body: JSON.stringify({ chapterId: adminChapters[0].id, ...body }),
  });
  assert.equal((await putProgress({ nodeId: "branch-a", pageIndex: 0, terminalEventIds: ["task-status-active", "unknown"], updatedAt: new Date(baseTime).toISOString(), completed: false })).status, 200);
  const taskProgress = await (await fetch(`${origin}/api/account/progress?chapterId=${adminChapters[0].id}`, { headers: { cookie: sessionCookie } })).json();
  assert.deepEqual(taskProgress.progress.terminalEventIds, ["task-status-active"]);
  const completedAt = new Date(baseTime + 2_000).toISOString();
  assert.equal((await putProgress({ nodeId: "ending-a", pageIndex: 0, updatedAt: completedAt, completed: true })).status, 200);
  assert.equal((await putProgress({ nodeId: "branch-b", pageIndex: 0, updatedAt: new Date(baseTime + 1_000).toISOString(), completed: false })).status, 200);
  const completedRecord = await (await fetch(`${origin}/api/account/progress?chapterId=${adminChapters[0].id}`, { headers: { cookie: sessionCookie } })).json();
  assert.equal(completedRecord.progress.nodeId, "ending-a");
  assert.equal(completedRecord.progress.completedAt, completedAt);
  const pendingAfterCompletion = await (await fetch(`${origin}/api/account/progress`, { headers: { cookie: sessionCookie } })).json();
  assert.deepEqual(pendingAfterCompletion.progress, []);
  assert.equal((await putProgress({ nodeId: "start", pageIndex: 0, updatedAt: new Date(baseTime + 3_000).toISOString(), completed: false })).status, 200);
  const restarted = await (await fetch(`${origin}/api/account/progress`, { headers: { cookie: sessionCookie } })).json();
  assert.equal(restarted.progress[0].nodeId, "start");
  assert.equal(restarted.progress[0].completedAt, null);
  const users = (await (await fetch(`${origin}/admin/api/users`, { headers: { cookie: adminCookie } })).json()).users;
  const reader = users.find((user) => user.email === email);
  assert.ok(reader);
  const promote = await fetch(`${origin}/admin/api/users`, {
    method: "PATCH",
    headers: { "content-type": "application/json", origin, cookie: adminCookie },
    body: JSON.stringify({ id: reader.id, role: "author" }),
  });
  assert.equal(promote.status, 200);
  const authorChapters = await fetch(`${origin}/studio/api/chapters`, {
    headers: { cookie: cookie.split(";")[0] },
  });
  assert.equal(authorChapters.status, 200);
  assert.deepEqual((await authorChapters.json()).chapters, []);
  const logout = await fetch(`${origin}/api/auth/logout`, {
    method: "POST",
    headers: { cookie: cookie.split(";")[0], origin },
  });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie") ?? "", /Max-Age=0/);
});

test("创作者与管理员的小说章节生命周期保持兼容", async (t) => {
  const authorA = await createAuthorAccount("契约作者甲");
  const authorB = await createAuthorAccount("契约作者乙");
  const authorPost = (path, cookie, body) => requestJson(path, { method: "POST", cookie, body });
  const adminPost = (path, body) => requestJson(path, { method: "POST", cookie: adminCookie, body });

  await t.test("平台作品与作者作品按所有权隔离", async () => {
    const platformNovels = (await requestJson("/admin/api/novels", { cookie: adminCookie })).payload.novels;
    const platformNovel = platformNovels.find((novel) => novel.id === adminNovelId);
    assert.ok(platformNovel);
    assert.equal(platformNovel.ownerId, null);
    assert.equal(platformNovel.status, "published");
    assert.equal(platformNovel.version, 1);

    const authorNovels = (await requestJson("/studio/api/novels", { cookie: authorA.cookie })).payload.novels;
    assert.ok(!authorNovels.some((novel) => novel.id === adminNovelId));
    const forbiddenSave = await authorPost("/studio/api/novels", authorA.cookie, {
      action: "save",
      id: adminNovelId,
      novel: platformNovel.draft,
    });
    assert.equal(forbiddenSave.response.status, 403);
    assert.equal(forbiddenSave.payload.error, "不能修改其他作者的小说");
  });

  let novelId = "";
  let publishedNovel;
  await t.test("作者小说经过提交、撤回、驳回、发布、下线与回滚", async () => {
    const created = await authorPost("/studio/api/novels", authorA.cookie, { action: "create" });
    assert.equal(created.response.status, 201);
    novelId = created.payload.id;

    const initialRows = (await requestJson("/studio/api/novels", { cookie: authorA.cookie })).payload.novels;
    const initial = initialRows.find((novel) => novel.id === novelId);
    assert.deepEqual(
      { ownerId: initial.ownerId, status: initial.status, draftStatus: initial.draftStatus, version: initial.version },
      { ownerId: authorA.id, status: "draft", draftStatus: "draft", version: 0 },
    );
    const draft = structuredClone(initial.draft);
    draft.name = "契约测试小说";
    draft.summary = "用于锁定创作者与管理员审核、发布和版本回滚行为。";
    draft.coverAssetId = "";
    draft.coverUrl = "https://example.com/contract-novel.jpg";
    draft.coverAlt = "契约测试小说封面";

    const otherAuthorRows = (await requestJson("/studio/api/novels", { cookie: authorB.cookie })).payload.novels;
    assert.ok(!otherAuthorRows.some((novel) => novel.id === novelId));
    const forbiddenDuplicate = await authorPost("/studio/api/novels", authorB.cookie, { action: "duplicate", id: novelId });
    assert.equal(forbiddenDuplicate.response.status, 403);
    assert.equal(forbiddenDuplicate.payload.error, "只能复制自己的小说");

    assert.equal((await authorPost("/studio/api/novels", authorA.cookie, { action: "save", id: novelId, novel: draft })).response.status, 200);
    assert.equal((await authorPost("/studio/api/novels", authorA.cookie, { action: "submit", id: novelId, novel: draft })).response.status, 200);
    let current = (await requestJson("/studio/api/novels", { cookie: authorA.cookie })).payload.novels.find((novel) => novel.id === novelId);
    assert.equal(current.draftStatus, "submitted");
    assert.ok(current.submittedAt);

    const lockedSave = await authorPost("/studio/api/novels", authorA.cookie, { action: "save", id: novelId, novel: draft });
    assert.equal(lockedSave.response.status, 400);
    assert.equal(lockedSave.payload.error, "审核中的小说资料已锁定，请先撤回");
    assert.equal((await authorPost("/studio/api/novels", authorA.cookie, { action: "withdraw", id: novelId })).response.status, 200);
    const rejectWithdrawn = await adminPost("/admin/api/novels", { action: "reject", id: novelId, meta: { reviewNote: "不应接受" } });
    assert.equal(rejectWithdrawn.response.status, 400);
    assert.equal(rejectWithdrawn.payload.error, "小说当前不在审核中");

    assert.equal((await authorPost("/studio/api/novels", authorA.cookie, { action: "submit", id: novelId, novel: draft })).response.status, 200);
    assert.equal((await adminPost("/admin/api/novels", { action: "reject", id: novelId, meta: { reviewNote: "请补充世界观说明" } })).response.status, 200);
    current = (await requestJson("/studio/api/novels", { cookie: authorA.cookie })).payload.novels.find((novel) => novel.id === novelId);
    assert.equal(current.draftStatus, "draft");
    assert.equal(current.submittedAt, null);
    assert.equal(current.reviewNote, "请补充世界观说明");

    assert.equal((await authorPost("/studio/api/novels", authorA.cookie, { action: "save", id: novelId, novel: draft })).response.status, 200);
    assert.equal((await authorPost("/studio/api/novels", authorA.cookie, { action: "submit", id: novelId, novel: draft })).response.status, 200);
    assert.equal((await adminPost("/admin/api/novels", { action: "publish", id: novelId, novel: draft })).response.status, 200);
    current = (await requestJson("/admin/api/novels", { cookie: adminCookie })).payload.novels.find((novel) => novel.id === novelId);
    assert.deepEqual(
      { ownerId: current.ownerId, status: current.status, draftStatus: current.draftStatus, version: current.version, reviewNote: current.reviewNote },
      { ownerId: authorA.id, status: "published", draftStatus: "draft", version: 1, reviewNote: "" },
    );
    publishedNovel = structuredClone(current.published);
    const rejectedDelete = await authorPost("/studio/api/novels", authorA.cookie, { action: "delete", id: novelId });
    assert.equal(rejectedDelete.response.status, 400);
    assert.equal(rejectedDelete.payload.error, "只能删除未发布且未提交审核的小说");

    const changedDraft = structuredClone(draft);
    changedDraft.name = "尚未发布的小说改名";
    assert.equal((await authorPost("/studio/api/novels", authorA.cookie, { action: "save", id: novelId, novel: changedDraft })).response.status, 200);
    assert.equal((await adminPost("/admin/api/novels", { action: "offline", id: novelId })).response.status, 200);
    assert.equal((await adminPost("/admin/api/novels", { action: "rollback", id: novelId, version: 1 })).response.status, 200);
    current = (await requestJson("/admin/api/novels", { cookie: adminCookie })).payload.novels.find((novel) => novel.id === novelId);
    assert.equal(current.status, "published");
    assert.equal(current.version, 2);
    assert.equal(current.published.name, publishedNovel.name);
    assert.equal(current.draft.name, publishedNovel.name);
    const versions = (await requestJson(`/admin/api/novels/versions?novelId=${novelId}`, { cookie: adminCookie })).payload.versions;
    assert.deepEqual(versions.map((version) => version.version), [2, 1]);
  });

  let chapterId = "";
  await t.test("作者章节遵守审核锁定、父级发布和公开可见性约束", async () => {
    const created = await authorPost("/studio/api/chapters", authorA.cookie, { action: "create", meta: { novelId } });
    assert.equal(created.response.status, 201);
    chapterId = created.payload.id;
    const initial = (await requestJson("/studio/api/chapters", { cookie: authorA.cookie })).payload.chapters.find((chapter) => chapter.id === chapterId);
    assert.deepEqual(
      { ownerId: initial.ownerId, novelId: initial.novelId, status: initial.status, draftStatus: initial.draftStatus, version: initial.version },
      { ownerId: authorA.id, novelId, status: "draft", draftStatus: "draft", version: 0 },
    );
    const story = publishableStory("契约测试章节");

    const otherAuthorRows = (await requestJson("/studio/api/chapters", { cookie: authorB.cookie })).payload.chapters;
    assert.ok(!otherAuthorRows.some((chapter) => chapter.id === chapterId));
    const forbiddenDuplicate = await authorPost("/studio/api/chapters", authorB.cookie, { action: "duplicate", id: chapterId });
    assert.equal(forbiddenDuplicate.response.status, 403);
    assert.equal(forbiddenDuplicate.payload.error, "只能复制自己的章节");

    assert.equal((await authorPost("/studio/api/chapters", authorA.cookie, { action: "save", id: chapterId, story })).response.status, 200);
    assert.equal((await authorPost("/studio/api/chapters", authorA.cookie, { action: "submit", id: chapterId, story })).response.status, 200);
    const lockedSave = await authorPost("/studio/api/chapters", authorA.cookie, { action: "save", id: chapterId, story });
    assert.equal(lockedSave.response.status, 400);
    assert.equal(lockedSave.payload.error, "审核中的草稿已锁定，请先撤回");
    assert.equal((await authorPost("/studio/api/chapters", authorA.cookie, { action: "withdraw", id: chapterId })).response.status, 200);
    const rejectWithdrawn = await adminPost("/admin/api/chapters", { action: "reject", id: chapterId, meta: { reviewNote: "不应接受" } });
    assert.equal(rejectWithdrawn.response.status, 400);
    assert.equal(rejectWithdrawn.payload.error, "章节当前不在审核中");

    assert.equal((await authorPost("/studio/api/chapters", authorA.cookie, { action: "submit", id: chapterId, story })).response.status, 200);
    assert.equal((await adminPost("/admin/api/chapters", { action: "reject", id: chapterId, meta: { reviewNote: "请补充结局反馈" } })).response.status, 200);
    let current = (await requestJson("/studio/api/chapters", { cookie: authorA.cookie })).payload.chapters.find((chapter) => chapter.id === chapterId);
    assert.equal(current.draftStatus, "draft");
    assert.equal(current.submittedAt, null);
    assert.equal(current.reviewNote, "请补充结局反馈");
    assert.equal((await authorPost("/studio/api/chapters", authorA.cookie, { action: "save", id: chapterId, story })).response.status, 200);
    assert.equal((await authorPost("/studio/api/chapters", authorA.cookie, { action: "submit", id: chapterId, story })).response.status, 200);

    assert.equal((await adminPost("/admin/api/novels", { action: "offline", id: novelId })).response.status, 200);
    const unpublishedParent = await adminPost("/admin/api/chapters", { action: "publish", id: chapterId, story });
    assert.equal(unpublishedParent.response.status, 400);
    assert.equal(unpublishedParent.payload.error, "请先发布所属小说资料，再发布章节");
    assert.equal((await adminPost("/admin/api/novels", { action: "rollback", id: novelId, version: 1 })).response.status, 200);
    assert.equal((await adminPost("/admin/api/chapters", { action: "publish", id: chapterId, story })).response.status, 200);
    current = (await requestJson("/admin/api/chapters", { cookie: adminCookie })).payload.chapters.find((chapter) => chapter.id === chapterId);
    assert.deepEqual(
      { ownerId: current.ownerId, status: current.status, draftStatus: current.draftStatus, version: current.version, reviewNote: current.reviewNote },
      { ownerId: authorA.id, status: "published", draftStatus: "draft", version: 1, reviewNote: "" },
    );
    const publishedStory = structuredClone(current.published);
    const rejectedDelete = await authorPost("/studio/api/chapters", authorA.cookie, { action: "delete", id: chapterId });
    assert.equal(rejectedDelete.response.status, 400);
    assert.equal(rejectedDelete.payload.error, "只能删除未发布且未提交审核的草稿");

    const changedStory = structuredClone(story);
    changedStory.title = "尚未发布的章节改名";
    assert.equal((await authorPost("/studio/api/chapters", authorA.cookie, { action: "save", id: chapterId, story: changedStory })).response.status, 200);
    assert.equal((await adminPost("/admin/api/chapters", { action: "offline", id: chapterId })).response.status, 200);
    assert.equal((await adminPost("/admin/api/chapters", { action: "rollback", id: chapterId, version: 1 })).response.status, 200);
    current = (await requestJson("/admin/api/chapters", { cookie: adminCookie })).payload.chapters.find((chapter) => chapter.id === chapterId);
    assert.equal(current.status, "published");
    assert.equal(current.version, 2);
    assert.equal(current.published.title, publishedStory.title);
    assert.equal(current.draft.title, publishedStory.title);
    const versions = (await requestJson(`/admin/api/chapters/versions?chapterId=${chapterId}`, { cookie: adminCookie })).payload.versions;
    assert.deepEqual(versions.map((version) => version.version), [2, 1]);

    let publicChapters = (await requestJson(`/api/chapters?novelId=${novelId}`)).payload.chapters;
    assert.ok(publicChapters.some((chapter) => chapter.id === chapterId));
    let publicNovels = (await requestJson("/api/novels")).payload.novels;
    assert.ok(publicNovels.some((novel) => novel.id === novelId && novel.chapters.some((chapter) => chapter.id === chapterId)));

    assert.equal((await adminPost("/admin/api/novels", { action: "offline", id: novelId })).response.status, 200);
    publicChapters = (await requestJson(`/api/chapters?novelId=${novelId}`)).payload.chapters;
    assert.ok(!publicChapters.some((chapter) => chapter.id === chapterId));
    publicNovels = (await requestJson("/api/novels")).payload.novels;
    assert.ok(!publicNovels.some((novel) => novel.id === novelId));
    current = (await requestJson("/admin/api/chapters", { cookie: adminCookie })).payload.chapters.find((chapter) => chapter.id === chapterId);
    assert.equal(current.status, "published");
    assert.equal(current.version, 2);

    assert.equal((await adminPost("/admin/api/novels", { action: "rollback", id: novelId, version: 1 })).response.status, 200);
    const novelVersions = (await requestJson(`/admin/api/novels/versions?novelId=${novelId}`, { cookie: adminCookie })).payload.versions;
    assert.deepEqual(novelVersions.map((version) => version.version), [4, 3, 2, 1]);
    publicChapters = (await requestJson(`/api/chapters?novelId=${novelId}`)).payload.chapters;
    assert.ok(publicChapters.some((chapter) => chapter.id === chapterId));
  });
});

test("未配置 AI 提供商密钥时明确拒绝生成且不回退本地合成", async () => {
  const generated = await fetch(`${origin}/admin/api/assets/sfx`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, cookie: adminCookie },
    body: JSON.stringify({ choiceText: "启动跃迁", interactionPreset: "glitch", prompt: "短促的数字故障声", generationDurationSeconds: 1.2 }),
  });
  assert.equal(generated.status, 503);
  const payload = await generated.json();
  assert.match(payload.error, /ELEVENLABS_API_KEY/);
  assert.equal(payload.code, "SFX_NOT_CONFIGURED");
});

test("素材读取接口对缺失对象安全返回 404", async () => {
  const response = await fetch(`${origin}/api/assets/not-present`);
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("x-content-type-options"), null);
});

test("旧章节会补齐流程位置和视频字段，结构校验能发现循环与孤立节点", async () => {
  const { normalizeStory, validateStory } = await import("../lib/story.ts");
  const legacy = structuredClone(storyFixture());
  delete legacy.nodes[0].position;
  delete legacy.nodes[0].videoMode;
  const normalized = normalizeStory(legacy);
  assert.deepEqual(normalized.nodes[0].position, { x: 0, y: 0 });
  assert.equal(normalized.nodes[0].videoMode, "none");
  assert.deepEqual(validateStory(normalized), []);

  normalized.nodes[3].choices = [{ id: "cycle", label: "返回", targetId: normalized.startNodeId }];
  normalized.nodes.push({ ...structuredClone(normalized.nodes[4]), id: "orphan", title: "孤立结局", position: { x: 900, y: 500 } });
  const errors = validateStory(normalized).join("；");
  assert.match(errors, /循环路径/);
  assert.match(errors, /无法从开头到达/);
});

test("部署配置只保留 Cloudflare Workers、D1 与 R2", async () => {
  const [wrangler, vite, packageJson] = await Promise.all([
    readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(wrangler, /"main": "\.\/worker\/index\.ts"/);
  assert.match(wrangler, /"binding": "DB"/);
  assert.match(wrangler, /"binding": "ASSET_BUCKET"/);
  assert.match(vite, /@cloudflare\/vite-plugin/);
  assert.doesNotMatch(vite, /sites|hosting\.json/i);
  assert.doesNotMatch(packageJson, /sites/i);
  await assert.rejects(access(new URL("../.openai/hosting.json", import.meta.url)));
});
