/**
 * Service worker（MV3）。
 *
 * - content script が拾ったAPIレスポンスを受け取り、対象月ごとに保存する
 * - popup からの依頼でプレビュー生成 / 同期実行を行う
 * - options からの依頼で対象オリジンへ content script を登録する
 */

import {
  clearCapture,
  listCapturedMonths,
  loadCapture,
  loadKnownUsers,
  loadSettings,
  saveCapture,
  saveKnownUsers,
  saveSettings,
} from '../lib/config.js';
import { deleteEvent, insertEvent, listCalendars, listSyncedEvents, updateEvent } from '../lib/calendar.js';
import { countDiff, diffPlan } from '../lib/diff.js';
import { buildMonthPlan, detectMonth, extractShiftRecords, listUsers } from '../lib/shift.js';
import { MSG } from '../lib/messages.js';
import { mergeKnownUsers, resolveCurrentUser } from '../lib/users.js';
import { revokeAccess } from '../lib/auth.js';

/** content script の登録ID。再登録時に一度解除するため固定値にする。 */
const SCRIPT_IDS = {
  interceptor: 'shift2gcal-interceptor',
  bridge: 'shift2gcal-bridge',
  userDetect: 'shift2gcal-user-detect',
};

chrome.runtime.onInstalled.addListener(() => {
  syncContentScriptRegistration().catch(reportError);
});

chrome.runtime.onStartup.addListener(() => {
  syncContentScriptRegistration().catch(reportError);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: error?.message ?? String(error) }));
  return true; // 非同期応答のためチャネルを開いたままにする。
});

/** メッセージ種別ごとの処理。 */
async function handleMessage(message) {
  switch (message?.type) {
    case MSG.CAPTURED:
      return handleCaptured(message);
    case MSG.USERS_DETECTED:
      return handleUsersDetected(message);
    case MSG.GET_STATUS:
      return getStatus();
    case MSG.BUILD_PREVIEW:
      return buildPreview(message.month);
    case MSG.APPLY_SYNC:
      return applySync(message.month);
    case MSG.REGISTER_ORIGIN:
      return syncContentScriptRegistration();
    case MSG.LIST_CALENDARS:
      return listCalendars();
    case MSG.REVOKE_AUTH:
      return revokeAccess();
    case MSG.CLEAR_CAPTURES:
      return clearAllCaptures();
    default:
      throw new Error(`未知のメッセージです: ${message?.type}`);
  }
}

/** APIレスポンスを取り込み、対象月ごとに保存する。 */
async function handleCaptured({ url, payload, capturedAt }) {
  const settings = await loadSettings();
  if (settings.apiUrlFilter && !String(url ?? '').includes(settings.apiUrlFilter)) {
    return { stored: false, reason: 'url-filtered' };
  }

  const records = extractShiftRecords(payload);
  if (records.length === 0) return { stored: false, reason: 'no-records' };

  // 1レスポンスに複数月が混ざる場合に備え、月ごとに分けて保存する。
  const byMonth = new Map();
  for (const record of records) {
    const month = record.target_day.slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month).push(record);
  }

  for (const [month, monthRecords] of byMonth) {
    await saveCapture(month, {
      month,
      url: url ?? '',
      capturedAt: capturedAt ?? Date.now(),
      records: monthRecords,
    });
  }

  const primaryMonth = detectMonth(records);
  await updateBadge();
  return { stored: true, months: [...byMonth.keys()], primaryMonth };
}

/**
 * DOMから抽出したユーザー候補を保存し、自動判定できた場合は対象ユーザーに設定する。
 *
 * 利用者が設定画面で明示的に選んだ場合（targetUserPinned）は上書きしない。
 */
async function handleUsersDetected({ candidates, currentUserNames, selectorUserId, urlUserId }) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { stored: false, reason: 'no-candidates' };
  }

  // 画面に出ている候補を蓄積する。別の月・別の部署を開いても名前が消えないようマージする。
  const users = mergeKnownUsers(await loadKnownUsers(), candidates);
  await saveKnownUsers(users);

  const detected = resolveCurrentUser({ candidates, currentUserNames, selectorUserId, urlUserId });
  const settings = await loadSettings();

  // 自動判定で上書きしてよいのは、ログイン中のユーザーを直接指している判定だけ。
  // シフト表には他ユーザーの出勤簿へのリンクがあり、そのURLにも user_id が載るため、
  // url / single 由来の判定は「まだ対象が決まっていないとき」に限って採用する。
  const identifiesLoginUser = detected.source === 'selector' || detected.source === 'name';
  const shouldApply =
    Boolean(detected.userId) &&
    !settings.targetUserPinned &&
    (identifiesLoginUser || !settings.targetUserId) &&
    settings.targetUserId !== detected.userId;
  if (shouldApply) await saveSettings({ targetUserId: detected.userId });

  return {
    stored: true,
    users,
    detectedUserId: detected.userId,
    detectedBy: detected.source,
    applied: shouldApply,
  };
}

/** popup 初期表示用の状態。 */
async function getStatus() {
  const [settings, months, knownUsers] = await Promise.all([
    loadSettings(),
    listCapturedMonths(),
    loadKnownUsers(),
  ]);
  const captures = [];
  for (const month of months) {
    const capture = await loadCapture(month);
    if (!capture) continue;
    captures.push({
      month,
      capturedAt: capture.capturedAt,
      recordCount: capture.records.length,
      userCount: listUsers(capture.records, month).length,
    });
  }
  return {
    settings,
    captures,
    knownUsers,
    targetUserName: knownUsers.find((user) => user.userId === settings.targetUserId)?.name ?? '',
    configured: Boolean(settings.appOriginPattern),
  };
}

/** 対象月の登録プランと、既存イベントとの差分を返す。 */
async function buildPreview(month) {
  const settings = await loadSettings();
  const capture = await loadCapture(month);
  if (!capture) {
    throw new Error(`${month} のシフトデータが未取得です。業務管理アプリでシフト画面を開き直してください。`);
  }

  const plan = buildMonthPlan({ month, records: capture.records, settings });
  const existing = await listSyncedEvents({ calendarId: settings.calendarId, month });
  const diff = diffPlan(plan.entries, existing);

  return {
    month,
    capturedAt: capture.capturedAt,
    recordCount: capture.records.length,
    warnings: plan.warnings,
    counts: countDiff(diff),
    diff,
  };
}

/** プレビューと同じ差分を計算し直したうえでカレンダーへ反映する。 */
async function applySync(month) {
  const settings = await loadSettings();
  const preview = await buildPreview(month);
  const { diff } = preview;
  const errors = [];
  let created = 0;
  let updated = 0;
  let removed = 0;

  for (const item of diff.create) {
    try {
      await insertEvent(settings.calendarId, item.entry);
      created += 1;
    } catch (error) {
      errors.push(`${item.entry.targetDay} 作成失敗: ${error.message}`);
    }
  }

  for (const item of diff.update) {
    try {
      await updateEvent(settings.calendarId, item.eventId, item.entry);
      updated += 1;
    } catch (error) {
      errors.push(`${item.entry.targetDay} 更新失敗: ${error.message}`);
    }
  }

  for (const item of diff.remove) {
    try {
      await deleteEvent(settings.calendarId, item.eventId);
      removed += 1;
    } catch (error) {
      errors.push(`${item.targetDay || item.eventId} 削除失敗: ${error.message}`);
    }
  }

  return { month, created, updated, removed, unchanged: diff.unchanged.length, errors };
}

/**
 * 設定されたオリジンに content script を登録し直す。
 * 権限が無い場合はエラーにして、オプション画面で権限付与を促す。
 */
async function syncContentScriptRegistration() {
  const settings = await loadSettings();
  await unregisterScripts();

  const pattern = settings.appOriginPattern?.trim();
  if (!pattern) return { registered: false, reason: 'no-origin' };

  const granted = await chrome.permissions.contains({ origins: [pattern] });
  if (!granted) throw new Error(`${pattern} へのアクセス権限がありません。オプション画面で許可してください。`);

  await chrome.scripting.registerContentScripts([
    {
      id: SCRIPT_IDS.interceptor,
      matches: [pattern],
      js: ['src/content/interceptor.js'],
      runAt: 'document_start',
      world: 'MAIN',
      allFrames: true,
    },
    {
      id: SCRIPT_IDS.bridge,
      matches: [pattern],
      js: ['src/content/bridge.js'],
      runAt: 'document_start',
      world: 'ISOLATED',
      allFrames: true,
    },
    {
      id: SCRIPT_IDS.userDetect,
      matches: [pattern],
      js: ['src/content/user-detect.js'],
      runAt: 'document_idle',
      world: 'ISOLATED',
      allFrames: true,
    },
  ]);

  return { registered: true, pattern };
}

/** 既存の登録があれば解除する。未登録なら何もしない。 */
async function unregisterScripts() {
  const registered = await chrome.scripting.getRegisteredContentScripts();
  const ids = registered
    .map((script) => script.id)
    .filter((id) => Object.values(SCRIPT_IDS).includes(id));
  if (ids.length > 0) await chrome.scripting.unregisterContentScripts({ ids });
}

/** 取り込み済みのシフトデータをすべて破棄する。 */
async function clearAllCaptures() {
  const months = await listCapturedMonths();
  for (const month of months) await clearCapture(month);
  await updateBadge();
  return { cleared: months.length };
}

/** 取り込み済み月数をバッジに出す。 */
async function updateBadge() {
  const months = await listCapturedMonths();
  await chrome.action.setBadgeBackgroundColor({ color: '#1a73e8' });
  await chrome.action.setBadgeText({ text: months.length > 0 ? String(months.length) : '' });
}

/** service worker 内の想定外エラーをログに残す。 */
function reportError(error) {
  console.error('[shift2gcal]', error);
}
