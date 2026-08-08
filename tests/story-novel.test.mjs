import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateAudioFadeFrame,
  clampMediaVolume,
  createBlankNovel,
  normalizeImagePresentation,
  normalizeChoiceImageDuration,
  normalizeChoiceSfxMaxDuration,
  normalizeNovel,
  normalizeStory,
  resolveMusicCueAction,
  validateNovel,
  validateStory,
} from "../lib/story.ts";
import { storyFixture } from "./story-fixture.mjs";

test("小说资料独立于章节资料并保留封面显示焦点", () => {
  const novel = createBlankNovel();
  novel.name = "第一本小说";
  novel.summary = "小说简介";
  novel.coverUrl = "https://example.com/cover.jpg";
  novel.coverAlt = "竖版封面";
  novel.coverPresentation = { fit: "cover", positionX: 18, positionY: 76 };
  assert.deepEqual(validateNovel(novel), []);
  assert.deepEqual(normalizeNovel(novel).coverPresentation, { fit: "cover", positionX: 18, positionY: 76 });
  assert.equal(normalizeImagePresentation({ fit: "contain", positionX: -10, positionY: 120 }).fit, "contain");
  assert.deepEqual(normalizeImagePresentation({ fit: "contain", positionX: -10, positionY: 120 }), {
    fit: "contain",
    positionX: 0,
    positionY: 100,
  });
});

test("旧结局节点转换为可结束本章且仍允许保留选项", () => {
  const story = structuredClone(storyFixture());
  story.nodes[3].choices = [{
    id: "epilogue",
    label: "继续尾声",
    targetId: "ending-b",
    transitionPreset: "fade",
    transitionPosition: "beforeTarget",
  }];
  delete story.nodes[3].canEndChapter;
  const normalized = normalizeStory(story);
  const ending = normalized.nodes.find((node) => node.id === "ending-a");
  assert.equal(ending.canEndChapter, true);
  assert.equal(ending.choices.length, 1);
  assert.deepEqual(validateStory(normalized), []);
});

test("旧选项补齐媒体时长，非法旧值限制到安全范围", () => {
  const story = normalizeStory(storyFixture());
  const choice = story.nodes[0].choices[0];
  assert.equal(choice.feedbackImageDurationMs, 1200);
  assert.equal(choice.sfxMaxDurationMs, 0);
  assert.equal(normalizeChoiceImageDuration(20), 100);
  assert.equal(normalizeChoiceImageDuration(50_000), 30_000);
  assert.equal(normalizeChoiceSfxMaxDuration(20), 100);
  assert.equal(normalizeChoiceSfxMaxDuration(50_000), 30_000);
  assert.equal(normalizeChoiceSfxMaxDuration(0), 0);
});

test("音乐区间播放完整个结束节点，并在离开节点时停止或替换", () => {
  const story = normalizeStory(storyFixture());
  story.musicCues = [
    { id: "calm", name: "平静", assetId: "a", url: "/api/assets/a", startNodeId: "start", stopNodeIds: ["ending-a"], volume: 0.5, loop: true, fadeMs: 500 },
    { id: "tense", name: "紧张", assetId: "b", url: "/api/assets/b", startNodeId: "branch-b", stopNodeIds: ["ending-b"], volume: 0.7, loop: true, fadeMs: 800 },
  ];
  assert.deepEqual(resolveMusicCueAction(story, "start", "start", null), { stopActive: false, startCue: story.musicCues[0] });
  assert.deepEqual(resolveMusicCueAction(story, "start", "branch-a", "calm"), { stopActive: false, startCue: null });
  assert.deepEqual(resolveMusicCueAction(story, "branch-a", "ending-a", "calm"), { stopActive: false, startCue: null });
  assert.deepEqual(resolveMusicCueAction(story, "ending-a", "start", "calm"), { stopActive: true, startCue: null });
  assert.deepEqual(resolveMusicCueAction(story, "start", "branch-b", "calm"), { stopActive: true, startCue: story.musicCues[1] });
});

test("音量和淡入淡出帧始终限制在媒体允许的范围", () => {
  assert.equal(clampMediaVolume(1.00808), 1);
  assert.equal(clampMediaVolume(-0.2), 0);
  assert.equal(clampMediaVolume(Number.NaN, 0.55), 0.55);
  assert.deepEqual(calculateAudioFadeFrame(1.2, 1.5, 100, 90, 500), {
    progress: 0,
    fromVolume: 1,
    toVolume: 0,
  });
  assert.deepEqual(calculateAudioFadeFrame(1.2, 1.5, 100, 700, 500), {
    progress: 1,
    fromVolume: 0,
    toVolume: 1,
  });
});

test("配乐必须配置至少一个可从开始节点到达的结束节点", () => {
  const story = normalizeStory(storyFixture());
  story.musicCues = [
    { id: "calm", name: "平静", assetId: "a", url: "/api/assets/a", startNodeId: "branch-b", stopNodeIds: [], volume: 0.5, loop: true, fadeMs: 500 },
  ];
  assert.ok(validateStory(story).includes("配乐「平静」至少需要一个结束节点"));
  story.musicCues[0].stopNodeIds = ["branch-a"];
  assert.ok(validateStory(story).includes("配乐「平静」的结束节点「branch-a」无法从开始节点到达"));
});

test("同一节点可以同时作为配乐开始和结束节点", () => {
  const story = normalizeStory(storyFixture());
  story.musicCues = [
    { id: "single", name: "单节点配乐", assetId: "a", url: "/api/assets/a", startNodeId: "branch-a", stopNodeIds: ["branch-a"], volume: 0.55, loop: true, fadeMs: 500 },
  ];
  assert.equal(validateStory(story).some((error) => error.includes("单节点配乐")), false);
  assert.deepEqual(resolveMusicCueAction(story, "start", "branch-a", null), {
    stopActive: false,
    startCue: story.musicCues[0],
  });
  assert.deepEqual(resolveMusicCueAction(story, "branch-a", "ending-a", "single"), {
    stopActive: true,
    startCue: null,
  });
});

test("旧转场自动映射为互动动画并补齐选项媒体字段", () => {
  const story = normalizeStory(storyFixture());
  const fogChoice = story.nodes[0].choices[0];
  const pushChoice = story.nodes[0].choices[1];
  assert.equal(fogChoice.interactionPreset, "glow");
  assert.equal(pushChoice.interactionPreset, "push");
  assert.equal(fogChoice.sfxAssetId, "");
  assert.equal(fogChoice.feedbackImagePresentation.fit, "contain");
});
