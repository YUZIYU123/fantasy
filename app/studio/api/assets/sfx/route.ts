import { env } from "cloudflare:workers";
import { assetLifecycle } from "../../../../../db/assets";
import { assetLifecycleErrorResponse, assetLifecycleResponse } from "../../../../_asset-lifecycle-http";
import { assertSameOrigin, authErrorResponse, enforceRateLimit, requireRole } from "../../../../../lib/auth";
import { createSoundEffectProvider, SoundEffectError } from "../../../../../lib/sfx";

type SfxEnvironment = { SFX_PROVIDER?: string; ELEVENLABS_API_KEY?: string };

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const identity = await requireRole(request, ["author"]);
    const body = await request.json() as { choiceText?: string; interactionPreset?: string; prompt?: string; generationDurationSeconds?: number };
    const sfxEnv = env as unknown as SfxEnvironment;
    const provider = createSoundEffectProvider({ providerId: sfxEnv.SFX_PROVIDER, elevenLabsApiKey: sfxEnv.ELEVENLABS_API_KEY });
    await enforceRateLimit(request, "sfx-generation-minute", identity.email, 5, 1);
    await enforceRateLimit(request, "sfx-generation-day", identity.email, 50, 1_440);
    return assetLifecycleResponse(await assetLifecycle.execute({ kind: "author", id: identity.id }, {
      action: "generate-sfx", bucket: env.ASSET_BUCKET, provider,
      choiceText: String(body.choiceText || ""), preset: String(body.interactionPreset || "glow"),
      prompt: String(body.prompt || ""), generationDurationSeconds: Number(body.generationDurationSeconds),
    }));
  } catch (error) {
    const lifecycleResponse = assetLifecycleErrorResponse(error);
    if (lifecycleResponse) return lifecycleResponse;
    if (error instanceof SoundEffectError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
    return authErrorResponse(error);
  }
}
