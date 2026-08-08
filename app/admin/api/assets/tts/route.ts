import { env } from "cloudflare:workers";
import { ensureSchema } from "../../../../../db";
import { createGeneratedTerminalSpeech } from "../../../../../db/assets";
import { adminAuthResponse, AdminAuthError, requireAdmin } from "../../../../../lib/admin-auth";
import { AuthError, enforceRateLimit } from "../../../../../lib/auth";
import { ElevenLabsTerminalSpeechProvider, TerminalSpeechError } from "../../../../../lib/tts";

type TtsEnvironment = { ELEVENLABS_API_KEY?: string };

function provider() {
  const ttsEnv = env as unknown as TtsEnvironment;
  return new ElevenLabsTerminalSpeechProvider({ apiKey: ttsEnv.ELEVENLABS_API_KEY || "" });
}

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    return Response.json({ voices: await provider().listVoices() });
  } catch (error) {
    if (error instanceof TerminalSpeechError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
    if (error instanceof AdminAuthError) return adminAuthResponse(error);
    return Response.json({ error: "AI 音色加载失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const identity = await requireAdmin(request);
    await ensureSchema();
    const body = await request.json() as { text?: string; voiceId?: string; voiceName?: string };
    await enforceRateLimit(request, "tts-generation-minute", identity.email, 5, 1);
    await enforceRateLimit(request, "tts-generation-day", identity.email, 50, 1_440);
    const result = await createGeneratedTerminalSpeech({
      bucket: env.ASSET_BUCKET,
      ownerId: null,
      text: String(body.text || ""),
      voiceId: String(body.voiceId || ""),
      voiceName: String(body.voiceName || ""),
      provider: provider(),
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof TerminalSpeechError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
    if (error instanceof AuthError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof AdminAuthError) return adminAuthResponse(error);
    return Response.json({ error: "AI 终端语音保存失败，请稍后重试" }, { status: 500 });
  }
}
