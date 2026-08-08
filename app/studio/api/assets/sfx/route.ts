import { env } from "cloudflare:workers";
import { ensureSchema } from "../../../../../db";
import { createGeneratedChoiceSfx } from "../../../../../db/assets";
import { assertSameOrigin, authErrorResponse, AuthError, enforceRateLimit, requireRole } from "../../../../../lib/auth";
import { createSoundEffectProvider, normalizeSfxGenerationDuration, normalizeSfxPrompt, SoundEffectError } from "../../../../../lib/sfx";

type SfxEnvironment = { SFX_PROVIDER?: string; ELEVENLABS_API_KEY?: string };

export async function POST(request: Request) {
  try {
    await ensureSchema();
    assertSameOrigin(request);
    const identity = await requireRole(request, ["author"]);
    const body = await request.json() as { choiceText?: string; interactionPreset?: string; prompt?: string; generationDurationSeconds?: number };
    try {
      const prompt = normalizeSfxPrompt(body.prompt);
      const generationDurationSeconds = normalizeSfxGenerationDuration(body.generationDurationSeconds);
      const sfxEnv = env as unknown as SfxEnvironment;
      const provider = createSoundEffectProvider({ providerId: sfxEnv.SFX_PROVIDER, elevenLabsApiKey: sfxEnv.ELEVENLABS_API_KEY });
      await enforceRateLimit(request, "sfx-generation-minute", identity.email, 5, 1);
      await enforceRateLimit(request, "sfx-generation-day", identity.email, 50, 1_440);
      const asset = await createGeneratedChoiceSfx({
        bucket: env.ASSET_BUCKET,
        ownerId: identity.id,
        choiceText: String(body.choiceText || ""),
        preset: String(body.interactionPreset || "glow"),
        prompt,
        generationDurationSeconds,
        provider,
      });
      return Response.json({ asset }, { status: 201 });
    } catch (error) {
      if (error instanceof SoundEffectError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
      if (error instanceof Error && (error.message === "请先填写选项文字" || error.message === "不支持的互动动画")) {
        throw new AuthError(error.message);
      }
      throw error;
    }
  } catch (error) {
    return authErrorResponse(error);
  }
}
