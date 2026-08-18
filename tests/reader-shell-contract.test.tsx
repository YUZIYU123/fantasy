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
    ["世界", "书架", "终端", "我的"],
  );
  assert.equal(navigation.querySelector('[aria-current="page"]')?.textContent?.trim(), "世界");
  assert.match(container.textContent || "", /已连接/);
  assert.match(container.textContent || "", /主档案\.001/);
  assert.match(container.textContent || "", /档案内容/);
});

test("读者从 Dock 打开和收起故事终端", async () => {
  await act(async () => root.render(<ReaderShell active="world" contextLabel="主档案.001"><p>档案内容</p></ReaderShell>));

  const trigger = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "终端");
  assert.ok(trigger);
  assert.equal(trigger.getAttribute("aria-expanded"), "false");

  await act(async () => trigger.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.ok(container.querySelector('button[aria-label="收起幻界终端"]'));

  await act(async () => trigger.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  assert.equal(trigger.getAttribute("aria-expanded"), "false");

  await act(async () => trigger.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="收起幻界终端"]')?.click());
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
});
