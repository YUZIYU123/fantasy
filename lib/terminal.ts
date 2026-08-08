export const READER_PREFERENCE_OPTIONS = [
  "悬疑", "科幻", "恋爱", "奇幻", "无限流", "轻松", "紧张", "慢热", "解谜", "角色关系",
] as const;

export type ReaderPreference = typeof READER_PREFERENCE_OPTIONS[number];

export type RecommendableNovel = {
  id: string;
  published: { name: string; summary: string } | null;
};

export const TERMINAL_BOOT_DURATION_MS = 650;
export const TERMINAL_COLLAPSE_DURATION_MS = 360;

export type TerminalMessageTiming = {
  revealStepMs: number;
  revealDurationMs: number;
  fallbackDurationMs: number;
};

export function getTerminalMessageTiming(message: string, reducedMotion = false): TerminalMessageTiming {
  const characterCount = Array.from(message.trim()).length;
  if (reducedMotion) {
    return {
      revealStepMs: 0,
      revealDurationMs: 0,
      fallbackDurationMs: Math.max(1200, Math.min(5000, characterCount * 70)),
    };
  }
  const revealStepMs = characterCount === 0
    ? 0
    : Math.max(18, Math.min(38, Math.floor(2800 / characterCount)));
  const revealDurationMs = characterCount * revealStepMs;
  return {
    revealStepMs,
    revealDurationMs,
    fallbackDurationMs: Math.max(2500, Math.min(8000, characterCount * 115)),
  };
}

const preferenceKeywords: Record<ReaderPreference, string[]> = {
  悬疑: ["悬疑", "谜", "失踪", "真相", "异常", "秘密"],
  科幻: ["科幻", "未来", "终端", "系统", "太空", "机械", "数据"],
  恋爱: ["恋爱", "爱情", "心动", "恋人", "情感"],
  奇幻: ["奇幻", "魔法", "异世界", "幻界", "神秘", "世界"],
  无限流: ["副本", "无限流", "任务", "闯关", "生存"],
  轻松: ["轻松", "治愈", "日常", "温暖", "幽默"],
  紧张: ["紧张", "危机", "灾难", "追逐", "火灾", "倒计时"],
  慢热: ["慢热", "成长", "长篇", "旅程"],
  解谜: ["解谜", "谜题", "调查", "线索", "推理"],
  角色关系: ["同伴", "羁绊", "关系", "角色", "伙伴"],
};

export function normalizeReaderPreferences(value: unknown): ReaderPreference[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<string>(READER_PREFERENCE_OPTIONS);
  return [...new Set(value.filter((item): item is ReaderPreference => typeof item === "string" && allowed.has(item)))].slice(0, 6);
}

export function recommendNovels<T extends RecommendableNovel>(novels: T[], preferences: ReaderPreference[]): T[] {
  if (preferences.length === 0) return novels.slice(0, 3);
  return novels.map((novel, index) => {
    const text = `${novel.published?.name || ""} ${novel.published?.summary || ""}`.toLowerCase();
    const score = preferences.reduce((total, preference) => total + preferenceKeywords[preference]
      .reduce((matches, keyword) => matches + (text.includes(keyword.toLowerCase()) ? 2 : 0), 0), 0);
    return { novel, score, index };
  }).sort((left, right) => right.score - left.score || left.index - right.index).slice(0, 3).map(({ novel }) => novel);
}
