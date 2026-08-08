import { env } from "cloudflare:workers";
import { assetLifecycle } from "../../../../../db/assets";
import { assetLifecycleErrorResponse, assetLifecycleResponse } from "../../../../_asset-lifecycle-http";
import { adminAuthResponse, AdminAuthError } from "../../../../../lib/admin-auth";
import { administratorCapability } from "../../../../../lib/session-authorization";
import { AuthError } from "../../../../../lib/auth";
import { ElevenLabsTerminalSpeechProvider, TerminalSpeechError } from "../../../../../lib/tts";

type TtsEnvironment = { ELEVENLABS_API_KEY?: string };

function provider() {
  return new ElevenLabsTerminalSpeechProvider({ apiKey: ((env as unknown as TtsEnvironment).ELEVENLABS_API_KEY || "") });
}

export async function GET(request: Request) {
  try {
    await administratorCapability.require(request);
    return Response.json({ voices: await provider().listVoices() });
  } catch (error) {
    if (error instanceof TerminalSpeechError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
    if (error instanceof AdminAuthError) return adminAuthResponse(error);
    return Response.json({ error: "AI 音色加载失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const identity = await administratorCapability.require(request);
    const body = await request.json() as { text?: string; voiceId?: string; voiceName?: string };
    return assetLifecycleResponse(await assetLifecycle.execute({ kind: "administrator" }, {
      action: "generate-tts", bucket: env.ASSET_BUCKET, provider: provider(),
      rateLimit: { request, identity: identity.email },
      text: String(body.text || ""), voiceId: String(body.voiceId || ""), voiceName: String(body.voiceName || ""),
    }));
  } catch (error) {
    const lifecycleResponse = assetLifecycleErrorResponse(error);
    if (lifecycleResponse) return lifecycleResponse;
    if (error instanceof TerminalSpeechError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
    if (error instanceof AuthError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof AdminAuthError) return adminAuthResponse(error);
    return Response.json({ error: "AI 终端语音保存失败，请稍后重试" }, { status: 500 });
  }
}
