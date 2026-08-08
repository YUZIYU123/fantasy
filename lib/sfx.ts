import type { InteractionPreset } from "./story";

export const SFX_PROMPT_MAX_LENGTH = 450;
export const SFX_GENERATION_MIN_SECONDS = 0.5;
export const SFX_GENERATION_MAX_SECONDS = 30;
export const SFX_GENERATION_DEFAULT_SECONDS = 1.2;
export const SFX_MAX_BYTES = 20 * 1024 * 1024;

export type SoundEffectRequest = {
  prompt: string;
  generationDurationSeconds: number;
  interactionPreset: InteractionPreset;
};

export type GeneratedSoundEffect = {
  bytes: Uint8Array;
  mimeType: "audio/mpeg";
  extension: "mp3";
  durationSeconds: number;
  provider: string;
};

export interface SoundEffectProvider {
  readonly id: string;
  generate(input: SoundEffectRequest): Promise<GeneratedSoundEffect>;
}

export class SoundEffectError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 400, code = "SFX_ERROR") {
    super(message);
    this.name = "SoundEffectError";
    this.status = status;
    this.code = code;
  }
}

const presetPrompt: Record<InteractionPreset, string> = {
  none: "克制、自然的确认提示音",
  glow: "柔和明亮的魔法光芒提示音，清澈而有沉浸感",
  ripple: "细腻的水波扩散与轻微空间回响",
  shake: "短促有力的低频冲击与轻微震动",
  flash: "迅速明亮的闪光冲击，干净利落",
  glitch: "短促的未来感数字故障与电子碎裂",
  push: "流畅的向前推进呼啸与轻微空气掠过",
};

export function suggestChoiceSfxPrompt(choiceText: string, preset: InteractionPreset) {
  const action = choiceText.trim().slice(0, 120) || "确认剧情选择";
  return `为互动小说选项“${action}”生成${presetPrompt[preset]}。只包含音效，不要语音、音乐、旋律或环境对白；起音清晰，结尾自然衰减，适合手机扬声器播放。`;
}

export function normalizeSfxPrompt(value: unknown) {
  const prompt = typeof value === "string" ? value.trim() : "";
  if (!prompt) throw new SoundEffectError("请填写 AI 音效描述");
  if (Array.from(prompt).length > SFX_PROMPT_MAX_LENGTH) {
    throw new SoundEffectError(`AI 音效描述不能超过 ${SFX_PROMPT_MAX_LENGTH} 字`);
  }
  return prompt;
}

export function normalizeSfxGenerationDuration(value: unknown) {
  const duration = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(duration) || duration < SFX_GENERATION_MIN_SECONDS || duration > SFX_GENERATION_MAX_SECONDS) {
    throw new SoundEffectError(`AI 生成长度须在 ${SFX_GENERATION_MIN_SECONDS}–${SFX_GENERATION_MAX_SECONDS} 秒之间`);
  }
  return Math.round(duration * 10) / 10;
}

type ElevenLabsProviderOptions = {
  apiKey: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
};

export class ElevenLabsSoundEffectProvider implements SoundEffectProvider {
  readonly id = "elevenlabs";
  private readonly options: ElevenLabsProviderOptions;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: ElevenLabsProviderOptions) {
    if (!options.apiKey.trim()) {
      throw new SoundEffectError("AI 音效服务尚未配置，请联系管理员设置 ELEVENLABS_API_KEY", 503, "SFX_NOT_CONFIGURED");
    }
    this.options = options;
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 45_000;
  }

  async generate(input: SoundEffectRequest): Promise<GeneratedSoundEffect> {
    const prompt = normalizeSfxPrompt(input.prompt);
    const duration = normalizeSfxGenerationDuration(input.generationDurationSeconds);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetcher("https://api.elevenlabs.io/v1/sound-generation", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "audio/mpeg",
          "xi-api-key": this.options.apiKey,
        },
        body: JSON.stringify({
          text: prompt,
          duration_seconds: duration,
          prompt_influence: 0.4,
          loop: false,
          model_id: "eleven_text_to_sound_v2",
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        throw new SoundEffectError("AI 音效生成超时，请稍后重试", 504, "SFX_TIMEOUT");
      }
      throw new SoundEffectError("无法连接 AI 音效服务，请稍后重试", 502, "SFX_UPSTREAM_UNAVAILABLE");
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new SoundEffectError("AI 音效服务鉴权失败，请联系管理员检查配置", 503, "SFX_PROVIDER_AUTH");
      }
      if (response.status === 429) {
        throw new SoundEffectError("AI 音效生成额度或频率已达上限，请稍后重试", 429, "SFX_PROVIDER_LIMIT");
      }
      if (response.status === 402) {
        throw new SoundEffectError("AI 音效生成额度不足，请联系管理员", 503, "SFX_PROVIDER_QUOTA");
      }
      throw new SoundEffectError(`AI 音效生成失败（服务状态 ${response.status}）`, 502, "SFX_PROVIDER_ERROR");
    }

    const contentType = (response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
    if (contentType !== "audio/mpeg" && contentType !== "audio/mp3") {
      throw new SoundEffectError("AI 音效服务返回了不支持的文件格式", 502, "SFX_INVALID_MIME");
    }
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > SFX_MAX_BYTES) {
      throw new SoundEffectError("AI 音效文件超过 20MB 限制", 502, "SFX_TOO_LARGE");
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.byteLength) throw new SoundEffectError("AI 音效服务返回了空文件", 502, "SFX_EMPTY_RESPONSE");
    if (bytes.byteLength > SFX_MAX_BYTES) throw new SoundEffectError("AI 音效文件超过 20MB 限制", 502, "SFX_TOO_LARGE");
    return { bytes, mimeType: "audio/mpeg", extension: "mp3", durationSeconds: duration, provider: this.id };
  }
}

export function createSoundEffectProvider({
  providerId,
  elevenLabsApiKey,
  fetcher,
}: {
  providerId?: string;
  elevenLabsApiKey?: string;
  fetcher?: typeof fetch;
}): SoundEffectProvider {
  const id = (providerId || "elevenlabs").trim().toLowerCase();
  if (id === "elevenlabs") return new ElevenLabsSoundEffectProvider({ apiKey: elevenLabsApiKey || "", fetcher });
  throw new SoundEffectError(`不支持的 AI 音效提供商：${id}`, 503, "SFX_PROVIDER_UNSUPPORTED");
}
