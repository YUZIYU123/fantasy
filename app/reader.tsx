"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createReadingSession, observeReadingSession, type ReadingEffect, type ReadingEvent, type ReadingState, type SessionTerminalPlayback } from "../lib/reading-session";
import {
  clampMediaVolume,
  normalizeChoiceSfxMaxDuration,
  paginateStoryBody,
  parseReadingProgress,
  type NovelRecord,
  type StoryChoice,
  type StoryDocument,
} from "../lib/story";
import { FantasyTerminal } from "./fantasy-terminal";

type ReaderNovel = NovelRecord & { chapters: unknown[] };

function ReaderEntryState({ kind, onBack }: { kind: "loading" | "empty"; onBack: () => void }) {
  const loading = kind === "loading";
  return <section className="reader reader-loading" aria-busy={loading || undefined}>
    <button className="reader-loading-back" onClick={onBack} aria-label="返回章节目录">←</button>
    <div role={loading ? "status" : "alert"} aria-live={loading ? "polite" : undefined}>
      <span aria-hidden="true">{loading ? "✦" : "!"}</span><p>{loading ? "正在进入章节…" : "章节内容为空。"}</p>
    </div>
  </section>;
}

export function Reader({ story, chapterId, chapterVersion = 0, onBack, onComplete, preview = false, initialNodeId, novels = [], onOpenNovel }: {
  story: StoryDocument;
  chapterId: string;
  chapterVersion?: number;
  onBack: () => void;
  onComplete?: () => void;
  preview?: boolean;
  initialNodeId?: string;
  novels?: ReaderNovel[];
  onOpenNovel?: (id: string) => void;
}) {
  const storageKey = `mist-page-progress:${chapterId}`;
  const sessionRef = useRef<ReturnType<typeof createReadingSession> | null>(null);
  const [state, setState] = useState<ReadingState | null>(null);
  const [muted, setMuted] = useState(false);
  const [terminalDucking, setTerminalDucking] = useState(false);
  const [terminalPlayback, setTerminalPlayback] = useState<SessionTerminalPlayback | null>(null);
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== "undefined"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [needsPlay, setNeedsPlay] = useState(false);
  const music = useRef<HTMLAudioElement>(null);
  const sfx = useRef<HTMLAudioElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const storyPanel = useRef<HTMLElement>(null);
  const activeVideoEffectId = useRef<string | null>(null);
  const activeTerminalEffectId = useRef<string | null>(null);
  const activeCueVolume = useRef(0.55);
  const activeSfxVolume = useRef(0.8);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const dispatchRef = useRef<(event: ReadingEvent) => void>(() => {});
  const executeEffectsRef = useRef<(effects: ReadingEffect[]) => void>(() => {});

  const reportVideoOutcome = useCallback((id: string, outcome: "success" | "complete" | "failure" | "timeout") => {
    const timeoutId = `${id}:timeout`;
    const timeout = timers.current.get(timeoutId);
    if (timeout) clearTimeout(timeout);
    timers.current.delete(timeoutId);
    if (activeVideoEffectId.current !== id) return;
    activeVideoEffectId.current = null;
    setNeedsPlay(false);
    dispatchRef.current({ type: "effect-result", id, outcome });
  }, []);

  const executeEffects = useCallback((effects: ReadingEffect[]) => {
    for (const effect of effects) {
      if (effect.kind === "persist-progress") {
        const { completed, ...progress } = effect.progress;
        localStorage.setItem(storageKey, JSON.stringify(progress));
        fetch("/api/account/progress", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chapterId, ...progress, completed }),
        }).catch(() => {});
      } else if (effect.kind === "wait") {
        const previous = timers.current.get(effect.id);
        if (previous) clearTimeout(previous);
        timers.current.set(effect.id, setTimeout(() => {
          timers.current.delete(effect.id);
          dispatchRef.current({ type: "effect-result", id: effect.id, outcome: "timeout" });
        }, effect.milliseconds));
      } else if (effect.kind === "play-sfx" && sfx.current) {
        sfx.current.pause();
        sfx.current.src = effect.url;
        sfx.current.currentTime = 0;
        activeSfxVolume.current = clampMediaVolume(effect.volume, 0.8);
        sfx.current.volume = muted ? 0 : activeSfxVolume.current;
        sfx.current.play()
          .then(() => dispatchRef.current({ type: "effect-result", id: effect.id, outcome: "success" }))
          .catch(() => dispatchRef.current({ type: "effect-result", id: effect.id, outcome: "failure" }));
        if (effect.maximumMs > 0) {
          const id = `sfx:${effect.url}`;
          timers.current.set(id, setTimeout(() => sfx.current?.pause(), normalizeChoiceSfxMaxDuration(effect.maximumMs)));
        }
      } else if (effect.kind === "music") {
        if (effect.action === "stop") {
          music.current?.pause();
          if (music.current) music.current.removeAttribute("src");
        } else if (effect.action === "pause") {
          music.current?.pause();
        } else if (effect.action === "resume") {
          music.current?.play().catch(() => {});
        } else if (effect.action === "start" && music.current && effect.cue.url) {
          music.current.src = effect.cue.url;
          music.current.loop = effect.cue.loop;
          activeCueVolume.current = clampMediaVolume(effect.cue.volume, 0.55);
          music.current.volume = muted ? 0 : activeCueVolume.current * (terminalDucking ? 0.25 : 1);
          music.current.play().catch(() => {});
        }
      } else if (effect.kind === "video") {
        if (activeVideoEffectId.current) {
          const previousTimeoutId = `${activeVideoEffectId.current}:timeout`;
          const previousTimeout = timers.current.get(previousTimeoutId);
          if (previousTimeout) clearTimeout(previousTimeout);
          timers.current.delete(previousTimeoutId);
        }
        activeVideoEffectId.current = effect.id;
        const timeoutId = `${effect.id}:timeout`;
        timers.current.set(timeoutId, setTimeout(() => {
          reportVideoOutcome(effect.id, "timeout");
        }, effect.maximumMs));
        queueMicrotask(() => video.current?.play()
          .then(() => setNeedsPlay(false))
          .catch(() => {
            setNeedsPlay(true);
          }));
      } else if (effect.kind === "terminal-feedback") {
        activeTerminalEffectId.current = effect.id;
        setTerminalPlayback(effect.playback);
        const timeoutId = `${effect.id}:timeout`;
        const previous = timers.current.get(timeoutId);
        if (previous) clearTimeout(previous);
        timers.current.set(timeoutId, setTimeout(() => {
          timers.current.delete(timeoutId);
          if (activeTerminalEffectId.current !== effect.id) return;
          activeTerminalEffectId.current = null;
          setTerminalPlayback(null);
          dispatchRef.current({ type: "effect-result", id: effect.id, outcome: "timeout" });
        }, effect.maximumMs));
      } else if (effect.kind === "complete") {
        (onComplete || onBack)();
      }
    }
  }, [chapterId, muted, onBack, onComplete, reportVideoOutcome, storageKey, terminalDucking]);

  const dispatch = useCallback((event: ReadingEvent) => {
    const session = sessionRef.current;
    if (!session) return;
    const result = session.dispatch(event);
    setState({ ...result.state });
    executeEffectsRef.current(result.effects);
  }, []);

  useEffect(() => { dispatchRef.current = dispatch; }, [dispatch]);
  useEffect(() => { executeEffectsRef.current = executeEffects; }, [executeEffects]);

  useEffect(() => {
    let cancelled = false;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setReducedMotion(media.matches);
    media.addEventListener("change", updateMotion);
    const install = (cloudProgress: Parameters<typeof createReadingSession>[0]["cloudProgress"]) => {
      if (cancelled) return;
      activeTerminalEffectId.current = null;
      setTerminalPlayback(null);
      const deviceProgress = preview ? null : parseReadingProgress(localStorage.getItem(storageKey), story.startNodeId);
      const session = createReadingSession({
        story, chapterId, chapterVersion, preview, initialNodeId, deviceProgress, cloudProgress, reducedMotion: media.matches,
      });
      sessionRef.current = session;
      setState({ ...session.state });
      queueMicrotask(() => executeEffectsRef.current(session.initialEffects));
    };
    if (preview) install(null);
    else fetch(`/api/account/progress?chapterId=${encodeURIComponent(chapterId)}`)
      .then(async (response) => response.ok ? (await response.json() as { progress?: Parameters<typeof createReadingSession>[0]["cloudProgress"] }).progress ?? null : null)
      .catch(() => null)
      .then(install);
    const timerMap = timers.current;
    const musicNode = music.current;
    const sfxNode = sfx.current;
    return () => {
      cancelled = true;
      media.removeEventListener("change", updateMotion);
      timerMap.forEach(clearTimeout);
      timerMap.clear();
      musicNode?.pause();
      sfxNode?.pause();
    };
  }, [chapterId, chapterVersion, initialNodeId, preview, storageKey, story]);

  useEffect(() => {
    if (music.current) music.current.volume = muted ? 0 : activeCueVolume.current * (terminalDucking ? 0.25 : 1);
    if (sfx.current) sfx.current.volume = muted ? 0 : activeSfxVolume.current;
  }, [muted, terminalDucking]);

  const node = story.nodes.find((item) => item.id === state?.nodeId) || story.nodes[0];
  const pages = useMemo(() => paginateStoryBody(node?.body || ""), [node?.body]);
  if (!state) return <ReaderEntryState kind="loading" onBack={onBack} />;
  if (!node) return <ReaderEntryState kind="empty" onBack={onBack} />;
  const pageIndex = Math.min(state.pageIndex, Math.max(0, pages.length - 1));
  const isLastPage = pageIndex === pages.length - 1;
  const needsAfterImage = node.displayImagePosition === "after" && !state.afterImageDone;
  const sessionView = observeReadingSession(story, state);

  return <section className={`reader animation-${node.animation}`}>
    <audio ref={music} /><audio ref={sfx} />
    {node.imageUrl && <div className="scene-image-layer"><Image src={node.imageUrl} alt={node.imageAlt} fill unoptimized sizes="100vw" style={{ objectFit: node.imagePresentation.fit, objectPosition: `${node.imagePresentation.positionX}% ${node.imagePresentation.positionY}%` }} /></div>}
    <div className="reader-shade" />
    {state.activeTransition && <div className={`choice-transition transition-${state.activeTransition}`} aria-label="剧情转场"><i /><i /></div>}
    {state.choiceFeedback && <ChoiceFeedback choice={state.choiceFeedback} reducedMotion={reducedMotion} />}
    {node.videoMode === "background" && node.videoUrl && <video className="scene-video" src={node.videoUrl} poster={node.imageUrl || undefined} autoPlay muted loop playsInline onError={(event) => { event.currentTarget.style.display = "none"; }} />}
    {state.phase === "transitionVideo" && <div className="transition-video"><video ref={video} src={node.videoUrl} poster={node.imageUrl || undefined} playsInline controls={needsPlay} onEnded={() => activeVideoEffectId.current && reportVideoOutcome(activeVideoEffectId.current, "complete")} onError={() => activeVideoEffectId.current && reportVideoOutcome(activeVideoEffectId.current, "failure")} />{needsPlay && <button onClick={() => { const id = activeVideoEffectId.current; if (!id) return; video.current?.play().then(() => setNeedsPlay(false)).catch(() => reportVideoOutcome(id, "failure")); }}>点击播放</button>}<button className="skip-video" onClick={() => activeVideoEffectId.current && reportVideoOutcome(activeVideoEffectId.current, "complete")}>跳过动画 →</button></div>}
    <header className="reader-nav"><button onClick={onBack} aria-label="返回章节目录">←</button><div><span>{story.title}</span>{state.activeCueName && <small>♫ {state.activeCueName}</small>}</div><button onClick={() => setMuted((value) => !value)} aria-label={muted ? "开启声音" : "静音"}>{muted ? "♩" : "♫"}</button></header>
    {(state.phase === "beforeImage" || state.phase === "afterImage") && <NodeDisplayImage node={node} onContinue={() => dispatch({ type: "continue-image" })} />}
    {state.phase === "content" && <article className="story-panel" ref={storyPanel}><p className="node-kicker">{node.canEndChapter ? "CHAPTER GATE" : "CHAPTER SCENE"}</p><h1>{node.title}</h1><div className="ornament">✦</div><p className="story-body" key={`${node.id}-${pageIndex}`} aria-live="polite">{pages[pageIndex]}</p>
      {pages.length > 1 && <nav className="story-pagination" aria-label="正文分页"><button disabled={pageIndex === 0 || state.choiceLocked} onClick={() => { dispatch({ type: "page", index: pageIndex - 1 }); storyPanel.current?.scrollTo({ top: 0 }); }}>← 上一页</button><span>{pageIndex + 1} / {pages.length}</span><button disabled={isLastPage || state.choiceLocked} onClick={() => { dispatch({ type: "page", index: pageIndex + 1 }); storyPanel.current?.scrollTo({ top: 0 }); }}>下一页 →</button></nav>}
      {isLastPage && needsAfterImage && <div className="choices"><button disabled={state.choiceLocked} onClick={() => dispatch({ type: "show-after-image" })}><span>查看节点图片</span><i>→</i></button></div>}
      {isLastPage && !needsAfterImage && <div className="choices">{node.choices.map((choice) => <button key={choice.id} disabled={state.choiceLocked} onClick={() => dispatch({ type: "choose", choiceId: choice.id })}><span>{choice.label}</span><i>→</i></button>)}{node.canEndChapter && <button className="end-chapter-choice" disabled={state.choiceLocked} onClick={() => dispatch({ type: "complete" })}><span>结束本章</span><i>→</i></button>}</div>}
    </article>}
    <FantasyTerminal
      novels={novels}
      onOpenNovel={onOpenNovel}
      readingContextId={chapterId}
      config={story.terminal}
      event={sessionView.terminalEvent}
      eventKey={`${chapterId}:${node.id}:${node.terminalEvent?.trigger || "none"}`}
      task={sessionView.terminalTask}
      playback={terminalPlayback}
      muted={muted}
      reducedMotion={reducedMotion}
      suppressed={sessionView.terminalSuppressed}
      preview={preview}
      onPlaybackComplete={() => {
        const id = activeTerminalEffectId.current;
        if (!id) return;
        const timeoutId = `${id}:timeout`;
        const timeout = timers.current.get(timeoutId);
        if (timeout) clearTimeout(timeout);
        timers.current.delete(timeoutId);
        activeTerminalEffectId.current = null;
        setTerminalPlayback(null);
        dispatch({ type: "effect-result", id, outcome: "complete" });
      }}
      onDuckingChange={setTerminalDucking}
    />
  </section>;
}

function ChoiceFeedback({ choice, reducedMotion }: { choice: StoryChoice; reducedMotion: boolean }) {
  return <section className={`choice-feedback interaction-${reducedMotion ? "reduced" : choice.interactionPreset}`} aria-label={`选择反馈：${choice.label}`}>
    {choice.feedbackImageUrl && <Image src={choice.feedbackImageUrl} alt={choice.feedbackImageAlt} fill sizes="100vw" unoptimized style={{ objectFit: choice.feedbackImagePresentation.fit, objectPosition: `${choice.feedbackImagePresentation.positionX}% ${choice.feedbackImagePresentation.positionY}%` }} />}
    <div className="choice-feedback-shade" /><div className="choice-feedback-effect"><i /><i /><i /></div><p>{choice.label}</p>
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
    <div className="node-image-shade" /><div className="node-image-copy"><p>{node.displayImagePosition === "before" ? "BEFORE THE SCENE" : "AFTER THE SCENE"}</p><h2>{node.title}</h2><button onClick={onContinue}>继续 <i>→</i></button></div>
  </section>;
}
