import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AuthForm, VerifyEmail } from "../app/auth-forms";
import { FantasyTerminal } from "../app/fantasy-terminal";
import { StoryStudio } from "../app/story-studio";
import { browserRegistrationInvitationStore } from "../lib/registration-invitation";
import { createBlankStory } from "../lib/story";

let dom: JSDOM;
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "http://localhost/register" });
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
  Object.assign(window.HTMLElement.prototype, { attachEvent() {}, detachEvent() {} });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: window.navigator });
  window.matchMedia = () => ({
    matches: false,
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
  globalThis.fetch = async () => Response.json({ turnstileSiteKey: "" });
  container = window.document.querySelector("#root") as HTMLDivElement;
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
});

test("账号注册关闭时访客只看到明确说明且不能提交", async () => {
  await act(async () => root.render(<AuthForm mode="register" registrationEnabled={false} />));
  assert.match(container.textContent || "", /账号注册尚未开放/);
  assert.equal(container.querySelector("form"), null);
  assert.match(container.textContent || "", /仍然可以浏览和阅读公开小说/);
  assert.equal(container.querySelector('nav[aria-label="读者主导航"] [aria-current="page"]')?.textContent?.trim(), "我的");
});

test("访客从小雾邀请进入手机单步账号注册", async () => {
  await act(async () => root.render(<AuthForm mode="register" registrationEnabled />));
  assert.match(container.textContent || "", /想让我替你记住这段旅程吗/);
  assert.match(container.textContent || "", /建立账号/);
  assert.equal(container.querySelector('input[name="displayName"]'), null);
  assert.match(container.innerHTML, /registration-guide/);
});

test("邮箱确认页读取无副作用且只在访客确认后激活", async () => {
  window.history.replaceState({}, "", "/verify-email?token=contract-token");
  const calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = init.method || "GET";
    calls.push({ url, method });
    if (method === "GET") return Response.json({ state: "ready" });
    return Response.json({ state: "active", user: { displayName: "旅伴" } });
  };
  await act(async () => root.render(<VerifyEmail />));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  assert.equal(calls.some((call) => call.method !== "GET"), false);
  assert.deepEqual(
    calls.filter((call) => call.url.startsWith("/api/auth/verify-email")),
    [{ url: "/api/auth/verify-email?token=contract-token", method: "GET" }],
  );
  assert.match(container.textContent || "", /确认并进入幻界/);
  const confirm = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("确认并进入幻界"));
  assert.ok(confirm);
  await act(async () => confirm.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  assert.equal(calls.at(-1)?.method, "POST");
  assert.match(container.textContent || "", /欢迎回来，旅伴/);
});

test("当前设备只恢复二十四小时内且不含秘密的注册草稿", async () => {
  localStorage.setItem("fantasy:registration-draft", JSON.stringify({
    schemaVersion: 1,
    savedAt: new Date().toISOString(),
    step: 4,
    displayName: "归来的旅伴",
    email: "returning@example.com",
    password: "不应被恢复的秘密",
    turnstileToken: "不应被恢复的 token",
    termsAccepted: true,
  }));
  await act(async () => root.render(<AuthForm mode="register" registrationEnabled />));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  assert.match(container.textContent || "", /年龄确认/);
  const requiredConfirmations = [...container.querySelectorAll<HTMLInputElement>('fieldset input[type="checkbox"]')].slice(0, 3);
  assert.equal(requiredConfirmations.length, 3);
  for (const confirmation of requiredConfirmations) {
    await act(async () => confirmation.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  }
  const continueButton = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("继续"));
  assert.ok(continueButton);
  await act(async () => continueButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  const password = container.querySelector<HTMLInputElement>('input[name="password"]');
  assert.ok(password);
  assert.equal(password.value, "");
  const stored = JSON.parse(localStorage.getItem("fantasy:registration-draft") || "{}");
  assert.equal(stored.displayName, "归来的旅伴");
  assert.equal(stored.email, "returning@example.com");
  assert.equal("password" in stored, false);
  assert.equal("turnstileToken" in stored, false);
  assert.equal("termsAccepted" in stored, false);
});

test("注册入口只保留白名单注册意图并随草稿接续", async () => {
  window.history.replaceState({}, "", "/register?intent=bookshelf&target=novel-42&next=https://evil.example");
  await act(async () => root.render(<AuthForm mode="register" registrationEnabled />));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  const stored = JSON.parse(localStorage.getItem("fantasy:registration-draft") || "{}");
  assert.deepEqual(stored.intent, { kind: "bookshelf", targetId: "novel-42" });
  assert.equal("next" in stored, false);
});

test("可选注册分析与必要同意分开且可以拒绝", async () => {
  await act(async () => root.render(<AuthForm mode="register" registrationEnabled />));
  const start = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("建立账号"));
  assert.ok(start);
  await act(async () => start.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  const optional = container.querySelector<HTMLInputElement>('input[name="registrationAnalytics"]');
  assert.ok(optional);
  assert.equal(optional.required, false);
  assert.equal(optional.checked, false);
  assert.match(optional.closest("label")?.textContent || "", /可选/);
  assert.match(container.textContent || "", /之后.*更改/);
});

test("账号激活后单独询问阅读偏好且拒绝不阻塞使用", async () => {
  window.history.replaceState({}, "", "/verify-email?token=preference-token");
  const calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = init.method || "GET";
    calls.push({ url, method });
    if (method === "GET") return Response.json({ state: "ready" });
    return Response.json({ state: "active", user: { displayName: "偏好旅伴" } });
  };
  await act(async () => root.render(<VerifyEmail />));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  const confirm = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("确认并进入幻界"));
  assert.ok(confirm);
  await act(async () => confirm.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  assert.match(container.textContent || "", /同步阅读偏好/);
  const skip = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("暂不同步"));
  assert.ok(skip);
  await act(async () => skip.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  assert.match(container.textContent || "", /进入幻界/);
  assert.equal(calls.some((call) => call.url === "/api/account/guide-memory"), false);
});

test("重发恢复使用与服务端一致的 Turnstile action", async () => {
  window.history.replaceState({}, "", "/register?recovery=1");
  await act(async () => root.render(<AuthForm mode="register" registrationEnabled />));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  const email = container.querySelector<HTMLInputElement>('input[name="email"]');
  assert.ok(email);
  await act(async () => {
    email.value = "recovery@example.com";
    email.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  const next = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("继续"));
  assert.ok(next);
  await act(async () => next.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  assert.equal(container.querySelector(".turnstile-wrap")?.getAttribute("data-action"), "resend-verification");
});

test("三类账号意图使用情境邀请且明确表达后可以重新邀请", async () => {
  await act(async () => root.render(<FantasyTerminal
    readingContextId="chapter-42"
    novels={[{ id: "novel-42", published: { name: "雾中书", summary: "奇幻旅程" } }]}
  />));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  const open = container.querySelector<HTMLButtonElement>('.xiaowu-companion[aria-label="打开小雾"]');
  assert.ok(open);
  await act(async () => open.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  assert.match(container.textContent || "", /跨设备继续/);
  assert.match(container.textContent || "", /同步当前阅读进度/);
  const crossDevice = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("跨设备继续"));
  assert.ok(crossDevice);
  await act(async () => crossDevice.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  assert.match(container.textContent || "", /不同设备继续这段旅程/);
  assert.equal(container.querySelector<HTMLAnchorElement>('a[href="/register?intent=cross-device"]')?.textContent, "建立账号");
  const dismiss = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("暂时不用"));
  assert.ok(dismiss);
  await act(async () => dismiss.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  assert.equal(browserRegistrationInvitationStore.shouldProactivelyInvite(), false);
  const explicitAgain = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("跨设备继续"));
  assert.ok(explicitAgain);
  await act(async () => explicitAgain.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  assert.match(container.textContent || "", /不同设备继续这段旅程/);
});

test("已使用链接只在匹配账号会话中显示欢迎回来", async () => {
  window.history.replaceState({}, "", "/verify-email?token=used-token");
  globalThis.fetch = async () => Response.json({ state: "active_session" });
  await act(async () => root.render(<VerifyEmail />));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  assert.match(container.textContent || "", /欢迎回来/);
  assert.match(container.textContent || "", /仍在自己的账号会话中/);
  assert.equal(container.querySelector<HTMLAnchorElement>('a[href="/account"]')?.textContent, "进入账号");
  assert.doesNotMatch(container.textContent || "", /重新发送验证邮件/);
});

test("进度注册意图由阅读界面所有者接回目标章节", async () => {
  window.history.replaceState({}, "", "/?resume=progress&target=chapter-42");
  const story = createBlankStory();
  story.title = "接续章节";
  story.nodes[0].body = "回到原来的阅读位置。";
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "/api/novels") return Response.json({ novels: [{
      id: "novel-42", sortOrder: 1, version: 1,
      published: {
        name: "接续小说", summary: "接续简介", coverUrl: "", coverAlt: "",
        coverPresentation: { fit: "cover", positionX: 50, positionY: 50 },
      },
      chapters: [{ id: "chapter-42", title: story.title, summary: story.summary, version: 1, published: story }],
    }] });
    if (url === "/api/auth/me") return Response.json({ user: { displayName: "旅伴", role: "reader" } });
    if (url.startsWith("/api/account/progress")) return Response.json({ progress: [] });
    if (url === "/api/account/guide-memory") return Response.json({ memory: { preferences: [], guideCompletedAt: null } });
    return Response.json({});
  };
  await act(async () => root.render(<StoryStudio />));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 80)));
  assert.ok(container.querySelector(".reader"));
  assert.match(container.textContent || "", /接续章节/);
  assert.equal(window.location.search, "");
});
