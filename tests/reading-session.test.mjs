import assert from "node:assert/strict";
import test from "node:test";
import { createReadingSession } from "../lib/reading-session.ts";
import { normalizeStory } from "../lib/story.ts";
import { storyFixture } from "./story-fixture.mjs";

function story() {
  return normalizeStory(storyFixture());
}

test("ReadingSession 选择较新进度并在完成或版本变化时重启", () => {
  const current = story();
  const base = { story: current, chapterId: "chapter", chapterVersion: 3, preview: false };
  const resumed = createReadingSession({
    ...base,
    deviceProgress: { nodeId: "branch-a", pageIndex: 0, version: 3, updatedAt: "2026-01-01T00:00:00Z" },
    cloudProgress: { nodeId: "branch-b", pageIndex: 0, version: 3, updatedAt: "2026-01-02T00:00:00Z" },
  });
  assert.equal(resumed.state.nodeId, "branch-b");
  for (const progress of [
    { nodeId: "branch-a", pageIndex: 0, version: 2, updatedAt: "2026-01-02T00:00:00Z" },
    { nodeId: "branch-a", pageIndex: 0, version: 3, updatedAt: "2026-01-02T00:00:00Z", completedAt: "2026-01-02T00:00:00Z" },
  ]) {
    assert.equal(createReadingSession({ ...base, deviceProgress: progress }).state.nodeId, current.startNodeId);
  }
});

test("预览会话推进剧情但永不产生持久化 effect", () => {
  const current = story();
  const session = createReadingSession({ story: current, chapterId: "preview", chapterVersion: 1, preview: true });
  assert.equal(session.initialEffects.some((effect) => effect.kind === "persist-progress"), false);
  const choice = current.nodes.find((node) => node.id === session.state.nodeId).choices[0];
  const chosen = session.dispatch({ type: "choose", choiceId: choice.id });
  const wait = chosen.effects.find((effect) => effect.kind === "wait");
  assert.ok(wait);
  const advanced = session.dispatch({ type: "effect-result", id: wait.id, outcome: "timeout" });
  assert.equal(advanced.state.nodeId, choice.targetId);
  assert.equal(advanced.effects.some((effect) => effect.kind === "persist-progress"), false);
});

test("媒体失败回送后会解除选择锁并抵达可继续状态", () => {
  const current = story();
  const choice = current.nodes[0].choices[0];
  choice.sfxUrl = "https://example.com/fail.mp3";
  const session = createReadingSession({ story: current, chapterId: "media", chapterVersion: 1, preview: true });
  const chosen = session.dispatch({ type: "choose", choiceId: choice.id });
  assert.equal(chosen.state.choiceLocked, true);
  const sfx = chosen.effects.find((effect) => effect.kind === "play-sfx");
  assert.ok(sfx);
  const failed = session.dispatch({ type: "effect-result", id: sfx.id, outcome: "failure" });
  assert.equal(failed.state.choiceLocked, true);
  const wait = chosen.effects.find((effect) => effect.kind === "wait");
  const advanced = session.dispatch({ type: "effect-result", id: wait.id, outcome: "timeout" });
  assert.equal(advanced.state.nodeId, choice.targetId);
  assert.equal(advanced.state.choiceLocked, false);
});

test("正式完成产生完成进度和完成 effect", () => {
  const current = story();
  const session = createReadingSession({ story: current, chapterId: "formal", chapterVersion: 4, preview: false, now: () => "2026-08-08T00:00:00Z" });
  const result = session.dispatch({ type: "complete" });
  const progress = result.effects.find((effect) => effect.kind === "persist-progress");
  assert.equal(progress.progress.completed, true);
  assert.equal(progress.progress.completedAt, progress.progress.updatedAt);
  assert.ok(result.effects.some((effect) => effect.kind === "complete"));
});

test("转场视频 effect 失败后进入可继续的正文状态", () => {
  const current = story();
  current.nodes[0].videoMode = "transition";
  current.nodes[0].videoUrl = "https://example.com/fail.mp4";
  const session = createReadingSession({
    story: current, chapterId: "video", chapterVersion: 1, preview: true, reducedMotion: false,
  });
  const video = session.initialEffects.find((effect) => effect.kind === "video");
  assert.ok(video);
  const failed = session.dispatch({ type: "effect-result", id: video.id, outcome: "failure" });
  assert.equal(failed.state.phase, "content");
  assert.equal(failed.state.choiceLocked, false);
});

test("旧视频 effect 的超时不能结束当前转场视频", () => {
  const current = story();
  const start = current.nodes.find((node) => node.id === current.startNodeId);
  const target = current.nodes.find((node) => node.id === start.choices[0].targetId);
  start.videoMode = "transition";
  start.videoUrl = "https://example.com/a.mp4";
  target.videoMode = "transition";
  target.videoUrl = "https://example.com/b.mp4";
  const session = createReadingSession({
    story: current, chapterId: "video-order", chapterVersion: 1, preview: true, reducedMotion: false,
  });
  const firstVideo = session.initialEffects.find((effect) => effect.kind === "video");
  session.dispatch({ type: "effect-result", id: firstVideo.id, outcome: "complete" });
  const chosen = session.dispatch({ type: "choose", choiceId: start.choices[0].id });
  const wait = chosen.effects.find((effect) => effect.kind === "wait");
  const entered = session.dispatch({ type: "effect-result", id: wait.id, outcome: "timeout" });
  const secondVideo = entered.effects.find((effect) => effect.kind === "video");
  assert.ok(secondVideo);
  const stale = session.dispatch({ type: "effect-result", id: firstVideo.id, outcome: "timeout" });
  assert.equal(stale.state.nodeId, target.id);
  assert.equal(stale.state.phase, "transitionVideo");
});

test("ReadingSession 用 effect 声明转场视频期间的音乐暂停与恢复", () => {
  const current = story();
  current.nodes[0].videoMode = "transition";
  current.nodes[0].videoUrl = "https://example.com/transition.mp4";
  current.musicCues = [{
    id: "cue", name: "转场配乐", assetId: "music", url: "https://example.com/music.mp3",
    volume: 0.5, loop: true, fadeMs: 0, startNodeId: current.startNodeId, stopNodeIds: [],
  }];
  const session = createReadingSession({
    story: current, chapterId: "video-music", chapterVersion: 1, preview: true, reducedMotion: false,
  });
  assert.deepEqual(session.initialEffects.filter((effect) => effect.kind === "music").map((effect) => effect.action), ["start", "pause"]);
  const video = session.initialEffects.find((effect) => effect.kind === "video");
  const completed = session.dispatch({ type: "effect-result", id: video.id, outcome: "complete" });
  assert.deepEqual(completed.effects.filter((effect) => effect.kind === "music").map((effect) => effect.action), ["resume"]);
});
