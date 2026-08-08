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

export type ReadingPhase = "beforeImage" | "transitionVideo" | "transitionEffect" | "content" | "afterImage";

export type ReadingEffect =
  | { kind: "persist-progress"; progress: ReadingProgress & { completed: boolean } }
  | { kind: "play-sfx"; id: string; url: string; volume: number; maximumMs: number }
  | { kind: "wait"; id: string; milliseconds: number }
  | { kind: "music"; action: "start"; cue: StoryMusicCue }
  | { kind: "music"; action: "stop" }
  | { kind: "video"; id: string; action: "play" }
  | { kind: "terminal-feedback"; id: string; playback: SessionTerminalPlayback }
  | { kind: "complete" };

export type SessionTerminalPlayback = {
  id: string;
  message: string;
  speak: boolean;
  voiceUrl: string;
  interactionPreset: StoryChoice["interactionPreset"];
  imageUrl: string;
  imageAlt: string;
  imagePresentation: StoryChoice["feedbackImagePresentation"];
  task: ReturnType<typeof applyTerminalTaskEvents>["task"];
};

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
  terminalPlayback: SessionTerminalPlayback | null;
  activeCueId: string | null;
  activeCueName: string;
  completed: boolean;
};

export type ReadingEvent =
  | { type: "page"; index: number }
  | { type: "show-after-image" }
  | { type: "continue-image" }
  | { type: "video-complete" | "video-failure" }
  | { type: "choose"; choiceId: string }
  | { type: "wait-complete"; id: string }
  | { type: "effect-result"; id: string; outcome: "success" | "failure" | "timeout" }
  | { type: "terminal-complete" }
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

const interactionDuration = { none: 350, glow: 480, ripple: 680, shake: 420, flash: 360, glitch: 560, push: 520 } as const;

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
    terminalPlayback: null,
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
  const enter = (targetId: string, choice: StoryChoice | null) => {
    const currentId = state.nodeId;
    const music = resolveMusicCueAction(input.story, currentId, targetId, state.activeCueId);
    state = {
      ...state, nodeId: targetId, pageIndex: 0, phase: firstPhase(targetId), afterImageDone: false,
      incomingChoice: choice, transitionVideoDone: false, activeTransition: null,
      choiceLocked: false, choiceFeedback: null, terminalPlayback: null,
      activeCueId: music.startCue?.id ?? (music.stopActive ? null : state.activeCueId),
      activeCueName: music.startCue?.name ?? (music.stopActive ? "" : state.activeCueName),
    };
    const effects: ReadingEffect[] = [];
    if (music.startCue) effects.push({ kind: "music", action: "start", cue: music.startCue });
    else if (music.stopActive) effects.push({ kind: "music", action: "stop" });
    if (state.phase === "transitionVideo") effects.push({ kind: "video", id: `video:${targetId}`, action: "play" });
    effects.push(...progressEffect());
    return effects;
  };
  const initialEffects: ReadingEffect[] = [];
  const initialCue = input.story.musicCues.find((cue) => cue.startNodeId === state.nodeId);
  if (initialCue) {
    state = { ...state, activeCueId: initialCue.id, activeCueName: initialCue.name };
    initialEffects.push({ kind: "music", action: "start", cue: initialCue });
  }
  if (state.phase === "transitionVideo") initialEffects.push({ kind: "video", id: `video:${state.nodeId}`, action: "play" });
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
      state = state.phase === "afterImage"
        ? { ...state, afterImageDone: true, phase: "content" }
        : { ...state, phase: !input.reducedMotion && node.videoMode === "transition" && node.videoUrl && !state.transitionVideoDone ? "transitionVideo" : "content" };
    } else if (event.type === "video-complete" || event.type === "video-failure") {
      state = { ...state, transitionVideoDone: true, phase: "content" };
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
          voiceUrl: choice.terminalVoiceUrl, interactionPreset: choice.interactionPreset,
          imageUrl: choice.feedbackImageUrl, imageAlt: choice.feedbackImageAlt,
          imagePresentation: choice.feedbackImagePresentation, task: result.task,
        };
        state = {
          ...state, terminalEventIds: result.appliedIds,
          terminalPlayback: playback,
          incomingChoice: choice,
        };
        effects.push({ kind: "terminal-feedback", id: playback.id, playback });
      } else {
        const duration = choice.feedbackImageUrl
          ? normalizeChoiceImageDuration(choice.feedbackImageDurationMs)
          : input.reducedMotion ? 140 : interactionDuration[choice.interactionPreset];
        state = {
          ...state, choiceFeedback: choice, incomingChoice: choice,
          activeTransition: choice.transitionPreset === "none" ? null : choice.transitionPreset,
        };
        effects.push({ kind: "wait", id: `choice:${choice.id}`, milliseconds: duration });
      }
    } else if (event.type === "wait-complete" || event.type === "effect-result" && event.id.startsWith("choice:")) {
      const choice = state.incomingChoice;
      if (choice && event.id === `choice:${choice.id}`) effects.push(...enter(choice.targetId, null));
    } else if (event.type === "terminal-complete") {
      const choice = state.incomingChoice;
      if (choice) effects.push(...enter(choice.targetId, null));
    } else if (event.type === "complete") {
      state = { ...state, completed: true, choiceLocked: true, terminalPlayback: null, activeCueId: null, activeCueName: "" };
      effects.push({ kind: "music", action: "stop" }, ...progressEffect(true), { kind: "complete" });
    }
    return { state, effects };
  }

  return { get state() { return state; }, initialEffects, dispatch };
}
