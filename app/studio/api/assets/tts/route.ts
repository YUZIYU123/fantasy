import { env } from "cloudflare:workers";
import { assetLifecycle } from "../../../../../db/assets";
import { assetLifecycleErrorResponse, assetLifecycleResponse } from "../../../../_asset-lifecycle-http";
import { assertSameOrigin, authErrorResponse } from "../../../../../lib/auth";
import { sessionAuthorization } from "../../../../../lib/session-authorization";
import { ElevenLabsTerminalSpeechProvider, TerminalSpeechError } from "../../../../../lib/tts";

type TtsEnvironment = { ELEVENLABS_API_KEY?: string };

function provider() {
  return new ElevenLabsTerminalSpeechProvider({ apiKey: ((env as unknown as TtsEnvironment).ELEVENLABS_API_KEY || "") });
}

export async function GET(request: Request) {
  try {
    await sessionAuthorization.requireRole(request, ["author"]);
    return Response.json({ voices: await provider().listVoices() });
  } catch (error) {
    if (error instanceof TerminalSpeechError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const identity = await sessionAuthorization.requireRole(request, ["author"]);
    const body = await request.json() as { text?: string; voiceId?: string; voiceName?: string };
    return assetLifecycleResponse(await assetLifecycle.execute({ kind: "author", id: identity.id }, {
      action: "generate-tts", bucket: env.ASSET_BUCKET, provider: provider(),
      rateLimit: { request, identity: identity.email },
      text: String(body.text || ""), voiceId: String(body.voiceId || ""), voiceName: String(body.voiceName || ""),
    }));
  } catch (error) {
    const lifecycleResponse = assetLifecycleErrorResponse(error);
    if (lifecycleResponse) return lifecycleResponse;
    if (error instanceof TerminalSpeechError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
    return authErrorResponse(error);
  }
}
