import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AdminStudio } from "../app/admin/studio";
import { CreatorEntry } from "../app/creator/creator-entry";
import { createBlankNovel, createBlankStory } from "../lib/story";

let dom: JSDOM;
let root: Root;
let container: HTMLDivElement;
let recoveryAvailable: boolean;
let accessUnavailable: boolean;
let firstAccessAllowed: boolean;
let contentStatus: number;
let sessionChecks: number;
let workspaceRedirectTo: "/admin" | "/studio" | null;

function installDom() {
  dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    url: "http://localhost/admin",
  });
  const window = dom.window as unknown as Window & typeof globalThis;
  Object.assign(globalThis, {
    window,
    self: window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    Event: window.Event,
    MouseEvent: window.MouseEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: window.navigator });
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  recoveryAvailable = false;
  accessUnavailable = false;
  firstAccessAllowed = false;
  contentStatus = 200;
  sessionChecks = 0;
  workspaceRedirectTo = null;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "/admin/api/session") {
      if (accessUnavailable) return Response.json({ error: "权限检查失败，请稍后重试" }, { status: 503 });
      sessionChecks += 1;
      if (workspaceRedirectTo) {
        return Response.json({
          authenticated: false, outcome: "redirect",
          destination: workspaceRedirectTo === "/admin" ? "admin" : "studio",
          redirectTo: workspaceRedirectTo, reason: workspaceRedirectTo === "/admin" ? "admin_account" : "author_account",
          accountRole: workspaceRedirectTo === "/admin" ? "admin" : "author",
          source: workspaceRedirectTo === "/admin" ? "account" : null,
          administrator: workspaceRedirectTo === "/admin" ? { role: "admin", email: "admin@example.com", source: "account" } : null,
          recoveryAvailable: false,
        });
      }
      if (firstAccessAllowed && sessionChecks === 1) {
        return Response.json({
          authenticated: true,
          outcome: "allow",
          destination: "admin",
          redirectTo: null,
          reason: "local_admin",
          accountRole: null,
          source: "local_bypass",
          administrator: { role: "admin", email: "local-admin@localhost", source: "local_bypass" },
          recoveryAvailable: false,
        });
      }
      return Response.json({
        authenticated: false,
        outcome: "deny",
        destination: null,
        redirectTo: null,
        reason: "signed_out",
        accountRole: null,
        source: null,
        administrator: null,
        recoveryAvailable,
      });
    }
    if (["/admin/api/novels", "/admin/api/chapters", "/admin/api/assets"].includes(url)) {
      if (contentStatus !== 200) return Response.json({ error: "内容读取失败" }, { status: contentStatus });
      if (url.endsWith("novels")) return Response.json({ novels: [] });
      if (url.endsWith("chapters")) return Response.json({ chapters: [] });
      return Response.json({ assets: [], folders: [] });
    }
    throw new Error(`测试出现未预期请求：${url}`);
  };
  container = window.document.querySelector("#root") as HTMLDivElement;
  root = createRoot(container);
}

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

beforeEach(() => installDom());
afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
});

test("管理员入口只在应急恢复密钥已配置时显示密钥表单", async () => {
  await act(async () => root.render(<AdminStudio />));
  await settle();
  assert.match(container.textContent || "", /当前未配置应急恢复密钥/);
  assert.equal(container.querySelector('input[type="password"]'), null);
  assert.doesNotMatch(container.textContent || "", /还没有小说/);

  await act(async () => root.unmount());
  root = createRoot(container);
  recoveryAvailable = true;
  await act(async () => root.render(<AdminStudio />));
  await settle();
  assert.match(container.textContent || "", /使用应急恢复密钥/);
  assert.ok(container.querySelector('input[type="password"]'));
});

test("权限服务失败时显示可重试错误而不是登录或空小说状态", async () => {
  accessUnavailable = true;
  await act(async () => root.render(<AdminStudio />));
  await settle();

  assert.match(container.textContent || "", /暂时无法确认权限/);
  assert.match(container.textContent || "", /重新检查权限/);
  assert.equal(container.querySelector('input[type="password"]'), null);
  assert.doesNotMatch(container.textContent || "", /还没有小说/);
});

test("权限确认后内容接口返回 401 时重新鉴权而不是显示内容故障", async () => {
  firstAccessAllowed = true;
  contentStatus = 401;
  await act(async () => root.render(<AdminStudio />));
  await settle();
  await settle();

  assert.equal(sessionChecks, 2);
  assert.match(container.textContent || "", /当前未配置应急恢复密钥/);
  assert.doesNotMatch(container.textContent || "", /后台内容加载失败/);
});

test("权限确认后内容接口返回 500 时保留权限并显示内容重试", async () => {
  firstAccessAllowed = true;
  contentStatus = 500;
  await act(async () => root.render(<AdminStudio />));
  await settle();

  assert.equal(sessionChecks, 1);
  assert.match(container.textContent || "", /后台内容加载失败/);
  assert.doesNotMatch(container.textContent || "", /应急恢复密钥/);
});

test("作品管理提供两种新建入口且短篇进入合并式编辑页", async () => {
  firstAccessAllowed = true;
  const baseFetch = globalThis.fetch;
  const draft = createBlankNovel();
  draft.name = "契约短篇";
  const story = createBlankStory();
  story.nodes[0].body = "一二三";
  story.nodes[0].canEndChapter = true;
  const novel = {
    id: "short", slug: "short", ownerId: null, format: "short", formatLockedAt: null, convertibleTo: "serial",
    draftStatus: "draft", submittedAt: null, reviewNote: "", sortOrder: 1, status: "draft", version: 0,
    draft, published: null, updatedAt: "2026-08-31T00:00:00.000Z",
  };
  const chapter = {
    id: "short-body", novelId: "short", slug: "short-body", title: story.title, summary: "", coverUrl: "",
    sortOrder: 1, status: "draft", ownerId: null, draftStatus: "draft", submittedAt: null, reviewNote: "",
    version: 0, draft: story, published: null, updatedAt: "2026-08-31T00:00:00.000Z",
  };
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "/admin/api/novels" && !init?.method) return Response.json({ novels: [novel], shorts: [{ novel, chapter }] });
    return baseFetch(input, init);
  };
  await act(async () => root.render(<AdminStudio />));
  await settle();
  assert.ok([...container.querySelectorAll("button")].some((button) => button.textContent?.includes("新建短篇")));
  assert.ok([...container.querySelectorAll("button")].some((button) => button.textContent?.includes("新建连载小说")));
  assert.ok([...container.querySelectorAll("button")].some((button) => button.textContent?.includes("转为连载小说")));
  const edit = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("编辑短篇"));
  assert.ok(edit);
  await act(async () => edit.click());
  assert.match(container.textContent || "", /短篇编辑/);
  assert.match(container.textContent || "", /3 \/ 20,000 字/);
  assert.match(container.textContent || "", /可选自定义收尾图/);
  assert.ok([...container.querySelectorAll("button")].some((button) => button.textContent?.includes("开启互动编辑")));
});

test("作品管理为已发布连载提供完结与重新连载操作", async () => {
  firstAccessAllowed = true;
  const baseFetch = globalThis.fetch;
  const draft = createBlankNovel();
  draft.name = "状态切换连载";
  const ongoing = {
    id: "ongoing", slug: "ongoing", ownerId: null, format: "serial", serialStatus: "ongoing",
    formatLockedAt: "2026-09-02T00:00:00.000Z", convertibleTo: null,
    draftStatus: "draft", submittedAt: null, reviewNote: "", sortOrder: 1, status: "published", version: 1,
    draft, published: draft, updatedAt: "2026-09-02T00:00:00.000Z",
  };
  const completed = { ...ongoing, id: "completed", slug: "completed", serialStatus: "completed" };
  globalThis.fetch = async (input, init) => {
    if (String(input) === "/admin/api/novels" && !init?.method) {
      return Response.json({ novels: [ongoing, completed], shorts: [] });
    }
    return baseFetch(input, init);
  };

  await act(async () => root.render(<AdminStudio />));
  await settle();

  assert.ok([...container.querySelectorAll("button")].some((button) => button.textContent === "标记完结"));
  assert.ok([...container.querySelectorAll("button")].some((button) => button.textContent === "重新连载"));
  assert.equal([...container.querySelectorAll(".format-badge")].filter((badge) => badge.textContent === "已完结").length, 1);
});

test("写操作返回 401 时立即重新鉴权并退出失效工作台", async () => {
  firstAccessAllowed = true;
  const baseFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input) === "/admin/api/novels" && init?.method === "POST") {
      return Response.json({ error: "会话已过期" }, { status: 401 });
    }
    return baseFetch(input, init);
  };
  await act(async () => root.render(<AdminStudio />));
  await settle();
  const create = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("新建连载小说"));
  assert.ok(create);
  await act(async () => create.click());
  await settle();

  assert.equal(sessionChecks, 2);
  assert.match(container.textContent || "", /当前未配置应急恢复密钥/);
});

test("用户管理读取返回 403 时也通过统一状态机重新鉴权", async () => {
  firstAccessAllowed = true;
  const baseFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input) === "/admin/api/users") {
      return Response.json({ error: "管理员权限已失效" }, { status: 403 });
    }
    return baseFetch(input, init);
  };
  await act(async () => root.render(<AdminStudio />));
  await settle();
  const users = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("用户管理"));
  assert.ok(users);
  await act(async () => users.click());
  await settle();
  await settle();

  assert.equal(sessionChecks, 2);
  assert.match(container.textContent || "", /当前未配置应急恢复密钥/);
  assert.doesNotMatch(container.textContent || "", /管理员权限已失效/);
});

test("并发权限恢复忽略较晚完成的旧鉴权结果", async () => {
  let resolveOlderCheck!: (response: Response) => void;
  const allow = () => Response.json({
    authenticated: true,
    outcome: "allow",
    destination: "admin",
    redirectTo: null,
    reason: "local_admin",
    accountRole: null,
    source: "local_bypass",
    administrator: { role: "admin", email: "local-admin@localhost", source: "local_bypass" },
    recoveryAvailable: false,
  });
  const deny = () => Response.json({
    authenticated: false,
    outcome: "deny",
    destination: null,
    redirectTo: null,
    reason: "signed_out",
    accountRole: null,
    source: null,
    administrator: null,
    recoveryAvailable: false,
  });
  const baseFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "/admin/api/session") {
      sessionChecks += 1;
      if (sessionChecks === 1 || sessionChecks === 3) return allow();
      return new Promise<Response>((resolve) => { resolveOlderCheck = resolve; });
    }
    if (url === "/admin/api/users" && init?.method === "PATCH") {
      return Response.json({ error: "管理员权限已失效" }, { status: 403 });
    }
    if (url === "/admin/api/users") {
      return Response.json({ users: [{
        id: "user-1", email: "reader@example.com", displayName: "读者",
        role: "reader", status: "active", emailVerifiedAt: "2026-01-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
      }] });
    }
    return baseFetch(input, init);
  };
  await act(async () => root.render(<AdminStudio />));
  await settle();
  const users = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("用户管理"));
  assert.ok(users);
  await act(async () => users.click());
  await settle();
  const selects = [...container.querySelectorAll("select")];
  assert.equal(selects.length, 2);
  await act(async () => {
    selects[0].value = "author";
    selects[0].dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    selects[1].value = "disabled";
    selects[1].dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  await settle();
  assert.equal(sessionChecks, 3);

  resolveOlderCheck(deny());
  await settle();
  await settle();

  assert.match(container.textContent || "", /用户与角色/);
  assert.doesNotMatch(container.textContent || "", /当前未配置应急恢复密钥/);
});

test("错误工作台按照模块决策只跳转一次", async () => {
  workspaceRedirectTo = "/studio";
  const navigations: string[] = [];
  await act(async () => root.render(<AdminStudio navigate={(to) => navigations.push(to)} />));
  await settle();

  assert.deepEqual(navigations, ["/studio"]);
  assert.equal(sessionChecks, 1);
});

test("统一创作入口执行模块给出的登录跳转而不自行推断", async () => {
  const navigations: string[] = [];
  globalThis.fetch = async () => Response.json({
    destination: null,
    redirectTo: "/login?next=/creator",
    reason: "signed_out",
    accountRole: null,
  });
  await act(async () => root.render(<CreatorEntry navigate={(to) => navigations.push(to)} />));
  await settle();

  assert.deepEqual(navigations, ["/login?next=/creator"]);
});
