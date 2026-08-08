import assert from "node:assert/strict";
import test from "node:test";
import {
  countStoryCharacters,
  getStoryBodyWarnings,
  NODE_BODY_MAX_LENGTH,
  NODE_BODY_RECOMMENDED_LENGTH,
  normalizeStory,
  paginateStoryBody,
  parseReadingProgress,
  STORY_PAGE_BREAK,
  STORY_PAGE_MAX_LENGTH,
  STORY_PAGE_TARGET_LENGTH,
  validateStory,
  validateStoryBodyLengths,
  validateStoryMedia,
} from "../lib/story.ts";
import { storyReferencesAsset, validateStoryAssetReferences } from "../lib/assets.ts";
import { storyFixture } from "./story-fixture.mjs";

test("正文计数排除空白和分页符，并按完整 Emoji 计数", () => {
  const body = ` 你 好！\n${STORY_PAGE_BREAK}\n👨‍👩‍👧‍👦 `;
  assert.equal(countStoryCharacters(body), 4);
});

test("手动分页符决定分页位置且不会展示给读者", () => {
  const pages = paginateStoryBody(`第一面\n${STORY_PAGE_BREAK}\n第二面`);
  assert.deepEqual(pages, ["第一面\n", "\n第二面"]);
  assert.ok(pages.every((page) => !page.includes(STORY_PAGE_BREAK)));
  assert.deepEqual(paginateStoryBody(`正文${STORY_PAGE_BREAK}`), ["正文"]);
});

test("长正文优先在段落或句末自动分页并保持内容顺序", () => {
  const body = `${"甲".repeat(STORY_PAGE_TARGET_LENGTH - 1)}。\n${"乙".repeat(210)}！${"丙".repeat(50)}`;
  const pages = paginateStoryBody(body);
  assert.ok(pages.length >= 2);
  assert.equal(pages.join(""), body);
  assert.ok(pages.every((page) => countStoryCharacters(page) <= STORY_PAGE_MAX_LENGTH));
  assert.match(pages[0], /。\n$/u);
});

test("章节开场图可选，收尾媒体只在提交审核或发布时作为完整性错误", () => {
  const draft = structuredClone(storyFixture());
  draft.openingImageAssetId = "";
  draft.openingImageUrl = "";
  draft.openingImageAlt = "";
  draft.coverAssetId = "";
  draft.coverUrl = "";
  draft.coverAlt = "";
  draft.outroImageAssetId = "";
  draft.outroImageUrl = "";
  draft.outroImageAlt = "";
  assert.equal(validateStory(draft).length, 0);
  assert.doesNotMatch(validateStoryMedia(draft).join("；"), /开场图/);
  assert.match(validateStoryMedia(draft).join("；"), /章节收尾图/);
});

test("旧选项自动补齐转场预设且六种预设均可保留", () => {
  const legacy = structuredClone(storyFixture());
  delete legacy.nodes[0].choices[0].transitionPreset;
  delete legacy.nodes[0].choices[0].transitionPosition;
  delete legacy.nodes[0].displayImagePosition;
  assert.equal(normalizeStory(legacy).nodes[0].choices[0].transitionPreset, "fade");
  assert.equal(normalizeStory(legacy).nodes[0].choices[0].transitionPosition, "beforeTarget");
  assert.equal(normalizeStory(legacy).nodes[0].displayImagePosition, "none");
  const presets = ["none", "fade", "fog", "ripple", "push", "flash"];
  for (const preset of presets) {
    legacy.nodes[0].choices[0].transitionPreset = preset;
    assert.equal(normalizeStory(legacy).nodes[0].choices[0].transitionPreset, preset);
  }
});

test("独立图片页只在启用位置后要求图片与替代文本", () => {
  const story = structuredClone(storyFixture());
  story.nodes[0].displayImagePosition = "before";
  assert.match(validateStoryMedia(story).join("；"), /独立图片页.*选择图片/);
  assert.match(validateStoryMedia(story).join("；"), /独立图片页缺少替代文本/);
  story.nodes[0].displayImageAssetId = "scene-art";
  story.nodes[0].displayImageUrl = "/api/assets/scene-art";
  story.nodes[0].displayImageAlt = "起点前的场景图";
  assert.doesNotMatch(validateStoryMedia(story).join("；"), /独立图片页/);
  story.nodes[0].displayImagePosition = "after";
  assert.equal(normalizeStory(story).nodes[0].displayImagePosition, "after");
});

test("独立图片素材参与发布校验与安全删除引用扫描", () => {
  const story = structuredClone(storyFixture());
  story.nodes[0].displayImagePosition = "before";
  story.nodes[0].displayImageAssetId = "scene-art";
  story.nodes[0].displayImageUrl = "/api/assets/scene-art";
  story.nodes[0].displayImageAlt = "节点展示图";
  const asset = {
    id: "scene-art",
    url: "/api/assets/scene-art",
    type: "image",
    status: "ready",
  };
  const chapterAssets = [
    { id: "cover", url: "/api/assets/cover", type: "image", status: "ready" },
    { id: "outro", url: "/api/assets/outro", type: "image", status: "ready" },
  ];
  assert.deepEqual(validateStoryAssetReferences(story, [...chapterAssets, asset]), []);
  assert.match(validateStoryAssetReferences(story, chapterAssets).join("；"), /独立图片页.*不存在/);
  assert.equal(storyReferencesAsset(story, asset)[0].field, "独立图片页");
});

test("英文长段落和超长连续文本会安全拆页", () => {
  const english = Array.from({ length: 180 }, (_, index) => `word${index}`).join(" ");
  const continuous = "雾".repeat(STORY_PAGE_MAX_LENGTH * 2 + 7);
  const englishPages = paginateStoryBody(english);
  const continuousPages = paginateStoryBody(continuous);
  assert.equal(englishPages.join(""), english);
  assert.equal(continuousPages.join(""), continuous);
  assert.ok(englishPages.length > 1);
  assert.ok(continuousPages.every((page) => countStoryCharacters(page) <= STORY_PAGE_MAX_LENGTH));
});

test("600 字仅提示，超过 2000 字会阻止保存与发布", () => {
  const recommended = structuredClone(storyFixture());
  recommended.nodes[0].body = "雾".repeat(NODE_BODY_RECOMMENDED_LENGTH + 1);
  assert.equal(validateStoryBodyLengths(recommended).length, 0);
  assert.match(getStoryBodyWarnings(recommended).join("；"), /建议拆分/);

  const maximum = structuredClone(storyFixture());
  maximum.nodes[0].body = "雾".repeat(NODE_BODY_MAX_LENGTH);
  assert.equal(validateStoryBodyLengths(maximum).length, 0);

  maximum.nodes[0].body += "港";
  assert.match(validateStoryBodyLengths(maximum).join("；"), /超过 2000 字上限/);
  assert.match(validateStory(maximum).join("；"), /超过 2000 字上限/);
});

test("阅读进度兼容旧节点 ID，并恢复新版页码", () => {
  assert.deepEqual(parseReadingProgress("start", "fallback"), { nodeId: "start", pageIndex: 0, terminalEventIds: [] });
  assert.deepEqual(
    parseReadingProgress(JSON.stringify({ nodeId: "branch-a", pageIndex: 2.8 }), "fallback"),
    { nodeId: "branch-a", pageIndex: 2, terminalEventIds: [] },
  );
  assert.deepEqual(parseReadingProgress(null, "fallback"), { nodeId: "fallback", pageIndex: 0, terminalEventIds: [] });
  assert.deepEqual(parseReadingProgress("{}", "fallback"), { nodeId: "fallback", pageIndex: 0, terminalEventIds: [] });
  assert.deepEqual(
    parseReadingProgress(JSON.stringify({ nodeId: "ending-a", pageIndex: 0, completedAt: "2026-07-28T12:00:00.000Z" }), "fallback"),
    { nodeId: "ending-a", pageIndex: 0, terminalEventIds: [], completedAt: "2026-07-28T12:00:00.000Z" },
  );
});
