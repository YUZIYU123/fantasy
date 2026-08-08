import type { NovelDocument, StoryDocument } from "./story";

export type AssetType = "image" | "audio" | "video";
export type AssetStatus = "ready" | "deleting" | "delete_failed";
export type AssetRecord = {
  id: string;
  name: string;
  type: AssetType;
  url: string;
  storageKey: string;
  folderId: string | null;
  ownerId: string | null;
  mimeType: string;
  size: number;
  duration: number;
  alt: string;
  status: AssetStatus;
  canManage?: boolean;
  createdAt: string;
  updatedAt: string;
};
export type AssetFolder = { id: string; name: string; ownerId: string | null; createdAt: string; updatedAt: string };
export type AssetReference = { chapterId: string; chapterTitle: string; version: "draft" | "published" | `v${number}`; nodeId: string; nodeTitle: string; field: string };
type PublishAsset = Pick<AssetRecord, "id" | "url" | "type" | "status">;

export function validateStoryAssetReferences(story: StoryDocument, assetRows: PublishAsset[]) {
  const errors: string[] = [];
  const byId = new Map(assetRows.map((asset) => [asset.id, asset]));
  const byUrl = new Map(assetRows.map((asset) => [asset.url, asset]));
  const check = (label: string, id: string | undefined, url: string | undefined, expected: AssetType) => {
    const safeId = id || "";
    const safeUrl = url || "";
    const asset = safeId
      ? byId.get(safeId)
      : byUrl.get(safeUrl) ?? (safeUrl.startsWith("/api/assets/") ? byId.get(decodeURIComponent(safeUrl.slice("/api/assets/".length))) : undefined);
    if (!safeId && (!safeUrl || !safeUrl.startsWith("/api/assets/"))) return;
    if (!asset) { errors.push(`${label}引用的素材不存在`); return; }
    if (asset.status !== "ready") errors.push(`${label}引用的素材当前不可用`);
    if (asset.type !== expected) errors.push(`${label}引用了错误的素材类型`);
  };
  check("章节开场图", story.openingImageAssetId ?? story.coverAssetId, story.openingImageUrl ?? story.coverUrl, "image");
  check("章节收尾图", story.outroImageAssetId, story.outroImageUrl, "image");
  for (const node of story.nodes) {
    check(`节点「${node.title}」的场景插图`, node.imageAssetId, node.imageUrl, "image");
    check(`节点「${node.title}」的独立图片页`, node.displayImageAssetId, node.displayImageUrl, "image");
    check(`节点「${node.title}」的背景音乐`, node.audioAssetId, node.audioUrl, "audio");
    check(`节点「${node.title}」的场景视频`, node.videoAssetId, node.videoUrl, "video");
    check(`节点「${node.title}」的终端语音`, node.terminalEvent.voiceAssetId, node.terminalEvent.voiceUrl, "audio");
    if (node.videoMode !== "none" && !node.videoAssetId && !node.videoUrl) {
      errors.push(`节点「${node.title}」设置了视频模式但没有选择视频`);
    }
    for (const choice of node.choices) {
      check(`节点「${node.title}」的选项「${choice.label}」音效`, choice.sfxAssetId, choice.sfxUrl, "audio");
      check(`节点「${node.title}」的选项「${choice.label}」反馈图片`, choice.feedbackImageAssetId, choice.feedbackImageUrl, "image");
      check(`节点「${node.title}」的选项「${choice.label}」终端语音`, choice.terminalVoiceAssetId, choice.terminalVoiceUrl, "audio");
    }
  }
  for (const cue of story.musicCues ?? []) {
    check(`配乐区间「${cue.name}」`, cue.assetId, cue.url, "audio");
    if (!cue.assetId && !cue.url) errors.push(`配乐区间「${cue.name}」没有选择音频`);
  }
  return [...new Set(errors)];
}

export function validateNovelAssetReferences(novel: NovelDocument, assetRows: PublishAsset[]) {
  const byId = new Map(assetRows.map((asset) => [asset.id, asset]));
  const byUrl = new Map(assetRows.map((asset) => [asset.url, asset]));
  const asset = novel.coverAssetId
    ? byId.get(novel.coverAssetId)
    : byUrl.get(novel.coverUrl);
  if (!novel.coverAssetId && (!novel.coverUrl || !novel.coverUrl.startsWith("/api/assets/"))) return [];
  if (!asset) return ["小说封面引用的素材不存在"];
  if (asset.status !== "ready") return ["小说封面引用的素材当前不可用"];
  return asset.type === "image" ? [] : ["小说封面引用了错误的素材类型"];
}

export function storyReferencesAsset(story: StoryDocument, asset: Pick<AssetRecord, "id" | "url">) {
  const references: { nodeId: string; nodeTitle: string; field: string }[] = [];
  if (story.openingImageAssetId === asset.id || story.openingImageUrl === asset.url
    || story.coverAssetId === asset.id || story.coverUrl === asset.url) {
    references.push({ nodeId: "chapter", nodeTitle: story.title, field: "章节开场图" });
  }
  if (story.outroImageAssetId === asset.id || story.outroImageUrl === asset.url) references.push({ nodeId: "chapter", nodeTitle: story.title, field: "章节收尾图" });
  for (const node of story.nodes) {
    const fields: Array<[string, string | undefined]> = [
      ["场景插图", node.imageAssetId || node.imageUrl],
      ["独立图片页", node.displayImageAssetId || node.displayImageUrl],
      ["背景音乐", node.audioAssetId || node.audioUrl],
      ["场景视频", node.videoAssetId || node.videoUrl],
      ["终端语音", node.terminalEvent.voiceAssetId || node.terminalEvent.voiceUrl],
    ];
    for (const [field, value] of fields) if (value === asset.id || value === asset.url) references.push({ nodeId: node.id, nodeTitle: node.title, field });
    for (const choice of node.choices) {
      if (choice.sfxAssetId === asset.id || choice.sfxUrl === asset.url) {
        references.push({ nodeId: node.id, nodeTitle: node.title, field: `选项「${choice.label}」音效` });
      }
      if (choice.feedbackImageAssetId === asset.id || choice.feedbackImageUrl === asset.url) {
        references.push({ nodeId: node.id, nodeTitle: node.title, field: `选项「${choice.label}」反馈图片` });
      }
      if (choice.terminalVoiceAssetId === asset.id || choice.terminalVoiceUrl === asset.url) {
        references.push({ nodeId: node.id, nodeTitle: node.title, field: `选项「${choice.label}」终端语音` });
      }
    }
  }
  for (const cue of story.musicCues ?? []) {
    if (cue.assetId === asset.id || cue.url === asset.url) {
      references.push({ nodeId: cue.startNodeId, nodeTitle: cue.name, field: "配乐区间" });
    }
  }
  return references;
}

export function novelReferencesAsset(novel: NovelDocument, asset: Pick<AssetRecord, "id" | "url">) {
  return novel.coverAssetId === asset.id || novel.coverUrl === asset.url;
}

export function assetStorageKey(url: string) {
  const prefix = "/api/assets/";
  if (!url.startsWith(prefix)) return "";
  try { return decodeURIComponent(url.slice(prefix.length)); } catch { return url.slice(prefix.length); }
}
