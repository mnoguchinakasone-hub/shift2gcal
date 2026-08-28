/**
 * シフト差分JSON → カレンダー登録プランへの変換（純粋ロジック）。
 *
 * 「デフォルト ＋ 差分オーバーライド方式」を実装する。
 * 対象月の全日付を生成し、APIの差分データがある日だけ内容を差し替える。
 */

import { listMonthDays, localDateTime, nextDay, normalizeTime, parseMonth } from './dates.js';
import { shortHash } from './hash.js';

/** 差分レコードとみなすために必須のフィールド。 */
const REQUIRED_FIELDS = ['target_day', 'type'];

/** type ごとの既定件名（レコードの title が空の場合に使う）。 */
const FALLBACK_TITLES = {
  public_holiday: '公休',
  legal_holiday: '定休',
  work_input: '勤務時間変更',
  public_holiday_half_work: '半休',
};

/**
 * APIレスポンスからシフト差分レコードの配列を取り出す。
 *
 * レスポンスが配列そのものか、何らかのキーで包まれているかはアプリ側の実装に依存するため、
 * 構造を仮定せずオブジェクトを再帰的に走査して「レコードらしい配列」を集める。
 */
export function extractShiftRecords(payload) {
  const found = [];
  const seen = new Set();

  const visit = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 6) return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      const records = node.filter(isShiftRecord);
      if (records.length > 0) found.push(...records);
      node.forEach((child) => visit(child, depth + 1));
      return;
    }

    // 配列ではなくインデックスをキーにしたオブジェクトで返る場合にも対応する。
    const values = Object.values(node);
    const records = values.filter(isShiftRecord);
    if (records.length > 0) found.push(...records);
    values.forEach((child) => visit(child, depth + 1));
  };

  visit(payload, 0);

  // 同じレコードが複数経路で拾われることがあるため id / target_day で重複を除く。
  const unique = new Map();
  for (const record of found) {
    unique.set(record.id ?? record.target_day, record);
  }
  return [...unique.values()];
}

/** オブジェクトがシフト差分レコードの形をしているか判定する。 */
export function isShiftRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (!REQUIRED_FIELDS.every((field) => field in value)) return false;
  return typeof value.target_day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.target_day);
}

/** レコード配列に最も多く含まれる月（"YYYY-MM"）を返す。判定できなければ null。 */
export function detectMonth(records) {
  const counts = new Map();
  for (const record of records) {
    const month = record.target_day.slice(0, 7);
    counts.set(month, (counts.get(month) ?? 0) + 1);
  }
  let best = null;
  let bestCount = 0;
  for (const [month, count] of counts) {
    if (count > bestCount) {
      best = month;
      bestCount = count;
    }
  }
  return best;
}

/**
 * レコードに含まれる user_id を件数の多い順に返す。
 *
 * シフト取得APIのレスポンスには画面上の全ユーザー分が含まれるため、
 * 自分以外のシフトを誤って登録しないよう、事前に対象を特定する必要がある。
 *
 * @param {object[]} records 差分JSONレコード配列
 * @param {string} [month] 指定すると対象月のレコードだけを数える
 * @returns {{ userId: string, count: number }[]}
 */
export function listUsers(records, month) {
  const counts = new Map();
  for (const record of records) {
    if (month && !record.target_day.startsWith(month)) continue;
    const userId = String(record.user_id ?? '');
    if (!userId) continue;
    counts.set(userId, (counts.get(userId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([userId, count]) => ({ userId, count }))
    .sort((a, b) => b.count - a.count || a.userId.localeCompare(b.userId));
}

/**
 * 対象月の登録プランを組み立てる。
 *
 * @param {object} params
 * @param {string} params.month   対象月 "YYYY-MM"
 * @param {object[]} params.records 差分JSONレコード配列
 * @param {object} params.settings 設定（config.js の DEFAULT_SETTINGS 形状）
 * @returns {{ month: string, entries: object[], warnings: string[] }}
 */
export function buildMonthPlan({ month, records, settings }) {
  const parsed = parseMonth(month);
  if (!parsed) throw new Error(`対象月の形式が不正です: ${month}`);

  const startTime = normalizeTime(settings.defaultWorkStart);
  const endTime = normalizeTime(settings.defaultWorkEnd);
  if (!startTime || !endTime) {
    throw new Error('既定勤務時刻の形式が不正です（HH:MM で指定してください）。');
  }

  const userFilter = String(settings.targetUserId ?? '').trim();
  const users = listUsers(records, month);
  if (!userFilter && users.length > 1) {
    throw new Error(
      `シフトデータに ${users.length} 人分が含まれています。` +
        '設定画面で対象ユーザーを選択してください。',
    );
  }
  if (userFilter && users.length > 0 && !users.some((user) => user.userId === userFilter)) {
    throw new Error(
      `対象ユーザー（user_id: ${userFilter}）のシフトが ${month} のデータに含まれていません。` +
        '設定画面で対象ユーザーを選び直してください。',
    );
  }

  const warnings = [];
  const { map, duplicates } = indexByDay(records, month, userFilter);
  for (const day of duplicates) {
    warnings.push(`${day} に複数の差分レコードがあります。最後の1件を採用しました。`);
  }

  const entries = [];
  for (const targetDay of listMonthDays(parsed.year, parsed.month)) {
    const record = map.get(targetDay);
    const entry = record
      ? buildEntryFromRecord(targetDay, record, settings)
      : buildDefaultEntry(targetDay, startTime, endTime, settings);
    if (entry) entries.push(withHash(entry));
  }

  return { month, entries, warnings };
}

/** 差分レコードを target_day をキーにした Map にする。対象月・対象ユーザーで絞り込む。 */
function indexByDay(records, month, userFilter) {
  const map = new Map();
  const duplicates = new Set();

  for (const record of records) {
    if (!record.target_day.startsWith(month)) continue;
    if (userFilter && String(record.user_id ?? '') !== userFilter) continue;
    if (map.has(record.target_day)) duplicates.add(record.target_day);
    map.set(record.target_day, record);
  }
  return { map, duplicates };
}

/** 差分レコードから1日分のプランを作る。登録しない日は null を返す。 */
function buildEntryFromRecord(targetDay, record, settings) {
  const title = pickTitle(record);

  // work_start が無い日は休日扱い。type 名に依存せず値で判定する。
  if (!record.work_start || !record.work_end) {
    if (!settings.createHolidayEvents) return null;
    return {
      targetDay,
      kind: 'holiday',
      sourceType: record.type,
      title,
      allDay: true,
      start: { date: targetDay },
      end: { date: nextDay(targetDay) },
    };
  }

  return {
    targetDay,
    kind: 'override',
    sourceType: record.type,
    title,
    allDay: false,
    start: { dateTime: record.work_start, timeZone: settings.timeZone },
    end: { dateTime: record.work_end, timeZone: settings.timeZone },
  };
}

/** 差分が無い日（通常勤務）のプランを作る。 */
function buildDefaultEntry(targetDay, startTime, endTime, settings) {
  return {
    targetDay,
    kind: 'default',
    sourceType: null,
    title: settings.defaultWorkTitle,
    allDay: false,
    start: { dateTime: localDateTime(targetDay, startTime), timeZone: settings.timeZone },
    end: { dateTime: localDateTime(targetDay, endTime), timeZone: settings.timeZone },
  };
}

/** レコードの件名を決める。title が空なら type から補う。 */
function pickTitle(record) {
  const title = typeof record.title === 'string' ? record.title.trim() : '';
  if (title) return title;
  return FALLBACK_TITLES[record.type] ?? record.type ?? '勤務';
}

/** 内容が変わったかどうかを比べるためのハッシュを付ける。 */
function withHash(entry) {
  const signature = [
    entry.title,
    entry.allDay ? 'allday' : 'timed',
    entry.start.date ?? entry.start.dateTime,
    entry.end.date ?? entry.end.dateTime,
  ].join('|');
  return { ...entry, hash: shortHash(signature) };
}
