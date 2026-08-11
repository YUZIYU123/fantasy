import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AuthForm, VerifyEmail } from "../app/auth-forms";

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
    HTMLElement: window.HTMLElement,
    Event: window.Event,
    MouseEvent: window.MouseEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: window.navigator });
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
  assert.deepEqual(calls, [{ url: "/api/auth/verify-email?token=contract-token", method: "GET" }]);
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
