"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "./brand";
import { FantasyTerminal } from "./fantasy-terminal";
import type { RecommendableNovel } from "../lib/terminal";
import { PlanetIcon } from "@phosphor-icons/react/dist/csr/Planet";
import { BooksIcon } from "@phosphor-icons/react/dist/csr/Books";
import { SparkleIcon } from "@phosphor-icons/react/dist/csr/Sparkle";
import { UserCircleIcon } from "@phosphor-icons/react/dist/csr/UserCircle";

type ReaderDestination = "world" | "bookshelf" | "xiaowu" | "account";

const destinations = [
  { id: "world", href: "/", label: "世界", icon: PlanetIcon },
  { id: "bookshelf", href: "/bookshelf", label: "书架", icon: BooksIcon },
  { id: "xiaowu", href: "/xiaowu", label: "小雾", icon: SparkleIcon },
  { id: "account", href: "/account", label: "我的", icon: UserCircleIcon },
] as const;

export function ReaderShell({
  active,
  contextLabel,
  novels = [],
  onOpenNovel,
  companion = "visible",
  children,
}: {
  active: ReaderDestination;
  contextLabel: string;
  novels?: RecommendableNovel[];
  onOpenNovel?: (id: string) => void;
  companion?: "visible" | "hidden";
  children: ReactNode;
}) {
  return <div className="reader-shell">
    <header className="reader-system-header">
      <Brand href="/" caption="HUANJIE OS" />
      <span><small>连接状态</small><b>已连接</b></span>
      <span><small>当前档案</small><b>{contextLabel}</b></span>
    </header>
    <div className="reader-shell-content">{children}</div>
    <nav className="reader-dock" aria-label="读者主导航">
      {destinations.map((destination) => {
        const Icon = destination.icon;
        return <Link
          aria-current={active === destination.id ? "page" : undefined}
          href={destination.href}
          key={destination.id}
        ><Icon aria-hidden size={24} weight="light" /><span>{destination.label}</span></Link>;
      })}
    </nav>
    {companion === "visible" && <FantasyTerminal novels={novels} onOpenNovel={onOpenNovel} />}
  </div>;
}
