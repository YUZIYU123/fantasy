import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FantasyTerminal } from "../app/fantasy-terminal";
import { COMPANION_PREFERENCE_STORAGE_KEY } from "../lib/companion-placement";
import { DEFAULT_STORY_TERMINAL, createTerminalTask } from "../lib/story";

let dom: JSDOM;
let root: Root;
let container: HTMLDivElement;

function dispatchPointer(target: EventTarget, type: string, x: number, y: number, pointerId = 1) {
  const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    button: { value: 0 },
    clientX: { value: x },
    clientY: { value: y },
    isPrimary: { value: true },
    pointerId: { value: pointerId },
  });
  target.dispatchEvent(event);
}

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

test("小雾可以隐藏并通过边缘入口唤回且恢复焦点", async () => {
  await act(async () => root.render(<FantasyTerminal />));
  const launcher = container.querySelector<HTMLButtonElement>('button[aria-label="打开小雾"]');
  assert.ok(launcher);
  await act(async () => launcher.click());

  const hide = container.querySelector<HTMLButtonElement>('button[aria-label="隐藏小雾"]');
  assert.ok(hide);
  await act(async () => hide.click());
  const restore = container.querySelector<HTMLButtonElement>('button[aria-label="唤回小雾"]');
  assert.ok(restore);
  assert.equal(container.querySelector(".xiaowu-companion"), null);
  assert.equal(document.activeElement, restore);
  assert.equal(JSON.parse(localStorage.getItem(COMPANION_PREFERENCE_STORAGE_KEY) || "{}").hidden, true);

  await act(async () => restore.click());
  const restored = container.querySelector<HTMLButtonElement>('button[aria-label="打开小雾"]');
  assert.ok(restored);
  assert.equal(document.activeElement, restored);
  assert.equal(JSON.parse(localStorage.getItem(COMPANION_PREFERENCE_STORAGE_KEY) || "{}").hidden, false);
});

test("浏览器偏好存储不可用时隐藏与唤回仍在本页生效", async () => {
  Object.defineProperty(localStorage, "setItem", { configurable: true, value() { throw new Error("storage unavailable"); } });
  await act(async () => root.render(<FantasyTerminal />));
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="打开小雾"]')?.click());
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="隐藏小雾"]')?.click());
  assert.ok(container.querySelector('button[aria-label="唤回小雾"]'));

  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="唤回小雾"]')?.click());
  assert.ok(container.querySelector('button[aria-label="打开小雾"]'));
});

test("拖拽小雾会保存位置且不会误触发打开对话", async () => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
  await act(async () => root.render(<FantasyTerminal />));
  const launcher = container.querySelector<HTMLButtonElement>('button[aria-label="打开小雾"]');
  assert.ok(launcher);
  Object.defineProperty(launcher, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ x: 0, y: 500, left: 0, top: 500, right: 70, bottom: 598, width: 70, height: 98, toJSON() {} }),
  });

  await act(async () => {
    dispatchPointer(launcher, "pointerdown", 10, 510);
    dispatchPointer(window, "pointermove", 200, 410);
    dispatchPointer(window, "pointerup", 200, 410);
  });

  assert.equal(launcher.getAttribute("aria-expanded"), "false");
  assert.equal(launcher.style.left, "190px");
  assert.equal(launcher.style.top, "400px");
  const preference = JSON.parse(localStorage.getItem(COMPANION_PREFERENCE_STORAGE_KEY) || "{}");
  assert.equal(preference.hidden, false);
  assert.ok(preference.position.x > 0 && preference.position.x < 1);
  assert.ok(preference.position.y > 0 && preference.position.y < 1);

  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  await act(async () => launcher.click());
  assert.equal(launcher.getAttribute("aria-expanded"), "true");
});

test("小雾只在手机内容框内移动并在左右边框对称探头", async () => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
  container.className = "reader-shell";
  Object.defineProperty(container, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ x: 385, y: 0, left: 385, top: 0, right: 815, bottom: 844, width: 430, height: 844, toJSON() {} }),
  });
  await act(async () => root.render(<FantasyTerminal />));
  const launcher = container.querySelector<HTMLButtonElement>('button[aria-label="打开小雾"]');
  assert.ok(launcher);
  Object.defineProperty(launcher, "getBoundingClientRect", {
    configurable: true,
    value: () => {
      const left = Number.parseFloat(launcher.style.left) || 385;
      const top = Number.parseFloat(launcher.style.top) || 500;
      return { x: left, y: top, left, top, right: left + 70, bottom: top + 98, width: 70, height: 98, toJSON() {} };
    },
  });

  await act(async () => {
    dispatchPointer(launcher, "pointerdown", 400, 510);
    dispatchPointer(window, "pointermove", 900, 410);
    dispatchPointer(window, "pointerup", 900, 410);
  });
  assert.match(launcher.className, /edge-right/);
  assert.match(launcher.className, /is-peeking/);
  assert.equal(launcher.style.left, "745px");

  await act(async () => {
    dispatchPointer(launcher, "pointerdown", 760, 410, 2);
    dispatchPointer(window, "pointermove", 600, 410, 2);
    dispatchPointer(window, "pointerup", 600, 410, 2);
  });
  assert.doesNotMatch(launcher.className, /edge-/);
  assert.match(launcher.className, /is-floating/);
  assert.equal(launcher.style.left, "523px");

  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.xiaowu-companion\.edge-right img\{[^}]*left:-6px[^}]*scaleX\(-1\)/);
});

test("正式阅读在桌面端也使用居中的手机阅读框作为小雾边界", async () => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
  container.className = "reader";
  Object.defineProperty(container, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 844, width: 1200, height: 844, toJSON() {} }),
  });
  localStorage.setItem(COMPANION_PREFERENCE_STORAGE_KEY, JSON.stringify({
    version: 1,
    hidden: false,
    position: { x: 1, y: 0.5 },
  }));

  await act(async () => root.render(<FantasyTerminal />));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  const launcher = container.querySelector<HTMLButtonElement>('button[aria-label="打开小雾"]');
  assert.ok(launcher);
  assert.match(launcher.className, /edge-right/);
  assert.equal(launcher.style.left, "745px");
});

test("键盘方向键移动小雾并遵守视口安全区", async () => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
  await act(async () => root.render(<FantasyTerminal />));
  const launcher = container.querySelector<HTMLButtonElement>('button[aria-label="打开小雾"]');
  assert.ok(launcher);
  Object.defineProperty(launcher, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ x: 0, y: 500, left: 0, top: 500, right: 70, bottom: 598, width: 70, height: 98, toJSON() {} }),
  });

  await act(async () => launcher.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true })));
  assert.equal(launcher.style.left, "24px");
  assert.equal(launcher.style.top, "500px");
  assert.equal(launcher.getAttribute("aria-keyshortcuts"), "ArrowUp ArrowDown ArrowLeft ArrowRight");
});

test("保存的位置跨页面恢复且对话卡跟随小雾留在视口内", async () => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
  localStorage.setItem(COMPANION_PREFERENCE_STORAGE_KEY, JSON.stringify({
    version: 1,
    hidden: false,
    position: { x: 1, y: 0.75 },
  }));

  await act(async () => root.render(<FantasyTerminal />));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  const launcher = container.querySelector<HTMLButtonElement>('button[aria-label="打开小雾"]');
  assert.ok(launcher);
  assert.equal(launcher.style.left, "320px");
  await act(async () => launcher.click());
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

  const dialog = container.querySelector<HTMLElement>('[role="dialog"][aria-label="小雾对话"]');
  assert.ok(dialog);
  assert.match(dialog.className, /dialog-side-above/);
  assert.notEqual(dialog.style.left, "");
  assert.notEqual(dialog.style.top, "");
  assert.equal(dialog.style.bottom, "auto");
});

test("隐藏启动器仍兼容受控打开，历史默认名称不重复显示", async () => {
  localStorage.setItem(COMPANION_PREFERENCE_STORAGE_KEY, JSON.stringify({ version: 1, hidden: true, position: { x: 1, y: 1 } }));
  await act(async () => root.render(<FantasyTerminal launcher="hidden" open config={DEFAULT_STORY_TERMINAL} />));
  assert.equal(container.querySelector('button[aria-label="打开小雾"]'), null);
  assert.equal(container.querySelector('button[aria-label="唤回小雾"]'), null);
  assert.ok(container.querySelector('[role="dialog"][aria-label="小雾对话"]'));
  assert.doesNotMatch(container.textContent || "", /幻界终端/);

  await act(async () => root.render(<FantasyTerminal launcher="hidden" open config={{ ...DEFAULT_STORY_TERMINAL, name: "阿蓝" }} />));
  const heading = container.querySelector(".xiaowu-dialog>header>div");
  assert.equal(heading?.querySelector("strong")?.textContent, "小雾");
  assert.equal(heading?.querySelector("small")?.textContent, "阿蓝");
});

test("作者预览不读取或改写读者的小雾位置偏好", async () => {
  const saved = JSON.stringify({ version: 1, hidden: true, position: { x: 1, y: 1 } });
  localStorage.setItem(COMPANION_PREFERENCE_STORAGE_KEY, saved);
  await act(async () => root.render(<FantasyTerminal preview open />));

  assert.ok(container.querySelector('.xiaowu-companion'));
  assert.equal(container.querySelector('[aria-label="唤回小雾"]'), null);
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="隐藏小雾"]')?.click());
  assert.equal(localStorage.getItem(COMPANION_PREFERENCE_STORAGE_KEY), saved);
  assert.ok(container.querySelector('[role="dialog"][aria-label="小雾对话"]'));
});

test("隐藏偏好不吞掉剧情反馈且反馈结束后恢复隐藏", async () => {
  localStorage.setItem(COMPANION_PREFERENCE_STORAGE_KEY, JSON.stringify({ version: 1, hidden: true, position: null }));
  const playback = {
    id: "hidden-feedback",
    message: "这条提示仍然需要看见。",
    speak: false,
    voiceUrl: "",
    interactionPreset: "none" as const,
    imageUrl: "",
    imageAlt: "",
    imagePresentation: { fit: "cover" as const, positionX: 50, positionY: 50 },
    task: createTerminalTask(),
    reaction: "notice" as const,
  };

  function FeedbackHarness() {
    const [active, setActive] = useState(true);
    return <FantasyTerminal playback={active ? playback : null} reducedMotion onPlaybackComplete={() => setActive(false)} />;
  }

  await act(async () => root.render(<FeedbackHarness />));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  assert.ok(container.querySelector(".xiaowu-companion"));
  assert.ok(container.querySelector('[role="dialog"][aria-label="小雾对话"]'));
  assert.equal(container.querySelector('[aria-label="唤回小雾"]'), null);

  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="跳过小雾反馈"]')?.click());
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  assert.equal(container.querySelector(".xiaowu-companion"), null);
  assert.ok(container.querySelector('[aria-label="唤回小雾"]'));
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
