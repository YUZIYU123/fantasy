"use client";

import {
  applyNodeChanges, Background, BaseEdge, Controls, EdgeLabelRenderer, getBezierPath,
  Handle, MiniMap, Position, ReactFlow,
  type Connection, type Edge, type EdgeProps, type Node, type NodeProps, type ReactFlowInstance,
} from "@xyflow/react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AssetFolder, AssetRecord, AssetType } from "../../lib/assets";
import {
  applyTerminalTaskEvents, countStoryBodyCharacters, countStoryCharacters, createBlankStory, createChildNode, createStandaloneNode, createStoryChoice, DEFAULT_STORY_TERMINAL, FLOW_NODE_HEIGHT,
  FLOW_NODE_WIDTH, getStoryBodyWarnings, getStoryTerminalWarnings, insertNodeOnChoice, NODE_BODY_MAX_LENGTH,
  NODE_BODY_RECOMMENDED_LENGTH, normalizeNovel, normalizeStory, SHORT_STORY_MAX_LENGTH, STORY_PAGE_BREAK,
  type ChapterRecord, type ImagePresentation, type NovelDocument, type NovelRecord,
  type InteractionPreset, type StoryChoice, type StoryDocument, type StoryMusicCue, type StoryNode,
  terminalVoiceSourceKey, type TerminalTaskAction, type TerminalTaskStatus,
  validateStory, validateStoryBodyLengths, validateStoryInputLengths, validateStoryMedia,
} from "../../lib/story";
import { SFX_GENERATION_DEFAULT_SECONDS, suggestChoiceSfxPrompt } from "../../lib/sfx";
import type { TerminalVoiceOption } from "../../lib/tts";
import {
  inspectReadingPages,
  OPENING_PAGE_POLICY,
  resolveTerminalReaction,
  STANDARD_PAGE_POLICY,
  type ReadingPage,
} from "../../lib/reading-session";
import type {
  AdministratorSource,
  CreatorAccessDecision,
} from "../../lib/session-authorization-module";
import {
  advanceCreatorWorkspaceAccess,
  resumeCreatorWorkspaceAccess,
  startCreatorWorkspaceAccess,
} from "../../lib/session-authorization-module";
import { Brand } from "../brand";
import { FantasyTerminal, type TerminalPlayback } from "../fantasy-terminal";
import { ChapterOutroScreen, Reader } from "../story-studio";

type StudioScope = "admin" | "author";
type View = "novels" | "novel-settings" | "short" | "chapters" | "settings" | "editor" | "preview" | "assets" | "users";
type UploadItem = { id: string; file: File; progress: number; status: "queued" | "uploading" | "done" | "error"; error?: string; duration: number };
type ReconcileOperationAccess = (status: number) => Promise<boolean>;

const navigateWindow = (to: string) => window.location.replace(to);

export function AdminStudio({
  scope = "admin",
  navigate = navigateWindow,
}: {
  scope?: StudioScope;
  navigate?: (to: string) => void;
}) {
  const apiBase = scope === "admin" ? "/admin/api" : "/studio/api";
  const [view, setView] = useState<View>("novels");
  const [novels, setNovels] = useState<NovelRecord[]>([]);
  const [chapters, setChapters] = useState<ChapterRecord[]>([]);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [folders, setFolders] = useState<AssetFolder[]>([]);
  const [activeNovel, setActiveNovel] = useState<NovelRecord | null>(null);
  const [novelDraft, setNovelDraft] = useState<NovelDocument | null>(null);
  const [active, setActive] = useState<ChapterRecord | null>(null);
  const [story, setStory] = useState<StoryDocument>(() => createBlankStory());
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [entryReason, setEntryReason] = useState<CreatorAccessDecision["reason"]>("signed_out");
  const [adminSource, setAdminSource] = useState<AdministratorSource | null>(null);
  const [emergencyCredentialEnabled, setEmergencyCredentialEnabled] = useState(false);
  const [accessFailed, setAccessFailed] = useState(false);
  const [contentLoaded, setContentLoaded] = useState(false);
  const [pendingOpenId, setPendingOpenId] = useState("");
  const [pendingNovelId, setPendingNovelId] = useState("");
  const [assetReturnView, setAssetReturnView] = useState<View>("novels");
  const [previewReturnView, setPreviewReturnView] = useState<View>("editor");
  const [previewNodeId, setPreviewNodeId] = useState("");
  const accessEpoch = useRef(0);

  const loadContent = useCallback(async (isCurrent: () => boolean): Promise<"loaded" | "access_stale" | "failed"> => {
    if (isCurrent()) setBusy(true);
    try {
      const [novelResponse, chapterResponse, assetResponse] = await Promise.all([
        fetch(`${apiBase}/novels`),
        fetch(`${apiBase}/chapters`),
        fetch(`${apiBase}/assets`),
      ]);
      const responses = [novelResponse, chapterResponse, assetResponse];
      if (responses.some((response) => response.status === 401 || response.status === 403)) return "access_stale";
      if (!responses.every((response) => response.ok)) return "failed";
      const [novelData, chapterData, assetData] = await Promise.all([
        novelResponse.json() as Promise<{ novels?: NovelRecord[]; shorts?: Array<{ novel: NovelRecord; chapter: ChapterRecord }> }>,
        chapterResponse.json() as Promise<{ chapters?: ChapterRecord[] }>,
        assetResponse.json() as Promise<{ assets?: AssetRecord[]; folders?: AssetFolder[] }>,
      ]);
      if (!isCurrent()) return "failed";
      setNovels(novelData.novels || []);
      setChapters([...(chapterData.chapters || []), ...(novelData.shorts || []).map((item) => item.chapter)]);
      setAssets(assetData.assets || []);
      setFolders(assetData.folders || []);
      setContentLoaded(true);
      return "loaded";
    } catch {
      return "failed";
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }, [apiBase]);
  const executeAccess = useCallback(async (initialAccess = startCreatorWorkspaceAccess()) => {
    const epoch = ++accessEpoch.current;
    const isCurrent = () => accessEpoch.current === epoch;
    setBusy(true);
    setAccessFailed(false);
    let access = initialAccess;
    if (access.status === "resolving") setAuthenticated(null);
    while (access.effect) {
      if (!isCurrent()) return;
      if (access.effect.type === "navigate") {
        navigate(access.effect.to);
        return;
      }
      if (access.effect.type === "check_access") {
        try {
          const response = await fetch(`${apiBase}/session`, { cache: "no-store" });
          if (!response.ok) throw new Error("无法确认创作权限");
          const decision = await response.json() as CreatorAccessDecision & { authenticated: boolean };
          if (!isCurrent()) return;
          access = advanceCreatorWorkspaceAccess(access, { type: "access_resolved", decision });
        } catch {
          if (!isCurrent()) return;
          access = advanceCreatorWorkspaceAccess(access, { type: "access_failed" });
        }
        continue;
      }
      access = advanceCreatorWorkspaceAccess(access, {
        type: "content_resolved",
        result: await loadContent(isCurrent),
      });
    }
    if (!isCurrent()) return;
    if (access.decision) {
      setEntryReason(access.decision.reason);
      setEmergencyCredentialEnabled(access.decision.recoveryAvailable);
      setAdminSource(access.decision.source);
    }
    if (access.status === "ready") {
      setAuthenticated(true);
      setBusy(false);
      return;
    }
    if (access.status === "denied") {
      setAuthenticated(false);
      setBusy(false);
      return;
    }
    if (access.status === "content_error") {
      setAuthenticated(true);
      setContentLoaded(false);
      setMessage("后台内容加载失败，请重试");
      setBusy(false);
      return;
    }
    if (access.status === "access_error") {
      setAccessFailed(true);
      setAuthenticated(false);
      setBusy(false);
    }
  }, [apiBase, loadContent, navigate]);
  const resolveAccess = useCallback(() => executeAccess(startCreatorWorkspaceAccess()), [executeAccess]);
  const reconcileOperationAccess = useCallback(async (status: number) => {
    const access = resumeCreatorWorkspaceAccess(
      status === 401 || status === 403 ? "access_stale" : "loaded",
    );
    if (access.status === "ready") return false;
    await executeAccess(access);
    return true;
  }, [executeAccess]);
  const refreshContent = useCallback(async () => {
    await executeAccess(startCreatorWorkspaceAccess());
  }, [executeAccess]);
  useEffect(() => {
    queueMicrotask(() => resolveAccess().catch(() => {
      setAuthenticated(false);
      setMessage("无法确认创作权限");
      setBusy(false);
    }));
  }, [resolveAccess]);
  useEffect(() => {
    if (!pendingOpenId) return;
    const created = chapters.find((chapter) => chapter.id === pendingOpenId);
    if (!created) return;
    queueMicrotask(() => {
      setActive(created);
      setStory(normalizeStory(structuredClone(created.draft)));
      setView("settings");
      setPendingOpenId("");
    });
  }, [chapters, pendingOpenId]);
  useEffect(() => {
    if (!pendingNovelId) return;
    const created = novels.find((novel) => novel.id === pendingNovelId);
    if (!created) return;
    queueMicrotask(() => {
      setActiveNovel(created);
      setNovelDraft(normalizeNovel(structuredClone(created.draft)));
      if (created.format === "short") {
        const body = chapters.find((chapter) => chapter.novelId === created.id);
        if (body) {
          setActive(body);
          setStory(normalizeStory(structuredClone(body.draft)));
          setView("short");
        }
      } else setView("novel-settings");
      setPendingNovelId("");
    });
  }, [chapters, novels, pendingNovelId]);
  useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(""), 4000); return () => clearTimeout(timer); }, [message]);
  useEffect(() => {
    const navigate = (event: Event) => {
      const target = (event as CustomEvent<View>).detail;
      if (target === "chapters" && !activeNovel) return;
      setView(target);
    };
    window.addEventListener("fantasy-studio-navigate", navigate);
    return () => window.removeEventListener("fantasy-studio-navigate", navigate);
  }, [activeNovel]);
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const ignored = new Set([
      "ResizeObserver loop completed with undelivered notifications.",
      "ResizeObserver loop limit exceeded",
    ]);
    const stopKnownWarning = (event: ErrorEvent) => {
      if (!ignored.has(event.message)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener("error", stopKnownWarning, true);
    return () => window.removeEventListener("error", stopKnownWarning, true);
  }, []);

  async function chapterAction(action: string, id?: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    const response = await fetch(`${apiBase}/chapters`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, id, ...extra }) });
    const data = await response.json() as { id?: string; errors?: string[]; error?: string }; setBusy(false);
    if (await reconcileOperationAccess(response.status)) return false;
    if (!response.ok) { setMessage(data.errors?.join("；") || data.error || "操作失败"); return false; }
    setMessage(action === "publish" ? "章节已发布" : action === "submit" ? "已提交管理员审核" : action === "save" ? "草稿已保存" : "操作完成");
    if (action === "create" && data.id) setPendingOpenId(data.id);
    await refreshContent(); return data;
  }

  async function novelAction(action: string, id?: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    const response = await fetch(`${apiBase}/novels`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, id, ...extra }),
    });
    const data = await response.json() as { id?: string; errors?: string[]; error?: string };
    setBusy(false);
    if (await reconcileOperationAccess(response.status)) return false;
    if (!response.ok) {
      setMessage(data.errors?.join("；") || data.error || "操作失败");
      return false;
    }
    setMessage(action === "publish" ? "小说资料已发布" : action === "submit" ? "小说资料已提交审核" : action === "save" ? "小说资料已保存" : "操作完成");
    if (action === "create" && data.id) setPendingNovelId(data.id);
    await refreshContent();
    return data;
  }

  async function shortAction(action: string, id?: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    const response = await fetch(`${apiBase}/shorts`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, id, ...extra }),
    });
    const data = await response.json() as { id?: string; chapterId?: string; updatedAt?: string; errors?: string[]; error?: string };
    setBusy(false);
    if (await reconcileOperationAccess(response.status)) return false;
    if (!response.ok) { setMessage(data.errors?.join("；") || data.error || "短篇操作失败"); return false; }
    setMessage(action === "publish" ? "短篇已发布" : action === "submit" ? "短篇已提交审核" : action === "save" ? "短篇草稿已保存" : "操作完成");
    if (action === "create" && data.id) setPendingNovelId(data.id);
    await refreshContent();
    return data;
  }

  const saveChapterDraft = useCallback(async (chapter: ChapterRecord, snapshot: StoryDocument) => {
    const response = await fetch(`${apiBase}/chapters`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "save",
        id: chapter.id,
        story: snapshot,
        meta: { slug: chapter.slug, sortOrder: chapter.sortOrder },
      }),
    });
    const data = await response.json() as { updatedAt?: string; errors?: string[]; error?: string };
    if (await reconcileOperationAccess(response.status)) {
      throw new Error("创作权限已失效，请重新登录");
    }
    if (!response.ok) throw new Error(data.errors?.join("；") || data.error || "自动保存失败");
    const updatedAt = data.updatedAt || new Date().toISOString();
    const updated = { ...chapter, draft: snapshot, title: snapshot.title, summary: snapshot.summary, coverUrl: snapshot.openingImageUrl, updatedAt };
    setChapters((current) => current.map((item) => item.id === chapter.id ? updated : item));
    setActive((current) => current?.id === chapter.id ? updated : current);
    return { updatedAt };
  }, [apiBase, reconcileOperationAccess]);

  async function logout() {
    if (scope === "author") {
      await fetch("/api/auth/logout", { method: "POST" });
    } else {
      await Promise.all([
        fetch("/admin/api/session", { method: "DELETE" }),
        fetch("/api/auth/logout", { method: "POST" }),
      ]);
    }
    setAuthenticated(false); setContentLoaded(false); setNovels([]); setChapters([]); setAssets([]); setFolders([]); setActiveNovel(null); setActive(null); setView("novels");
  }

  const openNovel = (novel: NovelRecord, destination: "novel-settings" | "chapters") => {
    setActiveNovel(novel);
    setNovelDraft(normalizeNovel(structuredClone(novel.draft)));
    if (novel.format === "short") {
      const body = chapters.find((chapter) => chapter.novelId === novel.id);
      if (body) {
        setActive(body);
        setStory(normalizeStory(structuredClone(body.draft)));
        const interactive = body.draft.nodes.length > 1 || body.draft.nodes.some((node) => node.choices.length > 0);
        setView(interactive ? "editor" : "short");
      }
      return;
    }
    setView(destination);
  };
  const openChapter = (chapter: ChapterRecord, destination: "settings" | "editor") => {
    const parent = novels.find((novel) => novel.id === chapter.novelId) ?? null;
    setActiveNovel(parent);
    if (parent) setNovelDraft(normalizeNovel(structuredClone(parent.draft)));
    setActive(chapter);
    setStory(normalizeStory(structuredClone(chapter.draft)));
    setView(destination);
  };
  const openAssets = (returnView: View) => {
    setAssetReturnView(returnView);
    setView("assets");
  };
  if (authenticated === null) return <StudioAccessResolving />;
  if (accessFailed) return <StudioAccessError onRetry={resolveAccess} />;
  if (authenticated === false) return <StudioGate
    scope={scope}
    reason={entryReason}
    emergencyCredentialEnabled={emergencyCredentialEnabled}
    onRetry={resolveAccess}
  />;
  if (!contentLoaded) return <StudioContentError busy={busy} onRetry={refreshContent} />;
  return <main className="admin-shell">
    {busy && <div className="loading-bar" aria-label="加载中" />}{message && <div className="toast" role="status">{message}</div>}
    {scope === "admin" && adminSource === "local_bypass" && view !== "preview" && <span className="local-admin-badge">本地管理员模式</span>}
    {authenticated && view !== "preview" && adminSource !== "local_bypass" && <button className="creator-logout" onClick={logout}>{scope === "author" ? "退出登录" : "退出创作"}</button>}
    {view === "novels" && <NovelDashboard scope={scope} novels={novels} chapters={chapters} onOpen={(novel) => openNovel(novel, "novel-settings")} onChapters={(novel) => openNovel(novel, "chapters")} onAssets={() => openAssets("novels")} onUsers={() => setView("users")} onAction={novelAction} onShortAction={shortAction} />}
    {view === "short" && activeNovel?.format === "short" && novelDraft && active && <ShortEditor scope={scope} novel={activeNovel} draft={novelDraft} setDraft={setNovelDraft} story={story} setStory={setStory} assets={assets} folders={folders} onBack={() => setView("novels")} onAssets={() => openAssets("short")} onInteractive={() => setView("editor")} onPreview={() => { setPreviewNodeId(story.startNodeId); setPreviewReturnView("short"); setView("preview"); }} onSave={() => shortAction("save", activeNovel.id, { novel: novelDraft, story, meta: { slug: activeNovel.slug, sortOrder: activeNovel.sortOrder } })} onSubmit={() => shortAction(scope === "admin" ? "publish" : "submit", activeNovel.id, { novel: novelDraft, story })} />}
    {view === "novel-settings" && activeNovel && novelDraft && <NovelSettings scope={scope} novel={activeNovel} draft={novelDraft} setDraft={setNovelDraft} assets={assets} folders={folders} onBack={() => setView("novels")} onChapters={() => setView("chapters")} onAssets={() => openAssets("novel-settings")} onSave={() => novelAction("save", activeNovel.id, { novel: novelDraft, meta: { slug: activeNovel.slug, sortOrder: activeNovel.sortOrder } })} onSubmit={() => novelAction(scope === "admin" ? "publish" : "submit", activeNovel.id, { novel: novelDraft })} />}
    {view === "chapters" && activeNovel && <ChapterDashboard scope={scope} novel={activeNovel} chapters={chapters.filter((chapter) => chapter.novelId === activeNovel.id)} onNovels={() => setView("novels")} onSettings={(chapter) => openChapter(chapter, "settings")} onEdit={(chapter) => openChapter(chapter, "editor")} onAssets={() => openAssets("chapters")} onUsers={() => setView("users")} onAction={(action, id, extra = {}) => chapterAction(action, id, action === "create" ? { ...extra, meta: { novelId: activeNovel.id } } : extra)} />}
    {view === "settings" && active && <ChapterSettings scope={scope} chapter={active} story={story} setStory={setStory} assets={assets} folders={folders} onBack={() => setView("chapters")} onAssets={() => openAssets("settings")} onEdit={() => setView("editor")} onPreview={() => { setPreviewNodeId(story.startNodeId); setPreviewReturnView("settings"); setView("preview"); }} onSave={() => chapterAction("save", active.id, { story, meta: { slug: active.slug, sortOrder: active.sortOrder } })} />}
    {view === "assets" && <AssetManager scope={scope} apiBase={apiBase} assets={assets} folders={folders} onBack={() => setView(assetReturnView)} onReload={refreshContent} onMessage={setMessage} onAccessStatus={reconcileOperationAccess} />}
    {view === "users" && scope === "admin" && <UserManager onBack={() => setView("novels")} onAssets={() => openAssets("users")} onAccessStatus={reconcileOperationAccess} />}
    {view === "editor" && active && <StoryEditor key={active.id} scope={scope} apiBase={apiBase} chapter={active} story={story} setStory={setStory} assets={assets} folders={folders} onAssetCreated={(asset) => setAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)])} onBack={() => setView(activeNovel?.format === "short" ? "novels" : "chapters")} onSettings={() => setView(activeNovel?.format === "short" ? "short" : "settings")} onAssets={() => openAssets("editor")} onPreview={(nodeId) => { setPreviewNodeId(nodeId); setPreviewReturnView("editor"); setView("preview"); }} onSave={activeNovel?.format === "short" && novelDraft ? async (chapter, snapshot) => {
      const result = await shortAction("save", activeNovel.id, { novel: novelDraft, story: snapshot, meta: { slug: activeNovel.slug, sortOrder: activeNovel.sortOrder } });
      if (!result) throw new Error("短篇保存失败");
      return { updatedAt: new Date().toISOString() };
    } : saveChapterDraft} onPublish={() => activeNovel?.format === "short" && novelDraft ? void shortAction(scope === "admin" ? "publish" : "submit", activeNovel.id, { novel: novelDraft, story }) : void chapterAction(scope === "admin" ? "publish" : "submit", active.id, { story })} onRollback={async (version) => { if (scope === "admin" && await (activeNovel?.format === "short" ? shortAction("rollback", activeNovel.id, { version }) : chapterAction("rollback", active.id, { version }))) setView("novels"); }} onAccessStatus={reconcileOperationAccess} shortMode={activeNovel?.format === "short"} />}
    {view === "preview" && <div className="preview-wrap"><div className="preview-toolbar"><button className="preview-exit" onClick={() => setView(previewReturnView)}>← 返回编辑</button><label>从节点预览<select value={previewNodeId || story.startNodeId} onChange={(event) => setPreviewNodeId(event.target.value)}><option value={story.startNodeId}>章节起点 · {story.nodes.find((node) => node.id === story.startNodeId)?.title}</option>{story.nodes.filter((node) => node.id !== story.startNodeId).map((node) => <option key={node.id} value={node.id}>{node.title} · {node.id}</option>)}</select></label></div><div className="phone-frame"><StoryPreview key={previewNodeId || story.startNodeId} story={story} novelName={activeNovel?.draft.name || ""} initialNodeId={previewNodeId || story.startNodeId} onBack={() => setView(previewReturnView)} /></div></div>}
  </main>;
}

function StoryPreview({ story, novelName, initialNodeId, onBack }: {
  story: StoryDocument;
  novelName: string;
  initialNodeId: string;
  onBack: () => void;
}) {
  const [complete, setComplete] = useState(false);
  if (complete) {
    return <ChapterOutroScreen
      story={story}
      novelName={novelName}
      backLabel="返回编辑"
      onBack={onBack}
    />;
  }
  return <Reader
    story={story}
    chapterId="preview"
    onBack={onBack}
    onComplete={() => setComplete(true)}
    preview
    initialNodeId={initialNodeId}
  />;
}

function StudioAccessResolving() {
  return <main className="creator-login"><section>
    <Brand />
    <p className="eyebrow">CREATOR ACCESS</p>
    <h1>创作中心</h1>
    <p role="status">正在确认创作权限…</p>
  </section></main>;
}

function StudioAccessError({ onRetry }: { onRetry: () => Promise<void> }) {
  return <main className="creator-login"><section>
    <Brand />
    <p className="eyebrow">CREATOR ACCESS</p>
    <h1>暂时无法确认权限</h1>
    <p role="alert">权限服务暂时不可用，未将你误判为未登录。</p>
    <button className="primary" onClick={() => void onRetry()}>重新检查权限</button>
    <Link href="/">← 返回读者端</Link>
  </section></main>;
}

function StudioContentError({ busy, onRetry }: { busy: boolean; onRetry: () => void }) {
  return <main className="creator-login"><section>
    <Brand />
    <p className="eyebrow">CREATOR CONTENT</p>
    <h1>后台内容加载失败</h1>
    <p role="alert">创作权限已经确认，小说和素材暂时没有加载成功。</p>
    <button className="primary" disabled={busy} onClick={onRetry}>{busy ? "正在重试…" : "重新加载内容"}</button>
    <Link href="/">← 返回读者端</Link>
  </section></main>;
}

function StudioGate({ scope, reason, emergencyCredentialEnabled, onRetry }: {
  scope: StudioScope;
  reason: CreatorAccessDecision["reason"];
  emergencyCredentialEnabled: boolean;
  onRetry: () => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function creatorLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSubmitting(true); setError("");
    const response = await fetch("/admin/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await response.json() as { error?: string };
    if (!response.ok) { setError(data.error || "登录失败"); setSubmitting(false); return; }
    setPassword(""); await onRetry(); setSubmitting(false);
  }

  return <main className="creator-login"><section>
    <Brand />
    <p className="eyebrow">{scope === "admin" ? "ADMIN ACCESS" : "AUTHOR STUDIO"}</p>
    <h1>{scope === "admin" ? "进入创作后台" : "请以作者账号登录"}</h1>
    <p>{reason === "reader_account"
      ? "当前账号是读者账号，需要管理员升级角色后才能进入创作工作台。"
      : scope === "admin"
        ? "请使用已授权的管理员账号登录。"
        : "请使用已升级为作者的账号登录。"}</p>
    <Link className="primary auth-link-button" href="/login?next=/creator">登录账号</Link>
    {scope === "admin" && emergencyCredentialEnabled && <details className="emergency-login">
      <summary>使用应急恢复密钥</summary>
      <form onSubmit={creatorLogin}>
        <label>应急恢复密钥<input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {error && <p className="creator-login-error" role="alert">{error}</p>}
        <button className="ghost" disabled={submitting || !password}>{submitting ? "正在验证…" : "验证应急密钥"}</button>
      </form>
    </details>}
    {scope === "admin" && !emergencyCredentialEnabled && <p className="creator-login-note">当前未配置应急恢复密钥，管理员密码输入已隐藏。</p>}
    <button className="ghost" onClick={() => void onRetry()}>重新检查权限</button>
    <Link href="/">← 返回读者端</Link>
  </section></main>;
}

function StudioAside({ scope, active, onNovels, onChapters, onAssets, onUsers }: {
  scope: StudioScope;
  active: "novels" | "chapters" | "assets" | "users";
  onNovels?: () => void;
  onChapters?: () => void;
  onAssets: () => void;
  onUsers?: () => void;
}) {
  const navigate = (target: "novels" | "chapters") => window.dispatchEvent(new CustomEvent("fantasy-studio-navigate", { detail: target }));
  return <aside><Brand /><nav>
    <button className={active === "novels" ? "active" : ""} onClick={() => { onNovels?.(); navigate("novels"); }}>⬡ 小说管理</button>
    <button className={active === "chapters" ? "active" : ""} disabled={!onChapters} onClick={() => { onChapters?.(); navigate("chapters"); }}>▦ 章节管理</button>
    <button className={active === "assets" ? "active" : ""} onClick={onAssets}>◇ 素材库</button>
    {scope === "admin" && <button className={active === "users" ? "active" : ""} onClick={onUsers}>◎ 用户管理</button>}
  </nav><div className="aside-bottom"><Link href="/">← 查看读者端</Link></div></aside>;
}

function NovelDashboard({ scope, novels, chapters, onOpen, onChapters, onAssets, onUsers, onAction, onShortAction }: {
  scope: StudioScope;
  novels: NovelRecord[];
  chapters: ChapterRecord[];
  onOpen: (novel: NovelRecord) => void;
  onChapters: (novel: NovelRecord) => void;
  onAssets: () => void;
  onUsers: () => void;
  onAction: (action: string, id?: string, extra?: Record<string, unknown>) => Promise<unknown>;
  onShortAction: (action: string, id?: string, extra?: Record<string, unknown>) => Promise<unknown>;
}) {
  return <div className="studio"><StudioAside scope={scope} active="novels" onNovels={() => {}} onAssets={onAssets} onUsers={onUsers} /><section className="studio-main"><header><div><p>{scope === "admin" ? "ADMIN CONSOLE" : "AUTHOR STUDIO"}</p><h1>作品管理</h1></div><div className="settings-actions"><button className="ghost" onClick={() => onAction("create")}>＋ 新建连载小说</button><button className="primary" onClick={() => onShortAction("create")}>＋ 新建短篇</button></div></header>
    <div className="stats"><div><span>全部小说</span><b>{novels.length}</b></div><div><span>{scope === "admin" ? "待审核" : "审核中"}</span><b>{novels.filter((item) => item.draftStatus === "submitted").length}</b></div><div><span>已发布</span><b>{novels.filter((item) => item.status === "published").length}</b></div></div>
    <div className="novel-grid">{novels.map((novel) => <article className="novel-manage-card" key={novel.id}>
      <div className="novel-cover-thumb">{novel.draft.coverUrl ? <Image src={novel.draft.coverUrl} alt={novel.draft.coverAlt || novel.draft.name} fill unoptimized style={{ objectFit: novel.draft.coverPresentation.fit, objectPosition: `${novel.draft.coverPresentation.positionX}% ${novel.draft.coverPresentation.positionY}%` }} /> : <FantasyCoverPlaceholder />}</div>
      <div><span className={`status ${novel.draftStatus === "submitted" ? "submitted" : novel.status}`}>{novel.draftStatus === "submitted" ? "待审核" : novel.status === "published" ? "已发布" : novel.status === "offline" ? "已下线" : "草稿"}</span> <span className="format-badge">{novel.format === "short" ? "短篇" : "连载小说"}</span><h2>{novel.draft.name}</h2><p>{novel.draft.summary || "尚未填写作品简介"}</p><small>/{novel.slug} · v{novel.version}</small></div>
      <div className="row-actions"><button onClick={() => onOpen(novel)}>{novel.format === "short" ? "编辑短篇" : "小说设置"}</button>{novel.format !== "short" && <><button onClick={() => onChapters(novel)}>章节目录</button><button title="复制" onClick={() => onAction("duplicate", novel.id)}>⧉</button></>}{novel.convertibleTo && <button onClick={() => { const target = novel.convertibleTo; if (confirm(`确定转为${target === "short" ? "短篇" : "连载小说"}吗？`)) void onAction("convert", novel.id, { format: target }); }}>{novel.convertibleTo === "short" ? "转为短篇" : "转为连载小说"}</button>}{scope === "admin" && novel.draftStatus === "submitted" && (novel.format === "short" ? <><button onClick={() => { const body = chapters.find((chapter) => chapter.novelId === novel.id); if (body) void onShortAction("publish", novel.id, { novel: novel.draft, story: body.draft }); }}>发布</button><button onClick={() => { const reviewNote = prompt("填写驳回原因"); if (reviewNote) void onShortAction("reject", novel.id, { meta: { reviewNote } }); }}>驳回</button></> : <><button onClick={() => onAction("publish", novel.id, { novel: novel.draft })}>发布</button><button onClick={() => { const reviewNote = prompt("填写驳回原因"); if (reviewNote) void onAction("reject", novel.id, { meta: { reviewNote } }); }}>驳回</button></>)}{scope === "author" && novel.draftStatus === "submitted" && <button onClick={() => novel.format === "short" ? onShortAction("withdraw", novel.id) : onAction("withdraw", novel.id)}>撤回</button>}{scope === "admin" && novel.status === "published" && <button onClick={() => novel.format === "short" ? onShortAction("offline", novel.id) : onAction("offline", novel.id)}>下线</button>}{novel.status === "draft" && novel.draftStatus === "draft" && <button className="danger" onClick={() => { if (confirm(`确定删除这个${novel.format === "short" ? "短篇" : "小说"}草稿吗？`)) void (novel.format === "short" ? onShortAction("delete", novel.id) : onAction("delete", novel.id)); }}>删除</button>}</div>
    </article>)}</div>
    {novels.length === 0 && <div className="empty"><b>还没有小说</b><p>先创建一本小说，再为它添加章节。</p></div>}
  </section></div>;
}

export function ShortEditor({ scope, novel, draft, setDraft, story, setStory, assets, folders, onBack, onAssets, onInteractive, onPreview, onSave, onSubmit }: {
  scope: StudioScope; novel: NovelRecord; draft: NovelDocument; setDraft: (value: NovelDocument) => void;
  story: StoryDocument; setStory: (value: StoryDocument) => void; assets: AssetRecord[]; folders: AssetFolder[];
  onBack: () => void; onAssets: () => void; onInteractive: () => void; onPreview: () => void; onSave: () => void; onSubmit: () => void;
}) {
  const locked = scope === "author" && novel.draftStatus === "submitted";
  const wordCount = countStoryBodyCharacters(story);
  const first = story.nodes.find((node) => node.id === story.startNodeId) ?? story.nodes[0];
  const interactive = story.nodes.length > 1 || story.nodes.some((node) => node.choices.length > 0);
  const updateBody = (body: string) => setStory({ ...story, nodes: story.nodes.map((node) => node.id === first?.id ? { ...node, body, canEndChapter: true, type: "ending" } : node) });
  return <div className={`studio chapter-settings-page${locked ? " editor-locked" : ""}`}><StudioAside scope={scope} active="novels" onNovels={onBack} onAssets={onAssets} /><section className="studio-main short-editor-page"><header><div><button className="back-link" onClick={onBack}>← 作品管理</button><p>SHORT FICTION</p><h1>短篇编辑</h1></div><div className="settings-actions"><button className="ghost" onClick={onAssets}>素材库</button><button className="ghost" onClick={onInteractive}>{interactive ? "打开互动编辑器" : "开启互动编辑"}</button><button className="ghost" onClick={onPreview}>预览阅读</button><button className="ghost" disabled={locked} onClick={onSave}>保存草稿</button><button className="primary" disabled={locked || wordCount > SHORT_STORY_MAX_LENGTH} onClick={onSubmit}>{scope === "admin" ? "发布短篇" : "提交审核"}</button></div></header>
    {novel.reviewNote && <p className="inline-message">审核反馈：{novel.reviewNote}</p>}
    {interactive && <p className="inline-message">这篇作品含有多个剧情节点或选项，后续会默认进入完整互动编辑器。</p>}
    <div className="short-editor-layout"><form className="chapter-settings-form" onSubmit={(event) => { event.preventDefault(); if (!locked) onSave(); }}><label>短篇名称<input disabled={locked} maxLength={100} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label>简介<textarea disabled={locked} rows={4} maxLength={1000} value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} /></label><fieldset disabled={locked}><legend>封面与默认收尾图</legend><AssetSelect label="封面图片" type="image" value={draft.coverAssetId || draft.coverUrl} assets={assets} folders={folders} onChange={(id, url) => setDraft({ ...draft, coverAssetId: id, coverUrl: url })} /><label>封面替代文本<input maxLength={500} value={draft.coverAlt} onChange={(event) => setDraft({ ...draft, coverAlt: event.target.value })} /></label><small>未单独设置收尾图时，将明确使用这张封面作为收尾图。</small><AssetSelect label="可选自定义收尾图" type="image" value={story.outroUsesNovelCover ? "" : story.outroImageAssetId || story.outroImageUrl} assets={assets} folders={folders} onChange={(id, url) => setStory({ ...story, outroImageAssetId: id, outroImageUrl: url, outroImageAlt: id || url ? story.outroImageAlt : "", outroUsesNovelCover: !id && !url })} />{!story.outroUsesNovelCover && (story.outroImageAssetId || story.outroImageUrl) && <label>收尾图替代文本<input maxLength={500} value={story.outroImageAlt} onChange={(event) => setStory({ ...story, outroImageAlt: event.target.value })} /></label>}</fieldset><label className="body-editor"><span className="body-editor-head"><span>正文</span><b className={wordCount > SHORT_STORY_MAX_LENGTH ? "error" : ""}>{wordCount.toLocaleString("zh-CN")} / {SHORT_STORY_MAX_LENGTH.toLocaleString("zh-CN")} 字</b></span><textarea disabled={locked || interactive} rows={20} value={first?.body || ""} onChange={(event) => updateBody(event.target.value)} />{wordCount > SHORT_STORY_MAX_LENGTH && <span className="body-editor-notice error">草稿仍可保存；删减至 20,000 字以内后才能提交或发布。</span>}</label><ReadingRhythmPanel story={story} nodeId={first?.id || story.startNodeId} /></form></div>
  </section></div>;
}

const rhythmAssessmentLabels: Record<ReadingPage["assessment"], string> = {
  "opening-ideal": "开场理想",
  balanced: "均衡",
  short: "偏短",
  long: "偏长",
  hard: "硬切",
  ending: "收尾",
};

function ReadingRhythmPanel({ story, nodeId }: { story: StoryDocument; nodeId: string }) {
  const inspection = useMemo(() => inspectReadingPages(story, nodeId), [nodeId, story]);
  const suggestions = inspection.pages.flatMap((page, index) => {
    const number = index + 1;
    if (page.breakReason === "hard") return [`第 ${number} 页没有可用的语义边界，建议在 ${page.characterCount} 字前补充句末或段落。`];
    if (page.breakReason === "manual" && !page.semanticEnding) return [`第 ${number} 页的手动分页不在句末或段落结尾。`];
    if (page.breakReason === "word") return [`第 ${number} 页在词间自动分页，建议在附近补充句末或段落，让收尾更自然。`];
    if (page.assessment === "short") return [`第 ${number} 页偏短，连续短页可能增加翻页负担。`];
    if (page.assessment === "long") return [`第 ${number} 页偏长，可考虑提前在句末或段落分页。`];
    return [];
  });
  return <aside className="reading-rhythm-panel" aria-label="阅读节奏">
    <div><b>阅读节奏</b><span>预计 {inspection.pages.length} 页</span></div>
    <p>开场前三页 {OPENING_PAGE_POLICY.minimum}–{OPENING_PAGE_POLICY.maximum} 字；后续页面 {STANDARD_PAGE_POLICY.minimum}–{STANDARD_PAGE_POLICY.maximum} 字，最长 {STANDARD_PAGE_POLICY.hardMaximum} 字。</p>
    <ol>{inspection.pages.map((page, index) => <li className={`rhythm-${page.assessment}`} key={`${index}-${page.characterCount}-${page.breakReason}`}><span>第 {index + 1} 页</span><b>{page.characterCount} 字 · {rhythmAssessmentLabels[page.assessment]}</b></li>)}</ol>
    {suggestions.length > 0 ? <div className="reading-rhythm-suggestions">{suggestions.map((suggestion) => <p key={suggestion}>⚠ {suggestion}</p>)}</div> : <p className="reading-rhythm-ready">分页节奏适合手机阅读。</p>}
  </aside>;
}

function FantasyCoverPlaceholder() {
  return <span className="fantasy-cover-placeholder"><i>F</i></span>;
}

function NovelSettings({ scope, novel, draft, setDraft, assets, folders, onBack, onChapters, onAssets, onSave, onSubmit }: {
  scope: StudioScope;
  novel: NovelRecord;
  draft: NovelDocument;
  setDraft: (draft: NovelDocument) => void;
  assets: AssetRecord[];
  folders: AssetFolder[];
  onBack: () => void;
  onChapters: () => void;
  onAssets: () => void;
  onSave: () => void;
  onSubmit: () => void;
}) {
  const locked = scope === "author" && novel.draftStatus === "submitted";
  return <div className={`studio chapter-settings-page${locked ? " editor-locked" : ""}`}>
    <StudioAside scope={scope} active="novels" onNovels={onBack} onChapters={onChapters} onAssets={onAssets} />
    <section className="studio-main"><header><div><button className="back-link" onClick={onBack}>← 小说管理</button><p>NOVEL PROFILE</p><h1>小说设置</h1></div><div className="settings-actions"><button className="ghost" onClick={onAssets}>素材库</button><button className="ghost" onClick={onChapters}>章节目录</button><button className="primary" disabled={locked} onClick={onSave}>保存资料</button><button className="primary" disabled={locked} onClick={onSubmit}>{scope === "admin" ? "发布小说" : "提交审核"}</button></div></header>
      {novel.reviewNote && <p className="inline-message">审核反馈：{novel.reviewNote}</p>}
      <div className="chapter-settings-layout"><form className="chapter-settings-form" onSubmit={(event) => { event.preventDefault(); if (!locked) onSave(); }}>
        <label>小说名称<input disabled={locked} maxLength={100} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>小说简介<textarea disabled={locked} rows={7} maxLength={1000} value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} /></label>
        <fieldset disabled={locked}><legend>小说封面</legend><AssetSelect label="封面图片" type="image" value={draft.coverAssetId || draft.coverUrl} assets={assets} folders={folders} onChange={(id, url) => setDraft({ ...draft, coverAssetId: id, coverUrl: url })} /><label>封面替代文本<input maxLength={500} value={draft.coverAlt} onChange={(event) => setDraft({ ...draft, coverAlt: event.target.value })} /></label><ImagePresentationEditor value={draft.coverPresentation} url={draft.coverUrl} alt={draft.coverAlt} onChange={(coverPresentation) => setDraft({ ...draft, coverPresentation })} /></fieldset>
      </form><section className="novel-profile-preview"><p>小说主页预览</p><div className="novel-preview-cover">{draft.coverUrl ? <Image src={draft.coverUrl} alt={draft.coverAlt || draft.name} fill unoptimized style={{ objectFit: draft.coverPresentation.fit, objectPosition: `${draft.coverPresentation.positionX}% ${draft.coverPresentation.positionY}%` }} /> : <FantasyCoverPlaceholder />}</div><small>FANTASY ORIGINAL</small><h2>{draft.name || "未命名小说"}</h2><p>{draft.summary || "小说简介将在这里显示。"}</p></section></div>
    </section>
  </div>;
}

function ChapterDashboard({ scope, novel, chapters, onNovels, onSettings, onEdit, onAssets, onUsers, onAction }: { scope: StudioScope; novel: NovelRecord; chapters: ChapterRecord[]; onNovels: () => void; onSettings: (chapter: ChapterRecord) => void; onEdit: (chapter: ChapterRecord) => void; onAssets: () => void; onUsers: () => void; onAction: (action: string, id?: string, extra?: Record<string, unknown>) => Promise<unknown> }) {
  return <div className="studio"><StudioAside scope={scope} active="chapters" onNovels={onNovels} onChapters={() => {}} onAssets={onAssets} onUsers={onUsers} /><section className="studio-main"><header><div><button className="back-link" onClick={onNovels}>← 小说管理</button><p>{scope === "admin" ? "ADMIN CONSOLE" : "AUTHOR STUDIO"}</p><h1>{novel.draft.name} · 章节管理</h1></div><button className="primary" onClick={() => onAction("create")}>＋ 新建章节</button></header>
    <div className="stats"><div><span>全部章节</span><b>{chapters.length}</b></div><div><span>{scope === "admin" ? "待审核" : "审核中"}</span><b>{chapters.filter((item) => item.draftStatus === "submitted").length}</b></div><div><span>已发布</span><b>{chapters.filter((item) => item.status === "published").length}</b></div></div>
    <div className="chapter-list"><div className="list-head"><span>章节</span><span>状态</span><span>版本</span><span>最后更新</span><span /></div>{chapters.map((chapter, index) => <div className="list-row" key={chapter.id}><div className="chapter-name"><div>{String(index + 1).padStart(2, "0")}</div><span><b>{chapter.title}</b><small>/{chapter.slug}{chapter.reviewNote ? ` · 驳回：${chapter.reviewNote}` : ""}</small></span></div><span className={`status ${chapter.draftStatus === "submitted" ? "submitted" : chapter.status}`}>{chapter.draftStatus === "submitted" ? "待审核" : chapter.status === "published" ? "已发布" : chapter.status === "offline" ? "已下线" : "草稿"}</span><span>v{chapter.version}</span><span>{new Date(chapter.updatedAt).toLocaleDateString("zh-CN")}</span><div className="row-actions"><button onClick={() => onSettings(chapter)}>章节设置</button><button onClick={() => onEdit(chapter)}>{chapter.draftStatus === "submitted" && scope === "author" ? "查看剧情" : "编辑剧情"}</button><button title="复制" onClick={() => onAction("duplicate", chapter.id)}>⧉</button>{scope === "admin" && chapter.draftStatus === "submitted" && <><button title="发布" onClick={() => onAction("publish", chapter.id, { story: chapter.draft })}>发布</button><button title="驳回" onClick={() => { const reviewNote = prompt("填写驳回原因"); if (reviewNote) void onAction("reject", chapter.id, { meta: { reviewNote } }); }}>驳回</button></>}{scope === "author" && chapter.draftStatus === "submitted" && <button onClick={() => onAction("withdraw", chapter.id)}>撤回</button>}{scope === "admin" && chapter.status === "published" && <button title="下线" onClick={() => onAction("offline", chapter.id)}>↓</button>}{chapter.status === "draft" && chapter.draftStatus === "draft" && <button title="删除" onClick={() => { if (confirm("确定删除这个草稿吗？")) onAction("delete", chapter.id); }}>×</button>}</div></div>)}</div>
  </section></div>;
}

function ChapterSettings({ scope, chapter, story, setStory, assets, folders, onBack, onAssets, onEdit, onPreview, onSave }: {
  scope: StudioScope;
  chapter: ChapterRecord;
  story: StoryDocument;
  setStory: (story: StoryDocument) => void;
  assets: AssetRecord[];
  folders: AssetFolder[];
  onBack: () => void;
  onAssets: () => void;
  onEdit: () => void;
  onPreview: () => void;
  onSave: () => void;
}) {
  const locked = scope === "author" && chapter.draftStatus === "submitted";
  const lengthErrors = validateStoryBodyLengths(story);
  return <div className={`studio chapter-settings-page${locked ? " editor-locked" : ""}`}>
    <StudioAside scope={scope} active="chapters" onNovels={onBack} onChapters={onBack} onAssets={onAssets} />
    <section className="studio-main">
      <header><div><button className="back-link" onClick={onBack}>← 章节管理</button><p>CHAPTER SETTINGS</p><h1>章节设置</h1></div><div className="settings-actions"><button className="ghost" onClick={onAssets}>打开素材库</button><button className="ghost" onClick={onEdit}>编辑剧情</button><button className="ghost" disabled={lengthErrors.length > 0} onClick={onPreview}>预览阅读</button><button className="primary" disabled={locked || lengthErrors.length > 0} title={locked ? "审核中的草稿不可修改，请先撤回" : lengthErrors[0]} onClick={onSave}>保存设置</button></div></header>
      {locked && <p className="inline-message">章节正在审核中，作者暂时只能查看；管理员仍可编辑。</p>}
      <div className="chapter-settings-layout">
        <form className="chapter-settings-form" onSubmit={(event) => { event.preventDefault(); if (!locked) onSave(); }}>
          <label>章节名称<input disabled={locked} value={story.title} maxLength={100} onChange={(event) => setStory({ ...story, title: event.target.value })} /></label>
          <label>章节简介<textarea disabled={locked} rows={5} maxLength={1000} value={story.summary} onChange={(event) => setStory({ ...story, summary: event.target.value })} /></label>
          <fieldset disabled={locked}><legend>可选章节开场图</legend><AssetSelect label="章节开场图" type="image" value={story.openingImageAssetId || story.openingImageUrl} assets={assets} folders={folders} onChange={(id, url) => setStory({ ...story, openingImageAssetId: id, openingImageUrl: url, coverAssetId: id, coverUrl: url })} /><label>开场图替代文本<input maxLength={500} value={story.openingImageAlt} placeholder="留空图片时将使用小说封面" onChange={(event) => setStory({ ...story, openingImageAlt: event.target.value, coverAlt: event.target.value })} /></label><ImagePresentationEditor value={story.openingImagePresentation} url={story.openingImageUrl} alt={story.openingImageAlt} onChange={(openingImagePresentation) => setStory({ ...story, openingImagePresentation })} /></fieldset>
          <fieldset disabled={locked}><legend>统一收尾页</legend><AssetSelect label="章节收尾图" type="image" value={story.outroImageAssetId || story.outroImageUrl} assets={assets} folders={folders} onChange={(id, url) => setStory({ ...story, outroImageAssetId: id, outroImageUrl: url })} /><label>收尾图替代文本<input maxLength={500} value={story.outroImageAlt} placeholder="描述人物立绘或场景" onChange={(event) => setStory({ ...story, outroImageAlt: event.target.value })} /></label><ImagePresentationEditor value={story.outroImagePresentation} url={story.outroImageUrl} alt={story.outroImageAlt} onChange={(outroImagePresentation) => setStory({ ...story, outroImagePresentation })} /></fieldset>
        </form>
        <div className="chapter-live-previews">
          <ChapterSettingsPreview kind="cover" story={story} />
          <ChapterSettingsPreview kind="outro" story={story} />
        </div>
      </div>
    </section>
  </div>;
}

function ChapterSettingsPreview({ kind, story }: { kind: "cover" | "outro"; story: StoryDocument }) {
  const isCover = kind === "cover";
  const url = isCover ? story.openingImageUrl : story.outroImageUrl;
  const alt = isCover ? story.openingImageAlt : story.outroImageAlt;
  const presentation = isCover ? story.openingImagePresentation : story.outroImagePresentation;
  return <section className="chapter-settings-preview"><p>{isCover ? "封面开场实时预览" : "章节收尾实时预览"}</p><div>
    {url ? <Image src={url} alt={alt || (isCover ? "开场图预览" : "收尾图预览")} fill sizes="320px" unoptimized style={{ objectFit: presentation.fit, objectPosition: `${presentation.positionX}% ${presentation.positionY}%` }} /> : <span className="settings-image-placeholder">{alt || (isCover ? "未设置时使用小说封面" : "选择图片后在此预览")}</span>}
    <div className="settings-preview-copy"><small>{isCover ? "INTERACTIVE FICTION" : "CHAPTER COMPLETE"}</small><h2>{story.title || "未命名章节"}</h2>{isCover ? <><p>{story.summary || "章节简介将在这里显示。"}</p><b>开始阅读</b></> : <><p>本章完</p><b>返回书架　 阅读下一章</b></>}</div>
  </div></section>;
}

type ManagedUser = {
  id: string;
  email: string;
  displayName: string;
  role: "reader" | "author" | "admin";
  status: "pending" | "active" | "disabled";
  emailVerifiedAt: string | null;
  createdAt: string;
};

function UserManager({ onBack, onAssets, onAccessStatus }: { onBack: () => void; onAssets: () => void; onAccessStatus: ReconcileOperationAccess }) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const response = await fetch("/admin/api/users");
    if (await onAccessStatus(response.status)) return;
    const data = await response.json() as { users?: ManagedUser[]; error?: string };
    if (!response.ok) { setMessage(data.error || "用户加载失败"); return; }
    setUsers(data.users || []);
  }, [onAccessStatus]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const update = async (id: string, patch: Partial<Pick<ManagedUser, "role" | "status">>) => {
    const response = await fetch("/admin/api/users", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
    });
    if (await onAccessStatus(response.status)) return;
    const data = await response.json() as { error?: string };
    if (!response.ok) { setMessage(data.error || "用户更新失败"); return; }
    setMessage("用户权限已更新");
    await load();
  };
  return <div className="studio"><StudioAside scope="admin" active="users" onNovels={onBack} onAssets={onAssets} onUsers={() => {}} /><section className="studio-main user-manager"><header><div><button className="back-link" onClick={onBack}>← 小说管理</button><p>ACCESS CONTROL</p><h1>用户与角色</h1></div></header>{message && <p className="inline-message" role="status">{message}</p>}<div className="user-table"><div className="user-row user-head"><span>用户</span><span>邮箱状态</span><span>角色</span><span>账号状态</span></div>{users.map((user) => <div className="user-row" key={user.id}><span><b>{user.displayName}</b><small>{user.email}<br />{new Date(user.createdAt).toLocaleDateString("zh-CN")}</small></span><span>{user.emailVerifiedAt ? "已验证" : "待验证"}</span><select aria-label={`${user.displayName}的角色`} value={user.role} disabled={user.status === "pending"} onChange={(event) => void update(user.id, { role: event.target.value as ManagedUser["role"] })}><option value="reader">读者</option><option value="author">作者</option><option value="admin">管理员</option></select><select aria-label={`${user.displayName}的状态`} value={user.status === "pending" ? "pending" : user.status} disabled={user.status === "pending"} onChange={(event) => void update(user.id, { status: event.target.value as "active" | "disabled" })}><option value="pending" disabled>待验证</option><option value="active">正常</option><option value="disabled">禁用</option></select></div>)}</div></section></div>;
}

function StoryEditor({ scope, apiBase, chapter, story, setStory, assets, folders, onAssetCreated, onBack, onSettings, onAssets, onPreview, onSave, onPublish, onRollback, onAccessStatus, shortMode = false }: {
  scope: StudioScope;
  apiBase: string;
  chapter: ChapterRecord;
  story: StoryDocument;
  setStory: (story: StoryDocument) => void;
  assets: AssetRecord[];
  folders: AssetFolder[];
  onAssetCreated: (asset: AssetRecord) => void;
  onBack: () => void;
  onSettings: () => void;
  onAssets: () => void;
  onPreview: (nodeId: string) => void;
  onSave: (chapter: ChapterRecord, snapshot: StoryDocument) => Promise<{ updatedAt: string }>;
  onPublish: () => void;
  onRollback: (version: number) => void;
  onAccessStatus: ReconcileOperationAccess;
  shortMode?: boolean;
}) {
  const [selectedId, setSelectedId] = useState(story.startNodeId);
  const [tab, setTab] = useState<"content" | "image" | "music" | "terminal" | "versions">("content");
  const [versions, setVersions] = useState<{ version: number; createdAt: string }[]>([]);
  const [saveStatus, setSaveStatus] = useState<"saved" | "dirty" | "saving" | "error" | "blocked">("saved");
  const [saveMessage, setSaveMessage] = useState("");
  const bodyEditor = useRef<HTMLTextAreaElement>(null);
  const chapterRef = useRef(chapter);
  const latestStoryRef = useRef(story);
  const latestSignatureRef = useRef(JSON.stringify(story));
  const savedSignatureRef = useRef(JSON.stringify(story));
  const savingRef = useRef(false);
  const queuedSaveRef = useRef(false);
  const runSaveRef = useRef<() => Promise<void>>(async () => {});
  const recoveryKey = `fantasy-studio-draft:${chapter.id}`;
  useEffect(() => { chapterRef.current = chapter; }, [chapter]);
  useEffect(() => {
    let active = true;
    queueMicrotask(async () => {
      const response = await fetch(`${apiBase}/chapters/versions?chapterId=${chapter.id}`);
      if (await onAccessStatus(response.status) || !active) return;
      const data = await response.json() as { versions?: { version: number; createdAt: string }[] };
      if (active) setVersions(data.versions || []);
    });
    return () => { active = false; };
  }, [apiBase, chapter.id, onAccessStatus]);
  const shortLengthError = shortMode && countStoryBodyCharacters(story) > SHORT_STORY_MAX_LENGTH
    ? `短篇正文超过 ${SHORT_STORY_MAX_LENGTH} 字上限` : "";
  const errors = useMemo(() => [
    ...validateStory(story, { validateBodyLengths: !shortMode }),
    ...(shortMode && countStoryBodyCharacters(story) > SHORT_STORY_MAX_LENGTH ? [`短篇正文超过 ${SHORT_STORY_MAX_LENGTH} 字上限`] : []),
  ], [shortMode, story]);
  const publishErrors = useMemo(() => [...errors, ...validateStoryMedia(story)], [errors, story]);
  const lengthErrors = useMemo(() => shortMode ? (shortLengthError ? [shortLengthError] : []) : validateStoryBodyLengths(story), [shortLengthError, shortMode, story]);
  const hardInputErrors = useMemo(() => [...(shortMode ? [] : lengthErrors), ...validateStoryInputLengths(story)], [lengthErrors, shortMode, story]);
  const warnings = useMemo(() => [...getStoryBodyWarnings(story), ...getStoryTerminalWarnings(story)], [story]);
  const locked = scope === "author" && chapter.draftStatus === "submitted";
  const persistLatest = useCallback(async () => {
    if (locked) return;
    if (savingRef.current) {
      queuedSaveRef.current = true;
      return;
    }
    const snapshot = structuredClone(latestStoryRef.current);
    const signature = JSON.stringify(snapshot);
    const hardErrors = [
      ...(shortMode ? [] : validateStoryBodyLengths(snapshot)),
      ...validateStoryInputLengths(snapshot),
    ];
    if (hardErrors.length > 0) {
      setSaveStatus("blocked");
      setSaveMessage(hardErrors[0]);
      return;
    }
    if (signature === savedSignatureRef.current) {
      setSaveStatus("saved");
      setSaveMessage("");
      return;
    }
    savingRef.current = true;
    setSaveStatus("saving");
    setSaveMessage("");
    try {
      await onSave(chapterRef.current, snapshot);
      savedSignatureRef.current = signature;
      if (latestSignatureRef.current === signature) {
        localStorage.removeItem(recoveryKey);
        setSaveStatus("saved");
      } else {
        queuedSaveRef.current = true;
        setSaveStatus("dirty");
      }
    } catch (error) {
      setSaveStatus("error");
      setSaveMessage(error instanceof Error ? error.message : "自动保存失败");
    } finally {
      savingRef.current = false;
      if (queuedSaveRef.current && latestSignatureRef.current !== savedSignatureRef.current) {
        queuedSaveRef.current = false;
        setTimeout(() => void runSaveRef.current(), 0);
      }
    }
  }, [locked, onSave, recoveryKey, shortMode]);
  useEffect(() => { runSaveRef.current = persistLatest; }, [persistLatest]);
  useEffect(() => {
    const signature = JSON.stringify(story);
    latestStoryRef.current = story;
    latestSignatureRef.current = signature;
    if (signature === savedSignatureRef.current || locked) return;
    const cached = { story, updatedAt: new Date().toISOString() };
    localStorage.setItem(recoveryKey, JSON.stringify(cached));
    if (savingRef.current) queuedSaveRef.current = true;
    else queueMicrotask(() => setSaveStatus(hardInputErrors.length > 0 ? "blocked" : "dirty"));
    if (hardInputErrors.length > 0) {
      queueMicrotask(() => setSaveMessage(hardInputErrors[0]));
      return;
    }
    queueMicrotask(() => setSaveMessage(""));
    const timer = setTimeout(() => void runSaveRef.current(), 800);
    return () => clearTimeout(timer);
  }, [hardInputErrors, locked, recoveryKey, story]);
  useEffect(() => {
    const raw = localStorage.getItem(recoveryKey);
    if (!raw) return;
    try {
      const cached = JSON.parse(raw) as { story?: unknown; updatedAt?: string };
      const cachedAt = Date.parse(cached.updatedAt || "");
      const serverAt = Date.parse(chapterRef.current.updatedAt || "");
      if (!cached.story || !(cachedAt > serverAt) || JSON.stringify(cached.story) === savedSignatureRef.current) return;
      if (window.confirm("检测到上次未保存的剧情修改，是否恢复？")) {
        queueMicrotask(() => setStory(normalizeStory(cached.story as StoryDocument)));
      } else {
        localStorage.removeItem(recoveryKey);
      }
    } catch {
      localStorage.removeItem(recoveryKey);
    }
  }, [recoveryKey, setStory]);
  const selected = story.nodes.find((node) => node.id === selectedId) || story.nodes[0];
  const bodyLength = countStoryCharacters(selected?.body || "");
  const bodyLimit = shortMode ? SHORT_STORY_MAX_LENGTH : NODE_BODY_MAX_LENGTH;
  const pageInspection = useMemo(() => inspectReadingPages(story, selected?.id || story.startNodeId), [selected?.id, story]);
  const updateNode = (patch: Partial<StoryNode>) => setStory({ ...story, nodes: story.nodes.map((node) => node.id === selected.id ? { ...node, ...patch } : node) });
  const insertPageBreak = () => {
    if (!selected) return;
    const selectionStart = bodyEditor.current?.selectionStart ?? selected.body.length;
    const selectionEnd = bodyEditor.current?.selectionEnd ?? selectionStart;
    const before = selected.body.slice(0, selectionStart);
    const after = selected.body.slice(selectionEnd);
    const prefix = before && !before.endsWith("\n") ? "\n\n" : "";
    const suffix = after && !after.startsWith("\n") ? "\n\n" : "";
    const inserted = `${prefix}${STORY_PAGE_BREAK}${suffix}`;
    updateNode({ body: `${before}${inserted}${after}` });
    const cursor = selectionStart + inserted.length;
    requestAnimationFrame(() => {
      bodyEditor.current?.focus();
      bodyEditor.current?.setSelectionRange(cursor, cursor);
    });
  };
  const duplicateNode = () => { const node = { ...structuredClone(selected), id: `node-${Date.now().toString(36)}`, title: `${selected.title}（副本）`, position: { x: selected.position.x + 40, y: selected.position.y + 40 }, choices: selected.choices.map((choice) => ({ ...choice, id: crypto.randomUUID() })) }; setStory({ ...story, nodes: [...story.nodes, node] }); setSelectedId(node.id); };
  const removeNode = (nodeId = selected.id) => {
    const target = story.nodes.find((node) => node.id === nodeId);
    if (!target || target.id === story.startNodeId) return;
    const links = story.nodes.reduce((count, node) => count + node.choices.filter((choice) => choice.targetId === target.id).length, target.choices.length);
    if (!confirm(`删除「${target.title}」并移除 ${links} 条关联连线？`)) return;
    setStory({ ...story, nodes: story.nodes.filter((node) => node.id !== target.id).map((node) => ({ ...node, choices: node.choices.filter((choice) => choice.targetId !== target.id) })) }); setSelectedId(story.startNodeId);
  };
  const autoLayout = () => {
    const depth = new Map<string, number>([[story.startNodeId, 0]]); const queue = [story.startNodeId];
    while (queue.length) { const id = queue.shift()!; const level = depth.get(id) || 0; story.nodes.find((node) => node.id === id)?.choices.forEach((choice) => { if (!depth.has(choice.targetId)) { depth.set(choice.targetId, level + 1); queue.push(choice.targetId); } }); }
    const rows = new Map<number, number>();
    setStory({ ...story, nodes: story.nodes.map((node) => { const level = depth.get(node.id) ?? Math.max(...depth.values(), 0) + 1; const row = rows.get(level) || 0; rows.set(level, row + 1); return { ...node, position: { x: level * 300 + 40, y: row * 190 + 50 } }; }) });
  };
  if (!selected) return null;
  const saveLabel = locked ? "审核中（已锁定）" : saveStatus === "dirty" ? "有未保存修改" : saveStatus === "saving" ? "正在保存" : saveStatus === "error" ? "保存失败" : saveStatus === "blocked" ? "等待修正后保存" : "已保存";
  return <div className={`editor${locked ? " editor-locked" : ""}`}><header className="editor-top"><button className="back" onClick={onBack}>←</button><div><small>正在编辑剧情</small><strong>{story.title || "未命名章节"}</strong></div><span className={`save-state ${saveStatus}`} title={saveMessage}>● {saveLabel}</span><button className="ghost" onClick={onSettings}>章节设置</button><button className="ghost" disabled={lengthErrors.length > 0} title={lengthErrors[0]} onClick={() => onPreview(selectedId)}>从当前节点预览</button><button className="ghost" disabled={locked || saveStatus === "saving" || saveStatus === "blocked"} title={locked ? "审核中的草稿不可修改，请先撤回" : saveMessage} onClick={() => void persistLatest()}>{saveStatus === "error" ? "重试保存" : "立即保存"}</button><button className="primary" disabled={locked || publishErrors.length > 0} title={locked ? "章节已在审核中" : publishErrors[0]} onClick={onPublish}>{scope === "admin" ? "发布章节" : "提交审核"}</button></header>
    <div className="flow-editor"><StoryFlow story={story} setStory={setStory} selectedId={selectedId} onSelect={setSelectedId} onDuplicate={duplicateNode} onDelete={removeNode} onAutoLayout={autoLayout} />
      <section className="edit-form flow-inspector"><div className="tabs"><button className={tab === "content" ? "active" : ""} onClick={() => setTab("content")}>节点内容</button><button className={tab === "image" ? "active" : ""} onClick={() => setTab("image")}>独立图片</button><button className={tab === "music" ? "active" : ""} onClick={() => setTab("music")}>音乐编排</button><button className={tab === "terminal" ? "active" : ""} onClick={() => setTab("terminal")}>小雾设置</button><button onClick={onAssets}>素材库</button><button className={tab === "versions" ? "active" : ""} onClick={() => setTab("versions")}>发布记录</button></div>
      {tab === "content" ? <>
        <div className="form-intro"><div><p>NODE / {selected.id.toUpperCase()}</p><h2>{selected.title}</h2></div><div className="node-actions"><button onClick={duplicateNode}>复制</button><button className="danger" disabled={selected.id === story.startNodeId} onClick={() => removeNode()}>删除</button></div></div>
        <label>起始节点<select value={story.startNodeId} onChange={(event) => setStory({ ...story, startNodeId: event.target.value })}>{story.nodes.map((node) => <option key={node.id} value={node.id}>{node.title} · {node.id}</option>)}</select></label>
        <label>节点标题<input value={selected.title} onChange={(event) => updateNode({ title: event.target.value })} /></label>
        <label className="body-editor"><span className="body-editor-head"><span>正文</span><button type="button" onClick={insertPageBreak}>＋ 插入分页</button></span><textarea ref={bodyEditor} rows={8} value={selected.body} onChange={(event) => updateNode({ body: event.target.value })} /><span className={`body-editor-meta${bodyLength > bodyLimit ? " error" : bodyLength > NODE_BODY_RECOMMENDED_LENGTH ? " warning" : ""}`}><span>{shortMode ? `${countStoryBodyCharacters(story)} / ${SHORT_STORY_MAX_LENGTH} 字（全文）` : `${bodyLength} / ${NODE_BODY_MAX_LENGTH} 字`}</span><span>预计 {pageInspection.pages.length} 页</span></span>
          {bodyLength > bodyLimit && <span className="body-editor-notice error">已超过正文上限，请删减后再预览或提交。</span>}
          {bodyLength > NODE_BODY_RECOMMENDED_LENGTH && bodyLength <= bodyLimit && <span className="body-editor-notice warning">正文超过建议的 {NODE_BODY_RECOMMENDED_LENGTH} 字，可拆成节点或插入分页控制节奏。</span>}
        </label>
        <ReadingRhythmPanel story={story} nodeId={selected.id} />
        <div className="two-col"><label className="toggle-field"><input type="checkbox" checked={selected.canEndChapter} onChange={(event) => updateNode({ canEndChapter: event.target.checked, type: event.target.checked ? "ending" : "scene" })} /><span>允许读者在此结束本章</span><small>可与剧情选项同时存在。</small></label><label>文字动画<select value={selected.animation} onChange={(event) => updateNode({ animation: event.target.value as StoryNode["animation"] })}><option value="none">无</option><option value="fade">淡入</option><option value="rise">上浮</option><option value="flash">闪白</option></select></label></div>
        <AssetSelect label="场景背景图 / 视频封面" type="image" value={selected.imageAssetId || selected.imageUrl} assets={assets} folders={folders} onChange={(id, url) => updateNode({ imageAssetId: id, imageUrl: url })} />
        {(selected.imageAssetId || selected.imageUrl) && <><label>背景图替代文本<input value={selected.imageAlt} placeholder="描述画面内容，供图片加载失败及无障碍阅读使用" onChange={(event) => updateNode({ imageAlt: event.target.value })} /></label><ImagePresentationEditor value={selected.imagePresentation} url={selected.imageUrl} alt={selected.imageAlt} onChange={(imagePresentation) => updateNode({ imagePresentation })} /></>}
        <div className="two-col"><AssetSelect label="场景视频" type="video" value={selected.videoAssetId || selected.videoUrl} assets={assets} folders={folders} onChange={(id, url) => updateNode({ videoAssetId: id, videoUrl: url, videoMode: id ? selected.videoMode === "none" ? "background" : selected.videoMode : "none" })} /><label>视频模式<select value={selected.videoMode} disabled={!selected.videoAssetId && !selected.videoUrl} onChange={(event) => updateNode({ videoMode: event.target.value as StoryNode["videoMode"] })}><option value="none">不播放</option><option value="background">静音循环背景</option><option value="transition">独立过场</option></select></label></div>
        <ChoiceEditor
          apiBase={apiBase}
          node={selected}
          story={story}
          assets={assets}
          folders={folders}
          onAssetCreated={onAssetCreated}
          onAccessStatus={onAccessStatus}
          onChange={(choices) => updateNode({ choices })}
        />
        <div className={`validation ${publishErrors.length ? "has-errors" : warnings.length ? "has-warnings" : "valid"}`}><b>{publishErrors.length ? `发现 ${publishErrors.length} 个发布问题` : warnings.length ? `结构检查通过，另有 ${warnings.length} 条创作建议` : "故事结构与媒体检查通过"}</b>{publishErrors.map((error) => <p key={error}>• {error}</p>)}{warnings.map((warning) => <p key={warning}>⚠ {warning}</p>)}</div>
      </> : tab === "image" ? <NodeDisplayImageEditor node={selected} assets={assets} folders={folders} onChange={updateNode} /> : tab === "music" ? <MusicCueEditor story={story} assets={assets} folders={folders} setStory={setStory} /> : tab === "terminal" ? <TerminalEditor apiBase={apiBase} story={story} node={selected} assets={assets} folders={folders} onAssetCreated={onAssetCreated} setStory={setStory} onChangeNode={updateNode} onAccessStatus={onAccessStatus} /> : <div className="version-panel"><h2>发布记录</h2>{versions.map((item) => <div key={item.version}><span><b>版本 v{item.version}</b><small>{new Date(item.createdAt).toLocaleString("zh-CN")}</small></span>{item.version === chapter.version ? <em>当前版本</em> : scope === "admin" ? <button onClick={() => { if (confirm(`恢复版本 v${item.version}？`)) onRollback(item.version); }}>恢复</button> : null}</div>)}</div>}</section>
    </div></div>;
}

const interactionLabels: Record<InteractionPreset, string> = {
  none: "无动画",
  glow: "柔光",
  ripple: "涟漪",
  shake: "震动",
  flash: "闪光",
  glitch: "故障",
  push: "推进",
};

function ChoiceEditor({ apiBase, node, story, assets, folders, onAssetCreated, onAccessStatus, onChange }: {
  apiBase: string;
  node: StoryNode;
  story: StoryDocument;
  assets: AssetRecord[];
  folders: AssetFolder[];
  onAssetCreated: (asset: AssetRecord) => void;
  onAccessStatus: ReconcileOperationAccess;
  onChange: (choices: StoryChoice[]) => void;
}) {
  const patchChoice = (id: string, patch: Partial<StoryChoice>) => {
    onChange(node.choices.map((choice) => choice.id === id ? { ...choice, ...patch } : choice));
  };
  const targetId = story.nodes.find((item) => item.id !== node.id)?.id || node.id;
  return <section className="choice-editor">
    <div className="choice-editor-heading"><div><h3>剧情选项</h3><p>点击后依次播放音效、互动反馈，再进入目标节点。</p></div><button type="button" onClick={() => onChange([...node.choices, createStoryChoice({ id: crypto.randomUUID(), label: "新的选择", targetId })])}>＋ 添加选项</button></div>
    <div className="choice-card-list">{node.choices.map((choice, index) => <ChoiceCard
      key={choice.id}
      apiBase={apiBase}
      choice={choice}
      story={story}
      index={index}
      nodes={story.nodes}
      assets={assets}
      folders={folders}
      onAssetCreated={onAssetCreated}
      onAccessStatus={onAccessStatus}
      onChange={(patch) => patchChoice(choice.id, patch)}
      onDelete={() => onChange(node.choices.filter((item) => item.id !== choice.id))}
    />)}</div>
    {node.choices.length === 0 && <div className="empty compact"><b>此节点尚无剧情选项</b><p>如果它也不允许结束本章，发布检查会提示补充路径。</p></div>}
  </section>;
}

function ChoiceCard({ apiBase, choice, story, index, nodes, assets, folders, onAssetCreated, onAccessStatus, onChange, onDelete }: {
  apiBase: string;
  choice: StoryChoice;
  story: StoryDocument;
  index: number;
  nodes: StoryNode[];
  assets: AssetRecord[];
  folders: AssetFolder[];
  onAssetCreated: (asset: AssetRecord) => void;
  onAccessStatus: ReconcileOperationAccess;
  onChange: (patch: Partial<StoryChoice>) => void;
  onDelete: () => void;
}) {
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState("");
  const [sfxPrompt, setSfxPrompt] = useState("");
  const [generationDurationSeconds, setGenerationDurationSeconds] = useState(SFX_GENERATION_DEFAULT_SECONDS);
  const selectedSfx = assets.find((asset) => asset.id === choice.sfxAssetId);
  const suggestedPrompt = suggestChoiceSfxPrompt(choice.label, choice.interactionPreset);
  const effectivePrompt = sfxPrompt || suggestedPrompt;
  const effects = [
    choice.interactionPreset !== "none" ? interactionLabels[choice.interactionPreset] : "",
    choice.sfxAssetId || choice.sfxUrl ? choice.sfxMaxDurationMs > 0 ? `音效 ≤ ${(choice.sfxMaxDurationMs / 1000).toFixed(1)} 秒` : "音效自然播放" : "",
    choice.feedbackImageAssetId || choice.feedbackImageUrl ? `图片 ${(choice.feedbackImageDurationMs / 1000).toFixed(1)} 秒` : "",
    choice.terminalFeedbackEnabled ? "✦ 小雾反馈" : "",
  ].filter(Boolean);
  const generateSfx = async () => {
    setGenerating(true);
    setGenerationError("");
    try {
      const response = await fetch(`${apiBase}/assets/sfx`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          choiceText: choice.label,
          interactionPreset: choice.interactionPreset,
          prompt: effectivePrompt,
          generationDurationSeconds,
        }),
      });
      if (await onAccessStatus(response.status)) return;
      const data = await response.json() as { asset?: AssetRecord; error?: string };
      if (!response.ok || !data.asset) throw new Error(data.error || "音效生成失败");
      onAssetCreated(data.asset);
      onChange({ sfxAssetId: data.asset.id, sfxUrl: data.asset.url });
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : "音效生成失败");
    } finally {
      setGenerating(false);
    }
  };
  return <article className="choice-card">
    <div className="choice-card-main"><span className="choice-index">{String(index + 1).padStart(2, "0")}</span><label>选项文字<input maxLength={200} value={choice.label} onChange={(event) => onChange({ label: event.target.value })} /></label><label>目标节点<select value={choice.targetId} onChange={(event) => onChange({ targetId: event.target.value })}>{nodes.map((node) => <option value={node.id} key={node.id}>{node.title} · {node.id}</option>)}</select></label><button type="button" className="danger choice-delete" aria-label={`删除选项 ${choice.label}`} onClick={onDelete}>删除</button></div>
    <div className="choice-effect-summary"><span>互动反馈</span>{effects.length ? effects.map((effect) => <i key={effect}>{effect}</i>) : <small>未设置</small>}</div>
    <details className="choice-effects"><summary>编辑互动效果</summary><div className="choice-effects-body">
      <label>互动动画<select value={choice.interactionPreset} onChange={(event) => onChange({ interactionPreset: event.target.value as InteractionPreset })}>{Object.entries(interactionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <div className="choice-sfx-editor"><AssetSelect label="点击音效" type="audio" value={choice.sfxAssetId || choice.sfxUrl} assets={assets} folders={folders} onChange={(sfxAssetId, sfxUrl) => onChange({ sfxAssetId, sfxUrl })} />
        <div className="ai-sfx-generator"><div className="ai-sfx-heading"><b>AI 音效生成</b><button type="button" className="text-button" onClick={() => setSfxPrompt("")}>使用系统建议</button></div><label>音效描述<textarea rows={3} maxLength={450} value={effectivePrompt} onChange={(event) => setSfxPrompt(event.target.value)} /></label><small>{Array.from(effectivePrompt).length} / 450 字 · 描述声音本身，不要填写对白</small><div className="duration-control"><label>AI 生成长度 <b>{generationDurationSeconds.toFixed(1)} 秒</b><input type="range" min="0.5" max="30" step="0.1" value={generationDurationSeconds} onChange={(event) => setGenerationDurationSeconds(Number(event.target.value))} /></label><input aria-label="AI 生成长度（秒）" type="number" min="0.5" max="30" step="0.1" value={generationDurationSeconds} onChange={(event) => setGenerationDurationSeconds(Math.max(0.5, Math.min(30, Number(event.target.value) || 0.5)))} /></div><button type="button" disabled={generating || !choice.label.trim() || !effectivePrompt.trim()} onClick={() => void generateSfx()}>{generating ? "AI 正在生成…" : choice.sfxAssetId ? "重新生成 AI 音效" : "生成 AI 音效"}</button></div>
      </div>
      {(choice.sfxAssetId || choice.sfxUrl) && <div className="choice-sfx-preview"><label>音效音量 {Math.round(Math.max(0, Math.min(1, choice.sfxVolume)) * 100)}%<input type="range" min="0" max="1" step="0.05" value={Math.max(0, Math.min(1, choice.sfxVolume))} onChange={(event) => onChange({ sfxVolume: Number(event.target.value) })} /></label><audio controls preload="metadata" src={choice.sfxUrl}>{selectedSfx?.name}</audio><label>音效播放方式<select value={choice.sfxMaxDurationMs > 0 ? "limited" : "natural"} onChange={(event) => onChange({ sfxMaxDurationMs: event.target.value === "limited" ? 1200 : 0 })}><option value="natural">自然播放完</option><option value="limited">限制最长时间</option></select></label>{choice.sfxMaxDurationMs > 0 && <div className="duration-control"><label>最长播放 <b>{(choice.sfxMaxDurationMs / 1000).toFixed(1)} 秒</b><input type="range" min="100" max="30000" step="100" value={choice.sfxMaxDurationMs} onChange={(event) => onChange({ sfxMaxDurationMs: Number(event.target.value) })} /></label><input aria-label="音效最长播放（秒）" type="number" min="0.1" max="30" step="0.1" value={choice.sfxMaxDurationMs / 1000} onChange={(event) => onChange({ sfxMaxDurationMs: Math.round(Math.max(0.1, Math.min(30, Number(event.target.value) || 0.1)) * 1000) })} /></div>}</div>}
      {generationError && <p className="field-error" role="alert">{generationError}</p>}
      <AssetSelect label="全屏反馈图片" type="image" value={choice.feedbackImageAssetId || choice.feedbackImageUrl} assets={assets} folders={folders} onChange={(feedbackImageAssetId, feedbackImageUrl) => onChange({ feedbackImageAssetId, feedbackImageUrl })} />
      {(choice.feedbackImageAssetId || choice.feedbackImageUrl) && <><label>反馈图片替代文本<input maxLength={500} value={choice.feedbackImageAlt} placeholder="描述图片内容" onChange={(event) => onChange({ feedbackImageAlt: event.target.value })} /></label><div className="duration-control"><label>图片展示时长 <b>{(choice.feedbackImageDurationMs / 1000).toFixed(1)} 秒</b><input type="range" min="100" max="30000" step="100" value={choice.feedbackImageDurationMs} onChange={(event) => onChange({ feedbackImageDurationMs: Number(event.target.value) })} /></label><input aria-label="反馈图片展示时长（秒）" type="number" min="0.1" max="30" step="0.1" value={choice.feedbackImageDurationMs / 1000} onChange={(event) => onChange({ feedbackImageDurationMs: Math.round(Math.max(0.1, Math.min(30, Number(event.target.value) || 0.1)) * 1000) })} /></div><ImagePresentationEditor value={choice.feedbackImagePresentation} url={choice.feedbackImageUrl} alt={choice.feedbackImageAlt} onChange={(feedbackImagePresentation) => onChange({ feedbackImagePresentation })} /></>}
      <ChoiceTerminalEditor apiBase={apiBase} choice={choice} story={story} assets={assets} folders={folders} onAssetCreated={onAssetCreated} onAccessStatus={onAccessStatus} onChange={onChange} />
      <p className="help-copy compact">图片结束后立即进入目标节点；音效可继续跨节点播放，直到自然结束或达到最长时间。</p>
    </div></details>
  </article>;
}

const terminalTaskStatusLabels: Record<TerminalTaskStatus, string> = {
  active: "进行中",
  completed: "已完成",
  failed: "已失败",
};

function ChoiceTerminalEditor({ apiBase, choice, story, assets, folders, onAssetCreated, onAccessStatus, onChange }: {
  apiBase: string;
  choice: StoryChoice;
  story: StoryDocument;
  assets: AssetRecord[];
  folders: AssetFolder[];
  onAssetCreated: (asset: AssetRecord) => void;
  onAccessStatus: ReconcileOperationAccess;
  onChange: (patch: Partial<StoryChoice>) => void;
}) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const expectedSourceKey = terminalVoiceSourceKey(story.terminal.voiceId, choice.terminalMessage);
  const voiceStale = choice.terminalSpeak
    && choice.terminalVoiceSourceKey !== "manual"
    && choice.terminalVoiceSourceKey !== expectedSourceKey;
  const objectiveOptions = new Map(story.terminal.initialTask.objectives.map((objective) => [objective.id, objective.label]));
  story.nodes.forEach((node) => node.choices.forEach((item) => item.terminalTaskActions.forEach((action) => {
    if (action.objective) objectiveOptions.set(action.objective.id, action.objective.label);
    action.task?.objectives.forEach((objective) => objectiveOptions.set(objective.id, objective.label));
  })));
  const updateAction = (id: string, patch: Partial<TerminalTaskAction>) => onChange({
    terminalTaskActions: choice.terminalTaskActions.map((action) => action.id === id ? { ...action, ...patch } : action),
  });
  const addAction = () => onChange({
    terminalTaskActions: [...choice.terminalTaskActions, {
      id: crypto.randomUUID(), type: "addObjective", task: null,
      objective: { id: crypto.randomUUID(), label: "新任务目标", status: "active" },
      objectiveId: "", status: "active",
    }],
  });
  const generateVoice = async () => {
    setGenerating(true); setError("");
    try {
      const response = await fetch(`${apiBase}/assets/tts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: choice.terminalMessage, voiceId: story.terminal.voiceId, voiceName: story.terminal.voiceName }),
      });
      if (await onAccessStatus(response.status)) return;
      const data = await response.json() as { asset?: AssetRecord; sourceKey?: string; error?: string };
      if (!response.ok || !data.asset || !data.sourceKey) throw new Error(data.error || "AI 语音生成失败");
      onAssetCreated(data.asset);
      onChange({ terminalVoiceAssetId: data.asset.id, terminalVoiceUrl: data.asset.url, terminalVoiceSourceKey: data.sourceKey });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "AI 语音生成失败");
    } finally { setGenerating(false); }
  };
  const previewTask = useMemo(() => applyTerminalTaskEvents(
    story,
    choice.terminalTaskActions.map((action) => action.id),
  ).task, [choice.terminalTaskActions, story]);
  const previewPlayback = useMemo<TerminalPlayback>(() => ({
    id: `studio-preview:${choice.id}`,
    message: choice.terminalMessage.trim() || "小雾发现了新的剧情信号。这里将展示台词与任务变化。",
    speak: choice.terminalSpeak,
    voiceUrl: choice.terminalVoiceUrl,
    interactionPreset: choice.interactionPreset,
    imageUrl: choice.feedbackImageUrl,
    imageAlt: choice.feedbackImageAlt,
    imagePresentation: choice.feedbackImagePresentation,
    task: previewTask,
    reaction: resolveTerminalReaction(choice),
  }), [choice, previewTask]);
  return <fieldset className="choice-terminal-editor"><legend>小雾反馈</legend>
    <label className="toggle-field"><input type="checkbox" checked={choice.terminalFeedbackEnabled} onChange={(event) => onChange({ terminalFeedbackEnabled: event.target.checked })} /><span>点击此选项后呼出小雾</span><small>小雾会结合当前图片、动作和点击音效给出反馈，完成后进入目标节点。</small></label>
    {choice.terminalFeedbackEnabled && <>
      <label>小雾台词<textarea rows={4} maxLength={300} value={choice.terminalMessage} onChange={(event) => onChange({ terminalMessage: event.target.value })} /><small>{Array.from(choice.terminalMessage).length} / 300 字</small></label>
      <label className="toggle-field"><input type="checkbox" checked={choice.terminalSpeak} onChange={(event) => onChange({ terminalSpeak: event.target.checked })} /><span>自动播放拟人语音</span></label>
      {choice.terminalSpeak && <div className="terminal-voice-generation">
        <AssetSelect label="小雾语音" type="audio" value={choice.terminalVoiceAssetId || choice.terminalVoiceUrl} assets={assets} folders={folders} onChange={(terminalVoiceAssetId, terminalVoiceUrl) => onChange({ terminalVoiceAssetId, terminalVoiceUrl, terminalVoiceSourceKey: terminalVoiceAssetId || terminalVoiceUrl ? "manual" : "" })} />
        <div className={`voice-generation-state${voiceStale ? " stale" : ""}`}><span>{choice.terminalVoiceAssetId || choice.terminalVoiceUrl ? voiceStale ? "AI 语音已过期，将使用设备朗读" : "AI 语音可用" : "未生成 AI 语音，将使用设备朗读"}</span><button type="button" disabled={generating || !choice.terminalMessage.trim() || !story.terminal.voiceId} onClick={() => void generateVoice()}>{generating ? "AI 正在生成…" : choice.terminalVoiceUrl ? "重新生成 AI 语音" : "生成 AI 语音"}</button></div>
        {!story.terminal.voiceId && <p className="help-copy compact">未选择 ElevenLabs 音色时仍可发布，读者设备会优先使用自然的中文系统音色朗读。</p>}
        {choice.terminalVoiceUrl && <audio controls preload="metadata" src={choice.terminalVoiceUrl} />}
        {error && <p className="field-error" role="alert">{error}</p>}
      </div>}
      <div className="terminal-task-actions"><div className="ai-sfx-heading"><b>本选项造成的任务变化</b><button type="button" onClick={addAction}>＋ 添加变化</button></div>
        {choice.terminalTaskActions.map((action, actionIndex) => <article key={action.id} className="terminal-task-action"><header><span>{String(actionIndex + 1).padStart(2, "0")}</span><select aria-label="任务变化类型" value={action.type} onChange={(event) => {
          const type = event.target.value as TerminalTaskAction["type"];
          updateAction(action.id, {
            type,
            task: type === "replaceTask" ? action.task || { id: crypto.randomUUID(), title: "新任务", description: "", status: "active", objectives: [{ id: crypto.randomUUID(), label: "新目标", status: "active" }] } : null,
            objective: type === "addObjective" ? action.objective || { id: crypto.randomUUID(), label: "新目标", status: "active" } : null,
          });
        }}><option value="replaceTask">替换当前任务</option><option value="addObjective">新增任务目标</option><option value="setObjectiveStatus">更新目标状态</option><option value="setTaskStatus">更新任务状态</option></select><button type="button" className="danger" onClick={() => onChange({ terminalTaskActions: choice.terminalTaskActions.filter((item) => item.id !== action.id) })}>删除</button></header>
          {action.type === "replaceTask" && action.task && <div className="task-action-fields">
            <label>新任务标题<input maxLength={100} value={action.task.title} onChange={(event) => updateAction(action.id, { task: { ...action.task!, title: event.target.value } })} /></label>
            <label>任务说明<textarea rows={2} maxLength={500} value={action.task.description} onChange={(event) => updateAction(action.id, { task: { ...action.task!, description: event.target.value } })} /></label>
            <div className="task-objective-list">{action.task.objectives.map((objective) => <label key={objective.id}>目标<input maxLength={200} value={objective.label} onChange={(event) => updateAction(action.id, { task: { ...action.task!, objectives: action.task!.objectives.map((item) => item.id === objective.id ? { ...item, label: event.target.value } : item) } })} /><button type="button" onClick={() => updateAction(action.id, { task: { ...action.task!, objectives: action.task!.objectives.filter((item) => item.id !== objective.id) } })}>×</button></label>)}
              <button type="button" onClick={() => updateAction(action.id, { task: { ...action.task!, objectives: [...action.task!.objectives, { id: crypto.randomUUID(), label: "新目标", status: "active" }] } })}>＋ 目标</button>
            </div>
          </div>}
          {action.type === "addObjective" && action.objective && <label>目标文字<input maxLength={200} value={action.objective.label} onChange={(event) => updateAction(action.id, { objective: { ...action.objective!, label: event.target.value } })} /></label>}
          {action.type === "setObjectiveStatus" && <div className="two-col"><label>目标<select value={action.objectiveId} onChange={(event) => updateAction(action.id, { objectiveId: event.target.value })}><option value="">请选择目标</option>{[...objectiveOptions].map(([id, label]) => <option key={id} value={id}>{label || id}</option>)}</select></label><label>状态<select value={action.status} onChange={(event) => updateAction(action.id, { status: event.target.value as TerminalTaskStatus })}>{Object.entries(terminalTaskStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>}
          {action.type === "setTaskStatus" && <label>任务状态<select value={action.status} onChange={(event) => updateAction(action.id, { status: event.target.value as TerminalTaskStatus })}>{Object.entries(terminalTaskStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
        </article>)}
        {choice.terminalTaskActions.length === 0 && <p className="help-copy compact">可以只让小雾说话，也可以在此更新她旁边的任务条。</p>}
      </div>
      <div className="terminal-preview-actions"><button type="button" onClick={() => setPreviewing(true)}>▶ 预览小雾反馈</button><small>使用当前未保存草稿模拟，不记录阅读进度或任务状态。</small></div>
      {previewing && <FantasyTerminal config={{ ...story.terminal, enabled: true }} playback={previewPlayback} task={previewTask} preview onPlaybackComplete={() => setPreviewing(false)} />}
    </>}
  </fieldset>;
}

function NodeDisplayImageEditor({ node, assets, folders, onChange }: {
  node: StoryNode;
  assets: AssetRecord[];
  folders: AssetFolder[];
  onChange: (patch: Partial<StoryNode>) => void;
}) {
  const enabled = node.displayImagePosition !== "none";
  return <div className="node-image-editor">
    <div className="panel-heading"><div><p>NODE IMAGE PAGE / {node.id.toUpperCase()}</p><h2>独立图片</h2></div><span className={`media-status ${enabled ? "enabled" : ""}`}>{enabled ? node.displayImagePosition === "before" ? "正文前" : "正文后" : "未启用"}</span></div>
    <p className="help-copy">当前节点：<b>{node.title}</b>。这是读者需要点击“继续”的单独图片页，不会替换节点场景背景。</p>
    <div className="two-col">
      <AssetSelect label="展示图片" type="image" value={node.displayImageAssetId || node.displayImageUrl} assets={assets} folders={folders} onChange={(displayImageAssetId, displayImageUrl) => onChange({ displayImageAssetId, displayImageUrl })} />
      <label>展示位置<select value={node.displayImagePosition} onChange={(event) => onChange({ displayImagePosition: event.target.value as StoryNode["displayImagePosition"] })}><option value="none">不展示</option><option value="before">节点正文前</option><option value="after">节点正文后</option></select></label>
    </div>
    {enabled && <><label>图片替代文本<input maxLength={500} value={node.displayImageAlt} placeholder="描述图片画面，加载失败时仍会显示" onChange={(event) => onChange({ displayImageAlt: event.target.value })} /></label>
      <ImagePresentationEditor value={node.displayImagePresentation} url={node.displayImageUrl} alt={node.displayImageAlt} onChange={(displayImagePresentation) => onChange({ displayImagePresentation })} />
      <div className="node-image-phone-preview">
        <div className={`node-image-preview-art ${node.displayImageUrl ? "" : "fallback"}`}>
          {node.displayImageUrl ? <Image src={node.displayImageUrl} alt={node.displayImageAlt || "独立图片预览"} fill sizes="260px" unoptimized style={{ objectFit: node.displayImagePresentation.fit, objectPosition: `${node.displayImagePresentation.positionX}% ${node.displayImagePresentation.positionY}%` }} /> : <span>F</span>}
        </div>
        <div className="node-image-preview-shade" />
        <div className="node-image-preview-copy"><small>{node.displayImagePosition === "before" ? "BEFORE THE SCENE" : "AFTER THE SCENE"}</small><b>{node.title}</b><span>继续　→</span></div>
      </div>
    </>}
    {!enabled && <div className="empty"><b>此节点尚未启用独立图片页</b><p>选择“节点正文前”或“节点正文后”即可配置并预览。</p></div>}
  </div>;
}

function TerminalEditor({ apiBase, story, node, assets, folders, onAssetCreated, setStory, onChangeNode, onAccessStatus }: {
  apiBase: string;
  story: StoryDocument;
  node: StoryNode;
  assets: AssetRecord[];
  folders: AssetFolder[];
  onAssetCreated: (asset: AssetRecord) => void;
  setStory: (story: StoryDocument) => void;
  onChangeNode: (patch: Partial<StoryNode>) => void;
  onAccessStatus: ReconcileOperationAccess;
}) {
  const [voices, setVoices] = useState<TerminalVoiceOption[]>([]);
  const [voiceQuery, setVoiceQuery] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [generating, setGenerating] = useState(false);
  const updateTerminal = (patch: Partial<StoryDocument["terminal"]>) => setStory({ ...story, terminal: { ...story.terminal, ...patch } });
  const updateEvent = (patch: Partial<StoryNode["terminalEvent"]>) => onChangeNode({ terminalEvent: { ...node.terminalEvent, ...patch } });
  const loadVoices = useCallback(async () => {
    setLoadingVoices(true); setVoiceError("");
    try {
      const response = await fetch(`${apiBase}/assets/tts`);
      if (await onAccessStatus(response.status)) return;
      const data = await response.json() as { voices?: TerminalVoiceOption[]; error?: string };
      if (!response.ok) throw new Error(data.error || "AI 音色加载失败");
      setVoices(data.voices || []);
    } catch (error) { setVoiceError(error instanceof Error ? error.message : "AI 音色加载失败"); }
    finally { setLoadingVoices(false); }
  }, [apiBase, onAccessStatus]);
  useEffect(() => { queueMicrotask(() => void loadVoices()); }, [loadVoices]);
  const filteredVoices = voices.filter((voice) => `${voice.name} ${Object.values(voice.labels).join(" ")}`.toLowerCase().includes(voiceQuery.toLowerCase()));
  const selectedVoice = voices.find((voice) => voice.id === story.terminal.voiceId);
  const expectedSourceKey = terminalVoiceSourceKey(story.terminal.voiceId, node.terminalEvent.message);
  const voiceStale = node.terminalEvent.speak && node.terminalEvent.voiceSourceKey !== "manual" && node.terminalEvent.voiceSourceKey !== expectedSourceKey;
  const customTerminalName = story.terminal.name === DEFAULT_STORY_TERMINAL.name ? "" : story.terminal.name;
  const generateNodeVoice = async () => {
    setGenerating(true); setVoiceError("");
    try {
      const response = await fetch(`${apiBase}/assets/tts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: node.terminalEvent.message, voiceId: story.terminal.voiceId, voiceName: story.terminal.voiceName }) });
      if (await onAccessStatus(response.status)) return;
      const data = await response.json() as { asset?: AssetRecord; sourceKey?: string; error?: string };
      if (!response.ok || !data.asset || !data.sourceKey) throw new Error(data.error || "AI 语音生成失败");
      onAssetCreated(data.asset);
      updateEvent({ voiceAssetId: data.asset.id, voiceUrl: data.asset.url, voiceSourceKey: data.sourceKey });
    } catch (error) { setVoiceError(error instanceof Error ? error.message : "AI 语音生成失败"); }
    finally { setGenerating(false); }
  };
  const updateInitialTask = (patch: Partial<StoryDocument["terminal"]["initialTask"]>) => updateTerminal({ initialTask: { ...story.terminal.initialTask, ...patch } });
  return <div className="terminal-editor"><div className="panel-heading"><div><p>XIAOWU GUIDE / {node.id.toUpperCase()}</p><h2>小雾设置</h2></div><span className={`media-status ${story.terminal.enabled ? "enabled" : ""}`}>{story.terminal.enabled ? "小雾在线" : "已关闭"}</span></div>
    <p className="help-copy">作者可以为本章选择稳定的 AI 音色；关键选项会唤出小雾，并同步她旁边的任务条。</p>
    <fieldset><legend>全章小雾</legend>
      <label className="toggle-field"><input type="checkbox" checked={story.terminal.enabled} onChange={(event) => updateTerminal({ enabled: event.target.checked })} /><span>启用小雾向导</span><small>关闭后本章阅读过程中不显示小雾或节点消息。</small></label>
      <div className="two-col"><label>故事频道副标题（可选）<input maxLength={30} value={customTerminalName} placeholder="例如：北境档案" onChange={(event) => updateTerminal({ name: event.target.value || DEFAULT_STORY_TERMINAL.name })} /></label><label>闲置形态<select value={story.terminal.idleMode} onChange={(event) => updateTerminal({ idleMode: event.target.value as StoryDocument["terminal"]["idleMode"] })}><option value="topTask">探头＋任务条</option><option value="corner">仅探头（推荐）</option></select></label></div>
      <div className="terminal-voice-browser"><div className="ai-sfx-heading"><b>ElevenLabs AI 音色</b><button type="button" onClick={() => void loadVoices()}>{loadingVoices ? "加载中…" : "刷新音色"}</button></div><input aria-label="搜索 AI 音色" value={voiceQuery} placeholder="搜索名称、性别或风格" onChange={(event) => setVoiceQuery(event.target.value)} /><select aria-label="章节 AI 音色" value={story.terminal.voiceId} onChange={(event) => { const voice = voices.find((item) => item.id === event.target.value); updateTerminal({ voiceId: voice?.id || "", voiceName: voice?.name || "" }); }}><option value="">请选择章节 AI 音色</option>{filteredVoices.map((voice) => <option key={voice.id} value={voice.id}>{voice.name}{voice.labels.gender ? ` · ${voice.labels.gender}` : ""}</option>)}</select>{selectedVoice?.previewUrl && <audio controls preload="none" src={selectedVoice.previewUrl} />}<small>推荐选择中文表现自然、年龄偏年轻的中性音色。音色变化后已有语音会标记为过期。</small></div>
      {voiceError && <p className="field-error" role="alert">{voiceError}</p>}
      <label className="toggle-field"><input type="checkbox" checked={story.terminal.autoSpeak} onChange={(event) => updateTerminal({ autoSpeak: event.target.checked })} /><span>节点消息自动播放预生成语音</span></label>
      <label>声音音量 {Math.round(story.terminal.volume * 100)}%<input type="range" min="0" max="1" step="0.05" value={story.terminal.volume} onChange={(event) => updateTerminal({ volume: Number(event.target.value) })} /></label>
    </fieldset>
    <fieldset><legend>初始当前任务</legend><p className="help-copy compact">读者进入本章时的任务状态；选项可以替换任务、增加目标或更新状态。</p><label>任务标题<input maxLength={100} value={story.terminal.initialTask.title} placeholder="例如：调查异常副本" onChange={(event) => updateInitialTask({ title: event.target.value })} /></label><label>任务说明<textarea rows={3} maxLength={500} value={story.terminal.initialTask.description} onChange={(event) => updateInitialTask({ description: event.target.value })} /></label><label>任务状态<select value={story.terminal.initialTask.status} onChange={(event) => updateInitialTask({ status: event.target.value as TerminalTaskStatus })}>{Object.entries(terminalTaskStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><div className="task-objective-list">{story.terminal.initialTask.objectives.map((objective) => <label key={objective.id}>初始目标<input maxLength={200} value={objective.label} onChange={(event) => updateInitialTask({ objectives: story.terminal.initialTask.objectives.map((item) => item.id === objective.id ? { ...item, label: event.target.value } : item) })} /><button type="button" onClick={() => updateInitialTask({ objectives: story.terminal.initialTask.objectives.filter((item) => item.id !== objective.id) })}>×</button></label>)}<button type="button" onClick={() => updateInitialTask({ objectives: [...story.terminal.initialTask.objectives, { id: crypto.randomUUID(), label: "新任务目标", status: "active" }] })}>＋ 添加初始目标</button></div></fieldset>
    <fieldset><legend>当前节点消息 · {node.title}</legend>
      <label>弹出位置<select value={node.terminalEvent.trigger} onChange={(event) => updateEvent({ trigger: event.target.value as StoryNode["terminalEvent"]["trigger"] })}><option value="none">此节点不弹出</option><option value="beforeContent">节点正文开始时</option><option value="afterContent">节点正文最后一页</option></select></label>
      <label>小雾台词<textarea rows={5} maxLength={300} value={node.terminalEvent.message} placeholder="例如：我发现了异常信号，要读取隐藏信息吗？" onChange={(event) => updateEvent({ message: event.target.value })} /><small>{Array.from(node.terminalEvent.message).length} / 300 字</small></label>
      <label className="toggle-field"><input type="checkbox" checked={node.terminalEvent.speak} onChange={(event) => updateEvent({ speak: event.target.checked })} /><span>自动播放拟人语音</span></label>
      {node.terminalEvent.speak && <div className="terminal-voice-generation"><AssetSelect label="节点小雾语音" type="audio" value={node.terminalEvent.voiceAssetId || node.terminalEvent.voiceUrl} assets={assets} folders={folders} onChange={(voiceAssetId, voiceUrl) => updateEvent({ voiceAssetId, voiceUrl, voiceSourceKey: voiceAssetId || voiceUrl ? "manual" : "" })} /><div className={`voice-generation-state${voiceStale ? " stale" : ""}`}><span>{node.terminalEvent.voiceUrl ? voiceStale ? "AI 语音已过期，将使用设备朗读" : "AI 语音可用" : "未生成 AI 语音，将使用设备朗读"}</span><button type="button" disabled={generating || !story.terminal.voiceId || !node.terminalEvent.message.trim()} onClick={() => void generateNodeVoice()}>{generating ? "AI 正在生成…" : node.terminalEvent.voiceUrl ? "重新生成 AI 语音" : "生成 AI 语音"}</button></div>{node.terminalEvent.voiceUrl && <audio controls preload="metadata" src={node.terminalEvent.voiceUrl} />}</div>}
      {node.terminalEvent.message && <div className="terminal-message-preview"><small>小雾 · 节点预览</small><b>小雾</b>{customTerminalName && <i>{customTerminalName}</i>}<p>{node.terminalEvent.message}</p></div>}
    </fieldset>
  </div>;
}

function MusicCueEditor({ story, assets, folders, setStory }: {
  story: StoryDocument;
  assets: AssetRecord[];
  folders: AssetFolder[];
  setStory: (story: StoryDocument) => void;
}) {
  const update = (id: string, patch: Partial<StoryMusicCue>) => {
    setStory({ ...story, musicCues: story.musicCues.map((cue) => cue.id === id ? { ...cue, ...patch } : cue) });
  };
  const add = () => {
    const cue: StoryMusicCue = {
      id: crypto.randomUUID(),
      name: `配乐 ${story.musicCues.length + 1}`,
      assetId: "",
      url: "",
      startNodeId: story.startNodeId,
      stopNodeIds: [],
      volume: 0.55,
      loop: true,
      fadeMs: 500,
    };
    setStory({ ...story, musicCues: [...story.musicCues, cue] });
  };
  return <div className="music-cue-editor"><div className="panel-heading"><div><p>MUSIC TIMELINE</p><h2>音乐编排</h2></div><button onClick={add}>＋ 新增音乐区间</button></div><p className="help-copy">选择音乐、开始节点与一个或多个结束节点。音乐会完整播放结束节点，在离开该节点或结束本章时停止。</p>
    {story.musicCues.map((cue) => <MusicCueCard key={cue.id} cue={cue} story={story} assets={assets} folders={folders} onChange={(patch) => update(cue.id, patch)} onDelete={() => setStory({ ...story, musicCues: story.musicCues.filter((item) => item.id !== cue.id) })} />)}
    {story.musicCues.length === 0 && <div className="empty"><b>尚未编排配乐</b><p>新增一个区间，选择素材、开始节点和结束节点。</p></div>}
  </div>;
}

function MusicCueCard({ cue, story, assets, folders, onChange, onDelete }: {
  cue: StoryMusicCue;
  story: StoryDocument;
  assets: AssetRecord[];
  folders: AssetFolder[];
  onChange: (patch: Partial<StoryMusicCue>) => void;
  onDelete: () => void;
}) {
  const availableStops = story.nodes.filter((node) => !cue.stopNodeIds.includes(node.id));
  const [stopCandidate, setStopCandidate] = useState(availableStops[0]?.id || "");
  const effectiveStopCandidate = availableStops.some((node) => node.id === stopCandidate)
    ? stopCandidate
    : availableStops[0]?.id || "";
  const selectedAsset = assets.find((asset) => asset.id === cue.assetId);
  const title = cue.name || selectedAsset?.name || "未命名配乐";
  return <fieldset className="music-cue-card">
    <legend>{title}</legend>
    <AssetSelect label="1. 选择音乐" type="audio" value={cue.assetId || cue.url} assets={assets} folders={folders} onChange={(assetId, url) => {
      const asset = assets.find((item) => item.id === assetId);
      onChange({ assetId, url, name: cue.name || asset?.name || "" });
    }} />
    <label>2. 开始节点<select value={cue.startNodeId} onChange={(event) => {
      const startNodeId = event.target.value;
      const singleNode = cue.stopNodeIds.length === 1 && cue.stopNodeIds[0] === cue.startNodeId;
      onChange({ startNodeId, stopNodeIds: singleNode ? [startNodeId] : cue.stopNodeIds });
    }}>{story.nodes.map((node) => <option key={node.id} value={node.id}>{node.title} · {node.id}</option>)}</select></label>
    <label className="toggle-field music-single-node"><input type="checkbox" checked={cue.stopNodeIds.length === 1 && cue.stopNodeIds[0] === cue.startNodeId} onChange={(event) => onChange({ stopNodeIds: event.target.checked ? [cue.startNodeId] : cue.stopNodeIds.filter((id) => id !== cue.startNodeId) })} /><span>仅在此节点播放</span><small>进入该节点开始，读完整个节点后离开或结束本章时停止。</small></label>
    <div className="music-stop-picker"><label>3. 结束节点<div><select aria-label="选择结束节点" value={effectiveStopCandidate} disabled={availableStops.length === 0} onChange={(event) => setStopCandidate(event.target.value)}><option value="">选择节点</option>{availableStops.map((node) => <option key={node.id} value={node.id}>{node.title} · {node.id}</option>)}</select><button type="button" disabled={!effectiveStopCandidate} onClick={() => { if (!effectiveStopCandidate) return; onChange({ stopNodeIds: [...cue.stopNodeIds, effectiveStopCandidate] }); }}>添加</button></div></label>
      <div className="music-stop-chips">{cue.stopNodeIds.map((stopId) => {
        const node = story.nodes.find((item) => item.id === stopId);
        return <span key={stopId}>{node?.title || stopId}<button type="button" aria-label={`移除结束节点 ${node?.title || stopId}`} onClick={() => onChange({ stopNodeIds: cue.stopNodeIds.filter((id) => id !== stopId) })}>×</button></span>;
      })}{cue.stopNodeIds.length === 0 && <small>至少添加一个结束节点</small>}</div>
    </div>
    <details className="music-advanced"><summary>高级设置</summary><div>
      <label>显示名称<input value={cue.name} placeholder={selectedAsset?.name || "例如：主题配乐"} onChange={(event) => onChange({ name: event.target.value })} /></label>
      <div className="two-col"><label>音量 {Math.round(Math.max(0, Math.min(1, cue.volume)) * 100)}%<input type="range" min="0" max="1" step="0.05" value={Math.max(0, Math.min(1, cue.volume))} onChange={(event) => onChange({ volume: Number(event.target.value) })} /></label><label>淡入淡出<input type="number" min="0" max="5000" step="100" value={Math.max(0, Math.min(5000, cue.fadeMs))} onChange={(event) => onChange({ fadeMs: Number(event.target.value) })} /><small>毫秒</small></label></div>
      <label className="toggle-field"><input type="checkbox" checked={cue.loop} onChange={(event) => onChange({ loop: event.target.checked })} /><span>循环播放</span></label>
    </div></details>
    <button className="danger" onClick={onDelete}>删除区间</button>
  </fieldset>;
}

type StoryCanvasNodeData = {
  title: string;
  meta: string;
  media: string;
  isStart: boolean;
  canAddChild: boolean;
  onAddChild: (id: string) => void;
};
type StoryCanvasNode = Node<StoryCanvasNodeData, "story">;
type StoryCanvasEdgeData = {
  label: string;
  interactionPreset: InteractionPreset;
  hasSfx: boolean;
  hasImage: boolean;
  hasTerminal: boolean;
  onInsert: (sourceId: string, choiceId: string) => void;
};
type StoryCanvasEdge = Edge<StoryCanvasEdgeData, "story">;

const storyNodeTypes = { story: StoryCanvasNode };
const storyEdgeTypes = { story: StoryCanvasEdge };
function StoryCanvasNode({ id, data, selected }: NodeProps<StoryCanvasNode>) {
  return <div className={`flow-node ${data.meta === "结局" ? "ending" : ""}${selected ? " selected" : ""}`}>
    <Handle type="target" position={Position.Left} />
    <small>{data.isStart ? "起始 · " : ""}{data.meta}</small>
    <b title={data.title}>{data.title}</b>
    <span>{data.media}</span>
    {data.canAddChild && <button className="flow-node-add nodrag nopan" aria-label={`在「${data.title}」后新增节点`} title="新增并连接子节点" onClick={(event) => { event.stopPropagation(); data.onAddChild(id); }}>＋</button>}
    <Handle type="source" position={Position.Right} />
  </div>;
}

function StoryCanvasEdge({ id, source, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style, data }: EdgeProps<StoryCanvasEdge>) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  return <>
    <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
    <EdgeLabelRenderer><div className="flow-edge-label nodrag nopan" style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>
      <span>{data?.label}<small>{[interactionLabels[data?.interactionPreset || "none"], data?.hasSfx ? "♫ 音效" : "", data?.hasImage ? "▣ 图片" : "", data?.hasTerminal ? "✦ 小雾反馈" : ""].filter(Boolean).join(" · ")}</small></span>
      <button aria-label={`在选项「${data?.label || "未命名"}」中插入节点`} title="在这条路径中插入节点" onClick={() => data?.onInsert(source, id)}>＋</button>
    </div></EdgeLabelRenderer>
  </>;
}

function StoryFlow({ story, setStory, selectedId, onSelect, onDuplicate, onDelete, onAutoLayout }: { story: StoryDocument; setStory: (story: StoryDocument) => void; selectedId: string; onSelect: (id: string) => void; onDuplicate: () => void; onDelete: (id?: string) => void; onAutoLayout: () => void }) {
  const [placing, setPlacing] = useState(false);
  const [flowMessage, setFlowMessage] = useState("");
  const storyRef = useRef(story);
  const canvasRef = useRef<HTMLElement>(null);
  const instanceRef = useRef<ReactFlowInstance<StoryCanvasNode, StoryCanvasEdge> | null>(null);
  const lastPlacementRef = useRef(0);
  useEffect(() => { storyRef.current = story; }, [story]);

  useEffect(() => {
    if (!placing) return;
    const cancel = (event: KeyboardEvent) => { if (event.key === "Escape") setPlacing(false); };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [placing]);
  const revealNode = useCallback((node: StoryNode) => {
    requestAnimationFrame(() => {
      const instance = instanceRef.current;
      const canvas = canvasRef.current;
      if (!instance || !canvas) return;
      const center = { x: node.position.x + FLOW_NODE_WIDTH / 2, y: node.position.y + FLOW_NODE_HEIGHT / 2 };
      const screen = instance.flowToScreenPosition(center);
      const bounds = canvas.getBoundingClientRect();
      const margin = 70;
      const outside = screen.x < bounds.left + margin || screen.x > bounds.right - margin
        || screen.y < bounds.top + margin || screen.y > bounds.bottom - margin;
      if (outside) void instance.setCenter(center.x, center.y, { zoom: Math.min(instance.getZoom(), 1), duration: 220 });
    });
  }, []);

  const applyEdit = useCallback((result: ReturnType<typeof createStandaloneNode>) => {
    if (result.error || !result.createdNodeId) { setFlowMessage(result.error || "无法新增节点"); return; }
    setStory(result.story);
    onSelect(result.createdNodeId);
    setFlowMessage("");
    const created = result.story.nodes.find((node) => node.id === result.createdNodeId);
    if (created) revealNode(created);
  }, [onSelect, revealNode, setStory]);

  const addChild = useCallback((sourceId: string) => {
    applyEdit(createChildNode(storyRef.current, sourceId, `node-${crypto.randomUUID()}`, crypto.randomUUID()));
  }, [applyEdit]);
  const insertOnEdge = useCallback((sourceId: string, choiceId: string) => {
    applyEdit(insertNodeOnChoice(storyRef.current, sourceId, choiceId, `node-${crypto.randomUUID()}`, crypto.randomUUID()));
  }, [applyEdit]);

  const toFlowNodes = useCallback((document: StoryDocument, activeId: string): StoryCanvasNode[] => document.nodes.map((node) => ({
    id: node.id,
    type: "story",
    position: node.position,
    selected: node.id === activeId,
    data: {
      title: node.title,
      meta: node.canEndChapter ? "场景 · 可结束" : "场景",
      media: [
        node.videoMode !== "none" ? "▶ 视频" : "",
        node.imageUrl ? "▧ 背景" : "",
        node.displayImagePosition !== "none" ? `▣ 图片${node.displayImagePosition === "before" ? "前" : "后"}` : "",
        node.terminalEvent?.trigger !== "none" ? "✦ 小雾" : "",
      ].filter(Boolean).join(" · ") || "纯文本",
      isStart: node.id === document.startNodeId,
      canAddChild: true,
      onAddChild: addChild,
    },
    style: { width: FLOW_NODE_WIDTH, height: FLOW_NODE_HEIGHT },
  })), [addChild]);
  const [nodes, setNodes] = useState<StoryCanvasNode[]>(() => toFlowNodes(story, selectedId));
  useEffect(() => {
    const frame = requestAnimationFrame(() => setNodes(toFlowNodes(story, selectedId)));
    return () => cancelAnimationFrame(frame);
  }, [selectedId, story, toFlowNodes]);

  const edges = useMemo<StoryCanvasEdge[]>(() => story.nodes.flatMap((node) => node.choices.map((choice) => ({
    id: choice.id,
    type: "story",
    source: node.id,
    target: choice.targetId,
    animated: node.id === selectedId,
    data: {
      label: choice.label,
      interactionPreset: choice.interactionPreset,
      hasSfx: Boolean(choice.sfxAssetId || choice.sfxUrl),
      hasImage: Boolean(choice.feedbackImageAssetId || choice.feedbackImageUrl),
      hasTerminal: choice.terminalFeedbackEnabled,
      onInsert: insertOnEdge,
    },
  }))), [insertOnEdge, selectedId, story.nodes]);

  const addAtScreenPosition = useCallback((clientX: number, clientY: number) => {
    const instance = instanceRef.current;
    if (!instance) return;
    const point = instance.screenToFlowPosition({ x: clientX, y: clientY });
    const position = {
      x: Math.round(point.x - FLOW_NODE_WIDTH / 2),
      y: Math.round(point.y - FLOW_NODE_HEIGHT / 2),
    };
    applyEdit(createStandaloneNode(storyRef.current, `node-${crypto.randomUUID()}`, position));
    lastPlacementRef.current = Date.now();
    setPlacing(false);
  }, [applyEdit]);

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    const current = storyRef.current;
    const source = current.nodes.find((node) => node.id === connection.source);
    if (!source) { setFlowMessage("来源节点不存在"); return; }
    setStory({ ...current, nodes: current.nodes.map((node) => node.id === connection.source ? {
      ...node,
      choices: [...node.choices, createStoryChoice({ id: crypto.randomUUID(), label: "新的选择", targetId: connection.target! })],
    } : node) });
    onSelect(connection.source);
  }, [onSelect, setStory]);
  const onEdgesDelete = useCallback((deleted: StoryCanvasEdge[]) => {
    const ids = new Set(deleted.map((edge) => edge.id));
    const current = storyRef.current;
    setStory({ ...current, nodes: current.nodes.map((node) => ({ ...node, choices: node.choices.filter((choice) => !ids.has(choice.id)) })) });
  }, [setStory]);
  const organize = useCallback(() => {
    onAutoLayout();
    requestAnimationFrame(() => requestAnimationFrame(() => { void instanceRef.current?.fitView({ padding: 0.2, duration: 240 }); }));
  }, [onAutoLayout]);

  return <section ref={canvasRef} className={`flow-canvas${placing ? " placing" : ""}`} onDoubleClickCapture={(event) => {
    if (placing || Date.now() - lastPlacementRef.current < 400 || !(event.target instanceof Element) || !event.target.classList.contains("react-flow__pane")) return;
    addAtScreenPosition(event.clientX, event.clientY);
  }}>
    <div className="flow-toolbar"><button className={placing ? "active" : ""} onClick={() => setPlacing((value) => !value)}>{placing ? "点击画布放置…" : "＋ 节点"}</button><button onClick={onDuplicate}>⧉ 复制</button><button onClick={() => onDelete(selectedId)} disabled={selectedId === story.startNodeId}>× 删除</button><button onClick={organize}>自动整理</button></div>
    {placing && <div className="flow-placement-tip">点击画布放置节点 · Esc 取消</div>}
    {flowMessage && <div className="flow-message" role="status">{flowMessage}</div>}
    <ReactFlow<StoryCanvasNode, StoryCanvasEdge>
      nodes={nodes}
      edges={edges}
      nodeTypes={storyNodeTypes}
      edgeTypes={storyEdgeTypes}
      onInit={(instance) => { instanceRef.current = instance; }}
      onNodesChange={(changes) => setNodes((current) => applyNodeChanges(changes.filter((change) => change.type !== "remove"), current))}
      onNodeDragStop={(_event, node) => {
        const current = storyRef.current;
        setStory({ ...current, nodes: current.nodes.map((item) => item.id === node.id ? { ...item, position: node.position } : item) });
      }}
      onNodesDelete={(deleted) => { const target = deleted.find((node) => node.id !== story.startNodeId); if (target) onDelete(target.id); }}
      onNodeClick={(_event, node) => onSelect(node.id)}
      onPaneClick={(event) => { if (placing) addAtScreenPosition(event.clientX, event.clientY); }}
      onConnect={onConnect}
      onEdgesDelete={onEdgesDelete}
      isValidConnection={(connection) => {
        const source = storyRef.current.nodes.find((node) => node.id === connection.source);
        return Boolean(source && connection.source !== connection.target);
      }}
      deleteKeyCode={["Backspace", "Delete"]}
      zoomOnDoubleClick={false}
      fitView
      fitViewOptions={{ padding: 0.2 }}
    >
      <Background gap={22} size={1} /><MiniMap pannable zoomable /><Controls />
    </ReactFlow>
  </section>;
}

function ImagePresentationEditor({ value, url, alt, onChange }: {
  value: ImagePresentation;
  url: string;
  alt: string;
  onChange: (value: ImagePresentation) => void;
}) {
  const setFocus = (event: React.PointerEvent<HTMLDivElement>) => {
    if (value.fit !== "cover") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    onChange({
      ...value,
      positionX: Math.round((event.clientX - bounds.left) / bounds.width * 100),
      positionY: Math.round((event.clientY - bounds.top) / bounds.height * 100),
    });
  };
  return <div className="image-presentation-editor"><div className="two-col"><label>图片显示方式<select value={value.fit} onChange={(event) => onChange({ ...value, fit: event.target.value as ImagePresentation["fit"] })}><option value="contain">完整显示（等比例留边）</option><option value="cover">铺满裁切（可选焦点）</option></select></label><span className="focus-readout">{value.fit === "cover" ? `焦点 ${value.positionX}% · ${value.positionY}%` : "完整图片不会被裁切"}</span></div>
    {url && <div className={`image-focus-preview ${value.fit}`} onPointerDown={setFocus} role="img" aria-label={`${alt || "图片"}显示范围预览`}>
      <Image src={url} alt="" fill unoptimized draggable={false} style={{ objectFit: value.fit, objectPosition: `${value.positionX}% ${value.positionY}%` }} />
      {value.fit === "cover" && <i style={{ left: `${value.positionX}%`, top: `${value.positionY}%` }} />}
    </div>}
    {value.fit === "cover" && <div className="focus-sliders"><label>水平焦点<input type="range" min="0" max="100" value={value.positionX} onChange={(event) => onChange({ ...value, positionX: Number(event.target.value) })} /></label><label>垂直焦点<input type="range" min="0" max="100" value={value.positionY} onChange={(event) => onChange({ ...value, positionY: Number(event.target.value) })} /></label><small>可直接点击预览图选择希望保留的画面位置。</small></div>}
  </div>;
}

function AssetSelect({ label, type, value, assets, folders, onChange }: { label: string; type: AssetType; value: string; assets: AssetRecord[]; folders: AssetFolder[]; onChange: (id: string, url: string) => void }) {
  const normalizedValue = assets.find((asset) => asset.id === value || asset.url === value)?.id || "";
  const knownFolders = new Set(folders.map((folder) => folder.id));
  return <label>{label}<select value={normalizedValue} onChange={(event) => { const asset = assets.find((item) => item.id === event.target.value); onChange(asset?.id || "", asset?.url || ""); }}><option value="">无</option>{folders.map((folder) => <optgroup key={folder.id} label={folder.name}>{assets.filter((asset) => asset.type === type && asset.folderId === folder.id && asset.status === "ready").map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</optgroup>)}<optgroup label="未分类">{assets.filter((asset) => asset.type === type && !asset.folderId && asset.status === "ready").map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</optgroup><optgroup label="全局素材">{assets.filter((asset) => asset.type === type && asset.folderId && !knownFolders.has(asset.folderId) && asset.status === "ready").map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</optgroup></select></label>;
}

function AssetManager({ scope, apiBase, assets, folders, onBack, onReload, onMessage, onAccessStatus }: { scope: StudioScope; apiBase: string; assets: AssetRecord[]; folders: AssetFolder[]; onBack: () => void; onReload: () => Promise<void>; onMessage: (message: string) => void; onAccessStatus: ReconcileOperationAccess }) {
  const [folderId, setFolderId] = useState("all"); const [type, setType] = useState<"all" | AssetType>("all"); const [query, setQuery] = useState(""); const [sort, setSort] = useState("newest"); const [uploads, setUploads] = useState<UploadItem[]>([]); const input = useRef<HTMLInputElement>(null);
  const isUploading = uploads.some((item) => item.status === "uploading" || item.status === "queued");
  const visible = useMemo(() => assets.filter((asset) => (folderId === "all" || (folderId === "root" ? !asset.folderId : asset.folderId === folderId)) && (type === "all" || asset.type === type) && asset.name.toLowerCase().includes(query.toLowerCase())).sort((a, b) => sort === "name" ? a.name.localeCompare(b.name, "zh-CN") : sort === "size" ? b.size - a.size : b.updatedAt.localeCompare(a.updatedAt)), [assets, folderId, query, sort, type]);
  const apiPatch = async (body: Record<string, unknown>) => { const response = await fetch(`${apiBase}/assets`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); if (await onAccessStatus(response.status)) return; const data = await response.json() as { error?: string }; if (!response.ok) onMessage(data.error || "操作失败"); else await onReload(); };
  const inspectDuration = (file: File) => new Promise<number>((resolve) => { if (!file.type.startsWith("video/")) return resolve(0); const video = document.createElement("video"); const url = URL.createObjectURL(file); video.preload = "metadata"; video.onloadedmetadata = () => { const duration = video.duration; URL.revokeObjectURL(url); resolve(Number.isFinite(duration) ? duration : 0); }; video.onerror = () => { URL.revokeObjectURL(url); resolve(0); }; video.src = url; });
  const chooseFiles = async (files: FileList | null) => {
    if (!files) return; const items: UploadItem[] = [];
    for (const file of Array.from(files)) {
      const duration = await inspectDuration(file);
      const limit = file.type.startsWith("image/") ? 8 : file.type.startsWith("audio/") ? 20 : 50;
      const error = file.size > limit * 1024 * 1024 ? `文件超过 ${limit}MB` : file.type.startsWith("video/") && duration > 60 ? "视频超过 60 秒" : undefined;
      items.push({ id: crypto.randomUUID(), file, duration, progress: 0, status: error ? "error" : "queued", error });
    }
    setUploads((current) => [...items, ...current]); items.filter((item) => item.status === "queued").forEach((item) => upload(item));
  };
  const upload = (item: UploadItem) => {
    setUploads((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: "uploading", progress: 0 } : entry));
    const data = new FormData(); data.append("file", item.file); data.append("duration", String(item.duration)); if (folderId !== "all" && folderId !== "root") data.append("folderId", folderId);
    const xhr = new XMLHttpRequest(); xhr.open("POST", `${apiBase}/assets`); xhr.upload.onprogress = (event) => { if (event.lengthComputable) setUploads((current) => current.map((entry) => entry.id === item.id ? { ...entry, progress: Math.round(event.loaded / event.total * 100) } : entry)); };
    xhr.onload = async () => { if (await onAccessStatus(xhr.status)) return; if (xhr.status >= 200 && xhr.status < 300) { setUploads((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: "done", progress: 100 } : entry)); onReload(); } else { let error = "上传失败"; try { error = JSON.parse(xhr.responseText).error || error; } catch {} setUploads((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: "error", error } : entry)); } };
    xhr.onerror = () => setUploads((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: "error", error: "网络中断" } : entry)); xhr.send(data);
  };
  const deleteAsset = async (asset: AssetRecord) => { if (!confirm(`删除素材「${asset.name}」？`)) return; const response = await fetch(`${apiBase}/assets?id=${encodeURIComponent(asset.id)}`, { method: "DELETE" }); if (await onAccessStatus(response.status)) return; const data = await response.json() as { error?: string; references?: { chapterTitle: string; nodeTitle: string; field: string; version: string }[] }; if (response.status === 409) { alert(`${data.error}\n${(data.references || []).map((ref) => `${ref.chapterTitle} / ${ref.nodeTitle} / ${ref.field} (${ref.version})`).join("\n")}`); } else if (!response.ok) onMessage(data.error || "删除失败"); else { onMessage("素材已删除"); onReload(); } };
  return <div className="studio"><StudioAside scope={scope} active="assets" onNovels={onBack} onChapters={onBack} onAssets={() => {}} /><section className="studio-main asset-library"><header><div><button className="back-link" onClick={onBack}>← 返回创作页面</button><p>MEDIA LIBRARY</p><h1>素材库</h1></div><button className="primary" disabled={isUploading} onClick={() => input.current?.click()}>{isUploading ? "正在上传…" : "＋ 上传素材"}</button><input ref={input} hidden disabled={isUploading} multiple type="file" accept="image/*,audio/*,video/mp4,video/webm" onChange={(event) => chooseFiles(event.target.files)} /></header>
    <div className="asset-controls"><select value={folderId} onChange={(event) => setFolderId(event.target.value)}><option value="all">全部文件夹</option><option value="root">未分类</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select><select value={type} onChange={(event) => setType(event.target.value as typeof type)}><option value="all">全部类型</option><option value="image">图片</option><option value="audio">音频</option><option value="video">视频</option></select><input placeholder="搜索素材" value={query} onChange={(event) => setQuery(event.target.value)} /><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="newest">最近更新</option><option value="name">按名称</option><option value="size">按大小</option></select><button onClick={() => { const name = prompt("新文件夹名称"); if (name) apiPatch({ action: "create-folder", name }); }}>＋ 文件夹</button></div>
    <div className="folder-chips">{folders.map((folder) => <span key={folder.id}><button onClick={() => setFolderId(folder.id)}>{folder.name}</button><button title="重命名" onClick={() => { const name = prompt("文件夹名称", folder.name); if (name) apiPatch({ action: "rename-folder", id: folder.id, name }); }}>✎</button><button title="删除文件夹" onClick={() => { if (confirm("删除文件夹？素材会移到未分类。")) apiPatch({ action: "delete-folder", id: folder.id }); }}>×</button></span>)}</div>
    {uploads.length > 0 && <div className="upload-queue"><div><b>上传队列</b><button onClick={() => setUploads((current) => current.filter((item) => item.status === "uploading" || item.status === "queued"))}>清除已完成</button></div>{uploads.map((item) => <div className="upload-row" key={item.id}><span>{item.file.name}<small>{item.error || (item.status === "done" ? "上传完成" : item.status === "uploading" ? `${item.progress}%` : "等待上传")}</small></span><div><i style={{ width: `${item.progress}%` }} /></div>{item.status === "error" && <button onClick={() => upload(item)}>重试</button>}</div>)}</div>}
    <div className="asset-grid managed">{visible.map((asset) => <AssetCard key={`${asset.id}:${asset.updatedAt}`} asset={asset} folders={folders} manageable={scope === "admin" || asset.canManage === true} onUpdate={apiPatch} onDelete={() => deleteAsset(asset)} />)}</div>
  </section></div>;
}

function AssetCard({ asset, folders, manageable, onUpdate, onDelete }: { asset: AssetRecord; folders: AssetFolder[]; manageable: boolean; onUpdate: (body: Record<string, unknown>) => Promise<void>; onDelete: () => void }) {
  const [name, setName] = useState(asset.name);
  return <article>{asset.type === "image" ? <Image src={asset.url} alt={asset.alt || asset.name} width={320} height={180} unoptimized /> : asset.type === "video" ? <video src={asset.url} muted preload="metadata" /> : <div className="audio-icon">♫</div>}<div><input aria-label="素材名称" disabled={!manageable} value={name} onChange={(event) => setName(event.target.value)} onBlur={() => { if (manageable && name.trim() && name.trim() !== asset.name) onUpdate({ action: "update-asset", id: asset.id, name: name.trim(), folderId: asset.folderId }); }} /><small>{!manageable ? "全局素材 · " : ""}{asset.type === "video" ? `${asset.duration}s · ` : ""}{(asset.size / 1024 / 1024).toFixed(1)} MB</small>{manageable && <><select aria-label="素材文件夹" value={asset.folderId || ""} onChange={(event) => onUpdate({ action: "update-asset", id: asset.id, name: asset.name, folderId: event.target.value || null })}><option value="">未分类</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select><button className="danger" onClick={onDelete}>{asset.status === "delete_failed" ? "重试删除" : "删除"}</button></>}</div></article>;
}
