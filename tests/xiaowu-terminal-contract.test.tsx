import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FantasyTerminal } from "../app/fantasy-terminal";
import { DEFAULT_STORY_TERMINAL, createTerminalTask } from "../lib/story";

let dom: JSDOM;
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body><button id="before">正文选择</button><div id="root"></div></body></html>', { url: "http://localhost/" });
  const window = dom.window as unknown as Window & typeof globalThis;
  Object.assign(globalThis, {
    window,
    self: window,
    document: window.document,
    localStorage: window.localStorage,
    sessionStorage: window.sessionStorage,
    HTMLElement: window.HTMLElement,
    HTMLMediaElement: window.HTMLMediaElement,
    Event: window.Event,
    KeyboardEvent: window.KeyboardEvent,
    MouseEvent: window.MouseEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: window.navigator });
  Object.defineProperty(window.HTMLMediaElement.prototype, "play", {
    configurable: true,
    value() { return Promise.reject(new Error("media unavailable")); },
  });
  Object.defineProperty(window.HTMLMediaElement.prototype, "pause", { configurable: true, value() {} });
  globalThis.fetch = async () => Response.json({ user: null });
  container = window.document.querySelector("#root") as HTMLDivElement;
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
});

test("小雾默认探头，点击后展开对话卡并在收起后恢复焦点", async () => {
  await act(async () => root.render(<FantasyTerminal />));
  const launcher = container.querySelector<HTMLButtonElement>('button[aria-label="打开小雾"]');
  assert.ok(launcher);
  assert.equal(launcher.getAttribute("aria-expanded"), "false");
  assert.match(launcher.querySelector("img")?.getAttribute("src") || "", /\/xiaowu\/idle\.webp/);

  launcher.focus();
  await act(async () => launcher.click());
  assert.equal(launcher.getAttribute("aria-expanded"), "true");
  assert.equal(container.querySelector('[role="dialog"]')?.getAttribute("aria-label"), "小雾对话");
  assert.match(container.textContent || "", /小雾/);
  assert.doesNotMatch(container.textContent || "", /幻界终端/);

  const close = container.querySelector<HTMLButtonElement>('button[aria-label="收起小雾"]');
  assert.ok(close);
  await act(async () => close.click());
  assert.equal(document.activeElement, launcher);
});

test("隐藏启动器仍兼容受控打开，历史默认名称不重复显示", async () => {
  await act(async () => root.render(<FantasyTerminal launcher="hidden" open config={DEFAULT_STORY_TERMINAL} />));
  assert.equal(container.querySelector('button[aria-label="打开小雾"]'), null);
  assert.ok(container.querySelector('[role="dialog"][aria-label="小雾对话"]'));
  assert.doesNotMatch(container.textContent || "", /幻界终端/);

  await act(async () => root.render(<FantasyTerminal launcher="hidden" open config={{ ...DEFAULT_STORY_TERMINAL, name: "阿蓝" }} />));
  const heading = container.querySelector(".xiaowu-dialog>header>div");
  assert.equal(heading?.querySelector("strong")?.textContent, "小雾");
  assert.equal(heading?.querySelector("small")?.textContent, "阿蓝");
});

test("剧情反馈使用反应神情和角色气泡而不是全屏终端", async () => {
  const playback = {
    id: "feedback-1",
    message: "这条路径暂时无法继续。",
    speak: false,
    voiceUrl: "",
    interactionPreset: "glow" as const,
    imageUrl: "",
    imageAlt: "",
    imagePresentation: { fit: "cover" as const, positionX: 50, positionY: 50 },
    task: { ...createTerminalTask(), title: "寻找出口", status: "failed" as const },
    reaction: "warning" as const,
  };
  await act(async () => root.render(<FantasyTerminal playback={playback} reducedMotion />));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 120)));

  assert.equal(document.querySelector(".terminal-portal"), null);
  assert.ok(container.querySelector(".xiaowu-playback"));
  assert.match(container.querySelector(".xiaowu-companion img")?.getAttribute("src") || "", /\/xiaowu\/warning\.webp/);
  assert.match(container.textContent || "", /这条路径暂时无法继续/);
  const skip = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("跳过"));
  assert.ok(skip);
  assert.equal(document.activeElement, skip);
  assert.equal(container.querySelector('.xiaowu-playback[role="dialog"]')?.hasAttribute("aria-modal"), false);
  assert.match(container.querySelector('[role="status"]')?.textContent || "", /警告/);
});

test("键盘可以跳过自动反馈并把焦点还给原剧情选择", async () => {
  const before = document.querySelector<HTMLButtonElement>("#before")!;
  before.focus();
  let completed = 0;
  const playback = {
    id: "keyboard-feedback",
    message: "键盘也能继续剧情。",
    speak: false,
    voiceUrl: "",
    interactionPreset: "none" as const,
    imageUrl: "",
    imageAlt: "",
    imagePresentation: { fit: "cover" as const, positionX: 50, positionY: 50 },
    task: createTerminalTask(),
    reaction: "success" as const,
  };

  await act(async () => root.render(<FantasyTerminal playback={playback} reducedMotion onPlaybackComplete={() => { completed += 1; }} />));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  const dialog = container.querySelector<HTMLElement>('.xiaowu-playback[role="dialog"]');
  assert.ok(dialog);
  assert.match(container.querySelector('[role="status"]')?.textContent || "", /成功/);

  await act(async () => dialog.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  assert.equal(completed, 1);
  assert.equal(document.activeElement, before);

  await act(async () => root.render(<FantasyTerminal reducedMotion />));
  const launcher = container.querySelector<HTMLButtonElement>('[aria-label="打开小雾"]');
  assert.ok(launcher);
  await act(async () => launcher.click());
  const close = container.querySelector<HTMLButtonElement>('[aria-label="收起小雾"]');
  assert.ok(close);
  await act(async () => close.click());
  assert.equal(document.activeElement, launcher);
});

test("媒体阶段收起小雾且回到正文时保持收起", async () => {
  await act(async () => root.render(<FantasyTerminal />));
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="打开小雾"]')?.click());
  assert.ok(container.querySelector('[role="dialog"]'));

  await act(async () => root.render(<FantasyTerminal suppressed />));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  assert.equal(container.querySelector(".xiaowu-companion"), null);

  await act(async () => root.render(<FantasyTerminal />));
  assert.equal(container.querySelector('[role="dialog"]'), null);
  assert.ok(container.querySelector('[aria-label="打开小雾"]'));
});

test("登录账号装备服装会同步到侧边小雾且资源失败回退默认形象", async () => {
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "/api/auth/me") return Response.json({ user: { id: "reader-1", role: "reader" } });
    if (url === "/api/account/companion") return Response.json({ state: { equippedAppearance: "archive-cloak" } });
    return Response.json({ memory: null });
  };

  await act(async () => root.render(<FantasyTerminal />));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  const portrait = container.querySelector<HTMLImageElement>('.xiaowu-companion img');
  assert.match(portrait?.getAttribute("src") || "", /\/xiaowu\/appearances\/archive-cloak\/idle\.webp/);
  portrait?.dispatchEvent(new Event("error"));
  assert.match(portrait?.getAttribute("src") || "", /\/xiaowu\/idle\.webp/);
});

test("系统 reduced motion 自动取消逐字揭示", async () => {
  window.matchMedia = () => ({
    matches: true,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  });
  const playback = {
    id: "reduced-feedback",
    message: "小雾立即显示完整反馈。",
    speak: false,
    voiceUrl: "",
    interactionPreset: "none" as const,
    imageUrl: "",
    imageAlt: "",
    imagePresentation: { fit: "cover" as const, positionX: 50, positionY: 50 },
    task: createTerminalTask(),
    reaction: "notice" as const,
  };

  await act(async () => root.render(<FantasyTerminal playback={playback} />));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  assert.equal(container.querySelector('.terminal-playback-message p[aria-hidden="true"]')?.textContent, playback.message);
});

test("矮视口为小雾对话卡保留顶部空间", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /@media\(max-height:600px\)\{\.reader-shell \.xiaowu-dialog\{bottom:8px;max-height:calc\(100svh - 112px\)\}\}/);
  assert.match(css, /@media\(max-width:220px\)\{\.reader \.xiaowu-dialog\.xiaowu-playback\{top:88px;left:8px;width:calc\(100vw - 16px\);max-height:calc\(100svh - 104px\)\}\}/);
});
