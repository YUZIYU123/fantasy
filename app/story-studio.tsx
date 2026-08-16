"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_COVER_PRESENTATION,
  type ChapterRecord,
  type ImagePresentation,
  type NovelRecord,
  type StoryDocument,
} from "../lib/story";
import { Brand } from "./brand";
import { FantasyTerminal } from "./fantasy-terminal";
import { Reader } from "./reader";
import { normalizeRegistrationIntent } from "../lib/registration-intent";
import { executeBookshelfOperation } from "./bookshelf-operation-client";

export { Reader } from "./reader";

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
  useEffect(() => {
    if (busy || novels.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const requestedNovelId = params.get("novel");
    if (requestedNovelId && novels.some((item) => item.id === requestedNovelId)) {
      params.delete("novel");
      const query = params.toString();
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
      queueMicrotask(() => { setNovelId(requestedNovelId); setView("novel"); });
      return;
    }
    const intent = normalizeRegistrationIntent({ kind: params.get("resume"), targetId: params.get("target") });
    if (!intent?.targetId) return;
    const consumeIntent = () => {
      params.delete("resume");
      params.delete("target");
      const query = params.toString();
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    };
    if (intent.kind === "bookshelf") {
      const targetNovel = novels.find((item) => item.id === intent.targetId);
      if (!targetNovel) return;
      consumeIntent();
      queueMicrotask(() => {
        setNovelId(targetNovel.id);
        setView("novel");
      });
      return;
    }
    if (intent.kind === "progress") {
      const targetNovel = novels.find((item) => item.chapters.some((chapter) => chapter.id === intent.targetId));
      const targetChapter = targetNovel?.chapters.find((chapter) => chapter.id === intent.targetId);
      if (!targetNovel || !targetChapter?.published) return;
      consumeIntent();
      queueMicrotask(() => {
        setNovelId(targetNovel.id);
        setChapterId(targetChapter.id);
        setView("reader");
      });
    }
  }, [busy, novels]);

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
    <header className="topbar"><Brand /><div className="topbar-actions"><a className="ghost link-button" href="/bookshelf">我的书架</a><a className="ghost link-button" href="/register">注册</a><a className="ghost link-button" href="/login">登录</a><a className="ghost link-button" href="/creator">创作中心 ↗</a></div></header>
    <section className="hero"><p className="eyebrow">INTERACTIVE FICTION UNIVERSE</p><h1>穿过裂隙，<br />抵达你的故事宇宙。</h1><p className="hero-copy">每一本小说都是一座世界，每一个选择都在打开新的时间线。</p><div className="portal-orbit" aria-hidden="true"><i /><i /><b>F</b></div><div className="scroll-cue"><span>探索世界档案</span><i /></div></section>
    <section className="shelf"><div className="section-heading"><div><span>01</span><p>已发布世界</p></div><h2>世界档案</h2></div>
      <div className="novel-shelf-grid">{novels.map((novel) => <article className="novel-card" key={novel.id}>
        <Artwork src={novel.published?.coverUrl || ""} alt={novel.published?.coverAlt || novel.published?.name || "小说封面"} presentation={novel.published?.coverPresentation} />
        <div className="card-copy"><p>{novel.chapters.length} 个已发布章节</p><h3>{novel.published?.name}</h3><p>{novel.published?.summary}</p><button onClick={() => onOpen(novel)}>进入小说 <span>→</span></button></div>
      </article>)}</div>
      {novels.length === 0 && <div className="empty"><b>新的世界正在构建</b><p>小说与章节发布后，会在这里出现。</p></div>}
    </section>
    <footer><Brand /><p>你的选择，构成世界。</p><a className="text-button" href="/creator">进入创作中心</a></footer>
  </div>;
}

function NovelHome({ novel, onBack, onRead }: { novel: PublicNovel; onBack: () => void; onRead: (chapter: PublicChapter) => void }) {
  const data = novel.published!;
  return <main className="novel-home">
    <header className="topbar"><Brand /><div className="topbar-actions"><BookshelfControl novelId={novel.id} /><a className="ghost link-button" href="/bookshelf">我的书架</a><button className="ghost" onClick={onBack}>← 世界档案</button></div></header>
    <section className="novel-hero">
      <div className="novel-home-cover"><Artwork src={data.coverUrl} alt={data.coverAlt || data.name} presentation={data.coverPresentation} priority /></div>
      <div className="novel-home-copy"><p>FANTASY ARCHIVE / {String(novel.sortOrder).slice(-4)}</p><h1>{data.name}</h1><span>{data.summary}</span><small>{novel.chapters.length} CHAPTERS ONLINE</small></div>
    </section>
    <section className="chapter-directory"><div className="section-heading"><div><span>02</span><p>章节目录</p></div><h2>选择入口</h2></div>
      {novel.chapters.map((chapter, index) => <button className="directory-row" key={chapter.id} onClick={() => onRead(chapter)}><span>{String(index + 1).padStart(2, "0")}</span><div><b>{chapter.published?.title || chapter.title}</b><small>{chapter.published?.summary || chapter.summary}</small></div><i>→</i></button>)}
    </section>
  </main>;
}

function BookshelfControl({ novelId }: { novelId: string }) {
  const [present, setPresent] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [operationId, setOperationId] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  useEffect(() => {
    queueMicrotask(async () => {
      const response = await fetch(`/api/account/bookshelf/membership?novelId=${encodeURIComponent(novelId)}`);
      if (!response.ok) return;
      const body = await response.json() as { present?: boolean };
      setPresent(Boolean(body.present));
    });
  }, [novelId]);
  return <div><button className="primary" disabled={busy || present === true} onClick={async () => {
    setBusy(true); setMessage("正在加入…");
    const result = await executeBookshelfOperation({ action: "add", novelId, operationId });
    setOperationId(result.operationId);
    if (result.status === "succeeded") { setPresent(true); setOperationId(null); setMessage("已加入我的书架"); }
    else if (result.status === "auth_required") { setAuthRequired(true); setMessage("登录或注册后即可加入"); }
    else if (result.status === "confirming") setMessage("结果确认中；可以使用同一操作安全重试");
    else setMessage(result.message);
    setBusy(false);
  }}>{present ? "已在书架" : "加入书架"}</button>{authRequired && <><a className="ghost link-button" href={`/login?next=${encodeURIComponent(`/?resume=bookshelf&target=${novelId}`)}`}>登录</a><a className="ghost link-button" href={`/register?intent=bookshelf&target=${encodeURIComponent(novelId)}`}>注册</a></>}<span role="status">{message}</span></div>;
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
