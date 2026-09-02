import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clampCompanionPoint,
  normalizeCompanionPoint,
  parseCompanionPreference,
  placeCompanionDialog,
  placeCompanionLauncher,
  placeCompanionRestore,
  resolveCompanionPoint,
} from "../lib/companion-placement.ts";

const viewport = { width: 390, height: 844, topInset: 76, bottomInset: 96 };
const launcher = { width: 70, height: 98 };

test("小雾位置始终夹紧在手机安全区内", () => {
  assert.deepEqual(
    clampCompanionPoint({ x: 500, y: 20 }, viewport, launcher),
    { x: 320, y: 76 },
  );
  assert.deepEqual(
    clampCompanionPoint({ x: -30, y: 900 }, viewport, launcher),
    { x: 0, y: 650 },
  );
});

test("桌面端将小雾限制在居中的手机内容框而不是浏览器留白", () => {
  const framedViewport = {
    width: 1200,
    height: 844,
    topInset: 76,
    bottomInset: 96,
    leftInset: 385,
    rightInset: 385,
  };
  const fullCompanion = { width: 132, height: 150 };
  assert.deepEqual(clampCompanionPoint({ x: 20, y: 300 }, framedViewport, fullCompanion), { x: 385, y: 300 });
  assert.deepEqual(clampCompanionPoint({ x: 1100, y: 300 }, framedViewport, fullCompanion), { x: 683, y: 300 });
  assert.deepEqual(normalizeCompanionPoint({ x: 534, y: 337 }, framedViewport, fullCompanion), { x: 0.5, y: 0.5 });
});

test("小雾贴左右边框时对称探头，拖回内部后恢复完整身体", () => {
  const framedViewport = {
    width: 1200,
    height: 844,
    topInset: 76,
    bottomInset: 96,
    leftInset: 385,
    rightInset: 385,
  };
  const fullCompanion = { width: 132, height: 150 };
  const peekCompanion = { width: 70, height: 98 };
  assert.deepEqual(
    placeCompanionLauncher({ x: 385, y: 300 }, framedViewport, fullCompanion, peekCompanion),
    { point: { x: 385, y: 300 }, edge: "left" },
  );
  assert.deepEqual(
    placeCompanionLauncher({ x: 683, y: 300 }, framedViewport, fullCompanion, peekCompanion),
    { point: { x: 745, y: 300 }, edge: "right" },
  );
  assert.deepEqual(
    placeCompanionLauncher({ x: 520, y: 300 }, framedViewport, fullCompanion, peekCompanion),
    { point: { x: 520, y: 300 }, edge: null },
  );
});

test("隐藏后的唤回入口吸附最近边缘并保留安全高度", () => {
  assert.deepEqual(placeCompanionRestore({ x: 275, y: 256 }, viewport, launcher, { width: 42, height: 52 }), { x: 348, y: 256 });
  assert.deepEqual(placeCompanionRestore({ x: 20, y: 700 }, viewport, launcher, { width: 42, height: 52 }), { x: 0, y: 696 });
  assert.deepEqual(placeCompanionRestore({ x: 170, y: 300 }, viewport, launcher, { width: 42, height: 52 }), { x: 348, y: 300 });
});

test("对话卡跟随小雾选择左右方向并保持完整可见", () => {
  assert.deepEqual(
    placeCompanionDialog({ x: 0, y: 500 }, viewport, launcher, { width: 340, height: 520 }),
    { x: 8, y: 76, side: "above", maxHeight: 416 },
  );
  assert.deepEqual(
    placeCompanionDialog({ x: 320, y: 100 }, viewport, launcher, { width: 340, height: 520 }),
    { x: 42, y: 206, side: "below", maxHeight: 520 },
  );
  assert.deepEqual(
    placeCompanionDialog({ x: 100, y: 300 }, { ...viewport, width: 900 }, launcher, { width: 340, height: 520 }),
    { x: 162, y: 220, side: "right", maxHeight: 520 },
  );
  assert.deepEqual(
    placeCompanionDialog(
      { x: 55, y: 128 },
      { width: 240, height: 422, topInset: 76, bottomInset: 96 },
      { width: 132, height: 150 },
      { width: 224, height: 261 },
    ),
    { x: 8, y: 76, side: "above", maxHeight: 242 },
  );
});

test("归一化位置跨视口恢复且损坏偏好回退默认值", () => {
  const saved = normalizeCompanionPoint({ x: 160, y: 363 }, viewport, launcher);
  assert.deepEqual(saved, { x: 0.5, y: 0.5 });
  assert.deepEqual(resolveCompanionPoint(saved, viewport, launcher), { x: 160, y: 363 });

  assert.deepEqual(parseCompanionPreference('{"version":1,"hidden":true,"position":{"x":0.25,"y":0.75}}'), {
    version: 1,
    hidden: true,
    position: { x: 0.25, y: 0.75 },
  });
  assert.deepEqual(parseCompanionPreference('{"version":1,"hidden":true,"position":{"x":4,"y":0.2}}'), {
    version: 1,
    hidden: false,
    position: null,
  });
  assert.deepEqual(parseCompanionPreference("not-json"), {
    version: 1,
    hidden: false,
    position: null,
  });
});
