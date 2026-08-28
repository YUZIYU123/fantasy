"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { COMPANION_RULES } from "../../lib/companion-lifecycle";
import { ReaderShell } from "../reader-shell";
import { createSessionCompanion } from "./trial-companion";

type CompanionState = {
  bondXp: number;
  level: number;
  bondInLevel: number;
  bondToNextLevel: number;
  vitality: number;
  mood: "bright" | "calm" | "sleepy";
  mistlight: number;
  equippedAppearance: string;
  equippedGarden: string;
};

const loadingState: CompanionState = {
  bondXp: 0,
  level: 1,
  bondInLevel: 0,
  bondToNextLevel: 100,
  vitality: 0,
  mood: "calm",
  mistlight: 0,
  equippedAppearance: "default",
  equippedGarden: "world-tree",
};

function operationId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function XiaowuGardenScreen() {
  const [mode, setMode] = useState<"loading" | "guest" | "account" | "error">("loading");
  const [state, setState] = useState<CompanionState>(loadingState);
  const [message, setMessage] = useState("正在靠近世界树…");
  const [busy, setBusy] = useState(false);
  const trialRef = useRef<ReturnType<typeof createSessionCompanion> | null>(null);

  const load = useCallback(async () => {
    setMode("loading");
    setMessage("正在靠近世界树…");
    try {
      const sessionResponse = await fetch("/api/auth/me", { headers: { accept: "application/json" } });
      const session = await sessionResponse.json() as { user?: { id?: string } | null };
      if (!session.user) {
        trialRef.current ??= createSessionCompanion(sessionStorage);
        const result = await trialRef.current.lifecycle.execute(trialRef.current.actor, { action: "observe" });
        if (!("state" in result) || !result.state) throw new Error("试玩状态暂时不可用");
        setState(result.state);
        setMode("guest");
        setMessage("试玩状态只停留在当前浏览器会话");
        return;
      }
      const response = await fetch("/api/account/companion", { headers: { accept: "application/json" } });
      const body = await response.json() as { state?: CompanionState; error?: string };
      if (!response.ok || !body.state) throw new Error(body.error || "雾庭暂时没有回应");
      setState(body.state);
      setMode("account");
      setMessage("小雾认出了你，成长已同步");
    } catch (error) {
      setMode("error");
      setMessage(error instanceof Error ? error.message : "雾庭暂时没有回应");
    }
  }, []);

  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const interact = async (kind: "touch" | "play" | "rest") => {
    if ((mode !== "guest" && mode !== "account") || busy) return;
    setBusy(true);
    try {
      if (mode === "guest") {
        trialRef.current ??= createSessionCompanion(sessionStorage);
        const result = await trialRef.current.lifecycle.execute(trialRef.current.actor, {
          action: "interact", kind, operationId: operationId(),
        });
        if ("state" in result && result.state) setState(result.state);
        setMessage(result.outcome === "cooldown" ? "动作回应成功，活力恢复正在冷却" : kind === "play" ? `小雾绕着世界树飞了一圈，活力恢复 ${COMPANION_RULES.playVitality}` : "小雾回应了你");
        return;
      }
      const response = await fetch("/api/account/companion/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: kind, operationId: operationId() }),
      });
      const body = await response.json() as { state?: CompanionState; outcome?: string; error?: string };
      if (!response.ok || !body.state) throw new Error(body.error || "互动没有完成");
      setState(body.state);
      setMessage(body.outcome === "cooldown" ? "动作回应成功，活力恢复正在冷却" : kind === "play" ? `一起玩得很开心，消耗 ${COMPANION_RULES.playMistlight} 雾光` : "小雾回应了你");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "互动没有完成，可以再试一次");
    } finally {
      setBusy(false);
    }
  };

  return <ReaderShell active="xiaowu" contextLabel="雾庭" companion="hidden">
    <main className="xiaowu-garden">
      <header className="garden-heading">
        <p>WORLD TREE COURTYARD</p>
        <div><h1>雾庭</h1>{mode === "guest" && <span>本次会话试玩</span>}</div>
        <p>{mode === "guest" ? "试玩状态不会保存；登录账号才拥有永久成长。" : "每一次认真阅读，都会在这里留下微光。"}</p>
      </header>

      <section className={`garden-scene mood-${state.mood}`} aria-label="世界树庭院">
        <div className="garden-tree" aria-hidden="true"><i /><i /><i /></div>
        <div className="garden-companion">
          {/* eslint-disable-next-line @next/next/no-img-element -- fixed-canvas local WebP needs no transformation */}
          <img src={`/xiaowu/${state.mood === "sleepy" ? "warning" : state.mood === "bright" ? "success" : "idle"}.webp`} alt="小雾在世界树庭院中悬浮" width={330} height={330} />
        </div>
        <p>{state.mood === "bright" ? "今天的雾光很亮。要一起做点什么吗？" : state.mood === "sleepy" ? "小雾靠近了树根，想慢慢休息一下。" : "小雾安静地守着你带回来的故事。"}</p>
      </section>

      <section className="garden-stats" aria-label="小雾成长状态">
        <article><small>羁绊</small><strong>羁绊等级 {state.level}</strong><progress max={state.bondToNextLevel} value={state.bondInLevel} aria-label="本级羁绊进度" /><span>{state.bondInLevel} / {state.bondToNextLevel}</span></article>
        <article><small>活力</small><strong>{state.vitality}</strong><span>/ 100</span></article>
        <article><small>雾光</small><strong>{state.mistlight} 雾光</strong><span>来自阅读</span></article>
      </section>

      <section className="garden-actions" aria-labelledby="garden-actions-title">
        <div><p>COMPANION INTERACTION</p><h2 id="garden-actions-title">陪小雾待一会</h2></div>
        <button disabled={busy || mode === "loading" || mode === "error"} onClick={() => void interact("touch")}><b>摸摸触角</b><small>恢复 {COMPANION_RULES.touchVitality} 活力 · 每 {COMPANION_RULES.touchCooldownHours} 小时</small></button>
        <button disabled={busy || mode === "loading" || mode === "error"} onClick={() => void interact("play")}><b>一起玩</b><small>消耗 {COMPANION_RULES.playMistlight} 雾光 · 恢复 {COMPANION_RULES.playVitality}</small></button>
        <button disabled={busy || mode === "loading" || mode === "error"} onClick={() => void interact("rest")}><b>休息</b><small>每天一次 · 恢复 {COMPANION_RULES.restVitality}</small></button>
        <p role="status" aria-live="polite">{message}</p>
        {mode === "error" && <button className="garden-retry" onClick={() => void load()}>重新连接雾庭</button>}
      </section>

      <section className="garden-progress">
        <article><small>当前成长目标</small><h2>带回下一束故事微光</h2><p>首次完成已发布章节，可获得 {COMPANION_RULES.completionBondXp} 羁绊与 {COMPANION_RULES.completionMistlight} 雾光。</p></article>
        <article><small>最近阅读奖励</small><p>{mode === "account" && state.bondXp > 0 ? `已积累 ${state.bondXp} 羁绊；完成新的章节会继续记录。` : "还没有带回阅读奖励。"}</p></article>
      </section>

      <section className="garden-collections" aria-labelledby="garden-collection-title">
        <p>COLLECTION ARCHIVE</p><h2 id="garden-collection-title">收藏</h2>
        <div>{["记忆册", "动作", "服装", "庭院"].map((label) => <button disabled key={label}><span>{label}</span><small>后续开放</small></button>)}</div>
      </section>
    </main>
  </ReaderShell>;
}
