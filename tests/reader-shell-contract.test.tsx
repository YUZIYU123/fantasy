import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ReaderShell } from "../app/reader-shell";

let dom: JSDOM;
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/" });
  const window = dom.window as unknown as Window & typeof globalThis;
  Object.assign(globalThis, {
    window,
    self: window,
    document: window.document,
    localStorage: window.localStorage,
    sessionStorage: window.sessionStorage,
    HTMLElement: window.HTMLElement,
    Event: window.Event,
    MouseEvent: window.MouseEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: window.navigator });
  globalThis.fetch = async () => Response.json({ user: null });
  container = window.document.querySelector("#root") as HTMLDivElement;
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
});

test("标准读者外壳直接提供四个主入口并标记当前世界档案", async () => {
  await act(async () => root.render(<ReaderShell active="world" contextLabel="主档案.001"><p>档案内容</p></ReaderShell>));

  const navigation = container.querySelector('nav[aria-label="读者主导航"]');
  assert.ok(navigation);
  assert.deepEqual(
    [...navigation.querySelectorAll("a,button")].map((item) => item.textContent?.trim()),
    ["世界", "书架", "小雾", "我的"],
  );
  assert.equal(navigation.querySelector('[aria-current="page"]')?.textContent?.trim(), "世界");
  assert.match(container.textContent || "", /已连接/);
  assert.match(container.textContent || "", /主档案\.001/);
  assert.match(container.textContent || "", /档案内容/);
});

test("Dock 小雾进入雾庭，侧边角色只展开轻量气泡", async () => {
  await act(async () => root.render(<ReaderShell active="world" contextLabel="主档案.001"><p>档案内容</p></ReaderShell>));

  const garden = [...container.querySelectorAll("nav a")].find((link) => link.textContent?.trim() === "小雾");
  assert.equal(garden?.getAttribute("href"), "/xiaowu");

  const companion = container.querySelector<HTMLButtonElement>('button[aria-label="打开小雾"]');
  assert.ok(companion);
  await act(async () => companion.click());
  assert.ok(container.querySelector('[role="dialog"][aria-label="小雾对话"]'));
  assert.equal([...container.querySelectorAll("a")].find((link) => link.textContent?.includes("前往雾庭"))?.getAttribute("href"), "/xiaowu");
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="收起小雾"]')?.click());
  assert.equal(document.activeElement, companion);
});

test("雾庭页面标记 Dock 活动状态且不重复挂载侧边小雾", async () => {
  await act(async () => root.render(<ReaderShell active="xiaowu" contextLabel="雾庭" companion="hidden"><p>世界树庭院</p></ReaderShell>));

  assert.equal(container.querySelector('nav a[aria-current="page"]')?.textContent?.trim(), "小雾");
  assert.equal(container.querySelector(".xiaowu-companion"), null);
  assert.match(container.textContent || "", /世界树庭院/);
});
