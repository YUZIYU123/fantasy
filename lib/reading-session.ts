import {
  applyTerminalTaskEvents,
  normalizeChoiceImageDuration,
  paginateStoryBody,
  resolveMusicCueAction,
  type StoryChoice,
  type StoryDocument,
  type StoryMusicCue,
  type TransitionPreset,
} from "./story.ts";

export type ReadingProgress = {
  nodeId: string;
  pageIndex: number;
  terminalEventIds?: string[];
  version?: number;
  updatedAt?: string;
  completedAt?: string | null;
};

export type ReadingProgressUpdate = {
  chapterId?: string;
  nodeId?: string;
  pageIndex?: number;
  updatedAt?: string;
  completed?: boolean;
  terminalEventIds?: string[];
};

export type ReadingHeartbeatFact = {
  chapterId: string;
  chapterVersion: number;
  nodeId: string;
  windowStartedAt: string;
};

export type ReadingDiscoveryFact = { chapterId: string; chapterVersion: number; nodeId: string };

export function createReadingDiscoveryFact(input: {
  state: ReadingState | null;
  preview: boolean;
  chapterId: string;
  chapterVersion: number;
}): ReadingDiscoveryFact | null {
  if (input.preview || input.state?.phase !== "content" || !input.state.nodeId) return null;
  return { chapterId: input.chapterId, chapterVersion: input.chapterVersion, nodeId: input.state.nodeId };
}

export function createReadingHeartbeatFact(input: {
  state: ReadingState | null;
  preview: boolean;
  chapterId: string;
  chapterVersion: number;
  windowStartedAt: string;
}): ReadingHeartbeatFact | null {
  if (input.preview || input.state?.phase !== "content" || !input.state.nodeId) return null;
  return {
    chapterId: input.chapterId,
    chapterVersion: input.chapterVersion,
    nodeId: input.state.nodeId,
    windowStartedAt: input.windowStartedAt,
  };
}

export class ReadingSessionError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function validateReadingProgressUpdate(
  story: StoryDocument,
  update: ReadingProgressUpdate,
  now = Date.now(),
) {
  if (!update.chapterId || !update.nodeId) throw new ReadingSessionError("阅读进度数据不完整");
  const progressNode = story.nodes.find((node) => node.id === update.nodeId);
  if (!progressNode) throw new ReadingSessionError("阅读节点已失效", 409);
  if (update.completed && !progressNode.canEndChapter) {
    throw new ReadingSessionError("只能在允许结束本章的节点完成章节", 409);
  }
  const requestedTerminalEventIds = Array.isArray(update.terminalEventIds)
    ? update.terminalEventIds.filter((id): id is string => typeof id === "string" && id.length <= 100).slice(0, 200)
    : [];
  const requestedTime = update.updatedAt && Number.isFinite(Date.parse(update.updatedAt))
    ? Date.parse(update.updatedAt)
    : now;
  const updatedAt = new Date(Math.min(requestedTime, now + 5 * 60 * 1000)).toISOString();
  return {
    nodeId: update.nodeId,
    pageIndex: Math.max(0, Math.floor(Number(update.pageIndex) || 0)),
    terminalEventIds: applyTerminalTaskEvents(story, requestedTerminalEventIds).appliedIds,
    completedAt: update.completed ? updatedAt : null,
    updatedAt,
  };
}

export type ReadingPhase = "beforeImage" | "transitionVideo" | "transitionEffect" | "content" | "afterImage";

export type ReadingEffect =
  | { kind: "persist-progress"; progress: ReadingProgress & { completed: boolean } }
  | { kind: "play-sfx"; id: string; url: string; volume: number; maximumMs: number }
  | { kind: "wait"; id: string; milliseconds: number }
  | { kind: "music"; action: "start"; cue: StoryMusicCue }
  | { kind: "music"; action: "stop" | "pause" | "resume" }
  | { kind: "video"; id: string; action: "play"; maximumMs: number }
  | { kind: "terminal-feedback"; id: string; playback: SessionTerminalPlayback; maximumMs: number }
  | { kind: "complete" };

export type SessionTerminalPlayback = {
  id: string;
  message: string;
  speak: boolean;
  voiceUrl: string;
  reaction: TerminalReaction;
  interactionPreset: StoryChoice["interactionPreset"];
  imageUrl: string;
  imageAlt: string;
  imagePresentation: StoryChoice["feedbackImagePresentation"];
  task: ReturnType<typeof applyTerminalTaskEvents>["task"];
};

export type TerminalReaction = "notice" | "success" | "warning";

export function resolveTerminalReaction(choice: StoryChoice): TerminalReaction {
  const statuses = choice.terminalTaskActions.flatMap((action) => {
    if (action.type === "replaceTask" && action.task) {
      return [action.task.status, ...action.task.objectives.map((objective) => objective.status)];
    }
    if (action.type === "addObjective" && action.objective) return [action.objective.status];
    return [action.status];
  });
  if (statuses.includes("failed")) return "warning";
  if (statuses.includes("completed")) return "success";
  return "notice";
}

export type ReadingState = {
  nodeId: string;
  pageIndex: number;
  phase: ReadingPhase;
  afterImageDone: boolean;
  incomingChoice: StoryChoice | null;
  transitionVideoDone: boolean;
  activeTransition: TransitionPreset | null;
  choiceLocked: boolean;
  choiceFeedback: StoryChoice | null;
  terminalEventIds: string[];
  activeCueId: string | null;
  activeCueName: string;
  completed: boolean;
};

export type ReadingEvent =
  | { type: "page"; index: number }
  | { type: "show-after-image" }
  | { type: "continue-image" }
  | { type: "choose"; choiceId: string }
  | { type: "effect-result"; id: string; outcome: "success" | "complete" | "failure" | "timeout" }
  | { type: "complete" };

export type ReadingSessionInput = {
  story: StoryDocument;
  chapterId: string;
  chapterVersion: number;
  preview: boolean;
  initialNodeId?: string;
  deviceProgress?: ReadingProgress | null;
  cloudProgress?: ReadingProgress | null;
  reducedMotion?: boolean;
  now?: () => string;
};

export function observeReadingSession(story: StoryDocument, state: ReadingState) {
  const node = story.nodes.find((item) => item.id === state.nodeId);
  const pages = paginateStoryBody(node?.body || "");
  const pageIndex = Math.min(state.pageIndex, Math.max(0, pages.length - 1));
  const isLastPage = pageIndex === pages.length - 1;
  const terminalEvent = node && (node.terminalEvent?.trigger === "beforeContent" && pageIndex === 0
    || node.terminalEvent?.trigger === "afterContent" && isLastPage) ? node.terminalEvent : undefined;
  return {
    terminalEvent,
    terminalTask: applyTerminalTaskEvents(story, state.terminalEventIds).task,
    terminalSuppressed: state.phase !== "content" || state.choiceLocked,
  };
}

const interactionDuration = { none: 350, glow: 480, ripple: 680, shake: 420, flash: 360, glitch: 560, push: 520 } as const;
const transitionDuration: Record<TransitionPreset, number> = {
  none: 0, fade: 420, fog: 760, ripple: 680, push: 520, flash: 430,
};

function chooseProgress(input: ReadingSessionInput) {
  if (input.preview) return null;
  const device = input.deviceProgress;
  const cloud = input.cloudProgress;
  if (!device) return cloud;
  if (!cloud) return device;
  return Date.parse(cloud.updatedAt || "") > Date.parse(device.updatedAt || "") ? cloud : device;
}

function initialNodeId(input: ReadingSessionInput) {
  const explicit = input.story.nodes.some((node) => node.id === input.initialNodeId) ? input.initialNodeId : undefined;
  if (explicit) return explicit;
  const progress = chooseProgress(input);
  const restart = Boolean(progress?.completedAt) || (typeof progress?.version === "number" && progress.version !== input.chapterVersion);
  return !restart && input.story.nodes.some((node) => node.id === progress?.nodeId) ? progress!.nodeId : input.story.startNodeId;
}

export function createReadingSession(input: ReadingSessionInput) {
  const now = input.now ?? (() => new Date().toISOString());
  const progress = chooseProgress(input);
  const nodeId = initialNodeId(input);
  const resumed = nodeId === progress?.nodeId && !progress.completedAt
    && (typeof progress.version !== "number" || progress.version === input.chapterVersion);
  const firstPhase = (targetId: string): ReadingPhase => {
    const node = input.story.nodes.find((item) => item.id === targetId);
    if (node?.displayImagePosition === "before") return "beforeImage";
    if (!input.reducedMotion && node?.videoMode === "transition" && node.videoUrl) return "transitionVideo";
    return "content";
  };
  let state: ReadingState = {
    nodeId,
    pageIndex: resumed ? Math.max(0, progress?.pageIndex || 0) : 0,
    phase: firstPhase(nodeId),
    afterImageDone: false,
    incomingChoice: null,
    transitionVideoDone: false,
    activeTransition: null,
    choiceLocked: false,
    choiceFeedback: null,
    terminalEventIds: resumed ? progress?.terminalEventIds ?? [] : [],
    activeCueId: null,
    activeCueName: "",
    completed: false,
  };

  const progressEffect = (completed = false): ReadingEffect[] => input.preview ? [] : [{
    kind: "persist-progress",
    progress: {
      nodeId: state.nodeId, pageIndex: state.pageIndex, terminalEventIds: state.terminalEventIds,
      version: input.chapterVersion, updatedAt: now(), completedAt: completed ? now() : null, completed,
    },
  }];
  const shouldRunTransition = (choice: StoryChoice, position: StoryChoice["transitionPosition"]) => (
    !input.reducedMotion && choice.transitionPosition === position && choice.transitionPreset !== "none"
  );
  const beginTransition = (choice: StoryChoice) => {
    state = {
      ...state,
      phase: "transitionEffect",
      activeTransition: choice.transitionPreset,
      choiceLocked: true,
      choiceFeedback: null,
    };
    return [{
      kind: "wait" as const,
      id: `transition:${choice.id}`,
      milliseconds: transitionDuration[choice.transitionPreset],
    }];
  };
  const enter = (targetId: string, choice: StoryChoice | null) => {
    const currentId = state.nodeId;
    const music = resolveMusicCueAction(input.story, currentId, targetId, state.activeCueId);
    const phase = firstPhase(targetId);
    const transitionBeforeTarget = Boolean(choice && shouldRunTransition(choice, "beforeTarget"));
    state = {
      ...state, nodeId: targetId, pageIndex: 0, phase, afterImageDone: false,
      incomingChoice: choice, transitionVideoDone: false, activeTransition: null,
      choiceLocked: transitionBeforeTarget, choiceFeedback: null,
      activeCueId: music.startCue?.id ?? (music.stopActive ? null : state.activeCueId),
      activeCueName: music.startCue?.name ?? (music.stopActive ? "" : state.activeCueName),
    };
    const effects: ReadingEffect[] = [];
    if (music.startCue) effects.push({ kind: "music", action: "start", cue: music.startCue });
    else if (music.stopActive) effects.push({ kind: "music", action: "stop" });
    if (state.phase === "transitionVideo") {
      if (state.activeCueId) effects.push({ kind: "music", action: "pause" });
      effects.push({ kind: "video", id: `video:${targetId}`, action: "play", maximumMs: 30_000 });
    } else if (phase === "content" && transitionBeforeTarget && choice) {
      effects.push(...beginTransition(choice));
    } else if (!transitionBeforeTarget) {
      state = { ...state, incomingChoice: null, choiceLocked: false };
    }
    effects.push(...progressEffect());
    return effects;
  };
  const finishChoiceFeedback = (choice: StoryChoice) => {
    if (shouldRunTransition(choice, "afterSource")) return beginTransition(choice);
    return enter(choice.targetId, shouldRunTransition(choice, "beforeTarget") ? choice : null);
  };
  const finishPreContent = () => {
    const choice = state.incomingChoice;
    if (choice && shouldRunTransition(choice, "beforeTarget")) return beginTransition(choice);
    state = { ...state, phase: "content", incomingChoice: null, choiceLocked: false };
    return [] as ReadingEffect[];
  };
  const initialEffects: ReadingEffect[] = [];
  const initialCue = input.story.musicCues.find((cue) => cue.startNodeId === state.nodeId);
  if (initialCue) {
    state = { ...state, activeCueId: initialCue.id, activeCueName: initialCue.name };
    initialEffects.push({ kind: "music", action: "start", cue: initialCue });
  }
  if (state.phase === "transitionVideo") {
    if (state.activeCueId) initialEffects.push({ kind: "music", action: "pause" });
    initialEffects.push({ kind: "video", id: `video:${state.nodeId}`, action: "play", maximumMs: 30_000 });
  }
  initialEffects.push(...progressEffect());

  function dispatch(event: ReadingEvent) {
    const effects: ReadingEffect[] = [];
    const node = input.story.nodes.find((item) => item.id === state.nodeId);
    if (!node) return { state, effects };
    if (event.type === "page") {
      const pages = paginateStoryBody(node.body);
      state = { ...state, pageIndex: Math.max(0, Math.min(event.index, pages.length - 1)) };
      effects.push(...progressEffect());
    } else if (event.type === "show-after-image") {
      state = { ...state, phase: "afterImage" };
    } else if (event.type === "continue-image") {
      if (state.phase === "afterImage") {
        state = { ...state, afterImageDone: true, phase: "content" };
      } else {
        const phase = !input.reducedMotion && node.videoMode === "transition" && node.videoUrl && !state.transitionVideoDone
          ? "transitionVideo" : "content";
        state = { ...state, phase };
        if (phase === "transitionVideo") {
          if (state.activeCueId) effects.push({ kind: "music", action: "pause" });
          effects.push({ kind: "video", id: `video:${state.nodeId}`, action: "play", maximumMs: 30_000 });
        } else {
          effects.push(...finishPreContent());
        }
      }
    } else if (event.type === "choose") {
      if (state.choiceLocked || state.activeTransition) return { state, effects };
      const choice = node.choices.find((item) => item.id === event.choiceId);
      if (!choice || !input.story.nodes.some((item) => item.id === choice.targetId)) return { state, effects };
      state = { ...state, choiceLocked: true };
      if (choice.sfxUrl) effects.push({ kind: "play-sfx", id: `sfx:${choice.id}`, url: choice.sfxUrl, volume: choice.sfxVolume, maximumMs: choice.sfxMaxDurationMs });
      if (choice.terminalFeedbackEnabled) {
        const result = applyTerminalTaskEvents(input.story, [...state.terminalEventIds, ...choice.terminalTaskActions.map((action) => action.id)]);
        const playback = {
          id: `${node.id}:${choice.id}`, message: choice.terminalMessage, speak: choice.terminalSpeak,
          voiceUrl: choice.terminalVoiceUrl, reaction: resolveTerminalReaction(choice), interactionPreset: choice.interactionPreset,
          imageUrl: choice.feedbackImageUrl, imageAlt: choice.feedbackImageAlt,
          imagePresentation: choice.feedbackImagePresentation, task: result.task,
        };
        state = {
          ...state, terminalEventIds: result.appliedIds,
          incomingChoice: choice,
        };
        effects.push({ kind: "terminal-feedback", id: `terminal:${playback.id}`, playback, maximumMs: 30_000 });
      } else {
        const duration = choice.feedbackImageUrl
          ? normalizeChoiceImageDuration(choice.feedbackImageDurationMs)
          : input.reducedMotion ? 140 : interactionDuration[choice.interactionPreset];
        state = {
          ...state, choiceFeedback: choice, incomingChoice: choice,
          activeTransition: null,
        };
        effects.push({ kind: "wait", id: `choice:${choice.id}`, milliseconds: duration });
      }
    } else if (event.type === "effect-result" && event.id === `video:${state.nodeId}`
      && state.phase === "transitionVideo" && event.outcome !== "success") {
      state = { ...state, transitionVideoDone: true };
      if (state.activeCueId) effects.push({ kind: "music", action: "resume" });
      effects.push(...finishPreContent());
    } else if (event.type === "effect-result" && event.id.startsWith("choice:")) {
      const choice = state.incomingChoice;
      if (choice && event.id === `choice:${choice.id}`) effects.push(...finishChoiceFeedback(choice));
    } else if (event.type === "effect-result" && event.id.startsWith("terminal:")) {
      const choice = state.incomingChoice;
      if (choice && event.id === `terminal:${node.id}:${choice.id}`) effects.push(...finishChoiceFeedback(choice));
    } else if (event.type === "effect-result" && event.id.startsWith("transition:")) {
      const choice = state.incomingChoice;
      if (choice && event.id === `transition:${choice.id}`) {
        if (choice.transitionPosition === "afterSource") effects.push(...enter(choice.targetId, null));
        else state = { ...state, phase: "content", activeTransition: null, incomingChoice: null, choiceLocked: false };
      }
    } else if (event.type === "complete") {
      state = { ...state, completed: true, choiceLocked: true, activeCueId: null, activeCueName: "" };
      effects.push({ kind: "music", action: "stop" }, ...progressEffect(true), { kind: "complete" });
    }
    return { state, effects };
  }

  return { get state() { return state; }, initialEffects, dispatch };
}
