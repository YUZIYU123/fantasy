import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AdminStudio } from "../app/admin/studio";
import { CreatorEntry } from "../app/creator/creator-entry";

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
  const create = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("新建小说"));
  assert.ok(create);
  await act(async () => create.click());
  await settle();

  assert.equal(sessionChecks, 2);
  assert.match(container.textContent || "", /当前未配置应急恢复密钥/);
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
