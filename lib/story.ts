import { terminalVoiceSourceKey } from "./terminal-voice.mjs";

export { terminalVoiceSourceKey } from "./terminal-voice.mjs";

export type AnimationPreset = "none" | "fade" | "rise" | "flash";
export type VideoMode = "none" | "background" | "transition";
export type TransitionPreset = "none" | "fade" | "fog" | "ripple" | "push" | "flash";
export type TransitionPosition = "afterSource" | "beforeTarget";
export type InteractionPreset = "none" | "glow" | "ripple" | "shake" | "flash" | "glitch" | "push";
export type TerminalVoicePreset = "cuteNeutral" | "gentleFemale" | "warmMale";
export type TerminalTrigger = "none" | "beforeContent" | "afterContent";
export type TerminalIdleMode = "corner" | "topTask";
export type TerminalTaskStatus = "active" | "completed" | "failed";
export type TerminalTaskObjective = { id: string; label: string; status: TerminalTaskStatus };
export type TerminalTask = {
  id: string;
  title: string;
  description: string;
  status: TerminalTaskStatus;
  objectives: TerminalTaskObjective[];
};
export type TerminalTaskAction = {
  id: string;
  type: "replaceTask" | "addObjective" | "setObjectiveStatus" | "setTaskStatus";
  task: TerminalTask | null;
  objective: TerminalTaskObjective | null;
  objectiveId: string;
  status: TerminalTaskStatus;
};
export type StoryTerminalConfig = {
  enabled: boolean;
  name: string;
  voicePreset: TerminalVoicePreset;
  voiceProvider: "elevenlabs";
  voiceId: string;
  voiceName: string;
  idleMode: TerminalIdleMode;
  initialTask: TerminalTask;
  autoSpeak: boolean;
  volume: number;
};
export type StoryTerminalEvent = {
  trigger: TerminalTrigger;
  message: string;
  speak: boolean;
  voiceAssetId: string;
  voiceUrl: string;
  voiceSourceKey: string;
};
export type DisplayImagePosition = "none" | "before" | "after";
export type ImageFit = "cover" | "contain";
export type ImagePresentation = { fit: ImageFit; positionX: number; positionY: number };
export const TRANSITION_PRESETS: readonly TransitionPreset[] = ["none", "fade", "fog", "ripple", "push", "flash"];
export const INTERACTION_PRESETS: readonly InteractionPreset[] = ["none", "glow", "ripple", "shake", "flash", "glitch", "push"];
export type StoryChoice = {
  id: string;
  label: string;
  targetId: string;
  transitionPreset: TransitionPreset;
  transitionPosition: TransitionPosition;
  interactionPreset: InteractionPreset;
  sfxAssetId: string;
  sfxUrl: string;
  sfxVolume: number;
  sfxMaxDurationMs: number;
  feedbackImageAssetId: string;
  feedbackImageUrl: string;
  feedbackImageAlt: string;
  feedbackImagePresentation: ImagePresentation;
  feedbackImageDurationMs: number;
  terminalFeedbackEnabled: boolean;
  terminalMessage: string;
  terminalSpeak: boolean;
  terminalVoiceAssetId: string;
  terminalVoiceUrl: string;
  terminalVoiceSourceKey: string;
  terminalTaskActions: TerminalTaskAction[];
};
export type StoryNode = {
  id: string;
  title: string;
  body: string;
  type: "scene" | "ending";
  canEndChapter: boolean;
  imageUrl: string;
  imageAlt: string;
  imagePresentation: ImagePresentation;
  audioUrl: string;
  imageAssetId: string;
  audioAssetId: string;
  videoAssetId: string;
  videoUrl: string;
  videoMode: VideoMode;
  displayImageAssetId: string;
  displayImageUrl: string;
  displayImageAlt: string;
  displayImagePosition: DisplayImagePosition;
  displayImagePresentation: ImagePresentation;
  position: { x: number; y: number };
  animation: AnimationPreset;
  terminalEvent: StoryTerminalEvent;
  choices: StoryChoice[];
};
export type StoryMusicCue = {
  id: string;
  name: string;
  assetId: string;
  url: string;
  startNodeId: string;
  stopNodeIds: string[];
  volume: number;
  loop: boolean;
  fadeMs: number;
};
export type MusicCueAction = {
  stopActive: boolean;
  startCue: StoryMusicCue | null;
};
export type AudioFadeFrame = {
  progress: number;
  fromVolume: number;
  toVolume: number;
};
export type StoryDocument = {
  title: string;
  summary: string;
  openingImageAssetId: string;
  openingImageUrl: string;
  openingImageAlt: string;
  openingImagePresentation: ImagePresentation;
  openingUsesNovelCover: boolean;
  /** Legacy aliases retained while old published JSON is normalized. */
  coverAssetId: string;
  coverUrl: string;
  coverAlt: string;
  outroImageAssetId: string;
  outroImageUrl: string;
  outroImageAlt: string;
  outroImagePresentation: ImagePresentation;
  outroUsesNovelCover: boolean;
  startNodeId: string;
  nodes: StoryNode[];
  musicCues: StoryMusicCue[];
  terminal: StoryTerminalConfig;
};
export type NovelDocument = {
  name: string;
  summary: string;
  coverAssetId: string;
  coverUrl: string;
  coverAlt: string;
  coverPresentation: ImagePresentation;
};
export type NovelFormat = "serial" | "short";
export type NovelSerialStatus = "ongoing" | "completed";
export type NovelRecord = {
  id: string;
  slug: string;
  ownerId: string | null;
  format: NovelFormat;
  serialStatus: NovelSerialStatus | null;
  formatLockedAt: string | null;
  convertibleTo: NovelFormat | null;
  draftStatus: "draft" | "submitted";
  submittedAt: string | null;
  reviewNote: string;
  sortOrder: number;
  status: "draft" | "published" | "offline";
  version: number;
  draft: NovelDocument;
  published: NovelDocument | null;
  updatedAt: string;
};
export type ChapterRecord = {
  id: string;
  novelId: string;
  slug: string;
  title: string;
  summary: string;
  coverUrl: string;
  sortOrder: number;
  status: "draft" | "published" | "offline";
  ownerId: string | null;
  draftStatus: "draft" | "submitted";
  submittedAt: string | null;
  reviewNote: string;
  version: number;
  draft: StoryDocument;
  published: StoryDocument | null;
  updatedAt: string;
};

export const STORY_PAGE_BREAK = "[[PAGE_BREAK]]";
export const NODE_BODY_RECOMMENDED_LENGTH = 600;
export const NODE_BODY_MAX_LENGTH = 2000;
export const SHORT_STORY_MAX_LENGTH = 20_000;
export const STORY_PAGE_TARGET_LENGTH = 190;
export const STORY_PAGE_MAX_LENGTH = 240;
export const DEFAULT_COVER_PRESENTATION: ImagePresentation = { fit: "cover", positionX: 50, positionY: 50 };
export const DEFAULT_CONTAIN_PRESENTATION: ImagePresentation = { fit: "contain", positionX: 50, positionY: 50 };
export const CHOICE_FEEDBACK_IMAGE_DEFAULT_MS = 1200;
export const CHOICE_MEDIA_MIN_MS = 100;
export const CHOICE_MEDIA_MAX_MS = 30000;
export const DEFAULT_STORY_TERMINAL: StoryTerminalConfig = {
  enabled: true,
  name: "幻界终端",
  voicePreset: "cuteNeutral",
  voiceProvider: "elevenlabs",
  voiceId: "",
  voiceName: "",
  idleMode: "topTask",
  initialTask: { id: "task-main", title: "", description: "", status: "active", objectives: [] },
  autoSpeak: false,
  volume: 0.75,
};
export const DEFAULT_TERMINAL_EVENT: StoryTerminalEvent = {
  trigger: "none", message: "", speak: true, voiceAssetId: "", voiceUrl: "", voiceSourceKey: "",
};

export function createTerminalTask(id = "task-main"): TerminalTask {
  return { id, title: "", description: "", status: "active", objectives: [] };
}

function normalizeTerminalStatus(value: unknown): TerminalTaskStatus {
  return value === "completed" || value === "failed" ? value : "active";
}

export function normalizeTerminalTask(value: Partial<TerminalTask> | null | undefined, fallbackId = "task-main"): TerminalTask {
  return {
    id: typeof value?.id === "string" && value.id.trim() ? value.id : fallbackId,
    title: typeof value?.title === "string" ? value.title : "",
    description: typeof value?.description === "string" ? value.description : "",
    status: normalizeTerminalStatus(value?.status),
    objectives: Array.isArray(value?.objectives) ? value.objectives.slice(0, 50).map((objective, index) => ({
      id: typeof objective?.id === "string" && objective.id.trim() ? objective.id : `${fallbackId}-objective-${index + 1}`,
      label: typeof objective?.label === "string" ? objective.label : "",
      status: normalizeTerminalStatus(objective?.status),
    })) : [],
  };
}

export function normalizeTerminalTaskAction(value: Partial<TerminalTaskAction>, fallbackId: string): TerminalTaskAction {
  const type = value.type === "replaceTask" || value.type === "addObjective" || value.type === "setObjectiveStatus"
    ? value.type
    : "setTaskStatus";
  return {
    id: typeof value.id === "string" && value.id.trim() ? value.id : fallbackId,
    type,
    task: value.task ? normalizeTerminalTask(value.task, `${fallbackId}-task`) : null,
    objective: value.objective ? {
      id: value.objective.id?.trim() || `${fallbackId}-objective`,
      label: value.objective.label ?? "",
      status: normalizeTerminalStatus(value.objective.status),
    } : null,
    objectiveId: typeof value.objectiveId === "string" ? value.objectiveId : "",
    status: normalizeTerminalStatus(value.status),
  };
}

export function getTerminalTaskActionMap(story: Pick<StoryDocument, "nodes">) {
  const actions = new Map<string, TerminalTaskAction>();
  story.nodes.forEach((node) => node.choices.forEach((choice) => choice.terminalTaskActions.forEach((action) => {
    if (!actions.has(action.id)) actions.set(action.id, action);
  })));
  return actions;
}

export function applyTerminalTaskEvents(story: Pick<StoryDocument, "terminal" | "nodes">, eventIds: string[]) {
  let task = normalizeTerminalTask(story.terminal.initialTask);
  const actionMap = getTerminalTaskActionMap(story);
  const appliedIds: string[] = [];
  for (const eventId of eventIds) {
    if (appliedIds.includes(eventId)) continue;
    const action = actionMap.get(eventId);
    if (!action) continue;
    appliedIds.push(eventId);
    if (action.type === "replaceTask" && action.task) task = normalizeTerminalTask(action.task, action.task.id);
    else if (action.type === "addObjective" && action.objective && !task.objectives.some((item) => item.id === action.objective!.id)) {
      task = { ...task, objectives: [...task.objectives, { ...action.objective }] };
    } else if (action.type === "setObjectiveStatus" && action.objectiveId) {
      task = { ...task, objectives: task.objectives.map((item) => item.id === action.objectiveId ? { ...item, status: action.status } : item) };
    } else if (action.type === "setTaskStatus") task = { ...task, status: action.status };
  }
  return { task, appliedIds };
}

export function normalizeChoiceImageDuration(value: unknown) {
  const duration = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(duration)) return CHOICE_FEEDBACK_IMAGE_DEFAULT_MS;
  return Math.max(CHOICE_MEDIA_MIN_MS, Math.min(CHOICE_MEDIA_MAX_MS, Math.round(duration)));
}

export function normalizeChoiceSfxMaxDuration(value: unknown) {
  const duration = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.max(CHOICE_MEDIA_MIN_MS, Math.min(CHOICE_MEDIA_MAX_MS, Math.round(duration)));
}

export function normalizeImagePresentation(
  value: Partial<ImagePresentation> | null | undefined,
  fallback: ImagePresentation = DEFAULT_COVER_PRESENTATION,
): ImagePresentation {
  const positionX = Number(value?.positionX);
  const positionY = Number(value?.positionY);
  return {
    fit: value?.fit === "contain" ? "contain" : value?.fit === "cover" ? "cover" : fallback.fit,
    positionX: Number.isFinite(positionX) ? Math.max(0, Math.min(100, positionX)) : fallback.positionX,
    positionY: Number.isFinite(positionY) ? Math.max(0, Math.min(100, positionY)) : fallback.positionY,
  };
}

export function createBlankNovel(): NovelDocument {
  return {
    name: "未命名小说",
    summary: "",
    coverAssetId: "",
    coverUrl: "",
    coverAlt: "",
    coverPresentation: { ...DEFAULT_COVER_PRESENTATION },
  };
}

export function normalizeNovel(novel: Partial<NovelDocument>): NovelDocument {
  return {
    name: novel.name ?? "未命名小说",
    summary: novel.summary ?? "",
    coverAssetId: novel.coverAssetId ?? "",
    coverUrl: novel.coverUrl ?? "",
    coverAlt: novel.coverAlt ?? "",
    coverPresentation: normalizeImagePresentation(novel.coverPresentation),
  };
}

export function validateNovel(novel: NovelDocument) {
  const errors: string[] = [];
  if (!novel.name.trim()) errors.push("小说名称不能为空");
  if (novel.name.length > 100) errors.push("小说名称不能超过 100 个字符");
  if (!novel.summary.trim()) errors.push("请填写小说简介");
  if (novel.summary.length > 1000) errors.push("小说简介不能超过 1000 个字符");
  if (!novel.coverAssetId && !novel.coverUrl) errors.push("请设置小说封面图");
  if (!novel.coverAlt.trim()) errors.push("请填写小说封面替代文本");
  if (novel.coverAlt.length > 500) errors.push("小说封面替代文本不能超过 500 个字符");
  return errors;
}

export type ReadingProgress = {
  nodeId: string;
  pageIndex: number;
  terminalEventIds?: string[];
  version?: number;
  updatedAt?: string;
  completedAt?: string | null;
};

const graphemeSegmenter = new Intl.Segmenter("zh-CN", { granularity: "grapheme" });

function graphemes(value: string) {
  return Array.from(graphemeSegmenter.segment(value), (part) => part.segment);
}

function isVisibleCharacter(value: string) {
  return !/^\s+$/u.test(value);
}

export function countStoryCharacters(body: string) {
  return graphemes(body.split(STORY_PAGE_BREAK).join(""))
    .filter(isVisibleCharacter).length;
}

export function countStoryBodyCharacters(story: Pick<StoryDocument, "nodes">) {
  return story.nodes.reduce((total, node) => total + countStoryCharacters(node.body), 0);
}

function splitAutomaticPage(section: string): string[] {
  const characters = graphemes(section);
  const pages: string[] = [];
  let offset = 0;

  while (offset < characters.length) {
    let visible = 0;
    let targetReached = false;
    let paragraphBreak = -1;
    let sentenceBreak = -1;
    let wordBreak = -1;
    let hardBreak = characters.length;

    for (let index = offset; index < characters.length; index += 1) {
      const character = characters[index];
      if (isVisibleCharacter(character)) visible += 1;
      if (visible >= STORY_PAGE_TARGET_LENGTH) targetReached = true;
      if (targetReached) {
        if (character === "\n" && paragraphBreak === -1) paragraphBreak = index + 1;
        else if (/[。！？；.!?]/u.test(character) && sentenceBreak === -1) sentenceBreak = index + 1;
        else if (/^\s+$/u.test(character) && wordBreak === -1) wordBreak = index + 1;
      }
      if (visible >= STORY_PAGE_MAX_LENGTH) {
        hardBreak = index + 1;
        break;
      }
    }

    if (hardBreak === characters.length
      && graphemes(characters.slice(offset).join("")).filter(isVisibleCharacter).length <= STORY_PAGE_MAX_LENGTH) {
      pages.push(characters.slice(offset).join(""));
      break;
    }

    const splitAt = paragraphBreak > offset
      ? paragraphBreak
      : sentenceBreak > offset
        ? sentenceBreak
        : wordBreak > offset
          ? wordBreak
          : hardBreak;
    pages.push(characters.slice(offset, splitAt).join(""));
    offset = splitAt;
  }

  return pages.length ? pages : [section];
}

export function paginateStoryBody(body: string): string[] {
  const manualSections = body.split(STORY_PAGE_BREAK)
    .filter((section) => countStoryCharacters(section) > 0);
  if (manualSections.length === 0) return [""];
  const pages = manualSections.flatMap((section) => splitAutomaticPage(section));
  return pages;
}

export function validateStoryBodyLengths(story: StoryDocument): string[] {
  return story.nodes.flatMap((node) => {
    const length = countStoryCharacters(node.body);
    return length > NODE_BODY_MAX_LENGTH
      ? [`节点「${node.title || node.id || "未命名"}」正文为 ${length} 字，超过 ${NODE_BODY_MAX_LENGTH} 字上限`]
      : [];
  });
}

export function validateStoryInputLengths(story: StoryDocument): string[] {
  const errors: string[] = [];
  if (story.title.length > 100) errors.push("章节名称不能超过 100 个字符");
  if (story.summary.length > 1000) errors.push("章节简介不能超过 1000 个字符");
  if ((story.openingImageAlt ?? story.coverAlt ?? "").length > 500 || story.outroImageAlt.length > 500) errors.push("图片替代文本不能超过 500 个字符");
  if ((story.terminal?.name ?? "").length > 30) errors.push("小雾副标题不能超过 30 个字符");
  if ((story.terminal?.voiceId ?? "").length > 100) errors.push("小雾音色 ID 不能超过 100 个字符");
  const initialTask = normalizeTerminalTask(story.terminal?.initialTask);
  if (initialTask.title.length > 100) errors.push("小雾任务标题不能超过 100 个字符");
  if (initialTask.description.length > 500) errors.push("小雾任务说明不能超过 500 个字符");
  if (initialTask.objectives.some((objective) => objective.label.length > 200)) errors.push("小雾任务目标不能超过 200 个字符");
  if (story.nodes.length > 500) errors.push("单章剧情节点不能超过 500 个");
  for (const node of story.nodes) {
    if (node.id.length > 100) errors.push("节点 ID 不能超过 100 个字符");
    if (node.title.length > 100) errors.push(`节点「${node.id}」标题不能超过 100 个字符`);
    if (node.imageAlt.length > 500) errors.push(`节点「${node.title || node.id}」插图替代文本不能超过 500 个字符`);
    if ((node.displayImageAlt ?? "").length > 500) errors.push(`节点「${node.title || node.id}」独立图片替代文本不能超过 500 个字符`);
    if ((node.terminalEvent?.message ?? "").length > 300) errors.push(`节点「${node.title || node.id}」小雾台词不能超过 300 个字符`);
    if (node.choices.length > 20) errors.push(`节点「${node.title || node.id}」不能超过 20 个选项`);
    if (node.choices.some((choice) => choice.label.length > 200)) errors.push(`节点「${node.title || node.id}」的选项文字不能超过 200 个字符`);
    for (const choice of node.choices) {
      if ((choice.terminalMessage ?? "").length > 300) errors.push(`节点「${node.title || node.id}」的选项「${choice.label || choice.id}」小雾台词不能超过 300 个字符`);
      if ((choice.terminalTaskActions ?? []).length > 20) errors.push(`节点「${node.title || node.id}」的选项「${choice.label || choice.id}」任务变化不能超过 20 条`);
      for (const action of choice.terminalTaskActions ?? []) {
        if (action.task && (action.task.title.length > 100 || action.task.description.length > 500)) errors.push("替换后的小雾任务文字过长");
        if (action.objective?.label && action.objective.label.length > 200) errors.push("新增的小雾任务目标不能超过 200 个字符");
      }
    }
  }
  return [...new Set(errors)];
}

export function getStoryBodyWarnings(story: StoryDocument): string[] {
  return story.nodes.flatMap((node) => {
    const length = countStoryCharacters(node.body);
    return length > NODE_BODY_RECOMMENDED_LENGTH && length <= NODE_BODY_MAX_LENGTH
      ? [`节点「${node.title || node.id || "未命名"}」正文为 ${length} 字，建议拆分或插入分页`]
      : [];
  });
}

export function getStoryTerminalWarnings(story: StoryDocument): string[] {
  const terminal = story.terminal ?? DEFAULT_STORY_TERMINAL;
  const warnings: string[] = [];
  story.nodes.forEach((node) => {
    node.choices.forEach((choice) => {
      if (!choice.terminalFeedbackEnabled || choice.terminalSpeak === false) return;
      if (!choice.terminalVoiceAssetId && !choice.terminalVoiceUrl) {
        warnings.push(`节点「${node.title}」的选项「${choice.label}」未配置 AI 语音，将使用设备朗读`);
        return;
      }
      const expected = terminalVoiceSourceKey(terminal.voiceId, choice.terminalMessage ?? "");
      if (choice.terminalVoiceSourceKey !== "manual" && choice.terminalVoiceSourceKey !== expected) {
        warnings.push(`节点「${node.title}」的选项「${choice.label}」AI 语音已过期，将暂时使用设备朗读`);
      }
    });
    if (!node.terminalEvent || node.terminalEvent.trigger === "none" || !node.terminalEvent.speak) return;
    if (!node.terminalEvent.voiceAssetId && !node.terminalEvent.voiceUrl) {
      warnings.push(`节点「${node.title}」未配置 AI 语音，将使用设备朗读`);
      return;
    }
    const expected = terminalVoiceSourceKey(terminal.voiceId, node.terminalEvent.message);
    if (node.terminalEvent.voiceSourceKey !== "manual" && node.terminalEvent.voiceSourceKey !== expected) {
      warnings.push(`节点「${node.title}」AI 语音已过期，将暂时使用设备朗读`);
    }
  });
  return [...new Set(warnings)];
}

export function parseReadingProgress(value: string | null, fallbackNodeId: string): ReadingProgress {
  if (!value) return { nodeId: fallbackNodeId, pageIndex: 0, terminalEventIds: [] };
  try {
    const parsed = JSON.parse(value) as Partial<ReadingProgress>;
    if (typeof parsed.nodeId === "string" && parsed.nodeId) {
      return {
        nodeId: parsed.nodeId,
        pageIndex: typeof parsed.pageIndex === "number" && Number.isFinite(parsed.pageIndex)
          ? Math.max(0, Math.floor(parsed.pageIndex))
          : 0,
        terminalEventIds: Array.isArray(parsed.terminalEventIds)
          ? [...new Set(parsed.terminalEventIds.filter((id): id is string => typeof id === "string" && id.length <= 100))].slice(0, 200)
          : [],
        ...(typeof parsed.version === "number" ? { version: parsed.version } : {}),
        ...(typeof parsed.updatedAt === "string" ? { updatedAt: parsed.updatedAt } : {}),
        ...(typeof parsed.completedAt === "string" || parsed.completedAt === null
          ? { completedAt: parsed.completedAt }
          : {}),
      };
    }
  } catch {
    return { nodeId: value, pageIndex: 0, terminalEventIds: [] };
  }
  return { nodeId: fallbackNodeId, pageIndex: 0, terminalEventIds: [] };
}

export function createBlankStory(): StoryDocument {
  return {
    title: "未命名章节",
    summary: "",
    openingImageAssetId: "",
    openingImageUrl: "",
    openingImageAlt: "",
    openingImagePresentation: { ...DEFAULT_COVER_PRESENTATION },
    openingUsesNovelCover: false,
    coverAssetId: "",
    coverUrl: "",
    coverAlt: "",
    outroImageAssetId: "",
    outroImageUrl: "",
    outroImageAlt: "",
    outroImagePresentation: { ...DEFAULT_COVER_PRESENTATION },
    outroUsesNovelCover: false,
    startNodeId: "start",
    musicCues: [],
    terminal: { ...DEFAULT_STORY_TERMINAL },
    nodes: [{
      id: "start",
      title: "起始节点",
      body: "",
      type: "scene",
      canEndChapter: false,
      imageAssetId: "",
      imageUrl: "",
      imageAlt: "",
      imagePresentation: { ...DEFAULT_COVER_PRESENTATION },
      audioAssetId: "",
      audioUrl: "",
      videoAssetId: "",
      videoUrl: "",
      videoMode: "none",
      displayImageAssetId: "",
      displayImageUrl: "",
      displayImageAlt: "",
      displayImagePosition: "none",
      displayImagePresentation: { ...DEFAULT_CONTAIN_PRESENTATION },
      position: { x: 40, y: 50 },
      choices: [],
      animation: "fade",
      terminalEvent: { ...DEFAULT_TERMINAL_EVENT },
    }],
  };
}

type StoryNodeInput = Pick<StoryNode, "id" | "title" | "body"> & Partial<Omit<StoryNode, "id" | "title" | "body">>;

export function createStoryChoice(input: Pick<StoryChoice, "id" | "label" | "targetId"> & Partial<Omit<StoryChoice, "id" | "label" | "targetId">>): StoryChoice {
  return {
    transitionPreset: "fade",
    transitionPosition: "afterSource",
    interactionPreset: "glow",
    sfxAssetId: "",
    sfxUrl: "",
    sfxVolume: 0.8,
    sfxMaxDurationMs: 0,
    feedbackImageAssetId: "",
    feedbackImageUrl: "",
    feedbackImageAlt: "",
    feedbackImagePresentation: { ...DEFAULT_CONTAIN_PRESENTATION },
    feedbackImageDurationMs: CHOICE_FEEDBACK_IMAGE_DEFAULT_MS,
    terminalFeedbackEnabled: false,
    terminalMessage: "",
    terminalSpeak: true,
    terminalVoiceAssetId: "",
    terminalVoiceUrl: "",
    terminalVoiceSourceKey: "",
    terminalTaskActions: [],
    ...input,
  };
}

export function createStoryNode(input: StoryNodeInput): StoryNode {
  const node: StoryNode = {
    type: "scene", imageUrl: "", imageAlt: "", audioUrl: "", imageAssetId: "", audioAssetId: "",
    videoAssetId: "", videoUrl: "", videoMode: "none",
    displayImageAssetId: "", displayImageUrl: "", displayImageAlt: "", displayImagePosition: "none",
    imagePresentation: { ...DEFAULT_COVER_PRESENTATION },
    displayImagePresentation: { ...DEFAULT_CONTAIN_PRESENTATION },
    terminalEvent: { ...DEFAULT_TERMINAL_EVENT },
    canEndChapter: false,
    position: { x: 0, y: 0 }, animation: "fade", choices: [],
    ...input,
  };
  node.canEndChapter = input.canEndChapter ?? input.type === "ending";
  return node;
}

export function normalizeStory(story: StoryDocument): StoryDocument {
  const legacyMusicCues = story.musicCues == null
    ? story.nodes.filter((node) => node.audioAssetId || node.audioUrl).map((node) => ({
      id: `legacy-music-${node.id}`,
      name: `${node.title || node.id}配乐`,
      assetId: node.audioAssetId ?? "",
      url: node.audioUrl ?? "",
      startNodeId: node.id,
      stopNodeIds: (node.choices ?? []).map((choice) => choice.targetId),
      volume: 0.7,
      loop: true,
      fadeMs: 500,
    }))
    : story.musicCues;
  const openingImageAssetId = story.openingImageAssetId ?? story.coverAssetId ?? "";
  const openingImageUrl = story.openingImageUrl ?? story.coverUrl ?? "";
  const openingImageAlt = story.openingImageAlt ?? story.coverAlt ?? "";
  return {
    ...story,
    terminal: {
      enabled: story.terminal?.enabled !== false,
      name: story.terminal?.name?.trim() || DEFAULT_STORY_TERMINAL.name,
      voicePreset: story.terminal?.voicePreset === "gentleFemale" || story.terminal?.voicePreset === "warmMale"
        ? story.terminal.voicePreset
        : "cuteNeutral",
      voiceProvider: "elevenlabs",
      voiceId: story.terminal?.voiceId ?? "",
      voiceName: story.terminal?.voiceName ?? "",
      idleMode: story.terminal?.idleMode === "topTask" ? "topTask" : "corner",
      initialTask: normalizeTerminalTask(story.terminal?.initialTask),
      autoSpeak: story.terminal?.autoSpeak === true,
      volume: clampMediaVolume(story.terminal?.volume, DEFAULT_STORY_TERMINAL.volume),
    },
    openingImageAssetId,
    openingImageUrl,
    openingImageAlt,
    openingImagePresentation: normalizeImagePresentation(story.openingImagePresentation),
    openingUsesNovelCover: story.openingUsesNovelCover === true,
    coverAssetId: story.coverAssetId ?? openingImageAssetId,
    coverUrl: story.coverUrl ?? openingImageUrl,
    coverAlt: story.coverAlt ?? openingImageAlt,
    outroImageAssetId: story.outroImageAssetId ?? "",
    outroImageUrl: story.outroImageUrl ?? "",
    outroImageAlt: story.outroImageAlt ?? "",
    outroImagePresentation: normalizeImagePresentation(story.outroImagePresentation),
    outroUsesNovelCover: story.outroUsesNovelCover === true,
    musicCues: legacyMusicCues.map((cue, index) => ({
      id: cue.id || `music-${index + 1}`,
      name: cue.name || `配乐 ${index + 1}`,
      assetId: cue.assetId ?? "",
      url: cue.url ?? "",
      startNodeId: cue.startNodeId ?? "",
      stopNodeIds: Array.isArray(cue.stopNodeIds) ? cue.stopNodeIds : [],
      volume: Number.isFinite(cue.volume) ? Math.max(0, Math.min(1, cue.volume)) : 0.7,
      loop: cue.loop !== false,
      fadeMs: Number.isFinite(cue.fadeMs) ? Math.max(0, Math.min(3000, Math.round(cue.fadeMs))) : 500,
    })),
    nodes: story.nodes.map((node, index) => createStoryNode({
      ...node,
      canEndChapter: node.canEndChapter ?? node.type === "ending",
      choices: (node.choices ?? []).map((choice) => ({
        ...choice,
        transitionPreset: TRANSITION_PRESETS.includes(choice.transitionPreset as TransitionPreset)
          ? choice.transitionPreset as TransitionPreset
          : "fade",
        transitionPosition: choice.transitionPosition === "afterSource"
          ? "afterSource"
          : "beforeTarget",
        interactionPreset: INTERACTION_PRESETS.includes(choice.interactionPreset as InteractionPreset)
          ? choice.interactionPreset as InteractionPreset
          : choice.transitionPreset === "ripple" || choice.transitionPreset === "push" || choice.transitionPreset === "flash"
            ? choice.transitionPreset
            : choice.transitionPreset === "none" ? "none" : "glow",
        sfxAssetId: choice.sfxAssetId ?? "",
        sfxUrl: choice.sfxUrl ?? "",
        sfxVolume: Number.isFinite(choice.sfxVolume) ? clampMediaVolume(choice.sfxVolume, 0.8) : 0.8,
        sfxMaxDurationMs: normalizeChoiceSfxMaxDuration(choice.sfxMaxDurationMs),
        feedbackImageAssetId: choice.feedbackImageAssetId ?? "",
        feedbackImageUrl: choice.feedbackImageUrl ?? "",
        feedbackImageAlt: choice.feedbackImageAlt ?? "",
        feedbackImagePresentation: normalizeImagePresentation(
          choice.feedbackImagePresentation,
          DEFAULT_CONTAIN_PRESENTATION,
        ),
        feedbackImageDurationMs: normalizeChoiceImageDuration(choice.feedbackImageDurationMs),
        terminalFeedbackEnabled: choice.terminalFeedbackEnabled === true,
        terminalMessage: choice.terminalMessage ?? "",
        terminalSpeak: choice.terminalSpeak !== false,
        terminalVoiceAssetId: choice.terminalVoiceAssetId ?? "",
        terminalVoiceUrl: choice.terminalVoiceUrl ?? "",
        terminalVoiceSourceKey: choice.terminalVoiceSourceKey ?? "",
        terminalTaskActions: Array.isArray(choice.terminalTaskActions)
          ? choice.terminalTaskActions.slice(0, 20).map((action, actionIndex) => normalizeTerminalTaskAction(
            action,
            `${choice.id || `choice-${index}`}-terminal-${actionIndex + 1}`,
          ))
          : [],
      })),
      position: node.position ?? { x: (index % 3) * 300, y: Math.floor(index / 3) * 190 },
      imageAssetId: node.imageAssetId ?? "",
      imagePresentation: normalizeImagePresentation(node.imagePresentation),
      audioAssetId: node.audioAssetId ?? "",
      videoAssetId: node.videoAssetId ?? "",
      videoUrl: node.videoUrl ?? "",
      videoMode: node.videoMode ?? "none",
      displayImageAssetId: node.displayImageAssetId ?? "",
      displayImageUrl: node.displayImageUrl ?? "",
      displayImageAlt: node.displayImageAlt ?? "",
      displayImagePosition: node.displayImagePosition === "before" || node.displayImagePosition === "after"
        ? node.displayImagePosition
        : "none",
      displayImagePresentation: normalizeImagePresentation(
        node.displayImagePresentation,
        DEFAULT_CONTAIN_PRESENTATION,
      ),
      terminalEvent: {
        trigger: node.terminalEvent?.trigger === "beforeContent" || node.terminalEvent?.trigger === "afterContent"
          ? node.terminalEvent.trigger
          : "none",
        message: node.terminalEvent?.message ?? "",
        speak: node.terminalEvent?.speak !== false,
        voiceAssetId: node.terminalEvent?.voiceAssetId ?? "",
        voiceUrl: node.terminalEvent?.voiceUrl ?? "",
        voiceSourceKey: node.terminalEvent?.voiceSourceKey ?? "",
      },
    })),
  };
}

export function clampMediaVolume(value: number, fallback = 0): number {
  const safeValue = Number.isFinite(value) ? value : fallback;
  return Math.max(0, Math.min(1, safeValue));
}

export function calculateAudioFadeFrame(
  fromVolume: number,
  toVolume: number,
  startedAt: number,
  now: number,
  duration: number,
): AudioFadeFrame {
  const safeDuration = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  const progress = safeDuration === 0
    ? 1
    : clampMediaVolume((now - startedAt) / safeDuration);
  return {
    progress,
    fromVolume: clampMediaVolume(clampMediaVolume(fromVolume) * (1 - progress)),
    toVolume: clampMediaVolume(clampMediaVolume(toVolume) * progress),
  };
}

export function resolveMusicCueAction(
  story: Pick<StoryDocument, "musicCues">,
  sourceNodeId: string,
  targetNodeId: string,
  activeCueId: string | null,
): MusicCueAction {
  const active = activeCueId ? story.musicCues.find((cue) => cue.id === activeCueId) : null;
  const startCue = story.musicCues.find((cue) => cue.startNodeId === targetNodeId) ?? null;
  return {
    stopActive: Boolean(active && (
      active.stopNodeIds.includes(sourceNodeId)
      || (startCue && startCue.id !== activeCueId)
    )),
    startCue: startCue?.id === activeCueId ? null : startCue,
  };
}

export function validateStory(story: StoryDocument, options: { validateBodyLengths?: boolean } = {}): string[] {
  const errors = [
    ...(options.validateBodyLengths === false ? [] : validateStoryBodyLengths(story)),
    ...validateStoryInputLengths(story),
  ];
  const ids = new Set<string>();
  story.nodes.forEach((node) => {
    if (!node.id.trim()) errors.push("存在未填写 ID 的节点");
    if (ids.has(node.id)) errors.push(`节点 ID 重复：${node.id}`);
    ids.add(node.id);
    if (!node.title.trim()) errors.push(`节点 ${node.id || "（未命名）"} 缺少标题`);
    if (countStoryCharacters(node.body) === 0) errors.push(`节点 ${node.id || "（未命名）"} 缺少正文`);
    const canEndChapter = node.canEndChapter ?? node.type === "ending";
    if (!canEndChapter && node.choices.length === 0) errors.push(`节点 ${node.title} 既没有选项，也不能结束章节`);
  });
  if (!ids.has(story.startNodeId)) errors.push("起始节点不存在");
  story.nodes.forEach((node) => node.choices.forEach((choice) => {
    if (!choice.label.trim()) errors.push(`${node.title} 存在空白选项`);
    if (!ids.has(choice.targetId)) errors.push(`${node.title} 的选项指向不存在的节点 ${choice.targetId}`);
  }));
  const taskActionIds = new Set<string>();
  const terminal = story.terminal ?? { ...DEFAULT_STORY_TERMINAL, idleMode: "corner" as const, initialTask: createTerminalTask() };
  const initialTask = normalizeTerminalTask(terminal.initialTask);
  const knownObjectiveIds = new Set(initialTask.objectives.map((objective) => objective.id));
  const terminalChoices = story.nodes.flatMap((node) => node.choices.map((choice) => ({ node, choice })));
  terminalChoices.forEach(({ node, choice }) => (choice.terminalTaskActions ?? []).forEach((action) => {
    if (!action.id.trim()) errors.push(`节点「${node.title}」的选项「${choice.label}」存在缺少 ID 的任务变化`);
    else if (taskActionIds.has(action.id)) errors.push(`小雾任务变化 ID 重复：${action.id}`);
    taskActionIds.add(action.id);
    if (action.type === "addObjective" && action.objective?.id) knownObjectiveIds.add(action.objective.id);
    if (action.type === "replaceTask" && action.task) action.task.objectives.forEach((objective) => knownObjectiveIds.add(objective.id));
  }));
  terminalChoices.forEach(({ node, choice }) => {
    if (!choice.terminalFeedbackEnabled) return;
    if (!(choice.terminalMessage ?? "").trim()) errors.push(`节点「${node.title}」的选项「${choice.label}」启用了小雾反馈但没有填写台词`);
    (choice.terminalTaskActions ?? []).forEach((action) => {
      if (action.type === "replaceTask" && (!action.task?.title.trim() || action.task.objectives.length === 0)) errors.push(`选项「${choice.label}」替换任务时需要标题和至少一个目标`);
      if (action.type === "addObjective" && (!action.objective?.id.trim() || !action.objective.label.trim())) errors.push(`选项「${choice.label}」新增任务目标不完整`);
      if (action.type === "setObjectiveStatus" && !knownObjectiveIds.has(action.objectiveId)) errors.push(`选项「${choice.label}」要修改的任务目标不存在`);
    });
  });
  story.nodes.forEach((node) => {
    if (!node.terminalEvent || node.terminalEvent.trigger === "none") return;
    if (!node.terminalEvent.message.trim()) errors.push(`节点「${node.title}」启用了小雾消息但没有填写台词`);
  });
  if ((taskActionIds.size > 0 || terminal.idleMode === "topTask") && initialTask.title.trim()) {
    if (initialTask.objectives.length === 0) errors.push("顶部任务 HUD 至少需要一个初始任务目标");
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  let hasCycle = false;
  const detectCycle = (id: string) => {
    if (visiting.has(id)) { hasCycle = true; return; }
    if (visited.has(id)) return;
    visiting.add(id);
    story.nodes.find((node) => node.id === id)?.choices.forEach((choice) => detectCycle(choice.targetId));
    visiting.delete(id);
    visited.add(id);
  };
  story.nodes.forEach((node) => detectCycle(node.id));
  if (hasCycle) errors.push("故事存在循环路径，请确认读者不会被困在其中");
  const reachable = new Set<string>();
  const visit = (id: string) => {
    if (reachable.has(id)) return;
    reachable.add(id);
    story.nodes.find((node) => node.id === id)?.choices.forEach((choice) => visit(choice.targetId));
  };
  visit(story.startNodeId);
  story.nodes.filter((node) => !reachable.has(node.id)).forEach((node) => errors.push(`节点「${node.title}」无法从开头到达`));
  if (!story.nodes.some((node) => (node.canEndChapter ?? node.type === "ending") && reachable.has(node.id))) errors.push("故事没有可到达的章节结束节点");
  const cueStarts = new Set<string>();
  (story.musicCues ?? []).forEach((cue) => {
    if (!cue.id.trim()) errors.push("存在缺少 ID 的配乐区间");
    if (!ids.has(cue.startNodeId)) errors.push(`配乐「${cue.name}」的开始节点不存在`);
    if (cueStarts.has(cue.startNodeId)) errors.push(`节点「${cue.startNodeId}」不能同时开始多条配乐`);
    cueStarts.add(cue.startNodeId);
    if (cue.stopNodeIds.length === 0) errors.push(`配乐「${cue.name}」至少需要一个结束节点`);
    const reachableFromCueStart = collectReachableNodeIds(story, cue.startNodeId);
    cue.stopNodeIds.forEach((stopId) => {
      if (!ids.has(stopId)) errors.push(`配乐「${cue.name}」的停止节点 ${stopId} 不存在`);
      if (ids.has(stopId) && !reachableFromCueStart.has(stopId)) {
        errors.push(`配乐「${cue.name}」的结束节点「${stopId}」无法从开始节点到达`);
      }
    });
  });
  return [...new Set(errors)];
}

export function validateStoryMedia(story: StoryDocument): string[] {
  const errors: string[] = [];
  if (!story.title.trim()) errors.push("章节名称不能为空");
  const openingAssetId = story.openingImageAssetId ?? story.coverAssetId ?? "";
  const openingUrl = story.openingImageUrl ?? story.coverUrl ?? "";
  const openingAlt = story.openingImageAlt ?? story.coverAlt ?? "";
  if ((openingAssetId || openingUrl) && !openingAlt.trim()) {
    errors.push("请填写章节开场图替代文本");
  }
  if (!story.outroImageAssetId && !story.outroImageUrl) errors.push("请设置章节收尾图");
  if (!story.outroImageAlt.trim()) errors.push("请填写章节收尾图替代文本");
  story.nodes.forEach((node) => {
    if (node.displayImagePosition === "none") return;
    if (!node.displayImageAssetId && !node.displayImageUrl) {
      errors.push(`节点「${node.title || node.id}」启用了独立图片页，但尚未选择图片`);
    }
    if (!node.displayImageAlt.trim()) {
      errors.push(`节点「${node.title || node.id}」的独立图片页缺少替代文本`);
    }
  });
  story.nodes.forEach((node) => node.choices.forEach((choice) => {
    if ((choice.feedbackImageAssetId || choice.feedbackImageUrl) && !choice.feedbackImageAlt.trim()) {
      errors.push(`节点「${node.title || node.id}」的选项「${choice.label || choice.id}」反馈图片缺少替代文本`);
    }
  }));
  return errors;
}

export const FLOW_COLUMN_GAP = 300;
export const FLOW_ROW_GAP = 190;
export const FLOW_NODE_WIDTH = 190;
export const FLOW_NODE_HEIGHT = 96;

export type FlowEditResult = {
  story: StoryDocument;
  createdNodeId?: string;
  error?: string;
};

type Point = { x: number; y: number };

const nodeTemplate = (id: string, position: Point) => createStoryNode({
  id,
  title: "新场景",
  body: "在这里写下故事……",
  position,
});

function hasNode(story: StoryDocument, id: string) {
  return story.nodes.some((node) => node.id === id);
}

function overlaps(left: Point, right: Point) {
  return Math.abs(left.x - right.x) < FLOW_NODE_WIDTH
    && Math.abs(left.y - right.y) < FLOW_NODE_HEIGHT;
}

export function findAvailablePosition(story: StoryDocument, preferred: Point, ignoredIds = new Set<string>()): Point {
  const occupied = story.nodes.filter((node) => !ignoredIds.has(node.id)).map((node) => node.position);
  const offsets = [0];
  for (let distance = 1; distance <= story.nodes.length + 1; distance += 1) {
    offsets.push(distance * FLOW_ROW_GAP, -distance * FLOW_ROW_GAP);
  }
  const offset = offsets.find((candidate) => !occupied.some((position) => overlaps(position, {
    x: preferred.x,
    y: preferred.y + candidate,
  }))) ?? offsets[offsets.length - 1];
  return { x: preferred.x, y: preferred.y + offset };
}

export function createStandaloneNode(story: StoryDocument, nodeId: string, position: Point): FlowEditResult {
  if (hasNode(story, nodeId)) return { story, error: `节点 ID 已存在：${nodeId}` };
  return {
    story: { ...story, nodes: [...story.nodes, nodeTemplate(nodeId, position)] },
    createdNodeId: nodeId,
  };
}

export function createChildNode(
  story: StoryDocument,
  sourceId: string,
  nodeId: string,
  choiceId: string,
): FlowEditResult {
  if (hasNode(story, nodeId)) return { story, error: `节点 ID 已存在：${nodeId}` };
  const source = story.nodes.find((node) => node.id === sourceId);
  if (!source) return { story, error: "来源节点不存在" };
  const position = findAvailablePosition(story, {
    x: source.position.x + FLOW_COLUMN_GAP,
    y: source.position.y,
  });
  const child = nodeTemplate(nodeId, position);
  return {
    story: {
      ...story,
      nodes: story.nodes.map((node) => node.id === sourceId ? {
        ...node,
        choices: [...node.choices, createStoryChoice({
          id: choiceId,
          label: "新的选择",
          targetId: nodeId,
        })],
      } : node).concat(child),
    },
    createdNodeId: nodeId,
  };
}

export function collectReachableNodeIds(story: StoryDocument, startId: string, excludedIds = new Set<string>()) {
  const reachable = new Set<string>();
  const queue = [startId];
  while (queue.length) {
    const id = queue.shift()!;
    if (reachable.has(id) || excludedIds.has(id)) continue;
    const node = story.nodes.find((candidate) => candidate.id === id);
    if (!node) continue;
    reachable.add(id);
    node.choices.forEach((choice) => {
      if (!reachable.has(choice.targetId) && !excludedIds.has(choice.targetId)) queue.push(choice.targetId);
    });
  }
  return reachable;
}

export function insertNodeOnChoice(
  story: StoryDocument,
  sourceId: string,
  choiceId: string,
  nodeId: string,
  continueChoiceId: string,
): FlowEditResult {
  if (hasNode(story, nodeId)) return { story, error: `节点 ID 已存在：${nodeId}` };
  const source = story.nodes.find((node) => node.id === sourceId);
  if (!source) return { story, error: "来源节点不存在" };
  const choice = source.choices.find((candidate) => candidate.id === choiceId);
  if (!choice) return { story, error: "待插入的剧情连线不存在" };
  const target = story.nodes.find((node) => node.id === choice.targetId);
  if (!target) return { story, error: "目标节点不存在" };

  const shiftedIds = collectReachableNodeIds(story, target.id, new Set([source.id]));
  const shiftedTarget = {
    x: target.position.x + FLOW_COLUMN_GAP,
    y: target.position.y,
  };
  const shiftedStory: StoryDocument = {
    ...story,
    nodes: story.nodes.map((node) => shiftedIds.has(node.id)
      ? { ...node, position: { x: node.position.x + FLOW_COLUMN_GAP, y: node.position.y } }
      : node),
  };
  const position = findAvailablePosition(shiftedStory, {
    x: Math.round((source.position.x + shiftedTarget.x) / 2),
    y: Math.round((source.position.y + shiftedTarget.y) / 2),
  });
  const inserted = nodeTemplate(nodeId, position);
  inserted.choices = [createStoryChoice({
    id: continueChoiceId,
    label: "继续",
    targetId: target.id,
  })];

  return {
    story: {
      ...shiftedStory,
      nodes: shiftedStory.nodes.map((node) => node.id === source.id ? {
        ...node,
        choices: node.choices.map((item) => item.id === choiceId
          ? { ...item, targetId: nodeId }
          : item),
      } : node).concat(inserted),
    },
    createdNodeId: nodeId,
  };
}
