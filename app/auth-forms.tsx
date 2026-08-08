"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Brand } from "./brand";

type AuthUser = { id: string; email: string; displayName: string; role: "reader" | "author" | "admin"; status: string };
type TurnstileApi = {
  render: (element: HTMLElement, options: { sitekey: string; action: string; callback: (token: string) => void; "expired-callback": () => void }) => string;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window { turnstile?: TurnstileApi }
}

async function authPost(action: string, body: Record<string, unknown>) {
  const response = await fetch(`/api/auth/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json() as { error?: string; message?: string; developmentToken?: string; user?: AuthUser };
  if (!response.ok) throw new Error(data.error || "操作失败");
  return data;
}

function Turnstile({ action, onToken }: { action: string; onToken: (token: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const [siteKey, setSiteKey] = useState("");
  useEffect(() => {
    fetch("/api/auth/config").then((response) => response.json() as Promise<{ turnstileSiteKey?: string }>).then((data) => setSiteKey(data.turnstileSiteKey || "")).catch(() => {});
  }, []);
  useEffect(() => {
    if (!siteKey || !container.current) return;
    let cancelled = false;
    let widgetId = "";
    const render = () => {
      if (cancelled || !container.current || !window.turnstile) return;
      widgetId = window.turnstile.render(container.current, {
        sitekey: siteKey,
        action,
        callback: onToken,
        "expired-callback": () => onToken(""),
      });
    };
    if (window.turnstile) render();
    else {
      const existing = document.querySelector<HTMLScriptElement>('script[src^="https://challenges.cloudflare.com/turnstile/"]');
      const script = existing || document.createElement("script");
      if (!existing) {
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
      script.addEventListener("load", render, { once: true });
    }
    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [action, onToken, siteKey]);
  return <div className="turnstile-wrap" ref={container}>{!siteKey && <small>本地开发可启用 LOCAL_AUTH_BYPASS</small>}</div>;
}

export function AuthForm({ mode }: { mode: "register" | "login" | "forgot" | "reset" }) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const title = mode === "register" ? "注册读者账号" : mode === "login" ? "登录" : mode === "forgot" ? "找回密码" : "设置新密码";
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const token = mode === "reset" ? new URLSearchParams(window.location.search).get("token") || "" : "";
      const result = await authPost(mode === "forgot" ? "forgot-password" : mode === "reset" ? "reset-password" : mode, {
        email, displayName, password, turnstileToken, token,
      });
      if (mode === "login" && result.user) {
        const requested = new URLSearchParams(window.location.search).get("next");
        const safeNext = requested?.startsWith("/") && !requested.startsWith("//") ? requested : "";
        window.location.href = safeNext || (result.user.role === "author" ? "/studio" : result.user.role === "admin" ? "/admin" : "/account");
        return;
      }
      if (mode === "reset") {
        window.location.href = "/login?reset=1";
        return;
      }
      setMessage(result.message || "操作成功");
      if (result.developmentToken) {
        const target = mode === "register" ? "/verify-email" : "/reset-password";
        setMessage(`${result.message || "操作成功"} · 本地链接：${target}?token=${result.developmentToken}`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };
  return <AuthShell title={title}><form className="auth-form" onSubmit={submit}>
    {mode === "register" && <label>昵称<input required maxLength={40} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>}
    {mode !== "reset" && <label>邮箱<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>}
    {mode !== "forgot" && <label>{mode === "reset" ? "新密码" : "密码"}<input required minLength={10} maxLength={128} type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} /></label>}
    {(mode === "register" || mode === "forgot") && <Turnstile action={mode === "register" ? "register" : "forgot-password"} onToken={setTurnstileToken} />}
    <button className="primary" disabled={busy}>{busy ? "处理中…" : title}</button>
    {message && <p className="auth-message" role="status">{message}</p>}
    <div className="auth-links">{mode !== "login" && <a href="/login">已有账号，去登录</a>}{mode === "login" && <><a href="/register">注册账号</a><a href="/forgot-password">忘记密码</a></>}</div>
  </form></AuthShell>;
}

export function VerifyEmail() {
  const [message, setMessage] = useState("正在验证邮箱…");
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token") || "";
    authPost("verify-email", { token }).then(() => setMessage("邮箱验证成功，现在可以登录。")).catch((error) => setMessage(error instanceof Error ? error.message : "验证失败"));
  }, []);
  return <AuthShell title="验证邮箱"><div className="auth-result"><p>{message}</p><a className="primary link-button" href="/login">前往登录</a></div></AuthShell>;
}

export function AccountPage() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<Array<{ chapterId: string; nodeId: string; pageIndex: number; updatedAt: string }>>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    Promise.all([
      fetch("/api/auth/me").then((response) => response.json() as Promise<{ user?: AuthUser | null }>),
      fetch("/api/account/progress").then((response) => response.ok ? response.json() as Promise<{ progress?: typeof progress }> : { progress: [] }),
    ]).then(([identity, records]) => {
      setUser(identity.user || null);
      setDisplayName(identity.user?.displayName || "");
      setProgress(records.progress || []);
      setReady(true);
    });
  }, []);
  if (ready && !user) return <AuthShell title="读者账号"><div className="auth-result"><p>请先登录。</p><a className="primary link-button" href="/login">前往登录</a></div></AuthShell>;
  return <AuthShell title="个人账号"><div className="account-card"><p>{ready ? `${user?.email} · ${user?.role === "author" ? "作者" : user?.role === "admin" ? "管理员" : "读者"}` : "加载中…"}</p><form onSubmit={async (event) => { event.preventDefault(); try { await authPost("profile", { displayName }); setUser((current) => current ? { ...current, displayName } : current); setMessage("资料已保存"); } catch (error) { setMessage(error instanceof Error ? error.message : "保存失败"); } }}><label>昵称<input required maxLength={40} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label><button className="ghost">保存资料</button></form>{message && <span role="status">{message}</span>}<b>云端阅读进度</b>{progress.length ? progress.map((item) => <span key={item.chapterId}>{item.chapterId} · {item.nodeId} · 第 {item.pageIndex + 1} 页</span>) : <span>还没有同步的阅读记录</span>}<div><Link className="ghost link-button" href="/">返回书架</Link>{user?.role === "author" && <Link className="ghost link-button" href="/studio">作者工作台</Link>}<button className="ghost" onClick={async () => { await authPost("logout", {}); window.location.href = "/"; }}>退出登录</button></div></div></AuthShell>;
}

function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return <main className="auth-shell"><Brand href="/" /><section><p>FANTASY ACCOUNT</p><h1>{title}</h1>{children}</section></main>;
}
