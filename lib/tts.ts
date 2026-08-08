import { terminalVoiceSourceKey } from "./terminal-voice.mjs";

export const TERMINAL_TTS_MODEL = "eleven_multilingual_v2";
export const TERMINAL_TTS_MAX_TEXT = 300;
export const TERMINAL_TTS_MAX_BYTES = 20 * 1024 * 1024;

export type TerminalVoiceOption = {
  id: string;
  name: string;
  category: string;
  previewUrl: string;
  labels: Record<string, string>;
};

export type GeneratedTerminalSpeech = {
  bytes: Uint8Array;
  mimeType: "audio/mpeg";
  extension: "mp3";
  sourceKey: string;
};

export class TerminalSpeechError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 400, code = "TTS_ERROR") {
    super(message);
    this.name = "TerminalSpeechError";
    this.status = status;
    this.code = code;
  }
}

function normalizeVoiceId(value: unknown) {
  const voiceId = typeof value === "string" ? value.trim() : "";
  if (!voiceId || voiceId.length > 100 || !/^[A-Za-z0-9_-]+$/.test(voiceId)) {
    throw new TerminalSpeechError("请选择有效的 ElevenLabs 音色");
  }
  return voiceId;
}

function normalizeSpeechText(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new TerminalSpeechError("请先填写终端台词");
  if (Array.from(text).length > TERMINAL_TTS_MAX_TEXT) throw new TerminalSpeechError(`终端台词不能超过 ${TERMINAL_TTS_MAX_TEXT} 字`);
  return text;
}

type ElevenLabsSpeechOptions = { apiKey: string; fetcher?: typeof fetch; timeoutMs?: number };

export class ElevenLabsTerminalSpeechProvider {
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: ElevenLabsSpeechOptions) {
    if (!options.apiKey.trim()) throw new TerminalSpeechError("AI 语音服务尚未配置，请设置 ELEVENLABS_API_KEY", 503, "TTS_NOT_CONFIGURED");
    this.apiKey = options.apiKey;
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 45_000;
  }

  private async request(url: string, init: RequestInit) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetcher(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        throw new TerminalSpeechError("AI 语音生成超时，请稍后重试", 504, "TTS_TIMEOUT");
      }
      throw new TerminalSpeechError("无法连接 AI 语音服务，请稍后重试", 502, "TTS_UPSTREAM_UNAVAILABLE");
    } finally {
      clearTimeout(timeout);
    }
  }

  private assertResponse(response: Response) {
    if (response.ok) return;
    if (response.status === 401 || response.status === 403) throw new TerminalSpeechError("AI 语音服务鉴权失败，请检查配置", 503, "TTS_PROVIDER_AUTH");
    if (response.status === 429) throw new TerminalSpeechError("AI 语音生成频率或额度已达上限，请稍后重试", 429, "TTS_PROVIDER_LIMIT");
    if (response.status === 402) throw new TerminalSpeechError("AI 语音生成额度不足，请联系管理员", 503, "TTS_PROVIDER_QUOTA");
    throw new TerminalSpeechError(`AI 语音服务请求失败（状态 ${response.status}）`, 502, "TTS_PROVIDER_ERROR");
  }

  async listVoices(): Promise<TerminalVoiceOption[]> {
    const response = await this.request("https://api.elevenlabs.io/v2/voices?page_size=100&include_total_count=true", {
      headers: { accept: "application/json", "xi-api-key": this.apiKey },
    });
    this.assertResponse(response);
    const data = await response.json() as { voices?: Array<{ voice_id?: string; name?: string; category?: string; preview_url?: string; labels?: Record<string, string> }> };
    return (data.voices ?? []).flatMap((voice) => voice.voice_id && voice.name ? [{
      id: voice.voice_id,
      name: voice.name,
      category: voice.category ?? "",
      previewUrl: voice.preview_url ?? "",
      labels: voice.labels ?? {},
    }] : []).sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  }

  async generate({ voiceId: rawVoiceId, text: rawText }: { voiceId: string; text: string }): Promise<GeneratedTerminalSpeech> {
    const voiceId = normalizeVoiceId(rawVoiceId);
    const text = normalizeSpeechText(rawText);
    const response = await this.request(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { accept: "audio/mpeg", "content-type": "application/json", "xi-api-key": this.apiKey },
      body: JSON.stringify({
        text,
        model_id: TERMINAL_TTS_MODEL,
        voice_settings: { stability: 0.42, similarity_boost: 0.78, style: 0.18, use_speaker_boost: true, speed: 1.02 },
      }),
    });
    this.assertResponse(response);
    const contentType = (response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
    if (contentType !== "audio/mpeg" && contentType !== "audio/mp3") throw new TerminalSpeechError("AI 语音服务返回了不支持的格式", 502, "TTS_INVALID_MIME");
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > TERMINAL_TTS_MAX_BYTES) throw new TerminalSpeechError("AI 语音文件超过 20MB 限制", 502, "TTS_TOO_LARGE");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.byteLength) throw new TerminalSpeechError("AI 语音服务返回了空文件", 502, "TTS_EMPTY_RESPONSE");
    if (bytes.byteLength > TERMINAL_TTS_MAX_BYTES) throw new TerminalSpeechError("AI 语音文件超过 20MB 限制", 502, "TTS_TOO_LARGE");
    return { bytes, mimeType: "audio/mpeg", extension: "mp3", sourceKey: terminalVoiceSourceKey(voiceId, text) };
  }
}
