import assert from "node:assert/strict";
import test from "node:test";
import { storyReferencesAsset, validateStoryAssetReferences } from "../lib/assets.ts";
import { normalizeStory } from "../lib/story.ts";
import { storyFixture } from "./story-fixture.mjs";

const asset = (id, type) => ({ id, url: `/api/assets/${id}`, type, status: "ready" });

test("发布校验与删除扫描覆盖选项音效和反馈图片", () => {
  const story = normalizeStory(storyFixture());
  const choice = story.nodes[0].choices[0];
  choice.sfxAssetId = "choice-sfx";
  choice.sfxUrl = "/api/assets/choice-sfx";
  choice.feedbackImageAssetId = "choice-image";
  choice.feedbackImageUrl = "/api/assets/choice-image";
  choice.feedbackImageAlt = "舱门开启时的蓝色光芒";
  const assets = [
    asset("cover", "image"),
    asset("outro", "image"),
    asset("choice-sfx", "audio"),
    asset("choice-image", "image"),
  ];
  assert.deepEqual(validateStoryAssetReferences(story, assets), []);
  assert.match(storyReferencesAsset(story, assets[2])[0].field, /音效/);
  assert.match(storyReferencesAsset(story, assets[3])[0].field, /反馈图片/);
});
