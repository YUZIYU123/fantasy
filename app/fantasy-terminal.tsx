"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { TerminalReaction } from "../lib/reading-session";
import {
  DEFAULT_STORY_TERMINAL,
  type ImagePresentation,
  type InteractionPreset,
  type StoryTerminalConfig,
  type StoryTerminalEvent,
  type TerminalTask,
} from "../lib/story";
import {
  getTerminalMessageTiming,
  normalizeReaderPreferences,
  recommendNovels,
  READER_PREFERENCE_OPTIONS,
  TERMINAL_BOOT_DURATION_MS,
  TERMINAL_COLLAPSE_DURATION_MS,
  type ReaderPreference,
  type RecommendableNovel,
} from "../lib/terminal";
import { normalizeRegistrationIntent, type RegistrationIntent } from "../lib/registration-intent";
import {
  browserRegistrationInvitationStore,
  registrationInvitationCopy,
  registrationInvitationHref,
} from "../lib/registration-invitation";
import { fallbackXiaowuImage, xiaowuAppearanceAsset } from "./xiaowu/assets";

type TerminalUser = { displayName: string; role: string };
type TerminalSection = "home" | "preferences" | "message" | "task" | "playback" | "registration" | "resume";
type TerminalPlaybackPhase = "boot" | "message" | "collapse";
type NarrationMode = "audio" | "device" | "text";

export type TerminalPlayback = {
  id: string;
  message: string;
  speak: boolean;
  voiceUrl: string;
  interactionPreset: InteractionPreset;
  imageUrl: string;
  imageAlt: string;
  imagePresentation: ImagePresentation;
  task: TerminalTask;
  reaction?: TerminalReaction;
};

const taskStatusLabels = { active: "进行中", completed: "已完成", failed: "已失败" } as const;

function XiaowuPortrait({ src, state }: { src: string; state: "idle" | "greeting" | "notice" | "success" | "warning" }) {
  // The five local WebP states are already losslessly compressed to their exact display budget.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" width={320} height={320} draggable={false} onError={(event) => fallbackXiaowuImage(event.currentTarget, state)} />;
}

function selectDeviceVoice(voices: SpeechSynthesisVoice[]) {
  const chinese = voices.filter((voice) => /^zh([_-]|$)/i.test(voice.lang));
  const preferredName = /(xiaoxiao|ting|meijia|huihui|yaoyao|yunxi|chinese|mandarin|中文|普通话)/i;
  return chinese.find((voice) => preferredName.test(voice.name))
    ?? chinese.find((voice) => voice.localService)
    ?? chinese[0]
    ?? voices.find((voice) => preferredName.test(voice.name))
    ?? null;
}

export function FantasyTerminal({
  novels = [],
  onOpenNovel,
  readingContextId = "",
  config = DEFAULT_STORY_TERMINAL,
  event,
  eventKey = "",
  task,
  playback,
  muted = false,
  reducedMotion: reducedMotionOverride,
  suppressed = false,
  preview = false,
  onPlaybackComplete,
  onDuckingChange,
  open: controlledOpen,
  onOpenChange,
  launcher = "default",
  returnFocusRef,
}: {
  novels?: RecommendableNovel[];
  onOpenNovel?: (id: string) => void;
  readingContextId?: string;
  config?: StoryTerminalConfig;
  event?: StoryTerminalEvent;
  eventKey?: string;
  task?: TerminalTask;
  playback?: TerminalPlayback | null;
  muted?: boolean;
  reducedMotion?: boolean;
  suppressed?: boolean;
  preview?: boolean;
  onPlaybackComplete?: () => void;
  onDuckingChange?: (ducking: boolean) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  launcher?: "default" | "hidden";
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const [systemReducedMotion, setSystemReducedMotion] = useState(() =>
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const syncPreference = () => setSystemReducedMotion(query.matches);
    syncPreference();
    query.addEventListener?.("change", syncPreference);
    return () => query.removeEventListener?.("change", syncPreference);
  }, []);
  const reducedMotion = reducedMotionOverride ?? systemReducedMotion;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = useCallback((next: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  }, [controlledOpen, onOpenChange]);
  const [section, setSection] = useState<TerminalSection>("home");
  const [signal, setSignal] = useState(false);
  const [activeMessage, setActiveMessage] = useState<StoryTerminalEvent | null>(null);
  const [user, setUser] = useState<TerminalUser | null>(null);
  const [preferences, setPreferences] = useState<ReaderPreference[]>([]);
  const [cloudPreferencesEnabled, setCloudPreferencesEnabled] = useState(false);
  const [companionAppearance, setCompanionAppearance] = useState("default");
  const [registrationIntent, setRegistrationIntent] = useState<RegistrationIntent | null>(null);
  const [resumeIntent, setResumeIntent] = useState<RegistrationIntent | null>(null);
  const [ready, setReady] = useState(false);
  const [playbackPhase, setPlaybackPhase] = useState<TerminalPlaybackPhase>("boot");
  const [revealedMessage, setRevealedMessage] = useState("");
  const [needsVoicePlay, setNeedsVoicePlay] = useState(false);
  const [narrationMode, setNarrationMode] = useState<NarrationMode>("text");
  const proactiveCount = useRef(0);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const playbackAudio = useRef<HTMLAudioElement>(null);
  const speechUtterance = useRef<SpeechSynthesisUtterance | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const finishing = useRef(false);
  const playbackGeneration = useRef(0);
  const narrationToken = useRef(0);
  const messageMinimumUntil = useRef(0);
  const playbackRef = useRef(playback);
  const configRef = useRef(config);
  const mutedRef = useRef(muted);
  const reducedMotionRef = useRef(reducedMotion);
  const onPlaybackCompleteRef = useRef(onPlaybackComplete);
  const onDuckingChangeRef = useRef(onDuckingChange);
  useEffect(() => {
    playbackRef.current = playback;
    configRef.current = config;
    mutedRef.current = muted;
    reducedMotionRef.current = reducedMotion;
    onPlaybackCompleteRef.current = onPlaybackComplete;
    onDuckingChangeRef.current = onDuckingChange;
  }, [config, muted, onDuckingChange, onPlaybackComplete, playback, reducedMotion]);
  const recommendations = useMemo(() => recommendNovels(novels, preferences), [novels, preferences]);
  const activeTask = playback?.task ?? task;
  const completedObjectives = activeTask?.objectives.filter((objective) => objective.status === "completed").length ?? 0;

  const closeTerminal = useCallback(() => {
    setOpen(false);
    queueMicrotask(() => (returnFocusRef?.current ?? launcherRef.current)?.focus());
  }, [returnFocusRef, setOpen]);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    const intent = normalizeRegistrationIntent({ kind: params.get("resume"), targetId: params.get("target") });
    if (!intent) return;
    queueMicrotask(() => {
      setResumeIntent(intent);
      setSection("resume");
      setOpen(true);
    });
  }, [setOpen, user]);
  const stopNarration = useCallback(() => {
    narrationToken.current += 1;
    const audio = playbackAudio.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    speechUtterance.current = null;
  }, []);
  const finishPlayback = useCallback(() => {
    if (!playbackRef.current || finishing.current) return;
    finishing.current = true;
    clearTimers();
    stopNarration();
    setNeedsVoicePlay(false);
    setRevealedMessage(playbackRef.current.message);
    setPlaybackPhase("collapse");
    onDuckingChangeRef.current?.(false);
    timers.current.push(setTimeout(() => {
      closeTerminal();
      setSection("home");
      setPlaybackPhase("boot");
      setRevealedMessage("");
      finishing.current = false;
      onPlaybackCompleteRef.current?.();
    }, reducedMotionRef.current ? 0 : TERMINAL_COLLAPSE_DURATION_MS));
  }, [clearTimers, closeTerminal, stopNarration]);
  const finishAfterMinimum = useCallback(() => {
    const remaining = Math.max(0, messageMinimumUntil.current - Date.now());
    if (remaining === 0) finishPlayback();
    else timers.current.push(setTimeout(finishPlayback, remaining));
  }, [finishPlayback]);
  const scheduleTextFallback = useCallback((duration: number) => {
    setNarrationMode("text");
    timers.current.push(setTimeout(finishAfterMinimum, duration));
  }, [finishAfterMinimum]);
  const speakWithDevice = useCallback((message: string, token: number) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") return false;
    try {
      const synthesis = window.speechSynthesis;
      synthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(message);
      utterance.lang = "zh-CN";
      utterance.rate = 0.98;
      utterance.pitch = 1.08;
      utterance.volume = mutedRef.current ? 0 : Math.max(0, Math.min(1, configRef.current.volume));
      utterance.voice = selectDeviceVoice(synthesis.getVoices());
      utterance.onend = () => { if (token === narrationToken.current) finishAfterMinimum(); };
      utterance.onerror = () => {
        if (token !== narrationToken.current) return;
        setNeedsVoicePlay(true);
        scheduleTextFallback(getTerminalMessageTiming(message, reducedMotionRef.current).fallbackDurationMs);
      };
      speechUtterance.current = utterance;
      setNarrationMode("device");
      synthesis.speak(utterance);
      return true;
    } catch {
      return false;
    }
  }, [finishAfterMinimum, scheduleTextFallback]);
  const startNarration = useCallback(async () => {
    const current = playbackRef.current;
    if (!current) return;
    const timing = getTerminalMessageTiming(current.message, reducedMotionRef.current);
    const token = ++narrationToken.current;
    setNeedsVoicePlay(false);
    if (!current.speak) {
      scheduleTextFallback(timing.fallbackDurationMs);
      return;
    }
    const audio = playbackAudio.current;
    if (current.voiceUrl && audio) {
      try {
        audio.src = current.voiceUrl;
        audio.currentTime = 0;
        audio.volume = mutedRef.current ? 0 : Math.max(0, Math.min(1, configRef.current.volume));
        setNarrationMode("audio");
        await audio.play();
        return;
      } catch {
        audio.pause();
        audio.removeAttribute("src");
      }
    }
    if (!speakWithDevice(current.message, token)) {
      setNeedsVoicePlay(true);
      scheduleTextFallback(timing.fallbackDurationMs);
    }
  }, [scheduleTextFallback, speakWithDevice]);
  const playPassiveEventVoice = useCallback((terminalEvent: StoryTerminalEvent) => {
    if (!terminalEvent.speak || !terminalEvent.message.trim()) return;
    stopNarration();
    const token = ++narrationToken.current;
    const audio = playbackAudio.current;
    if (terminalEvent.voiceUrl && audio) {
      audio.src = terminalEvent.voiceUrl;
      audio.currentTime = 0;
      audio.volume = mutedRef.current ? 0 : Math.max(0, Math.min(1, configRef.current.volume));
      audio.play().catch(() => { speakWithDevice(terminalEvent.message, token); });
    } else {
      speakWithDevice(terminalEvent.message, token);
    }
  }, [speakWithDevice, stopNarration]);

  useEffect(() => {
    let savedPreferences: ReaderPreference[] = [];
    try { savedPreferences = normalizeReaderPreferences(JSON.parse(localStorage.getItem("fantasy-reader-preferences") || "[]")); } catch {}
    queueMicrotask(() => { setPreferences(savedPreferences); setReady(true); });
    fetch("/api/auth/me").then(async (response) => response.ok
      ? await response.json() as { user?: TerminalUser | null }
      : { user: null })
      .then((data) => {
        setUser(data.user || null);
        if (!data.user) return;
        fetch("/api/account/companion").then((response) => response.ok
          ? response.json() as Promise<{ state?: { equippedAppearance?: string } }>
          : { state: undefined })
          .then((result) => setCompanionAppearance(result.state?.equippedAppearance || "default"))
          .catch(() => {});
        fetch("/api/account/guide-memory").then((response) => response.ok
          ? response.json() as Promise<{ memory?: { preferences?: unknown; guideCompletedAt?: string | null } }>
          : { memory: undefined })
          .then((result) => {
            if (!result.memory?.guideCompletedAt) return;
            const cloudPreferences = normalizeReaderPreferences(result.memory.preferences);
            setPreferences(cloudPreferences);
            setCloudPreferencesEnabled(true);
            localStorage.setItem("fantasy-reader-preferences", JSON.stringify(cloudPreferences));
          }).catch(() => {});
      }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!eventKey || !event?.message.trim() || event.trigger === "none" || suppressed || playback) return;
    const seenKey = `fantasy-terminal-seen:${eventKey}`;
    if (!preview && sessionStorage.getItem(seenKey)) return;
    if (!preview && proactiveCount.current >= 3) return;
    const timer = setTimeout(() => {
      if (!preview) sessionStorage.setItem(seenKey, "1");
      if (!preview) proactiveCount.current += 1;
      setActiveMessage(event);
      setSection("message");
      setSignal(true);
      if (event.speak && config.autoSpeak) playPassiveEventVoice(event);
    }, 360);
    return () => clearTimeout(timer);
  }, [config.autoSpeak, event, eventKey, playback, playPassiveEventVoice, preview, suppressed]);

  useEffect(() => {
    if (!suppressed || playback || !open) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setSection("home");
      setSignal(false);
      setOpen(false);
    });
    return () => { active = false; };
  }, [open, playback, setOpen, suppressed]);

  useEffect(() => {
    if (!playback) return;
    const generation = ++playbackGeneration.current;
    clearTimers();
    stopNarration();
    finishing.current = false;
    onDuckingChangeRef.current?.(true);
    queueMicrotask(() => {
      if (generation !== playbackGeneration.current || !playbackRef.current) return;
      setOpen(true);
      setSignal(false);
      setSection("playback");
      setPlaybackPhase("boot");
      setRevealedMessage("");
      setNeedsVoicePlay(false);
      setNarrationMode("text");
      const bootDuration = reducedMotion ? 0 : TERMINAL_BOOT_DURATION_MS;
      timers.current.push(setTimeout(() => {
        const current = playbackRef.current;
        if (!current || generation !== playbackGeneration.current) return;
        const characters = Array.from(current.message);
        const timing = getTerminalMessageTiming(current.message, reducedMotionRef.current);
        setPlaybackPhase("message");
        messageMinimumUntil.current = Date.now() + Math.max(900, timing.revealDurationMs + 450);
        if (timing.revealStepMs === 0) setRevealedMessage(current.message);
        else {
          let visible = 0;
          const revealTimer = setInterval(() => {
            visible += 1;
            setRevealedMessage(characters.slice(0, visible).join(""));
            if (visible >= characters.length) clearInterval(revealTimer);
          }, timing.revealStepMs);
          timers.current.push(revealTimer);
        }
        void startNarration();
      }, bootDuration));
    });
    return () => {
      playbackGeneration.current += 1;
      clearTimers();
      stopNarration();
      onDuckingChangeRef.current?.(false);
    };
  }, [clearTimers, playback, reducedMotion, setOpen, startNarration, stopNarration]);

  useEffect(() => {
    const audio = playbackAudio.current;
    if (audio) audio.volume = muted ? 0 : Math.max(0, Math.min(1, config.volume));
    if (speechUtterance.current) speechUtterance.current.volume = muted ? 0 : Math.max(0, Math.min(1, config.volume));
  }, [config.volume, muted]);
  useEffect(() => () => { clearTimers(); stopNarration(); onDuckingChangeRef.current?.(false); }, [clearTimers, stopNarration]);

  if (!config.enabled || (suppressed && !playback)) return null;
  const displayedEvent = activeMessage ?? event;
  const togglePreference = (preference: ReaderPreference) => {
    const next = preferences.includes(preference)
      ? preferences.filter((item) => item !== preference)
      : [...preferences, preference].slice(-6);
    setPreferences(next);
    localStorage.setItem("fantasy-reader-preferences", JSON.stringify(next));
    if (cloudPreferencesEnabled) void fetch("/api/account/guide-memory", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ preferences: next, completeGuide: true }),
    }).catch(() => {});
  };
  const openTask = () => { setSection("task"); setSignal(false); setOpen(true); };
  const inviteToRegister = (intent: RegistrationIntent) => {
    setRegistrationIntent(intent);
    setSection("registration");
    setOpen(true);
  };
  const collapseTarget = activeTask?.title ? "task" : "fab";
  const narrationLabel = narrationMode === "audio" ? "AI VOICE" : narrationMode === "device" ? "DEVICE VOICE" : "TEXT MODE";
  const legacyName = config.name.trim();
  const customName = legacyName && legacyName !== "幻界终端" && legacyName !== "小雾" ? legacyName : "";
  const reaction: TerminalReaction = playback?.reaction ?? "notice";
  const companionState = playback
    ? reaction
    : signal || section === "message"
      ? "notice"
      : open
        ? "greeting"
        : "idle";
  const companionImage = xiaowuAppearanceAsset(companionAppearance, companionState);
  const companionClassName = `xiaowu-companion state-${companionState}${open ? " is-open" : " is-peeking"}`;
  const openFromCompanion = () => {
    setSection(signal ? "message" : "home");
    setSignal(false);
    setOpen(true);
  };

  const terminal = <aside
    className={`fantasy-terminal xiaowu-terminal${open ? " open" : ""}${playback ? ` xiaowu-playing interaction-${playback.interactionPreset} collapse-to-${collapseTarget}` : ""}`}
    aria-live={playback ? "off" : "polite"}
  >
    <audio
      ref={playbackAudio}
      onEnded={() => playbackRef.current && narrationMode === "audio" && finishAfterMinimum()}
      onError={() => {
        const current = playbackRef.current;
        if (!current || narrationMode !== "audio" || finishing.current) return;
        const token = ++narrationToken.current;
        if (!speakWithDevice(current.message, token)) scheduleTextFallback(getTerminalMessageTiming(current.message, reducedMotionRef.current).fallbackDurationMs);
      }}
    />
    {launcher !== "hidden" ? <button
      ref={launcherRef}
      className={companionClassName}
      type="button"
      aria-label={open ? "收起小雾" : "打开小雾"}
      aria-expanded={open}
      aria-controls="xiaowu-dialog"
      onClick={() => open ? closeTerminal() : openFromCompanion()}
    ><XiaowuPortrait src={companionImage} state={companionState} /></button> : open ? <div className={companionClassName} aria-hidden="true"><XiaowuPortrait src={companionImage} state={companionState} /></div> : null}
    {launcher !== "hidden" && signal && !open && <button className="xiaowu-signal" onClick={openFromCompanion}><small>小雾发现了新消息</small><span>{displayedEvent?.message}</span></button>}
    {launcher !== "hidden" && !open && config.idleMode === "topTask" && activeTask?.title ? <button className={`xiaowu-task-strip status-${activeTask.status}`} onClick={openTask}><strong>{activeTask.title}</strong><small>{completedObjectives}/{activeTask.objectives.length} · {taskStatusLabels[activeTask.status]}</small></button> : null}
    {open && <section id="xiaowu-dialog" className={`xiaowu-dialog terminal-phase-${playbackPhase}${playback ? " xiaowu-playback" : ""}`} role="dialog" aria-modal={playback ? true : undefined} aria-label="小雾对话">
      {playback?.imageUrl && section === "playback" && <div className="xiaowu-playback-art"><Image src={playback.imageUrl} alt={playback.imageAlt} fill unoptimized sizes="340px" style={{ objectFit: playback.imagePresentation.fit, objectPosition: `${playback.imagePresentation.positionX}% ${playback.imagePresentation.positionY}%` }} /></div>}
      <header><div><strong>小雾</strong>{customName && <small>{customName}</small>}</div>{section === "playback" ? <button aria-label="跳过小雾反馈" onClick={finishPlayback}>跳过</button> : <button aria-label="收起小雾" onClick={closeTerminal}>×</button>}</header>
      {section === "playback" && playback ? <div className="terminal-playback-message">
        {playbackPhase === "boot" ? <div className="xiaowu-arriving" aria-hidden="true"><small>小雾正在赶来</small><i>任务与语音同步中…</i></div> : <>
          <small>小雾反馈 · {narrationLabel}</small>
          <p aria-hidden="true">{revealedMessage}<i className="terminal-caret" /></p>
          <span className="sr-only" aria-live="assertive">{playback.message}</span>
          {activeTask?.title && <TaskDetails task={activeTask} compact />}
          {needsVoicePlay && <button type="button" onClick={() => void startNarration()}>重新尝试播报</button>}
        </>}
      </div> : section === "message" && displayedEvent ? <div className="terminal-message"><span>小雾 · 新发现</span><p>{displayedEvent.message}</p><div>{displayedEvent.speak && <button onClick={() => playPassiveEventVoice(displayedEvent)}>♫ 播放小雾语音</button>}<button onClick={() => setSection("home")}>和小雾聊聊</button></div></div> : section === "task" && activeTask ? <div className="terminal-task-panel"><button className="terminal-back" onClick={() => setSection("home")}>← 返回</button><TaskDetails task={activeTask} /></div> : section === "registration" && registrationIntent ? <div className="terminal-message registration-invitation"><span>小雾 · 账号邀请</span><p>{registrationInvitationCopy(registrationIntent)}</p><div><a className="primary link-button" href={registrationInvitationHref(registrationIntent)}>建立账号</a><button onClick={() => { browserRegistrationInvitationStore.dismissProactiveInvitation(); setSection("home"); }}>暂时不用</button></div></div> : section === "resume" && resumeIntent ? <div className="terminal-message registration-invitation"><span>小雾 · 旅程已接续</span><p>{resumeIntent.kind === "bookshelf" ? "账号已经建立。你可以回到目标小说，再确认是否加入书架。" : "账号已经建立。回到阅读界面后，可以确认并同步这段进度。"}</p><div><button onClick={() => { if (resumeIntent.kind === "bookshelf" && resumeIntent.targetId) onOpenNovel?.(resumeIntent.targetId); window.history.replaceState({}, "", window.location.pathname); setSection("home"); }}>回到刚才的位置</button></div></div> : section === "preferences" ? <div className="terminal-preferences"><button className="terminal-back" onClick={() => setSection("home")}>← 返回</button><h3>你想进入怎样的世界？</h3><p>选择最多六项，偏好只保存在当前设备。</p><div>{READER_PREFERENCE_OPTIONS.map((item) => <button className={preferences.includes(item) ? "selected" : ""} key={item} onClick={() => togglePreference(item)}>{item}</button>)}</div><h4>为你推荐</h4>{recommendations.length ? recommendations.map((novel) => <div key={novel.id}><button className="terminal-recommendation" onClick={() => onOpenNovel?.(novel.id)}><span>{novel.published?.name}</span><i>→</i></button>{!user && <button onClick={() => inviteToRegister({ kind: "bookshelf", targetId: novel.id })}>加入书架</button>}</div>) : <small>书架暂时还没有已发布小说。</small>}</div> : <div className="terminal-home">
        <p>{ready && user ? `欢迎回来，${user.displayName}。小雾已经同步你的身份。` : "旅人，要让我替你记住进度，并在不同设备继续吗？"}</p>
        {!user && <><div className="terminal-auth"><button onClick={() => inviteToRegister({ kind: "cross-device" })}>跨设备继续</button><a href="/login?next=/">登录</a></div>{readingContextId && <button className="terminal-menu" onClick={() => inviteToRegister({ kind: "progress", targetId: readingContextId })}><span>◇ 同步当前阅读进度<small>在其他设备继续这段旅程</small></span><i>→</i></button>}</>}
        {activeTask?.title && <button className="terminal-menu" onClick={openTask}><span>⌁ 当前任务<small>{activeTask.title} · {completedObjectives}/{activeTask.objectives.length}</small></span><i>→</i></button>}
        <button className="terminal-menu" onClick={() => setSection("preferences")}><span>◇ 偏好与小说推荐<small>{preferences.length ? `已选择 ${preferences.join("、")}` : "回答几个问题，寻找适合你的世界"}</small></span><i>→</i></button>
        <a className="terminal-menu xiaowu-garden-link" href="/xiaowu"><span>✦ 前往雾庭<small>在世界树下陪伴小雾成长</small></span><i>→</i></a>
        {config.voiceName && <small>AI VOICE · {config.voiceName}</small>}
      </div>}
    </section>}
  </aside>;

  return terminal;
}

function TaskDetails({ task, compact = false }: { task: TerminalTask; compact?: boolean }) {
  const completed = task.objectives.filter((objective) => objective.status === "completed").length;
  return <section className={`terminal-task-details${compact ? " compact" : ""}`}><header><span>{taskStatusLabels[task.status]}</span><b>{task.title}</b><small>{completed} / {task.objectives.length}</small></header>{task.description && <p>{task.description}</p>}<ul>{task.objectives.map((objective) => <li className={objective.status} key={objective.id}><i>{objective.status === "completed" ? "✓" : objective.status === "failed" ? "×" : "○"}</i><span>{objective.label}</span></li>)}</ul></section>;
}
