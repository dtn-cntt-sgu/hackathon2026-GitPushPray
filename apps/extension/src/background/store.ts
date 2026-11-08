// Lưu trữ: phiên trong chrome.storage.session (chỉ nằm trong bộ nhớ, tự mất khi đóng trình duyệt);
// cài đặt trong chrome.storage.local. Không ghi nội dung chat vào log.
import { DEFAULT_SETTINGS, migrateSettings, SESSION_KEY, SETTINGS_KEY, type Session, type Settings } from '../shared/protocol';

export async function loadSession(): Promise<Session | null> {
  const r = await chrome.storage.session.get(SESSION_KEY);
  return (r[SESSION_KEY] as Session | undefined) ?? null;
}

export async function saveSession(s: Session): Promise<void> {
  await chrome.storage.session.set({ [SESSION_KEY]: s });
}

/** Xóa toàn bộ dữ liệu phiên rồi đọc lại để xác nhận; trả về các khóa còn sót. */
export async function clearSessionVerified(): Promise<string[]> {
  await chrome.storage.session.clear();
  const left = await chrome.storage.session.get(null);
  return Object.keys(left);
}

// Cài đặt Groq của bản cũ: xóa khỏi máy người dùng đã cài trước đó (đặc biệt là khóa API).
const LEGACY_KEYS = ['groqEnabled', 'groqApiKey', 'groqSmallModel', 'groqLargeModel'];

export async function loadSettings(): Promise<Settings> {
  const r = await chrome.storage.local.get(SETTINGS_KEY);
  const stored = { ...((r[SETTINGS_KEY] as Record<string, unknown> | undefined) ?? {}) };
  const hadLegacy = LEGACY_KEYS.some((k) => k in stored);
  for (const k of LEGACY_KEYS) delete stored[k];
  const { settings, changed } = migrateSettings(stored);
  if (hadLegacy || changed) await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  return { ...DEFAULT_SETTINGS, ...settings } as Settings;
}

export async function saveSettings(s: Settings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: s });
}