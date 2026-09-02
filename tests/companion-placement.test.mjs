import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clampCompanionPoint,
  normalizeCompanionPoint,
  parseCompanionPreference,
  placeCompanionDialog,
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
