import { createAccountLifecycle, MockAuthMailer, MockTurnstileVerifier } from "../db/account-lifecycle";
import { assetLifecycle } from "../db/assets";
import { creationLifecycle } from "../db/creation-lifecycle";
import { sessionAuthorization } from "../lib/session-authorization";

type TestEnv = { ASSET_BUCKET: R2Bucket };

const lifecycleWorker = {
  async fetch(request: Request, workerEnv: TestEnv) {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/health") return Response.json({ ok: true });

    if (pathname === "/creation" && request.method === "POST") {
      const owner = { kind: "author" as const, id: crypto.randomUUID() };
      const stranger = { kind: "author" as const, id: crypto.randomUUID() };
      const created = await creationLifecycle.execute(owner, { entity: "novel", action: "create" });
      const [ownerNovels, strangerNovels] = await Promise.all([
        creationLifecycle.list(owner, "novel"),
        creationLifecycle.list(stranger, "novel"),
      ]);
      return Response.json({
        created,
        ownerIds: ownerNovels.map((novel) => novel.id),
        strangerIds: strangerNovels.map((novel) => novel.id),
      });
    }

    if (pathname === "/assets" && request.method === "POST") {
      const actor = { kind: "administrator" as const };
      const uploaded = await assetLifecycle.execute(actor, {
        action: "upload",
        bucket: workerEnv.ASSET_BUCKET,
        file: new File(["asset-contract"], "contract.txt.png", { type: "image/png" }),
        duration: 0,
        folderId: null,
        alt: "contract",
      });
      if (uploaded.kind !== "asset") throw new Error("素材上传没有返回素材");
      const id = String(uploaded.asset.id);
      const deleted = await assetLifecycle.execute(actor, { action: "delete", id, bucket: workerEnv.ASSET_BUCKET });
      const repeated = await assetLifecycle.execute(actor, { action: "delete", id, bucket: workerEnv.ASSET_BUCKET });
      const remaining = await assetLifecycle.list(actor);
      return Response.json({ uploaded, deleted, repeated, remainingIds: remaining.assets.map((asset) => asset.id) });
    }

    if (pathname === "/account" && request.method === "POST") {
      const turnstile = new MockTurnstileVerifier();
      const mailer = new MockAuthMailer();
      const lifecycle = createAccountLifecycle({ turnstile, mailer });
      const lifecycleRequest = () => new Request(request.url, {
        method: "POST",
        headers: { origin: new URL(request.url).origin },
      });
      const email = `module-${crypto.randomUUID()}@example.com`;
      const password = "contract-password-123";
      const registration = await lifecycle.execute({
        action: "register",
        request: lifecycleRequest(),
        email,
        displayName: "Module Contract",
        password,
        turnstileToken: "contract-token",
      });
      const token = mailer.calls[0]?.token;
      if (!token) throw new Error("注册没有生成验证 token");
      const verification = await lifecycle.execute({ action: "verify-email", request: lifecycleRequest(), token });
      const login = await lifecycle.execute({ action: "login", request: lifecycleRequest(), email, password });
      return Response.json({ registration, verification, login, turnstileCalls: turnstile.calls, mailCalls: mailer.calls });
    }

    if (pathname === "/authorization" && request.method === "POST") {
      const mailer = new MockAuthMailer();
      const lifecycle = createAccountLifecycle({ turnstile: new MockTurnstileVerifier(), mailer });
      const lifecycleRequest = (cookie = "") => new Request(request.url, {
        method: "POST",
        headers: { origin: new URL(request.url).origin, ...(cookie ? { cookie } : {}) },
      });
      const email = `authorization-${crypto.randomUUID()}@example.com`;
      const password = "contract-password-123";
      await lifecycle.execute({
        action: "register", request: lifecycleRequest(), email, displayName: "Authorization Contract",
        password, turnstileToken: "authorization-token",
      });
      const token = mailer.calls[0]?.token;
      if (!token) throw new Error("注册没有生成验证 token");
      await lifecycle.execute({ action: "verify-email", request: lifecycleRequest(), token });
      const login = await lifecycle.execute({ action: "login", request: lifecycleRequest(), email, password });
      if (!login.cookie) throw new Error("登录没有创建 session cookie");
      const authorizedRequest = lifecycleRequest(login.cookie);
      const before = await sessionAuthorization.require(authorizedRequest);
      await lifecycle.execute({ action: "update-user", id: before.id, status: "disabled" });
      const after = await sessionAuthorization.optional(authorizedRequest);
      return Response.json({ before, after });
    }

    return Response.json({ error: "not implemented" }, { status: 501 });
  },
};

export default lifecycleWorker;
