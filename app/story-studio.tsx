"use client";

import Image from "next/image";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  DEFAULT_COVER_PRESENTATION,
  type ChapterRecord,
  type ImagePresentation,
  type NovelRecord,
  type StoryDocument,
} from "../lib/story";
import { Brand, FantasyMark } from "./brand";
import { Reader } from "./reader";
import { normalizeRegistrationIntent } from "../lib/registration-intent";
import { executeBookshelfOperation } from "./bookshelf-operation-client";
import { ReaderShell } from "./reader-shell";

export { Reader } from "./reader";

type PublicChapter = ChapterRecord;
type PublicNovel = NovelRecord & { chapters: PublicChapter[]; wordCount: number; interactive: boolean };
type View = "library" | "novel" | "cover" | "reader" | "outro";

export function StoryStudio() {
  const [view, setView] = useState<View>("library");
  const [novels, setNovels] = useState<PublicNovel[]>([]);
  const [novelId, setNovelId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [busy, setBusy] = useState(true);
  const [libraryError, setLibraryError] = useState("");

  useEffect(() => {
    if (window.scrollY > 0) window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [chapterId, novelId, view]);

  const novel = novels.find((item) => item.id === novelId) ?? null;
  const chapterIndex = novel?.chapters.findIndex((item) => item.id === chapterId) ?? -1;
  const chapter = chapterIndex >= 0 ? novel?.chapters[chapterIndex] ?? null : null;
  const nextChapter = novel && chapterIndex >= 0 ? novel.chapters[chapterIndex + 1] ?? null : null;
  const openRecommendedNovel = (id: string) => {
    const selected = novels.find((item) => item.id === id);
    if (!selected) return;
    setNovelId(id);
    if (selected.format === "short" && selected.chapters[0]?.published) {
      setChapterId(selected.chapters[0].id);
      setView("reader");
    } else setView("novel");
  };
  const readerShell = (content: ReactNode, contextLabel: string) => <ReaderShell
    active="world"
    contextLabel={contextLabel}
    novels={novels}
    onOpenNovel={openRecommendedNovel}
  >{content}</ReaderShell>;

  const load = useCallback(async () => {
    setBusy(true);
    setLibraryError("");
    try {
      const response = await fetch("/api/novels");
      if (!response.ok) throw new Error("小说读取失败");
      const data = await response.json() as { novels?: PublicNovel[] };
      setNovels(data.novels || []);
    } catch {
      setLibraryError("世界档案暂时没有加载出来");
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  useEffect(() => {
    if (busy || novels.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const requestedNovelId = params.get("novel");
    if (requestedNovelId && novels.some((item) => item.id === requestedNovelId)) {
      params.delete("novel");
      const query = params.toString();
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
      const requested = novels.find((item) => item.id === requestedNovelId)!;
      queueMicrotask(() => {
        setNovelId(requestedNovelId);
        if (requested.format === "short" && requested.chapters[0]?.published) {
          setChapterId(requested.chapters[0].id);
          setView("reader");
        } else setView("novel");
      });
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
        if (targetNovel.format === "short" && targetNovel.chapters[0]?.published) {
          setChapterId(targetNovel.chapters[0].id);
          setView("reader");
        } else setView("novel");
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
    return readerShell(<NovelHome novel={novel} onBack={() => setView("library")} onRead={(selected) => {
      setChapterId(selected.id);
      setView("cover");
    }} />, novel.published?.name || "小说档案");
  }
  if (view === "cover" && novel?.published && chapter?.published) {
    return readerShell(<ChapterCover novel={novel} chapter={chapter} onBack={() => setView("novel")} onStart={() => setView("reader")} />, chapter.published.title);
  }
  if (view === "reader" && chapter?.published) {
    return <Reader story={chapter.published} chapterId={chapter.id} chapterVersion={chapter.version} novels={novels} onOpenNovel={openRecommendedNovel} backLabel={novel?.format === "short" ? "返回世界档案" : "返回章节目录"} onBack={() => setView(novel?.format === "short" ? "library" : "novel")} onComplete={() => setView("outro")} />;
  }
  if (view === "outro" && novel?.published && chapter?.published) {
    return readerShell(<ChapterOutro novel={novel} chapter={chapter} nextChapter={novel.format === "short" ? null : nextChapter} backLabel={novel.format === "short" ? "返回世界档案" : "返回章节目录"} onBack={() => setView(novel.format === "short" ? "library" : "novel")} onNext={() => {
      if (!nextChapter) return;
      setChapterId(nextChapter.id);
      setView("cover");
    }} />, "章节完成");
  }
  return readerShell(<main className="app-shell">{busy && <div className="loading-bar" aria-label="加载中" />}<Library novels={novels} loadError={libraryError} onRetry={() => void load()} onOpen={(selected) => {
    setNovelId(selected.id);
    if (selected.format === "short" && selected.chapters[0]?.published) {
      setChapterId(selected.chapters[0].id);
      setView("reader");
    } else setView("novel");
  }} /></main>, "主档案.001");
}

function Library({ novels, loadError, onRetry, onOpen }: { novels: PublicNovel[]; loadError: string; onRetry: () => void; onOpen: (novel: PublicNovel) => void }) {
  const shortNovels = novels.filter((novel) => novel.format === "short");
  const serialNovels = novels.filter((novel) => novel.format !== "short");
  const [primaryNovel, ...archiveNovels] = serialNovels;
  const latestChapterTitle = (novel: PublicNovel) => {
    const latestChapter = novel.chapters.at(-1);
    return latestChapter?.published?.title || latestChapter?.title;
  };
  return <div className="library fantasy-library">
    <section className="hero"><FantasyMark className="hero-system-mark" /><p className="eyebrow">INTERACTIVE FICTION UNIVERSE</p><h1>穿过裂隙，<br />抵达你的故事宇宙。</h1><p className="hero-copy">每一本小说都是一座世界，每一个选择都在打开新的时间线。</p><div className="scroll-cue"><span>探索世界档案</span><i /></div></section>
    {shortNovels.length > 0 && <section className="shelf short-catalog" aria-labelledby="short-catalog-title"><div className="section-heading"><div><span>/</span><p>一次读完的故事</p></div><h2 id="short-catalog-title">短篇</h2></div><div className="short-card-grid">{shortNovels.map((novel) => <article className="short-card" key={novel.id}>
      <button className="short-card-open" onClick={() => onOpen(novel)} aria-label={`开始或继续阅读短篇：${novel.published?.name}`}><div className="short-card-cover"><Artwork src={novel.published?.coverUrl || ""} alt={novel.published?.coverAlt || novel.published?.name || "短篇封面"} presentation={novel.published?.coverPresentation} /></div><span><small>{novel.wordCount.toLocaleString("zh-CN")} 字 · {novel.interactive ? "互动" : "线性"}</small><h3>{novel.published?.name}</h3><p>{novel.published?.summary}</p><i>开始 / 继续阅读 →</i></span></button>
      <BookshelfControl novelId={novel.id} />
    </article>)}</div></section>}
    {serialNovels.length > 0 &&
    <section className="shelf archive-catalog" aria-labelledby="serial-catalog-title"><div className="section-heading"><div><span>/</span><p>持续更新的故事</p></div><h2 id="serial-catalog-title">连载小说</h2></div>
      {primaryNovel && <article className="archive-feature">
        <Artwork src={primaryNovel.published?.coverUrl || ""} alt={primaryNovel.published?.coverAlt || primaryNovel.published?.name || "小说封面"} presentation={primaryNovel.published?.coverPresentation} />
        <div className="card-copy"><p>主档案 · {primaryNovel.chapters.length} 个已发布章节</p><h3>{primaryNovel.published?.name}</h3><p>{primaryNovel.published?.summary}</p><small>最新章节 · {latestChapterTitle(primaryNovel)}</small><button onClick={() => onOpen(primaryNovel)}>进入小说 <span>→</span></button></div>
      </article>}
      {archiveNovels.length > 0 && <section className="archive-list" aria-labelledby="archive-list-title"><div className="archive-list-heading"><h2 id="archive-list-title">连载小说</h2><span>{serialNovels.length} 部已接入</span></div>{archiveNovels.map((novel) => <article key={novel.id}>
        <div className="archive-list-cover"><Artwork src={novel.published?.coverUrl || ""} alt={novel.published?.coverAlt || novel.published?.name || "小说封面"} presentation={novel.published?.coverPresentation} /></div>
        <button onClick={() => onOpen(novel)}><span><small>{novel.chapters.length} 个章节 · 最新</small><h3>{novel.published?.name}</h3><p>{latestChapterTitle(novel)}</p></span><i>→</i></button>
      </article>)}</section>}
    </section>}
    {loadError ? <div className="empty" role="alert"><b>{loadError}</b><p>请检查网络后再试，已有内容不会受到影响。</p><button className="ghost" onClick={onRetry}>重试</button></div> : novels.length === 0 && <div className="empty"><b>新的世界正在构建</b><p>小说与短篇发布后，会在这里出现。</p></div>}
    <footer><Brand /><p>你的选择，构成世界。</p><a className="text-button" href="/creator">进入创作中心</a></footer>
  </div>;
}

function NovelHome({ novel, onBack, onRead }: { novel: PublicNovel; onBack: () => void; onRead: (chapter: PublicChapter) => void }) {
  const data = novel.published!;
  return <main className="novel-home">
    <section className="novel-hero">
      <div className="novel-home-cover"><Artwork src={data.coverUrl} alt={data.coverAlt || data.name} presentation={data.coverPresentation} priority /></div>
      <div className="novel-home-copy"><p>FANTASY ARCHIVE / {String(novel.sortOrder).slice(-4)}</p><h1>{data.name}</h1><span>{data.summary}</span><small>{novel.chapters.length} CHAPTERS ONLINE</small><div className="novel-home-actions"><BookshelfControl novelId={novel.id} /><a className="ghost link-button" href="/bookshelf">我的书架</a><button className="ghost" onClick={onBack}>← 世界档案</button></div></div>
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
  return <div className="bookshelf-control"><button className="primary" disabled={busy || present === true} onClick={async () => {
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

function ChapterOutro({ novel, chapter, nextChapter, backLabel, onBack, onNext }: { novel: PublicNovel; chapter: PublicChapter; nextChapter: PublicChapter | null; backLabel: string; onBack: () => void; onNext: () => void }) {
  const story = chapter.published!;
  return <ChapterOutroScreen
    story={story}
    novelName={novel.published?.name || ""}
    backLabel={backLabel}
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
