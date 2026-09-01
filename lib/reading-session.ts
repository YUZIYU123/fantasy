import {
  applyTerminalTaskEvents,
  countStoryCharacters,
  normalizeChoiceImageDuration,
  resolveMusicCueAction,
  STORY_PAGE_BREAK,
  type StoryChoice,
  type StoryDocument,
  type StoryMusicCue,
  type TransitionPreset,
} from "./story.ts";

export type ReadingPagePace = "opening" | "standard";
export type ReadingPageBreakReason = "manual" | "paragraph" | "sentence" | "word" | "hard" | "end";
export type ReadingPageAssessment = "opening-ideal" | "balanced" | "short" | "long" | "hard" | "ending";

export type ReadingPage = {
  text: string;
  characterCount: number;
  pace: ReadingPagePace;
  breakReason: ReadingPageBreakReason;
  assessment: ReadingPageAssessment;
  semanticEnding: boolean;
};

export type ReadingPageInspection = {
  nodeId: string;
  pages: ReadingPage[];
};

export const OPENING_PAGE_POLICY = { minimum: 50, target: 70, maximum: 90, hardMaximum: 120 } as const;
export const STANDARD_PAGE_POLICY = { minimum: 100, target: 120, maximum: 140, hardMaximum: 180 } as const;

const readingGraphemeSegmenter = new Intl.Segmenter("zh-CN", { granularity: "grapheme" });

function readingGraphemes(value: string) {
  return Array.from(readingGraphemeSegmenter.segment(value), (part) => part.segment);
}

function isReadingVisibleCharacter(value: string) {
  return !/^\s+$/u.test(value);
}

type PageCandidate = { index: number; visible: number; reason: Exclude<ReadingPageBreakReason, "manual" | "hard" | "end"> };

function candidatePriority(reason: PageCandidate["reason"]) {
  return reason === "paragraph" ? 0 : reason === "sentence" ? 1 : 2;
}

function splitReadingSection(
  section: string,
  startsAtPage: number,
  opening: boolean,
  manualBoundaryAfter: boolean,
) {
  const characters = readingGraphemes(section);
  const pages: Omit<ReadingPage, "assessment" | "semanticEnding">[] = [];
  let offset = 0;

  while (offset < characters.length) {
    const pageNumber = startsAtPage + pages.length;
    const pace: ReadingPagePace = opening && pageNumber < 3 ? "opening" : "standard";
    const policy = pace === "opening" ? OPENING_PAGE_POLICY : STANDARD_PAGE_POLICY;
    const remainingText = characters.slice(offset).join("");
    const remainingCount = countStoryCharacters(remainingText);
    if (remainingCount <= policy.maximum) {
      pages.push({
        text: remainingText,
        characterCount: remainingCount,
        pace,
        breakReason: manualBoundaryAfter ? "manual" : "end",
      });
      break;
    }

    const candidates: PageCandidate[] = [];
    let visible = 0;
    let hardIndex = characters.length;
    for (let index = offset; index < characters.length; index += 1) {
      const character = characters[index];
      if (isReadingVisibleCharacter(character)) visible += 1;
      const reason = character === "\n"
        ? "paragraph"
        : /[。！？；.!?…]/u.test(character)
          ? "sentence"
          : /^\s+$/u.test(character)
            ? "word"
            : null;
      if (reason === "sentence") {
        let candidateIndex = index + 1;
        let candidateVisible = visible;
        while (candidateIndex < characters.length && /^[”’」』）】》〉〕〗〙〛]/u.test(characters[candidateIndex])) {
          if (isReadingVisibleCharacter(characters[candidateIndex])) candidateVisible += 1;
          candidateIndex += 1;
        }
        candidates.push({ index: candidateIndex, visible: candidateVisible, reason });
      } else if (reason) {
        candidates.push({ index: index + 1, visible, reason });
      }
      if (visible >= policy.hardMaximum) {
        hardIndex = index + 1;
        break;
      }
    }

    const preferred = candidates.filter((candidate) => (
      candidate.visible >= policy.minimum && candidate.visible <= policy.maximum
    )).sort((left, right) => (
      candidatePriority(left.reason) - candidatePriority(right.reason)
      || Math.abs(left.visible - policy.target) - Math.abs(right.visible - policy.target)
      || left.index - right.index
    ));
    const fallback = candidates.filter((candidate) => (
      candidate.visible > policy.maximum && candidate.visible <= policy.hardMaximum
    )).sort((left, right) => (
      candidatePriority(left.reason) - candidatePriority(right.reason)
      || left.visible - right.visible
      || left.index - right.index
    ));
    const selected = preferred[0] ?? fallback[0];
    const splitAt = selected?.index ?? hardIndex;
    const text = characters.slice(offset, splitAt).join("");
    const isSectionEnd = splitAt === characters.length;
    pages.push({
      text,
      characterCount: countStoryCharacters(text),
      pace,
      breakReason: isSectionEnd
        ? manualBoundaryAfter ? "manual" : "end"
        : selected?.reason ?? "hard",
    });
    offset = splitAt;
  }

  return pages;
}

export function inspectReadingPages(story: StoryDocument, nodeId: string): ReadingPageInspection {
  const node = story.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return { nodeId, pages: [] };
  const sections = node.body.split(STORY_PAGE_BREAK)
    .filter((section) => countStoryCharacters(section) > 0);
  const rawPages = sections.length === 0
    ? [{ text: "", characterCount: 0, pace: nodeId === story.startNodeId ? "opening" as const : "standard" as const, breakReason: "end" as const }]
    : sections.flatMap((section, index) => splitReadingSection(
      section,
      sections.slice(0, index).reduce((total, prior) => total + splitReadingSection(
        prior,
        total,
        nodeId === story.startNodeId,
        true,
      ).length, 0),
      nodeId === story.startNodeId,
      index < sections.length - 1,
    ));
  const pages = rawPages.map((page, index): ReadingPage => {
    const policy = page.pace === "opening" ? OPENING_PAGE_POLICY : STANDARD_PAGE_POLICY;
    const isLastPage = index === rawPages.length - 1;
    const assessment: ReadingPageAssessment = page.breakReason === "hard"
      ? "hard"
      : isLastPage
        ? "ending"
        : page.characterCount < policy.minimum
          ? "short"
          : page.characterCount > policy.maximum
            ? "long"
            : page.pace === "opening" ? "opening-ideal" : "balanced";
    const semanticEnding = page.breakReason === "paragraph" || page.breakReason === "sentence" || page.breakReason === "end"
      || page.breakReason === "manual" && /(?:\n|[。！？；.!?…][”’」』）】》〉〕〗〙〛]*)\s*$/u.test(page.text);
    return { ...page, assessment, semanticEnding };
  });
  return { nodeId, pages };
}

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
  const pages = inspectReadingPages(story, state.nodeId).pages;
  const pageIndex = Math.min(state.pageIndex, Math.max(0, pages.length - 1));
  const isLastPage = pageIndex === pages.length - 1;
  const terminalEvent = node && (node.terminalEvent?.trigger === "beforeContent" && pageIndex === 0
    || node.terminalEvent?.trigger === "afterContent" && isLastPage) ? node.terminalEvent : undefined;
  return {
    currentPage: pages[pageIndex],
    pageIndex,
    totalPages: pages.length,
    isLastPage,
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
  const restoredPageCount = inspectReadingPages(input.story, nodeId).pages.length;
  const restoredPageIndex = resumed
    ? Math.max(0, Math.min(progress.pageIndex || 0, Math.max(0, restoredPageCount - 1)))
    : 0;
  const firstPhase = (targetId: string): ReadingPhase => {
    const node = input.story.nodes.find((item) => item.id === targetId);
    if (node?.displayImagePosition === "before") return "beforeImage";
    if (!input.reducedMotion && node?.videoMode === "transition" && node.videoUrl) return "transitionVideo";
    return "content";
  };
  let state: ReadingState = {
    nodeId,
    pageIndex: restoredPageIndex,
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
      const pages = inspectReadingPages(input.story, node.id).pages;
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
