import { and, eq, isNull } from "drizzle-orm";
import { getDb } from ".";
import { assetFolders, assets } from "./schema";
import { normalizeSfxGenerationDuration, normalizeSfxPrompt, type SoundEffectProvider } from "../lib/sfx";
import { INTERACTION_PRESETS, type InteractionPreset } from "../lib/story";
import type { ElevenLabsTerminalSpeechProvider } from "../lib/tts";

type GenerateSfxInput = {
  bucket: R2Bucket;
  ownerId: string | null;
  choiceText: string;
  preset: string;
  prompt: string;
  generationDurationSeconds: number;
  provider: SoundEffectProvider;
};

export async function createGeneratedChoiceSfx({ bucket, ownerId, choiceText, preset, prompt, generationDurationSeconds, provider }: GenerateSfxInput) {
  const label = choiceText.trim().slice(0, 120);
  if (!label) throw new Error("请先填写选项文字");
  if (!INTERACTION_PRESETS.includes(preset as InteractionPreset)) throw new Error("不支持的互动动画");
  const generated = await provider.generate({
    prompt: normalizeSfxPrompt(prompt),
    generationDurationSeconds: normalizeSfxGenerationDuration(generationDurationSeconds),
    interactionPreset: preset as InteractionPreset,
  });
  const db = getDb();
  const folderRows = ownerId
    ? await db.select().from(assetFolders).where(and(eq(assetFolders.name, "自动生成音效"), eq(assetFolders.ownerId, ownerId))).limit(1)
    : await db.select().from(assetFolders).where(and(eq(assetFolders.name, "自动生成音效"), isNull(assetFolders.ownerId))).limit(1);
  let folderId = folderRows[0]?.id ?? "";
  if (!folderId) {
    folderId = crypto.randomUUID();
    await db.insert(assetFolders).values({ id: folderId, name: "自动生成音效", ownerId });
  }
  const id = crypto.randomUUID();
  const storageKey = `audio/generated/${ownerId || "global"}/${id}.${generated.extension}`;
  const url = `/api/assets/${id}`;
  const now = new Date().toISOString();
  const row = {
    id,
    name: `选项-${Array.from(label).slice(0, 18).join("").replace(/[\\/:*?"<>|]/g, "-")}-${preset}.${generated.extension}`,
    type: "audio" as const,
    url,
    storageKey,
    folderId,
    ownerId,
    mimeType: generated.mimeType,
    size: generated.bytes.byteLength,
    duration: Math.max(1, Math.ceil(generated.durationSeconds)),
    alt: "",
    status: "ready" as const,
  };
  await bucket.put(storageKey, generated.bytes, { httpMetadata: { contentType: generated.mimeType } });
  try {
    await db.insert(assets).values(row);
  } catch (error) {
    await bucket.delete(storageKey);
    throw error;
  }
  return { ...row, createdAt: now, updatedAt: now };
}

export async function createGeneratedTerminalSpeech({
  bucket,
  ownerId,
  text,
  voiceId,
  voiceName,
  provider,
}: {
  bucket: R2Bucket;
  ownerId: string | null;
  text: string;
  voiceId: string;
  voiceName: string;
  provider: ElevenLabsTerminalSpeechProvider;
}) {
  const generated = await provider.generate({ voiceId, text });
  const db = getDb();
  const folderName = "自动生成终端语音";
  const folderRows = ownerId
    ? await db.select().from(assetFolders).where(and(eq(assetFolders.name, folderName), eq(assetFolders.ownerId, ownerId))).limit(1)
    : await db.select().from(assetFolders).where(and(eq(assetFolders.name, folderName), isNull(assetFolders.ownerId))).limit(1);
  let folderId = folderRows[0]?.id ?? "";
  if (!folderId) {
    folderId = crypto.randomUUID();
    await db.insert(assetFolders).values({ id: folderId, name: folderName, ownerId });
  }
  const id = crypto.randomUUID();
  const storageKey = `audio/terminal/${ownerId || "global"}/${id}.${generated.extension}`;
  const url = `/api/assets/${id}`;
  const now = new Date().toISOString();
  const safeVoice = Array.from(voiceName.trim() || "AI音色").slice(0, 20).join("").replace(/[\\/:*?"<>|]/g, "-");
  const safeText = Array.from(text.trim()).slice(0, 16).join("").replace(/[\\/:*?"<>|]/g, "-");
  const row = {
    id,
    name: `终端-${safeVoice}-${safeText}.${generated.extension}`,
    type: "audio" as const,
    url,
    storageKey,
    folderId,
    ownerId,
    mimeType: generated.mimeType,
    size: generated.bytes.byteLength,
    duration: 0,
    alt: "",
    status: "ready" as const,
  };
  await bucket.put(storageKey, generated.bytes, { httpMetadata: { contentType: generated.mimeType } });
  try {
    await db.insert(assets).values(row);
  } catch (error) {
    await bucket.delete(storageKey);
    throw error;
  }
  return { asset: { ...row, createdAt: now, updatedAt: now }, sourceKey: generated.sourceKey };
}
