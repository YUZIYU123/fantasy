"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyTerminalTaskEvents,
  calculateAudioFadeFrame,
  clampMediaVolume,
  DEFAULT_COVER_PRESENTATION,
  paginateStoryBody,
  parseReadingProgress,
  resolveMusicCueAction,
  normalizeChoiceImageDuration,
  normalizeChoiceSfxMaxDuration,
  type ChapterRecord,
  type ImagePresentation,
  type NovelRecord,
  type StoryChoice,
  type StoryDocument,
  type StoryMusicCue,
  type TransitionPreset,
} from "../lib/story";
import { Brand } from "./brand";
import { FantasyTerminal, type TerminalPlayback } from "./fantasy-terminal";

type PublicChapter = ChapterRecord;
type PublicNovel = NovelRecord & { chapters: PublicChapter[] };
type View = "library" | "novel" | "cover" | "reader" | "outro";

export function StoryStudio() {
  const [view, setView] = useState<View>("library");
  const [novels, setNovels] = useState<PublicNovel[]>([]);
  const [novelId, setNovelId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [busy, setBusy] = useState(true);
  const novel = novels.find((item) => item.id === novelId) ?? null;
  const chapterIndex = novel?.chapters.findIndex((item) => item.id === chapterId) ?? -1;
  const chapter = chapterIndex >= 0 ? novel?.chapters[chapterIndex] ?? null : null;
  const nextChapter = novel && chapterIndex >= 0 ? novel.chapters[chapterIndex + 1] ?? null : null;
  const openRecommendedNovel = (id: string) => {
    if (!novels.some((item) => item.id === id)) return;
    setNovelId(id);
    setView("novel");
  };
  const guide = <FantasyTerminal novels={novels} onOpenNovel={openRecommendedNovel} />;

  const load = useCallback(async () => {
    setBusy(true);
    const response = await fetch("/api/novels");
    const data = await response.json() as { novels?: PublicNovel[] };
    setNovels(data.novels || []);
    setBusy(false);
  }, []);
  useEffect(() => { queueMicrotask(() => load().catch(() => setBusy(false))); }, [load]);

  if (view === "novel" && novel) {
    return <><NovelHome novel={novel} onBack={() => setView("library")} onRead={(selected) => {
      setChapterId(selected.id);
      setView("cover");
    }} />{guide}</>;
  }
  if (view === "cover" && novel?.published && chapter?.published) {
    return <><ChapterCover novel={novel} chapter={chapter} onBack={() => setView("novel")} onStart={() => setView("reader")} />{guide}</>;
  }
  if (view === "reader" && chapter?.published) {
    return <Reader story={chapter.published} chapterId={chapter.id} chapterVersion={chapter.version} novels={novels} onOpenNovel={openRecommendedNovel} onBack={() => setView("novel")} onComplete={() => setView("outro")} />;
  }
  if (view === "outro" && novel?.published && chapter?.published) {
    return <><ChapterOutro novel={novel} chapter={chapter} nextChapter={nextChapter} onBack={() => setView("novel")} onNext={() => {
      if (!nextChapter) return;
      setChapterId(nextChapter.id);
      setView("cover");
    }} />{guide}</>;
  }
  return <><main className="app-shell">{busy && <div className="loading-bar" aria-label="加载中" />}<Library novels={novels} onOpen={(selected) => {
    setNovelId(selected.id);
    setView("novel");
  }} /></main>{guide}</>;
}

function Library({ novels, onOpen }: { novels: PublicNovel[]; onOpen: (novel: PublicNovel) => void }) {
  return <div className="library fantasy-library">
    <header className="topbar"><Brand /><div className="topbar-actions"><a className="ghost link-button" href="/login">登录</a><a className="ghost link-button" href="/studio">作者工作台 ↗</a></div></header>
    <section className="hero"><p className="eyebrow">INTERACTIVE FICTION UNIVERSE</p><h1>穿过裂隙，<br />抵达你的故事宇宙。</h1><p className="hero-copy">每一本小说都是一座世界，每一个选择都在打开新的时间线。</p><div className="portal-orbit" aria-hidden="true"><i /><i /><b>F</b></div><div className="scroll-cue"><span>探索书架</span><i /></div></section>
    <section className="shelf"><div className="section-heading"><div><span>01</span><p>已发布世界</p></div><h2>幻界书架</h2></div>
      <div className="novel-shelf-grid">{novels.map((novel) => <article className="novel-card" key={novel.id}>
        <Artwork src={novel.published?.coverUrl || ""} alt={novel.published?.coverAlt || novel.published?.name || "小说封面"} presentation={novel.published?.coverPresentation} />
        <div className="card-copy"><p>{novel.chapters.length} 个已发布章节</p><h3>{novel.published?.name}</h3><p>{novel.published?.summary}</p><button onClick={() => onOpen(novel)}>进入小说 <span>→</span></button></div>
      </article>)}</div>
      {novels.length === 0 && <div className="empty"><b>新的世界正在构建</b><p>小说与章节发布后，会在这里出现。</p></div>}
    </section>
    <footer><Brand /><p>你的选择，构成世界。</p><a className="text-button" href="/studio">进入作者工作台</a></footer>
  </div>;
}

function NovelHome({ novel, onBack, onRead }: { novel: PublicNovel; onBack: () => void; onRead: (chapter: PublicChapter) => void }) {
  const data = novel.published!;
  return <main className="novel-home">
    <header className="topbar"><Brand /><button className="ghost" onClick={onBack}>← 返回书架</button></header>
    <section className="novel-hero">
      <div className="novel-home-cover"><Artwork src={data.coverUrl} alt={data.coverAlt || data.name} presentation={data.coverPresentation} priority /></div>
      <div className="novel-home-copy"><p>FANTASY ARCHIVE / {String(novel.sortOrder).slice(-4)}</p><h1>{data.name}</h1><span>{data.summary}</span><small>{novel.chapters.length} CHAPTERS ONLINE</small></div>
    </section>
    <section className="chapter-directory"><div className="section-heading"><div><span>02</span><p>章节目录</p></div><h2>选择入口</h2></div>
      {novel.chapters.map((chapter, index) => <button className="directory-row" key={chapter.id} onClick={() => onRead(chapter)}><span>{String(index + 1).padStart(2, "0")}</span><div><b>{chapter.published?.title || chapter.title}</b><small>{chapter.published?.summary || chapter.summary}</small></div><i>→</i></button>)}
    </section>
  </main>;
}

function Artwork({ src, alt, presentation = DEFAULT_COVER_PRESENTATION, priority = false }: {
  src: string;
  alt: string;
  presentation?: ImagePresentation;
  priority?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { queueMicrotask(() => setFailed(false)); }, [src]);
  return <div className={`chapter-artwork ${presentation.fit}${!src || failed ? " fallback" : ""}`}>
    {src && !failed && <Image src={src} alt={alt} fill sizes="100vw" priority={priority} unoptimized onError={() => setFailed(true)} style={{ objectFit: presentation.fit, objectPosition: `${presentation.positionX}% ${presentation.positionY}%` }} />}
    {(!src || failed) && <span aria-hidden="true">F</span>}
  </div>;
}

function ChapterCover({ novel, chapter, onBack, onStart }: { novel: PublicNovel; chapter: PublicChapter; onBack: () => void; onStart: () => void }) {
  const story = chapter.published!;
  const novelData = novel.published!;
  const src = story.openingImageUrl || novelData.coverUrl;
  const alt = story.openingImageAlt || novelData.coverAlt || `${story.title}开场图`;
  const presentation = story.openingImageUrl ? story.openingImagePresentation : novelData.coverPresentation;
  return <main className="chapter-gateway cover-gateway">
    <Artwork src={src} alt={alt} presentation={presentation} priority />
    <div className="gateway-shade" />
    <button className="gateway-back" onClick={onBack} aria-label="返回章节目录">←</button>
    <section className="gateway-copy"><p>{novelData.name}</p><h1>{story.title}</h1><span>{story.summary}</span><button className="gateway-primary" onClick={onStart}>开始阅读 <i>→</i></button></section>
  </main>;
}

function ChapterOutro({ novel, chapter, nextChapter, onBack, onNext }: { novel: PublicNovel; chapter: PublicChapter; nextChapter: PublicChapter | null; onBack: () => void; onNext: () => void }) {
  const story = chapter.published!;
  return <ChapterOutroScreen
    story={story}
    novelName={novel.published?.name || ""}
    backLabel="返回章节目录"
    onBack={onBack}
    onNext={nextChapter ? onNext : undefined}
  />;
}

export function ChapterOutroScreen({ story, novelName, backLabel, onBack, onNext }: {
  story: StoryDocument;
  novelName?: string;
  backLabel: string;
  onBack: () => void;
  onNext?: () => void;
}) {
  return <main className="chapter-gateway outro-gateway">
    <Artwork src={story.outroImageUrl} alt={story.outroImageAlt || `${story.title}收尾图`} presentation={story.outroImagePresentation} />
    <div className="gateway-shade" />
    <section className="gateway-copy"><p>{novelName}</p><h1>{story.title}</h1><span>本章完</span><div className="outro-actions"><button onClick={onBack}>← {backLabel}</button>{onNext && <button className="gateway-primary" onClick={onNext}>阅读下一章 <i>→</i></button>}</div></section>
  </main>;
}

const transitionDuration: Record<TransitionPreset, number> = {
  none: 0, fade: 420, fog: 760, ripple: 680, push: 520, flash: 430,
};
const interactionDuration = {
  none: 350, glow: 480, ripple: 680, shake: 420, flash: 360, glitch: 560, push: 520,
} as const;

type ReaderPhase = "beforeImage" | "transitionVideo" | "transitionEffect" | "content" | "afterImage";

export function Reader({ story, chapterId, chapterVersion = 0, onBack, onComplete, preview = false, initialNodeId, novels = [], onOpenNovel }: {
  story: StoryDocument;
  chapterId: string;
  chapterVersion?: number;
  onBack: () => void;
  onComplete?: () => void;
  preview?: boolean;
  initialNodeId?: string;
  novels?: PublicNovel[];
  onOpenNovel?: (id: string) => void;
}) {
  const startingNodeId = story.nodes.some((node) => node.id === initialNodeId) ? initialNodeId! : story.startNodeId;
  const storageKey = `mist-page-progress:${chapterId}`;
  const initialNode = story.nodes.find((item) => item.id === startingNodeId);
  const initialPhase: ReaderPhase = initialNode?.displayImagePosition === "before"
    ? "beforeImage"
    : initialNode?.videoMode === "transition" && initialNode.videoUrl
      ? "transitionVideo"
      : "content";
  const [nodeId, setNodeId] = useState(startingNodeId);
  const [pageIndex, setPageIndex] = useState(0);
  const [phase, setPhase] = useState<ReaderPhase>(initialPhase);
  const [afterImageDone, setAfterImageDone] = useState(false);
  const [incomingChoice, setIncomingChoice] = useState<StoryChoice | null>(null);
  const [transitionVideoDone, setTransitionVideoDone] = useState(false);
  const [muted, setMuted] = useState(false);
  const [needsPlay, setNeedsPlay] = useState(false);
  const [activeTransition, setActiveTransition] = useState<TransitionPreset | null>(null);
  const [choiceLocked, setChoiceLocked] = useState(false);
  const [choiceFeedback, setChoiceFeedback] = useState<StoryChoice | null>(null);
  const [terminalEventIds, setTerminalEventIds] = useState<string[]>([]);
  const [terminalPlayback, setTerminalPlayback] = useState<TerminalPlayback | null>(null);
  const [terminalDucking, setTerminalDucking] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [progressReady, setProgressReady] = useState(preview);
  const [activeCueName, setActiveCueName] = useState("");
  const audioA = useRef<HTMLAudioElement>(null);
  const audioB = useRef<HTMLAudioElement>(null);
  const sfxAudio = useRef<HTMLAudioElement>(null);
  const activeSfxVolume = useRef(0.8);
  const activeAudioSlot = useRef<0 | 1>(0);
  const activeCue = useRef<StoryMusicCue | null>(null);
  const audioFade = useRef<number | null>(null);
  const pausedForVideo = useRef(false);
  const transitionVideo = useRef<HTMLVideoElement>(null);
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sfxStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const choiceFeedbackFinish = useRef<(() => void) | null>(null);
  const terminalCompletion = useRef<() => void>(() => {});
  const choiceLock = useRef(false);
  const storyPanel = useRef<HTMLElement>(null);
  const node = story.nodes.find((item) => item.id === nodeId) || story.nodes[0];
  const pages = useMemo(() => paginateStoryBody(node?.body || ""), [node?.body]);
  const terminalTaskResult = useMemo(() => applyTerminalTaskEvents(story, terminalEventIds), [story, terminalEventIds]);
  const activePageIndex = Math.min(pageIndex, Math.max(0, pages.length - 1));
  const isLastPage = activePageIndex === pages.length - 1;
  const hasTransitionVideo = Boolean(node?.videoMode === "transition" && node.videoUrl && !reducedMotion);
  const firstPhaseForNode = useCallback((target: typeof node) => {
    if (target?.displayImagePosition === "before") return "beforeImage" as const;
    if (target?.videoMode === "transition" && target.videoUrl && !reducedMotion) return "transitionVideo" as const;
    return "content" as const;
  }, [reducedMotion]);

  const fadeAudio = useCallback((from: HTMLAudioElement | null, to: HTMLAudioElement | null, cue: StoryMusicCue | null, stopOnly = false) => {
    if (audioFade.current) cancelAnimationFrame(audioFade.current);
    const rawDuration = cue?.fadeMs ?? activeCue.current?.fadeMs ?? 500;
    const duration = Number.isFinite(rawDuration) ? Math.max(0, Math.min(5000, rawDuration)) : 500;
    const fromStart = clampMediaVolume(from?.volume ?? 0);
    const target = muted || stopOnly ? 0 : clampMediaVolume(cue?.volume ?? 0.55, 0.55) * (terminalDucking ? 0.25 : 1);
    const startedAt = performance.now();
    const tick = (now: number) => {
      const frame = calculateAudioFadeFrame(fromStart, target, startedAt, now, duration);
      if (from) from.volume = frame.fromVolume;
      if (to) to.volume = frame.toVolume;
      if (frame.progress < 1) audioFade.current = requestAnimationFrame(tick);
      else {
        if (from) { from.pause(); if (!stopOnly) from.removeAttribute("src"); }
        audioFade.current = null;
      }
    };
    audioFade.current = requestAnimationFrame(tick);
  }, [muted, terminalDucking]);

  const stopMusic = useCallback(() => {
    const current = activeAudioSlot.current === 0 ? audioA.current : audioB.current;
    fadeAudio(current, null, activeCue.current, true);
    activeCue.current = null;
    setActiveCueName("");
  }, [fadeAudio]);

  const startMusic = useCallback((cue: StoryMusicCue) => {
    if (activeCue.current?.id === cue.id) return;
    const from = activeAudioSlot.current === 0 ? audioA.current : audioB.current;
    const nextSlot: 0 | 1 = activeAudioSlot.current === 0 ? 1 : 0;
    const to = nextSlot === 0 ? audioA.current : audioB.current;
    if (!to || !cue.url) return;
    to.src = cue.url;
    to.loop = cue.loop;
    to.volume = clampMediaVolume(0);
    to.currentTime = 0;
    to.play().catch(() => {});
    fadeAudio(from, to, cue);
    activeAudioSlot.current = nextSlot;
    activeCue.current = cue;
    setActiveCueName(cue.name);
  }, [fadeAudio]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => () => {
    if (transitionTimer.current) clearTimeout(transitionTimer.current);
    if (sfxStopTimer.current) clearTimeout(sfxStopTimer.current);
    if (audioFade.current) cancelAnimationFrame(audioFade.current);
    audioA.current?.pause();
    audioB.current?.pause();
    sfxAudio.current?.pause();
  }, []);
  useEffect(() => {
    if (preview) return;
    let cancelled = false;
    const local = parseReadingProgress(localStorage.getItem(storageKey), story.startNodeId);
    const apply = (progress: typeof local) => {
      if (cancelled) return;
      const restartFromBeginning = Boolean(progress.completedAt)
        || (typeof progress.version === "number" && progress.version !== chapterVersion);
      const target = restartFromBeginning
        ? story.nodes.find((item) => item.id === story.startNodeId)
        : story.nodes.find((item) => item.id === progress.nodeId);
      if (!target) return;
      setNodeId(target.id);
      setPageIndex(restartFromBeginning ? 0 : progress.pageIndex);
      setTerminalEventIds(restartFromBeginning ? [] : progress.terminalEventIds ?? []);
      setAfterImageDone(false);
      setIncomingChoice(null);
      setTransitionVideoDone(false);
      setPhase(firstPhaseForNode(target));
    };
    apply(local);
    fetch(`/api/account/progress?chapterId=${encodeURIComponent(chapterId)}`).then(async (response) => {
      if (!response.ok) return null;
      const data = await response.json() as { progress?: { nodeId: string; pageIndex: number; terminalEventIds?: string[]; version?: number; updatedAt: string; completedAt?: string | null } | null };
      return data.progress || null;
    }).then((remote) => {
      if (remote && (!local.updatedAt || Date.parse(remote.updatedAt) > Date.parse(local.updatedAt))) apply(remote);
    }).catch(() => {}).finally(() => { if (!cancelled) setProgressReady(true); });
    return () => { cancelled = true; };
  }, [chapterId, chapterVersion, firstPhaseForNode, preview, storageKey, story.nodes, story.startNodeId]);
  useEffect(() => {
    if (preview || !progressReady) return;
    const progress = { nodeId, pageIndex: activePageIndex, terminalEventIds, version: chapterVersion, updatedAt: new Date().toISOString(), completedAt: null };
    localStorage.setItem(storageKey, JSON.stringify(progress));
    fetch("/api/account/progress", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ chapterId, ...progress, completed: false }) }).catch(() => {});
  }, [activePageIndex, chapterId, chapterVersion, nodeId, preview, progressReady, storageKey, terminalEventIds]);
  useEffect(() => {
    if (pageIndex !== activePageIndex) queueMicrotask(() => setPageIndex(activePageIndex));
  }, [activePageIndex, pageIndex]);
  useEffect(() => {
    const starts = story.musicCues.filter((cue) => cue.startNodeId === nodeId);
    if (starts[0]) startMusic(starts[0]);
  }, [nodeId, startMusic, story.musicCues]);
  useEffect(() => {
    const current = activeAudioSlot.current === 0 ? audioA.current : audioB.current;
    if (current && activeCue.current) current.volume = muted ? 0 : clampMediaVolume(activeCue.current.volume, 0.55) * (terminalDucking ? 0.25 : 1);
    if (sfxAudio.current) sfxAudio.current.volume = muted ? 0 : activeSfxVolume.current;
  }, [muted, terminalDucking]);
  useEffect(() => {
    const imagePreloads = node.choices.filter((choice) => choice.feedbackImageUrl).map((choice) => {
      const image = new window.Image();
      image.src = choice.feedbackImageUrl;
      return image;
    });
    const audioPreloads = node.choices.flatMap((choice) => [choice.sfxUrl, choice.terminalVoiceUrl].filter(Boolean)).map((url) => {
      const audio = new Audio();
      audio.preload = "auto";
      audio.src = url;
      return audio;
    });
    return () => {
      imagePreloads.forEach((image) => { image.src = ""; });
      audioPreloads.forEach((audio) => { audio.pause(); audio.removeAttribute("src"); });
    };
  }, [node.choices]);
  useEffect(() => {
    const current = activeAudioSlot.current === 0 ? audioA.current : audioB.current;
    if (phase === "transitionVideo" && current && !current.paused) {
      current.pause();
      pausedForVideo.current = true;
    } else if (phase !== "transitionVideo" && current && pausedForVideo.current) {
      current.play().catch(() => {});
      pausedForVideo.current = false;
    }
  }, [muted, phase]);
  useEffect(() => {
    if (phase !== "transitionVideo" || !transitionVideo.current) return;
    transitionVideo.current.play().catch(() => setNeedsPlay(true));
  }, [nodeId, phase]);
  useEffect(() => {
    choiceLock.current = false;
    queueMicrotask(() => setChoiceLocked(false));
  }, [nodeId]);

  const goToNode = (targetId: string, choice: StoryChoice | null, nextPhase?: ReaderPhase) => {
    const target = story.nodes.find((item) => item.id === targetId);
    if (!target) return;
    setNeedsPlay(false);
    setPageIndex(0);
    setAfterImageDone(false);
    setIncomingChoice(choice);
    setTransitionVideoDone(false);
    setNodeId(targetId);
    setPhase(nextPhase || firstPhaseForNode(target));
  };
  const showOverlay = (preset: TransitionPreset, after?: () => void) => {
    if (preset === "none" || reducedMotion) { after?.(); return; }
    setActiveTransition(preset);
    if (transitionTimer.current) clearTimeout(transitionTimer.current);
    transitionTimer.current = setTimeout(() => {
      setActiveTransition(null);
      after?.();
    }, transitionDuration[preset]);
  };
  const updateMusicForNavigation = (targetId: string) => {
    const action = resolveMusicCueAction(story, node.id, targetId, activeCue.current?.id || null);
    if (action.startCue) startMusic(action.startCue);
    else if (action.stopActive) stopMusic();
  };
  const finishTerminalPlayback = useCallback(() => terminalCompletion.current(), []);
  const choose = (choice: StoryChoice) => {
    if (activeTransition || choiceLock.current) return;
    choiceLock.current = true;
    setChoiceLocked(true);
    const target = story.nodes.find((item) => item.id === choice.targetId);
    if (!target) { choiceLock.current = false; setChoiceLocked(false); return; }
    if (sfxStopTimer.current) clearTimeout(sfxStopTimer.current);
    if (sfxAudio.current) {
      sfxAudio.current.pause();
      sfxAudio.current.removeAttribute("src");
    }
    if (choice.sfxUrl && sfxAudio.current) {
      activeSfxVolume.current = clampMediaVolume(choice.sfxVolume, 0.8);
      sfxAudio.current.src = choice.sfxUrl;
      sfxAudio.current.currentTime = 0;
      sfxAudio.current.volume = muted ? 0 : activeSfxVolume.current;
      sfxAudio.current.play().catch(() => {});
      const maximum = normalizeChoiceSfxMaxDuration(choice.sfxMaxDurationMs);
      if (maximum > 0) sfxStopTimer.current = setTimeout(() => {
        sfxAudio.current?.pause();
        sfxStopTimer.current = null;
      }, maximum);
    }
    if (choice.terminalFeedbackEnabled) {
      const nextTaskResult = applyTerminalTaskEvents(story, [...terminalEventIds, ...choice.terminalTaskActions.map((action) => action.id)]);
      setTerminalEventIds(nextTaskResult.appliedIds);
      terminalCompletion.current = () => {
        setTerminalPlayback(null);
        updateMusicForNavigation(choice.targetId);
        goToNode(choice.targetId, null);
      };
      setTerminalPlayback({
        id: `${node.id}:${choice.id}`,
        message: choice.terminalMessage,
        speak: choice.terminalSpeak,
        voiceUrl: choice.terminalVoiceUrl,
        interactionPreset: choice.interactionPreset,
        imageUrl: choice.feedbackImageUrl,
        imageAlt: choice.feedbackImageAlt,
        imagePresentation: choice.feedbackImagePresentation,
        task: nextTaskResult.task,
      });
      return;
    }
    setChoiceFeedback(choice);
    const hasImage = Boolean(choice.feedbackImageUrl);
    const duration = hasImage
      ? normalizeChoiceImageDuration(choice.feedbackImageDurationMs)
      : reducedMotion ? 140 : interactionDuration[choice.interactionPreset];
    const finishFeedback = () => {
      choiceFeedbackFinish.current = null;
      setChoiceFeedback(null);
      updateMusicForNavigation(choice.targetId);
      goToNode(choice.targetId, null);
    };
    choiceFeedbackFinish.current = finishFeedback;
    if (transitionTimer.current) clearTimeout(transitionTimer.current);
    transitionTimer.current = setTimeout(finishFeedback, duration);
  };
  const handleChoiceImageError = () => {
    if (!choiceFeedbackFinish.current) return;
    if (transitionTimer.current) clearTimeout(transitionTimer.current);
    const fallbackDuration = reducedMotion ? 140 : interactionDuration[choiceFeedback?.interactionPreset || "none"];
    transitionTimer.current = setTimeout(() => choiceFeedbackFinish.current?.(), fallbackDuration);
  };
  const advanceAfterTransitionVideo = () => {
    setNeedsPlay(false);
    setTransitionVideoDone(true);
    if (incomingChoice?.transitionPosition === "afterSource" && node.displayImagePosition === "before") setPhase("beforeImage");
    else if (incomingChoice?.transitionPosition === "beforeTarget") {
      setPhase("transitionEffect");
      showOverlay(incomingChoice.transitionPreset, () => setPhase("content"));
    } else setPhase("content");
  };
  const continueFromBeforeImage = () => {
    if (hasTransitionVideo && !transitionVideoDone) setPhase("transitionVideo");
    else if (incomingChoice?.transitionPosition === "beforeTarget") {
      setPhase("transitionEffect");
      showOverlay(incomingChoice.transitionPreset, () => setPhase("content"));
    } else setPhase("content");
  };
  const completeChapter = () => {
    stopMusic();
    if (sfxStopTimer.current) clearTimeout(sfxStopTimer.current);
    sfxAudio.current?.pause();
    setTerminalPlayback(null);
    setTerminalDucking(false);
    const updatedAt = new Date().toISOString();
    const progress = { nodeId, pageIndex: activePageIndex, terminalEventIds, version: chapterVersion, updatedAt, completedAt: updatedAt };
    if (!preview) {
      localStorage.setItem(storageKey, JSON.stringify(progress));
      fetch("/api/account/progress", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chapterId, ...progress, completed: true }),
      }).catch(() => {});
    }
    (onComplete || onBack)();
  };
  const goToPage = (nextPage: number) => {
    setPageIndex(Math.max(0, Math.min(nextPage, pages.length - 1)));
    storyPanel.current?.scrollTo({ top: 0 });
  };
  if (!node) return <div className="reader"><button onClick={onBack}>返回</button><p>章节内容为空。</p></div>;
  const showTransitionVideo = phase === "transitionVideo" && hasTransitionVideo;
  const showNodeImage = phase === "beforeImage" || phase === "afterImage";
  const needsAfterImage = node.displayImagePosition === "after" && !afterImageDone;
  const terminalEvent = node.terminalEvent?.trigger === "beforeContent" && activePageIndex === 0
    || node.terminalEvent?.trigger === "afterContent" && isLastPage
    ? node.terminalEvent
    : undefined;
  const terminalSuppressed = phase !== "content" || Boolean(activeTransition) || choiceLocked || Boolean(choiceFeedback);

  return <section className={`reader animation-${node.animation}`}>
    <audio ref={audioA} />
    <audio ref={audioB} />
    <audio ref={sfxAudio} />
    {node.imageUrl && <div className="scene-image-layer"><Image src={node.imageUrl} alt={node.imageAlt} fill unoptimized sizes="100vw" style={{ objectFit: node.imagePresentation.fit, objectPosition: `${node.imagePresentation.positionX}% ${node.imagePresentation.positionY}%` }} /></div>}
    <div className="reader-shade" />
    {activeTransition && <div className={`choice-transition transition-${activeTransition}`} aria-label="剧情转场"><i /><i /></div>}
    {choiceFeedback && <ChoiceFeedback choice={choiceFeedback} reducedMotion={reducedMotion} onImageError={handleChoiceImageError} />}
    {node.videoMode === "background" && node.videoUrl && <video className="scene-video" src={node.videoUrl} poster={node.imageUrl || undefined} autoPlay muted loop playsInline onError={(event) => { event.currentTarget.style.display = "none"; }} />}
    {showTransitionVideo && <div className="transition-video"><video ref={transitionVideo} src={node.videoUrl} poster={node.imageUrl || undefined} playsInline controls={!needsPlay} onEnded={advanceAfterTransitionVideo} onError={() => { setPhase("transitionEffect"); showOverlay(incomingChoice?.transitionPreset || "none", () => setPhase("content")); }} />{needsPlay && <button onClick={() => { transitionVideo.current?.play(); setNeedsPlay(false); }}>点击播放</button>}<button className="skip-video" onClick={advanceAfterTransitionVideo}>跳过动画 →</button></div>}
    <header className="reader-nav"><button onClick={onBack} aria-label="返回章节目录">←</button><div><span>{story.title}</span>{activeCueName && <small>♫ {activeCueName}</small>}</div><button onClick={() => setMuted((value) => !value)} aria-label={muted ? "开启声音" : "静音"}>{muted ? "♩" : "♫"}</button></header>
    {showNodeImage && <NodeDisplayImage node={node} onContinue={() => {
      if (phase === "beforeImage") continueFromBeforeImage();
      else { setAfterImageDone(true); setPhase("content"); }
    }} />}
    {phase === "content" && <article className="story-panel" ref={storyPanel}><p className="node-kicker">{node.canEndChapter ? "CHAPTER GATE" : "CHAPTER SCENE"}</p><h1>{node.title}</h1><div className="ornament">✦</div><p className="story-body" key={`${node.id}-${activePageIndex}`} aria-live="polite">{pages[activePageIndex]}</p>
      {pages.length > 1 && <nav className="story-pagination" aria-label="正文分页"><button disabled={activePageIndex === 0 || Boolean(activeTransition) || choiceLocked} onClick={() => goToPage(activePageIndex - 1)}>← 上一页</button><span>{activePageIndex + 1} / {pages.length}</span><button disabled={isLastPage || Boolean(activeTransition) || choiceLocked} onClick={() => goToPage(activePageIndex + 1)}>下一页 →</button></nav>}
      {isLastPage && needsAfterImage && <div className="choices"><button disabled={Boolean(activeTransition) || choiceLocked} onClick={() => setPhase("afterImage")}><span>查看节点图片</span><i>→</i></button></div>}
      {isLastPage && !needsAfterImage && <div className="choices">{node.choices.map((choice) => <button className={choiceFeedback?.id === choice.id ? "choice-active" : ""} key={choice.id} disabled={Boolean(activeTransition) || choiceLocked} onClick={() => choose(choice)}><span>{choice.label}</span><i>→</i></button>)}{node.canEndChapter && <button className="end-chapter-choice" disabled={Boolean(activeTransition) || choiceLocked} onClick={completeChapter}><span>结束本章</span><i>→</i></button>}</div>}
    </article>}
    <FantasyTerminal
      novels={novels}
      onOpenNovel={onOpenNovel}
      config={story.terminal}
      event={terminalEvent}
      eventKey={`${chapterId}:${node.id}:${node.terminalEvent?.trigger || "none"}`}
      task={terminalTaskResult.task}
      playback={terminalPlayback}
      muted={muted}
      reducedMotion={reducedMotion}
      suppressed={terminalSuppressed}
      preview={preview}
      onPlaybackComplete={finishTerminalPlayback}
      onDuckingChange={setTerminalDucking}
    />
  </section>;
}

function ChoiceFeedback({ choice, reducedMotion, onImageError }: { choice: StoryChoice; reducedMotion: boolean; onImageError: () => void }) {
  const [failed, setFailed] = useState(false);
  const hasImage = Boolean(choice.feedbackImageUrl) && !failed;
  return <section className={`choice-feedback interaction-${reducedMotion ? "reduced" : choice.interactionPreset}${hasImage ? " has-image" : ""}`} aria-label={`选择反馈：${choice.label}`}>
    {hasImage && <Image src={choice.feedbackImageUrl} alt={choice.feedbackImageAlt} fill sizes="100vw" unoptimized onError={() => { setFailed(true); onImageError(); }} style={{ objectFit: choice.feedbackImagePresentation.fit, objectPosition: `${choice.feedbackImagePresentation.positionX}% ${choice.feedbackImagePresentation.positionY}%` }} />}
    <div className="choice-feedback-shade" />
    <div className="choice-feedback-effect"><i /><i /><i /></div>
    <p>{choice.label}</p>
  </section>;
}

function NodeDisplayImage({ node, onContinue }: { node: StoryDocument["nodes"][number]; onContinue: () => void }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { queueMicrotask(() => setFailed(false)); }, [node.displayImageUrl]);
  return <section className="node-image-page" aria-label={`${node.title}独立图片页`}>
    <div className={`node-image-artwork ${node.displayImagePresentation.fit}${!node.displayImageUrl || failed ? " fallback" : ""}`}>
      {node.displayImageUrl && !failed && <Image src={node.displayImageUrl} alt={node.displayImageAlt} fill sizes="100vw" unoptimized onError={() => setFailed(true)} style={{ objectFit: node.displayImagePresentation.fit, objectPosition: `${node.displayImagePresentation.positionX}% ${node.displayImagePresentation.positionY}%` }} />}
      {(!node.displayImageUrl || failed) && <div><span aria-hidden="true">F</span><p>{node.displayImageAlt || "图片暂时无法显示"}</p></div>}
    </div>
    <div className="node-image-shade" />
    <div className="node-image-copy"><p>{node.displayImagePosition === "before" ? "BEFORE THE SCENE" : "AFTER THE SCENE"}</p><h2>{node.title}</h2><button onClick={onContinue}>继续 <i>→</i></button></div>
  </section>;
}
