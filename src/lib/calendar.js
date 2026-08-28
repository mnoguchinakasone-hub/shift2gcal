/**
 * Google Calendar API v3 クライアント（必要な操作のみ）。
 *
 * 401 を受けた場合はキャッシュ済みトークンを破棄して一度だけ再試行する。
 */

import { getAccessToken, removeCachedToken } from './auth.js';
import { SOURCE_TAG } from './config.js';
import { nextMonth, previousMonth } from './dates.js';

const API_BASE = 'https://www.googleapis.com/calendar/v3';

/** 認証付きでAPIを呼ぶ。失効トークンは一度だけ再取得する。 */
async function request(path, { method = 'GET', body, query } = {}) {
  const url = new URL(API_BASE + path);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  }

  const send = async (token) =>
    fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

  let token = await getAccessToken();
  let response = await send(token);

  if (response.status === 401) {
    await removeCachedToken(token);
    token = await getAccessToken();
    response = await send(token);
  }

  if (response.status === 204) return null;
  if (!response.ok) throw await toApiError(response);
  return response.json();
}

/** APIエラーレスポンスを読める Error に変換する。 */
async function toApiError(response) {
  let detail = '';
  try {
    const json = await response.json();
    detail = json?.error?.message ?? '';
  } catch {
    detail = await response.text().catch(() => '');
  }
  const error = new Error(
    `Google Calendar API エラー (${response.status})${detail ? `: ${detail}` : ''}`,
  );
  error.status = response.status;
  return error;
}

/**
 * 対象月に同期済みのイベントを取得する。
 * 拡張プロパティ source=shift2gcal を持つイベントだけが対象。
 *
 * timeMin/timeMax はUTC基準で判定されるため、JSTの終日イベントを取りこぼさないよう
 * 前後1か月に広げて取得し、拡張プロパティの targetDay で対象月に絞り込む。
 */
export async function listSyncedEvents({ calendarId, month }) {
  const timeMin = `${previousMonth(month)}-01T00:00:00Z`;
  const timeMax = `${nextMonth(nextMonth(month))}-01T00:00:00Z`;
  const events = [];
  let pageToken;

  do {
    const page = await request(`/calendars/${encodeURIComponent(calendarId)}/events`, {
      query: {
        privateExtendedProperty: `source=${SOURCE_TAG}`,
        timeMin,
        timeMax,
        singleEvents: 'true',
        showDeleted: 'false',
        maxResults: '2500',
        pageToken,
      },
    });
    events.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);

  return events.filter((event) => belongsToMonth(event, month));
}

/** 同期済みイベントが対象月のものか判定する。 */
function belongsToMonth(event, month) {
  const targetDay = event.extendedProperties?.private?.targetDay;
  if (targetDay) return targetDay.startsWith(month);
  // targetDay を持たない同期イベントは開始日で判定する（旧バージョンで作られた場合の保険）。
  const start = event.start?.date ?? event.start?.dateTime ?? '';
  return start.startsWith(month);
}

/** 登録プランをカレンダーイベントのリソース表現に変換する。 */
export function toEventResource(entry) {
  return {
    summary: entry.title,
    start: entry.start,
    end: entry.end,
    extendedProperties: {
      private: {
        source: SOURCE_TAG,
        targetDay: entry.targetDay,
        hash: entry.hash,
        kind: entry.kind,
      },
    },
  };
}

/** イベントを新規作成する。 */
export function insertEvent(calendarId, entry) {
  return request(`/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    body: toEventResource(entry),
  });
}

/** 既存イベントを差し替える（PUT。前回の start/end 形式が残らないようにする）。 */
export function updateEvent(calendarId, eventId, entry) {
  return request(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: 'PUT', body: toEventResource(entry) },
  );
}

/** イベントを削除する。既に消えている場合（404/410）は成功扱いにする。 */
export async function deleteEvent(calendarId, eventId) {
  try {
    await request(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: 'DELETE' },
    );
  } catch (error) {
    if (error.status === 404 || error.status === 410) return;
    throw error;
  }
}

/** 書き込み可能なカレンダー一覧を返す（オプション画面の選択肢用）。 */
export async function listCalendars() {
  const page = await request('/users/me/calendarList', {
    query: { minAccessRole: 'writer', maxResults: '250' },
  });
  return (page.items ?? []).map((item) => ({
    id: item.id,
    summary: item.summary,
    primary: Boolean(item.primary),
  }));
}
