import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BookshelfScreen } from "../app/bookshelf/screen";
import { executeBookshelfOperation } from "../app/bookshelf-operation-client";

let dom: JSDOM;
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/bookshelf" });
  const window = dom.window as unknown as Window & typeof globalThis;
  Object.assign(globalThis, {
    window, self: window, document: window.document, HTMLElement: window.HTMLElement, DOMException: window.DOMException,
    Event: window.Event, MouseEvent: window.MouseEvent, IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: window.navigator });
  container = window.document.querySelector("#root") as HTMLDivElement;
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
});

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

function click(label: string) {
  const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes(label));
  assert.ok(button, `找不到按钮：${label}`);
  button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
}

test("访客访问我的书架看到登录与注册入口而不是假空状态", async () => {
  globalThis.fetch = async () => Response.json({ error: "需要登录" }, { status: 401 });
  await act(async () => root.render(<BookshelfScreen />));
  await settle();
  assert.match(container.textContent || "", /登录后查看我的书架/);
  assert.equal(container.textContent?.includes("书架还是空的"), false);
  assert.equal(container.querySelector('a[href="/login?next=/bookshelf"]')?.textContent, "登录");
});

test("真实空书架提供世界档案入口", async () => {
  globalThis.fetch = async () => Response.json({ kind: "page", items: [], nextCursor: null });
  await act(async () => root.render(<BookshelfScreen />));
  await settle();
  assert.match(container.textContent || "", /书架还是空的/);
  assert.equal(container.querySelector('a[href="/"]')?.textContent?.includes("世界档案"), true);
});

test("账号使用者确认移出后条目消失并明确阅读进度保留", async () => {
  const calls: Array<{ method: string; body?: Record<string, unknown> }> = [];
  globalThis.fetch = async (_input, init = {}) => {
    const method = init.method || "GET";
    calls.push({ method, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
    if (method === "DELETE") return Response.json({ kind: "removed" });
    return Response.json({ kind: "page", nextCursor: null, items: [{
      id: "entry", novelId: "novel", slug: "novel", public: {
        name: "雾中之书", summary: "一部小说", coverUrl: "", coverAlt: "雾中之书封面",
      }, status: "reading", statusLabel: "阅读中", addedAt: "2026-08-16T00:00:00.000Z",
      action: { kind: "continue", chapterId: "chapter" },
    }] });
  };
  await act(async () => root.render(<BookshelfScreen />));
  await settle();
  assert.match(container.textContent || "", /雾中之书/);
  await act(async () => click("移出书架"));
  assert.match(container.textContent || "", /阅读进度仍会保留/);
  await act(async () => click("确认移出"));
  await settle();
  assert.equal(container.textContent?.includes("雾中之书"), false);
  assert.match(container.textContent || "", /阅读进度仍然保留/);
  assert.equal(typeof calls.find((call) => call.method === "DELETE")?.body?.operationId, "string");
  assert.equal(dom.window.document.activeElement?.textContent, "我的书架");
});

test("普通网络失败也先查询回执并保留同一操作标识", async () => {
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    if (calls.length === 1) throw new TypeError("connection reset");
    return Response.json({ status: "succeeded" });
  };
  const result = await executeBookshelfOperation({
    action: "add", novelId: "novel", operationId: "reliable-operation", timeoutMs: 1,
  });
  assert.deepEqual(result, { status: "succeeded", operationId: "reliable-operation" });
  assert.equal(calls[1], "/api/account/bookshelf/result?operationId=reliable-operation");
});

test("移出与加载更多在请求完成前拒绝重复点击", async () => {
  let resolveMore!: (response: Response) => void;
  let resolveRemove!: (response: Response) => void;
  let listCalls = 0;
  let removeCalls = 0;
  globalThis.fetch = async (_input, init = {}) => {
    if (init.method === "DELETE") {
      removeCalls += 1;
      return new Promise<Response>((resolve) => { resolveRemove = resolve; });
    }
    listCalls += 1;
    if (listCalls > 1) return new Promise<Response>((resolve) => { resolveMore = resolve; });
    return Response.json({ kind: "page", nextCursor: "cursor", items: [{
      id: "entry", novelId: "novel", slug: "novel",
      public: { name: "雾中之书", summary: "一部小说", coverUrl: "", coverAlt: "雾中之书封面" },
      status: "unstarted", statusLabel: "未开始", addedAt: "2026-08-16T00:00:00.000Z",
      action: { kind: "view", novelId: "novel" },
    }] });
  };
  await act(async () => root.render(<BookshelfScreen />));
  await settle();
  const more = [...container.querySelectorAll("button")].find((button) => button.textContent === "加载更多");
  assert.ok(more);
  await act(async () => {
    more.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    more.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  assert.equal(listCalls, 2);
  resolveMore(Response.json({ kind: "page", nextCursor: null, items: [] }));
  await settle();
  await act(async () => click("移出书架"));
  const confirm = [...container.querySelectorAll("button")].find((button) => button.textContent === "确认移出");
  assert.ok(confirm);
  await act(async () => {
    confirm.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    confirm.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  assert.equal(removeCalls, 1);
  resolveRemove(Response.json({ kind: "removed" }));
  await settle();
});

test("移出对话框用 Escape 关闭并恢复到实际触发按钮", async () => {
  globalThis.fetch = async () => Response.json({ kind: "page", nextCursor: null, items: [{
    id: "entry", novelId: "novel", slug: "novel",
    public: { name: "雾中之书", summary: "一部小说", coverUrl: "", coverAlt: "雾中之书封面" },
    status: "unstarted", statusLabel: "未开始", addedAt: "2026-08-16T00:00:00.000Z",
    action: { kind: "view", novelId: "novel" },
  }] });
  await act(async () => root.render(<BookshelfScreen />));
  await settle();
  const trigger = container.querySelector<HTMLButtonElement>(".bookshelf-remove");
  assert.ok(trigger);
  await act(async () => trigger.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
  assert.ok(dialog);
  await act(async () => dialog.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  await settle();
  assert.equal(container.querySelector('[role="dialog"]'), null);
  assert.equal(dom.window.document.activeElement, trigger);
});
