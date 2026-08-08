import { env } from "cloudflare:workers";
import { assetLifecycle } from "../../../../../db/assets";
import { assetLifecycleErrorResponse, assetLifecycleResponse } from "../../../../_asset-lifecycle-http";
import { assertSameOrigin, authErrorResponse, enforceRateLimit, requireRole } from "../../../../../lib/auth";
import { ElevenLabsTerminalSpeechProvider, TerminalSpeechError } from "../../../../../lib/tts";

type TtsEnvironment = { ELEVENLABS_API_KEY?: string };

function provider() {
  return new ElevenLabsTerminalSpeechProvider({ apiKey: ((env as unknown as TtsEnvironment).ELEVENLABS_API_KEY || "") });
}

export async function GET(request: Request) {
  try {
    await requireRole(request, ["author"]);
    return Response.json({ voices: await provider().listVoices() });
  } catch (error) {
    if (error instanceof TerminalSpeechError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const identity = await requireRole(request, ["author"]);
    const body = await request.json() as { text?: string; voiceId?: string; voiceName?: string };
    await enforceRateLimit(request, "tts-generation-minute", identity.email, 5, 1);
    await enforceRateLimit(request, "tts-generation-day", identity.email, 50, 1_440);
    return assetLifecycleResponse(await assetLifecycle.execute({ kind: "author", id: identity.id }, {
      action: "generate-tts", bucket: env.ASSET_BUCKET, provider: provider(),
      text: String(body.text || ""), voiceId: String(body.voiceId || ""), voiceName: String(body.voiceName || ""),
    }));
  } catch (error) {
    const lifecycleResponse = assetLifecycleErrorResponse(error);
    if (lifecycleResponse) return lifecycleResponse;
    if (error instanceof TerminalSpeechError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
    return authErrorResponse(error);
  }
}
