import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { createCloudflareRuntime } from "./cloudflare-runtime-harness.mjs";
import { storyFixture } from "./story-fixture.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const port = 43100 + (process.pid % 500);
const runtime = createCloudflareRuntime({
  main: `${projectRoot}/worker/index.ts`,
  port,
  readinessPath: "/api/chapters",
  launcher: "vinext",
  vars: {
    CREATOR_PASSWORD_HASH: createHash("sha256").update("test-creator-password").digest("hex"),
    CREATOR_SESSION_SECRET: "test-session-secret-that-is-at-least-32-characters",
    LOCAL_ADMIN_BYPASS: "false",
    LOCAL_AUTH_BYPASS: "true",
    REGISTRATION_ENABLED: "true",
    APP_ORIGIN: `http://127.0.0.1:${port}`,
    TERMS_VERSION: "test-terms",
    PRIVACY_VERSION: "test-privacy",
  },
});
const origin = runtime.origin;
let adminCookie = "";
let adminNovelId = "";
const requiredRegistrationConsent = { ageConfirmed: true, termsAccepted: true, privacyAccepted: true };

async function requestText(path, { method = "GET", cookie = "", body } = {}) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json", origin }),
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { response, text };
}

async function requestJson(path, options = {}) {
  const { response, text } = await requestText(path, options);
  const method = options.method || "GET";
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new Error(`${method} ${path} 返回了非 JSON 响应（${response.status}）：${text}\n${runtime.output.slice(-3_000)}`, { cause: error });
  }
  return { response, payload };
}

async function uploadAsset(path, cookie, { name, type, bytes = "asset", duration = 0, folderId = "" }) {
  const form = new FormData();
  form.set("file", new File([bytes], name, { type }));
  form.set("duration", String(duration));
  if (folderId) form.set("folderId", folderId);
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { origin, cookie },
    body: form,
  });
  return { response, payload: await response.json() };
}

function publishableStory(title = "测试章节") {
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
    body: { email, displayName: label, password: "test-password-123", turnstileToken: "", ...requiredRegistrationConsent },
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

before(() => runtime.start());
after(() => runtime.stop());

test("公开页面与后台页面由 Vinext Worker 正常渲染", async () => {
  const [home, admin] = await Promise.all([fetch(`${origin}/`), fetch(`${origin}/admin`)]);
  assert.equal(home.status, 200);
  assert.equal(admin.status, 200);
  assert.match(home.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.match(admin.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.match(await home.text(), /幻界|Fantasy/i);
  assert.match(await admin.text(), /创作后台/);
});

test("公开页面统一通过创作中心解析工作台入口", async () => {
  const homeResponse = await fetch(`${origin}/`);
  assert.equal(homeResponse.status, 200);
  const home = await homeResponse.text();
  assert.match(home, /href="\/creator"/);
  assert.doesNotMatch(home, /href="\/studio"/);

  const creatorResponse = await fetch(`${origin}/creator`);
  assert.equal(creatorResponse.status, 200);
  assert.match(await creatorResponse.text(), /正在确认创作权限/);
});

test("创作工作台解析权限期间不显示空作品状态", async () => {
  for (const path of ["/admin", "/studio"]) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /正在确认创作权限/);
    assert.doesNotMatch(html, /还没有小说/);
  }
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
  assert.match((await adminRead.json()).error, /管理员账号/);
  const protectedGeneration = await fetch(`${origin}/admin/api/assets/sfx`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ choiceText: "测试", interactionPreset: "glow" }),
  });
  assert.equal(protectedGeneration.status, 401);
  assert.equal(protectedGeneration.headers.get("cache-control"), "no-store");
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
    outcome: "allow",
    destination: "admin",
    redirectTo: null,
    reason: "shared_credential",
    accountRole: null,
    source: "shared_credential",
    administrator: { role: "admin", email: "creator", source: "shared_credential" },
    recoveryAvailable: false,
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

test("创作入口按账号最新角色进入对应工作台", async () => {
  const signedOut = await requestJson("/api/auth/creator-entry");
  assert.deepEqual(signedOut.payload, {
    destination: null,
    redirectTo: "/login?next=/creator",
    reason: "signed_out",
    accountRole: null,
  });

  const email = `creator-entry-${process.pid}@example.com`;
  const registration = await requestJson("/api/auth/register", {
    method: "POST",
    body: { email, displayName: "入口角色测试", password: "test-password-123", turnstileToken: "", ...requiredRegistrationConsent },
  });
  assert.equal(registration.response.status, 201);
  assert.equal((await requestJson("/api/auth/verify-email", {
    method: "POST",
    body: { token: registration.payload.developmentToken },
  })).response.status, 200);
  const login = await requestJson("/api/auth/login", {
    method: "POST",
    body: { email, password: "test-password-123" },
  });
  assert.equal(login.response.status, 200);
  const accountCookie = login.response.headers.get("set-cookie")?.split(";")[0] || "";
  const user = (await requestJson("/admin/api/users", { cookie: adminCookie })).payload.users
    .find((candidate) => candidate.email === email);
  assert.ok(user);

  assert.deepEqual((await requestJson("/api/auth/creator-entry", { cookie: accountCookie })).payload, {
    destination: null,
    redirectTo: null,
    reason: "reader_account",
    accountRole: "reader",
  });
  assert.equal((await requestJson("/admin/api/users", {
    method: "PATCH", cookie: adminCookie, body: { id: user.id, role: "author" },
  })).response.status, 200);
  assert.deepEqual((await requestJson("/api/auth/creator-entry", { cookie: accountCookie })).payload, {
    destination: "studio",
    redirectTo: "/studio",
    reason: "author_account",
    accountRole: "author",
  });
  assert.equal((await requestJson("/admin/api/users", {
    method: "PATCH", cookie: adminCookie, body: { id: user.id, role: "admin" },
  })).response.status, 200);
  assert.deepEqual((await requestJson("/api/auth/creator-entry", { cookie: accountCookie })).payload, {
    destination: "admin",
    redirectTo: "/admin",
    reason: "admin_account",
    accountRole: "admin",
  });
  assert.equal((await requestJson("/admin/api/users", {
    method: "PATCH", cookie: adminCookie, body: { id: user.id, status: "disabled" },
  })).response.status, 200);
  assert.deepEqual((await requestJson("/api/auth/creator-entry", { cookie: accountCookie })).payload, {
    destination: null,
    redirectTo: "/login?next=/creator",
    reason: "signed_out",
    accountRole: null,
  });
});

test("读者注册验证登录后可访问云端进度，管理员可升级为作者", async () => {
  const email = `reader-${process.pid}@example.com`;
  const register = await fetch(`${origin}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ email, displayName: "测试读者", password: "test-password-123", turnstileToken: "", ...requiredRegistrationConsent }),
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
  const unauthorizedMemory = await fetch(`${origin}/api/account/guide-memory`);
  assert.equal(unauthorizedMemory.status, 401);
  const initialMemory = await requestJson("/api/account/guide-memory", { cookie: sessionCookie });
  assert.deepEqual(initialMemory.payload.memory.preferences, []);
  const savedMemory = await requestJson("/api/account/guide-memory", {
    method: "PATCH",
    cookie: sessionCookie,
    body: { actorId: "another-account", preferences: ["奇幻", "非法偏好", "轻松"], completeGuide: true },
  });
  assert.equal(savedMemory.response.status, 200);
  assert.deepEqual(savedMemory.payload.memory.preferences, ["奇幻", "轻松"]);
  const crossDeviceMemory = await requestJson("/api/account/guide-memory", { cookie: sessionCookie });
  assert.deepEqual(crossDeviceMemory.payload.memory.preferences, ["奇幻", "轻松"]);
  const clearedMemory = await requestJson("/api/account/guide-memory", { method: "DELETE", cookie: sessionCookie });
  assert.deepEqual(clearedMemory.payload.memory.preferences, []);
  assert.equal(clearedMemory.payload.memory.guideCompletedAt, null);
  const progress = await fetch(`${origin}/api/account/progress`, { headers: { cookie: sessionCookie } });
  assert.equal(progress.status, 200);
  assert.deepEqual((await progress.json()).progress, []);
  const adminChapters = (await (await fetch(`${origin}/admin/api/chapters`, { headers: { cookie: adminCookie } })).json()).chapters;
  const publishedStory = publishableStory();
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

  await t.test("作者与管理员可以复制、保存和删除自己的未发布草稿", async () => {
    const authorNovel = await authorPost("/studio/api/novels", authorA.cookie, { action: "create" });
    assert.equal(authorNovel.response.status, 201);
    const authorNovelCopy = await authorPost("/studio/api/novels", authorA.cookie, { action: "duplicate", id: authorNovel.payload.id });
    assert.equal(authorNovelCopy.response.status, 201);
    assert.equal((await authorPost("/studio/api/novels", authorA.cookie, { action: "delete", id: authorNovelCopy.payload.id })).response.status, 200);
    const authorChapter = await authorPost("/studio/api/chapters", authorA.cookie, {
      action: "create",
      meta: { novelId: authorNovel.payload.id },
    });
    assert.equal(authorChapter.response.status, 201);
    const authorChapterCopy = await authorPost("/studio/api/chapters", authorA.cookie, { action: "duplicate", id: authorChapter.payload.id });
    assert.equal(authorChapterCopy.response.status, 201);
    assert.equal((await authorPost("/studio/api/chapters", authorA.cookie, { action: "delete", id: authorChapterCopy.payload.id })).response.status, 200);
    assert.equal((await authorPost("/studio/api/chapters", authorA.cookie, { action: "delete", id: authorChapter.payload.id })).response.status, 200);
    assert.equal((await authorPost("/studio/api/novels", authorA.cookie, { action: "delete", id: authorNovel.payload.id })).response.status, 200);

    const adminNovel = await adminPost("/admin/api/novels", { action: "create" });
    assert.equal(adminNovel.response.status, 201);
    const adminNovelRow = (await requestJson("/admin/api/novels", { cookie: adminCookie })).payload.novels.find((novel) => novel.id === adminNovel.payload.id);
    const adminNovelDraft = structuredClone(adminNovelRow.draft);
    adminNovelDraft.name = "管理员草稿";
    assert.equal((await adminPost("/admin/api/novels", { action: "save", id: adminNovel.payload.id, novel: adminNovelDraft })).response.status, 200);
    const adminNovelCopy = await adminPost("/admin/api/novels", { action: "duplicate", id: adminNovel.payload.id });
    assert.equal(adminNovelCopy.response.status, 201);
    assert.equal((await adminPost("/admin/api/novels", { action: "delete", id: adminNovelCopy.payload.id })).response.status, 200);

    const adminChapter = await adminPost("/admin/api/chapters", { action: "create", meta: { novelId: adminNovel.payload.id } });
    assert.equal(adminChapter.response.status, 201);
    const adminChapterRow = (await requestJson("/admin/api/chapters", { cookie: adminCookie })).payload.chapters.find((chapter) => chapter.id === adminChapter.payload.id);
    assert.equal((await adminPost("/admin/api/chapters", { action: "save", id: adminChapter.payload.id, story: adminChapterRow.draft })).response.status, 200);
    const adminChapterCopy = await adminPost("/admin/api/chapters", { action: "duplicate", id: adminChapter.payload.id });
    assert.equal(adminChapterCopy.response.status, 201);
    assert.equal((await adminPost("/admin/api/chapters", { action: "delete", id: adminChapterCopy.payload.id })).response.status, 200);
    assert.equal((await adminPost("/admin/api/chapters", { action: "delete", id: adminChapter.payload.id })).response.status, 200);
    assert.equal((await adminPost("/admin/api/novels", { action: "delete", id: adminNovel.payload.id })).response.status, 200);
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
    const adminRejectedDelete = await adminPost("/admin/api/novels", { action: "delete", id: novelId });
    assert.equal(adminRejectedDelete.response.status, 400);
    assert.equal(adminRejectedDelete.payload.error, "只能删除未发布的小说草稿");

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
    assert.equal((await authorPost("/studio/api/novels", authorA.cookie, { action: "save", id: novelId, novel: changedDraft })).response.status, 200);
    assert.equal((await adminPost("/admin/api/novels", { action: "publish", id: novelId, novel: changedDraft })).response.status, 200);
    current = (await requestJson("/admin/api/novels", { cookie: adminCookie })).payload.novels.find((novel) => novel.id === novelId);
    assert.equal(current.version, 3);
    assert.equal(current.published.name, changedDraft.name);
    assert.equal((await adminPost("/admin/api/novels", { action: "rollback", id: novelId, version: 1 })).response.status, 200);
    current = (await requestJson("/admin/api/novels", { cookie: adminCookie })).payload.novels.find((novel) => novel.id === novelId);
    assert.equal(current.version, 4);
    assert.equal(current.published.name, publishedNovel.name);
    const versions = (await requestJson(`/admin/api/novels/versions?novelId=${novelId}`, { cookie: adminCookie })).payload.versions;
    assert.deepEqual(versions.map((version) => version.version), [4, 3, 2, 1]);
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
    const adminRejectedDelete = await adminPost("/admin/api/chapters", { action: "delete", id: chapterId });
    assert.equal(adminRejectedDelete.response.status, 400);
    assert.equal(adminRejectedDelete.payload.error, "只能删除未发布的草稿");

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
    assert.equal((await authorPost("/studio/api/chapters", authorA.cookie, { action: "save", id: chapterId, story: changedStory })).response.status, 200);
    assert.equal((await adminPost("/admin/api/chapters", { action: "publish", id: chapterId, story: changedStory })).response.status, 200);
    current = (await requestJson("/admin/api/chapters", { cookie: adminCookie })).payload.chapters.find((chapter) => chapter.id === chapterId);
    assert.equal(current.version, 3);
    assert.equal(current.published.title, changedStory.title);
    assert.equal((await adminPost("/admin/api/chapters", { action: "rollback", id: chapterId, version: 1 })).response.status, 200);
    current = (await requestJson("/admin/api/chapters", { cookie: adminCookie })).payload.chapters.find((chapter) => chapter.id === chapterId);
    assert.equal(current.version, 4);
    assert.equal(current.published.title, publishedStory.title);
    const versions = (await requestJson(`/admin/api/chapters/versions?chapterId=${chapterId}`, { cookie: adminCookie })).payload.versions;
    assert.deepEqual(versions.map((version) => version.version), [4, 3, 2, 1]);

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
    assert.equal(current.version, 4);
    assert.equal(current.published.title, publishedStory.title);

    assert.equal((await adminPost("/admin/api/novels", { action: "rollback", id: novelId, version: 1 })).response.status, 200);
    const novelVersions = (await requestJson(`/admin/api/novels/versions?novelId=${novelId}`, { cookie: adminCookie })).payload.versions;
    assert.deepEqual(novelVersions.map((version) => version.version), [6, 5, 4, 3, 2, 1]);
    const restoredNovel = (await requestJson("/admin/api/novels", { cookie: adminCookie })).payload.novels.find((novel) => novel.id === novelId);
    assert.equal(restoredNovel.published.name, publishedNovel.name);
    publicChapters = (await requestJson(`/api/chapters?novelId=${novelId}`)).payload.chapters;
    assert.ok(publicChapters.some((chapter) => chapter.id === chapterId));
  });
});

test("平台与作者素材的归属、整理和历史引用保护保持兼容", async () => {
  const authorA = await createAuthorAccount("素材作者甲");
  const authorB = await createAuthorAccount("素材作者乙");
  const patchAssets = (cookie, body) => requestJson("/studio/api/assets", { method: "PATCH", cookie, body });

  const platformUpload = await uploadAsset("/admin/api/assets", adminCookie, {
    name: "platform-cover.png",
    type: "image/png",
  });
  assert.equal(platformUpload.response.status, 201);
  assert.equal(platformUpload.payload.asset.ownerId, null);

  const folderA = await patchAssets(authorA.cookie, { action: "create-folder", name: "作者甲素材" });
  const folderB = await patchAssets(authorB.cookie, { action: "create-folder", name: "作者乙素材" });
  assert.equal(folderA.response.status, 201);
  assert.equal(folderB.response.status, 201);
  const authorUpload = await uploadAsset("/studio/api/assets", authorA.cookie, {
    name: "author-cover.png",
    type: "image/png",
    folderId: folderA.payload.folder.id,
  });
  assert.equal(authorUpload.response.status, 201);
  assert.equal(authorUpload.payload.asset.ownerId, authorA.id);

  const visibleToA = (await requestJson("/studio/api/assets", { cookie: authorA.cookie })).payload;
  assert.equal(visibleToA.assets.find((asset) => asset.id === platformUpload.payload.asset.id).canManage, false);
  assert.equal(visibleToA.assets.find((asset) => asset.id === authorUpload.payload.asset.id).canManage, true);
  assert.ok(visibleToA.folders.some((folder) => folder.id === folderA.payload.folder.id));
  const visibleToB = (await requestJson("/studio/api/assets", { cookie: authorB.cookie })).payload;
  assert.ok(!visibleToB.assets.some((asset) => asset.id === authorUpload.payload.asset.id));
  assert.ok(!visibleToB.folders.some((folder) => folder.id === folderA.payload.folder.id));

  const managePlatform = await patchAssets(authorA.cookie, {
    action: "update-asset",
    id: platformUpload.payload.asset.id,
    name: "越权改名",
  });
  assert.equal(managePlatform.response.status, 403);
  assert.equal(managePlatform.payload.error, "只能整理自己的素材");
  const useOtherFolder = await uploadAsset("/studio/api/assets", authorA.cookie, {
    name: "wrong-folder.png",
    type: "image/png",
    folderId: folderB.payload.folder.id,
  });
  assert.equal(useOtherFolder.response.status, 404);
  assert.equal(useOtherFolder.payload.error, "素材文件夹不存在");
  const longVideo = await uploadAsset("/studio/api/assets", authorA.cookie, {
    name: "too-long.mp4",
    type: "video/mp4",
    duration: 61,
  });
  assert.equal(longVideo.response.status, 400);
  assert.equal(longVideo.payload.error, "视频不能超过 60 秒");
  const unsupported = await uploadAsset("/studio/api/assets", authorA.cookie, {
    name: "notes.txt",
    type: "text/plain",
  });
  assert.equal(unsupported.response.status, 400);
  assert.equal(unsupported.payload.error, "仅支持图片、音频、MP4 和 WebM");
  const oversized = await uploadAsset("/studio/api/assets", authorA.cookie, {
    name: "oversized.png",
    type: "image/png",
    bytes: new Uint8Array(8 * 1024 * 1024 + 1),
  });
  assert.equal(oversized.response.status, 400);
  assert.equal(oversized.payload.error, "图片文件过大");

  const deletePlatform = await requestJson(`/studio/api/assets?id=${platformUpload.payload.asset.id}`, {
    method: "DELETE",
    cookie: authorA.cookie,
  });
  assert.equal(deletePlatform.response.status, 403);
  assert.equal(deletePlatform.payload.error, "只能删除自己的素材");

  const novelCreated = await requestJson("/studio/api/novels", {
    method: "POST",
    cookie: authorA.cookie,
    body: { action: "create" },
  });
  const novelId = novelCreated.payload.id;
  const novel = (await requestJson("/studio/api/novels", { cookie: authorA.cookie })).payload.novels.find((item) => item.id === novelId);
  const novelWithAsset = structuredClone(novel.draft);
  novelWithAsset.name = "素材历史小说";
  novelWithAsset.summary = "用于确认旧发布版本仍然保护素材引用。";
  novelWithAsset.coverAssetId = authorUpload.payload.asset.id;
  novelWithAsset.coverUrl = authorUpload.payload.asset.url;
  novelWithAsset.coverAlt = "素材历史小说封面";
  assert.equal((await requestJson("/studio/api/novels", {
    method: "POST", cookie: authorA.cookie, body: { action: "save", id: novelId, novel: novelWithAsset },
  })).response.status, 200);
  const draftReference = await requestJson(`/studio/api/assets?id=${authorUpload.payload.asset.id}`, {
    method: "DELETE", cookie: authorA.cookie,
  });
  assert.equal(draftReference.response.status, 409);
  assert.ok(draftReference.payload.references.some((reference) => reference.chapterId === novelId && reference.version === "draft"));
  assert.equal((await requestJson("/admin/api/novels", {
    method: "POST", cookie: adminCookie, body: { action: "publish", id: novelId, novel: novelWithAsset },
  })).response.status, 200);
  const publishedReference = await requestJson(`/studio/api/assets?id=${authorUpload.payload.asset.id}`, {
    method: "DELETE", cookie: authorA.cookie,
  });
  assert.equal(publishedReference.response.status, 409);
  assert.ok(publishedReference.payload.references.some((reference) => reference.chapterId === novelId && reference.version === "published"));
  const novelWithoutAsset = structuredClone(novelWithAsset);
  novelWithoutAsset.coverAssetId = "";
  novelWithoutAsset.coverUrl = "https://example.com/history-cover.jpg";
  assert.equal((await requestJson("/admin/api/novels", {
    method: "POST", cookie: adminCookie, body: { action: "publish", id: novelId, novel: novelWithoutAsset },
  })).response.status, 200);

  const chapterCreated = await requestJson("/studio/api/chapters", {
    method: "POST",
    cookie: authorA.cookie,
    body: { action: "create", meta: { novelId } },
  });
  const chapterId = chapterCreated.payload.id;
  const storyWithAsset = publishableStory("素材历史章节");
  storyWithAsset.coverAssetId = authorUpload.payload.asset.id;
  storyWithAsset.coverUrl = authorUpload.payload.asset.url;
  storyWithAsset.openingImageAssetId = authorUpload.payload.asset.id;
  storyWithAsset.openingImageUrl = authorUpload.payload.asset.url;
  assert.equal((await requestJson("/admin/api/chapters", {
    method: "POST", cookie: adminCookie, body: { action: "publish", id: chapterId, story: storyWithAsset },
  })).response.status, 200);
  const chapterPublishedReference = await requestJson(`/studio/api/assets?id=${authorUpload.payload.asset.id}`, {
    method: "DELETE", cookie: authorA.cookie,
  });
  assert.equal(chapterPublishedReference.response.status, 409);
  assert.ok(chapterPublishedReference.payload.references.some((reference) => reference.chapterId === chapterId && reference.version === "published"));
  const storyWithoutAsset = structuredClone(storyWithAsset);
  storyWithoutAsset.coverAssetId = "";
  storyWithoutAsset.coverUrl = "https://example.com/history-chapter.jpg";
  storyWithoutAsset.openingImageAssetId = "";
  storyWithoutAsset.openingImageUrl = "https://example.com/history-opening.jpg";
  assert.equal((await requestJson("/admin/api/chapters", {
    method: "POST", cookie: adminCookie, body: { action: "publish", id: chapterId, story: storyWithoutAsset },
  })).response.status, 200);

  const referencedDelete = await requestJson(`/studio/api/assets?id=${authorUpload.payload.asset.id}`, {
    method: "DELETE",
    cookie: authorA.cookie,
  });
  assert.equal(referencedDelete.response.status, 409);
  assert.equal(referencedDelete.payload.error, "素材仍被章节引用");
  assert.ok(referencedDelete.payload.references.some((reference) => reference.chapterId === novelId && reference.version === "v1"));
  assert.ok(referencedDelete.payload.references.some((reference) => reference.chapterId === chapterId && reference.version === "v1"));

  const spareUpload = await uploadAsset("/studio/api/assets", authorA.cookie, {
    name: "spare.png",
    type: "image/png",
  });
  const firstDelete = await requestJson(`/studio/api/assets?id=${spareUpload.payload.asset.id}`, {
    method: "DELETE",
    cookie: authorA.cookie,
  });
  assert.equal(firstDelete.response.status, 200);
  const repeatedDelete = await requestJson(`/studio/api/assets?id=${spareUpload.payload.asset.id}`, {
    method: "DELETE",
    cookie: authorA.cookie,
  });
  assert.equal(repeatedDelete.response.status, 200);
  assert.equal(repeatedDelete.payload.ok, true);
});

test("账号验证、重置、角色状态和管理员能力的安全契约保持兼容", async () => {
  const invalidRegistration = await requestText("/api/auth/register", {
    method: "POST",
    body: { email: "invalid", displayName: "无效账号", password: "test-password-123", turnstileToken: "", ...requiredRegistrationConsent },
  });
  assert.equal(invalidRegistration.response.status, 400);
  assert.equal(JSON.parse(invalidRegistration.text).error, "请输入有效邮箱");
  const pendingEmail = `pending-${process.pid}@example.com`;
  const pendingRegistration = await requestJson("/api/auth/register", {
    method: "POST",
    body: { email: pendingEmail, displayName: "待验证账号", password: "test-password-123", turnstileToken: "", ...requiredRegistrationConsent },
  });
  assert.equal(pendingRegistration.response.status, 201);
  const pendingLogin = await requestText("/api/auth/login", {
    method: "POST",
    body: { email: pendingEmail, password: "test-password-123" },
  });
  assert.equal(pendingLogin.response.status, 403);
  assert.equal(JSON.parse(pendingLogin.text).error, "请先验证邮箱");
  const verified = await requestJson("/api/auth/verify-email", {
    method: "POST",
    body: { token: pendingRegistration.payload.developmentToken },
  });
  assert.equal(verified.response.status, 200);
  const reusedVerification = await requestText("/api/auth/verify-email", {
    method: "POST",
    body: { token: pendingRegistration.payload.developmentToken },
  });
  assert.equal(reusedVerification.response.status, 400);
  assert.equal(JSON.parse(reusedVerification.text).error, "验证链接无效或已过期");

  const accountLogin = await requestJson("/api/auth/login", {
    method: "POST",
    body: { email: pendingEmail, password: "test-password-123" },
  });
  assert.equal(accountLogin.response.status, 200);
  const accountCookie = accountLogin.response.headers.get("set-cookie")?.split(";")[0] || "";
  const users = (await requestJson("/admin/api/users", { cookie: adminCookie })).payload.users;
  const account = users.find((user) => user.email === pendingEmail);
  assert.ok(account);
  assert.equal((await requestJson("/admin/api/users", {
    method: "PATCH", cookie: adminCookie, body: { id: account.id, role: "admin" },
  })).response.status, 200);
  const accountAdmin = await requestJson("/admin/api/users", { cookie: accountCookie });
  assert.equal(accountAdmin.response.status, 200);
  assert.equal((await requestJson("/admin/api/users", {
    method: "PATCH", cookie: adminCookie, body: { id: account.id, role: "reader" },
  })).response.status, 200);
  const revokedCapability = await requestJson("/admin/api/users", { cookie: accountCookie });
  assert.equal(revokedCapability.response.status, 403);
  assert.equal(revokedCapability.payload.error, "当前账号没有管理员权限");
  assert.equal((await requestJson("/admin/api/users", {
    method: "PATCH", cookie: adminCookie, body: { id: account.id, status: "disabled" },
  })).response.status, 200);
  const disabledMe = await requestJson("/api/auth/me", { cookie: accountCookie });
  assert.equal(disabledMe.response.status, 200);
  assert.equal(disabledMe.payload.user, null);
  const disabledLogin = await requestText("/api/auth/login", {
    method: "POST",
    body: { email: pendingEmail, password: "test-password-123" },
  });
  assert.equal(disabledLogin.response.status, 403);
  assert.equal(JSON.parse(disabledLogin.text).error, "账号已被禁用");

  const resetEmail = `reset-${process.pid}@example.com`;
  const resetRegistration = await requestJson("/api/auth/register", {
    method: "POST",
    body: { email: resetEmail, displayName: "重置账号", password: "old-password-123", turnstileToken: "", ...requiredRegistrationConsent },
  });
  assert.equal(resetRegistration.response.status, 201);
  assert.equal((await requestJson("/api/auth/verify-email", {
    method: "POST", body: { token: resetRegistration.payload.developmentToken },
  })).response.status, 200);
  const resetLogin = await requestJson("/api/auth/login", {
    method: "POST",
    body: { email: resetEmail, password: "old-password-123" },
  });
  assert.equal(resetLogin.response.status, 200);
  const resetCookie = resetLogin.response.headers.get("set-cookie")?.split(";")[0] || "";
  const knownRecovery = await requestJson("/api/auth/forgot-password", {
    method: "POST",
    body: { email: resetEmail, turnstileToken: "" },
  });
  const unknownRecovery = await requestJson("/api/auth/forgot-password", {
    method: "POST",
    body: { email: `unknown-${process.pid}@example.com`, turnstileToken: "" },
  });
  assert.equal(knownRecovery.response.status, 200);
  assert.equal(unknownRecovery.response.status, 200);
  assert.equal(knownRecovery.payload.message, unknownRecovery.payload.message);
  assert.ok(knownRecovery.payload.developmentToken);
  assert.ok(!("developmentToken" in unknownRecovery.payload));
  const weakReset = await requestText("/api/auth/reset-password", {
    method: "POST",
    body: { token: knownRecovery.payload.developmentToken, password: "short" },
  });
  assert.equal(weakReset.response.status, 400);
  assert.equal(JSON.parse(weakReset.text).error, "密码至少需要 15 个字符");
  assert.equal((await requestJson("/api/auth/reset-password", {
    method: "POST",
    body: { token: knownRecovery.payload.developmentToken, password: "new-password-456" },
  })).response.status, 200);
  assert.equal((await requestJson("/api/auth/me", { cookie: resetCookie })).payload.user, null);
  const reusedReset = await requestText("/api/auth/reset-password", {
    method: "POST",
    body: { token: knownRecovery.payload.developmentToken, password: "another-password-789" },
  });
  assert.equal(reusedReset.response.status, 400);
  assert.equal(JSON.parse(reusedReset.text).error, "链接无效或已过期");
  assert.equal((await requestText("/api/auth/login", {
    method: "POST", body: { email: resetEmail, password: "old-password-123" },
  })).response.status, 401);
  assert.equal((await requestJson("/api/auth/login", {
    method: "POST", body: { email: resetEmail, password: "new-password-456" },
  })).response.status, 200);

  const expiredEmail = `expired-${process.pid}@example.com`;
  const expiredRegistration = await requestJson("/api/auth/register", {
    method: "POST",
    body: { email: expiredEmail, displayName: "过期验证账号", password: "test-password-123", turnstileToken: "", ...requiredRegistrationConsent },
  });
  assert.equal(expiredRegistration.response.status, 201);
  runtime.executeD1(`UPDATE auth_tokens SET expires_at = '2000-01-01T00:00:00.000Z' WHERE user_id = (SELECT id FROM users WHERE email = '${expiredEmail}') AND type = 'verify_email'`);
  const expiredVerification = await requestText("/api/auth/verify-email", {
    method: "POST",
    body: { token: expiredRegistration.payload.developmentToken },
  });
  assert.equal(expiredVerification.response.status, 400);
  assert.equal(JSON.parse(expiredVerification.text).error, "验证链接无效或已过期");

  const expiringReset = await requestJson("/api/auth/forgot-password", {
    method: "POST",
    body: { email: resetEmail, turnstileToken: "" },
  });
  assert.ok(expiringReset.payload.developmentToken);
  runtime.executeD1(`UPDATE auth_tokens SET expires_at = '2000-01-01T00:00:00.000Z' WHERE user_id = (SELECT id FROM users WHERE email = '${resetEmail}') AND type = 'reset_password' AND used_at IS NULL`);
  const expiredReset = await requestText("/api/auth/reset-password", {
    method: "POST",
    body: { token: expiringReset.payload.developmentToken, password: "expired-password-123" },
  });
  assert.equal(expiredReset.response.status, 400);
  assert.equal(JSON.parse(expiredReset.text).error, "链接无效或已过期");

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const rejected = await requestJson("/admin/api/session", {
      method: "POST",
      body: { password: "wrong-password" },
    });
    assert.equal(rejected.response.status, 401);
  }
  const limited = await requestJson("/admin/api/session", {
    method: "POST",
    body: { password: "wrong-password" },
  });
  assert.equal(limited.response.status, 429);
  assert.equal(limited.payload.error, "登录尝试过多，请稍后再试");
  assert.ok(Number(limited.response.headers.get("retry-after")) > 0);
});

test("正式账号 HTTP 路由覆盖确认、恢复、重启与操作结果查询", async () => {
  const email = `route-recovery-${process.pid}@example.com`;
  const registration = await requestJson("/api/auth/register", {
    method: "POST",
    body: {
      email, displayName: "路由恢复旅伴", password: "route-recovery-password-123", turnstileToken: "",
      ...requiredRegistrationConsent,
    },
  });
  assert.equal(registration.response.status, 201);
  const initialToken = registration.payload.developmentToken;
  const inspection = await fetch(`${origin}/api/auth/verify-email?token=${encodeURIComponent(initialToken)}`);
  assert.equal(inspection.status, 200);
  assert.deepEqual(await inspection.json(), { state: "ready" });
  assert.equal(inspection.headers.get("set-cookie"), null);

  runtime.executeD1(`UPDATE users SET last_verification_sent_at = '2000-01-01T00:00:00.000Z' WHERE email = '${email}'`);
  const resent = await requestJson("/api/auth/resend-verification", {
    method: "POST", body: { email, turnstileToken: "", operationId: `resend-${process.pid}` },
  });
  assert.equal(resent.response.status, 200);
  assert.equal(resent.payload.state, "awaiting_email");

  const restartedEmail = `route-restarted-${process.pid}@example.com`;
  const restarted = await requestJson("/api/auth/restart-registration", {
    method: "POST",
    body: {
      currentEmail: email, email: restartedEmail, displayName: "重启后的旅伴",
      password: "route-restarted-password-456", turnstileToken: "", operationId: `restart-${process.pid}`,
      ...requiredRegistrationConsent,
    },
  });
  assert.equal(restarted.response.status, 200);
  assert.equal(restarted.payload.state, "awaiting_email");
  assert.deepEqual(await (await fetch(`${origin}/api/auth/verify-email?token=${encodeURIComponent(initialToken)}`)).json(), { state: "used" });
  assert.deepEqual(await (await fetch(`${origin}/api/auth/verify-email?token=${encodeURIComponent(restarted.payload.developmentToken)}`)).json(), { state: "ready" });

  const activated = await requestJson("/api/auth/activate-account", {
    method: "POST",
    body: { token: restarted.payload.developmentToken, intent: { kind: "progress", targetId: "chapter-route" } },
  });
  assert.equal(activated.response.status, 200);
  assert.equal(activated.payload.state, "active");
  assert.deepEqual(activated.payload.resumeDirective, {
    kind: "progress", targetId: "chapter-route", mode: "confirm",
  });
  const activatedCookie = activated.response.headers.get("set-cookie")?.split(";")[0] || "";
  const usedInMatchingSession = await fetch(`${origin}/api/auth/verify-email?token=${encodeURIComponent(restarted.payload.developmentToken)}`, {
    headers: { cookie: activatedCookie },
  });
  assert.deepEqual(await usedInMatchingSession.json(), { state: "active_session" });

  const operationId = `register-operation-${process.pid}`;
  const operationEmail = `route-operation-${process.pid}@example.com`;
  const operationBody = {
    email: operationEmail, displayName: "操作结果旅伴", password: "route-operation-password-123",
    turnstileToken: "", operationId, ...requiredRegistrationConsent,
  };
  const operationRegistration = await requestJson("/api/auth/register", { method: "POST", body: operationBody });
  assert.equal(operationRegistration.response.status, 201);
  const outcome = await requestJson(`/api/auth/registration-outcome?operationId=${encodeURIComponent(operationId)}`);
  assert.equal(outcome.payload.state, "succeeded");
  const repeated = await requestJson("/api/auth/register", { method: "POST", body: operationBody });
  assert.equal(repeated.response.status, 201);
  assert.equal(repeated.payload.state, "awaiting_email");
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
