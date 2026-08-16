"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { BookshelfItem } from "../../lib/bookshelf-lifecycle";
import { Brand } from "../brand";
import { executeBookshelfOperation } from "../bookshelf-operation-client";

type Page = { kind: "page"; items: BookshelfItem[]; nextCursor: string | null };

async function requestPage(cursor?: string | null) {
  const url = `/api/account/bookshelf${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.status === 401 || response.status === 403) return { authRequired: true as const };
      const body = await response.json() as Page & { error?: string };
      if (!response.ok) {
        if (response.status >= 500 && attempt === 0) continue;
        throw new Error(body.error || "书架加载失败");
      }
      return { authRequired: false as const, page: body };
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
  throw new Error("书架加载失败");
}

export function BookshelfScreen() {
  const [items, setItems] = useState<BookshelfItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "auth" | "error" | "more-error">("loading");
  const [message, setMessage] = useState("");
  const [removing, setRemoving] = useState<BookshelfItem | null>(null);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [removalPending, setRemovalPending] = useState(false);
  const removeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const removeIndexRef = useRef(0);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const loadingMoreRef = useRef(false);
  const removalPendingRef = useRef(false);
  const load = useCallback(async (nextCursor?: string | null) => {
    const more = Boolean(nextCursor);
    if (more) {
      if (loadingMoreRef.current) return;
      loadingMoreRef.current = true;
      setLoadingMore(true);
    }
    if (!more) setState("loading");
    try {
      const result = await requestPage(nextCursor);
      if (result.authRequired) { setState("auth"); return; }
      setItems((current) => more ? [...current, ...result.page.items] : result.page.items);
      setCursor(result.page.nextCursor);
      setState("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "书架加载失败");
      setState(more ? "more-error" : "error");
    } finally {
      if (more) { loadingMoreRef.current = false; setLoadingMore(false); }
    }
  }, []);
  useEffect(() => { queueMicrotask(() => load()); }, [load]);
  useEffect(() => {
    if (removing && removalPending) dialogRef.current?.focus();
  }, [removing, removalPending]);

  const restoreFocus = (removed: boolean) => setTimeout(() => {
    if (!removed && removeTriggerRef.current?.isConnected) { removeTriggerRef.current.focus(); return; }
    const buttons = [...document.querySelectorAll<HTMLButtonElement>(".bookshelf-remove")];
    (buttons[Math.min(removeIndexRef.current, Math.max(0, buttons.length - 1))] || headingRef.current)?.focus();
  }, 0);

  const closeDialog = () => {
    if (removalPendingRef.current) return;
    setRemoving(null);
    restoreFocus(false);
  };

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { event.preventDefault(); closeDialog(); return; }
    if (event.key !== "Tab") return;
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") || [])];
    if (!focusable.length) { event.preventDefault(); dialogRef.current?.focus(); return; }
    const first = focusable[0];
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  const remove = async () => {
    if (!removing || removalPendingRef.current) return;
    removalPendingRef.current = true;
    setRemovalPending(true);
    setMessage("正在移出…");
    const result = await executeBookshelfOperation({ action: "remove", novelId: removing.novelId, operationId });
    setOperationId(result.operationId);
    if (result.status === "succeeded") {
      setItems((current) => current.filter((item) => item.novelId !== removing.novelId));
      setMessage("已移出；阅读进度仍然保留");
      setRemoving(null);
      setOperationId(null);
      restoreFocus(true);
    } else if (result.status === "confirming") setMessage("结果确认中；可以使用同一操作安全重试");
    else if (result.status === "auth_required") setMessage("会话已失效，请重新登录后再试");
    else setMessage(result.message);
    removalPendingRef.current = false;
    setRemovalPending(false);
  };

  return <main className="bookshelf-screen">
    <header className="topbar"><Brand /><nav aria-label="读者导航"><Link href="/">世界档案</Link><Link aria-current="page" href="/bookshelf">我的书架</Link></nav></header>
    <section className="bookshelf-content">
      <p className="eyebrow">PRIVATE READING ARCHIVE</p><h1 ref={headingRef} tabIndex={-1}>我的书架</h1>
      <div role="status" aria-live="polite">{state === "loading" ? "正在加载书架…" : message}</div>
      {state === "auth" && <div className="empty"><b>登录后查看我的书架</b><p>书架是你的私人收藏，会在设备之间同步。</p><Link className="primary link-button" href="/login?next=/bookshelf">登录</Link> <Link className="ghost link-button" href="/register">注册</Link></div>}
      {state === "error" && <div className="empty"><b>书架暂时没有加载出来</b><p>{message}</p><button onClick={() => load()}>重试</button></div>}
      {state === "ready" && items.length === 0 && <div className="empty"><b>书架还是空的</b><p>加入感兴趣的小说，稍后从这里继续。</p><Link className="primary link-button" href="/">去世界档案看看</Link></div>}
      {items.length > 0 && <div className="bookshelf-grid">{items.map((item, index) => <article key={item.id}>
        {item.status === "unavailable" ? <div className="bookshelf-static-title"><div className="bookshelf-cover">{item.public.coverUrl ? <Image src={item.public.coverUrl} alt={item.public.coverAlt} fill sizes="(max-width: 700px) 45vw, 240px" unoptimized /> : <span aria-hidden="true">F</span>}</div><h2>{item.public.name}</h2></div> : <Link href={`/?novel=${encodeURIComponent(item.novelId)}`} aria-label={`查看小说：${item.public.name}`}><div className="bookshelf-cover">{item.public.coverUrl ? <Image src={item.public.coverUrl} alt={item.public.coverAlt} fill sizes="(max-width: 700px) 45vw, 240px" unoptimized /> : <span aria-hidden="true">F</span>}</div><h2>{item.public.name}</h2></Link>}
        <p>{item.public.summary}</p><strong>{item.statusLabel}</strong>
        <div>{item.action.kind === "continue" ? <Link className="primary link-button" href={`/?resume=progress&target=${encodeURIComponent(item.action.chapterId)}`}>继续阅读</Link> : item.action.kind === "view" ? <Link className="primary link-button" href={`/?novel=${encodeURIComponent(item.novelId)}`}>查看小说</Link> : <button disabled>暂不可读</button>}
          <button className="ghost bookshelf-remove" onClick={(event) => { removeTriggerRef.current = event.currentTarget; removeIndexRef.current = index; setRemoving(item); setOperationId(null); setMessage(""); }}>移出书架</button></div>
      </article>)}</div>}
      {cursor && <button className="bookshelf-more" disabled={loadingMore} onClick={() => { if (!loadingMore) void load(cursor); }}>{loadingMore ? "正在加载…" : "加载更多"}</button>}
      {state === "more-error" && <div role="alert"><p>{message}</p><button disabled={loadingMore} onClick={() => { if (!loadingMore) void load(cursor); }}>重试加载更多</button></div>}
    </section>
    {removing && <div className="bookshelf-dialog-backdrop"><div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="remove-title" className="bookshelf-dialog" tabIndex={-1} onKeyDown={handleDialogKeyDown}>
      <h2 id="remove-title">移出《{removing.public.name}》？</h2><p>阅读进度仍会保留。此操作只移除书架条目。</p>
      <button className="primary" autoFocus disabled={removalPending} onClick={() => void remove()}>{removalPending ? "正在移出…" : "确认移出"}</button><button className="ghost" disabled={removalPending} onClick={closeDialog}>取消</button>
    </div></div>}
  </main>;
}
