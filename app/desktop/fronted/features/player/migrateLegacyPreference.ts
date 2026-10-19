/** 将旧应用的播放器偏好复制到 CueLearn 键名，原记录保留以便回滚。 */
export function migrateLegacyPreference(previousKey: string, currentKey: string): void {
  if (typeof localStorage === 'undefined' || localStorage.getItem(currentKey) !== null) return;
  const saved = localStorage.getItem(previousKey);
  if (saved !== null) localStorage.setItem(currentKey, saved);
}
