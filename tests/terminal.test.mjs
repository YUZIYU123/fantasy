import assert from "node:assert/strict";
import test from "node:test";
import {
  applyTerminalTaskEvents, getStoryTerminalWarnings, normalizeStory, terminalVoiceSourceKey,
  validateStory, validateStoryInputLengths,
} from "../lib/story.ts";
import { getTerminalMessageTiming, normalizeReaderPreferences, recommendNovels } from "../lib/terminal.ts";
import { storyFixture } from "./story-fixture.mjs";

test("旧章节自动补齐幻界终端和节点事件默认值", () => {
  const legacy = storyFixture();
  delete legacy.terminal;
  legacy.nodes.forEach((node) => delete node.terminalEvent);
  const normalized = normalizeStory(legacy);
  assert.deepEqual(normalized.terminal, {
    enabled: true,
    name: "幻界终端",
    voicePreset: "cuteNeutral",
    voiceProvider: "elevenlabs",
    voiceId: "",
    voiceName: "",
    idleMode: "corner",
    initialTask: { id: "task-main", title: "", description: "", status: "active", objectives: [] },
    autoSpeak: false,
    volume: 0.75,
  });
  assert.ok(normalized.nodes.every((node) => node.terminalEvent.trigger === "none" && node.terminalEvent.message === ""));
});

test("终端名称与节点消息执行输入上限", () => {
  const story = normalizeStory(storyFixture());
  story.terminal.name = "终".repeat(31);
  story.nodes[0].terminalEvent = { trigger: "beforeContent", message: "讯".repeat(301), speak: true, voiceAssetId: "", voiceUrl: "", voiceSourceKey: "" };
  const errors = validateStoryInputLengths(story);
  assert.ok(errors.some((error) => error.includes("终端名称")));
  assert.ok(errors.some((error) => error.includes("终端消息")));
});

test("终端任务操作按事件顺序重建且循环选择不会重复应用", () => {
  const story = normalizeStory(storyFixture());
  story.terminal.initialTask = {
    id: "main",
    title: "调查异常",
    description: "找到信号来源",
    status: "active",
    objectives: [{ id: "scan", label: "扫描入口", status: "active" }],
  };
  story.nodes[0].choices[0].terminalTaskActions = [
    { id: "finish-scan", type: "setObjectiveStatus", task: null, objective: null, objectiveId: "scan", status: "completed" },
    { id: "add-core", type: "addObjective", task: null, objective: { id: "core", label: "进入核心", status: "active" }, objectiveId: "", status: "active" },
  ];
  const result = applyTerminalTaskEvents(story, ["finish-scan", "add-core", "add-core", "unknown"]);
  assert.deepEqual(result.appliedIds, ["finish-scan", "add-core"]);
  assert.equal(result.task.objectives.find((item) => item.id === "scan").status, "completed");
  assert.equal(result.task.objectives.filter((item) => item.id === "core").length, 1);
});

test("终端语音来源签名随台词或音色变化", () => {
  assert.equal(terminalVoiceSourceKey("voice-a", "连接成功"), terminalVoiceSourceKey("voice-a", "连接成功"));
  assert.notEqual(terminalVoiceSourceKey("voice-a", "连接成功"), terminalVoiceSourceKey("voice-b", "连接成功"));
  assert.notEqual(terminalVoiceSourceKey("voice-a", "连接成功"), terminalVoiceSourceKey("voice-a", "任务更新"));
});

test("缺少或过期的 AI 语音降级为发布警告", () => {
  const story = normalizeStory(storyFixture());
  const choice = story.nodes[0].choices[0];
  choice.terminalFeedbackEnabled = true;
  choice.terminalSpeak = true;
  choice.terminalMessage = "任务已更新，请前往核心区域。";
  choice.terminalVoiceAssetId = "";
  choice.terminalVoiceUrl = "";
  choice.terminalVoiceSourceKey = "";
  assert.equal(validateStory(story).some((error) => error.includes("语音")), false);
  assert.ok(getStoryTerminalWarnings(story).some((warning) => warning.includes("设备朗读")));

  choice.terminalVoiceAssetId = "voice-old";
  choice.terminalVoiceUrl = "/api/assets/voice-old";
  choice.terminalVoiceSourceKey = "outdated";
  assert.ok(getStoryTerminalWarnings(story).some((warning) => warning.includes("已过期")));
});

test("终端文本时序覆盖开机逐字与无语音兜底", () => {
  const normal = getTerminalMessageTiming("系统已接入，正在同步当前任务。", false);
  assert.ok(normal.revealStepMs >= 18 && normal.revealStepMs <= 38);
  assert.ok(normal.fallbackDurationMs >= 2500 && normal.fallbackDurationMs <= 8000);
  const reduced = getTerminalMessageTiming("系统已接入", true);
  assert.equal(reduced.revealStepMs, 0);
  assert.ok(reduced.fallbackDurationMs >= 1200 && reduced.fallbackDurationMs <= 5000);
});

test("偏好清洗去重并按小说简介匹配推荐", () => {
  assert.deepEqual(normalizeReaderPreferences(["悬疑", "悬疑", "未知", "科幻"]), ["悬疑", "科幻"]);
  const novels = [
    { id: "romance", published: { name: "春日", summary: "温暖的爱情日常" } },
    { id: "mystery", published: { name: "异常终端", summary: "调查失踪事件背后的数据真相" } },
    { id: "fantasy", published: { name: "魔法门", summary: "异世界旅程" } },
  ];
  assert.equal(recommendNovels(novels, ["悬疑", "科幻"])[0].id, "mystery");
  assert.equal(recommendNovels(novels, [])[0].id, "romance");
});
