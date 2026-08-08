import { env } from "cloudflare:workers";
import { assetLifecycle } from "../../../../../db/assets";
import { assetLifecycleErrorResponse, assetLifecycleResponse } from "../../../../_asset-lifecycle-http";
import { adminAuthResponse, AdminAuthError } from "../../../../../lib/admin-auth";
import { administratorCapability } from "../../../../../lib/session-authorization";
import { AuthError } from "../../../../../lib/auth";
import { createSoundEffectProvider, SoundEffectError } from "../../../../../lib/sfx";

type SfxEnvironment = { SFX_PROVIDER?: string; ELEVENLABS_API_KEY?: string };

export async function POST(request: Request) {
  try {
    const identity = await administratorCapability.require(request);
    const body = await request.json() as { choiceText?: string; interactionPreset?: string; prompt?: string; generationDurationSeconds?: number };
    const sfxEnv = env as unknown as SfxEnvironment;
    const provider = createSoundEffectProvider({ providerId: sfxEnv.SFX_PROVIDER, elevenLabsApiKey: sfxEnv.ELEVENLABS_API_KEY });
    return assetLifecycleResponse(await assetLifecycle.execute({ kind: "administrator" }, {
      action: "generate-sfx", bucket: env.ASSET_BUCKET, provider,
      rateLimit: { request, identity: identity.email },
      choiceText: String(body.choiceText || ""), preset: String(body.interactionPreset || "glow"),
      prompt: String(body.prompt || ""), generationDurationSeconds: Number(body.generationDurationSeconds),
    }));
  } catch (error) {
    const lifecycleResponse = assetLifecycleErrorResponse(error);
    if (lifecycleResponse) return lifecycleResponse;
    if (error instanceof SoundEffectError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
    if (error instanceof AuthError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof AdminAuthError) return adminAuthResponse(error);
    return Response.json({ error: "AI 音效保存失败，请稍后重试" }, { status: 500 });
  }
}
