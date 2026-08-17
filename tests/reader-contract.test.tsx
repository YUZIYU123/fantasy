import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Reader, StoryStudio } from "../app/story-studio";
import { createTerminalTask, normalizeStory, STORY_PAGE_BREAK, type StoryDocument } from "../lib/story";
import { storyFixture } from "./story-fixture.mjs";

type FetchCall = { input: string; method: string; body?: Record<string, unknown> };

let dom: JSDOM;
let root: Root;
let container: HTMLDivElement;
let fetchCalls: FetchCall[];
let remoteProgress: Record<string, unknown> | null;
let prefersReducedMotion: boolean;

function readerStory() {
  return normalizeStory(storyFixture() as unknown as StoryDocument);
}

function publicNovel(id: string, name: string, sortOrder: number, chapters: string[]) {
  return {
    id,
    slug: id,
    sortOrder,
    status: "published",
    version: 1,
    updatedAt: "2026-08-17T00:00:00.000Z",
    published: {
      name,
      summary: `${name}的档案简介`,
      coverAssetId: "",
      coverUrl: "",
      coverAlt: `${name}封面`,
      coverPresentation: { fit: "cover", positionX: 50, positionY: 50 },
    },
    chapters: chapters.map((title, index) => ({
      id: `${id}-chapter-${index + 1}`,
      novelId: id,
      slug: `${id}-${index + 1}`,
      title,
      summary: `${title}简介`,
      sortOrder: index + 1,
      version: 1,
      updatedAt: `2026-08-${String(index + 10).padStart(2, "0")}T00:00:00.000Z`,
      published: { ...readerStory(), title, summary: `${title}简介` },
    })),
  };
}

function installDom() {
  dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    url: "http://localhost/",
  });
  const window = dom.window as unknown as Window & typeof globalThis;
  Object.assign(globalThis, {
    window,
    self: window,
    document: window.document,
    localStorage: window.localStorage,
    sessionStorage: window.sessionStorage,
    HTMLElement: window.HTMLElement,
    HTMLMediaElement: window.HTMLMediaElement,
    HTMLVideoElement: window.HTMLVideoElement,
    Image: window.Image,
    Audio: window.Audio,
    Event: window.Event,
    MouseEvent: window.MouseEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: window.navigator });
  window.matchMedia = () => ({
    matches: prefersReducedMotion,
    media: "",
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  });
  Object.defineProperty(window.HTMLElement.prototype, "scrollTo", { configurable: true, value() {} });
  Object.defineProperty(window.HTMLMediaElement.prototype, "play", {
    configurable: true,
    value() { return Promise.reject(new Error("media unavailable")); },
  });
  Object.defineProperty(window.HTMLMediaElement.prototype, "pause", { configurable: true, value() {} });
  globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(performance.now() + 10_000), 0) as unknown as number;
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  fetchCalls = [];
  remoteProgress = null;
  prefersReducedMotion = true;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = init.method || "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    fetchCalls.push({ input: url, method, body });
    if (url.startsWith("/api/account/progress") && method === "GET") {
      return Response.json({ progress: remoteProgress });
    }
    if (url === "/api/auth/me") return Response.json({ user: null }, { status: 401 });
    return Response.json({ ok: true });
  };
  container = window.document.querySelector("#root") as HTMLDivElement;
  root = createRoot(container);
}

async function settle(milliseconds = 0) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
  });
}

function clickButton(label: string) {
  const button = [...container.ownerDocument.querySelectorAll("button")]
    .find((candidate) => candidate.textContent?.includes(label));
  assert.ok(button, `找不到按钮：${label}`);
  button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  return button;
}

beforeEach(() => installDom());

afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
});

test("预览会话共享分页和剧情推进，但不读取或保存阅读进度", async () => {
  const story = readerStory();
  story.nodes[0].body = `第一页${STORY_PAGE_BREAK}第二页`;
  await act(async () => root.render(<Reader story={story} chapterId="preview-chapter" chapterVersion={3} preview onBack={() => {}} />));

  assert.match(container.textContent || "", /第一页/);
  assert.match(container.textContent || "", /1 \/ 2/);
  await act(async () => clickButton("下一页"));
  assert.match(container.textContent || "", /第二页/);
  await act(async () => clickButton("路径甲"));
  await settle(180);
  assert.match(container.textContent || "", /分支甲正文/);
  assert.equal(fetchCalls.filter((call) => call.input.startsWith("/api/account/progress")).length, 0);
  assert.equal(localStorage.getItem("mist-page-progress:preview-chapter"), null);
});

test("正式阅读选择较新的云端进度", async () => {
  const story = readerStory();
  localStorage.setItem("mist-page-progress:progress-chapter", JSON.stringify({
    nodeId: "branch-a",
    pageIndex: 0,
    terminalEventIds: [],
    version: 7,
    updatedAt: "2026-08-08T10:00:00.000Z",
  }));
  remoteProgress = {
    nodeId: "branch-b",
    pageIndex: 0,
    terminalEventIds: [],
    version: 7,
    updatedAt: "2026-08-08T11:00:00.000Z",
    completedAt: null,
  };
  await act(async () => root.render(<Reader story={story} chapterId="progress-chapter" chapterVersion={7} onBack={() => {}} />));
  await settle();
  assert.match(container.textContent || "", /分支乙正文/);
});

test("正式阅读等待云端进度时显示可读的进入状态", async () => {
  const story = readerStory();
  globalThis.fetch = async (input) => {
    if (String(input).startsWith("/api/account/progress")) return new Promise<Response>(() => {});
    return Response.json({ ok: true });
  };

  await act(async () => root.render(<Reader story={story} chapterId="loading-chapter" chapterVersion={7} onBack={() => {}} />));

  assert.match(container.textContent || "", /正在进入章节/);
  assert.equal(container.querySelector('[role="status"]')?.getAttribute("aria-live"), "polite");
  assert.equal(container.querySelector<HTMLButtonElement>('button[aria-label="返回章节目录"]')?.textContent, "←");
  assert.equal(container.querySelector(".reader-dock"), null);
});

test("世界档案直接使用幻界 OS Dock 而不再折叠主导航", async () => {
  globalThis.fetch = async () => Response.json({ novels: [] });
  await act(async () => root.render(<StoryStudio />));
  await settle();

  const navigation = container.querySelector('nav[aria-label="读者主导航"]');
  assert.ok(navigation);
  assert.deepEqual([...navigation.querySelectorAll("a,button")].map((item) => item.textContent?.trim()), ["世界", "书架", "终端", "我的"]);
  assert.equal(container.querySelector("details.reader-navigation"), null);
});

test("多部小说只突出排序第一的主档案并按原顺序列出其余档案", async () => {
  const novels = [
    publicNovel("primary", "焦账员", 1, ["失火", "虚假报警的代价"]),
    publicNovel("second", "白塔沉默", 2, ["雪城", "回声"]),
    publicNovel("third", "时隙观测者", 3, ["观测协议"]),
  ];
  globalThis.fetch = async (input) => String(input) === "/api/novels"
    ? Response.json({ novels })
    : Response.json({ user: null });

  await act(async () => root.render(<StoryStudio />));
  await settle();

  assert.equal(container.querySelector(".archive-feature h3")?.textContent, "焦账员");
  assert.match(container.querySelector(".archive-feature")?.textContent || "", /虚假报警的代价/);
  assert.deepEqual(
    [...container.querySelectorAll(".archive-list article h3")].map((heading) => heading.textContent),
    ["白塔沉默", "时隙观测者"],
  );
  assert.equal(container.querySelector(".archive-list")?.textContent?.includes("焦账员"), false);
});

test("只有一部小说时只显示主档案而不制造重复列表", async () => {
  globalThis.fetch = async (input) => String(input) === "/api/novels"
    ? Response.json({ novels: [publicNovel("only", "唯一档案", 1, ["入口"])] })
    : Response.json({ user: null });

  await act(async () => root.render(<StoryStudio />));
  await settle();

  assert.equal(container.querySelector(".archive-feature h3")?.textContent, "唯一档案");
  assert.equal(container.querySelector(".archive-list"), null);
  assert.equal([...container.querySelectorAll("h3")].filter((heading) => heading.textContent === "唯一档案").length, 1);
});

test("世界档案读取失败时显示错误并允许重试", async () => {
  let attempts = 0;
  globalThis.fetch = async (input) => {
    if (String(input) !== "/api/novels") return Response.json({});
    attempts += 1;
    if (attempts === 1) return Response.json({ error: "temporary" }, { status: 503 });
    return Response.json({ novels: [] });
  };
  await act(async () => root.render(<StoryStudio />));
  await settle();

  assert.match(container.textContent || "", /世界档案暂时没有加载出来/);
  assert.doesNotMatch(container.textContent || "", /新的世界正在构建/);
  const retry = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("重试"));
  assert.ok(retry);
  await act(async () => retry.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  await settle();
  assert.equal(attempts, 2);
  assert.match(container.textContent || "", /新的世界正在构建/);
});

test("云端进度不可用时正式阅读降级到本机起点", async () => {
  const story = readerStory();
  globalThis.fetch = async (input) => String(input).startsWith("/api/account/progress")
    ? Response.json({ error: "temporary" }, { status: 503 })
    : Response.json({ ok: true });

  await act(async () => root.render(<Reader story={story} chapterId="offline-progress" chapterVersion={7} onBack={() => {}} />));
  await settle();

  assert.match(container.textContent || "", /起点正文/);
  assert.doesNotMatch(container.textContent || "", /正在进入章节/);
});

test("完成记录和章节发布版本变化分别让会话从开头重启", async () => {
  const story = readerStory();
  for (const progress of [
    {
      nodeId: "ending-a",
      pageIndex: 0,
      terminalEventIds: ["old-event"],
      version: 7,
      updatedAt: "2026-08-08T12:00:00.000Z",
      completedAt: "2026-08-08T12:00:00.000Z",
    },
    {
      nodeId: "branch-b",
      pageIndex: 0,
      terminalEventIds: ["old-event"],
      version: 6,
      updatedAt: "2026-08-08T13:00:00.000Z",
      completedAt: null,
    },
  ]) {
    localStorage.setItem("mist-page-progress:restart-chapter", JSON.stringify(progress));
    remoteProgress = null;
    await act(async () => root.render(<Reader story={story} chapterId="restart-chapter" chapterVersion={7} onBack={() => {}} />));
    await settle();
    assert.match(container.textContent || "", /起点正文/);
    await act(async () => root.unmount());
    root = createRoot(container);
  }
});

test("正式阅读导航和完成都会写入设备与云端进度", async () => {
  const story = readerStory();
  story.nodes[0].canEndChapter = true;
  let completed = false;
  await act(async () => root.render(<Reader
    story={story}
    chapterId="persist-chapter"
    chapterVersion={9}
    onBack={() => {}}
    onComplete={() => { completed = true; }}
  />));
  await settle();
  assert.ok(fetchCalls.some((call) => call.input === "/api/account/progress" && call.method === "PUT" && call.body?.completed === false));
  await act(async () => clickButton("结束本章"));
  assert.equal(completed, true);
  const saved = JSON.parse(localStorage.getItem("mist-page-progress:persist-chapter") || "{}");
  assert.equal(saved.completedAt, saved.updatedAt);
  assert.ok(fetchCalls.some((call) => call.input === "/api/account/progress" && call.method === "PUT" && call.body?.completed === true));
});

test("转场视频失败后会进入正文", async () => {
  const story = readerStory();
  story.nodes[0].videoMode = "transition";
  story.nodes[0].videoUrl = "https://example.com/unavailable.mp4";
  prefersReducedMotion = false;
  await act(async () => root.render(<Reader story={story} chapterId="video-failure" preview onBack={() => {}} />));
  const video = container.querySelector(".transition-video video");
  assert.ok(video);
  assert.doesNotMatch(container.textContent || "", /起点正文/);
  await act(async () => video.dispatchEvent(new dom.window.Event("error", { bubbles: true })));
  await settle();
  assert.match(container.textContent || "", /起点正文/);
});

test("转场视频成功开始后超时仍会进入正文", async () => {
  const story = readerStory();
  story.nodes[0].videoMode = "transition";
  story.nodes[0].videoUrl = "https://example.com/stalled.mp4";
  prefersReducedMotion = false;
  Object.defineProperty(window.HTMLMediaElement.prototype, "play", {
    configurable: true,
    value() { return Promise.resolve(); },
  });
  const nativeSetTimeout = globalThis.setTimeout;
  let videoTimeout: (() => void) | null = null;
  globalThis.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
    if (delay === 30_000 && typeof callback === "function") {
      videoTimeout = () => callback(...args);
      return 30_000 as unknown as ReturnType<typeof setTimeout>;
    }
    return nativeSetTimeout(callback, delay, ...args);
  }) as typeof setTimeout;
  try {
    await act(async () => root.render(<Reader story={story} chapterId="video-timeout" preview onBack={() => {}} />));
    await settle();
    assert.ok(videoTimeout);
    assert.doesNotMatch(container.textContent || "", /起点正文/);
    await act(async () => videoTimeout?.());
    assert.match(container.textContent || "", /起点正文/);
  } finally {
    globalThis.setTimeout = nativeSetTimeout;
  }
});

test("进入和离开音乐区间会更新当前配乐", async () => {
  const story = readerStory();
  story.musicCues = [{
    id: "cue-main",
    name: "契约配乐",
    assetId: "music",
    url: "https://example.com/music.mp3",
    volume: 0.5,
    loop: true,
    fadeMs: 0,
    startNodeId: "start",
    stopNodeIds: ["start"],
  }];
  await act(async () => root.render(<Reader story={story} chapterId="music-range" preview onBack={() => {}} />));
  await settle();
  assert.match(container.textContent || "", /契约配乐/);
  await act(async () => clickButton("路径甲"));
  await settle(180);
  assert.doesNotMatch(container.textContent || "", /契约配乐/);
});

test("旧格式的复合完成记录仍然从开头重启", async () => {
  const story = readerStory();
  remoteProgress = {
    nodeId: "ending-a",
    pageIndex: 0,
    terminalEventIds: ["old-event"],
    version: 6,
    updatedAt: "2026-08-08T12:00:00.000Z",
    completedAt: "2026-08-08T12:00:00.000Z",
  };
  await act(async () => root.render(<Reader story={story} chapterId="legacy-restart" chapterVersion={7} onBack={() => {}} />));
  await settle();
  assert.match(container.textContent || "", /起点正文/);
});

test("音效播放失败不会永久锁住剧情导航", async () => {
  const story = readerStory();
  const choice = story.nodes[0].choices[0];
  choice.sfxUrl = "https://example.com/unavailable.mp3";
  choice.sfxMaxDurationMs = 10_000;
  await act(async () => root.render(<Reader story={story} chapterId="failure-chapter" preview onBack={() => {}} />));

  await act(async () => clickButton("路径甲"));
  const activeChoice = clickButton("路径甲");
  assert.equal(activeChoice.disabled, true);
  await settle(180);
  assert.match(container.textContent || "", /分支甲正文/);
});

test("节点独立图片阶段完成后才显示正文", async () => {
  const story = readerStory();
  story.nodes[0].displayImagePosition = "before";
  story.nodes[0].displayImageUrl = "";
  story.nodes[0].displayImageAlt = "暂不可用的节点图";
  await act(async () => root.render(<Reader story={story} chapterId="image-phase" preview onBack={() => {}} />));

  assert.match(container.textContent || "", /暂不可用的节点图/);
  assert.doesNotMatch(container.textContent || "", /起点正文/);
  await act(async () => clickButton("继续"));
  assert.match(container.textContent || "", /起点正文/);
});

test("终端反馈完成前保持选择锁定，完成后再进入目标节点", async () => {
  const story = readerStory();
  const choice = story.nodes[0].choices[0];
  choice.terminalFeedbackEnabled = true;
  choice.terminalMessage = "任务已更新";
  choice.terminalSpeak = false;
  const task = createTerminalTask();
  task.title = "契约任务";
  story.terminal.initialTask = task;
  choice.terminalTaskActions = [{ id: "complete-task", type: "setTaskStatus", task: null, objective: null, objectiveId: "", status: "completed" }];
  await act(async () => root.render(<Reader story={story} chapterId="terminal-order" onBack={() => {}} />));
  await settle();

  await act(async () => clickButton("路径甲"));
  assert.doesNotMatch(container.textContent || "", /分支甲正文/);
  await settle();
  let skip: HTMLButtonElement | undefined;
  await act(async () => { skip = clickButton("跳过"); });
  assert.ok(skip);
  assert.equal(skip.disabled, false);
  await settle(120);
  assert.match(container.textContent || "", /分支甲正文/);
  assert.ok(fetchCalls.some((call) => call.input === "/api/account/progress"
    && call.method === "PUT"
    && Array.isArray(call.body?.terminalEventIds)
    && call.body.terminalEventIds.includes("complete-task")));
});
