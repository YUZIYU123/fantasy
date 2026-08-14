"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Brand } from "./brand";
import { browserRegistrationDraftStore } from "../lib/registration-draft";
import { normalizeRegistrationIntent, type RegistrationIntent, type RegistrationResumeDirective } from "../lib/registration-intent";
import { browserRegistrationAnalyticsPreference, type RegistrationTelemetryEvent } from "../lib/registration-telemetry";
import { normalizeReaderPreferences, READER_PREFERENCE_OPTIONS, type ReaderPreference } from "../lib/terminal";

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
  const data = await response.json() as {
    error?: string;
    message?: string;
    developmentToken?: string;
    retryAfterSeconds?: number;
    state?: string;
    nextActions?: string[];
    code?: string;
    user?: AuthUser;
  };
  if (!response.ok) throw new AuthRequestError(
    data.error || (data.state === "existing_account" ? "这个邮箱已经属于正常账号" : "操作失败"),
    data.retryAfterSeconds,
    data.state,
    data.nextActions,
    response.status,
    data.code,
  );
  return data;
}

class AuthRequestError extends Error {
  constructor(
    message: string,
    readonly retryAfterSeconds?: number,
    readonly state?: string,
    readonly nextActions?: string[],
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

type GuideMemory = {
  preferences: ReaderPreference[];
  guideCompletedAt: string | null;
  updatedAt: string | null;
  registrationAnalyticsAllowed: boolean;
};

async function guideMemoryRequest(method: "GET" | "PATCH" | "DELETE", body?: Record<string, unknown>) {
  const response = await fetch("/api/account/guide-memory", {
    method,
    ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const data = await response.json() as { memory?: GuideMemory; error?: string };
  if (!response.ok) throw new Error(data.error || "向导记忆操作失败");
  return data.memory;
}

const registrationSteps = ["说明", "确认", "昵称", "邮箱", "密码", "安全验证"] as const;

function RegistrationGuide() {
  const [step, setStep] = useState(0);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [analyticsAllowed, setAnalyticsAllowed] = useState(() => browserRegistrationAnalyticsPreference.load());
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [developmentToken, setDevelopmentToken] = useState("");
  const [draftReady, setDraftReady] = useState(false);
  const [intent, setIntent] = useState<RegistrationIntent | null>(null);
  const [recovery, setRecovery] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [showExistingAccountActions, setShowExistingAccountActions] = useState(false);
  const [currentEmail, setCurrentEmail] = useState("");
  const [resumeAfterConsent, setResumeAfterConsent] = useState(0);
  const operationId = useRef("");

  useEffect(() => {
    const storedAnalyticsAllowed = browserRegistrationAnalyticsPreference.load();
    if (storedAnalyticsAllowed) void authPost("record-registration-event", {
      analyticsAllowed: true,
      event: { flow: "register", stage: "invitation", outcome: "shown" },
    }).catch(() => {});
    const draft = browserRegistrationDraftStore.load();
    queueMicrotask(() => {
      if (draft) {
        setStep(draft.step > 1 ? 1 : draft.step);
        setResumeAfterConsent(draft.step > 1 ? draft.step : 0);
        setDisplayName(draft.displayName);
        setEmail(draft.email);
        setIntent(draft.intent || null);
      } else {
        const params = new URLSearchParams(window.location.search);
        const recovering = params.get("recovery") === "1";
        setRecovery(recovering);
        if (recovering) setStep(3);
        setIntent(normalizeRegistrationIntent({ kind: params.get("intent"), targetId: params.get("target") }));
      }
      setDraftReady(true);
    });
  }, []);

  const recordTelemetry = (event: RegistrationTelemetryEvent) => {
    if (!analyticsAllowed) return;
    void authPost("record-registration-event", { analyticsAllowed: true, event }).catch(() => {});
  };

  useEffect(() => {
    if (!draftReady || step >= registrationSteps.length) return;
    browserRegistrationDraftStore.save({
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
      step,
      displayName,
      email,
      ...(intent ? { intent } : {}),
    });
  }, [displayName, draftReady, email, intent, step]);

  const next = () => {
    setMessage("");
    if (step === 1 && (!ageConfirmed || !termsAccepted || !privacyAccepted)) {
      setMessage("请分别完成年龄确认、服务条款和隐私政策确认。");
      return;
    }
    if (step === 1 && resumeAfterConsent > 1) {
      setStep(resumeAfterConsent);
      setResumeAfterConsent(0);
      return;
    }
    if (recovery && step === 3) {
      recordTelemetry({ flow: "resend", stage: "step", outcome: "continued" });
      setStep(5);
      return;
    }
    recordTelemetry({ flow: restarting ? "restart" : "register", stage: "step", outcome: "continued" });
    setStep((current) => Math.min(current + 1, registrationSteps.length - 1));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (step < registrationSteps.length - 1) {
      next();
      return;
    }
    setBusy(true);
    setMessage("");
    setShowExistingAccountActions(false);
    try {
      if (!operationId.current) operationId.current = crypto.randomUUID();
      const result = recovery
        ? await authPost("resend-verification", { email, turnstileToken, analyticsAllowed, operationId: operationId.current })
        : restarting
          ? await authPost("restart-registration", {
            currentEmail, email, displayName, password, turnstileToken,
            ageConfirmed, termsAccepted, privacyAccepted, analyticsAllowed, operationId: operationId.current,
          })
          : await authPost("register", {
          email, displayName, password, turnstileToken,
          ageConfirmed, termsAccepted, privacyAccepted, analyticsAllowed, operationId: operationId.current,
          });
      if (result.state === "processing" || result.state === "uncertain") {
        setMessage("上一次操作的结果仍在确认中。请稍后再次提交，我会使用同一个操作标识安全重试。");
        return;
      }
      if (result.state === "recovery_unavailable") {
        operationId.current = "";
        setMessage("如果这个邮箱有待验证账号，现在可以稍后重试；我们不会透露账号状态。");
        return;
      }
      if (result.state !== "awaiting_email") {
        operationId.current = "";
        setMessage(result.message || "暂时无法完成账号注册，请重试。");
        return;
      }
      setDevelopmentToken(result.developmentToken || "");
      setStep(registrationSteps.length);
    } catch (error) {
      try {
        if (error instanceof AuthRequestError && error.code === "operation_mismatch") {
          operationId.current = "";
          setMessage(error.message);
          return;
        }
        const outcome = operationId.current
          ? await fetch(`/api/auth/registration-outcome?operationId=${encodeURIComponent(operationId.current)}`).then((response) => response.json() as Promise<{ state?: string }>)
          : null;
        if (outcome?.state === "succeeded") {
          setStep(registrationSteps.length);
          return;
        }
        if (outcome?.state === "uncertain" || outcome?.state === "processing") {
          setMessage("还在确认上一次操作的结果。请稍后再次提交，我会安全重试同一次操作。");
          return;
        }
        operationId.current = "";
        if (error instanceof AuthRequestError && error.state === "existing_account") {
          setShowExistingAccountActions(true);
        }
        setMessage(error instanceof AuthRequestError && error.retryAfterSeconds
          ? `${error.message}，请在 ${error.retryAfterSeconds} 秒后重试。`
          : error instanceof Error ? error.message : "账号注册失败");
      } catch {
        operationId.current = "";
        setMessage(error instanceof Error ? error.message : "账号注册失败");
      }
    } finally {
      setBusy(false);
    }
  };

  if (step === registrationSteps.length) {
    return <AuthShell title="邮件已经出发"><div className="registration-guide registration-awaiting">
      <MistGuide mood="happy" />
      <p>我会在这里等你回来。验证链接二十四小时内有效。</p>
      {developmentToken && <a className="primary link-button" href={`/verify-email?token=${encodeURIComponent(developmentToken)}`}>本地确认并进入幻界</a>}
      <button className="ghost" type="button" onClick={() => {
        operationId.current = "";
        setCurrentEmail(email);
        setRecovery(false);
        setRestarting(true);
        setStep(1);
      }}>修改邮箱</button>
      {recovery && <button className="ghost" type="button" onClick={() => {
        operationId.current = "";
        setCurrentEmail(email);
        setRecovery(false);
        setRestarting(true);
        setStep(1);
      }}>重新开始账号注册</button>}
    </div></AuthShell>;
  }

  return <AuthShell title="和小雾建立账号"><form className="registration-guide" onSubmit={submit}>
    <div className="registration-progress" aria-label={`账号注册：第 ${step + 1} 步，共 ${registrationSteps.length} 步`}>
      {registrationSteps.map((label, index) => <span key={label} className={index <= step ? "active" : ""}>{label}</span>)}
    </div>
    <MistGuide mood={message ? "concerned" : "bright"} />
    {step === 0 && <div className="registration-dialogue">
      <p>想让我替你记住这段旅程吗？建立账号后，书架和进度就不会留在这台设备里。</p>
      <small>公开小说始终可以直接阅读。</small>
    </div>}
    {step === 1 && <fieldset>
      <legend>开始前，有几件重要的事要和你说清楚。</legend>
      <label><input autoFocus type="checkbox" checked={ageConfirmed} onChange={(event) => setAgeConfirmed(event.target.checked)} />我确认已满十四周岁</label>
      <label><input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} />我已阅读并同意当前服务条款</label>
      <label><input type="checkbox" checked={privacyAccepted} onChange={(event) => setPrivacyAccepted(event.target.checked)} />我已阅读并同意当前隐私政策</label>
      <label><input name="registrationAnalytics" type="checkbox" checked={analyticsAllowed} onChange={(event) => {
        const allowed = event.target.checked;
        setAnalyticsAllowed(allowed);
        browserRegistrationAnalyticsPreference.save(allowed);
        if (allowed) void authPost("record-registration-event", {
          analyticsAllowed: true,
          event: { flow: "register", stage: "invitation", outcome: "shown" },
        }).catch(() => {});
      }} />可选：发送不含输入内容的注册步骤结果，帮助我们改进体验</label>
      <small>我们不会为年龄确认收集生日或具体年龄。</small>
      <small>拒绝不会影响注册，之后也可以在账号页更改。</small>
    </fieldset>}
    {step === 2 && <label>我该怎么称呼你？以后随时可以修改。
      <input autoFocus name="displayName" required maxLength={40} autoComplete="nickname" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
    </label>}
    {step === 3 && <label>邮箱是你回到账号的路标，我也会把验证邮件送到这里。
      <input autoFocus name="email" required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
    </label>}
    {step === 4 && <label>给账号设一把只有你知道的钥匙。我不会朗读或保存输入内容。
      <input autoFocus name="password" required minLength={15} maxLength={128} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
      <small>至少十五个字符，可以使用中文、空格和密码管理器。</small>
    </label>}
    {step === 5 && <div className="registration-security">
      <p>最后确认一下是你本人在操作。</p>
      <Turnstile action={recovery ? "resend-verification" : restarting ? "restart-registration" : "register"} onToken={setTurnstileToken} />
    </div>}
    {message && <p className="auth-message" role="alert">{message}</p>}
    {showExistingAccountActions && <div className="auth-links"><a href="/login">登录已有账号</a><a href="/forgot-password">找回密码</a></div>}
    <div className="registration-actions">
      {step > 0 && <button className="ghost" type="button" onClick={() => setStep((current) => current - 1)}>返回</button>}
      {step === 0 && <Link className="ghost link-button" href="/">暂时不用</Link>}
      <button className="primary" disabled={busy}>{busy ? "处理中…" : step === 0 ? "建立账号" : step === 5 ? "发送验证邮件" : "继续"}</button>
    </div>
  </form></AuthShell>;
}

function MistGuide({ mood }: { mood: "bright" | "concerned" | "happy" }) {
  return <div className={`mist-guide ${mood}`} aria-label="小雾，幻界向导" role="img">
    <span className="mist-hair" /><span className="mist-face"><i /><i /></span><small>小雾 · 幻界向导</small>
  </div>;
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
  return <div className="turnstile-wrap" data-action={action} ref={container}>{!siteKey && <small>本地开发可启用 LOCAL_AUTH_BYPASS</small>}</div>;
}

export function AuthForm({
  mode,
  registrationEnabled = true,
}: {
  mode: "register" | "login" | "forgot" | "reset";
  registrationEnabled?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const title = mode === "register" ? "注册读者账号" : mode === "login" ? "登录" : mode === "forgot" ? "找回密码" : "设置新密码";
  if (mode === "register" && !registrationEnabled) {
    return <AuthShell title="账号注册尚未开放"><div className="auth-result">
      <p>我们还在准备真实的联系渠道、隐私说明和邮件服务。你仍然可以浏览和阅读公开小说。</p>
      <Link className="primary link-button" href="/">继续阅读</Link>
    </div></AuthShell>;
  }
  if (mode === "register") return <RegistrationGuide />;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const token = mode === "reset" ? new URLSearchParams(window.location.search).get("token") || "" : "";
      const result = await authPost(mode === "forgot" ? "forgot-password" : mode === "reset" ? "reset-password" : mode, {
        email, password, turnstileToken, token,
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
        setMessage(`${result.message || "操作成功"} · 本地链接：/reset-password?token=${result.developmentToken}`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };
  return <AuthShell title={title}><form className="auth-form" onSubmit={submit}>
    {mode !== "reset" && <label>邮箱<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>}
    {mode !== "forgot" && <label>{mode === "reset" ? "新密码" : "密码"}<input required minLength={mode === "reset" ? 15 : 10} maxLength={128} type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} /></label>}
    {mode === "forgot" && <Turnstile action="forgot-password" onToken={setTurnstileToken} />}
    <button className="primary" disabled={busy}>{busy ? "处理中…" : title}</button>
    {message && <p className="auth-message" role="status">{message}</p>}
    <div className="auth-links">{mode !== "login" && <a href="/login">已有账号，去登录</a>}{mode === "login" && <><a href="/register">注册账号</a><a href="/forgot-password">忘记密码</a></>}</div>
  </form></AuthShell>;
}

export function VerifyEmail() {
  const [state, setState] = useState<"loading" | "ready" | "expired" | "used" | "active_session" | "invalid" | "active" | "error">("loading");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [resumeDirective, setResumeDirective] = useState<RegistrationResumeDirective | null>(null);
  const [memoryChoice, setMemoryChoice] = useState<"prompt" | "saving" | "done">("prompt");
  const [selectedPreferences, setSelectedPreferences] = useState<ReaderPreference[]>([]);
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token") || "";
    fetch(`/api/auth/verify-email?token=${encodeURIComponent(token)}`)
      .then((response) => response.json() as Promise<{ state?: typeof state }>)
      .then((result) => setState(result.state && result.state !== "loading" && result.state !== "active" && result.state !== "error" ? result.state : "invalid"))
      .catch(() => setState("error"));
  }, []);
  const activate = async () => {
    setBusy(true);
    try {
      const token = new URLSearchParams(window.location.search).get("token") || "";
      const draft = browserRegistrationDraftStore.load();
      const analyticsAllowed = browserRegistrationAnalyticsPreference.load();
      const result = await authPost("activate-account", { token, intent: draft?.intent || null, analyticsAllowed });
      setDisplayName(result.user?.displayName || "旅伴");
      setResumeDirective((result as { resumeDirective?: RegistrationResumeDirective }).resumeDirective || null);
      try {
        setSelectedPreferences(normalizeReaderPreferences(JSON.parse(localStorage.getItem("fantasy-reader-preferences") || "[]")));
      } catch {
        setSelectedPreferences([]);
      }
      browserRegistrationDraftStore.clear();
      setState("active");
    } catch {
      setState("invalid");
    } finally {
      setBusy(false);
    }
  };
  if (state === "active") return <AuthShell title="邮箱确认好了"><div className="auth-result registration-awaiting">
    <MistGuide mood="happy" /><p>欢迎回来，{displayName}。刚才的事情已经替你接上了。</p>
    {memoryChoice !== "done" ? <fieldset>
      <legend>要把这台设备的阅读偏好同步到账号吗？</legend>
      <small>可选。只保存你明确选中的项目，不会保存注册对话或推断画像。</small>
      <div className="registration-preferences">{READER_PREFERENCE_OPTIONS.map((preference) => <button
        className={selectedPreferences.includes(preference) ? "selected" : "ghost"}
        key={preference}
        type="button"
        onClick={() => setSelectedPreferences((current) => current.includes(preference)
          ? current.filter((item) => item !== preference)
          : [...current, preference].slice(-6))}
      >{preference}</button>)}</div>
      <button className="primary" type="button" disabled={memoryChoice === "saving"} onClick={async () => {
        setMemoryChoice("saving");
        try {
          await guideMemoryRequest("PATCH", { preferences: selectedPreferences, completeGuide: true });
          localStorage.setItem("fantasy-reader-preferences", JSON.stringify(selectedPreferences));
          setMemoryChoice("done");
        } catch {
          setMemoryChoice("prompt");
        }
      }}>{memoryChoice === "saving" ? "正在同步…" : "同步阅读偏好"}</button>
      <button className="ghost" type="button" onClick={() => setMemoryChoice("done")}>暂不同步</button>
    </fieldset> : <a className="primary link-button" href={resumeDirective?.targetId ? `/?resume=${resumeDirective.kind}&target=${encodeURIComponent(resumeDirective.targetId)}` : "/account"}>{resumeDirective ? "继续刚才的旅程" : "进入幻界"}</a>}
  </div></AuthShell>;
  if (state === "active_session") return <AuthShell title="欢迎回来"><div className="auth-result registration-awaiting">
    <MistGuide mood="happy" /><p>这个邮箱已经确认好了，你仍在自己的账号会话中。</p>
    <a className="primary link-button" href="/account">进入账号</a>
  </div></AuthShell>;
  const copy = state === "loading" ? "正在检查验证链接…"
    : state === "ready" ? "邮箱确认好了。准备继续刚才的旅程吗？"
      : state === "expired" ? "这个验证链接已经过期，可以重新发送。"
        : state === "used" ? "这个验证链接已经使用过。"
          : state === "error" ? "暂时无法检查链接，请稍后重试。"
            : "这个验证链接不可用。";
  return <AuthShell title="确认邮箱"><div className="auth-result"><MistGuide mood={state === "ready" ? "bright" : "concerned"} />
    <p role="status">{copy}</p>
    {state === "ready" && <button className="primary" disabled={busy} onClick={activate}>{busy ? "正在进入…" : "确认并进入幻界"}</button>}
    {(state === "expired" || state === "used" || state === "invalid") && <a className="primary link-button" href="/register?recovery=1">重新发送验证邮件</a>}
  </div></AuthShell>;
}

export function AccountPage() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<Array<{ chapterId: string; nodeId: string; pageIndex: number; updatedAt: string }>>([]);
  const [ready, setReady] = useState(false);
  const [guideMemory, setGuideMemory] = useState<GuideMemory | null>(null);
  const [accountPreferences, setAccountPreferences] = useState<ReaderPreference[]>([]);
  useEffect(() => {
    Promise.all([
      fetch("/api/auth/me").then((response) => response.json() as Promise<{ user?: AuthUser | null }>),
      fetch("/api/account/progress").then((response) => response.ok ? response.json() as Promise<{ progress?: typeof progress }> : { progress: [] }),
      guideMemoryRequest("GET").catch(() => undefined),
    ]).then(([identity, records, memory]) => {
      setUser(identity.user || null);
      setDisplayName(identity.user?.displayName || "");
      setProgress(records.progress || []);
      setGuideMemory(memory || null);
      setAccountPreferences(memory?.preferences || []);
      setReady(true);
    });
  }, []);
  if (ready && !user) return <AuthShell title="读者账号"><div className="auth-result"><p>请先登录。</p><a className="primary link-button" href="/login">前往登录</a></div></AuthShell>;
  return <AuthShell title="个人账号"><div className="account-card"><p>{ready ? `${user?.email} · ${user?.role === "author" ? "作者" : user?.role === "admin" ? "管理员" : "读者"}` : "加载中…"}</p><form onSubmit={async (event) => { event.preventDefault(); try { await authPost("profile", { displayName }); setUser((current) => current ? { ...current, displayName } : current); setMessage("资料已保存"); } catch (error) { setMessage(error instanceof Error ? error.message : "保存失败"); } }}><label>昵称<input required maxLength={40} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label><button className="ghost">保存资料</button></form>{message && <span role="status">{message}</span>}<b>云端阅读进度</b>{progress.length ? progress.map((item) => <span key={item.chapterId}>{item.chapterId} · {item.nodeId} · 第 {item.pageIndex + 1} 页</span>) : <span>还没有同步的阅读记录</span>}<fieldset><legend>小雾记住的阅读偏好</legend><div className="registration-preferences">{READER_PREFERENCE_OPTIONS.map((preference) => <button type="button" className={accountPreferences.includes(preference) ? "selected" : "ghost"} key={preference} onClick={() => setAccountPreferences((current) => current.includes(preference) ? current.filter((item) => item !== preference) : [...current, preference].slice(-6))}>{preference}</button>)}</div><button className="ghost" type="button" onClick={async () => { const memory = await guideMemoryRequest("PATCH", { preferences: accountPreferences, completeGuide: true }); setGuideMemory(memory || null); localStorage.setItem("fantasy-reader-preferences", JSON.stringify(accountPreferences)); setMessage("阅读偏好已同步"); }}>保存向导记忆</button><button className="ghost" type="button" onClick={async () => { const memory = await guideMemoryRequest("DELETE"); setGuideMemory(memory || null); setAccountPreferences([]); setMessage("向导记忆已清除"); }}>清除向导记忆</button><label><input type="checkbox" checked={guideMemory?.registrationAnalyticsAllowed || false} onChange={async (event) => { const allowed = event.target.checked; browserRegistrationAnalyticsPreference.save(allowed); const memory = await guideMemoryRequest("PATCH", { analyticsAllowed: allowed }); setGuideMemory(memory || null); }} />允许发送不含输入内容的注册体验分析</label><small>{guideMemory?.guideCompletedAt ? `上次同步：${guideMemory.updatedAt || guideMemory.guideCompletedAt}` : "尚未同步阅读偏好"}</small></fieldset><div><Link className="ghost link-button" href="/">返回书架</Link>{(user?.role === "author" || user?.role === "admin") && <Link className="ghost link-button" href="/creator">创作中心</Link>}<button className="ghost" onClick={async () => { await authPost("logout", {}); window.location.href = "/"; }}>退出登录</button></div></div></AuthShell>;
}

function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return <main className="auth-shell"><Brand href="/" /><section><p>FANTASY ACCOUNT</p><h1>{title}</h1>{children}</section></main>;
}
