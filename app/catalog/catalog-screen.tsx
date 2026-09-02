"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { CatalogSection, PublicCatalogPage } from "../../lib/story";
import { ReaderShell } from "../reader-shell";
import { CatalogGrid, catalogPresentation } from "./catalog-ui";

const sections: CatalogSection[] = ["short", "ongoing", "completed"];

export function CatalogScreen({ section }: { section: CatalogSection }) {
  const presentation = catalogPresentation[section];
  const [page, setPage] = useState<PublicCatalogPage | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "more-error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (cursor?: string | null) => {
    const more = Boolean(cursor);
    if (more) setLoadingMore(true);
    else setState("loading");
    const params = new URLSearchParams({ section, limit: "20" });
    if (cursor) params.set("cursor", cursor);
    try {
      const response = await fetch(`/api/catalog?${params}`);
      if (!response.ok) throw new Error("目录读取失败");
      const next = await response.json() as PublicCatalogPage;
      setPage((current) => {
        if (!more || !current) return next;
        const items = new Map(current.items.map((item) => [item.id, item]));
        for (const item of next.items) items.set(item.id, item);
        return { items: [...items.values()], total: next.total, nextCursor: next.nextCursor };
      });
      setState("ready");
    } catch {
      setState(more ? "more-error" : "error");
    } finally {
      if (more) setLoadingMore(false);
    }
  }, [section]);

  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  return <ReaderShell
    active="world"
    contextLabel={`${presentation.title}目录`}
    novels={page?.items ?? []}
    onOpenNovel={(id) => { window.location.href = `/?novel=${encodeURIComponent(id)}`; }}
  ><main className="catalog-page">
    <header className="catalog-page-hero">
      <Link href="/" className="catalog-back">← 世界档案</Link>
      <p className="catalog-page-kicker">{presentation.title}</p>
      <h1>{presentation.subtitle}</h1>
      <span>{page ? `${page.total} 部作品` : "正在读取世界坐标"}</span>
    </header>
    <nav className="catalog-tabs" aria-label="作品目录分类">
      {sections.map((value) => <Link
        key={value}
        href={catalogPresentation[value].href}
        aria-current={value === section ? "page" : undefined}
      >{catalogPresentation[value].title}</Link>)}
    </nav>
    <section className="catalog-page-content" aria-label={`${presentation.title}全部作品`}>
      {state === "loading" && <div className="catalog-page-loading" role="status">世界坐标读取中…</div>}
      {state === "error" && <div className="empty" role="alert"><b>这类世界档案暂时没有加载出来</b><p>请检查网络后再试。</p><button className="ghost" onClick={() => void load()}>重试</button></div>}
      {page && page.items.length > 0 && <CatalogGrid section={section} page={page} />}
      {state === "ready" && page?.items.length === 0 && <div className="empty"><b>这里还没有可公开的世界</b><p>新作品发布后会出现在这里。</p></div>}
      {state !== "more-error" && page?.nextCursor && <button className="catalog-load-more" disabled={loadingMore} onClick={() => {
        if (!loadingMore) void load(page.nextCursor);
      }}>{loadingMore ? "正在加载…" : "加载更多"}</button>}
      {state === "more-error" && <div className="catalog-more-error" role="alert"><p>更多档案暂时没有加载出来，已有作品不受影响。</p><button className="ghost" disabled={loadingMore} onClick={() => {
        if (!loadingMore && page?.nextCursor) void load(page.nextCursor);
      }}>重试加载更多</button></div>}
    </section>
  </main></ReaderShell>;
}
