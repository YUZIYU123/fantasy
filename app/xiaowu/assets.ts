import type { CompanionActionId, CompanionAppearanceId, CompanionGardenId } from "../../lib/companion-lifecycle";

export type XiaowuVisualState = "idle" | "greeting" | "notice" | "success" | "warning";
export type XiaowuGardenPose = XiaowuVisualState | "touch" | "play" | "rest" | CompanionActionId;

const appearances: Record<CompanionAppearanceId, string> = {
  "starlight-cloak": "/xiaowu/appearances/starlight-cloak",
  "archive-cloak": "/xiaowu/appearances/archive-cloak",
};
const gardens: Record<CompanionGardenId, string> = {
  "glowing-roots": "/xiaowu/gardens/glowing-roots.webp",
  "star-nursery": "/xiaowu/gardens/star-nursery.webp",
};

function hasKey<T extends object>(value: string, source: T): value is Extract<keyof T, string> {
  return value in source;
}

const fallbackState: Record<Exclude<XiaowuGardenPose, XiaowuVisualState>, XiaowuVisualState> = {
  touch: "greeting",
  play: "success",
  rest: "idle",
  "antenna-response": "notice",
  "spin-hover": "success",
  "hug-memory": "greeting",
};

function defaultState(pose: XiaowuGardenPose): XiaowuVisualState {
  return pose in fallbackState ? fallbackState[pose as keyof typeof fallbackState] : pose as XiaowuVisualState;
}

export function xiaowuAppearanceAsset(appearance: string, pose: XiaowuGardenPose) {
  return hasKey(appearance, appearances)
    ? `${appearances[appearance]}/${pose}.webp`
    : `/xiaowu/${defaultState(pose)}.webp`;
}

export function xiaowuGardenAsset(garden: string) {
  return hasKey(garden, gardens) ? gardens[garden] : null;
}

export function fallbackXiaowuImage(image: HTMLImageElement, pose: XiaowuGardenPose) {
  const fallback = `/xiaowu/${defaultState(pose)}.webp`;
  if (!image.src.endsWith(fallback)) image.src = fallback;
}
