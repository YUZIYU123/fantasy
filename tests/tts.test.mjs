import assert from "node:assert/strict";
import test from "node:test";
import { ElevenLabsTerminalSpeechProvider, TerminalSpeechError } from "../lib/tts.ts";
import { terminalVoiceSourceKey } from "../lib/story.ts";

test("ElevenLabs 终端语音列出音色并生成 multilingual v2 MP3", async () => {
  const requests = [];
  const provider = new ElevenLabsTerminalSpeechProvider({
    apiKey: "test-key",
    fetcher: async (url, init = {}) => {
      requests.push({ url: String(url), init });
      if (String(url).includes("/v2/voices")) return Response.json({ voices: [{ voice_id: "voice-1", name: "Mimi", category: "premade", preview_url: "https://example.com/mimi.mp3", labels: { gender: "neutral" } }] });
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "audio/mpeg" } });
    },
  });
  const voices = await provider.listVoices();
  assert.equal(voices[0].name, "Mimi");
  const generated = await provider.generate({ voiceId: "voice-1", text: "任务已更新" });
  assert.equal(generated.sourceKey, terminalVoiceSourceKey("voice-1", "任务已更新"));
  const body = JSON.parse(requests[1].init.body);
  assert.equal(body.model_id, "eleven_multilingual_v2");
  assert.equal(body.text, "任务已更新");
});

test("ElevenLabs 终端语音明确报告未配置、限流和错误格式", async () => {
  assert.throws(() => new ElevenLabsTerminalSpeechProvider({ apiKey: "" }), (error) => error instanceof TerminalSpeechError && error.code === "TTS_NOT_CONFIGURED");
  const limited = new ElevenLabsTerminalSpeechProvider({ apiKey: "key", fetcher: async () => new Response("", { status: 429 }) });
  await assert.rejects(() => limited.generate({ voiceId: "voice", text: "消息" }), (error) => error.code === "TTS_PROVIDER_LIMIT");
  const invalid = new ElevenLabsTerminalSpeechProvider({ apiKey: "key", fetcher: async () => new Response("json", { headers: { "content-type": "application/json" } }) });
  await assert.rejects(() => invalid.generate({ voiceId: "voice", text: "消息" }), (error) => error.code === "TTS_INVALID_MIME");
});
