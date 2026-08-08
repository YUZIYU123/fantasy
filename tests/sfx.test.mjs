import assert from "node:assert/strict";
import test from "node:test";
import {
  createSoundEffectProvider,
  ElevenLabsSoundEffectProvider,
  normalizeSfxGenerationDuration,
  normalizeSfxPrompt,
  SFX_MAX_BYTES,
  SoundEffectError,
  suggestChoiceSfxPrompt,
} from "../lib/sfx.ts";

test("中文提示词建议包含选项语义与互动风格", () => {
  const prompt = suggestChoiceSfxPrompt("推开舱门", "push");
  assert.match(prompt, /推开舱门/);
  assert.match(prompt, /推进呼啸/);
  assert.match(prompt, /不要语音/);
  assert.equal(suggestChoiceSfxPrompt("推开舱门", "push"), prompt);
});

test("ElevenLabs 提供商按 v2 参数生成并验证 MP3", async () => {
  let requestBody;
  const provider = new ElevenLabsSoundEffectProvider({
    apiKey: "test-key",
    fetcher: async (url, init) => {
      assert.equal(url, "https://api.elevenlabs.io/v1/sound-generation");
      assert.equal(new Headers(init.headers).get("xi-api-key"), "test-key");
      requestBody = JSON.parse(init.body);
      return new Response(new Uint8Array([73, 68, 51, 4]), { headers: { "content-type": "audio/mpeg" } });
    },
  });
  const generated = await provider.generate({ prompt: "短促的未来感开门声", generationDurationSeconds: 1.2, interactionPreset: "push" });
  assert.deepEqual(requestBody, {
    text: "短促的未来感开门声",
    duration_seconds: 1.2,
    prompt_influence: 0.4,
    loop: false,
    model_id: "eleven_text_to_sound_v2",
  });
  assert.equal(generated.mimeType, "audio/mpeg");
  assert.equal(generated.extension, "mp3");
  assert.equal(generated.durationSeconds, 1.2);
  assert.deepEqual(generated.bytes, new Uint8Array([73, 68, 51, 4]));
});

test("ElevenLabs 提供商明确报告鉴权、限流、MIME 与文件上限错误", async (context) => {
  for (const [name, response, code] of [
    ["401", new Response("unauthorized", { status: 401 }), "SFX_PROVIDER_AUTH"],
    ["429", new Response("limited", { status: 429 }), "SFX_PROVIDER_LIMIT"],
    ["mime", new Response("json", { headers: { "content-type": "application/json" } }), "SFX_INVALID_MIME"],
    ["size", new Response(new Uint8Array([1]), { headers: { "content-type": "audio/mpeg", "content-length": String(SFX_MAX_BYTES + 1) } }), "SFX_TOO_LARGE"],
  ]) {
    await context.test(name, async () => {
      const provider = new ElevenLabsSoundEffectProvider({ apiKey: "test-key", fetcher: async () => response });
      await assert.rejects(
        provider.generate({ prompt: "测试音效", generationDurationSeconds: 1.2, interactionPreset: "glow" }),
        (error) => error instanceof SoundEffectError && error.code === code,
      );
    });
  }
});

test("ElevenLabs 请求超过等待时间后中止", async () => {
  const provider = new ElevenLabsSoundEffectProvider({
    apiKey: "test-key",
    timeoutMs: 5,
    fetcher: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }),
  });
  await assert.rejects(
    provider.generate({ prompt: "测试音效", generationDurationSeconds: 1.2, interactionPreset: "glow" }),
    (error) => error instanceof SoundEffectError && error.code === "SFX_TIMEOUT",
  );
});

test("提供商配置、提示词和生成长度执行边界校验", () => {
  assert.throws(() => createSoundEffectProvider({ providerId: "unknown" }), /不支持/);
  assert.throws(() => createSoundEffectProvider({ providerId: "elevenlabs" }), /尚未配置/);
  assert.equal(normalizeSfxGenerationDuration(0.5), 0.5);
  assert.equal(normalizeSfxGenerationDuration(30), 30);
  assert.throws(() => normalizeSfxGenerationDuration(0.4), /0.5–30/);
  assert.throws(() => normalizeSfxPrompt(""), /填写/);
  assert.throws(() => normalizeSfxPrompt("声".repeat(451)), /450/);
});
