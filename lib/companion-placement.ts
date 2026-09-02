export const COMPANION_PREFERENCE_STORAGE_KEY = "fantasy-xiaowu-placement";

export type CompanionPoint = { x: number; y: number };
export type CompanionSize = { width: number; height: number };
export type CompanionViewport = CompanionSize & {
  topInset: number;
  bottomInset: number;
  leftInset?: number;
  rightInset?: number;
};
export type CompanionEdge = "left" | "right" | null;
export type CompanionPreference = {
  version: 1;
  hidden: boolean;
  position: CompanionPoint | null;
};

export const DEFAULT_COMPANION_PREFERENCE: CompanionPreference = {
  version: 1,
  hidden: false,
  position: null,
};

function finite(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

function availableSpace(viewport: CompanionViewport, launcher: CompanionSize) {
  const left = Math.max(0, finite(viewport.leftInset ?? 0, 0));
  const right = Math.max(left, finite(viewport.width, 0) - Math.max(0, finite(viewport.rightInset ?? 0, 0)));
  return {
    left,
    right,
    x: Math.max(0, right - left - Math.max(0, finite(launcher.width, 0))),
    y: Math.max(0, finite(viewport.height, 0)
      - Math.max(0, finite(viewport.topInset, 0))
      - Math.max(0, finite(viewport.bottomInset, 0))
      - Math.max(0, finite(launcher.height, 0))),
  };
}

export function clampCompanionPoint(
  point: CompanionPoint,
  viewport: CompanionViewport,
  launcher: CompanionSize,
): CompanionPoint {
  const available = availableSpace(viewport, launcher);
  const top = Math.max(0, finite(viewport.topInset, 0));
  return {
    x: Math.min(available.left + available.x, Math.max(available.left, finite(point.x, available.left))),
    y: Math.min(top + available.y, Math.max(top, finite(point.y, top))),
  };
}

export function normalizeCompanionPoint(
  point: CompanionPoint,
  viewport: CompanionViewport,
  launcher: CompanionSize,
): CompanionPoint {
  const clamped = clampCompanionPoint(point, viewport, launcher);
  const available = availableSpace(viewport, launcher);
  const top = Math.max(0, finite(viewport.topInset, 0));
  return {
    x: available.x === 0 ? 0 : (clamped.x - available.left) / available.x,
    y: available.y === 0 ? 0 : (clamped.y - top) / available.y,
  };
}

export function resolveCompanionPoint(
  position: CompanionPoint,
  viewport: CompanionViewport,
  launcher: CompanionSize,
): CompanionPoint {
  const available = availableSpace(viewport, launcher);
  const top = Math.max(0, finite(viewport.topInset, 0));
  return clampCompanionPoint({
    x: available.left + Math.min(1, Math.max(0, finite(position.x, 0))) * available.x,
    y: top + Math.min(1, Math.max(0, finite(position.y, 0))) * available.y,
  }, viewport, launcher);
}

export function placeCompanionDialog(
  companion: CompanionPoint,
  viewport: CompanionViewport,
  launcher: CompanionSize,
  dialog: CompanionSize,
): CompanionPoint & { side: "left" | "right" | "above" | "below"; maxHeight: number } {
  const margin = 8;
  const horizontal = availableSpace(viewport, { width: 0, height: 0 });
  const frameWidth = horizontal.right - horizontal.left;
  const width = Math.min(Math.max(0, dialog.width), Math.max(0, frameWidth - margin * 2));
  const height = Math.min(
    Math.max(0, dialog.height),
    Math.max(0, viewport.height - viewport.topInset - viewport.bottomInset - margin),
  );
  const minimumX = horizontal.left + margin;
  const maximumX = Math.max(minimumX, horizontal.right - width - margin);
  const minimumY = Math.max(margin, viewport.topInset);
  const maximumY = Math.max(minimumY, viewport.height - viewport.bottomInset - height - margin);
  const rightSpace = horizontal.right - companion.x - launcher.width - margin;
  const leftSpace = companion.x - horizontal.left - margin;
  if (rightSpace >= width || leftSpace >= width) {
    const side = rightSpace >= width ? "right" : "left";
    const preferredX = side === "right"
      ? companion.x + launcher.width - margin
      : companion.x - width + margin;
    return {
      x: Math.min(maximumX, Math.max(minimumX, preferredX)),
      y: Math.min(maximumY, Math.max(minimumY, companion.y - 18)),
      side,
      maxHeight: height,
    };
  }

  const belowY = companion.y + launcher.height + margin;
  const belowSpace = Math.max(0, viewport.height - viewport.bottomInset - margin - belowY);
  const aboveSpace = Math.max(0, companion.y - margin - minimumY);
  const side = belowSpace >= aboveSpace ? "below" : "above";
  const maxHeight = Math.min(height, side === "below" ? belowSpace : aboveSpace);
  const preferredX = companion.x + launcher.width / 2 - width / 2;
  if (maxHeight < Math.min(160, height)) {
    return {
      x: Math.min(maximumX, Math.max(minimumX, preferredX)),
      y: minimumY,
      side,
      maxHeight: height,
    };
  }
  return {
    x: Math.min(maximumX, Math.max(minimumX, preferredX)),
    y: side === "below" ? belowY : Math.max(minimumY, companion.y - margin - maxHeight),
    side,
    maxHeight,
  };
}

export function placeCompanionRestore(
  companion: CompanionPoint,
  viewport: CompanionViewport,
  companionSize: CompanionSize,
  restore: CompanionSize,
): CompanionPoint {
  const clamped = clampCompanionPoint(companion, viewport, restore);
  const horizontal = availableSpace(viewport, { width: 0, height: 0 });
  const companionCenter = companion.x + Math.max(0, finite(companionSize.width, 0)) / 2;
  return {
    x: companionCenter <= horizontal.left + (horizontal.right - horizontal.left) / 2
      ? horizontal.left
      : Math.max(horizontal.left, horizontal.right - restore.width),
    y: clamped.y,
  };
}

export function placeCompanionLauncher(
  point: CompanionPoint,
  viewport: CompanionViewport,
  full: CompanionSize,
  peek: CompanionSize,
  edgeThreshold = 12,
): { point: CompanionPoint; edge: CompanionEdge } {
  const anchor = clampCompanionPoint(point, viewport, full);
  const horizontal = availableSpace(viewport, full);
  const threshold = Math.max(0, finite(edgeThreshold, 0));
  if (anchor.x <= horizontal.left + threshold) {
    return { point: { x: horizontal.left, y: anchor.y }, edge: "left" };
  }
  if (anchor.x >= horizontal.left + horizontal.x - threshold) {
    return {
      point: { x: Math.max(horizontal.left, horizontal.right - Math.max(0, finite(peek.width, 0))), y: anchor.y },
      edge: "right",
    };
  }
  return { point: anchor, edge: null };
}

export function parseCompanionPreference(value: string | null): CompanionPreference {
  if (!value) return DEFAULT_COMPANION_PREFERENCE;
  try {
    const parsed = JSON.parse(value) as Partial<CompanionPreference>;
    const position = parsed.position;
    if (parsed.version !== 1 || typeof parsed.hidden !== "boolean") return DEFAULT_COMPANION_PREFERENCE;
    if (position === null) return { version: 1, hidden: parsed.hidden, position: null };
    if (!position || typeof position.x !== "number" || typeof position.y !== "number"
      || !Number.isFinite(position.x) || !Number.isFinite(position.y)
      || position.x < 0 || position.x > 1 || position.y < 0 || position.y > 1) {
      return DEFAULT_COMPANION_PREFERENCE;
    }
    return { version: 1, hidden: parsed.hidden, position: { x: position.x, y: position.y } };
  } catch {
    return DEFAULT_COMPANION_PREFERENCE;
  }
}
