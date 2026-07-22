"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChapterRecord, StoryDocument, StoryNode } from "../lib/story";
import { demoStory, validateStory } from "../lib/story";

type Asset = { id: string; name: string; type: "image" | "audio"; url: string; size: number; alt: string };
type View = "library" | "reader" | "admin" | "editor" | "preview";

const emptyNode = (): StoryNode => ({ id: `node-${Date.now().toString(36)}`, title: "新场景", body: "在这里写下故事……", type: "scene", imageUrl: "", imageAlt: "", audioUrl: "", animation: "fade", choices: [] });

export function StoryStudio() {
  const [view, setView] = useState<View>("library");
  const [chapters, setChapters] = useState<ChapterRecord[]>([]);
  const [active, setActive] = useState<ChapterRecord | null>(null);
  const [story, setStory] = useState<StoryDocument>(demoStory);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [busy, setBusy] = useState(true);
  const [toast, setToast] = useState("");

  const loadPublic = useCallback(async () => {
    setBusy(true);
    const res = await fetch("/api/chapters");
    const data = await res.json();
    setChapters(data.chapters || []);
    setBusy(false);
  }, []);
  const loadAdmin = useCallback(async () => {
    setBusy(true);
    const [chapterRes, assetRes] = await Promise.all([fetch("/api/chapters?mode=admin"), fetch("/api/assets")]);
    if (chapterRes.status === 401) { window.location.href = "/signin-with-chatgpt?return_to=%2F"; return; }
    const chapterData = await chapterRes.json();
    const assetData = await assetRes.json();
    setChapters(chapterData.chapters || []);
    setAssets(assetData.assets || []);
    setBusy(false);
  }, []);

  useEffect(() => { loadPublic().catch(() => setBusy(false)); }, [loadPublic]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 2600); return () => clearTimeout(t); }, [toast]);

  const openReader = (chapter: ChapterRecord) => { setActive(chapter); setStory(chapter.published || chapter.draft); setView("reader"); };
  const openEditor = (chapter: ChapterRecord) => { setActive(chapter); setStory(structuredClone(chapter.draft)); setView("editor"); };
  const goLibrary = () => { setView("library"); setActive(null); loadPublic(); };
  const goAdmin = () => { setView("admin"); loadAdmin(); };

  async function action(actionName: string, id?: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    const res = await fetch("/api/chapters", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: actionName, id, ...extra }) });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) { setToast(data.errors?.join("；") || data.error || "操作失败"); return false; }
    setToast(actionName === "publish" ? "章节已发布" : actionName === "save" ? "草稿已保存" : "操作完成");
    await loadAdmin();
    return data;
  }

  return (
    <main className="app-shell">
      {toast && <div className="toast" role="status">{toast}</div>}
      {busy && <div className="loading-bar" aria-label="加载中" />}
      {view === "library" && <Library chapters={chapters} onRead={openReader} onAdmin={goAdmin} />}
      {view === "reader" && <Reader story={story} chapterId={active?.id || "preview"} onBack={goLibrary} />}
      {view === "admin" && <Admin chapters={chapters} onBack={goLibrary} onEdit={openEditor} onAction={action} />}
      {view === "editor" && active && <Editor chapter={active} story={story} setStory={setStory} assets={assets} onBack={goAdmin} onPreview={() => setView("preview")} onSave={() => action("save", active.id, { story, meta: { slug: active.slug, sortOrder: active.sortOrder } })} onPublish={() => action("publish", active.id, { story })} onRollback={async (version) => { const ok = await action("rollback", active.id, { version }); if (ok) goAdmin(); }} onUpload={async (form) => { const res = await fetch("/api/assets", { method: "POST", body: form }); const data = await res.json(); if (!res.ok) return setToast(data.error); setAssets((items) => [data.asset, ...items]); setToast("素材上传完成"); }} />}
      {view === "preview" && <div className="preview-wrap"><button className="preview-exit" onClick={() => setView("editor")}>← 返回编辑</button><div className="phone-frame"><Reader story={story} chapterId="preview" onBack={() => setView("editor")} preview /></div></div>}
    </main>
  );
}

function Brand() { return <div className="brand"><span className="brand-mark">雾</span><span>雾页</span></div>; }

function Library({ chapters, onRead, onAdmin }: { chapters: ChapterRecord[]; onRead: (c: ChapterRecord) => void; onAdmin: () => void }) {
  return <div className="library">
    <header className="topbar"><Brand /><button className="ghost" onClick={onAdmin}>创作后台 ↗</button></header>
    <section className="hero"><p className="eyebrow">INTERACTIVE FICTION</p><h1>有些故事，<br />会在选择中醒来。</h1><p className="hero-copy">在每一次迟疑与决定之间，找到只属于你的那条叙事支流。</p><div className="scroll-cue"><span>向下探索</span><i /></div></section>
    <section className="shelf"><div className="section-heading"><div><span>01</span><p>正在连载</p></div><h2>故事档案</h2></div>
      <div className="chapter-grid">{chapters.map((chapter, index) => <article className="chapter-card" key={chapter.id}>
        <div className={`cover cover-${index % 3}`} style={chapter.coverUrl ? { backgroundImage: `linear-gradient(180deg, transparent, rgba(10,12,12,.8)), url(${chapter.coverUrl})` } : undefined}><span>NO.{String(index + 1).padStart(2, "0")}</span><div className="cover-art"><i /><b>霧</b></div><small>{chapter.version > 1 ? `第 ${chapter.version} 版` : "全新篇章"}</small></div>
        <div className="card-copy"><p>约 5 分钟 · 多重结局</p><h3>{chapter.title}</h3><p>{chapter.summary}</p><button onClick={() => onRead(chapter)}>开始阅读 <span>→</span></button></div>
      </article>)}</div>
      {chapters.length === 0 && <div className="empty"><b>故事正在雾中酝酿</b><p>管理员发布章节后，会在这里出现。</p></div>}
    </section>
    <footer><Brand /><p>你的选择，构成故事。</p><button className="text-button" onClick={onAdmin}>进入创作后台</button></footer>
  </div>;
}

function Reader({ story, chapterId, onBack, preview = false }: { story: StoryDocument; chapterId: string; onBack: () => void; preview?: boolean }) {
  const storageKey = `mist-page-progress:${chapterId}`;
  const [nodeId, setNodeId] = useState(story.startNodeId);
  const [muted, setMuted] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const node = story.nodes.find((item) => item.id === nodeId) || story.nodes[0];
  useEffect(() => { if (!preview) { const saved = localStorage.getItem(storageKey); if (saved && story.nodes.some((n) => n.id === saved)) setNodeId(saved); } }, [preview, storageKey, story.nodes]);
  useEffect(() => { if (!preview) localStorage.setItem(storageKey, nodeId); }, [nodeId, preview, storageKey]);
  useEffect(() => { if (!audio.current) return; audio.current.pause(); if (node?.audioUrl && !muted) { audio.current.src = node.audioUrl; audio.current.play().catch(() => {}); } }, [node?.audioUrl, muted]);
  if (!node) return <div className="reader"><button onClick={onBack}>返回</button><p>章节内容为空。</p></div>;
  return <section className={`reader animation-${node.animation}`} style={node.imageUrl ? { backgroundImage: `linear-gradient(180deg, rgba(7,10,10,.12), rgba(7,10,10,.86)), url(${node.imageUrl})` } : undefined}>
    <audio ref={audio} loop />
    <header className="reader-nav"><button onClick={onBack} aria-label="返回">←</button><div><span>{story.title}</span><i /></div><button onClick={() => setMuted((v) => !v)} aria-label={muted ? "开启声音" : "静音"}>{muted ? "♩" : "♫"}</button></header>
    <div className="reader-atmosphere"><span className="moon" /><span className="mist mist-a" /><span className="mist mist-b" /><span className="shore" /></div>
    <article className="story-panel"><p className="node-kicker">{node.type === "ending" ? "THE END" : "CHAPTER SCENE"}</p><h1>{node.title}</h1><div className="ornament">✦</div><p className="story-body">{node.body}</p>
      <div className="choices">{node.choices.map((choice) => <button key={choice.id} onClick={() => setNodeId(choice.targetId)}><span>{choice.label}</span><i>→</i></button>)}
      {node.type === "ending" && <button onClick={() => { setNodeId(story.startNodeId); localStorage.removeItem(storageKey); }}><span>重新开始</span><i>↻</i></button>}</div>
    </article>
  </section>;
}

function Admin({ chapters, onBack, onEdit, onAction }: { chapters: ChapterRecord[]; onBack: () => void; onEdit: (c: ChapterRecord) => void; onAction: (a: string, id?: string, e?: Record<string, unknown>) => Promise<unknown> }) {
  return <div className="studio"><aside><Brand /><nav><button className="active">▦ 章节管理</button><button disabled>◇ 素材库</button><button disabled>◎ 发布记录</button></nav><div className="aside-bottom"><button onClick={onBack}>← 查看读者端</button><a href="/signout-with-chatgpt?return_to=%2F">退出登录</a></div></aside>
    <section className="studio-main"><header><div><p>STORY STUDIO</p><h1>章节管理</h1></div><button className="primary" onClick={() => onAction("create").then(() => {})}>＋ 新建章节</button></header>
      <div className="stats"><div><span>全部章节</span><b>{chapters.length}</b></div><div><span>已发布</span><b>{chapters.filter((c) => c.status === "published").length}</b></div><div><span>草稿</span><b>{chapters.filter((c) => c.status === "draft").length}</b></div></div>
      <div className="chapter-list"><div className="list-head"><span>章节</span><span>状态</span><span>版本</span><span>最后更新</span><span /></div>{chapters.map((chapter, i) => <div className="list-row" key={chapter.id}><div className="chapter-name"><div>{String(i + 1).padStart(2, "0")}</div><span><b>{chapter.title}</b><small>/{chapter.slug}</small></span></div><span className={`status ${chapter.status}`}>{chapter.status === "published" ? "已发布" : chapter.status === "offline" ? "已下线" : "草稿"}</span><span>v{chapter.version}</span><span>{new Date(chapter.updatedAt).toLocaleDateString("zh-CN")}</span><div className="row-actions"><button onClick={() => onEdit(chapter)}>编辑</button><button title="复制" onClick={() => onAction("duplicate", chapter.id)}>⧉</button>{chapter.status === "published" && <button title="下线" onClick={() => onAction("offline", chapter.id)}>↓</button>}{chapter.status === "draft" && <button title="删除" onClick={() => { if (confirm("确定删除这个草稿吗？")) onAction("delete", chapter.id); }}>×</button>}</div></div>)}</div>
    </section>
  </div>;
}

function Editor({ chapter, story, setStory, assets, onBack, onPreview, onSave, onPublish, onRollback, onUpload }: { chapter: ChapterRecord; story: StoryDocument; setStory: (s: StoryDocument) => void; assets: Asset[]; onBack: () => void; onPreview: () => void; onSave: () => void; onPublish: () => void; onRollback: (v: number) => void; onUpload: (f: FormData) => void }) {
  const [selectedId, setSelectedId] = useState(story.startNodeId);
  const [tab, setTab] = useState<"content" | "assets" | "versions">("content");
  const [versions, setVersions] = useState<{ version: number; createdAt: string }[]>([]);
  useEffect(() => { fetch(`/api/chapters/versions?chapterId=${chapter.id}`).then((r) => r.json()).then((d) => setVersions(d.versions || [])); }, [chapter.id]);
  const errors = useMemo(() => validateStory(story), [story]);
  const selected = story.nodes.find((n) => n.id === selectedId) || story.nodes[0];
  const updateNode = (patch: Partial<StoryNode>) => setStory({ ...story, nodes: story.nodes.map((n) => n.id === selected.id ? { ...n, ...patch } : n) });
  const addNode = () => { const node = emptyNode(); setStory({ ...story, nodes: [...story.nodes, node] }); setSelectedId(node.id); };
  const removeNode = () => { if (story.nodes.length <= 1 || selected.id === story.startNodeId) return; setStory({ ...story, nodes: story.nodes.filter((n) => n.id !== selected.id).map((n) => ({ ...n, choices: n.choices.filter((c) => c.targetId !== selected.id) })) }); setSelectedId(story.startNodeId); };
  if (!selected) return null;
  return <div className="editor"><header className="editor-top"><button className="back" onClick={onBack}>←</button><div><small>正在编辑</small><input value={story.title} onChange={(e) => setStory({ ...story, title: e.target.value })} /></div><span className="save-state">● 草稿自动保护</span><button className="ghost" onClick={onPreview}>预览</button><button className="ghost" onClick={onSave}>保存草稿</button><button className="primary" disabled={errors.length > 0} onClick={onPublish}>发布章节</button></header>
    <div className="editor-body"><aside className="node-list"><div className="node-head"><b>剧情节点</b><button onClick={addNode}>＋</button></div>{story.nodes.map((node, index) => <button className={selected.id === node.id ? "selected" : ""} key={node.id} onClick={() => setSelectedId(node.id)}><i>{node.type === "ending" ? "◆" : "◇"}</i><span><b>{node.title || "未命名"}</b><small>{node.id}</small></span><em>{index + 1}</em></button>)}</aside>
      <section className="edit-form"><div className="tabs"><button className={tab === "content" ? "active" : ""} onClick={() => setTab("content")}>内容编辑</button><button className={tab === "assets" ? "active" : ""} onClick={() => setTab("assets")}>素材库</button><button className={tab === "versions" ? "active" : ""} onClick={() => setTab("versions")}>发布记录</button></div>
      {tab === "content" ? <><div className="chapter-settings"><p>章节信息</p><label>章节简介<textarea rows={2} value={story.summary} onChange={(e) => setStory({ ...story, summary: e.target.value })} /></label><div className="two-col"><label>章节封面<select value={story.coverUrl} onChange={(e) => setStory({ ...story, coverUrl: e.target.value })}><option value="">使用默认封面</option>{assets.filter((a) => a.type === "image").map((a) => <option key={a.id} value={a.url}>{a.name}</option>)}</select></label><label>起始节点<select value={story.startNodeId} onChange={(e) => setStory({ ...story, startNodeId: e.target.value })}>{story.nodes.map((n) => <option key={n.id} value={n.id}>{n.title} · {n.id}</option>)}</select></label></div></div><div className="form-intro"><div><p>NODE / {selected.id.toUpperCase()}</p><h2>{selected.title}</h2></div><button className="danger" disabled={selected.id === story.startNodeId} onClick={removeNode}>删除节点</button></div>
        <label>节点标题<input value={selected.title} onChange={(e) => updateNode({ title: e.target.value })} /></label><label>节点 ID<input value={selected.id} disabled /></label><label>正文<textarea rows={7} value={selected.body} onChange={(e) => updateNode({ body: e.target.value })} /></label>
        <div className="two-col"><label>节点类型<select value={selected.type} onChange={(e) => updateNode({ type: e.target.value as StoryNode["type"], choices: e.target.value === "ending" ? [] : selected.choices })}><option value="scene">剧情场景</option><option value="ending">结局</option></select></label><label>过场动画<select value={selected.animation} onChange={(e) => updateNode({ animation: e.target.value as StoryNode["animation"] })}><option value="none">无</option><option value="fade">淡入</option><option value="rise">上浮</option><option value="flash">闪白</option></select></label></div>
        <div className="two-col"><label>场景插图<select value={selected.imageUrl} onChange={(e) => updateNode({ imageUrl: e.target.value })}><option value="">无插图</option>{assets.filter((a) => a.type === "image").map((a) => <option value={a.url} key={a.id}>{a.name}</option>)}</select></label><label>背景音乐<select value={selected.audioUrl} onChange={(e) => updateNode({ audioUrl: e.target.value })}><option value="">无音乐</option>{assets.filter((a) => a.type === "audio").map((a) => <option value={a.url} key={a.id}>{a.name}</option>)}</select></label></div>
        {selected.type === "scene" && <div className="choice-editor"><div><h3>选项与跳转</h3><button onClick={() => updateNode({ choices: [...selected.choices, { id: crypto.randomUUID(), label: "新的选择", targetId: story.startNodeId }] })}>＋ 添加选项</button></div>{selected.choices.map((choice) => <div className="choice-row" key={choice.id}><input value={choice.label} onChange={(e) => updateNode({ choices: selected.choices.map((c) => c.id === choice.id ? { ...c, label: e.target.value } : c) })} /><span>→</span><select value={choice.targetId} onChange={(e) => updateNode({ choices: selected.choices.map((c) => c.id === choice.id ? { ...c, targetId: e.target.value } : c) })}>{story.nodes.filter((n) => n.id !== selected.id).map((n) => <option value={n.id} key={n.id}>{n.title} · {n.id}</option>)}</select><button onClick={() => updateNode({ choices: selected.choices.filter((c) => c.id !== choice.id) })}>×</button></div>)}</div>}
        <div className={`validation ${errors.length ? "has-errors" : "valid"}`}><b>{errors.length ? `发现 ${errors.length} 个发布问题` : "故事结构检查通过"}</b>{errors.map((e) => <p key={e}>• {e}</p>)}</div>
      </> : tab === "assets" ? <AssetPanel assets={assets} onUpload={onUpload} /> : <div className="version-panel"><h2>发布记录</h2><p>每次发布都会保存固定快照，可随时恢复为线上版本。</p>{versions.map((item) => <div key={item.version}><span><b>版本 v{item.version}</b><small>{new Date(item.createdAt).toLocaleString("zh-CN")}</small></span>{item.version === chapter.version ? <em>当前版本</em> : <button onClick={() => { if (confirm(`确定恢复版本 v${item.version} 吗？`)) onRollback(item.version); }}>恢复此版本</button>}</div>)}</div>}</section>
    </div></div>;
}

function AssetPanel({ assets, onUpload }: { assets: Asset[]; onUpload: (f: FormData) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return <div className="asset-panel"><div className="upload-zone" onClick={() => input.current?.click()}><input ref={input} type="file" accept="image/*,audio/*" hidden onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; const form = new FormData(); form.append("file", file); onUpload(form); }} /><b>＋ 上传素材</b><p>图片最大 8MB，音频最大 20MB</p></div><div className="asset-grid">{assets.map((asset) => <div key={asset.id}>{asset.type === "image" ? <img src={asset.url} alt={asset.alt || asset.name} /> : <div className="audio-icon">♫</div>}<b>{asset.name}</b><small>{(asset.size / 1024 / 1024).toFixed(1)} MB</small></div>)}</div></div>;
}
