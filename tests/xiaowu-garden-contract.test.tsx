import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { XiaowuGardenScreen } from "../app/xiaowu/screen";

let dom: JSDOM;
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/xiaowu" });
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
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: window.crypto });
  container = window.document.querySelector("#root") as HTMLDivElement;
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
});

test("访客在当前会话试玩且不会访问账号养成接口", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), method: init?.method || "GET" });
    return Response.json({ user: null });
  };

  await act(async () => root.render(<XiaowuGardenScreen />));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

  assert.match(container.textContent || "", /本次会话试玩/);
  assert.match(container.textContent || "", /试玩状态不会保存/);
  assert.equal(container.querySelector(".xiaowu-companion"), null);
  assert.equal(calls.some((call) => call.url.startsWith("/api/account/companion")), false);

  const play = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("一起玩"));
  assert.ok(play);
  await act(async () => play.click());
  assert.match(container.textContent || "", /17 雾光/);
  assert.ok(sessionStorage.getItem("fantasy-xiaowu-garden-trial-v1"));
  assert.equal(container.querySelector('a[href="/register"]'), null);
});

test("登录账号从服务端读取状态并提交幂等互动", async () => {
  const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    calls.push({ url, body });
    if (url === "/api/auth/me") return Response.json({ user: { id: "reader-1", role: "reader" } });
    if (url === "/api/account/companion") return Response.json({ state: {
      bondXp: 140, level: 2, bondInLevel: 40, bondToNextLevel: 100,
      vitality: 55, mood: "calm", mistlight: 24,
      equippedAppearance: "default", equippedGarden: "world-tree",
    }, memories: [{
      chapterId: "chapter-memory", chapterVersion: 2, chapterTitle: "雾港失火", novelName: "焦账员",
      coverUrl: "/fantasy-os-orbit.jpg", coverAlt: "焦账员封面", completedAt: "2026-08-28T12:00:00.000Z",
    }], recentRewards: [{ kind: "completion", result: { bondXp: 40, mistlight: 20 }, createdAt: "2026-08-28T12:00:00.000Z" }],
      exploration: [{ chapterId: "chapter-memory", chapterVersion: 2, discovered: 4, total: 7 }],
    });
    return Response.json({ outcome: "restored", state: {
      bondXp: 140, level: 2, bondInLevel: 40, bondToNextLevel: 100,
      vitality: 70, mood: "bright", mistlight: 21,
      equippedAppearance: "default", equippedGarden: "world-tree",
    } });
  };

  await act(async () => root.render(<XiaowuGardenScreen />));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

  assert.match(container.textContent || "", /羁绊等级 2/);
  assert.match(container.textContent || "", /雾港失火/);
  assert.match(container.textContent || "", /已发现 4 \/ 7 个剧情节点/);
  assert.match(container.textContent || "", /最近获得 40 羁绊与 20 雾光/);
  const play = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("一起玩"));
  assert.ok(play);
  await act(async () => play.click());
  assert.equal(calls.at(-1)?.url, "/api/account/companion/actions");
  assert.equal(calls.at(-1)?.body?.action, "play");
  assert.equal(typeof calls.at(-1)?.body?.operationId, "string");
  assert.match(container.textContent || "", /21 雾光/);
});
