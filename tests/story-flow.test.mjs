import assert from "node:assert/strict";
import test from "node:test";
import {
  collectReachableNodeIds,
  createChildNode,
  createStandaloneNode,
  createStoryChoice,
  FLOW_COLUMN_GAP,
  insertNodeOnChoice,
} from "../lib/story.ts";
import { storyFixture } from "./story-fixture.mjs";

const story = () => structuredClone(storyFixture());

test("自由新增节点使用指定位置且保持孤立", () => {
  const result = createStandaloneNode(story(), "free", { x: 777, y: 333 });
  assert.equal(result.error, undefined);
  assert.equal(result.createdNodeId, "free");
  assert.deepEqual(result.story.nodes.at(-1).position, { x: 777, y: 333 });
  assert.ok(result.story.nodes.every((node) => node.choices.every((choice) => choice.targetId !== "free")));
});

test("从剧情节点新增子节点会选择最近空位并自动连线", () => {
  const input = story();
  input.nodes.push({ ...structuredClone(input.nodes[1]), id: "occupied", position: { x: 340, y: 150 } });
  const result = createChildNode(input, "start", "child", "choice-child");
  assert.equal(result.error, undefined);
  const child = result.story.nodes.find((node) => node.id === "child");
  assert.equal(child.position.x, input.nodes[0].position.x + FLOW_COLUMN_GAP);
  assert.notEqual(child.position.y, input.nodes[0].position.y);
  assert.deepEqual(result.story.nodes.find((node) => node.id === "start").choices.at(-1), createStoryChoice({
    id: "choice-child",
    label: "新的选择",
    targetId: "child",
  }));
});

test("允许结束本章的节点仍可新增子节点", () => {
  const input = story();
  const result = createChildNode(input, "ending-a", "after-ending", "choice");
  assert.equal(result.error, undefined);
  assert.equal(result.story.nodes.find((node) => node.id === "ending-a").choices.at(-1).targetId, "after-ending");
});

test("插入连线保留原选项文字并用继续连接旧目标", () => {
  const input = story();
  const originalChoice = structuredClone(input.nodes[0].choices[0]);
  const originalTarget = structuredClone(input.nodes.find((node) => node.id === originalChoice.targetId));
  const result = insertNodeOnChoice(input, "start", originalChoice.id, "inserted", "continue");
  assert.equal(result.error, undefined);
  const sourceChoice = result.story.nodes.find((node) => node.id === "start").choices.find((choice) => choice.id === originalChoice.id);
  assert.deepEqual(sourceChoice, { ...originalChoice, targetId: "inserted" });
  assert.deepEqual(result.story.nodes.find((node) => node.id === "inserted").choices, [createStoryChoice({
    id: "continue",
    label: "继续",
    targetId: originalTarget.id,
  })]);
  assert.equal(result.story.nodes.find((node) => node.id === originalTarget.id).position.x, originalTarget.position.x + FLOW_COLUMN_GAP);
});

test("局部后移覆盖汇合后的后续节点且不会重复移动", () => {
  const input = story();
  input.nodes.find((node) => node.id === "branch-b").choices = [{ id: "merge", label: "汇合", targetId: "ending-a", transitionPreset: "fade", transitionPosition: "beforeTarget" }];
  const originalEndingX = input.nodes.find((node) => node.id === "ending-a").position.x;
  const result = insertNodeOnChoice(input, "start", "c1", "inserted", "continue");
  assert.equal(result.story.nodes.find((node) => node.id === "ending-a").position.x, originalEndingX + FLOW_COLUMN_GAP);
  assert.equal(result.story.nodes.find((node) => node.id === "branch-b").position.x, input.nodes.find((node) => node.id === "branch-b").position.x);
});

test("错误循环不会让可达节点扫描或插入陷入死循环", () => {
  const input = story();
  input.nodes.find((node) => node.id === "branch-a").choices = [{ id: "cycle", label: "返回开头", targetId: "start", transitionPreset: "fade", transitionPosition: "beforeTarget" }];
  assert.deepEqual([...collectReachableNodeIds(input, "branch-a", new Set(["start"]))], ["branch-a"]);
  const result = insertNodeOnChoice(input, "start", "c1", "inserted", "continue");
  assert.equal(result.error, undefined);
  assert.equal(result.story.nodes.find((node) => node.id === "start").position.x, input.nodes.find((node) => node.id === "start").position.x);
});
