/** @param {string} voiceId @param {string} message */
export function terminalVoiceSourceKey(voiceId, message) {
  const source = `${voiceId.trim()}\u0000${message.trim()}`;
  let hash = 2166136261;
  for (const character of source) {
    hash ^= character.codePointAt(0) || 0;
    hash = Math.imul(hash, 16777619);
  }
  return `v1-${(hash >>> 0).toString(36)}`;
}
