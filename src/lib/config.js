/**
 * 設定値の既定値と、chrome.storage への読み書きヘルパー。
 *
 * - settings : chrome.storage.sync（端末間で共有したいユーザー設定）
 * - capture  : chrome.storage.local（取り込んだAPIレスポンスのキャッシュ）
 */

/** 既定設定。オプション画面で上書きされる。 */
export const DEFAULT_SETTINGS = {
  /** 業務管理アプリのオリジン（例: "https://example.co.jp/*"）。権限付与とスクリプト登録に使う。 */
  appOriginPattern: '',
  /** 取り込み対象のAPI URLに含まれる文字列。空ならレスポンス形状のみで判定する。 */
  apiUrlFilter: '',
  /** 通常勤務（APIデータに存在しない日）の既定始業時刻 HH:MM。 */
  defaultWorkStart: '09:00',
  /** 通常勤務の既定終業時刻 HH:MM。 */
  defaultWorkEnd: '18:00',
  /** 通常勤務のイベント件名。 */
  defaultWorkTitle: '勤務',
  /** イベントを作成するカレンダーID。"primary" でメインカレンダー。 */
  calendarId: 'primary',
  /** イベントのタイムゾーン。 */
  timeZone: 'Asia/Tokyo',
  /** 公休・定休を終日イベントとして登録するか。false なら登録をスキップする。 */
  createHolidayEvents: true,
  /**
   * 同期対象ユーザーID。シフト取得APIのレスポンスには全ユーザー分が含まれるため、
   * 自分の user_id で絞り込む。content script がDOMから自動判定して設定する。
   */
  targetUserId: '',
  /**
   * ログイン中のユーザーを指すCSSセレクタ（任意）。
   * URLや行数から自動判定できないアプリで、ヘッダのユーザー名リンク等を指定するための逃げ道。
   */
  currentUserSelector: '',
  /** 対象ユーザーを利用者が手動で選んだか。true の間は自動判定で上書きしない。 */
  targetUserPinned: false,
};

/** 拡張プロパティに埋め込む識別子。既存イベントの検索キーになる。 */
export const SOURCE_TAG = 'shift2gcal';

/** 取り込み済みデータを保存する chrome.storage.local のキー接頭辞。 */
const CAPTURE_PREFIX = 'capture:';

/** DOMから抽出したユーザー候補を保存する chrome.storage.local のキー。 */
const KNOWN_USERS_KEY = 'knownUsers';

/** 設定を既定値とマージして返す。 */
export async function loadSettings() {
  const stored = await chrome.storage.sync.get('settings');
  return { ...DEFAULT_SETTINGS, ...(stored.settings ?? {}) };
}

/** 設定を部分更新する。 */
export async function saveSettings(patch) {
  const current = await loadSettings();
  const next = { ...current, ...patch };
  await chrome.storage.sync.set({ settings: next });
  return next;
}

/** 取り込み結果を対象月（YYYY-MM）単位で保存する。 */
export async function saveCapture(month, capture) {
  await chrome.storage.local.set({ [CAPTURE_PREFIX + month]: capture });
}

/** 対象月の取り込み結果を返す。未取得なら null。 */
export async function loadCapture(month) {
  const key = CAPTURE_PREFIX + month;
  const stored = await chrome.storage.local.get(key);
  return stored[key] ?? null;
}

/** 取り込み済みの月一覧を新しい順に返す。 */
export async function listCapturedMonths() {
  const all = await chrome.storage.local.get(null);
  return Object.keys(all)
    .filter((key) => key.startsWith(CAPTURE_PREFIX))
    .map((key) => key.slice(CAPTURE_PREFIX.length))
    .sort()
    .reverse();
}

/** 対象月の取り込み結果を削除する。 */
export async function clearCapture(month) {
  await chrome.storage.local.remove(CAPTURE_PREFIX + month);
}

/** DOMから抽出したユーザー候補を保存する。 */
export async function saveKnownUsers(users) {
  await chrome.storage.local.set({ [KNOWN_USERS_KEY]: users });
}

/** 保存済みのユーザー候補を返す。未取得なら空配列。 */
export async function loadKnownUsers() {
  const stored = await chrome.storage.local.get(KNOWN_USERS_KEY);
  return stored[KNOWN_USERS_KEY] ?? [];
}
