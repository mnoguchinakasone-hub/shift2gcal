/** オプション画面：対象オリジンの権限付与、既定勤務時刻、カレンダー設定。 */

import { DEFAULT_SETTINGS, loadKnownUsers, loadSettings, saveSettings } from '../lib/config.js';
import { MSG } from '../lib/messages.js';

/** 設定キーと入力要素のIDは同じ名前で対応させる。 */
const TEXT_FIELDS = [
  'appOriginPattern',
  'apiUrlFilter',
  'currentUserSelector',
  'defaultWorkStart',
  'defaultWorkEnd',
  'defaultWorkTitle',
  'timeZone',
];

const el = {
  form: document.getElementById('settings-form'),
  targetUserId: document.getElementById('targetUserId'),
  detectStatus: document.getElementById('detect-status'),
  calendarId: document.getElementById('calendarId'),
  createHolidayEvents: document.getElementById('createHolidayEvents'),
  grantBtn: document.getElementById('grant-btn'),
  loadCalendarsBtn: document.getElementById('load-calendars-btn'),
  clearCapturesBtn: document.getElementById('clear-captures-btn'),
  revokeBtn: document.getElementById('revoke-btn'),
  permissionStatus: document.getElementById('permission-status'),
  calendarStatus: document.getElementById('calendar-status'),
  saveStatus: document.getElementById('save-status'),
  maintenanceStatus: document.getElementById('maintenance-status'),
};

/** background へメッセージを送り、失敗時は例外にする。 */
async function send(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) throw new Error(response?.error ?? '拡張機能の内部エラーです。');
  return response.data;
}

/** ステータス表示を更新する。 */
function setStatus(node, text, level = '') {
  node.textContent = text;
  node.className = `status ${level}`.trim();
}

/** オリジンパターンを検証し、正規化して返す。不正なら例外。 */
function normalizeOrigin(value) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('対象オリジンを入力してください。');
  let url;
  try {
    url = new URL(trimmed.replace(/\*$/, ''));
  } catch {
    throw new Error('URLの形式が正しくありません（例: https://example.co.jp/*）。');
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw new Error('http または https のURLを指定してください。');
  }
  return `${url.protocol}//${url.host}/*`;
}

/** 現在の権限状態を表示する。 */
async function refreshPermissionStatus(pattern) {
  if (!pattern) {
    setStatus(el.permissionStatus, '');
    return;
  }
  const granted = await chrome.permissions.contains({ origins: [pattern] });
  setStatus(
    el.permissionStatus,
    granted ? '許可済み' : '未許可',
    granted ? 'ok' : 'error',
  );
}

/**
 * 対象ユーザーの選択肢を組み立てる。
 * 候補はシフト画面のDOMから content script が集めたもの。
 */
function renderUserOptions(knownUsers, selectedUserId) {
  const options = [new Option('（自動判定）', '')];
  for (const user of knownUsers) {
    options.push(new Option(user.name ? `${user.name}（${user.userId}）` : user.userId, user.userId));
  }
  // 候補に無いIDが保存されている場合でも、選択状態を失わないようにする。
  if (selectedUserId && !knownUsers.some((user) => user.userId === selectedUserId)) {
    options.push(new Option(selectedUserId, selectedUserId));
  }
  el.targetUserId.replaceChildren(...options);
  el.targetUserId.value = selectedUserId ?? '';
}

/** 対象ユーザーの判定状況を表示する。 */
function renderDetectStatus(knownUsers, settings) {
  if (knownUsers.length === 0) {
    setStatus(el.detectStatus, 'まだ候補がありません。業務管理アプリのシフト画面を開いてください。');
    return;
  }
  if (!settings.targetUserId) {
    setStatus(
      el.detectStatus,
      `候補 ${knownUsers.length} 人を検出しました。ログイン中のユーザーを自動判定できなかったため、上から選んでください。`,
      'error',
    );
    return;
  }
  const name = knownUsers.find((user) => user.userId === settings.targetUserId)?.name;
  const how = settings.targetUserPinned ? '手動で選択' : '自動判定';
  setStatus(el.detectStatus, `対象ユーザー: ${name || settings.targetUserId}（${how}）`, 'ok');
}

/** 保存済み設定をフォームへ反映する。 */
async function restore() {
  const settings = await loadSettings();
  for (const key of TEXT_FIELDS) {
    document.getElementById(key).value = settings[key] ?? DEFAULT_SETTINGS[key];
  }
  el.createHolidayEvents.checked = settings.createHolidayEvents;

  const knownUsers = await loadKnownUsers();
  renderUserOptions(knownUsers, settings.targetUserId);
  renderDetectStatus(knownUsers, settings);

  // 保存済みカレンダーIDが一覧に無い場合でも選択状態を保てるようにする。
  if (![...el.calendarId.options].some((option) => option.value === settings.calendarId)) {
    const option = document.createElement('option');
    option.value = settings.calendarId;
    option.textContent = settings.calendarId;
    el.calendarId.append(option);
  }
  el.calendarId.value = settings.calendarId;

  await refreshPermissionStatus(settings.appOriginPattern);
}

/** 対象オリジンへのアクセス権限を要求し、content script を登録する。 */
async function grantPermission() {
  const input = document.getElementById('appOriginPattern');
  let pattern;
  try {
    pattern = normalizeOrigin(input.value);
  } catch (error) {
    setStatus(el.permissionStatus, error.message, 'error');
    return;
  }
  input.value = pattern;

  try {
    const granted = await chrome.permissions.request({ origins: [pattern] });
    if (!granted) {
      setStatus(el.permissionStatus, '権限が許可されませんでした。', 'error');
      return;
    }
    // 登録には設定値が使われるため、先に保存してから登録する。
    await saveSettings({ appOriginPattern: pattern });
    await send(MSG.REGISTER_ORIGIN);
    setStatus(el.permissionStatus, '許可済み（取り込みを有効にしました）', 'ok');
  } catch (error) {
    setStatus(el.permissionStatus, error.message, 'error');
  }
}

/** Googleに接続し、書き込み可能なカレンダー一覧を取得する。 */
async function loadCalendars() {
  el.loadCalendarsBtn.disabled = true;
  setStatus(el.calendarStatus, '取得しています...');
  try {
    const calendars = await send(MSG.LIST_CALENDARS);
    const selected = el.calendarId.value;
    el.calendarId.replaceChildren(
      ...calendars.map((calendar) => {
        const option = document.createElement('option');
        option.value = calendar.id;
        option.textContent = calendar.primary ? `${calendar.summary}（メイン）` : calendar.summary;
        return option;
      }),
    );
    if ([...el.calendarId.options].some((option) => option.value === selected)) {
      el.calendarId.value = selected;
    }
    setStatus(el.calendarStatus, `${calendars.length} 件取得しました。`, 'ok');
  } catch (error) {
    setStatus(el.calendarStatus, error.message, 'error');
  } finally {
    el.loadCalendarsBtn.disabled = false;
  }
}

/** フォームの内容を保存する。 */
async function save(event) {
  event.preventDefault();
  const patch = { createHolidayEvents: el.createHolidayEvents.checked };
  for (const key of TEXT_FIELDS) {
    patch[key] = document.getElementById(key).value.trim();
  }
  patch.calendarId = el.calendarId.value;
  patch.targetUserId = el.targetUserId.value;
  // 明示的に選んだ場合は、以降の自動判定で上書きしない。
  patch.targetUserPinned = Boolean(patch.targetUserId);

  try {
    if (patch.appOriginPattern) {
      patch.appOriginPattern = normalizeOrigin(patch.appOriginPattern);
      document.getElementById('appOriginPattern').value = patch.appOriginPattern;
    }
    if (!patch.defaultWorkStart || !patch.defaultWorkEnd) {
      throw new Error('既定の始業・終業時刻を入力してください。');
    }
    if (patch.defaultWorkStart >= patch.defaultWorkEnd) {
      throw new Error('既定の終業時刻は始業時刻より後にしてください。');
    }
    if (!patch.defaultWorkTitle) patch.defaultWorkTitle = DEFAULT_SETTINGS.defaultWorkTitle;
    if (!patch.timeZone) patch.timeZone = DEFAULT_SETTINGS.timeZone;

    await saveSettings(patch);

    // オリジンを変更した場合は content script を登録し直す（未許可ならその旨を出す）。
    if (patch.appOriginPattern) {
      try {
        await send(MSG.REGISTER_ORIGIN);
      } catch (error) {
        setStatus(el.permissionStatus, error.message, 'error');
      }
    }
    await refreshPermissionStatus(patch.appOriginPattern);
    renderDetectStatus(await loadKnownUsers(), await loadSettings());
    setStatus(el.saveStatus, '保存しました。', 'ok');
  } catch (error) {
    setStatus(el.saveStatus, error.message, 'error');
  }
}

/** 取り込み済みデータを消去する。 */
async function clearCaptures() {
  try {
    const result = await send(MSG.CLEAR_CAPTURES);
    setStatus(el.maintenanceStatus, `${result.cleared} 件の取り込みデータを消去しました。`, 'ok');
  } catch (error) {
    setStatus(el.maintenanceStatus, error.message, 'error');
  }
}

/** Google連携を解除する。 */
async function revoke() {
  try {
    await send(MSG.REVOKE_AUTH);
    setStatus(el.maintenanceStatus, 'Googleとの連携を解除しました。', 'ok');
  } catch (error) {
    setStatus(el.maintenanceStatus, error.message, 'error');
  }
}

el.form.addEventListener('submit', save);
el.grantBtn.addEventListener('click', grantPermission);
el.loadCalendarsBtn.addEventListener('click', loadCalendars);
el.clearCapturesBtn.addEventListener('click', clearCaptures);
el.revokeBtn.addEventListener('click', revoke);

restore();
