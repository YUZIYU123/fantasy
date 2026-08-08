import { env } from "cloudflare:workers";
import { ensureSchema } from "../../../../../db";
import { createGeneratedTerminalSpeech } from "../../../../../db/assets";
import { assertSameOrigin, authErrorResponse, enforceRateLimit, requireRole } from "../../../../../lib/auth";
import { ElevenLabsTerminalSpeechProvider, TerminalSpeechError } from "../../../../../lib/tts";

type TtsEnvironment = { ELEVENLABS_API_KEY?: string };

function provider() {
  const ttsEnv = env as unknown as TtsEnvironment;
  return new ElevenLabsTerminalSpeechProvider({ apiKey: ttsEnv.ELEVENLABS_API_KEY || "" });
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
    await ensureSchema();
    const body = await request.json() as { text?: string; voiceId?: string; voiceName?: string };
    await enforceRateLimit(request, "tts-generation-minute", identity.email, 5, 1);
    await enforceRateLimit(request, "tts-generation-day", identity.email, 50, 1_440);
    const result = await createGeneratedTerminalSpeech({
      bucket: env.ASSET_BUCKET,
      ownerId: identity.id,
      text: String(body.text || ""),
      voiceId: String(body.voiceId || ""),
      voiceName: String(body.voiceName || ""),
      provider: provider(),
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof TerminalSpeechError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
    return authErrorResponse(error);
  }
}
