"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { CreatorAccessDecision } from "../../lib/session-authorization-module";
import { Brand } from "../brand";

type CreatorEntryResponse = Pick<CreatorAccessDecision, "redirectTo" | "reason" | "accountRole">;
const navigateWindow = (to: string) => window.location.replace(to);

export function CreatorEntry({
  navigate = navigateWindow,
}: {
  navigate?: (to: string) => void;
}) {
  const [state, setState] = useState<"resolving" | "reader" | "error">("resolving");

  const resolveEntry = useCallback(async () => {
    setState("resolving");
    try {
      const response = await fetch("/api/auth/creator-entry", { cache: "no-store" });
      if (!response.ok) throw new Error("无法确认创作权限");
      const access = await response.json() as CreatorEntryResponse;
      if (access.redirectTo) {
        navigate(access.redirectTo);
        return;
      }
      setState("reader");
    } catch {
      setState("error");
    }
  }, [navigate]);

  useEffect(() => { queueMicrotask(() => void resolveEntry()); }, [resolveEntry]);

  return <main className="creator-login"><section>
    <Brand />
    <p className="eyebrow">CREATOR PORTAL</p>
    <h1>创作中心</h1>
    {state === "resolving" && <p role="status">正在确认创作权限…</p>}
    {state === "reader" && <>
      <p>当前账号是读者账号，需要管理员升级为作者后才能进入作者工作台。</p>
      <Link className="primary auth-link-button" href="/account">查看账号</Link>
    </>}
    {state === "error" && <>
      <p role="alert">暂时无法确认创作权限，请检查本地服务后重试。</p>
      <button className="primary" onClick={() => void resolveEntry()}>重新检查权限</button>
    </>}
    <Link href="/">← 返回读者端</Link>
  </section></main>;
}
