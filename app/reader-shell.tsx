"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Brand } from "./brand";
import { FantasyTerminal } from "./fantasy-terminal";
import type { RecommendableNovel } from "../lib/terminal";
import { PlanetIcon } from "@phosphor-icons/react/dist/csr/Planet";
import { BooksIcon } from "@phosphor-icons/react/dist/csr/Books";
import { TerminalWindowIcon } from "@phosphor-icons/react/dist/csr/TerminalWindow";
import { UserCircleIcon } from "@phosphor-icons/react/dist/csr/UserCircle";

export type ReaderDestination = "world" | "bookshelf" | "terminal" | "account";

const destinations = [
  { id: "world", href: "/", label: "世界", icon: PlanetIcon },
  { id: "bookshelf", href: "/bookshelf", label: "书架", icon: BooksIcon },
  { id: "terminal", label: "终端", icon: TerminalWindowIcon },
  { id: "account", href: "/account", label: "我的", icon: UserCircleIcon },
] as const;

export function ReaderShell({
  active,
  contextLabel,
  novels = [],
  onOpenNovel,
  children,
}: {
  active: ReaderDestination;
  contextLabel: string;
  novels?: RecommendableNovel[];
  onOpenNovel?: (id: string) => void;
  children: ReactNode;
}) {
  const [terminalOpen, setTerminalOpen] = useState(false);
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
        return destination.id === "terminal"
        ? <button aria-expanded={terminalOpen} key={destination.id} onClick={() => setTerminalOpen((open) => !open)}><Icon aria-hidden size={24} weight="light" /><span>{destination.label}</span></button>
        : <Link
          aria-current={active === destination.id ? "page" : undefined}
          href={destination.href}
          key={destination.id}
        ><Icon aria-hidden size={24} weight="light" /><span>{destination.label}</span></Link>;
      })}
    </nav>
    {terminalOpen && <FantasyTerminal launcher="hidden" novels={novels} onOpenNovel={onOpenNovel} open onOpenChange={setTerminalOpen} />}
  </div>;
}
