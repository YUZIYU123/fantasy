"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { DEFAULT_COVER_PRESENTATION, type CatalogSection, type PublicCatalogItem, type PublicCatalogPage } from "../../lib/story";
import { executeBookshelfOperation } from "../bookshelf-operation-client";

export const catalogPresentation: Record<CatalogSection, {
  className: string;
  title: string;
  subtitle: string;
  href: string;
  ariaAction: string;
}> = {
  short: {
    className: "short", title: "短篇", subtitle: "凝结于一瞬的幻境", href: "/catalog/short",
    ariaAction: "开始或继续阅读短篇",
  },
  ongoing: {
    className: "serial", title: "连载小说", subtitle: "尚未闭合的世界线", href: "/catalog/ongoing",
    ariaAction: "进入连载小说",
  },
  completed: {
    className: "completed", title: "完结小说", subtitle: "已经闭合的世界线", href: "/catalog/completed",
    ariaAction: "进入完结小说",
  },
};

function metadata(item: PublicCatalogItem) {
  if (item.format === "short") {
    return `${item.wordCount.toLocaleString("zh-CN")} 字 · ${item.interactive ? "互动" : "线性"}`;
  }
  return `${item.chapterCount} 个章节${item.latestChapterTitle ? ` · 最新 ${item.latestChapterTitle}` : ""}`;
}

function CatalogArtwork({ item }: { item: PublicCatalogItem }) {
  const presentation = item.published.coverPresentation ?? DEFAULT_COVER_PRESENTATION;
  const [failed, setFailed] = useState(false);
  useEffect(() => { queueMicrotask(() => setFailed(false)); }, [item.published.coverUrl]);
  return <div className={`catalog-card-cover ${presentation.fit}${!item.published.coverUrl || failed ? " fallback" : ""}`}>
    {item.published.coverUrl && !failed && <Image
      src={item.published.coverUrl}
      alt={item.published.coverAlt || `${item.published.name}封面`}
      fill
      sizes="(max-width: 430px) 46vw, 190px"
      unoptimized
      onError={() => setFailed(true)}
      style={{ objectFit: presentation.fit, objectPosition: `${presentation.positionX}% ${presentation.positionY}%` }}
    />}
    {(!item.published.coverUrl || failed) && <span aria-hidden="true">F</span>}
  </div>;
}

function CompactBookshelfButton({
  novelId,
  present,
  onPresent,
}: {
  novelId: string;
  present: boolean | null;
  onPresent: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [message, setMessage] = useState("");
  return <div className="catalog-bookshelf-control">
    <button
      className={`catalog-bookshelf-action${present ? " is-present" : ""}`}
      aria-label={present ? "已在书架" : "加入书架"}
      title={present ? "已在书架" : "加入书架"}
      disabled={busy || present === true}
      onClick={async () => {
        setBusy(true);
        setMessage("正在加入书架");
        const result = await executeBookshelfOperation({ action: "add", novelId, operationId });
        setOperationId(result.operationId);
        if (result.status === "succeeded") {
          onPresent(); setOperationId(null); setMessage("已加入书架");
        } else if (result.status === "auth_required") {
          setAuthRequired(true); setMessage("登录或注册后即可加入");
        } else if (result.status === "confirming") setMessage("结果确认中，可以安全重试");
        else setMessage(result.message);
        setBusy(false);
      }}
    ><span aria-hidden="true">{present ? "✓" : "+"}</span></button>
    <span className="sr-only" role="status">{message}</span>
    {authRequired && <span className="catalog-auth-actions">
      <Link href={`/login?next=${encodeURIComponent(`/?resume=bookshelf&target=${novelId}`)}`}>登录</Link>
      <Link href={`/register?intent=bookshelf&target=${encodeURIComponent(novelId)}`}>注册</Link>
    </span>}
  </div>;
}

export function CatalogGrid({
  section,
  page,
  onOpen,
}: {
  section: CatalogSection;
  page: PublicCatalogPage;
  onOpen?: (id: string) => void;
}) {
  const presentation = catalogPresentation[section];
  const [memberships, setMemberships] = useState<Record<string, boolean>>({});
  const requestedMembershipIds = useRef(new Set<string>());
  const shortIds = section === "short" ? page.items.map((item) => item.id) : [];
  const shortKey = shortIds.join("\u0000");
  useEffect(() => {
    if (!shortKey) return;
    const pending = shortKey.split("\u0000").filter((id) => !requestedMembershipIds.current.has(id));
    if (pending.length === 0) return;
    for (const id of pending) requestedMembershipIds.current.add(id);
    queueMicrotask(async () => {
      const params = new URLSearchParams();
      for (const id of pending) params.append("novelId", id);
      const response = await fetch(`/api/account/bookshelf/membership?${params}`);
      if (!response.ok) return;
      const body = await response.json() as { memberships?: Record<string, boolean>; present?: boolean };
      const next = body.memberships ?? (pending.length === 1 ? { [pending[0]]: Boolean(body.present) } : {});
      setMemberships((current) => ({ ...current, ...next }));
    });
  }, [shortKey]);

  return <div className="catalog-card-grid catalog-card-grid-compact">{page.items.map((item) => {
    const href = `/?novel=${encodeURIComponent(item.id)}`;
    const content = <>
      <CatalogArtwork item={item} />
      <span className="catalog-card-copy"><small>{metadata(item)}</small><h3>{item.published.name}</h3>
        {!item.hasReadableContent && <i>暂无正文，仅作展示</i>}
      </span>
    </>;
    const handleOpen = onOpen ? (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      window.history.pushState(window.history.state, "", href);
      onOpen(item.id);
    } : undefined;
    return <article className="catalog-card" key={item.id}>
      {item.hasReadableContent
        ? <Link className="catalog-card-open" href={href} onClick={handleOpen} aria-label={`${presentation.ariaAction}：${item.published.name}`}>{content}</Link>
        : <div className="catalog-card-open catalog-card-static" aria-label={`${item.published.name}：暂无正文，仅作展示`}>{content}</div>}
      {item.format === "short" && <CompactBookshelfButton
        novelId={item.id}
        present={Object.hasOwn(memberships, item.id) ? memberships[item.id] : null}
        onPresent={() => setMemberships((current) => ({ ...current, [item.id]: true }))}
      />}
    </article>;
  })}</div>;
}
