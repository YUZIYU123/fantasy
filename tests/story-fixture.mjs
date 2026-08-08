import { createStoryNode } from "../lib/story.ts";

export function storyFixture() {
  return {
    title: "测试章节",
    summary: "仅用于自动化测试的结构化章节。",
    openingImageAssetId: "cover",
    openingImageUrl: "/api/assets/cover",
    openingImageAlt: "测试开场图",
    openingImagePresentation: { fit: "cover", positionX: 50, positionY: 50 },
    coverAssetId: "cover",
    coverUrl: "/api/assets/cover",
    coverAlt: "测试封面",
    outroImageAssetId: "outro",
    outroImageUrl: "/api/assets/outro",
    outroImageAlt: "测试收尾图",
    outroImagePresentation: { fit: "cover", positionX: 50, positionY: 50 },
    startNodeId: "start",
    musicCues: [],
    nodes: [
      createStoryNode({
        id: "start",
        title: "起点",
        body: "起点正文。",
        position: { x: 40, y: 150 },
        choices: [
          { id: "c1", label: "路径甲", targetId: "branch-a", transitionPreset: "fog", transitionPosition: "beforeTarget" },
          { id: "c2", label: "路径乙", targetId: "branch-b", transitionPreset: "push", transitionPosition: "afterSource" },
        ],
      }),
      createStoryNode({
        id: "branch-a",
        title: "分支甲",
        body: "分支甲正文。",
        position: { x: 340, y: 40 },
        choices: [{ id: "c3", label: "结束甲", targetId: "ending-a", transitionPreset: "flash", transitionPosition: "beforeTarget" }],
      }),
      createStoryNode({
        id: "branch-b",
        title: "分支乙",
        body: "分支乙正文。",
        position: { x: 340, y: 260 },
        choices: [{ id: "c4", label: "结束乙", targetId: "ending-b", transitionPreset: "ripple", transitionPosition: "beforeTarget" }],
      }),
      createStoryNode({
        id: "ending-a",
        title: "结局甲",
        body: "结局甲正文。",
        type: "ending",
        position: { x: 640, y: 40 },
      }),
      createStoryNode({
        id: "ending-b",
        title: "结局乙",
        body: "结局乙正文。",
        type: "ending",
        position: { x: 640, y: 260 },
      }),
    ],
  };
}
