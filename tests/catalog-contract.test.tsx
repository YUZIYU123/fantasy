import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CatalogScreen } from "../app/catalog/catalog-screen";

let dom: JSDOM;
let root: Root;
let container: HTMLDivElement;

function catalogItem(index: number) {
  const suffix = String(index).padStart(2, "0");
  return {
    id: `ongoing-${suffix}`,
    slug: `ongoing-${suffix}`,
    sortOrder: index,
    version: 1,
    format: "serial" as const,
    serialStatus: "ongoing" as const,
    published: {
      name: `未闭合档案${suffix}`,
      summary: "不会直接显示在紧凑卡片中的简介。",
      coverAssetId: "",
      coverUrl: "",
      coverAlt: `未闭合档案${suffix}封面`,
      coverPresentation: { fit: "cover" as const, positionX: 50, positionY: 50 },
    },
    hasReadableContent: true,
    chapterCount: index + 1,
    latestChapterTitle: `第${index + 1}章`,
  };
}

function shortCatalogItem(index: number) {
  const item = catalogItem(index);
  return {
    ...item,
    id: `short-${String(index).padStart(2, "0")}`,
    slug: `short-${String(index).padStart(2, "0")}`,
    format: "short" as const,
    serialStatus: null,
    wordCount: 1200 + index,
    interactive: index % 2 === 0,
    chapterCount: undefined,
    latestChapterTitle: undefined,
  };
}

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

beforeEach(() => {
  dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "http://localhost/catalog/ongoing" });
  const window = dom.window as unknown as Window & typeof globalThis;
  Object.assign(globalThis, {
    window, self: window, document: window.document, HTMLElement: window.HTMLElement,
    Event: window.Event, MouseEvent: window.MouseEvent, Image: window.Image,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: window.navigator });
  window.matchMedia = () => ({
    matches: true, media: "", onchange: null, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  });
  container = window.document.querySelector("#root") as HTMLDivElement;
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
});

test("分类全集页切换三类作品并稳定追加二十本后的下一页", async () => {
  let requests = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (!url.startsWith("/api/catalog?")) return Response.json({ user: null });
    requests += 1;
    return requests === 1
      ? Response.json({ items: Array.from({ length: 20 }, (_, index) => catalogItem(index)), total: 23, nextCursor: "next-page" })
      : Response.json({ items: [catalogItem(19), catalogItem(20), catalogItem(21), catalogItem(22)], total: 23, nextCursor: null });
  };

  await act(async () => root.render(<CatalogScreen section="ongoing" />));
  await settle();

  assert.equal(container.querySelector("h1")?.textContent, "尚未闭合的世界线");
  assert.equal(container.querySelector(".catalog-page-kicker")?.textContent, "连载小说");
  assert.deepEqual(
    [...container.querySelectorAll<HTMLAnchorElement>(".catalog-tabs a")].map((link) => [link.textContent, link.getAttribute("href")]),
    [["短篇", "/catalog/short"], ["连载小说", "/catalog/ongoing"], ["完结小说", "/catalog/completed"]],
  );
  assert.equal(container.querySelector('.catalog-tabs a[aria-current="page"]')?.textContent, "连载小说");
  assert.equal(container.querySelectorAll(".catalog-card").length, 20);
  assert.equal(container.querySelector(".catalog-card p"), null);

  const more = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "加载更多");
  assert.ok(more);
  await act(async () => more.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  await settle();
  assert.equal(container.querySelectorAll(".catalog-card").length, 23);
  assert.equal(new Set([...container.querySelectorAll(".catalog-card h3")].map((item) => item.textContent)).size, 23);
  assert.equal(requests, 2);
});

test("分类全集页首次失败可重试且加载更多失败保留已有作品", async () => {
  let requests = 0;
  globalThis.fetch = async (input) => {
    if (!String(input).startsWith("/api/catalog?")) return Response.json({ user: null });
    requests += 1;
    if (requests === 1) return Response.json({ error: "temporary" }, { status: 503 });
    if (requests === 2) return Response.json({ items: [catalogItem(0)], total: 2, nextCursor: "next" });
    return Response.json({ error: "temporary" }, { status: 503 });
  };
  await act(async () => root.render(<CatalogScreen section="ongoing" />));
  await settle();
  assert.match(container.textContent || "", /这类世界档案暂时没有加载出来/);
  const retry = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "重试");
  assert.ok(retry);
  await act(async () => retry.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  await settle();
  assert.equal(container.querySelectorAll(".catalog-card").length, 1);
  const more = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "加载更多");
  assert.ok(more);
  await act(async () => more.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  await settle();
  assert.equal(container.querySelectorAll(".catalog-card").length, 1);
  assert.match(container.textContent || "", /更多档案暂时没有加载出来/);
});

test("短篇加载更多后只为新增作品追加至多二十个标识的书架批量查询", async () => {
  const membershipBatches: string[][] = [];
  let catalogRequests = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.startsWith("/api/account/bookshelf/membership?")) {
      const ids = new URL(url, "http://localhost").searchParams.getAll("novelId");
      membershipBatches.push(ids);
      return Response.json({ memberships: Object.fromEntries(ids.map((id) => [id, false])) });
    }
    if (url.startsWith("/api/catalog?")) {
      catalogRequests += 1;
      return catalogRequests === 1
        ? Response.json({ items: Array.from({ length: 20 }, (_, index) => shortCatalogItem(index)), total: 23, nextCursor: "next" })
        : Response.json({ items: Array.from({ length: 3 }, (_, index) => shortCatalogItem(index + 20)), total: 23, nextCursor: null });
    }
    return Response.json({ user: null });
  };

  await act(async () => root.render(<CatalogScreen section="short" />));
  await settle();
  const more = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "加载更多");
  assert.ok(more);
  await act(async () => more.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  await settle();
  assert.deepEqual(membershipBatches.map((ids) => ids.length), [20, 3]);
  assert.deepEqual(membershipBatches[1], ["short-20", "short-21", "short-22"]);
});
